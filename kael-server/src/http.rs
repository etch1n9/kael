use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use std::cell::{Cell, RefCell};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Component, Path};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;
use uuid::Uuid;

use crate::bootstrap::{hash_password, verify_password};
use crate::config::Config;
use crate::domain::{default_facility_config, normalize_facility};
use crate::storage::Storage;

pub struct App {
    #[allow(dead_code)]
    pub config: Config,
    pub store: Storage,
    pub db: Value,
    pub sessions: HashMap<String, Session>,
    pub sessions_digest: u64,
    pub login_failures: HashMap<String, LoginAttempt>,
}

pub struct Shared {
    pub app: Mutex<App>,
    pub config: Config,
}

#[derive(Clone)]
pub struct LoginAttempt {
    pub count: u8,
    pub window_start: i64,
    pub locked_until: i64,
}

#[derive(Clone)]
pub struct Session {
    pub user_id: String,
    pub facility_code: String,
    pub expires_at: i64,
}

pub struct RequestContext {
    pub user: Value,
    pub facility_code: String,
    pub token: String,
}

pub struct ApiResponse {
    pub status: u16,
    pub body: Option<Value>,
}

#[derive(Debug)]
pub struct ApiError {
    pub status: u16,
    pub message: String,
}

pub type ApiResult = Result<ApiResponse, ApiError>;

pub fn json_response(status: u16, body: Value) -> ApiResult {
    Ok(ApiResponse {
        status,
        body: Some(body),
    })
}
pub fn no_content() -> ApiResult {
    Ok(ApiResponse {
        status: 204,
        body: None,
    })
}
pub fn error(status: u16, message: impl Into<String>) -> ApiError {
    ApiError {
        status,
        message: message.into(),
    }
}
pub fn bad_request(message: impl Into<String>) -> ApiError {
    error(400, message)
}
pub fn forbidden(message: impl Into<String>) -> ApiError {
    error(403, message)
}
pub fn not_found(message: impl Into<String>) -> ApiError {
    error(404, message)
}
pub fn conflict(message: impl Into<String>) -> ApiError {
    error(409, message)
}
pub fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
pub fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}
pub fn id(prefix: &str) -> String {
    format!("{prefix}-{}", Uuid::new_v4())
}

pub fn next_document(rows: &[Value], field: &str, prefix: &str) -> u32 {
    rows.iter()
        .filter_map(|row| text(row, field).strip_prefix(prefix)?.parse::<u32>().ok())
        .max()
        .unwrap_or(0)
        .saturating_add(1)
}

static EMPTY_ROWS: LazyLock<Vec<Value>> = LazyLock::new(Vec::new);
static LOGIN_PERMITS: LazyLock<tokio::sync::Semaphore> = LazyLock::new(|| tokio::sync::Semaphore::new(2));
thread_local! {
    static DB_DIRTY: Cell<bool> = const { Cell::new(false) };
    static DIRTY_COLLECTIONS: RefCell<HashSet<String>> = RefCell::new(HashSet::new());
}
fn take_dirty() -> bool {
    DIRTY_COLLECTIONS.with(|set| set.borrow_mut().clear());
    DB_DIRTY.with(|flag| flag.replace(false))
}
fn take_dirty_collections() -> HashSet<String> {
    DB_DIRTY.with(|flag| flag.set(false));
    DIRTY_COLLECTIONS.with(|set| std::mem::take(&mut *set.borrow_mut()))
}
static DUMMY_HASH: LazyLock<String> = LazyLock::new(|| {
    hash_password("kael-login-dummy").unwrap_or_default()
});
pub fn array<'a>(value: &'a Value, key: &str) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or(&EMPTY_ROWS)
}
pub fn array_mut<'a>(value: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
    DB_DIRTY.with(|flag| flag.set(true));
    DIRTY_COLLECTIONS.with(|set| {
        set.borrow_mut().insert(key.to_owned());
    });
    if !value.is_object() {
        *value = json!({});
    }
    if !value.get(key).is_some_and(Value::is_array) {
        value[key] = json!([]);
    }
    value[key]
        .as_array_mut()
        .expect("Daftar database sudah dinormalisasi")
}

pub fn effective_modules(db: &Value, user: &Value, facility: &str) -> Vec<String> {
    if !user["active"].as_bool().unwrap_or(false) || !text(user, "deletedAt").is_empty() {
        return vec![];
    }
    let role = effective_role(user, facility);
    array(db, "roles")
        .iter()
        .find(|entry| text(entry, "id") == role && entry["active"] == true)
        .map(|entry| {
            array(entry, "modules")
                .iter()
                .filter_map(Value::as_str)
                .filter(|module| {
                    *module != "SUPERUSER_CONTROL" || text(user, "role") == "SUPERUSER"
                })
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub fn effective_role<'a>(user: &'a Value, facility: &str) -> &'a str {
    if text(user, "role") == "SUPERUSER" {
        return "SUPERUSER";
    }
    user.get("facilityRoles")
        .and_then(|roles| roles.get(facility))
        .and_then(Value::as_str)
        .unwrap_or(text(user, "role"))
}

pub fn allows(app: &App, user: &Value, facility: &str, module: &str) -> bool {
    effective_modules(&app.db, user, facility)
        .iter()
        .any(|entry| entry == module)
}

pub fn can_access_facility(user: &Value, facility: &str) -> bool {
    if facility.is_empty() || user["active"] != true || !text(user, "deletedAt").is_empty() {
        return false;
    }
    text(user, "role") == "SUPERUSER"
        || array(user, "allowedFacilities")
            .iter()
            .filter_map(Value::as_str)
            .any(|code| code == "*" || normalize_facility(code) == facility)
}

pub fn is_practitioner(app: &App, user: &Value, facility: &str) -> bool {
    user["isPractitioner"] == true
        && can_access_facility(user, facility)
        && allows(app, user, facility, "RME_DOKTER")
}

pub fn sanitize_user(db: &Value, user: &Value, facility: &str) -> Value {
    let mut sanitized = user.clone();
    if let Some(object) = sanitized.as_object_mut() {
        object.remove("passwordHash");
    }
    let role = effective_role(user, facility);
    sanitized["roleName"] = json!(
        array(db, "roles")
            .iter()
            .find(|entry| text(entry, "id") == role)
            .map(|entry| text(entry, "name"))
            .unwrap_or(role)
    );
    let modules = effective_modules(db, user, facility);
    sanitized["isPractitioner"] = json!(user["isPractitioner"] == true);
    sanitized["resolvedModules"] = json!(modules);
    sanitized["customPrivileges"] = sanitized["resolvedModules"].clone();
    sanitized
}

pub fn active_config(db: &Value, facility: &Value) -> Value {
    array(db, "facilityConfigs")
        .iter()
        .find(|entry| {
            text(entry, "facilityCode") == text(facility, "code")
                && text(entry, "lifecycleStage") == "ACTIVE"
        })
        .cloned()
        .unwrap_or_else(|| default_facility_config(facility, "SYSTEM"))
}

pub fn require_service(
    app: &App,
    context: &RequestContext,
    modules: &[&str],
    capabilities: &[&str],
) -> Result<(), ApiError> {
    let facility = array(&app.db, "facilities")
        .iter()
        .find(|entry| text(entry, "code") == context.facility_code && entry["active"] == true)
        .ok_or_else(|| forbidden("Pilih fasilitas aktif sebelum mengakses layanan operasional."))?;
    let config = active_config(&app.db, facility);
    if !modules
        .iter()
        .any(|module| allows(app, &context.user, &context.facility_code, module))
        || (!capabilities.is_empty()
            && !capabilities.iter().any(|capability| {
                array(&config, "enabledSubCapabilities")
                    .iter()
                    .any(|entry| entry.as_str() == Some(capability))
            }))
    {
        return Err(forbidden(
            "Peran atau konfigurasi fasilitas tidak mengizinkan layanan ini.",
        ));
    }
    Ok(())
}

pub fn require_superuser(context: &RequestContext) -> Result<(), ApiError> {
    if text(&context.user, "role") != "SUPERUSER" {
        return Err(forbidden("Operasi ini hanya diizinkan untuk Superuser."));
    }
    Ok(())
}

pub fn audit(app: &mut App, context: &RequestContext, action: &str, target: &str, details: &str) {
    let entry = json!({"id":id("aud"),"timestamp":now(),"facilityCode":context.facility_code,
        "actorUsername":text(&context.user,"username"),"actorRole":text(&context.user,"role"),
        "action":action,"targetResource":target,"details":details});
    let rows = array_mut(&mut app.db, "auditLogs");
    rows.push(entry);
}

fn cap_sessions(app: &mut App) {
    let now = Utc::now().timestamp_millis();
    app.sessions.retain(|_, session| session.expires_at > now);
    let mut grouped: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (token, session) in &app.sessions {
        grouped.entry(session.user_id.clone()).or_default().push((token.clone(), session.expires_at));
    }
    for entries in grouped.values_mut() {
        if entries.len() <= 5 {
            continue;
        }
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.1));
        for (token, _) in entries.iter().skip(5) {
            app.sessions.remove(token);
        }
    }
}

