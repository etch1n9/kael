use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, hash_map::DefaultHasher},
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::Write,
    path::Path,
    time::Duration,
};

pub struct Storage {
    connection: Connection,
    fingerprints: HashMap<String, u64>,
    path: std::path::PathBuf,
    lock_file: Option<std::fs::File>,
    lock_path: std::path::PathBuf,
}

impl Drop for Storage {
    fn drop(&mut self) {
        if let Some(file) = self.lock_file.take() {
            drop(file);
            let _ = fs::remove_file(&self.lock_path);
        }
    }
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
        let (lock_file, lock_path) = claim_lock(path)?;
        let mut connection = match Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE) {
            Ok(connection) => connection,
            Err(error) => {
                drop(lock_file);
                let _ = fs::remove_file(&lock_path);
                return Err(format!("Database KAEL tidak dapat dibuka: {error}"));
            }
        };
        if let Err(error) = configure(&connection) {
            drop(lock_file);
            let _ = fs::remove_file(&lock_path);
            return Err(error);
        }
        let version: i64 = match connection.pragma_query_value(None, "user_version", |row| row.get(0)) {
            Ok(version) => version,
            Err(error) => {
                drop(lock_file);
                let _ = fs::remove_file(&lock_path);
                return Err(error.to_string());
            }
        };
        if version == 1 {
            if let Err(error) = migrate_v1(&mut connection) {
                drop(lock_file);
                let _ = fs::remove_file(&lock_path);
                return Err(error);
            }
        } else if version != 2 {
            drop(lock_file);
            let _ = fs::remove_file(&lock_path);
            return Err("Versi schema database KAEL tidak didukung. Kosongkan database lalu jalankan setup.".into());
        }
        let loaded = read_database(&connection, path);
        let (db, fingerprints) = match loaded {
            Ok(value) => value,
            Err(error) => {
                drop(lock_file);
                let _ = fs::remove_file(&lock_path);
                return Err(error);
            }
        };
        Ok((
            Self {
                connection,
                fingerprints,
                path: path.to_path_buf(),
                lock_file: Some(lock_file),
                lock_path,
            },
            db,
        ))
    }

    pub fn reload(&mut self) -> Result<Value, String> {
        let (next, fingerprints) = read_database(&self.connection, &self.path)?;
        self.fingerprints = fingerprints;
        Ok(next)
    }

    #[allow(dead_code)]
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

    pub fn query_page(
        &self,
        collection: &str,
        facility_code: &str,
        offset: usize,
        limit: usize,
    ) -> Result<(Vec<Value>, usize), String> {
        let total: i64 = self
            .connection
            .query_row(
                "SELECT COUNT(*) FROM records WHERE collection = ?1 AND facility_code = ?2",
                params![collection, facility_code],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let mut statement = self
            .connection
            .prepare(
                "SELECT payload FROM records WHERE collection = ?1 AND facility_code = ?2 ORDER BY created_at DESC, id DESC LIMIT ?3 OFFSET ?4",
            )
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map(
                params![collection, facility_code, limit as i64, offset as i64],
                |row| row.get::<_, String>(0),
            )
            .map_err(|error| error.to_string())?;
        let mut items = Vec::new();
        for row in rows {
            let payload = row.map_err(|error| error.to_string())?;
            if let Ok(val) = serde_json::from_str::<Value>(&payload) {
                items.push(val);
            }
        }
        Ok((items, total.max(0) as usize))
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

    pub fn save_all(
        &mut self,
        db: &Value,
        sessions: &HashMap<String, (String, String, i64)>,
    ) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Database sedang tidak dapat ditulis: {error}"))?;
        let fingerprints = write_database(&transaction, db, &self.fingerprints)?;
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
        transaction
            .commit()
            .map_err(|error| format!("Commit database gagal: {error}"))?;
        self.fingerprints = fingerprints;
        Ok(())
    }

    pub fn next_sequence(&mut self, key: &str, at_least: i64) -> Result<i64, String> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| error.to_string())?;
        transaction
            .execute_batch("CREATE TABLE IF NOT EXISTS sequences (key TEXT PRIMARY KEY, value INTEGER NOT NULL);")
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "INSERT INTO sequences (key, value) VALUES (?1, 0) ON CONFLICT(key) DO NOTHING",
                params![key],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "UPDATE sequences SET value = MAX(value, ?2) + 1 WHERE key = ?1",
                params![key, at_least],
            )
            .map_err(|error| error.to_string())?;
        let value: i64 = transaction
            .query_row(
                "SELECT value FROM sequences WHERE key = ?1",
                params![key],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
        Ok(value)
    }

    pub fn backup_to(&self, dest: &Path) -> Result<(), String> {
        if dest.exists() {
            let _ = fs::remove_file(dest);
        }
        let escaped = dest.to_string_lossy().replace('\'', "''");
        self.connection
            .execute(&format!("VACUUM INTO '{escaped}'"), [])
            .map_err(|error| error.to_string())?;
        let dst_conn = Connection::open_with_flags(dest, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| error.to_string())?;
        dst_conn
            .pragma_query_value(None, "integrity_check", |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())
            .and_then(|res| {
                if res == "ok" {
                    Ok(())
                } else {
                    Err(format!("Integritas salinan database tidak valid: {res}"))
                }
            })
    }

    pub fn verify_and_restore(source: &Path, target: &Path) -> Result<(), String> {
        if !source.is_file() {
            return Err("Berkas sumber pemulihan tidak ditemukan.".into());
        }
        let src_conn = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .map_err(|error| format!("Berkas sumber tidak dapat dibuka: {error}"))?;
        let integrity: String = src_conn
            .pragma_query_value(None, "integrity_check", |row| row.get(0))
            .map_err(|error| error.to_string())?;
        if integrity != "ok" {
            return Err(format!("Pemeriksaan integritas berkas cadangan gagal: {integrity}"));
        }
        drop(src_conn);
        let (_, _) = Self::load(source)?;
        let parent = target.parent().ok_or_else(|| "Lokasi target tidak valid.".to_string())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temp = parent.join(format!(".kael-restore-{}.tmp", uuid::Uuid::new_v4()));
        {
            let src = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| error.to_string())?;
            let escaped = temp.to_string_lossy().replace('\'', "''");
            src.execute(&format!("VACUUM INTO '{escaped}'"), [])
                .map_err(|error| error.to_string())?;
        }
        fs::rename(&temp, target).map_err(|error| format!("Gagal memasang database hasil pemulihan: {error}"))?;
        Ok(())
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

