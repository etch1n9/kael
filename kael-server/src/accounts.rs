use crate::bootstrap::hash_password;
use crate::domain::{MODULE_KEYS, default_facility_config, normalize_facility};
use crate::http::{
    ApiError, ApiResult, App, RequestContext, array, array_mut, audit, bad_request, conflict,
    error, id, json_response, no_content, not_found, now, require_superuser, revoke_sessions,
    sanitize_user, save, text,
};
use serde_json::{Value, json};

pub fn handle(
    app: &mut App,
    context: &RequestContext,
    method: &str,
    path: &str,
    body: &Value,
) -> Option<ApiResult> {
    let roles = path == "/api/superuser/roles";
    let role_id = path
        .strip_prefix("/api/superuser/roles/")
        .filter(|id| !id.is_empty() && !id.contains('/'));
    let users = path == "/api/superuser/users";
    let restore_id = path
        .strip_prefix("/api/superuser/users/")
        .and_then(|tail| tail.strip_suffix("/restore"))
        .filter(|id| !id.is_empty() && !id.contains('/'));
    let user_id = path
        .strip_prefix("/api/superuser/users/")
        .filter(|id| !id.is_empty() && !id.contains('/'));
    let facilities = path == "/api/superuser/facilities";
    let facility_code = path
        .strip_prefix("/api/superuser/facilities/")
        .filter(|id| !id.is_empty() && !id.contains('/'));
    if !((roles && ["GET", "POST"].contains(&method))
        || (role_id.is_some() && ["PUT", "DELETE"].contains(&method))
        || (users && method == "POST")
        || (user_id.is_some() && ["PUT", "DELETE"].contains(&method))
        || (restore_id.is_some() && method == "POST")
        || (facilities && method == "POST")
        || (facility_code.is_some() && method == "DELETE"))
    {
        return None;
    }
    Some((|| {
        require_superuser(context)?;
        if roles && method == "GET" {
            return json_response(200, app.db["roles"].clone());
        }
        if roles {
            return create_role(app, context, body);
        }
        if let Some(id) = role_id {
            return change_role(app, context, method, id, body);
        }
        if users {
            return create_user(app, context, body);
        }
        if let Some(id) = restore_id {
            return restore_user(app, context, id);
        }
        if let Some(id) = user_id {
            return if method == "DELETE" {
                delete_user(app, context, id)
            } else {
                update_user(app, context, id, body)
            };
        }
        if facilities {
            return upsert_facility(app, context, body);
        }
        if let Some(code) = facility_code {
            return delete_facility(app, context, code);
        }
        Err(not_found("Endpoint tidak ditemukan."))
    })())
}

fn valid_modules(value: &Value, system: bool) -> Result<Vec<Value>, ApiError> {
    let modules = value
        .as_array()
        .filter(|modules| !modules.is_empty())
        .ok_or_else(|| bad_request("Pilih minimal satu modul peran."))?;
    if modules.iter().any(|entry| {
        entry.as_str().is_none_or(|module| {
            !MODULE_KEYS.contains(&module) || (!system && module == "SUPERUSER_CONTROL")
        })
    }) {
        return Err(bad_request(
            "Daftar modul peran tidak valid. Kontrol Superuser hanya tersedia untuk peran sistem.",
        ));
    }
    let mut result = vec![];
    for entry in modules {
        if !result.contains(entry) {
            result.push(entry.clone());
        }
    }
    Ok(result)
}

fn check_optional_strings(body: &Value, keys: &[&str]) -> Result<(), ApiError> {
    if keys
        .iter()
        .any(|key| body.get(key).is_some_and(|value| !value.is_string()))
    {
        return Err(bad_request("Data teks tidak valid."));
    }
    Ok(())
}