fn prune_runtime_collections(app: &mut App) {
    let cutoff = (Utc::now() - chrono::Duration::days(30)).to_rfc3339();
    let idem_rows = array_mut(&mut app.db, "idempotencyRecords");
    idem_rows.retain(|row| {
        let ts = text(row, "createdAt");
        ts.is_empty() || ts >= cutoff.as_str()
    });
}

pub fn save(app: &mut App) -> Result<(), ApiError> {
    cap_sessions(app);
    prune_runtime_collections(app);
    let dirty_collections = take_dirty_collections();
    let digest = sessions_digest(&app.sessions);
    let packed: HashMap<String, (String, String, i64)> = app
        .sessions
        .iter()
        .map(|(token, session)| {
            (
                token.clone(),
                (
                    session.user_id.clone(),
                    session.facility_code.clone(),
                    session.expires_at,
                ),
            )
        })
        .collect();
    let saved = if digest == app.sessions_digest {
        app.store.save_dirty(&app.db, Some(&dirty_collections))
    } else {
        app.store.save_all_dirty(&app.db, &packed, Some(&dirty_collections))
    };
    if let Err(message) = saved {
        let loaded = app.store.reload();
        if let Ok(value) = loaded {
            app.db = value;
        }
        let _ = take_dirty();
        eprintln!("KAEL gagal menyimpan database: {message}");
        return Err(error(500, "Permintaan gagal disimpan server."));
    }
    app.sessions_digest = digest;
    let _ = take_dirty();
    Ok(())
}

pub fn sessions_digest(sessions: &HashMap<String, Session>) -> u64 {
    let mut tokens: Vec<_> = sessions.iter().collect();
    tokens.sort_by(|left, right| left.0.cmp(right.0));
    let mut hasher = DefaultHasher::new();
    for (token, session) in tokens {
        token.hash(&mut hasher);
        session.user_id.hash(&mut hasher);
        session.facility_code.hash(&mut hasher);
        session.expires_at.hash(&mut hasher);
    }
    let digest = hasher.finish();
    if digest == 0 { 1 } else { digest }
}

pub fn revoke_sessions(app: &mut App, user_id: &str) {
    app.sessions.retain(|_, session| session.user_id != user_id);
}

fn authorize(app: &mut App, headers: &HeaderMap, path: &str) -> Result<RequestContext, ApiError> {
    let token = headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or("")
        .trim()
        .to_owned();
    let expired = error(
        401,
        "Sesi tidak valid atau telah berakhir. Silakan login kembali.",
    );
    let session = app.sessions.get(&token).cloned().ok_or(expired)?;
    if Utc::now().timestamp_millis() >= session.expires_at {
        app.sessions.remove(&token);
        let _ = app.store.delete_session(&token);
        return Err(error(
            401,
            "Sesi tidak valid atau telah berakhir. Silakan login kembali.",
        ));
    }
    let user = array(&app.db, "users")
        .iter()
        .find(|entry| {
            text(entry, "id") == session.user_id
                && entry["active"] == true
                && text(entry, "deletedAt").is_empty()
        })
        .cloned()
        .ok_or_else(|| {
            error(
                401,
                "Akun pengguna tidak aktif atau telah dicabut oleh Superuser.",
            )
        })?;
    let mut facility_code = headers
        .get("x-kael-facility")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty())
        .map(normalize_facility)
        .unwrap_or(session.facility_code);
    if text(&user, "role") == "SUPERUSER"
        && !facility_code.is_empty()
        && !array(&app.db, "facilities")
            .iter()
            .any(|entry| text(entry, "code") == facility_code && entry["active"] == true)
    {
        facility_code.clear();
        if let Some(session) = app.sessions.get_mut(&token) {
            session.facility_code.clear();
        }
    }
    let role = effective_role(&user, &facility_code);
    if !array(&app.db, "roles")
        .iter()
        .any(|entry| text(entry, "id") == role && entry["active"] == true)
    {
        app.sessions.remove(&token);
        return Err(forbidden(
            "Peran akun dinonaktifkan atau tidak lagi tersedia. Hubungi Superuser.",
        ));
    }
    if facility_code.is_empty() && text(&user, "role") == "SUPERUSER" {
        if !(path == "/api/workspace"
            || path == "/api/search"
            || path == "/api/records"
            || path == "/api/admin/export-backup"
            || path == "/api/auth/logout"
            || path == "/api/auth/switch-facility"
            || path.starts_with("/api/superuser/"))
        {
            return Err(forbidden(
                "Pilih fasilitas aktif sebelum mengakses layanan operasional.",
            ));
        }
    } else if !can_access_facility(&user, &facility_code)
        || !array(&app.db, "facilities")
            .iter()
            .any(|entry| text(entry, "code") == facility_code && entry["active"] == true)
    {
        return Err(forbidden(
            "Akun tidak memiliki otorisasi untuk fasilitas yang dipilih.",
        ));
    }
    Ok(RequestContext {
        user,
        facility_code,
        token,
    })
}

fn login(app: &mut App, body: &Value) -> ApiResult {
    let prep = login_prepare(app, body, "local")?;
    let ok = verify_password(&prep.password, &prep.hash);
    login_commit(app, body, &prep, ok)
}

struct LoginPrep {
    key: String,
    ip_key: String,
    username: String,
    password: String,
    hash: String,
    found: bool,
}

fn login_prepare(app: &mut App, body: &Value, ip: &str) -> Result<LoginPrep, ApiError> {
    let username = text(body, "username").trim().to_lowercase();
    let password = text(body, "password");
    if username.is_empty()
        || password.is_empty()
        || password.chars().count() > 512
        || body.get("facilityCode").is_some_and(|value| !value.is_string())
    {
        return Err(bad_request("Username dan kata sandi wajib diisi."));
    }
    let normalized_ip = ip.trim();
    let key = format!("{username}@{normalized_ip}");
    let ip_key = format!("ip:{normalized_ip}");
    let now_ms = Utc::now().timestamp_millis();
    for check_key in [&key, &ip_key] {
        if let Some(attempt) = app.login_failures.get(check_key) {
            if attempt.locked_until > now_ms {
                return Err(error(
                    429,
                    "Terlalu banyak percobaan login. Coba lagi dalam 15 menit.",
                ));
            }
        }
    }
    let found = array(&app.db, "users").iter().position(|user| {
        text(user, "username").to_lowercase() == username
            || text(user, "nipOrSip").to_lowercase() == username
    });
    let hash = found
        .map(|index| text(&app.db["users"][index], "passwordHash").to_owned())
        .filter(|hash| hash.starts_with("scrypt:"))
        .unwrap_or_else(|| DUMMY_HASH.clone());
    Ok(LoginPrep {
        key,
        ip_key,
        username,
        password: password.to_owned(),
        hash,
        found: found.is_some(),
    })
}

