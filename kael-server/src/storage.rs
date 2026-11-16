use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, hash_map::DefaultHasher},
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    path::Path,
    time::Duration,
};

pub struct Storage {
    connection: Connection,
    fingerprints: HashMap<String, u64>,
    path: std::path::PathBuf,
}

const SCHEMA: &str = "
CREATE TABLE records (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    facility_code TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL,
    PRIMARY KEY (collection, id)
);
CREATE INDEX idx_records_fac ON records(collection, facility_code, created_at DESC);
CREATE TABLE documents (
    key TEXT PRIMARY KEY,
    payload TEXT NOT NULL
);
CREATE TABLE sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    facility_code TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id, expires_at DESC);
PRAGMA user_version = 2;
";

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
        if version != 2 {
            return Err("Versi schema database KAEL tidak didukung. Kosongkan database lalu jalankan setup.".into());
        }
        let (db, fingerprints) = read_database(&connection, path)?;
        Ok((
            Self {
                connection,
                fingerprints,
                path: path.to_path_buf(),
            },
            db,
        ))
    }

    pub fn reload(&mut self) -> Result<Value, String> {
        let (next, fingerprints) = read_database(&self.connection, &self.path)?;
        self.fingerprints = fingerprints;
        Ok(next)
    }

    pub fn save(&mut self, db: &Value) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Database sedang tidak dapat ditulis: {error}"))?;
        let fingerprints = write_database(&transaction, db, &self.fingerprints)?;
        transaction
            .commit()
            .map_err(|error| format!("Commit database gagal: {error}"))?;
        self.fingerprints = fingerprints;
        Ok(())
    }

    pub fn load_sessions(&self) -> Result<Vec<(String, String, String, i64)>, String> {
        let mut statement = self
            .connection
            .prepare("SELECT token, user_id, facility_code, expires_at FROM sessions WHERE expires_at > ?1")
            .map_err(|error| error.to_string())?;
        let now = chrono::Utc::now().timestamp_millis();
        let rows = statement
            .query_map(params![now], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))
            .map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
    }

    pub fn save_sessions(&mut self, sessions: &HashMap<String, (String, String, i64)>) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM sessions", [])
            .map_err(|error| error.to_string())?;
        {
            let mut statement = transaction
                .prepare("INSERT INTO sessions (token, user_id, facility_code, expires_at) VALUES (?1, ?2, ?3, ?4)")
                .map_err(|error| error.to_string())?;
            for (token, (user_id, facility_code, expires_at)) in sessions {
                statement
                    .execute(params![token, user_id, facility_code, expires_at])
                    .map_err(|error| error.to_string())?;
            }
        }
        transaction.commit().map_err(|error| error.to_string())
    }

    pub fn delete_session(&mut self, token: &str) -> Result<(), String> {
        self.connection
            .execute("DELETE FROM sessions WHERE token = ?1", params![token])
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    pub fn create(path: &Path, db: &Value) -> Result<(), String> {
        if path.exists() {
            return Err("Database KAEL sudah ada. Setup tidak boleh menimpa data operasional.".into());
        }
        let parent = path.parent().ok_or_else(|| "Lokasi database tidak valid.".to_string())?;
        let mut directory = fs::DirBuilder::new();
        directory.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            directory.mode(0o700);
        }
        directory.create(parent).map_err(|error| error.to_string())?;
        let temporary = parent.join(format!(".kael-{}.tmp", uuid::Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        drop(options.open(&temporary).map_err(|error| error.to_string())?);
        let result = (|| -> Result<(), String> {
            let mut data = db.clone();
            normalize(&mut data, path)?;
            let mut connection = Connection::open(&temporary).map_err(|error| error.to_string())?;
            configure(&connection)?;
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| error.to_string())?;
            transaction.execute_batch(SCHEMA).map_err(|error| error.to_string())?;
            write_database(&transaction, &data, &HashMap::new())?;
            transaction.commit().map_err(|error| error.to_string())?;
            drop(connection);
            fs::hard_link(&temporary, path).map_err(|error| format!("Database baru tidak dapat dipasang: {error}"))?;
            fs::File::open(parent).and_then(|directory| directory.sync_all()).map_err(|error| error.to_string())?;
            Ok(())
        })();
        let _ = fs::remove_file(&temporary);
        let _ = fs::remove_file(format!("{}-journal", temporary.display()));
        let _ = fs::remove_file(format!("{}-wal", temporary.display()));
        let _ = fs::remove_file(format!("{}-shm", temporary.display()));
        result
    }
}

fn configure(connection: &Connection) -> Result<(), String> {
    connection.busy_timeout(Duration::from_secs(5)).map_err(|error| error.to_string())?;
    connection.pragma_update(None, "journal_mode", "WAL").map_err(|error| error.to_string())?;
    connection.pragma_update(None, "synchronous", "NORMAL").map_err(|error| error.to_string())?;
    Ok(())
}

