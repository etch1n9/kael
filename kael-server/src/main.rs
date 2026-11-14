mod accounts;
mod administration;
mod bootstrap;
mod care;
mod config;
mod domain;
mod finance;
mod http;
mod pharmacy;
mod storage;
mod support;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

#[tokio::main]
async fn main() {
    if let Err(message) = run().await {
        eprintln!("KAEL gagal dimulai: {message}");
        std::process::exit(1);
    }
}

async fn run() -> Result<(), String> {
    let config = config::Config::load()?;
    let command = std::env::args().nth(1).unwrap_or_else(|| "serve".into());
    if command == "setup" || command == "--setup" {
        return bootstrap::run(&config);
    }
    if command != "serve" {
        return Err("Perintah tersedia: serve, setup.".into());
    }
    let (store, db) = storage::Storage::load(&config.data_file)?;
    if let Some(root) = &config.web_root {
        if !root.join("index.html").is_file() {
            return Err("KAEL_WEB_ROOT harus menunjuk ke hasil build kael-client.".into());
        }
    }
    let address = format!("{}:{}", config.host, config.port);
    let listener = tokio::net::TcpListener::bind((config.host.as_str(), config.port))
        .await
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AddrInUse {
                format!("Alamat {address} sedang digunakan.")
            } else {
                error.to_string()
            }
        })?;
    let app = http::App {
        config,
        store,
        saved_state: db.clone(),
        db,
        sessions: HashMap::new(),
    };
    let router = axum::Router::new()
        .fallback(http::serve)
        .with_state(Arc::new(Mutex::new(app)));
    println!(
        "KAEL mendengarkan di {}",
        listener.local_addr().map_err(|error| error.to_string())?
    );
    axum::serve(listener, router)
        .with_graceful_shutdown(shutdown())
        .await
        .map_err(|error| error.to_string())
}

async fn shutdown() {
    #[cfg(unix)]
    {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            tokio::select! { _ = tokio::signal::ctrl_c() => {}, _ = terminate.recv() => {} }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