fn note_login_failure_with_limit(app: &mut App, key: &str, max_attempts: u8) {
    let now_ms = Utc::now().timestamp_millis();
    app.login_failures.retain(|_, attempt| attempt.locked_until > now_ms || now_ms - attempt.window_start < 15 * 60 * 1000);
    if app.login_failures.len() >= 4096 && !app.login_failures.contains_key(key) {
        return;
    }
    let attempt = app.login_failures.entry(key.to_owned()).or_insert(LoginAttempt {
        count: 0,
        window_start: now_ms,
        locked_until: 0,
    });
    if now_ms - attempt.window_start > 5 * 60 * 1000 {
        attempt.count = 0;
        attempt.window_start = now_ms;
    }
    attempt.count += 1;
    if attempt.count >= max_attempts {
        attempt.locked_until = now_ms + 15 * 60 * 1000;
        attempt.count = 0;
        attempt.window_start = now_ms;
    }
}

fn note_login_failure(app: &mut App, key: &str) {
    note_login_failure_with_limit(app, key, 5);
}

fn login_commit(app: &mut App, body: &Value, prep: &LoginPrep, password_ok: bool) -> ApiResult {
    if !prep.found || !password_ok {
        note_login_failure(app, &prep.key);
        note_login_failure_with_limit(app, &prep.ip_key, 20);
        return Err(login_denied());
    }
    app.login_failures.remove(&prep.key);
    let username = prep.username.as_str();
    let index = array(&app.db, "users")
        .iter()
        .position(|user| {
            text(user, "username").to_lowercase() == username
                || text(user, "nipOrSip").to_lowercase() == username
        })
        .ok_or_else(login_denied)?;
    let user = app.db["users"][index].clone();
    if user["active"] != true
        || !text(&user, "deletedAt").is_empty()
        || text(&user, "passwordHash") != prep.hash
    {
        note_login_failure(app, &prep.key);
        return Err(login_denied());
    }
    let facility_code = normalize_facility(text(body, "facilityCode"));
    let facility = array(&app.db, "facilities")
        .iter()
        .find(|entry| text(entry, "code") == facility_code && entry["active"] == true)
        .cloned()
        .unwrap_or(Value::Null);
    if (facility_code.is_empty() && text(&user, "role") != "SUPERUSER")
        || (!facility_code.is_empty() && facility.is_null())
        || (!facility.is_null() && !can_access_facility(&user, &facility_code))
    {
        return Err(login_denied());
    }
    let role = effective_role(&user, &facility_code);
    if !array(&app.db, "roles")
        .iter()
        .any(|entry| text(entry, "id") == role && entry["active"] == true)
    {
        return Err(login_denied());
    }
    let remember = body["rememberMe"] == true;
    let configured = app.db["serverConfig"]["sessionTimeoutMinutes"]
        .as_i64()
        .filter(|value| *value > 0)
        .unwrap_or(480)
        .min(1440);
    let expires_at = Utc::now().timestamp_millis() + configured * 60_000;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    app.db["users"][index]["lastLoginAt"] = json!(now());
    let context = RequestContext {
        user: user.clone(),
        facility_code: facility_code.clone(),
        token: token.clone(),
    };
    audit(
        app,
        &context,
        "AUTH_LOGIN_SUCCESS",
        if facility.is_null() {
            "ADMINISTRASI_SERVER"
        } else {
            &facility_code
        },
        "Login berhasil.",
    );
    app.sessions.insert(
        token.clone(),
        Session {
            user_id: text(&user, "id").into(),
            facility_code: facility_code.clone(),
            expires_at,
        },
    );
    save(app)?;
    let accessible: Vec<Value> = array(&app.db, "facilities")
        .iter()
        .filter(|entry| entry["active"] == true && can_access_facility(&user, text(entry, "code")))
        .cloned()
        .collect();
    json_response(
        200,
        json!({"token":token,"user":sanitize_user(&app.db,&app.db["users"][index],&facility_code),
        "activeFacility":facility,"accessibleFacilities":accessible,"expiresAt":expires_at,"rememberMe":remember}),
    )
}

fn login_denied() -> ApiError {
    error(
        401,
        "Login gagal. Periksa kredensial dan kode fasilitas Anda.",
    )
}

struct QueryWindow {
    limit: usize,
    from: String,
    to: String,
    q: String,
    patient_id: String,
}

fn query_unescape(value: &str) -> String {
    let plus = value.replace('+', " ");
    decode_path(&plus).unwrap_or(plus)
}

fn query_window(query: &str) -> QueryWindow {
    let mut window = QueryWindow {
        limit: 500,
        from: String::new(),
        to: String::new(),
        q: String::new(),
        patient_id: String::new(),
    };
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let mut parts = pair.splitn(2, '=');
        let key = query_unescape(parts.next().unwrap_or(""));
        let value = query_unescape(parts.next().unwrap_or("").trim());
        match key.as_str() {
            "limit" => window.limit = value.parse::<usize>().unwrap_or(500).clamp(1, 500),
            "from" => window.from = value,
            "to" => window.to = value,
            "q" => window.q = value,
            "patientId" => window.patient_id = value,
            _ => {}
        }
    }
    window
}

fn in_window(entry: &Value, from: &str, to: &str) -> bool {
    let stamp = ["createdAt", "timestamp", "recordedAt", "publishedAt", "orderDate", "updatedAt"]
        .iter()
        .map(|key| text(entry, key))
        .find(|value| !value.is_empty())
        .unwrap_or("");
    if stamp.is_empty() {
        return true;
    }
    (from.is_empty() || stamp >= from || stamp.starts_with(from))
        && (to.is_empty() || stamp <= to || stamp.starts_with(to))
}

fn stamp_str(entry: &Value) -> &str {
    for key in ["createdAt", "timestamp", "recordedAt", "publishedAt", "orderDate", "updatedAt"] {
        let val = text(entry, key);
        if !val.is_empty() {
            return val;
        }
    }
    ""
}

fn stamp_of(entry: &Value) -> String {
    stamp_str(entry).to_owned()
}

fn present_refs(mut rows: Vec<&Value>, limit: usize) -> Vec<Value> {
    let terminal = |row: &Value| {
        matches!(
            text(row, "status"),
            "SELESAI" | "BATAL" | "LUNAS" | "KLAIM_DISETUJUI"
        )
    };
    let cmp = |left: &&Value, right: &&Value| {
        terminal(left)
            .cmp(&terminal(right))
            .then_with(|| stamp_str(right).cmp(stamp_str(left)))
            .then_with(|| text(right, "id").cmp(text(left, "id")))
    };
    if rows.len() > limit {
        rows.select_nth_unstable_by(limit, cmp);
        rows.truncate(limit);
    }
    rows.sort_by(cmp);
    rows.into_iter().cloned().collect()
}

fn contains_ignore_ascii_case(haystack: &str, needle_lower: &str) -> bool {
    if needle_lower.is_empty() {
        return true;
    }
    if haystack.len() < needle_lower.len() {
        return false;
    }
    if haystack.is_ascii() && needle_lower.is_ascii() {
        let needle_bytes = needle_lower.as_bytes();
        haystack
            .as_bytes()
            .windows(needle_bytes.len())
            .any(|window| window.eq_ignore_ascii_case(needle_bytes))
    } else {
        haystack.to_lowercase().contains(needle_lower)
    }
}

