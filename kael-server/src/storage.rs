use rusqlite::{Connection, OpenFlags, Transaction, TransactionBehavior, params};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet, hash_map::DefaultHasher},
    fs::{self, OpenOptions},
    hash::{Hash, Hasher},
    io::Write,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
    time::Duration,
};

static IN_PROCESS_LOCKS: LazyLock<Mutex<HashSet<PathBuf>>> = LazyLock::new(|| Mutex::new(HashSet::new()));

type FingerprintMap = HashMap<String, HashMap<String, u64>>;

pub struct Storage {
    connection: Connection,
    fingerprints: FingerprintMap,
    path: std::path::PathBuf,
    lock_file: Option<std::fs::File>,
    lock_path: std::path::PathBuf,
}

impl Drop for Storage {
    fn drop(&mut self) {
        if let Some(file) = self.lock_file.take() {
            drop(file);
            let _ = fs::remove_file(&self.lock_path);
            if let Ok(mut active) = IN_PROCESS_LOCKS.lock() {
                active.remove(&self.lock_path);
            }
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
            if let Err(error) = migrate_v1(&mut connection, path) {
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
        self.save_dirty(db, None)
    }

    pub fn save_dirty(&mut self, db: &Value, dirty: Option<&HashSet<String>>) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Database sedang tidak dapat ditulis: {error}"))?;
        let updates = write_database_delta(&transaction, db, &self.fingerprints, dirty)?;
        transaction
            .commit()
            .map_err(|error| format!("Commit database gagal: {error}"))?;
        apply_fingerprint_updates(&mut self.fingerprints, updates);
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

    #[allow(dead_code)]
    pub fn save_all(
        &mut self,
        db: &Value,
        sessions: &HashMap<String, (String, String, i64)>,
    ) -> Result<(), String> {
        self.save_all_dirty(db, sessions, None)
    }

    pub fn save_all_dirty(
        &mut self,
        db: &Value,
        sessions: &HashMap<String, (String, String, i64)>,
        dirty: Option<&HashSet<String>>,
    ) -> Result<(), String> {
        let transaction = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|error| format!("Database sedang tidak dapat ditulis: {error}"))?;
        let updates = write_database_delta(&transaction, db, &self.fingerprints, dirty)?;
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
        apply_fingerprint_updates(&mut self.fingerprints, updates);
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
        if let (Ok(src_canon), Ok(dst_canon)) = (self.path.canonicalize(), dest.canonicalize()) {
            if src_canon == dst_canon {
                return Err("Path tujuan backup tidak boleh sama dengan berkas database aktif.".into());
            }
        }
        let parent = dest.parent().ok_or_else(|| "Lokasi tujuan backup tidak valid.".to_string())?;
        ensure_private_dir(parent)?;
        let stage_dir = parent.join(format!(".kael-backup-stage-{}", uuid::Uuid::new_v4()));
        ensure_private_dir(&stage_dir)?;
        let staging = stage_dir.join("snapshot.sqlite");
        let result = (|| -> Result<(), String> {
            let escaped = staging.to_string_lossy().replace('\'', "''");
            self.connection
                .execute(&format!("VACUUM INTO '{escaped}'"), [])
                .map_err(|error| error.to_string())?;
            set_private_file_permissions(&staging)?;
            let dst_conn = Connection::open_with_flags(&staging, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| error.to_string())?;
            let integrity: String = dst_conn
                .pragma_query_value(None, "integrity_check", |row| row.get(0))
                .map_err(|error| error.to_string())?;
            if integrity != "ok" {
                return Err(format!("Integritas salinan database tidak valid: {integrity}"));
            }
            drop(dst_conn);
            fs::rename(&staging, dest)
                .map_err(|error| format!("Gagal mempublikasikan berkas cadangan: {error}"))?;
            set_private_file_permissions(dest)?;
            let _ = fs::File::open(parent).and_then(|d| d.sync_all());
            Ok(())
        })();
        let _ = fs::remove_dir_all(&stage_dir);
        result
    }

    pub fn verify_and_restore(source: &Path, target: &Path) -> Result<(), String> {
        if !source.is_file() {
            return Err("Berkas sumber pemulihan tidak ditemukan.".into());
        }
        if let (Ok(src_canon), Ok(tgt_canon)) = (source.canonicalize(), target.canonicalize()) {
            if src_canon == tgt_canon {
                return Err("Berkas sumber pemulihan tidak boleh sama dengan target aktif.".into());
            }
        }
        let parent = target.parent().ok_or_else(|| "Lokasi target tidak valid.".to_string())?;
        ensure_private_dir(parent)?;
        let (target_lock_file, target_lock_path) = claim_lock(target)?;
        let stage_dir = parent.join(format!(".kael-restore-stage-{}", uuid::Uuid::new_v4()));
        let result = (|| -> Result<(), String> {
            ensure_private_dir(&stage_dir)?;
            let src_conn = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|error| format!("Berkas sumber tidak dapat dibuka: {error}"))?;
            let integrity: String = src_conn
                .pragma_query_value(None, "integrity_check", |row| row.get(0))
                .map_err(|error| error.to_string())?;
            if integrity != "ok" {
                return Err(format!("Pemeriksaan integritas berkas cadangan gagal: {integrity}"));
            }
            drop(src_conn);
            let temp = stage_dir.join("restored.sqlite");
            {
                let src = Connection::open_with_flags(source, OpenFlags::SQLITE_OPEN_READ_ONLY)
                    .map_err(|error| error.to_string())?;
                let escaped = temp.to_string_lossy().replace('\'', "''");
                src.execute(&format!("VACUUM INTO '{escaped}'"), [])
                    .map_err(|error| error.to_string())?;
            }
            set_private_file_permissions(&temp)?;
            Self::load(&temp)?;
            let _ = fs::remove_file(format!("{}-wal", temp.display()));
            let _ = fs::remove_file(format!("{}-shm", temp.display()));
            let _ = fs::remove_file(format!("{}-journal", temp.display()));

            let rollback = stage_dir.join("rollback.sqlite");
            let had_target = target.exists();
            if had_target {
                fs::rename(target, &rollback)
                    .map_err(|error| format!("Gagal mengamankan database lama sebelum pemulihan: {error}"))?;
            }
            if let Err(error) = fs::rename(&temp, target) {
                if had_target {
                    let _ = fs::rename(&rollback, target);
                }
                return Err(format!("Gagal memasang database hasil pemulihan: {error}"));
            }
            let _ = fs::remove_file(format!("{}-wal", target.display()));
            let _ = fs::remove_file(format!("{}-shm", target.display()));
            let _ = fs::remove_file(format!("{}-journal", target.display()));
            set_private_file_permissions(target)?;
            let _ = fs::File::open(parent).and_then(|d| d.sync_all());
            Ok(())
        })();
        let _ = fs::remove_dir_all(&stage_dir);
        drop(target_lock_file);
        let _ = fs::remove_file(&target_lock_path);
        if let Ok(mut active) = IN_PROCESS_LOCKS.lock() {
            active.remove(&target_lock_path);
        }
        result
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

fn ensure_private_dir(dir: &Path) -> Result<(), String> {
    let mut directory = fs::DirBuilder::new();
    directory.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory.create(dir).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn set_private_file_permissions(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("Gagal mengatur izin berkas privat: {error}"))?;
    }
    Ok(())
}

fn claim_lock(path: &Path) -> Result<(std::fs::File, std::path::PathBuf), String> {
    let lock_path = path.with_extension("sqlite.lock");
    if let Ok(active) = IN_PROCESS_LOCKS.lock() {
        if active.contains(&lock_path) {
            return Err("Database KAEL sedang dipakai proses lain. Jalankan satu server untuk satu database.".into());
        }
    }
    for _ in 0..3 {
        let temp_lock = path.with_extension(format!("sqlite.lock.{}", std::process::id()));
        if let Ok(mut file) = OpenOptions::new().write(true).create(true).truncate(true).open(&temp_lock) {
            let _ = write!(file, "{}", std::process::id());
            let _ = file.sync_all();
            if fs::hard_link(&temp_lock, &lock_path).is_ok() {
                let _ = fs::remove_file(&temp_lock);
                if let Ok(mut active) = IN_PROCESS_LOCKS.lock() {
                    active.insert(lock_path.clone());
                }
                return Ok((file, lock_path));
            }
            let _ = fs::remove_file(&temp_lock);
        }
        match OpenOptions::new().write(true).create_new(true).open(&lock_path) {
            Ok(mut file) => {
                let _ = write!(file, "{}", std::process::id());
                let _ = file.sync_all();
                if let Ok(mut active) = IN_PROCESS_LOCKS.lock() {
                    active.insert(lock_path.clone());
                }
                return Ok((file, lock_path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let pid = fs::read_to_string(&lock_path)
                    .ok()
                    .and_then(|raw| raw.trim().parse::<u32>().ok())
                    .unwrap_or(0);
                let in_use_here = pid == std::process::id()
                    && IN_PROCESS_LOCKS
                        .lock()
                        .map(|active| active.contains(&lock_path))
                        .unwrap_or(false);
                let alive = in_use_here
                    || (pid > 0 && pid != std::process::id() && Path::new(&format!("/proc/{pid}")).exists());
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

fn migrate_v1(connection: &mut Connection, path: &Path) -> Result<(), String> {
    let payload: String = connection
        .query_row("SELECT payload FROM kael_state WHERE id = 1", [], |row| row.get(0))
        .map_err(|error| format!("Database skema lama tidak dapat dibaca: {error}"))?;
    let mut db: Value = serde_json::from_str(&payload).map_err(|_| "Snapshot database lama tidak valid.".to_string())?;
    normalize(&mut db, path)?;
    if let Some(obj) = db.as_object_mut() {
        for (col_key, col_val) in obj.iter_mut() {
            if col_key == "sessions" {
                continue;
            }
            if let Some(rows) = col_val.as_array_mut() {
                let pre_existing: HashSet<String> = rows
                    .iter()
                    .map(record_id)
                    .filter(|id| !id.is_empty())
                    .collect();
                let mut seen = HashSet::new();
                for (idx, row) in rows.iter_mut().enumerate() {
                    if !row.is_object() {
                        return Err(format!(" Baris pada koleksi {col_key} tidak valid untuk dimigrasikan."));
                    }
                    let orig_id = record_id(row);
                    let assigned = if orig_id.is_empty() {
                        let mut seq = idx + 1;
                        loop {
                            let cand = format!("mig-{col_key}-{seq}");
                            if !pre_existing.contains(&cand) && seen.insert(cand.clone()) {
                                break cand;
                            }
                            seq += 1;
                        }
                    } else if !seen.insert(orig_id.clone()) {
                        if col_key == "soapRevisions" && row.get("soapId").is_none() {
                            row["soapId"] = json!(orig_id);
                        }
                        let mut seq = idx + 1;
                        loop {
                            let cand = format!("{orig_id}-rev-{seq}");
                            if !pre_existing.contains(&cand) && seen.insert(cand.clone()) {
                                break cand;
                            }
                            seq += 1;
                        }
                    } else {
                        orig_id
                    };
                    if record_id(row) != assigned {
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

fn read_database(connection: &Connection, path: &Path) -> Result<(Value, FingerprintMap), String> {
    let mut db = json!({});
    let mut fingerprints: FingerprintMap = HashMap::new();
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
        fingerprints
            .entry(collection)
            .or_default()
            .insert(id, hash_payload(&payload));
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
        fingerprints
            .entry("@".to_owned())
            .or_default()
            .insert(key, hash_payload(&payload));
    }
    normalize(&mut db, path)?;
    Ok((db, fingerprints))
}

enum CollectionUpdate {
    Replace(HashMap<String, u64>),
    Append(Vec<(String, u64)>),
}

fn apply_fingerprint_updates(
    fingerprints: &mut FingerprintMap,
    updates: HashMap<String, CollectionUpdate>,
) {
    for (col, update) in updates {
        match update {
            CollectionUpdate::Replace(map) => {
                fingerprints.insert(col, map);
            }
            CollectionUpdate::Append(entries) => {
                let target = fingerprints.entry(col).or_default();
                for (id, digest) in entries {
                    target.insert(id, digest);
                }
            }
        }
    }
}

fn write_database(
    transaction: &Transaction,
    db: &Value,
    previous: &FingerprintMap,
) -> Result<FingerprintMap, String> {
    let updates = write_database_delta(transaction, db, previous, None)?;
    let mut next = previous.clone();
    apply_fingerprint_updates(&mut next, updates);
    Ok(next)
}

fn write_database_delta(
    transaction: &Transaction,
    db: &Value,
    previous: &FingerprintMap,
    dirty_collections: Option<&HashSet<String>>,
) -> Result<HashMap<String, CollectionUpdate>, String> {
    let mut updates = HashMap::new();
    let mut doc_map = previous.get("@").cloned().unwrap_or_default();
    let object = db.as_object().ok_or_else(|| "Database KAEL tidak valid.".to_string())?;
    for (key, value) in object {
        if key == "sessions" {
            continue;
        }
        if let Some(rows) = value.as_array() {
            if rows.len() > 500
                && !matches!(key.as_str(), "roles" | "users" | "facilities" | "radiologyOrders")
                && dirty_collections.is_some_and(|dirty| !dirty.contains(key))
            {
                continue;
            }
            let prev_col = previous.get(key);
            if key == "auditLogs" {
                if let Some(prev_map) = prev_col {
                    let prev_len = prev_map.len();
                    if prev_len > 0
                        && rows.len() >= prev_len
                        && prev_map.contains_key(&record_id(&rows[prev_len - 1]))
                    {
                        let mut appended = Vec::new();
                        for row in &rows[prev_len..] {
                            let id = record_id(row);
                            if id.is_empty() || prev_map.contains_key(&id) {
                                continue;
                            }
                            let payload = serde_json::to_string(row).map_err(|error| error.to_string())?;
                            let digest = hash_payload(&payload);
                            transaction.execute(
                                "INSERT INTO records (collection, id, facility_code, created_at, payload) VALUES (?1, ?2, ?3, ?4, ?5)
                                 ON CONFLICT(collection, id) DO UPDATE SET facility_code = excluded.facility_code, created_at = excluded.created_at, payload = excluded.payload",
                                params![key, id, text_of(row, "facilityCode"), created_of(row), payload],
                            ).map_err(|error| error.to_string())?;
                            appended.push((id, digest));
                        }
                        updates.insert(key.clone(), CollectionUpdate::Append(appended));
                        continue;
                    }
                }
            }
            let mut next_col = HashMap::with_capacity(rows.len());
            for row in rows {
                let id = record_id(row);
                if id.is_empty() || next_col.contains_key(&id) {
                    continue;
                }
                let payload = serde_json::to_string(row).map_err(|error| error.to_string())?;
                let digest = hash_payload(&payload);
                if prev_col.and_then(|m| m.get(&id)) != Some(&digest) {
                    transaction.execute(
                        "INSERT INTO records (collection, id, facility_code, created_at, payload) VALUES (?1, ?2, ?3, ?4, ?5)
                         ON CONFLICT(collection, id) DO UPDATE SET facility_code = excluded.facility_code, created_at = excluded.created_at, payload = excluded.payload",
                        params![key, id, text_of(row, "facilityCode"), created_of(row), payload],
                    ).map_err(|error| error.to_string())?;
                }
                next_col.insert(id, digest);
            }
            if let Some(prev_map) = prev_col {
                for existing_id in prev_map.keys() {
                    if !next_col.contains_key(existing_id) {
                        transaction
                            .execute("DELETE FROM records WHERE collection = ?1 AND id = ?2", params![key, existing_id])
                            .map_err(|error| error.to_string())?;
                    }
                }
            }
            updates.insert(key.clone(), CollectionUpdate::Replace(next_col));
        } else if !value.is_null() {
            let payload = serde_json::to_string(value).map_err(|error| error.to_string())?;
            let digest = hash_payload(&payload);
            if doc_map.get(key) != Some(&digest) {
                transaction.execute(
                    "INSERT INTO documents (key, payload) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload",
                    params![key, payload],
                ).map_err(|error| error.to_string())?;
            }
            doc_map.insert(key.clone(), digest);
        }
    }
    updates.insert("@".to_owned(), CollectionUpdate::Replace(doc_map));
    Ok(updates)
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

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    fn sample_db() -> Value {
        json!({
            "serverConfig": { "sessionTimeoutMinutes": 480 },
            "users": [],
            "facilities": [],
            "patients": [],
            "visits": [],
            "soapRecords": [],
            "beds": [],
            "medications": [],
            "pharmacyOrders": [],
            "labOrders": [],
            "invoices": [],
            "accountingEntries": [],
            "bridgingLogs": [],
            "auditLogs": [],
            "roles": [],
            "facilityConfigs": [],
            "evidenceRegistry": [],
            "medicationMutations": [],
            "purchaseOrders": [],
            "radiologyOrders": [],
            "surgicalSchedules": [],
            "referrals": [],
            "doubleEntryJournals": [],
            "idempotencyRecords": [],
            "attendance": [],
            "leaveRequests": [],
            "payrollRuns": [],
            "inpatientNotes": [],
            "soapRevisions": []
        })
    }

    #[test]
    fn backup_and_restore_enforce_private_perms_fresh_parent_and_active_lock() {
        let root = std::env::temp_dir().join(format!("kael-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let active_db = root.join("active.sqlite");
        Storage::create(&active_db, &sample_db()).unwrap();
        let (store, _) = Storage::load(&active_db).unwrap();

        let backup_path = root.join("backups/snap.sqlite");
        store.backup_to(&backup_path).unwrap();
        assert!(backup_path.is_file());
        #[cfg(unix)]
        {
            let mode = fs::metadata(&backup_path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }

        // Reject same-path backup
        assert!(store.backup_to(&active_db).is_err());

        // Reject restore while active server holds lock
        assert!(Storage::verify_and_restore(&backup_path, &active_db).is_err());

        drop(store);

        // Restore to fresh nested parent after shutdown
        let fresh_target = root.join("new_dir/nested/restored.sqlite");
        Storage::verify_and_restore(&backup_path, &fresh_target).unwrap();
        assert!(fresh_target.is_file());
        #[cfg(unix)]
        {
            let mode = fs::metadata(&fresh_target).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let _ = fs::remove_dir_all(&root);
    }
}