fn claim_lock(path: &Path) -> Result<(std::fs::File, std::path::PathBuf), String> {
    let lock_path = path.with_extension("sqlite.lock");
    for _ in 0..3 {
        let temp_lock = path.with_extension(format!("sqlite.lock.{}", std::process::id()));
        if let Ok(mut file) = OpenOptions::new().write(true).create(true).truncate(true).open(&temp_lock) {
            let _ = write!(file, "{}", std::process::id());
            let _ = file.sync_all();
            if fs::hard_link(&temp_lock, &lock_path).is_ok() {
                let _ = fs::remove_file(&temp_lock);
                return Ok((file, lock_path));
            }
            let _ = fs::remove_file(&temp_lock);
        }
        match OpenOptions::new().write(true).create_new(true).open(&lock_path) {
            Ok(mut file) => {
                let _ = write!(file, "{}", std::process::id());
                let _ = file.sync_all();
                return Ok((file, lock_path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let pid = fs::read_to_string(&lock_path)
                    .ok()
                    .and_then(|raw| raw.trim().parse::<u32>().ok())
                    .unwrap_or(0);
                let alive = pid > 0 && pid != std::process::id() && Path::new(&format!("/proc/{pid}")).exists();
                if alive {
                    return Err("Database KAEL sedang dipakai proses lain. Jalankan satu server untuk satu database.".into());
                }
                let _ = fs::remove_file(&lock_path);
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("Kunci proses database KAEL tidak dapat diambil.".into())
}

fn migrate_v1(connection: &mut Connection) -> Result<(), String> {
    let payload: String = connection
        .query_row("SELECT payload FROM kael_state WHERE id = 1", [], |row| row.get(0))
        .map_err(|error| format!("Database skema lama tidak dapat dibaca: {error}"))?;
    let mut db: Value = serde_json::from_str(&payload).map_err(|_| "Snapshot database lama tidak valid.".to_string())?;
    if let Some(obj) = db.as_object_mut() {
        for (col_key, col_val) in obj.iter_mut() {
            if col_key == "sessions" {
                continue;
            }
            if let Some(rows) = col_val.as_array_mut() {
                let mut seen = HashSet::new();
                for (idx, row) in rows.iter_mut().enumerate() {
                    let orig_id = record_id(row);
                    let assigned = if orig_id.is_empty() {
                        format!("mig-{col_key}-{}", idx + 1)
                    } else if !seen.insert(orig_id.clone()) {
                        if col_key == "soapRevisions" && row.get("soapId").is_none() {
                            row["soapId"] = json!(orig_id);
                        }
                        let disambiguated = format!("{orig_id}-rev-{}", idx + 1);
                        seen.insert(disambiguated.clone());
                        disambiguated
                    } else {
                        orig_id
                    };
                    if row.is_object() && record_id(row) != assigned {
                        row["id"] = json!(assigned);
                    }
                }
            }
        }
    }
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS records (
                collection TEXT NOT NULL,
                id TEXT NOT NULL,
                facility_code TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                payload TEXT NOT NULL,
                PRIMARY KEY (collection, id)
            );
            CREATE INDEX IF NOT EXISTS idx_records_fac ON records(collection, facility_code, created_at DESC);
            CREATE TABLE IF NOT EXISTS documents (
                key TEXT PRIMARY KEY,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                facility_code TEXT NOT NULL,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, expires_at DESC);",
        )
        .map_err(|error| error.to_string())?;
    write_database(&transaction, &db, &HashMap::new())?;
    transaction
        .execute_batch("DROP TABLE IF EXISTS kael_state; PRAGMA user_version = 2;")
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| format!("Migrasi database lama gagal: {error}"))
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
            let mut seen = HashSet::new();
            for row in rows {
                let id = record_id(row);
                if id.is_empty() || !seen.insert(id.clone()) {
                    continue;
                }
                let payload = serde_json::to_string(row).map_err(|error| error.to_string())?;
                let digest = hash_payload(&payload);
                let mark = fingerprint_key(key, &id);
                if previous.get(&mark) != Some(&digest) {
                    transaction.execute(
                        "INSERT INTO records (collection, id, facility_code, created_at, payload) VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT(collection, id) DO UPDATE SET facility_code = excluded.facility_code, created_at = excluded.created_at, payload = excluded.payload",
                        params![key, id, text_of(row, "facilityCode"), created_of(row), payload],
                    ).map_err(|error| error.to_string())?;
                }
                next.insert(mark, digest);
            }
            let prefix = format!("{key}\u{1}");
            for existing in previous.keys() {
                if let Some(id) = existing.strip_prefix(&prefix) {
                    if !seen.contains(id) {
                        transaction
                            .execute("DELETE FROM records WHERE collection = ?1 AND id = ?2", params![key, id])
                            .map_err(|error| error.to_string())?;
                    }
                }
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
    Ok(next)
}

fn record_id(row: &Value) -> String {
    for key in ["id", "configId", "snapshotId", "idempotencyKey", "scopeKey", "code", "entryNumber", "invoiceNumber", "journalNumber"] {
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

fn created_of(value: &Value) -> String {
    for key in ["createdAt", "timestamp", "recordedAt", "publishedAt", "orderDate", "admittedAt", "scheduledStart", "updatedAt"] {
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
        "attendance", "leaveRequests", "payrollRuns", "inpatientNotes", "soapRevisions",
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