fn workspace(app: &App, context: &RequestContext, query: &str) -> Value {
    let window = query_window(query);
    let limit = window.limit;
    let from = window.from.as_str();
    let to = window.to.as_str();
    let patient_filter = window.patient_id.as_str();
    let user = &context.user;
    let code = &context.facility_code;
    let superuser = text(user, "role") == "SUPERUSER";
    let facility = array(&app.db, "facilities")
        .iter()
        .find(|entry| text(entry, "code") == code)
        .cloned()
        .unwrap_or(Value::Null);
    let accessible: Vec<Value> = array(&app.db, "facilities")
        .iter()
        .filter(|entry| entry["active"] == true && can_access_facility(user, text(entry, "code")))
        .cloned()
        .collect();
    let has_any = |modules: &[&str]| modules.iter().any(|module| allows(app, user, code, module));
    let patient_access = has_any(&[
        "SEMUA_PASIEN",
        "PENDAFTARAN",
        "RME_DOKTER",
        "RAWAT_INAP",
        "IGD_TRIASE_EWS",
        "LABORATORIUM",
        "RADIOLOGI_RIS",
        "KASIR_AKUNTANSI",
        "KIA_IMUNISASI",
        "GIGI_ODONTOGRAM",
        "PROLANIS_PRB",
        "BEDAH_IBS",
        "MCU_SURAT_MEDIS",
    ]);
    let visit_access = patient_access || has_any(&["JADWAL_DOKTER", "APOTEK"]);
    let can_read_visits_at = |facility: &str| {
        [
            "SEMUA_PASIEN",
            "PENDAFTARAN",
            "RME_DOKTER",
            "RAWAT_INAP",
            "IGD_TRIASE_EWS",
            "LABORATORIUM",
            "RADIOLOGI_RIS",
            "KASIR_AKUNTANSI",
            "KIA_IMUNISASI",
            "GIGI_ODONTOGRAM",
            "PROLANIS_PRB",
            "BEDAH_IBS",
            "MCU_SURAT_MEDIS",
            "JADWAL_DOKTER",
            "APOTEK",
        ]
        .iter()
        .any(|module| allows(app, user, facility, module))
    };
    let finance = has_any(&[
        "KASIR_AKUNTANSI",
        "KEUANGAN_OWNER",
        "NERACA_GL",
        "KLAIM_BPJS_PIUTANG",
        "JASA_MEDIS_REMUN",
    ]);
    let clinical = has_any(&["RME_DOKTER", "SEMUA_PASIEN"]);
    let doctors_access = visit_access
        || has_any(&[
            "SDM_ERP",
            "SDM_JADWAL",
            "JASA_MEDIS_REMUN",
            "KEUANGAN_OWNER",
        ]);
    let staff_access = superuser || has_any(&["SDM_ERP", "SDM_JADWAL", "JASA_MEDIS_REMUN"]);
    let referrals_access = has_any(&["RME_DOKTER", "BRIDGING_SATUSEHAT"]);
    let collection_access = |key: &str| -> bool {
        match key {
            "patients" => patient_access,
            "visits" => visit_access,
            "soapRecords" => clinical,
            "beds" => has_any(&["RAWAT_INAP"]),
            "medications" => has_any(&[
                "APOTEK",
                "KATALOG_OPNAME",
                "MUTASI_STOK",
                "PENGADAAN_PBF",
                "RME_DOKTER",
                "KEUANGAN_OWNER",
                "NERACA_GL",
            ]),
            "medicationMutations" => {
                has_any(&["APOTEK", "KATALOG_OPNAME", "MUTASI_STOK", "PENGADAAN_PBF"])
            }
            "pharmacyOrders" => has_any(&["APOTEK", "RME_DOKTER"]),
            "purchaseOrders" => has_any(&["PENGADAAN_PBF", "KEUANGAN_OWNER", "NERACA_GL"]),
            "labOrders" => has_any(&["LABORATORIUM", "RME_DOKTER"]),
            "radiologyOrders" => has_any(&["RADIOLOGI_RIS", "RME_DOKTER"]),
            "surgicalSchedules" => has_any(&["BEDAH_IBS", "RME_DOKTER"]),
            "invoices" | "accountingEntries" | "doubleEntryJournals" => finance,
            "bridgingLogs" => has_any(&["BRIDGING_SATUSEHAT"]),
            "evidenceRegistry" => superuser || has_any(&["LAPORAN_REGULASI"]),
            "facilityConfigs" => superuser,
            _ => false,
        }
    };
    let scoped = |key: &str| -> Vec<Value> {
        if code.is_empty() || !collection_access(key) {
            return vec![];
        }
        present_refs(
            array(&app.db, key)
                .iter()
                .filter(|entry| {
                    if text(entry, "facilityCode") != code.as_str() || !in_window(entry, from, to) {
                        return false;
                    }
                    if !patient_filter.is_empty()
                        && text(entry, "id") != patient_filter
                        && text(entry, "patientId") != patient_filter
                        && text(entry, "visitId") != patient_filter
                    {
                        return false;
                    }
                    true
                })
                .collect(),
            limit,
        )
    };
    let compute_finance_summary = |facility_codes: &[&str]| -> Value {
        let mut total_revenue = 0.0_f64;
        let mut total_expense = 0.0_f64;
        let mut rev_by_cat: HashMap<String, f64> = HashMap::new();
        let mut exp_by_cat: HashMap<String, f64> = HashMap::new();
        let mut entries_count = 0usize;
        for entry in array(&app.db, "accountingEntries") {
            let fac = text(entry, "facilityCode");
            if !facility_codes.contains(&fac) || !in_window(entry, from, to) {
                continue;
            }
            entries_count += 1;
            let amt = entry["amount"].as_f64().unwrap_or(0.0);
            if !amt.is_finite() {
                continue;
            }
            let cat = text(entry, "category").to_owned();
            match text(entry, "type") {
                "PENDAPATAN" => {
                    total_revenue += amt;
                    *rev_by_cat.entry(cat).or_default() += amt;
                }
                "PENGELUARAN" | "BEBAN" => {
                    total_expense += amt;
                    *exp_by_cat.entry(cat).or_default() += amt;
                }
                _ => {}
            }
        }
        let mut pending_bpjs = 0.0_f64;
        let mut unpaid_patient = 0.0_f64;
        let mut invoices_count = 0usize;
        let mut aging_buckets = [0.0_f64; 4];
        let ref_date = Utc::now().date_naive();
        for inv in array(&app.db, "invoices") {
            let fac = text(inv, "facilityCode");
            if !facility_codes.contains(&fac) || !in_window(inv, from, to) {
                continue;
            }
            invoices_count += 1;
            if text(inv, "pricingStatus") == "PENDING" {
                continue;
            }
            let st = text(inv, "status");
            if !matches!(
                st,
                "BELUM_LUNAS" | "KLAIM_DIAJUKAN" | "KLAIM_PENDING_DISPUTE" | "KLAIM_DISETUJUI"
            ) {
                continue;
            }
            let net = (inv["subtotal"].as_f64().unwrap_or(0.0)
                - inv["discountAmount"].as_f64().unwrap_or(0.0)
                - inv["depositAppliedAmount"].as_f64().unwrap_or(0.0))
            .max(0.0);
            let received = inv["totalReceivedAmount"].as_f64().unwrap_or(0.0);
            let adjustment = inv["claimAdjustment"].as_f64().unwrap_or(0.0);
            let is_bpjs = text(inv, "guarantorSettlement") == "BPJS"
                || text(inv, "guarantor") == "BPJS_KESEHATAN"
                || text(inv, "guarantor").starts_with("BPJS");
            let obligation = if is_bpjs {
                let claim = inv["claimRequestedAmount"].as_f64().unwrap_or(0.0);
                if claim > 0.0 { claim } else { net }
            } else {
                let due = inv["patientPayableAmount"].as_f64().unwrap_or(0.0);
                if due > 0.0 { due } else { net }
            };
            let outstanding = (obligation - received - adjustment).round().max(0.0);
            if st == "KLAIM_DIAJUKAN" {
                pending_bpjs += outstanding;
            } else if st == "BELUM_LUNAS" {
                unpaid_patient += outstanding;
            }
            if outstanding > 0.0 {
                let created_str = text(inv, "createdAt");
                let age_days = created_str
                    .get(..10)
                    .and_then(|d| chrono::NaiveDate::parse_from_str(d, "%Y-%m-%d").ok())
                    .map(|d| (ref_date - d).num_days().max(0))
                    .unwrap_or(0);
                let idx = if age_days <= 30 {
                    0
                } else if age_days <= 60 {
                    1
                } else if age_days <= 90 {
                    2
                } else {
                    3
                };
                aging_buckets[idx] += outstanding;
            }
        }
        let net_profit = total_revenue - total_expense;
        let margin = if total_revenue > 0.0 {
            ((net_profit / total_revenue) * 1000.0).round() / 10.0
        } else {
            0.0
        };
        json!({
            "totalRevenue": total_revenue,
            "totalExpense": total_expense,
            "netProfit": net_profit,
            "profitMarginPercent": margin,
            "pendingBpjsClaims": pending_bpjs,
            "unpaidPatientReceivables": unpaid_patient,
            "revenueByCategory": rev_by_cat,
            "expenseByCategory": exp_by_cat,
            "receivableAging": {
                "bucket0to30": aging_buckets[0],
                "bucket31to60": aging_buckets[1],
                "bucket61to90": aging_buckets[2],
                "bucketOver90": aging_buckets[3],
                "totalReceivables": aging_buckets.iter().sum::<f64>(),
            },
            "totalEntriesCount": entries_count,
            "totalInvoicesCount": invoices_count,
        })
    };
    let visible_users: Vec<Value> = array(&app.db, "users")
        .iter()
        .filter(|entry| {
            staff_access
                && text(entry, "deletedAt").is_empty()
                && (superuser
                    || accessible
                        .iter()
                        .any(|facility| can_access_facility(entry, text(facility, "code"))))
        })
        .map(|entry| sanitize_user(&app.db, entry, code))
        .collect();
    let mut config = app.db["serverConfig"].clone();
    if !superuser {
        config["storagePath"] = json!("");
    }
    let facility_history = if superuser {
        array(&app.db, "facilityConfigs").clone()
    } else {
        Vec::new()
    };
    let mut result = json!({"user":sanitize_user(&app.db,user,code),"roles":app.db["roles"],"activeFacility":facility,
        "facilityConfigHistory":facility_history,"evidenceRegistry":scoped("evidenceRegistry"),
        "accessibleFacilities":accessible,"doctors":array(&app.db,"users").iter().filter(|entry| doctors_access && is_practitioner(app,entry,code)).map(|entry| sanitize_user(&app.db,entry,code)).collect::<Vec<_>>(),
        "patients":scoped("patients"),"visits":scoped("visits"),"soapRecords":if clinical {scoped("soapRecords")} else {vec![]},
        "beds":scoped("beds"),"medications":scoped("medications"),"medicationMutations":scoped("medicationMutations"),
        "pharmacyOrders":scoped("pharmacyOrders"),"purchaseOrders":scoped("purchaseOrders"),"labOrders":scoped("labOrders"),
        "radiologyOrders":scoped("radiologyOrders"),"surgicalSchedules":scoped("surgicalSchedules"),
        "referrals":present_refs(array(&app.db,"referrals").iter().filter(|entry| referrals_access && !code.is_empty() && (text(entry,"originFacilityCode") == code || text(entry,"destinationFacilityCode") == code) && in_window(entry, from, to)).collect(), limit),
        "invoices":if finance {scoped("invoices")} else {vec![]},"accountingEntries":if finance {scoped("accountingEntries")} else {vec![]},
        "doubleEntryJournals":if finance {scoped("doubleEntryJournals")} else {vec![]},"bridgingLogs":scoped("bridgingLogs"),
        "auditLogs":if superuser {present_refs(array(&app.db,"auditLogs").iter().filter(|entry| in_window(entry, from, to)).collect(), limit)} else {vec![]},"allUsers":visible_users,
        "deletedUsers":if superuser {array(&app.db,"users").iter().filter(|entry| !text(entry,"deletedAt").is_empty()).map(|entry| sanitize_user(&app.db,entry,code)).collect::<Vec<_>>()} else {vec![]},
        "allFacilities":if superuser {array(&app.db,"facilities").clone()} else {accessible.clone()},"serverConfig":config});
    let mut data_access = serde_json::Map::new();
    for key in [
        "patients",
        "visits",
        "soapRecords",
        "beds",
        "medications",
        "medicationMutations",
        "pharmacyOrders",
        "purchaseOrders",
        "labOrders",
        "radiologyOrders",
        "surgicalSchedules",
        "invoices",
        "accountingEntries",
        "doubleEntryJournals",
        "bridgingLogs",
        "evidenceRegistry",
    ] {
        data_access.insert(
            key.into(),
            json!(!code.is_empty() && collection_access(key)),
        );
    }
    data_access.insert(
        "referrals".into(),
        json!(!code.is_empty() && referrals_access),
    );
    data_access.insert("doctors".into(), json!(!code.is_empty() && doctors_access));
    data_access.insert("allUsers".into(), json!(staff_access));
    result["dataAccess"] = Value::Object(data_access);
    if !facility.is_null() {
        result["activeFacilityConfig"] = active_config(&app.db, &facility);
    }
    if !facility.is_null() && finance {
        result["financeSummary"] = compute_finance_summary(&[code.as_str()]);
    }
    if !facility.is_null() && allows(app, user, code, "KEUANGAN_OWNER") {
        let codes: Vec<&str> = accessible
            .iter()
            .map(|entry| text(entry, "code"))
            .filter(|code| allows(app, user, code, "KEUANGAN_OWNER"))
            .collect();
        for key in ["accountingEntries", "invoices", "visits", "medications", "medicationMutations", "purchaseOrders", "doubleEntryJournals"] {
            result["multiFacilityFinance"][key] = json!(present_refs(
                array(&app.db, key)
                    .iter()
                    .filter(|entry| codes.contains(&text(entry, "facilityCode"))
                        && (key != "visits" || can_read_visits_at(text(entry, "facilityCode")))
                        && in_window(entry, from, to))
                    .collect(),
                limit
            ));
        }
        result["multiFacilityFinance"]["summary"] = compute_finance_summary(&codes);
    }
    let payroll_access = superuser || has_any(&["SDM_ERP"]);
    let people_access = superuser || has_any(&["SDM_ERP", "SDM_JADWAL"]);
    for key in ["attendance", "leaveRequests", "payrollRuns"] {
        let allowed = if key == "payrollRuns" { payroll_access } else { people_access };
        result[key] = json!(if allowed {
            present_refs(array(&app.db, key).iter().filter(|entry| (code.is_empty() || text(entry, "facilityCode") == code) && in_window(entry, from, to)).collect(), limit)
        } else {
            Vec::<Value>::new()
        });
    }
    let inpatient_access = !code.is_empty() && has_any(&["RAWAT_INAP"]);
    result["inpatientNotes"] = json!(if inpatient_access {
        present_refs(array(&app.db, "inpatientNotes").iter().filter(|entry| text(entry, "facilityCode") == code.as_str() && in_window(entry, from, to)).collect(), limit)
    } else { Vec::<Value>::new() });
    result["soapRevisions"] = json!(if clinical && !code.is_empty() {
        present_refs(array(&app.db, "soapRevisions").iter().filter(|entry| text(entry, "facilityCode") == code.as_str() && in_window(entry, from, to)).collect(), limit)
    } else { Vec::<Value>::new() });
    if patient_access && !code.is_empty() {
        let mut known: HashSet<String> = result["patients"]
            .as_array()
            .map(|rows| rows.iter().map(|row| text(row, "id").to_owned()).collect())
            .unwrap_or_default();
        let mut missing_ids: HashSet<String> = HashSet::new();
        if let Some(visits) = result["visits"].as_array() {
            for visit in visits {
                let id = text(visit, "patientId");
                if !id.is_empty() && !known.contains(id) {
                    missing_ids.insert(id.to_owned());
                }
            }
        }
        if !missing_ids.is_empty() {
            let mut extra_patients = Vec::new();
            for row in array(&app.db, "patients") {
                let pid = text(row, "id");
                if missing_ids.contains(pid) && text(row, "facilityCode") == code.as_str() {
                    if known.insert(pid.to_owned()) {
                        extra_patients.push(row.clone());
                        if extra_patients.len() >= missing_ids.len() {
                            break;
                        }
                    }
                }
            }
            if let Some(patients) = result.get_mut("patients").and_then(Value::as_array_mut) {
                patients.extend(extra_patients);
            }
        }
    }
    let has_identity_at = |fac: &str| {
        [
            "SEMUA_PASIEN",
            "PENDAFTARAN",
            "RME_DOKTER",
            "RAWAT_INAP",
            "IGD_TRIASE_EWS",
            "LABORATORIUM",
            "RADIOLOGI_RIS",
            "KIA_IMUNISASI",
            "GIGI_ODONTOGRAM",
            "PROLANIS_PRB",
            "BEDAH_IBS",
            "MCU_SURAT_MEDIS",
            "APOTEK",
        ]
        .iter()
        .any(|module| allows(app, user, fac, module))
    };
    let identity = has_identity_at(code);
    if !identity && has_any(&["KASIR_AKUNTANSI", "KLAIM_BPJS_PIUTANG", "KEUANGAN_OWNER", "NERACA_GL", "JASA_MEDIS_REMUN"]) {
        for key in ["patients", "visits"] {
            if let Some(rows) = result.get_mut(key).and_then(Value::as_array_mut) {
                for row in rows {
                    if let Some(object) = row.as_object_mut() {
                        for field in ["nik", "address", "allergies", "chronicConditions", "bpjsNumber", "phone", "emergencyContactName", "emergencyContactPhone", "ihsNumber"] {
                            object.remove(field);
                        }
                        if key == "visits" {
                            object.remove("vitals");
                            object.remove("chiefComplaint");
                        }
                    }
                }
            }
        }
    }
    if let Some(multi) = result.get_mut("multiFacilityFinance").and_then(Value::as_object_mut) {
        if let Some(rows) = multi.get_mut("visits").and_then(Value::as_array_mut) {
            for row in rows {
                let row_fac = text(row, "facilityCode").to_owned();
                if !has_identity_at(&row_fac) {
                    if let Some(object) = row.as_object_mut() {
                        for field in ["nik", "address", "allergies", "chronicConditions", "bpjsNumber", "phone", "emergencyContactName", "emergencyContactPhone", "ihsNumber", "vitals", "chiefComplaint"] {
                            object.remove(field);
                        }
                    }
                }
            }
        }
    }
    if let Some(rows) = result.get_mut("referrals").and_then(Value::as_array_mut) {
        for row in rows {
            let inbound = text(row, "destinationFacilityCode") == code.as_str() && text(row, "originFacilityCode") != code.as_str();
            if inbound {
                if let Some(object) = row.as_object_mut() {
                    object.remove("nik");
                    object.remove("bpjsNumber");
                }
            }
        }
    }
    result
}