fn create_role(app: &mut App, context: &RequestContext, body: &Value) -> ApiResult {
    let name = text(body, "name").trim();
    let role_id = if text(body, "id").trim().is_empty() {
        id("ROLE").replace('-', "_").to_uppercase()
    } else {
        normalize_facility(text(body, "id"))
    };
    if name.is_empty()
        || name.chars().count() > 120
        || role_id.is_empty()
        || body.get("active").is_some_and(|value| !value.is_boolean())
    {
        return Err(bad_request("Nama dan status peran wajib valid."));
    }
    let modules = valid_modules(&body["modules"], false)?;
    if array(&app.db, "roles").iter().any(|entry| {
        text(entry, "id") == role_id || text(entry, "name").to_lowercase() == name.to_lowercase()
    }) {
        return Err(conflict("ID atau nama peran sudah digunakan."));
    }
    let role = json!({"id":role_id,"name":name,"modules":modules,"active":body["active"] != false,"system":false,"createdAt":now()});
    array_mut(&mut app.db, "roles").push(role.clone());
    audit(
        app,
        context,
        "SUPERUSER_ROLE_CREATE",
        &role_id,
        &format!("Membuat peran {name}."),
    );
    save(app)?;
    json_response(201, role)
}

fn change_role(
    app: &mut App,
    context: &RequestContext,
    method: &str,
    role_id: &str,
    body: &Value,
) -> ApiResult {
    let index = array(&app.db, "roles")
        .iter()
        .position(|entry| text(entry, "id") == role_id)
        .ok_or_else(|| not_found("Peran tidak ditemukan."))?;
    let mut role = app.db["roles"][index].clone();
    if method == "DELETE" {
        let assigned = array(&app.db, "users").iter().any(|user| {
            text(user, "role") == role_id
                || user["facilityRoles"].as_object().is_some_and(|roles| {
                    roles.values().any(|value| value.as_str() == Some(role_id))
                })
        });
        if role_id == "SUPERUSER" || assigned {
            return Err(conflict(if assigned {
                "Peran masih digunakan akun, termasuk akun terhapus. Pindahkan peran akun terlebih dahulu."
            } else {
                "Peran sistem SUPERUSER tidak dapat dihapus."
            }));
        }
        array_mut(&mut app.db, "roles").remove(index);
        audit(
            app,
            context,
            "SUPERUSER_ROLE_DELETE",
            role_id,
            &format!("Menghapus peran {}.", text(&role, "name")),
        );
        save(app)?;
        return no_content();
    }
    check_optional_strings(body, &["name"])?;
    if body.get("active").is_some_and(|value| !value.is_boolean()) {
        return Err(bad_request("Status peran tidak valid."));
    }
    if let Some(name) = body.get("name").and_then(Value::as_str) {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 120 {
            return Err(bad_request("Nama peran wajib valid."));
        }
        if array(&app.db, "roles").iter().any(|entry| {
            text(entry, "id") != role_id
                && text(entry, "name").to_lowercase() == name.to_lowercase()
        }) {
            return Err(conflict("Nama peran sudah digunakan."));
        }
        role["name"] = json!(name);
    }
    if let Some(value) = body.get("modules") {
        let modules = valid_modules(value, role_id == "SUPERUSER")?;
        if role_id == "SUPERUSER" {
            let mut requested: Vec<&str> = modules.iter().filter_map(Value::as_str).collect();
            let mut existing: Vec<&str> = array(&role, "modules")
                .iter()
                .filter_map(Value::as_str)
                .collect();
            requested.sort();
            existing.sort();
            if requested != existing {
                return Err(conflict("Izin peran sistem SUPERUSER dilindungi."));
            }
        }
        role["modules"] = json!(modules);
    }
    if let Some(active) = body.get("active") {
        if role_id == "SUPERUSER" && active != true {
            return Err(conflict(
                "Peran sistem SUPERUSER tidak dapat dinonaktifkan.",
            ));
        }
        role["active"] = active.clone();
    }
    role["updatedAt"] = json!(now());
    app.db["roles"][index] = role.clone();
    audit(
        app,
        context,
        "SUPERUSER_ROLE_UPDATE",
        role_id,
        &format!("Memperbarui peran {}.", text(&role, "name")),
    );
    save(app)?;
    if role["active"] != true {
        let user_ids: Vec<String> = array(&app.db, "users")
            .iter()
            .filter(|user| {
                text(user, "role") == role_id
                    || user["facilityRoles"].as_object().is_some_and(|roles| {
                        roles.values().any(|value| value.as_str() == Some(role_id))
                    })
            })
            .map(|user| text(user, "id").to_owned())
            .collect();
        for user_id in user_ids {
            revoke_sessions(app, &user_id);
        }
    }
    json_response(200, role)
}