fn read_database(connection: &Connection, path: &Path) -> Result<(Value, HashMap<String, u64>), String> {
    let mut db = json!({});
    let mut fingerprints = HashMap::new();
    let mut statement = connection
        .prepare("SELECT collection, id, payload FROM records ORDER BY rowid ASC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)))
        .map_err(|error| error.to_string())?;
    for row in rows {
        let (collection, id, payload) = row.map_err(|error| error.to_string())?;
        let value: Value = serde_json::from_str(&payload).map_err(|_| format!("Dokumen {collection}/{id} tidak valid."))?;
        if !db[&collection].is_array() {
            db[&collection] = json!([]);
        }
        db[&collection].as_array_mut().expect("koleksi").push(value);
        fingerprints.insert(fingerprint_key(&collection, &id), hash_payload(&payload));
    }
    drop(statement);
    let mut documents = connection
        .prepare("SELECT key, payload FROM documents")
        .map_err(|error| error.to_string())?;
    let docs = documents
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|error| error.to_string())?;
    for row in docs {
        let (key, payload) = row.map_err(|error| error.to_string())?;
        db[&key] = serde_json::from_str(&payload).map_err(|_| format!("Dokumen {key} tidak valid."))?;
        fingerprints.insert(fingerprint_key("@", &key), hash_payload(&payload));
    }
    normalize(&mut db, path)?;
    Ok((db, fingerprints))
}

fn write_database(
    transaction: &Transaction,
    db: &Value,
    previous: &HashMap<String, u64>,
) -> Result<HashMap<String, u64>, String> {
    let mut next = HashMap::new();
    let object = db.as_object().ok_or_else(|| "Database KAEL tidak valid.".to_string())?;
    for (key, value) in object {
        if key == "sessions" {
            continue;
        }
        if let Some(rows) = value.as_array() {
            let mut seen = HashSet::with_capacity(rows.len());
            for row in rows {
                let id = record_id(row);
                if id.is_empty() || !seen.insert(id.clone()) {
                    continue;
                }
                let payload = serde_json::to_string(row).map_err(|error| error.to_string())?;
                let digest = hash_payload(&payload);
                let mark = fingerprint_key(key, &id);
                if previous.get(&mark) != Some(&digest) {
                    let fac = if !text_of(row, "facilityCode").is_empty() {
                        text_of(row, "facilityCode")
                    } else {
                        text_of(row, "originFacilityCode")
                    };
                    transaction.execute(
                        "INSERT INTO records (collection, id, facility_code, created_at, payload) VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT(collection, id) DO UPDATE SET facility_code = excluded.facility_code, created_at = excluded.created_at, payload = excluded.payload",
                        params![key, id, fac, created_of(row), payload],
                    ).map_err(|error| error.to_string())?;
                }
                next.insert(mark, digest);
            }
        } else if !value.is_null() {
            let payload = serde_json::to_string(value).map_err(|error| error.to_string())?;
            let digest = hash_payload(&payload);
            let mark = fingerprint_key("@", key);
            if previous.get(&mark) != Some(&digest) {
                transaction.execute(
                    "INSERT INTO documents (key, payload) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload",
                    params![key, payload],
                ).map_err(|error| error.to_string())?;
            }
            next.insert(mark, digest);
        }
    }
    for old_mark in previous.keys() {
        if !next.contains_key(old_mark) {
            if let Some((collection, id)) = old_mark.split_once('\u{1}') {
                if collection != "@" {
                    transaction
                        .execute("DELETE FROM records WHERE collection = ?1 AND id = ?2", params![collection, id])
                        .map_err(|error| error.to_string())?;
                }
            }
        }
    }
    Ok(next)
}

fn record_id(row: &Value) -> String {
    for key in [
        "id",
        "configId",
        "scopeKey",
        "code",
        "entryNumber",
        "invoiceNumber",
        "journalNumber",
    ] {
        let value = text_of(row, key);
        if !value.is_empty() {
            return value;
        }
    }
    String::new()
}

fn text_of(value: &Value, key: &str) -> String {
    value.get(key).and_then(Value::as_str).unwrap_or("").to_owned()
}

pub fn created_of(value: &Value) -> String {
    for key in [
        "createdAt",
        "timestamp",
        "recordedAt",
        "publishedAt",
        "admittedAt",
        "orderDate",
        "scheduledStart",
        "updatedAt",
    ] {
        let found = text_of(value, key);
        if !found.is_empty() {
            return found;
        }
    }
    String::new()
}

fn fingerprint_key(collection: &str, id: &str) -> String {
    format!("{collection}\u{1}{id}")
}

fn hash_payload(payload: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    payload.hash(&mut hasher);
    hasher.finish()
}

fn normalize(db: &mut Value, path: &Path) -> Result<(), String> {
    if !db.is_object() || !db["serverConfig"].is_object() {
        return Err("Struktur database KAEL tidak dapat dibaca.".into());
    }
    for key in [
        "users", "facilities", "patients", "visits", "soapRecords", "beds", "medications",
        "pharmacyOrders", "labOrders", "invoices", "accountingEntries", "bridgingLogs", "auditLogs",
        "roles", "facilityConfigs", "evidenceRegistry", "medicationMutations", "purchaseOrders",
        "radiologyOrders", "surgicalSchedules", "referrals", "doubleEntryJournals", "idempotencyRecords",
        "attendance", "leaveRequests", "payrollRuns",
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