fn search_records(app: &App, context: &RequestContext, query: &str) -> Value {
    let window = query_window(query);
    let needle = window.q.trim().to_lowercase();
    if needle.chars().count() < 2 || context.facility_code.is_empty() {
        return json!({"patients":[],"visits":[],"invoices":[]});
    }
    let user = &context.user;
    let code = &context.facility_code;
    let has_any = |modules: &[&str]| modules.iter().any(|module| allows(app, user, code, module));
    let patient_access = has_any(&["SEMUA_PASIEN", "PENDAFTARAN", "RME_DOKTER", "RAWAT_INAP", "IGD_TRIASE_EWS", "LABORATORIUM", "RADIOLOGI_RIS", "KASIR_AKUNTANSI", "KIA_IMUNISASI", "GIGI_ODONTOGRAM", "PROLANIS_PRB", "BEDAH_IBS", "MCU_SURAT_MEDIS"]);
    let visit_access = patient_access || has_any(&["JADWAL_DOKTER", "APOTEK"]);
    let finance = has_any(&["KASIR_AKUNTANSI", "KEUANGAN_OWNER", "NERACA_GL", "KLAIM_BPJS_PIUTANG", "JASA_MEDIS_REMUN"]);
    let identity = has_any(&["SEMUA_PASIEN", "PENDAFTARAN", "RME_DOKTER", "RAWAT_INAP", "IGD_TRIASE_EWS", "LABORATORIUM", "RADIOLOGI_RIS", "KIA_IMUNISASI", "GIGI_ODONTOGRAM", "PROLANIS_PRB", "BEDAH_IBS", "MCU_SURAT_MEDIS", "APOTEK"]);
    let redact = !identity && has_any(&["KASIR_AKUNTANSI", "KLAIM_BPJS_PIUTANG"]);
    let find = |key: &str, allowed: bool, fields: &[&str]| -> Vec<Value> {
        if !allowed {
            return vec![];
        }
        let matched: Vec<&Value> = array(&app.db, key)
            .iter()
            .filter(|row| {
                text(row, "facilityCode") == code.as_str()
                    && fields
                        .iter()
                        .any(|field| contains_ignore_ascii_case(text(row, field), &needle))
            })
            .collect();
        let mut rows = present_refs(matched, 30);
        if redact {
            for row in &mut rows {
                if let Some(object) = row.as_object_mut() {
                    for field in ["nik", "address", "allergies", "chronicConditions", "bpjsNumber", "phone", "emergencyContactName", "emergencyContactPhone", "ihsNumber", "vitals", "chiefComplaint"] {
                        object.remove(field);
                    }
                }
            }
        }
        rows
    };
        let patient_fields: &[&str] = if redact {
            &["fullName", "mrNumber"]
        } else {
            &["fullName", "mrNumber", "nik", "phone", "bpjsNumber"]
        };
        let visit_fields: &[&str] = if redact {
            &["patientName", "mrNumber", "queueNumber", "registrationNumber"]
        } else {
            &["patientName", "mrNumber", "nik", "queueNumber", "registrationNumber"]
        };
        json!({
            "patients": find("patients", patient_access, patient_fields),
            "visits": find("visits", visit_access, visit_fields),
            "invoices": find("invoices", finance, &["patientName", "mrNumber", "invoiceNumber"]),
            "pharmacyOrders": find("pharmacyOrders", has_any(&["APOTEK", "RME_DOKTER"]), &["patientName", "mrNumber"]),
            "labOrders": find("labOrders", has_any(&["LABORATORIUM", "RME_DOKTER"]), &["patientName", "mrNumber", "specimenCode"]),
            "radiologyOrders": find("radiologyOrders", has_any(&["RADIOLOGI_RIS", "RME_DOKTER"]), &["patientName", "mrNumber", "examName", "accessionNumber"])
        })
}

