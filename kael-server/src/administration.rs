use crate::domain::{default_facility_config, normalize_facility, validate_capabilities};
use crate::http::{
    ApiResult, App, RequestContext, array, array_mut, audit, bad_request, json_response, not_found,
    now, require_superuser, save, text,
};
use serde_json::{Value, json};

pub fn handle(
    app: &mut App,
    context: &RequestContext,
    method: &str,
    path: &str,
    body: &Value,
) -> Option<ApiResult> {
    let server = path == "/api/superuser/server-config" && method == "PUT";
    let rollback = path
        .strip_prefix("/api/superuser/facility-config/")
        .and_then(|value| value.strip_suffix("/rollback"))
        .filter(|value| !value.is_empty() && !value.contains('/'));
    let facility = path
        .strip_prefix("/api/superuser/facility-config/")
        .filter(|value| !value.is_empty() && !value.contains('/'));
    if !server
        && !(method == "POST" && rollback.is_some())
        && !(method == "PUT" && facility.is_some())
    {
        return None;
    }
    Some((|| {
        require_superuser(context)?;
        if server {
            return server_config(app, context, body);
        }
        let code = normalize_facility(rollback.or(facility).unwrap_or(""));
        let facility_index = array(&app.db, "facilities")
            .iter()
            .position(|entry| text(entry, "code") == code)
            .ok_or_else(|| not_found("Fasilitas tidak ditemukan."))?;
        let facility = app.db["facilities"][facility_index].clone();
        let history: Vec<Value> = array(&app.db, "facilityConfigs")
            .iter()
            .filter(|entry| text(entry, "facilityCode") == code)
            .cloned()
            .collect();
        let current = history
            .iter()
            .find(|entry| text(entry, "lifecycleStage") == "ACTIVE")
            .cloned()
            .unwrap_or_else(|| default_facility_config(&facility, "SYSTEM"));
        let version = history
            .iter()
            .map(|entry| entry["configVersion"].as_i64().unwrap_or(1))
            .max()
            .unwrap_or(0)
            + 1;
        let timestamp = now();
        let mut snapshot = if rollback.is_some() {
            let target = body["targetVersion"]
                .as_i64()
                .ok_or_else(|| bad_request("Pilih versi konfigurasi yang valid."))?;
            let mut source = history
                .iter()
                .find(|entry| entry["configVersion"].as_i64() == Some(target))
                .cloned()
                .ok_or_else(|| not_found("Snapshot konfigurasi tidak ditemukan."))?;
            source["supersededFromVersion"] = json!(target);
            source["changeNotes"] = json!(if text(body, "reason").trim().is_empty() {
                format!("Rollback konfigurasi ke versi {target} sebagai revisi baru.")
            } else {
                text(body, "reason").trim().to_owned()
            });
            source
        } else {
            let capabilities = body
                .get("enabledSubCapabilities")
                .and_then(Value::as_array)
                .unwrap_or(array(&current, "enabledSubCapabilities"))
                .clone();
            if body
                .get("enabledSubCapabilities")
                .is_some_and(|value| !value.is_array())
            {
                return Err(bad_request("Daftar kapabilitas tidak valid."));
            }
            validate_capabilities(&capabilities).map_err(bad_request)?;
            validate_masters(body)?;
            let mut source = current;
            if let (Some(source), Some(incoming)) = (source.as_object_mut(), body.as_object()) {
                for (key, value) in incoming {
                    source.insert(key.clone(), value.clone());
                }
            }
            source["enabledSubCapabilities"] = json!(capabilities);
            source["effectiveDate"] = json!(if text(body, "effectiveDate").is_empty() {
                timestamp[..10].to_owned()
            } else {
                text(body, "effectiveDate").to_owned()
            });
            source["changeNotes"] = json!(if text(body, "changeNotes").trim().is_empty() {
                format!("Publikasi konfigurasi versi {version}.")
            } else {
                text(body, "changeNotes").trim().to_owned()
            });
            source
        };
        snapshot["configId"] = json!(format!("cfg-{code}-v{version}"));
        snapshot["facilityCode"] = json!(code);
        snapshot["configVersion"] = json!(version);
        snapshot["lifecycleStage"] = json!("ACTIVE");
        snapshot["publishedBy"] = json!(text(&context.user, "username"));
        snapshot["publishedAt"] = json!(timestamp);
        for entry in array_mut(&mut app.db, "facilityConfigs")
            .iter_mut()
            .filter(|entry| {
                text(entry, "facilityCode") == code && text(entry, "lifecycleStage") == "ACTIVE"
            })
        {
            entry["lifecycleStage"] = json!("SUPERSEDED");
        }
        array_mut(&mut app.db, "facilityConfigs").push(snapshot.clone());
        app.db["facilities"][facility_index]["activeConfigVersion"] = json!(version);
        audit(
            app,
            context,
            if rollback.is_some() {
                "SUPERUSER_CONFIG_ROLLBACK"
            } else {
                "SUPERUSER_CONFIG_PUBLISH"
            },
            &code,
            &format!("Menyimpan konfigurasi fasilitas versi {version}."),
        );
        save(app)?;
        json_response(
            200,
            json!({"activeConfig":snapshot,"history":array(&app.db,"facilityConfigs").iter().filter(|entry| text(entry,"facilityCode") == code).cloned().collect::<Vec<_>>()}),
        )
    })())
}