fn facilities_for(
    app: &App,
    value: Option<&Value>,
    role: &str,
    fallback: &[Value],
) -> Result<Vec<Value>, ApiError> {
    if role == "SUPERUSER" {
        return Ok(vec![json!("*")]);
    }
    let incoming = value
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(fallback);
    if value.is_some_and(|value| !value.is_array()) || incoming.is_empty() {
        return Err(bad_request(
            "Pilih minimal satu fasilitas terdaftar untuk akun ini.",
        ));
    }
    let mut facilities = vec![];
    for entry in incoming {
        let code = normalize_facility(
            entry
                .as_str()
                .ok_or_else(|| bad_request("Kode fasilitas tidak valid."))?,
        );
        if code.is_empty()
            || !array(&app.db, "facilities")
                .iter()
                .any(|facility| text(facility, "code") == code)
        {
            return Err(bad_request("Pilih fasilitas yang terdaftar di server."));
        }
        if !facilities.contains(&json!(code)) {
            facilities.push(json!(code));
        }
    }
    Ok(facilities)
}

fn identity_available(app: &App, identity: &str, excluded_id: &str) -> bool {
    identity.is_empty()
        || !array(&app.db, "users").iter().any(|user| {
            text(user, "id") != excluded_id
                && (text(user, "username").to_lowercase() == identity.to_lowercase()
                    || (!text(user, "nipOrSip").is_empty()
                        && text(user, "nipOrSip").to_lowercase() == identity.to_lowercase()))
        })
}

fn password_hash(value: &Value) -> Result<String, ApiError> {
    let password = value
        .as_str()
        .filter(|password| (8..=512).contains(&password.chars().count()))
        .ok_or_else(|| bad_request("Kata sandi harus terdiri dari 8–512 karakter."))?;
    hash_password(password).map_err(|_| error(500, "Kata sandi tidak dapat diproses."))
}

fn create_user(app: &mut App, context: &RequestContext, body: &Value) -> ApiResult {
    if body
        .get("isPractitioner")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(bad_request(
            "Penanda tenaga pemeriksa klinis harus berupa boolean.",
        ));
    }
    check_optional_strings(
        body,
        &[
            "username",
            "fullName",
            "nipOrSip",
            "email",
            "specialization",
            "polyclinic",
        ],
    )?;
    let username = text(body, "username").trim().to_lowercase();
    let name = text(body, "fullName").trim();
    let role = text(body, "role");
    if username.is_empty()
        || username.chars().count() > 120
        || name.is_empty()
        || !array(&app.db, "roles")
            .iter()
            .any(|entry| text(entry, "id") == role && entry["active"] == true)
    {
        return Err(bad_request(
            "Username, nama lengkap, dan peran aktif wajib diisi.",
        ));
    }
    let nip = text(body, "nipOrSip").trim();
    if !identity_available(app, &username, "") || !identity_available(app, nip, "") {
        return Err(conflict(
            "Username atau NIP/SIP sudah digunakan sebagai identitas login akun lain, termasuk akun terhapus.",
        ));
    }
    let fallback = if context.facility_code.is_empty() {
        vec![]
    } else {
        vec![json!(context.facility_code)]
    };
    let facilities = facilities_for(app, body.get("allowedFacilities"), role, &fallback)?;
    let user = json!({"id":id("usr"),"username":username,"fullName":name,"nipOrSip":nip,"email":text(body,"email").trim(),
        "role":role,"allowedFacilities":facilities,"customPrivileges":[],"specialization":text(body,"specialization").trim(),
        "polyclinic":text(body,"polyclinic").trim(),"isPractitioner":body["isPractitioner"] == true,"active":true,"createdBy":text(&context.user,"username"),
        "createdAt":now(),"passwordHash":password_hash(&body["password"])?});
    array_mut(&mut app.db, "users").push(user.clone());
    audit(
        app,
        context,
        "SUPERUSER_PROVISION_USER",
        text(&user, "id"),
        &format!("Mendaftarkan akun @{username}."),
    );
    save(app)?;
    json_response(201, sanitize_user(&app.db, &user, &context.facility_code))
}