fn record_page(app: &App, context: &RequestContext, query: &str) -> ApiResult {
    let code = context.facility_code.as_str();
    if code.is_empty() {
        return Err(forbidden("Pilih fasilitas aktif sebelum membaca data operasional."));
    }
    let mut collection = String::new();
    let mut offset = 0usize;
    let mut limit = 500usize;
    for pair in query.split('&').filter(|pair| !pair.is_empty()) {
        let mut parts = pair.splitn(2, '=');
        let key = parts.next().unwrap_or("");
        let value = query_unescape(parts.next().unwrap_or(""));
        match key {
            "collection" => collection = value,
            "offset" => offset = value.parse::<usize>().unwrap_or(0),
            "limit" => limit = value.parse::<usize>().unwrap_or(500).clamp(1, 500),
            _ => {}
        }
    }
    let user = &context.user;
    let has_any = |modules: &[&str]| modules.iter().any(|module| allows(app, user, code, module));
    let identity = has_any(&["SEMUA_PASIEN", "PENDAFTARAN", "RME_DOKTER", "RAWAT_INAP", "IGD_TRIASE_EWS", "LABORATORIUM", "RADIOLOGI_RIS", "KIA_IMUNISASI", "GIGI_ODONTOGRAM", "PROLANIS_PRB", "BEDAH_IBS", "MCU_SURAT_MEDIS", "APOTEK"]);
    let allowed = match collection.as_str() {
        "patients" => has_any(&["SEMUA_PASIEN", "PENDAFTARAN", "RME_DOKTER", "RAWAT_INAP", "IGD_TRIASE_EWS", "KASIR_AKUNTANSI", "LABORATORIUM", "RADIOLOGI_RIS"]),
        "visits" => has_any(&["SEMUA_PASIEN", "PENDAFTARAN", "RME_DOKTER", "RAWAT_INAP", "IGD_TRIASE_EWS", "JADWAL_DOKTER", "APOTEK", "KASIR_AKUNTANSI"]),
        "soapRecords" => has_any(&["RME_DOKTER", "SEMUA_PASIEN"]),
        "beds" => has_any(&["RAWAT_INAP"]),
        "medications" => has_any(&["APOTEK", "KATALOG_OPNAME", "MUTASI_STOK", "PENGADAAN_PBF", "RME_DOKTER"]),
        "pharmacyOrders" => has_any(&["APOTEK", "RME_DOKTER"]),
        "labOrders" => has_any(&["LABORATORIUM", "RME_DOKTER"]),
        "radiologyOrders" => has_any(&["RADIOLOGI_RIS", "RME_DOKTER"]),
        "invoices" => has_any(&["KASIR_AKUNTANSI", "KEUANGAN_OWNER", "NERACA_GL", "KLAIM_BPJS_PIUTANG", "JASA_MEDIS_REMUN"]),
        "purchaseOrders" => has_any(&["PENGADAAN_PBF", "KEUANGAN_OWNER", "NERACA_GL"]),
        _ => return Err(bad_request("Koleksi tidak dikenal.")),
    };
    if !allowed {
        return Err(forbidden("Tidak memiliki akses ke koleksi ini."));
    }
    let (mut rows, total) = match app.store.query_page(&collection, code, offset, limit) {
        Ok((db_rows, db_total)) if db_total > 0 || array(&app.db, &collection).is_empty() => (db_rows, db_total),
        _ => {
            let mut mem_rows: Vec<Value> = array(&app.db, &collection)
                .iter()
                .filter(|entry| text(entry, "facilityCode") == code)
                .cloned()
                .collect();
            let mem_total = mem_rows.len();
            mem_rows.sort_by(|left, right| stamp_of(right).cmp(&stamp_of(left)).then_with(|| text(right, "id").cmp(text(left, "id"))));
            let sliced: Vec<Value> = mem_rows.into_iter().skip(offset).take(limit).collect();
            (sliced, mem_total)
        }
    };
    let redact = !identity && has_any(&["KASIR_AKUNTANSI", "KLAIM_BPJS_PIUTANG"]);
    if redact && matches!(collection.as_str(), "patients" | "visits") {
        for row in &mut rows {
            if let Some(object) = row.as_object_mut() {
                for field in ["nik", "address", "allergies", "chronicConditions", "bpjsNumber", "phone", "emergencyContactName", "emergencyContactPhone", "ihsNumber", "vitals", "chiefComplaint"] {
                    object.remove(field);
                }
            }
        }
    }
    json_response(200, json!({"rows": rows, "total": total}))
}

