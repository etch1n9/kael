use crate::{config::Config, domain::MODULE_KEYS, storage::Storage};
use scrypt::{Params, scrypt};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    io::{self, IsTerminal, Write},
};
use subtle::ConstantTimeEq;

pub fn hash_password(password: &str) -> Result<String, String> {
    let salt = *uuid::Uuid::new_v4().as_bytes();
    let mut output = [0u8; 64];
    let parameters = Params::new(14, 8, 1, 64).map_err(|error| error.to_string())?;
    scrypt(password.as_bytes(), &salt, &parameters, &mut output)
        .map_err(|error| error.to_string())?;
    Ok(format!(
        "scrypt:{}:{}",
        encode_hex(&salt),
        encode_hex(&output)
    ))
}

pub fn verify_password(password: &str, stored: &str) -> bool {
    if !stored.starts_with("scrypt:") {
        let Some(expected) = decode_hex(stored).filter(|bytes| bytes.len() == 32) else {
            return false;
        };
        let digest = Sha256::digest(format!("kael_simrs_salt_v1:{password}").as_bytes());
        return constant_equal(&digest, &expected);
    }
    let parts: Vec<_> = stored.split(':').collect();
    if parts.len() != 3 {
        return false;
    }
    let Some(salt) = decode_hex(parts[1]).filter(|bytes| bytes.len() == 16) else {
        return false;
    };
    let Some(expected) = decode_hex(parts[2]).filter(|bytes| bytes.len() == 64) else {
        return false;
    };
    let Ok(parameters) = Params::new(14, 8, 1, 64) else {
        return false;
    };
    let mut output = [0u8; 64];
    scrypt(password.as_bytes(), &salt, &parameters, &mut output).is_ok()
        && constant_equal(&output, &expected)
}

pub fn run(config: &Config) -> Result<(), String> {
    if config.data_file.exists() {
        return Err("Database KAEL sudah ada. Setup tidak boleh menimpa data operasional.".into());
    }
    let interactive = io::stdin().is_terminal();
    let username = match env::var("KAEL_ADMIN_USERNAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
    {
        Some(value) => value.trim().to_lowercase(),
        None if interactive => {
            let value = question("Username superuser awal [superuser]: ")?;
            if value.is_empty() {
                "superuser".into()
            } else {
                value.to_lowercase()
            }
        }
        None => "superuser".into(),
    };
    if !(3..=64).contains(&username.len())
        || !username.bytes().enumerate().all(|(index, character)| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || (index > 0 && b"._-".contains(&character))
        })
    {
        return Err("Username harus 3–64 karakter: huruf kecil, angka, titik, garis bawah, atau tanda hubung.".into());
    }
    let mut name = env::var("KAEL_ADMIN_FULL_NAME")
        .unwrap_or_default()
        .trim()
        .to_string();
    if name.is_empty() && interactive {
        name = question(&format!("Nama tampilan [{username}]: "))?;
    }
    if name.is_empty() {
        name = username.clone();
    }
    if name.chars().count() > 200 {
        return Err("Nama tampilan maksimal 200 karakter.".into());
    }
    let password = match env::var("KAEL_ADMIN_PASSWORD")
        .ok()
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => match env::var("KAEL_ADMIN_PASSWORD_FILE")
            .ok()
            .filter(|value| !value.is_empty())
        {
            Some(file) => fs::read_to_string(config.resolve(&file))
                .map_err(|error| error.to_string())?
                .trim_end_matches(['\r', '\n'])
                .to_string(),
            None if interactive => {
                let password =
                    rpassword::prompt_password("Kata sandi superuser (minimal 8 karakter): ")
                        .map_err(|error| error.to_string())?;
                let confirmation = rpassword::prompt_password("Ulangi kata sandi: ")
                    .map_err(|error| error.to_string())?;
                if password != confirmation {
                    return Err("Konfirmasi kata sandi tidak sama.".into());
                }
                password
            }
            None => {
                return Err(
                    "Tentukan KAEL_ADMIN_PASSWORD atau KAEL_ADMIN_PASSWORD_FILE untuk setup."
                        .into(),
                );
            }
        },
    };
    if !(8..=512).contains(&password.chars().count()) {
        return Err("Kata sandi superuser harus 8–512 karakter.".into());
    }
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut db = json!({
        "users": [{"id":uuid::Uuid::new_v4().to_string(),"username":username,"fullName":name,"nipOrSip":"",
            "email":env::var("KAEL_ADMIN_EMAIL").unwrap_or_default(),"role":"SUPERUSER","allowedFacilities":["*"],
            "customPrivileges":[],"isPractitioner":false,"active":true,"createdBy":"SYSTEM","createdAt":now,"passwordHash":hash_password(&password)?}],
        "roles":[{"id":"SUPERUSER","name":"Administrator Sistem","modules":MODULE_KEYS,"active":true,"system":true,"createdAt":now}],
        "serverConfig":{"nodeName":env::var("KAEL_NODE_NAME").unwrap_or_else(|_|"KAEL".into()),"environment":"PRODUCTION",
            "storagePath":config.data_file.to_string_lossy(),"satusehatBaseUrl":"","bpjsBaseUrl":"","iomtListenPort":8843,"sessionTimeoutMinutes":480}
    });
    for key in [
        "facilities",
        "facilityConfigs",
        "evidenceRegistry",
        "patients",
        "visits",
        "soapRecords",
        "beds",
        "medications",
        "medicationMutations",
        "pharmacyOrders",
        "purchaseOrders",
        "radiologyOrders",
        "surgicalSchedules",
        "referrals",
        "labOrders",
        "invoices",
        "accountingEntries",
        "doubleEntryJournals",
        "bridgingLogs",
        "auditLogs",
        "idempotencyRecords",
    ] {
        db[key] = Value::Array(Vec::new());
    }
    Storage::create(&config.data_file, &db)?;
    println!(
        "Database SQLite KAEL dibuat. Login sebagai {username}, lalu buat fasilitas, role, dan akun melalui panel superuser."
    );
    Ok(())
}

fn question(label: &str) -> Result<String, String> {
    print!("{label}");
    io::stdout().flush().map_err(|error| error.to_string())?;
    let mut line = String::new();
    io::stdin()
        .read_line(&mut line)
        .map_err(|error| error.to_string())?;
    Ok(line.trim().to_string())
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.len() % 2 != 0 {
        return None;
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let high = (pair[0] as char).to_digit(16)?;
            let low = (pair[1] as char).to_digit(16)?;
            Some((high * 16 + low) as u8)
        })
        .collect()
}
fn constant_equal(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len() && bool::from(left.ct_eq(right))
}