fn last_superuser(app: &App, user: &Value) -> bool {
    user["active"] == true
        && text(user, "role") == "SUPERUSER"
        && array(&app.db, "users")
            .iter()
            .filter(|entry| {
                entry["active"] == true
                    && text(entry, "role") == "SUPERUSER"
                    && text(entry, "deletedAt").is_empty()
            })
            .count()
            <= 1
}

fn update_user(app: &mut App, context: &RequestContext, user_id: &str, body: &Value) -> ApiResult {
    let index = array(&app.db, "users")
        .iter()
        .position(|entry| text(entry, "id") == user_id)
        .ok_or_else(|| not_found("Pengguna tidak ditemukan."))?;
    let previous = app.db["users"][index].clone();
    if !text(&previous, "deletedAt").is_empty() {
        return Err(conflict(
            "Pulihkan akun terhapus sebelum mengubah akses atau identitasnya.",
        ));
    }
    check_optional_strings(
        body,
        &[
            "username",
            "fullName",
            "nipOrSip",
            "email",
            "specialization",
            "polyclinic",
            "role",
        ],
    )?;
    let mut user = previous.clone();
    if body
        .get("isPractitioner")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err(bad_request(
            "Penanda tenaga pemeriksa klinis harus berupa boolean.",
        ));
    }
    user["isPractitioner"] = json!(
        body.get("isPractitioner")
            .unwrap_or(&previous["isPractitioner"])
            == true
    );
    for field in [
        "username",
        "fullName",
        "nipOrSip",
        "email",
        "specialization",
        "polyclinic",
        "role",
    ] {
        if let Some(value) = body.get(field).and_then(Value::as_str) {
            user[field] = json!(if field == "username" {
                value.trim().to_lowercase()
            } else {
                value.trim().to_owned()
            });
        }
    }
    let username = text(&user, "username").to_owned();
    let role = text(&user, "role").to_owned();
    if username.is_empty() || username.chars().count() > 120 || text(&user, "fullName").is_empty() {
        return Err(bad_request("Username dan nama lengkap wajib valid."));
    }
    if !identity_available(app, &username, user_id)
        || !identity_available(app, text(&user, "nipOrSip"), user_id)
    {
        return Err(conflict(
            "Username atau NIP/SIP sudah digunakan akun lain, termasuk akun terhapus.",
        ));
    }
    if let Some(active) = body.get("active") {
        if !active.is_boolean() {
            return Err(bad_request("Status akun tidak valid."));
        }
        user["active"] = active.clone();
    }
    if !array(&app.db, "roles").iter().any(|entry| {
        text(entry, "id") == role && (user["active"] != true || entry["active"] == true)
    }) {
        return Err(bad_request(
            "Pilih peran yang terdaftar dan aktif untuk akun aktif.",
        ));
    }
    if last_superuser(app, &previous) && (user["active"] != true || role != "SUPERUSER") {
        return Err(conflict(
            "Superuser aktif terakhir tidak dapat dinonaktifkan atau diganti perannya.",
        ));
    }
    user["allowedFacilities"] = json!(facilities_for(
        app,
        body.get("allowedFacilities"),
        &role,
        array(&previous, "allowedFacilities")
    )?);
    if role != text(&previous, "role") {
        user.as_object_mut()
            .map(|object| object.remove("facilityRoles"));
    }
    if let Some(roles) = body.get("facilityRoles") {
        let roles = roles
            .as_object()
            .ok_or_else(|| bad_request("Peran per fasilitas tidak valid."))?;
        if roles.iter().any(|(code, id)| {
            !array(&user, "allowedFacilities").contains(&json!(code))
                || id == "SUPERUSER"
                || !array(&app.db, "roles")
                    .iter()
                    .any(|entry| entry["id"] == *id && entry["active"] == true)
        }) {
            return Err(bad_request("Peran per fasilitas tidak valid."));
        }
        user["facilityRoles"] = json!(roles);
    }
    user["customPrivileges"] = json!([]);
    if let Some(password) = body.get("newPassword") {
        user["passwordHash"] = json!(password_hash(password)?);
    }
    let changed = ["role", "active", "allowedFacilities", "facilityRoles"]
        .iter()
        .any(|key| previous[*key] != user[*key])
        || body.get("newPassword").is_some();
    app.db["users"][index] = user.clone();
    audit(
        app,
        context,
        "SUPERUSER_UPDATE_USER",
        user_id,
        &format!("Memperbarui akun @{username}."),
    );
    save(app)?;
    if changed {
        revoke_sessions(app, user_id);
    }
    json_response(200, sanitize_user(&app.db, &user, &context.facility_code))
}