fn dispatch(
    app: &mut App,
    method: &str,
    path: &str,
    query: &str,
    headers: &HeaderMap,
    body: &Value,
) -> ApiResult {
    if method == "GET" && path == "/api/health" {
        return json_response(
            200,
            json!({"service":"KAEL","protocol":"kael-http","protocolVersion":1,"status":"ok"}),
        );
    }
    if path == "/api/public/facilities" {
        return Err(not_found("Endpoint tidak ditemukan."));
    }
    if method == "POST" && path == "/api/auth/login" {
        return login(app, body);
    }
    if method == "POST" && path == "/api/auth/logout" {
        if let Some(token) = headers
            .get("authorization")
            .and_then(|entry| entry.to_str().ok())
            .and_then(|entry| entry.strip_prefix("Bearer "))
        {
            app.sessions.remove(token.trim());
            let _ = app.store.delete_session(token.trim());
        }
        return no_content();
    }
    let context = authorize(app, headers, path)?;
    if method == "GET" && path == "/api/workspace" {
        return json_response(200, workspace(app, &context, query));
    }
    if method == "GET" && path == "/api/search" {
        return json_response(200, search_records(app, &context, query));
    }
    if method == "GET" && path == "/api/records" {
        return record_page(app, &context, query);
    }
    if method == "GET" && path == "/api/admin/export-backup" {
        require_superuser(&context)?;
        let mut dump = app.db.clone();
        if let Some(users) = dump.get_mut("users").and_then(Value::as_array_mut) {
            for user in users {
                if let Some(object) = user.as_object_mut() {
                    object.remove("passwordHash");
                }
            }
        }
        if let Some(object) = dump.as_object_mut() {
            object.remove("sessions");
            object.insert(
                "_exportMeta".into(),
                json!({
                    "exportType": "AUDIT_SNAPSHOT_JSON",
                    "restorable": false,
                    "note": "Ekspor JSON ini disanitasi (tanpa hash kredensial, sesi, dan sequence SQLite) untuk keperluan audit. Gunakan SQLite Online Backup ('kael-server backup <file>' / 'kael-server restore <file>') untuk pemulihan penuh server."
                }),
            );
        }
        return json_response(200, dump);
    }
    if method == "POST" && path == "/api/auth/switch-facility" {
        let code = normalize_facility(text(body, "facilityCode"));
        let facility = array(&app.db, "facilities")
            .iter()
            .find(|entry| text(entry, "code") == code && entry["active"] == true)
            .cloned()
            .ok_or_else(|| forbidden("Tidak memiliki otorisasi untuk beralih ke fasilitas ini."))?;
        if !can_access_facility(&context.user, &code) {
            return Err(forbidden(
                "Tidak memiliki otorisasi untuk beralih ke fasilitas ini.",
            ));
        }
        let switched = RequestContext {
            facility_code: code.clone(),
            user: context.user.clone(),
            token: context.token.clone(),
        };
        audit(
            app,
            &switched,
            "SWITCH_FACILITY",
            &code,
            "Beralih fasilitas aktif.",
        );
        if let Some(session) = app.sessions.get_mut(&context.token) {
            session.facility_code = code.clone();
        }
        save(app)?;
        let accessible: Vec<Value> = array(&app.db, "facilities")
            .iter()
            .filter(|entry| {
                entry["active"] == true && can_access_facility(&context.user, text(entry, "code"))
            })
            .cloned()
            .collect();
        return json_response(
            200,
            json!({"activeFacility":facility,"accessibleFacilities":accessible}),
        );
    }
    for handler in [
        crate::accounts::handle,
        crate::administration::handle,
        crate::care::handle,
        crate::pharmacy::handle,
        crate::finance::handle,
        crate::support::handle,
    ] {
        if let Some(result) = handler(app, &context, method, path, body) {
            return result;
        }
    }
    Err(not_found("Endpoint tidak ditemukan."))
}

