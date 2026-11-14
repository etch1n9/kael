use std::{
    env,
    path::{Path, PathBuf},
};

#[derive(Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub data_file: PathBuf,
    pub web_root: Option<PathBuf>,
    pub client_origins: Vec<String>,
    pub api_origins: Vec<String>,
    pub root: PathBuf,
}

impl Config {
    pub fn load() -> Result<Self, String> {
        let current = env::current_dir().map_err(|error| error.to_string())?;
        let root = match env::var("KAEL_SERVER_ROOT") {
            Ok(value) if !value.trim().is_empty() => resolve(&current, value.trim()),
            _ if current.join("kael-server").is_dir() => current.join("kael-server"),
            _ if current
                .file_name()
                .is_some_and(|name| name == "kael-server") =>
            {
                current
            }
            _ => env::current_exe()
                .ok()
                .and_then(|file| file.parent().map(Path::to_path_buf))
                .unwrap_or(current),
        };
        let environment = root.join(".env");
        if environment.is_file() {
            dotenvy::from_path(&environment)
                .map_err(|error| format!("Konfigurasi environment tidak dapat dibaca: {error}"))?;
        }
        let port = value("PORT")
            .unwrap_or_else(|| "1507".into())
            .parse::<u16>()
            .map_err(|_| "PORT harus berupa angka antara 0 dan 65535.".to_string())?;
        Ok(Self {
            host: value("KAEL_HOST").unwrap_or_else(|| "127.0.0.1".into()),
            port,
            data_file: resolve(
                &root,
                &value("KAEL_DATA_FILE").unwrap_or_else(|| "storage/kael.sqlite".into()),
            ),
            web_root: value("KAEL_WEB_ROOT").map(|path| resolve(&root, &path)),
            client_origins: origins("KAEL_CLIENT_ORIGINS")?,
            api_origins: origins("KAEL_API_ORIGINS")?,
            root,
        })
    }

    pub fn resolve(&self, path: &str) -> PathBuf {
        resolve(&self.root, path)
    }
}

fn value(name: &str) -> Option<String> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve(root: &Path, value: &str) -> PathBuf {
    let path = Path::new(value);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    }
}

fn origins(name: &str) -> Result<Vec<String>, String> {
    let mut result = Vec::new();
    for raw in env::var(name)
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let origin = url::Url::parse(raw)
            .map_err(|_| format!("{name} harus berisi origin HTTP(S), dipisahkan koma."))?;
        if !matches!(origin.scheme(), "http" | "https")
            || !origin.username().is_empty()
            || origin.password().is_some()
            || origin.path() != "/"
            || origin.query().is_some()
            || origin.fragment().is_some()
            || origin.host_str().is_none_or(|host| host.contains('*'))
        {
            return Err(format!(
                "{name} hanya menerima origin HTTP(S) tanpa path, kredensial, atau wildcard."
            ));
        }
        let normalized = origin.origin().ascii_serialization();
        if !result.contains(&normalized) {
            result.push(normalized);
        }
    }
    Ok(result)
}
