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
    if command == "backup" || command == "--backup" {
        let dest = std::env::args()
            .nth(2)
            .ok_or_else(|| "Gunakan: kael-server backup <path-tujuan.sqlite>".to_string())?;
        let (store, _) = storage::Storage::load(&config.data_file)?;
        return store.backup_to(std::path::Path::new(&dest));
    }
    if command == "restore" || command == "--restore" {
        let src = std::env::args()
            .nth(2)
            .ok_or_else(|| "Gunakan: kael-server restore <path-sumber.sqlite>".to_string())?;
        return storage::Storage::verify_and_restore(std::path::Path::new(&src), &config.data_file);
    }
    if command != "serve" {
        return Err("Perintah tersedia: serve, setup, backup, restore.".into());
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
    let mut sessions = HashMap::new();
    for (token, user_id, facility_code, expires_at) in store.load_sessions()? {
        sessions.insert(token, http::Session { user_id, facility_code, expires_at });
    }
    let shared_config = config.clone();
    let sessions_digest = http::sessions_digest(&sessions);
    let app = http::App {
        config,
        store,
        db,
        sessions,
        sessions_digest,
        login_failures: HashMap::new(),
    };
    let router = axum::Router::new()
        .fallback(http::serve)
        .with_state(Arc::new(http::Shared { app: Mutex::new(app), config: shared_config }));
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