fn server_config(app: &mut App, context: &RequestContext, body: &Value) -> ApiResult {
    let mut config = app.db["serverConfig"].clone();
    for key in ["nodeName", "environment", "satusehatBaseUrl", "bpjsBaseUrl"] {
        if let Some(value) = body.get(key) {
            let value = value
                .as_str()
                .ok_or_else(|| bad_request("Konfigurasi server tidak valid."))?
                .trim();
            if key == "environment" && !["PRODUCTION", "STAGING", "DEVELOPMENT"].contains(&value) {
                return Err(bad_request("Lingkungan server tidak valid."));
            }
            config[key] = json!(value);
        }
    }
    if let Some(value) = body.get("iomtListenPort") {
        let port = value
            .as_i64()
            .filter(|port| (1..=65535).contains(port))
            .ok_or_else(|| bad_request("Port IoMT harus antara 1 dan 65535."))?;
        config["iomtListenPort"] = json!(port);
    }
    if let Some(value) = body.get("sessionTimeoutMinutes") {
        let minutes = value
            .as_i64()
            .filter(|minutes| (1..=1440).contains(minutes))
            .ok_or_else(|| bad_request("Batas sesi harus antara 1 dan 1440 menit."))?;
        config["sessionTimeoutMinutes"] = json!(minutes);
    }
    app.db["serverConfig"] = config.clone();
    audit(
        app,
        context,
        "SUPERUSER_SERVER_CONFIG",
        text(&config, "nodeName"),
        "Memperbarui konfigurasi server.",
    );
    save(app)?;
    json_response(200, config)
}

fn master_code(value: &Value, key: &str) -> Result<String, crate::http::ApiError> {
    let code = text(value, key).trim();
    if code.is_empty()
        || code.chars().count() > 40
        || !code
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_')
    {
        return Err(bad_request(
            "Kode master harus 1–40 karakter: huruf, angka, atau garis bawah.",
        ));
    }
    Ok(code.to_owned())
}

fn unique_codes(codes: &[String]) -> Result<(), crate::http::ApiError> {
    let mut seen = Vec::new();
    for code in codes {
        if seen.iter().any(|existing: &String| existing == code) {
            return Err(bad_request("Kode master tidak boleh ganda."));
        }
        seen.push(code.clone());
    }
    Ok(())
}

fn validate_masters(body: &Value) -> Result<(), crate::http::ApiError> {
    if let Some(units) = body.get("units") {
        let units = units
            .as_array()
            .ok_or_else(|| bad_request("Daftar unit tidak valid."))?;
        let mut codes = Vec::new();
        for unit in units {
            let code = master_code(unit, "unitCode")?;
            if text(unit, "unitName").trim().is_empty()
                || text(unit, "unitName").chars().count() > 120
                || ![
                    "RUANG_PRAKTIK",
                    "POLIKLINIK_SPESIALIS",
                    "IGD",
                    "BANGSAL_RANAP",
                    "KAMAR_OPERASI",
                    "HEMODIALISIS",
                    "LABORATORIUM",
                    "RADIOLOGI",
                    "DEPO_FARMASI",
                    "INSTALASI_PENDUKUNG",
                ]
                .contains(&text(unit, "unitType"))
                || !unit.get("active").is_some_and(Value::is_boolean)
            {
                return Err(bad_request("Data unit atau poliklinik tidak lengkap."));
            }
            codes.push(code);
        }
        unique_codes(&codes)?;
    }
    if let Some(payers) = body.get("guarantors") {
        let payers = payers
            .as_array()
            .ok_or_else(|| bad_request("Daftar penjamin tidak valid."))?;
        let mut codes = Vec::new();
        for payer in payers {
            let code = master_code(payer, "code")?;
            if text(payer, "name").trim().is_empty()
                || text(payer, "name").chars().count() > 120
                || !["PATIENT", "BPJS"].contains(&text(payer, "settlement"))
                || !payer.get("active").is_some_and(Value::is_boolean)
            {
                return Err(bad_request("Data penjamin tidak lengkap."));
            }
            codes.push(code);
        }
        unique_codes(&codes)?;
    }
    if let Some(classes) = body.get("bedClasses") {
        let classes = classes
            .as_array()
            .ok_or_else(|| bad_request("Daftar kelas kamar tidak valid."))?;
        let mut codes = Vec::new();
        for class in classes {
            let code = master_code(class, "code")?;
            if text(class, "name").trim().is_empty()
                || text(class, "name").chars().count() > 120
                || !class.get("active").is_some_and(Value::is_boolean)
            {
                return Err(bad_request("Data kelas kamar tidak lengkap."));
            }
            codes.push(code);
        }
        unique_codes(&codes)?;
    }
    Ok(())
}
