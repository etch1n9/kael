use rusqlite::{Connection, OpenFlags, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    path::Path,
    time::Duration,
};

pub struct Storage {
    connection: Connection,
    revision: i64,
}

impl Storage {
    pub fn load(path: &Path) -> Result<(Self, Value), String> {
        if !path.is_file() {
            return Err("Database KAEL belum tersedia. Jalankan perintah setup.".into());
        }
        let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .map_err(|error| format!("Database KAEL tidak dapat dibuka: {error}"))?;
        configure(&connection)?;
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if version != 1 {
            return Err("Versi schema database KAEL tidak didukung.".into());
        }
        let (revision, payload): (i64, String) = connection
            .query_row(
                "SELECT revision, payload FROM kael_state WHERE id = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| format!("Snapshot database KAEL tidak dapat dibaca: {error}"))?;
        let mut db: Value = serde_json::from_str(&payload)
            .map_err(|_| "Snapshot database KAEL tidak valid.".to_string())?;
        normalize(&mut db, path)?;
        let storage = Self {
            connection,
            revision,
        };
        Ok((storage, db))
    }

    pub fn save(&mut self, db: &Value) -> Result<(), String> {
        let payload = serde_json::to_string(db).map_err(|error| error.to_string())?;
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Database sedang tidak dapat ditulis: {error}"))?;
        let changed = transaction.execute(
            "UPDATE kael_state SET payload = ?1, revision = revision + 1, updated_at = ?2 WHERE id = 1 AND revision = ?3",
            params![payload, chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true), self.revision],
        ).map_err(|error| format!("Perubahan database gagal disimpan: {error}"))?;
        if changed != 1 {
            return Err("Database diubah proses lain. Gunakan satu backend per database, lalu mulai ulang layanan.".into());
        }
        transaction
            .commit()
            .map_err(|error| format!("Commit database gagal: {error}"))?;
        self.revision += 1;
        Ok(())
    }

    pub fn create(path: &Path, db: &Value) -> Result<(), String> {
        if path.exists() {
            return Err(
                "Database KAEL sudah ada. Setup tidak boleh menimpa data operasional.".into(),
            );
        }
        let parent = path
            .parent()
            .ok_or_else(|| "Lokasi database tidak valid.".to_string())?;
        let mut directory = fs::DirBuilder::new();
        directory.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory
            .create(parent)
            .map_err(|error| error.to_string())?;
        let temporary = parent.join(format!(".kael-{}.tmp", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        drop(
            options
                .open(&temporary)
                .map_err(|error| error.to_string())?,
        );
        let result = (|| -> Result<(), String> {
            let mut data = db.clone();
            normalize(&mut data, path)?;
            let mut connection = Connection::open(&temporary).map_err(|error| error.to_string())?;
            configure(&connection)?;
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| error.to_string())?;
            transaction
                .execute_batch(
                    "CREATE TABLE kael_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                revision INTEGER NOT NULL CHECK (revision > 0),
                payload TEXT NOT NULL CHECK (json_valid(payload)),
                updated_at TEXT NOT NULL
            ); PRAGMA user_version = 1;",
                )
                .map_err(|error| error.to_string())?;
            transaction.execute(
                "INSERT INTO kael_state (id, revision, payload, updated_at) VALUES (1, 1, ?1, ?2)",
                params![serde_json::to_string(&data).map_err(|error| error.to_string())?, chrono::Utc::now().to_rfc3339()],
            ).map_err(|error| error.to_string())?;
            transaction.commit().map_err(|error| error.to_string())?;
            drop(connection);
            fs::hard_link(&temporary, path)
                .map_err(|error| format!("Database baru tidak dapat dipasang: {error}"))?;
            fs::File::open(parent)
                .and_then(|directory| directory.sync_all())
                .map_err(|error| error.to_string())?;
            Ok(())
        })();
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(format!("{}-journal", temporary.display()));
        result
    }
}

fn configure(connection: &Connection) -> Result<(), String> {
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    connection
        .execute_batch("PRAGMA synchronous = FULL;")
        .map_err(|error| error.to_string())
}

fn normalize(db: &mut Value, path: &Path) -> Result<(), String> {
    if !db.is_object() || !db["serverConfig"].is_object() {
        return Err("Struktur database KAEL tidak dapat dibaca.".into());
    }
    for key in [
        "users",
        "facilities",
        "patients",
        "visits",
        "soapRecords",
        "beds",
        "medications",
        "pharmacyOrders",
        "labOrders",
        "invoices",
        "accountingEntries",
        "bridgingLogs",
        "auditLogs",
    ] {
        if !db[key].is_array() {
            return Err(format!("Koleksi database {key} tidak valid."));
        }
    }
    for key in [
        "roles",
        "facilityConfigs",
        "evidenceRegistry",
        "medicationMutations",
        "purchaseOrders",
        "radiologyOrders",
        "surgicalSchedules",
        "referrals",
        "doubleEntryJournals",
        "idempotencyRecords",
    ] {
        if db[key].is_null() {
            db[key] = json!([]);
        }
        if !db[key].is_array() {
            return Err(format!("Koleksi database {key} tidak valid."));
        }
    }
    db["serverConfig"]["storagePath"] = json!(path.to_string_lossy());
    for user in db["users"].as_array_mut().into_iter().flatten() {
        if user.is_object() && user.get("isPractitioner").is_none() {
            user["isPractitioner"] = json!(false);
        }
    }
    Ok(())
}