fn delete_user(app: &mut App, context: &RequestContext, user_id: &str) -> ApiResult {
    let index = array(&app.db, "users")
        .iter()
        .position(|entry| text(entry, "id") == user_id)
        .ok_or_else(|| not_found("Pengguna tidak ditemukan."))?;
    let user = app.db["users"][index].clone();
    if user_id == text(&context.user, "id") || last_superuser(app, &user) {
        return Err(conflict(
            "Akun sendiri dan Superuser aktif terakhir tidak dapat dihapus.",
        ));
    }
    if !text(&user, "deletedAt").is_empty() {
        return Err(conflict("Akun sudah berada dalam daftar akun terhapus."));
    }
    app.db["users"][index]["deletedAt"] = json!(now());
    app.db["users"][index]["active"] = json!(false);
    audit(
        app,
        context,
        "SUPERUSER_DELETE_USER",
        user_id,
        &format!(
            "Memindahkan akun @{} ke daftar akun terhapus. Identitas dan riwayat tetap tersimpan.",
            text(&user, "username")
        ),
    );
    save(app)?;
    revoke_sessions(app, user_id);
    no_content()
}

fn restore_user(app: &mut App, context: &RequestContext, user_id: &str) -> ApiResult {
    let index = array(&app.db, "users")
        .iter()
        .position(|entry| text(entry, "id") == user_id)
        .ok_or_else(|| not_found("Pengguna tidak ditemukan."))?;
    let mut user = app.db["users"][index].clone();
    if text(&user, "deletedAt").is_empty() {
        return Err(conflict(
            "Akun ini tidak berada dalam daftar akun terhapus.",
        ));
    }
    user.as_object_mut()
        .map(|object| object.remove("deletedAt"));
    user["active"] = json!(false);
    user["isPractitioner"] = json!(user["isPractitioner"] == true);
    app.db["users"][index] = user.clone();
    audit(
        app,
        context,
        "SUPERUSER_RESTORE_USER",
        user_id,
        &format!(
            "Memulihkan akun @{} sebagai akun nonaktif.",
            text(&user, "username")
        ),
    );
    save(app)?;
    json_response(200, sanitize_user(&app.db, &user, &context.facility_code))
}

