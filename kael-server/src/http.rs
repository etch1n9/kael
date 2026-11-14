use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use chrono::{SecondsFormat, Utc};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Component, Path};
use std::sync::{Arc, LazyLock, Mutex};
use uuid::Uuid;

use crate::bootstrap::{hash_password, verify_password};
use crate::config::Config;
use crate::domain::{default_facility_config, normalize_facility};
use crate::storage::Storage;

pub struct App {
    pub config: Config,
    pub store: Storage,
    pub db: Value,
    pub sessions: HashMap<String, Session>,
    pub saved_state: Value,
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

static EMPTY_ROWS: LazyLock<Vec<Value>> = LazyLock::new(Vec::new);
pub fn array<'a>(value: &'a Value, key: &str) -> &'a Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .unwrap_or(&EMPTY_ROWS)
}
pub fn array_mut<'a>(value: &'a mut Value, key: &str) -> &'a mut Vec<Value> {
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
    rows.insert(0, entry);
}

pub fn save(app: &mut App) -> Result<(), ApiError> {
    if let Err(message) = app.store.save(&app.db) {
        app.db = app.saved_state.clone();
        eprintln!("KAEL gagal menyimpan database: {message}");
        return Err(error(500, "Permintaan gagal disimpan server."));
    }
    app.saved_state = app.db.clone();
    Ok(())
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
    let username = text(body, "username").trim().to_lowercase();
    let password = text(body, "password");
    if username.is_empty()
        || password.is_empty()
        || password.chars().count() > 512
        || body
            .get("facilityCode")
            .is_some_and(|value| !value.is_string())
    {
        return Err(bad_request("Username dan kata sandi wajib diisi."));
    }
    let index = array(&app.db, "users")
        .iter()
        .position(|user| {
            text(user, "username").to_lowercase() == username
                || text(user, "nipOrSip").to_lowercase() == username
        })
        .ok_or_else(login_denied)?;
    let user = app.db["users"][index].clone();
    if user["active"] != true || !text(&user, "deletedAt").is_empty() {
        return Err(login_denied());
    }
    if !verify_password(password, text(&user, "passwordHash")) {
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
    {
        return Err(login_denied());
    }
    if !facility.is_null() && !can_access_facility(&user, &facility_code) {
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
    let expires_at =
        Utc::now().timestamp_millis() + (if remember { 7 * 1440 } else { configured }) * 60_000;
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    if !text(&user, "passwordHash").starts_with("scrypt:") {
        app.db["users"][index]["passwordHash"] = json!(
            hash_password(password).map_err(|_| error(500, "Kata sandi tidak dapat diproses."))?
        );
    }
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
    save(app)?;
    app.sessions.insert(
        token.clone(),
        Session {
            user_id: text(&user, "id").into(),
            facility_code: facility_code.clone(),
            expires_at,
        },
    );
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

fn workspace(app: &App, context: &RequestContext) -> Value {
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
        array(&app.db, key)
            .iter()
            .filter(|entry| text(entry, "facilityCode") == code)
            .cloned()
            .collect()
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
    let mut result = json!({"user":sanitize_user(&app.db,user,code),"roles":app.db["roles"],"activeFacility":facility,
        "facilityConfigHistory":if superuser {scoped("facilityConfigs")} else {vec![]},"evidenceRegistry":scoped("evidenceRegistry"),
        "accessibleFacilities":accessible,"doctors":array(&app.db,"users").iter().filter(|entry| doctors_access && is_practitioner(app,entry,code)).map(|entry| sanitize_user(&app.db,entry,code)).collect::<Vec<_>>(),
        "patients":scoped("patients"),"visits":scoped("visits"),"soapRecords":if clinical {scoped("soapRecords")} else {vec![]},
        "beds":scoped("beds"),"medications":scoped("medications"),"medicationMutations":scoped("medicationMutations"),
        "pharmacyOrders":scoped("pharmacyOrders"),"purchaseOrders":scoped("purchaseOrders"),"labOrders":scoped("labOrders"),
        "radiologyOrders":scoped("radiologyOrders"),"surgicalSchedules":scoped("surgicalSchedules"),
        "referrals":array(&app.db,"referrals").iter().filter(|entry| referrals_access && !code.is_empty() && (text(entry,"originFacilityCode") == code || text(entry,"destinationFacilityCode") == code)).cloned().collect::<Vec<_>>(),
        "invoices":if finance {scoped("invoices")} else {vec![]},"accountingEntries":if finance {scoped("accountingEntries")} else {vec![]},
        "doubleEntryJournals":if finance {scoped("doubleEntryJournals")} else {vec![]},"bridgingLogs":scoped("bridgingLogs"),
        "auditLogs":if superuser {array(&app.db,"auditLogs").clone()} else {vec![]},"allUsers":visible_users,
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
    if !facility.is_null() && allows(app, user, code, "KEUANGAN_OWNER") {
        let codes: Vec<&str> = accessible
            .iter()
            .map(|entry| text(entry, "code"))
            .filter(|code| allows(app, user, code, "KEUANGAN_OWNER"))
            .collect();
        for key in ["accountingEntries", "invoices", "visits"] {
            result["multiFacilityFinance"][key] = json!(
                array(&app.db, key)
                    .iter()
                    .filter(|entry| codes.contains(&text(entry, "facilityCode"))
                        && (key != "visits" || can_read_visits_at(text(entry, "facilityCode"))))
                    .cloned()
                    .collect::<Vec<_>>()
            );
        }
    }
    result
}

fn dispatch(
    app: &mut App,
    method: &str,
    path: &str,
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
        }
        return no_content();
    }
    let context = authorize(app, headers, path)?;
    if method == "GET" && path == "/api/workspace" {
        return json_response(200, workspace(app, &context));
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
        save(app)?;
        if let Some(session) = app.sessions.get_mut(&context.token) {
            session.facility_code = code;
        }
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

pub async fn serve(State(state): State<Arc<Mutex<App>>>, request: Request) -> Response {
    let (parts, body) = request.into_parts();
    let path = parts.uri.path().trim_end_matches('/').to_owned();
    let path = if path.is_empty() {
        "/".to_owned()
    } else {
        path
    };
    if path != "/api" && !path.starts_with("/api/") {
        return match state.lock() {
            Ok(app) => static_file(&app.config, &path, parts.method.as_str()),
            Err(_) => response(Err(error(500, "Layanan belum tersedia."))),
        };
    }
    let bytes = to_bytes(body, 5 * 1024 * 1024).await;
    let mut app = match state.lock() {
        Ok(app) => app,
        Err(_) => return response(Err(error(500, "Layanan belum tersedia."))),
    };
    let origin = parts
        .headers
        .get("origin")
        .and_then(|entry| entry.to_str().ok());
    let allowed = origin.is_some_and(|origin| {
        app.config
            .client_origins
            .iter()
            .any(|entry| entry == origin)
    });
    if parts.method == "OPTIONS" && parts.headers.contains_key("access-control-request-method") {
        let mut result = response(if allowed {
            no_content()
        } else {
            Err(forbidden(
                "Origin klien belum diizinkan oleh konfigurasi server.",
            ))
        });
        api_headers(&mut result, origin, allowed);
        return result;
    }
    let parsed = match bytes {
        Err(_) => Err(error(413, "Ukuran permintaan melebihi batas server.")),
        Ok(bytes) if bytes.is_empty() => Ok(json!({})),
        Ok(bytes) => {
            let content_type = parts
                .headers
                .get("content-type")
                .and_then(|value| value.to_str().ok())
                .unwrap_or("");
            if !content_type
                .split(';')
                .next()
                .unwrap_or("")
                .trim()
                .eq_ignore_ascii_case("application/json")
            {
                Err(error(415, "Gunakan Content-Type application/json."))
            } else {
                serde_json::from_slice::<Value>(&bytes)
                    .map_err(|_| bad_request("JSON permintaan tidak valid."))
            }
        }
    };
    app.sessions
        .retain(|_, session| session.expires_at > Utc::now().timestamp_millis());
    let result = parsed.and_then(|body| {
        if !body.is_object() {
            return Err(bad_request("Isi permintaan harus berupa objek JSON."));
        }
        let method = if parts.method == "HEAD" {
            "GET"
        } else {
            parts.method.as_str()
        };
        let result = dispatch(&mut app, method, &path, &parts.headers, &body);
        if result.is_err() {
            app.db = app.saved_state.clone();
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
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let bytes = match std::fs::read(&resolved) {
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