fn response(result: ApiResult) -> Response {
    match result {
        Ok(result) => {
            let status =
                StatusCode::from_u16(result.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            match result.body {
                Some(body) => (status, axum::Json(body)).into_response(),
                None => status.into_response(),
            }
        }
        Err(error) => (
            StatusCode::from_u16(error.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR),
            axum::Json(json!({"error":error.message})),
        )
            .into_response(),
    }
}

fn api_headers(response: &mut Response, origin: Option<&str>, allowed: bool) {
    let headers = response.headers_mut();
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("vary", HeaderValue::from_static("Origin"));
    if allowed {
        if let Some(value) = origin.and_then(|value| HeaderValue::from_str(value).ok()) {
            headers.insert("access-control-allow-origin", value);
        }
        headers.insert(
            "access-control-allow-methods",
            HeaderValue::from_static("GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"),
        );
        headers.insert(
            "access-control-allow-headers",
            HeaderValue::from_static("Authorization, Content-Type, X-Kael-Facility"),
        );
        headers.insert("access-control-max-age", HeaderValue::from_static("600"));
    }
}

fn bounded_payload(value: &Value) -> Result<(), ApiError> {
    fn walk(value: &Value, depth: usize) -> Result<(), ApiError> {
        if depth > 12 {
            return Err(bad_request("Struktur permintaan terlalu dalam."));
        }
        match value {
            Value::Array(items) => {
                if items.len() > 200 {
                    return Err(bad_request("Satu permintaan maksimal 200 elemen."));
                }
                for item in items {
                    walk(item, depth + 1)?;
                }
            }
            Value::Object(map) => {
                for (key, item) in map {
                    if let Some(text) = item.as_str() {
                        if text.chars().count() > 4000 {
                            return Err(bad_request(format!("Isian {key} melebihi 4000 karakter.")));
                        }
                    } else {
                        walk(item, depth + 1)?;
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }
    walk(value, 0)
}

pub async fn serve(State(state): State<Arc<Shared>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let path = parts.uri.path().trim_end_matches('/').to_owned();
    let path = if path.is_empty() { "/".to_owned() } else { path };
    if path != "/api" && !path.starts_with("/api/") {
        return static_file(&state.config, &path, parts.method.as_str());
    }
    let bytes = to_bytes(body, 5 * 1024 * 1024).await;
    let origin = parts.headers.get("origin").and_then(|entry| entry.to_str().ok());
    let allowed = origin.is_some_and(|origin| state.config.client_origins.iter().any(|entry| entry == origin));
    let parsed = match bytes {
        Err(_) => Err(error(413, "Ukuran permintaan melebihi batas server.")),
        Ok(bytes) if bytes.is_empty() => Ok(json!({})),
        Ok(bytes) => {
            let content_type = parts.headers.get("content-type").and_then(|value| value.to_str().ok()).unwrap_or("");
            if !content_type.split(';').next().unwrap_or("").trim().eq_ignore_ascii_case("application/json") {
                Err(error(415, "Gunakan Content-Type application/json."))
            } else {
                match serde_json::from_slice::<Value>(&bytes) {
                    Ok(value) => bounded_payload(&value).map(|_| value),
                    Err(_) => Err(bad_request("JSON permintaan tidak valid.")),
                }
            }
        }
    };
    if parts.method == "POST" && path == "/api/auth/login" {
        let result = match parsed {
            Err(error) => Err(error),
            Ok(body) => login_outside_lock(&state, &body, client_ip(&parts.headers)).await,
        };
        let mut result = response(result);
        api_headers(&mut result, origin, allowed);
        return result;
    }
    let _ = take_dirty();
    let mut app = match state.app.lock() {
        Ok(app) => app,
        Err(_) => return response(Err(error(500, "Layanan belum tersedia."))),
    };
    if parts.method == "OPTIONS" && parts.headers.contains_key("access-control-request-method") {
        let mut result = response(if allowed { no_content() } else { Err(forbidden("Origin klien belum diizinkan oleh konfigurasi server.")) });
        api_headers(&mut result, origin, allowed);
        return result;
    }
    app.sessions.retain(|_, session| session.expires_at > Utc::now().timestamp_millis());
    let result = parsed.and_then(|body| {
        if !body.is_object() {
            return Err(bad_request("Isi permintaan harus berupa objek JSON."));
        }
        let method = if parts.method == "HEAD" { "GET" } else { parts.method.as_str() };
        let result = dispatch(&mut app, method, &path, parts.uri.query().unwrap_or(""), &parts.headers, &body);
        if result.is_err() && take_dirty() {
            let loaded = app.store.reload();
            if let Ok(value) = loaded {
                app.db = value;
            }
        }
        result
    });
    let mut result = response(result);
    if parts.method == "HEAD" {
        *result.body_mut() = Body::empty();
    }
    api_headers(&mut result, origin, allowed);
    result
}

fn client_ip(headers: &HeaderMap) -> String {
    if std::env::var("KAEL_TRUST_PROXY")
        .ok()
        .is_some_and(|val| matches!(val.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
    {
        if let Some(forwarded) = headers
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.split(',').next())
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            return forwarded.to_owned();
        }
    }
    "local".to_owned()
}

async fn login_outside_lock(state: &Shared, body: &Value, ip: String) -> ApiResult {
    let prep = {
        let mut app = state.app.lock().map_err(|_| error(500, "Layanan belum tersedia."))?;
        login_prepare(&mut app, body, &ip)?
    };
    let password = prep.password.clone();
    let hash = prep.hash.clone();
    let permit = match tokio::time::timeout(Duration::from_secs(2), LOGIN_PERMITS.acquire()).await {
        Ok(Ok(permit)) => permit,
        Ok(Err(_)) => return Err(error(500, "Layanan belum tersedia.")),
        Err(_) => return Err(error(429, "Server sedang memverifikasi banyak login. Coba lagi sesaat lagi.")),
    };
    let ok = tokio::task::spawn_blocking(move || verify_password(&password, &hash))
        .await
        .unwrap_or(false);
    drop(permit);
    let mut app = state.app.lock().map_err(|_| error(500, "Layanan belum tersedia."))?;
    login_commit(&mut app, body, &prep, ok)
}

fn static_file(config: &Config, path: &str, method: &str) -> Response {
    if method != "GET" && method != "HEAD" {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Some(root) = &config.web_root else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let Some(decoded) = decode_path(path) else {
        return StatusCode::BAD_REQUEST.into_response();
    };
    let relative = decoded.trim_start_matches('/');
    if Path::new(relative)
        .components()
        .any(|part| !matches!(part, Component::Normal(_)))
        || relative.split('/').any(|part| part.starts_with('.'))
    {
        if !relative.is_empty() {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let requested = if relative.is_empty() {
        root.join("index.html")
    } else {
        root.join(relative)
    };
    let resolved = match (root.canonicalize(), requested.canonicalize()) {
        (Ok(root), Ok(file)) if file.starts_with(&root) && file.is_file() => file,
        _ => {
            let extension = Path::new(relative).extension().is_some();
            if extension {
                return StatusCode::NOT_FOUND.into_response();
            }
            return static_bytes(config, &root.join("index.html"), method);
        }
    };
    static_bytes(config, &resolved, method)
}

fn static_bytes(config: &Config, resolved: &Path, method: &str) -> Response {
    let bytes = match std::fs::read(resolved) {
        Ok(bytes) => bytes,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    let content_type = match resolved
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
    {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "png" => "image/png",
        "svg" => "image/svg+xml",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "json" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    };
    let length = bytes.len();
    let mut result = if method == "HEAD" {
        Body::empty()
    } else {
        Body::from(bytes)
    }
    .into_response();
    let headers = result.headers_mut();
    headers.insert("content-type", HeaderValue::from_static(content_type));
    if let Ok(value) = HeaderValue::from_str(&length.to_string()) {
        headers.insert("content-length", value);
    }
    headers.insert("cache-control", HeaderValue::from_static("no-cache"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    let csp = format!(
        "default-src 'self'; connect-src 'self' {}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        config.api_origins.join(" ")
    );
    if let Ok(value) = HeaderValue::from_str(&csp) {
        headers.insert("content-security-policy", value);
    }
    result
}

fn decode_path(path: &str) -> Option<String> {
    let mut result = Vec::new();
    let mut bytes = path.bytes();
    while let Some(byte) = bytes.next() {
        let decoded = if byte == b'%' {
            let high = (bytes.next()? as char).to_digit(16)?;
            let low = (bytes.next()? as char).to_digit(16)?;
            (high * 16 + low) as u8
        } else {
            byte
        };
        if decoded == 0 || decoded == b'\\' {
            return None;
        }
        result.push(decoded);
    }
    String::from_utf8(result).ok()
}