fn upsert_facility(app: &mut App, context: &RequestContext, body: &Value) -> ApiResult {
    check_optional_strings(
        body,
        &[
            "code",
            "name",
            "type",
            "kemenkesCode",
            "bpjsPcareCode",
            "satusehatOrgId",
            "address",
            "city",
            "phone",
            "serverNodeUrl",
        ],
    )?;
    let code = normalize_facility(text(body, "code"));
    let name = text(body, "name").trim();
    let index = array(&app.db, "facilities")
        .iter()
        .position(|entry| text(entry, "code") == code);
    let existing = index.map(|index| app.db["facilities"][index].clone());
    let kind = body
        .get("type")
        .and_then(Value::as_str)
        .or_else(|| existing.as_ref().map(|facility| text(facility, "type")))
        .unwrap_or("")
        .to_owned();
    if code.is_empty()
        || code.len() > 80
        || name.is_empty()
        || !["KLINIK_PRATAMA", "KLINIK_UTAMA", "RSUD", "RS_SWASTA"].contains(&kind.as_str())
        || body.get("active").is_some_and(|value| !value.is_boolean())
    {
        return Err(bad_request(
            "Kode, nama, tipe, dan konfigurasi fasilitas wajib valid.",
        ));
    }
    let mut facility = existing.unwrap_or_else(|| json!({"code":code,"tenantId":id("tenant"),"createdAt":now(),"activeConfigVersion":1,"active":true,
        "kemenkesCode":"","bpjsPcareCode":"","satusehatOrgId":"","address":"","city":"","phone":"","serverNodeUrl":""}));
    facility["name"] = json!(name);
    facility["type"] = json!(kind);
    facility["careLevel"] = json!(if kind.starts_with("KLINIK") {
        "FKTP"
    } else {
        "FKRTL"
    });
    for key in [
        "kemenkesCode",
        "bpjsPcareCode",
        "satusehatOrgId",
        "address",
        "city",
        "phone",
        "serverNodeUrl",
    ] {
        if let Some(value) = body.get(key).and_then(Value::as_str) {
            facility[key] = json!(value.trim());
        }
    }
    if let Some(value) = body.get("active") {
        facility["active"] = value.clone();
    }
    if let Some(index) = index {
        app.db["facilities"][index] = facility.clone();
    } else {
        array_mut(&mut app.db, "facilities").push(facility.clone());
        array_mut(&mut app.db, "facilityConfigs").push(default_facility_config(
            &facility,
            text(&context.user, "username"),
        ));
    }
    audit(
        app,
        context,
        if index.is_some() {
            "SUPERUSER_FACILITY_UPDATE"
        } else {
            "SUPERUSER_FACILITY_CREATE"
        },
        &code,
        &format!("Menyimpan fasilitas {name}."),
    );
    save(app)?;
    json_response(if index.is_some() { 200 } else { 201 }, facility)
}

fn delete_facility(app: &mut App, context: &RequestContext, code: &str) -> ApiResult {
    let code = normalize_facility(code);
    let index = array(&app.db, "facilities")
        .iter()
        .position(|entry| text(entry, "code") == code)
        .ok_or_else(|| not_found("Fasilitas tidak ditemukan."))?;
    let collections = [
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
        "idempotencyRecords",
    ];
    let has_data = collections.iter().any(|key| {
        array(&app.db, key)
            .iter()
            .any(|entry| text(entry, "facilityCode") == code)
    }) || array(&app.db, "referrals").iter().any(|entry| {
        text(entry, "originFacilityCode") == code || text(entry, "destinationFacilityCode") == code
    });
    let has_users = array(&app.db, "users").iter().any(|user| {
        text(user, "role") != "SUPERUSER"
            && (array(user, "allowedFacilities").contains(&json!(code))
                || user["facilityRoles"].get(&code).is_some())
    });
    if has_data || has_users {
        return Err(conflict(
            "Fasilitas masih memiliki akun atau data layanan terkait. Pindahkan akses akun atau nonaktifkan fasilitas agar riwayat tetap tersimpan.",
        ));
    }
    array_mut(&mut app.db, "facilities").remove(index);
    array_mut(&mut app.db, "facilityConfigs").retain(|entry| text(entry, "facilityCode") != code);
    audit(
        app,
        context,
        "SUPERUSER_FACILITY_DELETE",
        &code,
        "Menghapus fasilitas kosong; riwayat audit dipertahankan.",
    );
    save(app)?;
    no_content()
}
