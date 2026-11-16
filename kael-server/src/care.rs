use crate::domain::{apply_clinical_record, auto_triage, invoice_totals, lab_flag, lab_templates};
use crate::http::{
    ApiError, ApiResult, App, RequestContext, active_config, array, array_mut, audit, bad_request,
    conflict, error, forbidden, id, is_practitioner, json_response, not_found, now, require_service, save,
    text,
};
use serde_json::{Value, json};

fn n(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .or_else(|| value[key].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

fn stay_days(admitted_at: &str) -> i64 {
    let Some(admitted) = chrono::DateTime::parse_from_rfc3339(admitted_at).ok() else {
        return 1;
    };
    let elapsed = chrono::Utc::now().signed_duration_since(admitted.with_timezone(&chrono::Utc));
    elapsed.num_days().max(1)
}
fn default<'a>(value: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    if text(value, key).is_empty() {
        fallback
    } else {
        text(value, key)
    }
}
fn index(
    app: &App,
    ctx: &RequestContext,
    collection: &str,
    entity_id: &str,
    message: &str,
) -> Result<usize, ApiError> {
    array(&app.db, collection)
        .iter()
        .position(|row| {
            text(row, "id") == entity_id && text(row, "facilityCode") == ctx.facility_code
        })
        .ok_or_else(|| not_found(message))
}
fn str_array(value: &Value, key: &str) -> Vec<Value> {
    array(value, key)
        .iter()
        .filter(|item| item.as_str().map(|s| !s.trim().is_empty()).unwrap_or(false))
        .cloned()
        .collect()
}
fn prefix(facility: &str, count: usize) -> String {
    facility.chars().take(count).collect()
}

pub fn handle(
    app: &mut App,
    ctx: &RequestContext,
    method: &str,
    path: &str,
    body: &Value,
) -> Option<ApiResult> {
    match (method, path) {
        ("POST", "/api/patients") => return Some(create_patient(app, ctx, body)),
        ("POST", "/api/visits") => return Some(create_visit(app, ctx, body, false)),
        ("POST", "/api/visits/unified-register") => {
            return Some(create_visit(app, ctx, body, true));
        }
        ("POST", "/api/beds") => return Some(create_bed(app, ctx, body)),
        ("POST", "/api/lab") => return Some(create_lab(app, ctx, body)),
        ("POST", "/api/soap") => return Some(soap(app, ctx, body)),
        _ => {}
    }
    if method == "PUT" {
        if let Some(patient_id) = path.strip_prefix("/api/patients/") {
            return Some(update_patient(app, ctx, patient_id, body));
        }
    }
    if let Some(rest) = path.strip_prefix("/api/visits/") {
        if method == "PATCH" {
            if let Some(visit_id) = rest.strip_suffix("/status") {
                return Some(visit_status(app, ctx, visit_id, body));
            }
        }
    }
    if let Some(rest) = path.strip_prefix("/api/beds/") {
        for action in ["assign", "discharge", "status"] {
            if let Some(bed_id) = rest.strip_suffix(&format!("/{action}")) {
                if (method == "POST" && action != "status")
                    || (method == "PATCH" && action == "status")
                {
                    return Some(bed_action(app, ctx, bed_id, action, body));
                }
            }
        }
    }
    if method == "POST" {
        if let Some(rest) = path.strip_prefix("/api/lab/") {
            if let Some(order_id) = rest.strip_suffix("/verify") {
                return Some(verify_lab(app, ctx, order_id, body));
            }
        }
    }
    None
}

fn patient_data(app: &mut App, ctx: &RequestContext, body: &Value) -> Result<Value, ApiError> {
    let nik = text(body, "nik").trim();
    let name = text(body, "fullName").trim();
    let birthday = text(body, "birthDate");
    if name.is_empty()
        || nik.len() != 16
        || !nik.bytes().all(|c| c.is_ascii_digit())
        || chrono::NaiveDate::parse_from_str(birthday, "%Y-%m-%d").is_err()
    {
        return Err(bad_request(
            "Nama Lengkap, NIK (16 digit), dan Tanggal Lahir wajib diisi dengan benar.",
        ));
    }
    if !["L", "P"].contains(&text(body, "gender")) {
        return Err(bad_request("Pilih jenis kelamin pasien yang sesuai."));
    }
    if array(&app.db, "patients")
        .iter()
        .any(|p| text(p, "facilityCode") == ctx.facility_code && text(p, "nik") == nik)
    {
        return Err(conflict(
            "Pasien dengan NIK ini sudah terdaftar di fasilitas ini.",
        ));
    }
    let initials = ctx
        .facility_code
        .split('_')
        .filter_map(|part| part.chars().next())
        .collect::<String>();
    let floor = array(&app.db, "patients")
        .iter()
        .filter(|row| text(row, "facilityCode") == ctx.facility_code)
        .count() as i64;
    let sequence = app
        .store
        .next_sequence(&format!("mr:{}", ctx.facility_code), floor)
        .map_err(|_| error(500, "Nomor rekam medis tidak dapat dialokasikan."))?;
    let generated = format!("RM-{initials}-{sequence:06}");
    let mr_number = default(body, "mrNumber", &generated).trim();
    if array(&app.db, "patients").iter().any(|row| {
        text(row, "facilityCode") == ctx.facility_code
            && text(row, "mrNumber").eq_ignore_ascii_case(mr_number)
    }) {
        return Err(conflict(
            "Nomor rekam medis sudah digunakan di fasilitas ini.",
        ));
    }
    Ok(
        json!({"id":id("pat"),"facilityCode":ctx.facility_code,"mrNumber":mr_number,"nik":nik,"bpjsNumber":text(body,"bpjsNumber").trim(),"ihsNumber":text(body,"ihsNumber").trim(),"fullName":name,"birthDate":birthday,"gender":text(body,"gender"),"bloodType":text(body,"bloodType"),"rhesus":text(body,"rhesus"),"phone":text(body,"phone").trim(),"address":text(body,"address").trim(),"allergies":str_array(body,"allergies"),"chronicConditions":str_array(body,"chronicConditions"),"emergencyContactName":text(body,"emergencyContactName").trim(),"emergencyContactPhone":text(body,"emergencyContactPhone").trim(),"createdAt":now()}),
    )
}

fn update_fields(
    app: &App,
    ctx: &RequestContext,
    patient: &mut Value,
    body: &Value,
) -> Result<(), ApiError> {
    if body.get("fullName").is_some() && text(body, "fullName").trim().is_empty() {
        return Err(bad_request("Nama lengkap pasien wajib diisi."));
    }
    if body.get("gender").is_some() && !["L", "P"].contains(&text(body, "gender")) {
        return Err(bad_request("Pilih jenis kelamin pasien yang sesuai."));
    }
    if body.get("birthDate").is_some()
        && chrono::NaiveDate::parse_from_str(text(body, "birthDate"), "%Y-%m-%d").is_err()
    {
        return Err(bad_request("Tanggal lahir pasien tidak valid."));
    }
    if let Some(value) = body.get("nik") {
        let nik = value.as_str().unwrap_or("").trim();
        if nik.len() != 16 || !nik.bytes().all(|c| c.is_ascii_digit()) {
            return Err(bad_request("NIK harus terdiri dari 16 digit."));
        }
        if array(&app.db, "patients").iter().any(|row| {
            text(row, "facilityCode") == ctx.facility_code
                && text(row, "nik") == nik
                && text(row, "id") != text(patient, "id")
        }) {
            return Err(conflict("NIK sudah digunakan pasien lain."));
        }
    }
    for key in [
        "fullName",
        "nik",
        "bpjsNumber",
        "ihsNumber",
        "birthDate",
        "gender",
        "bloodType",
        "rhesus",
        "phone",
        "address",
        "emergencyContactName",
        "emergencyContactPhone",
    ] {
        if let Some(value) = body.get(key) {
            if !value.is_string() {
                return Err(bad_request("Data identitas pasien harus berupa teks."));
            }
            patient[key] = json!(value.as_str().unwrap_or("").trim());
        }
    }
    for key in ["allergies", "chronicConditions"] {
        if body.get(key).is_some() {
            patient[key] = json!(str_array(body, key));
        }
    }
    Ok(())
}

fn replay(app: &App, ctx: &RequestContext, body: &Value, action: &str) -> Option<Value> {
    let key = text(body, "idempotencyKey").trim();
    if key.is_empty() {
        return None;
    }
    array(&app.db, "idempotencyRecords").iter().find(|row| {
        text(row, "key") == key && text(row, "facilityCode") == ctx.facility_code && text(row, "action") == action
    }).map(|row| row["response"].clone())
}

fn remember(app: &mut App, ctx: &RequestContext, body: &Value, action: &str, response: &Value) {
    let key = text(body, "idempotencyKey").trim();
    if key.is_empty() {
        return;
    }
    array_mut(&mut app.db, "idempotencyRecords").push(json!({
        "id": id("idem"),
        "idempotencyKey": key,
        "key": key,
        "facilityCode": ctx.facility_code,
        "action": action,
        "response": response,
        "createdAt": now()
    }));
}

fn create_patient(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["PENDAFTARAN", "SEMUA_PASIEN"],
        &["SUB_PATIENT_MPI"],
    )?;
    if let Some(previous) = replay(app, ctx, body, "MPI_PATIENT_CREATE") {
        return json_response(200, previous);
    }
    let patient = patient_data(app, ctx, body)?;
    array_mut(&mut app.db, "patients").push(patient.clone());
    audit(
        app,
        ctx,
        "MPI_PATIENT_CREATE",
        text(&patient, "mrNumber"),
        &format!("Registrasi pasien {}.", text(&patient, "fullName")),
    );
    remember(app, ctx, body, "MPI_PATIENT_CREATE", &patient);
    save(app)?;
    json_response(201, patient)
}
fn update_patient(
    app: &mut App,
    ctx: &RequestContext,
    patient_id: &str,
    body: &Value,
) -> ApiResult {
    require_service(
        app,
        ctx,
        &["PENDAFTARAN", "SEMUA_PASIEN"],
        &["SUB_PATIENT_MPI"],
    )?;
    let i = index(
        app,
        ctx,
        "patients",
        patient_id,
        "Data pasien tidak ditemukan di fasilitas ini.",
    )?;
    let mut patient = array(&app.db, "patients")[i].clone();
    update_fields(app, ctx, &mut patient, body)?;
    array_mut(&mut app.db, "patients")[i] = patient.clone();
    audit(
        app,
        ctx,
        "MPI_PATIENT_UPDATE",
        text(&patient, "mrNumber"),
        &format!("Pembaruan MPI pasien {}.", text(&patient, "fullName")),
    );
    save(app)?;
    json_response(200, patient)
}

fn vitals(body: &Value) -> Result<Value, ApiError> {
    let value = &body["vitals"];
    if !value.is_object()
        || [
            "systolic",
            "diastolic",
            "heartRate",
            "respiratoryRate",
            "temperature",
            "spo2",
            "weightKg",
            "heightCm",
            "gcsEye",
            "gcsVerbal",
            "gcsMotor",
            "painScale",
        ]
        .iter()
        .any(|key| value[*key].as_f64().map(|n| !n.is_finite()).unwrap_or(true))
    {
        return Err(bad_request(
            "Lengkapi hasil pengukuran tanda vital sebelum mendaftarkan kunjungan.",
        ));
    }
    if [("gcsEye", 4.0), ("gcsVerbal", 5.0), ("gcsMotor", 6.0)]
        .iter()
        .any(|(key, max)| {
            let score = n(value, key);
            score.fract() != 0.0 || score < 1.0 || score > *max
        })
        || !(0.0..=10.0).contains(&n(value, "painScale"))
    {
        return Err(bad_request("Skor GCS dan skala nyeri tidak valid."));
    }
    Ok(value.clone())
}

fn facility_snapshot(app: &App, ctx: &RequestContext) -> Value {
    let facility = array(&app.db, "facilities")
        .iter()
        .find(|entry| text(entry, "code") == ctx.facility_code)
        .cloned()
        .unwrap_or_else(|| json!({"code": ctx.facility_code}));
    active_config(&app.db, &facility)
}

fn visit_uses_bpjs(visit: &Value) -> bool {
    text(visit, "guarantorSettlement") == "BPJS" || text(visit, "guarantor") == "BPJS_KESEHATAN"
}

fn create_visit(app: &mut App, ctx: &RequestContext, body: &Value, unified: bool) -> ApiResult {
    let modules = if unified {
        vec!["PENDAFTARAN", "IGD_TRIASE_EWS"]
    } else {
        vec!["PENDAFTARAN", "SEMUA_PASIEN", "IGD_TRIASE_EWS"]
    };
    require_service(
        app,
        ctx,
        &modules,
        &["SUB_ADMISSION_OUTPATIENT", "SUB_ADMISSION_EMERGENCY"],
    )?;
    if let Some(previous) = replay(app, ctx, body, if unified { "VISIT_UNIFIED" } else { "VISIT_QUEUE" }) {
        return json_response(200, previous);
    }
    if text(body, "chiefComplaint").trim().is_empty() || text(body, "polyclinic").trim().is_empty()
    {
        return Err(bad_request(
            "Poliklinik tujuan dan Keluhan Utama wajib diisi.",
        ));
    }
    let vital_signs = vitals(body)?;
    let requested_doctor = text(body, "doctorId");
    let doctors: Vec<Value> = array(&app.db, "users")
        .iter()
        .filter(|user| is_practitioner(app, user, &ctx.facility_code))
        .cloned()
        .collect();
    let doctor = doctors
        .iter()
        .find(|user| text(user, "id") == requested_doctor)
        .cloned();
    if doctor.is_none() {
        return Err(bad_request(
            "Pilih tenaga pemeriksa klinis aktif yang terdaftar dan memiliki akses RME di fasilitas ini.",
        ));
    }
    let mut is_new = false;
    let patient = if unified {
        let mut incoming = body.clone();
        incoming["nik"] = json!(
            text(body, "nik")
                .chars()
                .filter(|c| c.is_ascii_digit())
                .collect::<String>()
        );
        let nik = text(&incoming, "nik");
        let requested_id = text(body, "patientId");
        let by_id = array(&app.db, "patients").iter().position(|patient| {
            !requested_id.is_empty()
                && text(patient, "facilityCode") == ctx.facility_code
                && text(patient, "id") == requested_id
        });
        let by_nik = array(&app.db, "patients").iter().position(|patient| {
            !nik.is_empty()
                && text(patient, "facilityCode") == ctx.facility_code
                && text(patient, "nik") == nik
        });
        if by_id.is_some() && by_nik.is_some() && by_id != by_nik {
            return Err(conflict("Nomor identitas dan pasien yang dipilih bukan orang yang sama. Pendaftaran dihentikan."));
        }
        let existing = by_id.or(by_nik);
        if let Some(i) = existing {
            let mut patient = array(&app.db, "patients")[i].clone();
            update_fields(app, ctx, &mut patient, &incoming)?;
            array_mut(&mut app.db, "patients")[i] = patient.clone();
            patient
        } else {
            if !text(body, "patientId").is_empty() {
                return Err(not_found("Pasien tidak ditemukan di fasilitas ini."));
            }
            is_new = true;
            let patient = patient_data(app, ctx, &incoming)?;
            array_mut(&mut app.db, "patients").push(patient.clone());
            patient
        }
    } else {
        let i = index(
            app,
            ctx,
            "patients",
            text(body, "patientId"),
            "Data pasien tidak ditemukan di fasilitas ini.",
        )?;
        array(&app.db, "patients")[i].clone()
    };
    let timestamp = now();
    let config = facility_snapshot(app, ctx);
    let poli = text(body, "polyclinic");
    let unit = array(&config, "units")
        .iter()
        .find(|unit| {
            text(unit, "unitCode") == poli
                && unit["active"] == true
                && ["RUANG_PRAKTIK", "POLIKLINIK_SPESIALIS", "IGD"].contains(&text(unit, "unitType"))
        })
        .cloned()
        .ok_or_else(|| {
            bad_request(
                "Unit tujuan belum dibuat superuser, nonaktif, atau bukan tujuan kunjungan.",
            )
        })?;
    let poli_prefix: String = poli
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(4)
        .collect();
    let poli_prefix = if poli_prefix.is_empty() {
        "REG".to_owned()
    } else {
        poli_prefix
    };
    let guarantor = text(body, "guarantor");
    let payer = array(&config, "guarantors")
        .iter()
        .find(|entry| text(entry, "code") == guarantor && entry["active"] == true)
        .cloned()
        .ok_or_else(|| bad_request("Penjamin belum dibuat superuser atau sudah nonaktif."))?;
    let settlement = text(&payer, "settlement");
    if settlement != "BPJS" && settlement != "PATIENT" {
        return Err(bad_request("Jenis penjamin tidak valid."));
    }
    let doctor = doctor.unwrap_or(Value::Null);
    let duties = doctor.get("polyclinics").and_then(Value::as_array).cloned().unwrap_or_default();
    if !duties.is_empty() && !duties.iter().any(|unit| unit.as_str() == Some(poli)) {
        return Err(bad_request("Tenaga pemeriksa tidak bertugas di unit tujuan ini."));
    }
    if array(&app.db, "visits").iter().any(|visit| {
        text(visit, "facilityCode") == ctx.facility_code
            && text(visit, "patientId") == text(&patient, "id")
            && !matches!(text(visit, "status"), "SELESAI" | "BATAL")
    }) {
        return Err(conflict("Pasien masih memiliki kunjungan aktif. Selesaikan atau batalkan kunjungan itu terlebih dahulu."));
    }
    if text(&unit, "unitType") == "IGD" {
        require_service(app, ctx, &["IGD_TRIASE_EWS"], &["SUB_ADMISSION_EMERGENCY"])?;
    } else {
        require_service(app, ctx, &["PENDAFTARAN", "SEMUA_PASIEN"], &["SUB_ADMISSION_OUTPATIENT"])?;
    }
    let business_day = crate::domain::business_date(chrono::Utc::now());
    let queued = array(&app.db, "visits")
        .iter()
        .filter(|visit| {
            text(visit, "facilityCode") == ctx.facility_code
                && text(visit, "polyclinic") == poli
                && (text(visit, "businessDate") == business_day || text(visit, "createdAt").starts_with(&business_day))
        })
        .count() as i64;
    let sequence = app
        .store
        .next_sequence(&format!("queue:{}:{poli}:{business_day}", ctx.facility_code), queued)
        .map_err(|_| error(500, "Nomor antrean tidak dapat dialokasikan."))?;
    let registration = format!(
        "REG/{}/{}/{:03}",
        prefix(&ctx.facility_code, 4),
        business_day.replace('-', ""),
        sequence
    );
    let visit = json!({"id":id("vis"),"facilityCode":ctx.facility_code,"queueNumber":format!("{poli_prefix}-{sequence:03}"),"registrationNumber":registration,"patientId":patient["id"],"patientName":patient["fullName"],"mrNumber":patient["mrNumber"],"nik":patient["nik"],"gender":patient["gender"],"birthDate":patient["birthDate"],"polyclinic":poli,"doctorId":text(&doctor,"id"),"doctorName":text(&doctor,"fullName"),"guarantor":guarantor,"guarantorSettlement":settlement,"bpjsSepOrPcareNo":if settlement=="BPJS"{body["bpjsSepOrPcareNo"].clone()}else{Value::Null},"triageLevel":auto_triage(&vital_signs),"status":"MENUNGGU","vitals":vital_signs,"chiefComplaint":text(body,"chiefComplaint").trim(),"businessDate":business_day,"createdAt":timestamp,"updatedAt":timestamp});
    array_mut(&mut app.db, "visits").push(visit.clone());
    if settlement == "BPJS" {
        let emergency = text(&unit, "unitType") == "IGD";
        array_mut(&mut app.db,"bridgingLogs").push(json!({"id":id("brg"),"facilityCode":ctx.facility_code,"targetSystem":if emergency{"BPJS_VCLAIM"}else{"BPJS_PCARE"},"resourceType":if emergency{"Penerbitan SEP IGD V-Claim Otomatis"}else{"Pendaftaran Kunjungan Peserta P-Care"},"referenceId":visit["id"],"patientName":patient["fullName"],"status":"QUEUED_LOCAL","externalId":"","latencyMs":0,"payloadPreview":{"registrationNumber":registration,"noKartu":patient["bpjsNumber"],"polyclinic":poli,"keluhan":visit["chiefComplaint"],"triage":visit["triageLevel"]},"timestamp":timestamp}));
    }
    audit(
        app,
        ctx,
        if unified {
            if is_new {
                "UNIFIED_NEW_PATIENT_AND_VISIT"
            } else {
                "UNIFIED_EXISTING_PATIENT_VISIT"
            }
        } else {
            "VISIT_QUEUE_REGISTER"
        },
        &registration,
        &format!(
            "Pendaftaran antrean {} untuk {}.",
            text(&visit, "queueNumber"),
            text(&patient, "fullName")
        ),
    );
    let response = if unified {
        json!({"patient":patient,"visit":visit,"isNewPatient":is_new})
    } else {
        visit.clone()
    };
    remember(app, ctx, body, if unified { "VISIT_UNIFIED" } else { "VISIT_QUEUE" }, &response);
    save(app)?;
    json_response(201, response)
}

fn visit_status(app: &mut App, ctx: &RequestContext, visit_id: &str, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["PENDAFTARAN", "RME_DOKTER", "IGD_TRIASE_EWS"],
        &["SUB_ADMISSION_OUTPATIENT", "SUB_ADMISSION_EMERGENCY"],
    )?;
    let i = index(app, ctx, "visits", visit_id, "Kunjungan tidak ditemukan.")?;
    let status = text(body, "status");
    if ![
        "MENUNGGU",
        "DIPERIKSA_PERAWAT",
        "DIPERIKSA_DOKTER",
        "FARMASI_LAB",
        "KASIR",
        "SELESAI",
        "BATAL",
    ]
    .contains(&status)
    {
        return Err(bad_request("Status kunjungan tidak valid."));
    }
    let mut visit = array(&app.db, "visits")[i].clone();
    let previous = text(&visit, "status");
    if matches!(previous, "SELESAI" | "BATAL") && status != previous {
        return Err(conflict("Kunjungan yang sudah selesai atau batal tidak dapat diubah mundur."));
    }
    if status == "BATAL" {
        for key in ["invoices", "pharmacyOrders", "labOrders", "radiologyOrders"] {
            for row in array_mut(&mut app.db, key) {
                if text(row, "visitId") != visit_id || text(row, "facilityCode") != ctx.facility_code {
                    continue;
                }
                let current = text(row, "status");
                if key == "invoices" && matches!(current, "LUNAS" | "KLAIM_DIAJUKAN" | "KLAIM_DISETUJUI") {
                    continue;
                }
                if !matches!(current, "BATAL" | "LUNAS" | "KLAIM_DIAJUKAN" | "KLAIM_DISETUJUI" | "SELESAI_VERIFIKASI" | "DISERAHKAN" | "EXPERTISE_VERIFIED") {
                    row["status"] = json!("BATAL");
                }
            }
        }
        let mut released_beds = Vec::new();
        for bed in array_mut(&mut app.db, "beds") {
            if text(bed, "facilityCode") == ctx.facility_code && text(bed, "visitId") == visit_id && text(bed, "status") == "TERISI" {
                released_beds.push(bed.clone());
                bed["status"] = json!("TERSEDIA");
                clear_bed(bed);
            }
        }
        for bed in released_beds {
            close_admission(&mut app.db, &bed);
        }
    }
    visit["status"] = json!(status);
    visit["updatedAt"] = json!(now());
    array_mut(&mut app.db, "visits")[i] = visit.clone();
    audit(
        app,
        ctx,
        "VISIT_STATUS_UPDATE",
        visit_id,
        &format!("Status kunjungan diperbarui menjadi {status}."),
    );
    save(app)?;
    json_response(200, visit)
}

fn create_bed(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(app, ctx, &["RAWAT_INAP"], &["SUB_INPATIENT_BED_MGMT"])?;
    if text(body, "bedCode").trim().is_empty() || text(body, "wardName").trim().is_empty() {
        return Err(bad_request(
            "Kode Bed dan Nama Ruangan/Bangsal wajib diisi.",
        ));
    }
    let code = text(body, "bedCode").trim().to_uppercase();
    if array(&app.db, "beds")
        .iter()
        .any(|row| text(row, "facilityCode") == ctx.facility_code && text(row, "bedCode") == code)
    {
        return Err(conflict("Kode tempat tidur sudah digunakan."));
    }
    let rate = n(body, "dailyRate");
    if !rate.is_finite()
        || rate < 0.0
        || !body["dailyRate"].is_number()
        || text(body, "bedClass").trim().is_empty()
    {
        return Err(bad_request("Tarif kamar tidak valid."));
    }
    let class_code = text(body, "bedClass").trim();
    let class_known = array(&facility_snapshot(app, ctx), "bedClasses")
        .iter()
        .any(|entry| text(entry, "code") == class_code && entry["active"] == true);
    if !class_known {
        return Err(bad_request(
            "Kelas kamar belum dibuat superuser atau sudah nonaktif.",
        ));
    }
    let bed = json!({"id":id("bed"),"facilityCode":ctx.facility_code,"wardName":text(body,"wardName").trim(),"roomNumber":default(body,"roomNumber",&code),"bedClass":class_code,"bedCode":code,"dailyRate":rate,"status":"TERSEDIA"});
    array_mut(&mut app.db, "beds").push(bed.clone());
    audit(
        app,
        ctx,
        "BED_MASTER_CREATE",
        &code,
        &format!("Penambahan tempat tidur {}.", text(&bed, "wardName")),
    );
    save(app)?;
    json_response(201, bed)
}
fn clear_bed(bed: &mut Value) {
    for key in [
        "patientId",
        "patientName",
        "mrNumber",
        "admittedAt",
        "attendingDoctor",
        "diagnosis",
        "admissionId",
        "visitId",
        "latestCppt",
    ] {
        if let Some(object) = bed.as_object_mut() {
            object.remove(key);
        }
    }
}

fn close_admission(db: &mut Value, bed: &Value) {
    let admission = text(bed, "admissionId");
    if admission.is_empty() {
        return;
    }
    let closed = now();
    for note in array_mut(db, "inpatientNotes") {
        if text(note, "admissionId") == admission && text(note, "closedAt").is_empty() {
            note["closedAt"] = json!(closed);
        }
    }
}

fn bill_occupied_bed(app: &mut App, ctx: &RequestContext, bed: &Value) {
    let patient_id = text(bed, "patientId");
    if patient_id.is_empty() {
        return;
    }
    let bed_visit_id = text(bed, "visitId");
    let matched = if !bed_visit_id.is_empty() {
        array(&app.db, "visits").iter().find(|visit| {
            text(visit, "facilityCode") == ctx.facility_code && text(visit, "id") == bed_visit_id
        }).cloned()
    } else {
        None
    }.or_else(|| {
        array(&app.db, "visits").iter().rev().find(|visit| {
            text(visit, "facilityCode") == ctx.facility_code && text(visit, "patientId") == patient_id
        }).cloned()
    });
    let guarantor = matched.as_ref().map(|visit| text(visit, "guarantor").to_owned()).unwrap_or_else(|| "UMUM".into());
    let settlement = matched.as_ref().map(|visit| text(visit, "guarantorSettlement").to_owned()).filter(|value| value == "BPJS").unwrap_or_else(|| "PATIENT".into());
    let visit_id = matched.as_ref().map(|visit| text(visit, "id").to_owned()).unwrap_or_default();
    let days = stay_days(&text(bed, "admittedAt")).max(1);
    crate::finance::append_service_charge(
        app,
        ctx,
        &visit_id,
        &patient_id,
        &text(bed, "patientName"),
        &text(bed, "mrNumber"),
        &guarantor,
        &settlement,
        "KAMAR_INAP",
        &format!("Kamar {} / {} ({} hari)", text(bed, "roomNumber"), text(bed, "bedClass"), days),
        days as f64,
        n(bed, "dailyRate"),
    );
}
fn bed_action(
    app: &mut App,
    ctx: &RequestContext,
    bed_id: &str,
    action: &str,
    body: &Value,
) -> ApiResult {
    require_service(app, ctx, &["RAWAT_INAP"], &["SUB_INPATIENT_BED_MGMT"])?;
    let i = index(app, ctx, "beds", bed_id, "Tempat tidur tidak ditemukan.")?;
    let mut bed = array(&app.db, "beds")[i].clone();
    match action {
        "assign" => {
            if text(&bed, "status") != "TERSEDIA" {
                return Err(conflict("Tempat tidur belum tersedia untuk admisi."));
            }
            let pi = index(
                app,
                ctx,
                "patients",
                text(body, "patientId"),
                "Pasien tidak ditemukan.",
            )?;
            let patient = array(&app.db, "patients")[pi].clone();
            let selected = text(body, "attendingDoctor").trim();
            let practitioner = array(&app.db, "users")
                .iter()
                .find(|user| {
                    is_practitioner(app, user, &ctx.facility_code)
                        && (text(user, "id") == selected || text(user, "fullName") == selected)
                })
                .cloned()
                .ok_or_else(|| {
                    bad_request(
                        "Pilih penanggung jawab klinis aktif yang terdaftar di fasilitas ini.",
                    )
                })?;
            if array(&app.db, "beds").iter().any(|other| {
                text(other, "facilityCode") == ctx.facility_code
                    && text(other, "patientId") == text(&patient, "id")
                    && text(other, "status") == "TERISI"
            }) {
                return Err(conflict("Pasien sudah menempati tempat tidur lain."));
            }
            bed["status"] = json!("TERISI");
            bed["admissionId"] = json!(id("adm"));
            bed["patientId"] = patient["id"].clone();
            bed["patientName"] = patient["fullName"].clone();
            bed["mrNumber"] = patient["mrNumber"].clone();
            bed["admittedAt"] = json!(now());
            bed["attendingDoctor"] = practitioner["fullName"].clone();
            bed["diagnosis"] = json!(text(body, "diagnosis").chars().take(4000).collect::<String>());
            let visit_id = array(&app.db, "visits")
                .iter()
                .rev()
                .find(|visit| {
                    text(visit, "facilityCode") == ctx.facility_code
                        && text(visit, "patientId") == text(&patient, "id")
                        && !matches!(text(visit, "status"), "SELESAI" | "BATAL")
                })
                .map(|visit| text(visit, "id").to_owned())
                .unwrap_or_default();
            bed["visitId"] = json!(visit_id);
            bed["latestCppt"] = Value::Null;
        }
        "discharge" => {
            bill_occupied_bed(app, ctx, &bed);
            close_admission(&mut app.db, &bed);
            bed["status"] = json!("TERSEDIA");
            clear_bed(&mut bed);
        }
        _ => {
            let status = text(body, "status");
            if !status.is_empty() {
                if !["TERSEDIA", "TERISI", "DIBERSIHKAN", "MAINTENANCE"].contains(&status) {
                    return Err(bad_request("Status tempat tidur tidak valid."));
                }
                if status != "TERISI" {
                    if text(&bed, "status") == "TERISI" {
                        bill_occupied_bed(app, ctx, &bed);
                        close_admission(&mut app.db, &bed);
                    }
                    bed["status"] = json!(status);
                    clear_bed(&mut bed);
                }
            }
            if text(&bed, "status") == "TERISI" {
                if let Some(selected) = body.get("attendingDoctor") {
                    let selected = selected
                        .as_str()
                        .ok_or_else(|| bad_request("Penanggung jawab klinis tidak valid."))?
                        .trim();
                    let practitioner = array(&app.db, "users").iter().find(|user| {
                        is_practitioner(app, user, &ctx.facility_code)
                            && (text(user, "id") == selected || text(user, "fullName") == selected)
                    }).cloned().ok_or_else(|| bad_request("Pilih penanggung jawab klinis aktif yang terdaftar di fasilitas ini."))?;
                    bed["attendingDoctor"] = practitioner["fullName"].clone();
                }
                if let Some(value) = body.get("cpptNote").filter(|value| value.is_string()) {
                    let note = value.as_str().unwrap_or("").trim();
                    if !note.is_empty() {
                        if text(&bed, "admissionId").is_empty() {
                            bed["admissionId"] = json!(id("adm"));
                        }
                        let stored: String = note.chars().take(4000).collect();
                        array_mut(&mut app.db, "inpatientNotes").push(json!({
                            "id": id("cppt"),
                            "admissionId": text(&bed, "admissionId"),
                            "patientId": text(&bed, "patientId"),
                            "visitId": text(&bed, "visitId"),
                            "bedId": text(&bed, "id"),
                            "bedCode": text(&bed, "bedCode"),
                            "facilityCode": ctx.facility_code,
                            "note": stored,
                            "author": text(&ctx.user, "fullName"),
                            "createdAt": now()
                        }));
                        bed["latestCppt"] = json!(stored);
                    }
                } else if let Some(value) = body.get("diagnosis").filter(|value| value.is_string()) {
                    bed["diagnosis"] = json!(value.as_str().unwrap_or("").trim().chars().take(4000).collect::<String>());
                }
            }
        }
    }
    array_mut(&mut app.db, "beds")[i] = bed.clone();
    audit(
        app,
        ctx,
        match action {
            "assign" => "BED_ADMISSION",
            "discharge" => "BED_DISCHARGE",
            _ => "BED_STATUS_UPDATE",
        },
        text(&bed, "bedCode"),
        &format!("Pembaruan tempat tidur: {}.", text(&bed, "status")),
    );
    save(app)?;
    json_response(200, bed)
}

fn parameters(codes: &[Value], tariffs: &Value) -> Result<Vec<Value>, ApiError> {
    let templates = lab_templates();
    let mut selected = vec![];
    for code in codes {
        let mut template = templates
            .iter()
            .find(|item| item["code"] == *code)
            .cloned()
            .ok_or_else(|| bad_request("Kode parameter laboratorium tidak dikenal."))?;
        template["value"] = Value::Null;
        template["flag"] = json!("PENDING");
        template["referenceVerified"] = json!(false);
        let tariff = tariffs.get(code.as_str().unwrap_or(""));
        if let Some(value) = tariff {
            if !value
                .as_f64()
                .is_some_and(|number| number.is_finite() && number >= 0.0)
            {
                return Err(bad_request(
                    "Tarif laboratorium harus berupa angka nonnegatif atau belum diisi.",
                ));
            }
        }
        template["tariff"] = tariff.cloned().unwrap_or(Value::Null);
        template["pricingStatus"] = json!(if tariff.is_some() {
            "COMPLETE"
        } else {
            "PENDING"
        });
        selected.push(template);
    }
    Ok(selected)
}
fn lab_record(
    ctx: &RequestContext,
    visit: &Value,
    params: Vec<Value>,
    notes: &str,
    status: &str,
) -> Value {
    json!({"id":id("lab"),"facilityCode":ctx.facility_code,"visitId":visit["id"],"patientId":visit["patientId"],"patientName":visit["patientName"],"mrNumber":visit["mrNumber"],"gender":visit["gender"],"doctorName":visit["doctorName"],"specimenCode":id("SPEC"),"clinicalNotes":notes,"status":status,"parameters":params,"createdAt":now()})
}
fn create_lab(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["LABORATORIUM", "RME_DOKTER"],
        &["SUB_LAB_PATHOLOGY"],
    )?;
    let vi = index(
        app,
        ctx,
        "visits",
        text(body, "visitId"),
        "Kunjungan pasien tidak ditemukan.",
    )?;
    let visit = array(&app.db, "visits")[vi].clone();
    let codes = array(body, "panelCodes");
    if codes.is_empty() || codes.len() > 200 {
        return Err(bad_request("Pilih parameter pemeriksaan laboratorium, maksimal 200."));
    }
    let notes = default(body, "clinicalNotes", text(&visit, "chiefComplaint")).chars().take(4000).collect::<String>();
    let mut order = lab_record(
        ctx,
        &visit,
        parameters(codes, &body["tariffs"])?,
        &notes,
        "PERMINTAAN_BARU",
    );
    order["billingStatus"] = json!("NOT_BILLED");
    order["source"] = json!("MANUAL");
    if let Some(price) = body.get("tariff").and_then(|value| value.as_f64()).filter(|price| price.is_finite() && *price >= 0.0) {
        crate::finance::append_service_charge(app, ctx, &text(&visit, "id"), &text(&visit, "patientId"), &text(&visit, "patientName"), &text(&visit, "mrNumber"), &text(&visit, "guarantor"), &text(&visit, "guarantorSettlement"), "LABORATORIUM", "Pemeriksaan laboratorium", 1.0, price);
        order["billingStatus"] = json!("BILLED");
    }
    array_mut(&mut app.db, "labOrders").push(order.clone());
    audit(
        app,
        ctx,
        "LAB_ORDER_CREATED",
        text(&order, "specimenCode"),
        &format!(
            "Permintaan laboratorium untuk {}.",
            text(&visit, "patientName")
        ),
    );
    save(app)?;
    json_response(201, order)
}
fn verify_lab(app: &mut App, ctx: &RequestContext, order_id: &str, body: &Value) -> ApiResult {
    require_service(app, ctx, &["LABORATORIUM"], &["SUB_LAB_PATHOLOGY"])?;
    let i = index(
        app,
        ctx,
        "labOrders",
        order_id,
        "Order laboratorium tidak ditemukan.",
    )?;
    let mut order = array(&app.db, "labOrders")[i].clone();
    if text(&order, "status") == "SELESAI_VERIFIKASI" {
        return Err(conflict("Hasil laboratorium yang sudah diverifikasi tidak dapat ditimpa. Ajukan koreksi sebagai revisi terpisah."));
    }
    for parameter in array_mut(&mut order, "parameters") {
        let incoming = array(body, "parameters")
            .iter()
            .find(|entry| text(entry, "code") == text(parameter, "code"))
            .ok_or_else(|| {
                bad_request("Isi seluruh hasil pengukuran parameter sebelum verifikasi.")
            })?;
        let value = incoming["value"]
            .as_f64()
            .filter(|v| v.is_finite())
            .ok_or_else(|| {
                bad_request("Hasil pengukuran laboratorium harus berupa angka yang valid.")
            })?;
        parameter["value"] = json!(value);
        let verified = incoming["referenceVerified"].as_bool() == Some(true);
        let minimum = incoming["refMin"]
            .as_f64()
            .filter(|value| value.is_finite());
        let maximum = incoming["refMax"]
            .as_f64()
            .filter(|value| value.is_finite());
        let source = text(incoming, "referenceSource").trim();
        if verified
            && (minimum.is_none() || maximum.is_none() || source.is_empty() || minimum > maximum)
        {
            return Err(bad_request(
                "Rentang rujukan terverifikasi membutuhkan batas minimum/maksimum yang valid dan sumber rujukan.",
            ));
        }
        let mut critical = [None, None];
        for (index, key) in ["criticalMin", "criticalMax"].iter().enumerate() {
            if let Some(threshold) = incoming.get(*key).filter(|value| !value.is_null()) {
                critical[index] = Some(
                    threshold
                        .as_f64()
                        .filter(|value| value.is_finite())
                        .ok_or_else(|| {
                            bad_request("Ambang kritis harus berupa angka yang valid.")
                        })?,
                );
            }
        }
        if critical[0]
            .zip(critical[1])
            .is_some_and(|(low, high)| low > high)
        {
            return Err(bad_request(
                "Ambang kritis minimum tidak boleh melebihi maksimum.",
            ));
        }
        parameter["referenceVerified"] = json!(verified);
        parameter["referenceSource"] = json!(source);
        parameter["methodPopulation"] = json!(text(incoming, "methodPopulation").trim());
        parameter["refMin"] = if verified {
            json!(minimum)
        } else {
            Value::Null
        };
        parameter["refMax"] = if verified {
            json!(maximum)
        } else {
            Value::Null
        };
        parameter["criticalMin"] = if verified {
            json!(critical[0])
        } else {
            Value::Null
        };
        parameter["criticalMax"] = if verified {
            json!(critical[1])
        } else {
            Value::Null
        };
        parameter["flag"] = json!(if verified {
            lab_flag(
                value,
                minimum.unwrap(),
                maximum.unwrap(),
                critical[0],
                critical[1],
            )
        } else {
            "UNASSESSED".into()
        });
    }
    if let Some(notes) = body.get("clinicalNotes") {
        order["clinicalNotes"] = notes.clone();
    }
    order["status"] = json!("SELESAI_VERIFIKASI");
    order["verifiedBy"] = ctx.user["fullName"].clone();
    order["verifiedAt"] = json!(now());
    let pending = array(&app.db, "pharmacyOrders").iter().any(|rx| {
        text(rx, "visitId") == text(&order, "visitId")
            && text(rx, "facilityCode") == ctx.facility_code
            && !matches!(text(rx, "status"), "DISERAHKAN" | "BATAL")
    });
    let support_open = array(&app.db, "labOrders").iter().any(|other| {
        text(other, "id") != text(&order, "id")
            && text(other, "visitId") == text(&order, "visitId")
            && text(other, "facilityCode") == ctx.facility_code
            && !matches!(text(other, "status"), "SELESAI_VERIFIKASI" | "BATAL")
    }) || array(&app.db, "radiologyOrders").iter().any(|other| {
        text(other, "visitId") == text(&order, "visitId")
            && text(other, "facilityCode") == ctx.facility_code
            && !matches!(text(other, "status"), "EXPERTISE_VERIFIED" | "BATAL")
    });
    if !pending && !support_open {
        for visit in array_mut(&mut app.db, "visits").iter_mut().filter(|visit| {
            text(visit, "id") == text(&order, "visitId")
                && text(visit, "facilityCode") == ctx.facility_code
                && text(visit, "status") == "FARMASI_LAB"
        }) {
            visit["status"] = json!("KASIR");
            visit["updatedAt"] = json!(now());
        }
    }
    array_mut(&mut app.db, "labOrders")[i] = order.clone();
    audit(
        app,
        ctx,
        "LAB_RESULT_VERIFIED",
        text(&order, "specimenCode"),
        &format!(
            "Verifikasi hasil laboratorium untuk {}.",
            text(&order, "patientName")
        ),
    );
    save(app)?;
    json_response(200, order)
}

fn soap(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(app, ctx, &["RME_DOKTER"], &["SUB_OUTPATIENT_SOAP_CPPT"])?;
    let vi = index(
        app,
        ctx,
        "visits",
        text(body, "visitId"),
        "Data kunjungan pasien tidak ditemukan.",
    )?;
    let mut visit = array(&app.db, "visits")[vi].clone();
    if matches!(text(&visit, "status"), "BATAL" | "SELESAI") {
        return Err(conflict("Kunjungan yang batal atau selesai tidak dapat ditandatangani ulang."));
    }
    if !is_practitioner(app, &ctx.user, &ctx.facility_code) {
        return Err(forbidden("Hanya tenaga pemeriksa yang tercatat yang dapat menandatangani rekam medis."));
    }
    let pi = index(
        app,
        ctx,
        "patients",
        text(&visit, "patientId"),
        "Data rekam medis pasien tidak ditemukan.",
    )?;
    let patient = array(&app.db, "patients")[pi].clone();
    if text(&body["assessment"], "primaryIcd10Code")
        .trim()
        .is_empty()
        || text(&body["subjective"], "chiefComplaint")
            .trim()
            .is_empty()
        || !body["objective"]["vitals"].is_object()
        || ["prescriptions", "procedures", "labRequestedParams"]
            .iter()
            .any(|key| !body["plan"][*key].is_array())
    {
        return Err(bad_request(
            "Keluhan utama, diagnosis primer ICD-10, tanda vital, dan rencana pelayanan wajib diisi dengan benar.",
        ));
    }
    let vital_signs = vitals(&json!({"vitals":body["objective"]["vitals"]}))?;
    let mut plan = body["plan"].clone();
    let mut validated_prescriptions = Vec::new();
    for prescription in array(&body["plan"], "prescriptions") {
        let qty = n(prescription, "quantity");
        if !qty.is_finite() || qty <= 0.0 {
            return Err(bad_request("Kuantitas resep tidak valid."));
        }
        let catalog_med = array(&app.db, "medications").iter().find(|med| {
            text(med, "facilityCode") == ctx.facility_code
                && (text(med, "id") == text(prescription, "medicationId")
                    || text(med, "code") == text(prescription, "medicationCode"))
        }).cloned().ok_or_else(|| {
            bad_request("Obat dalam resep harus terdaftar di katalog fasilitas ini.")
        })?;
        let catalog_price = n(&catalog_med, "sellPrice");
        let price = if catalog_price.is_finite() && catalog_price >= 0.0 {
            catalog_price
        } else {
            n(prescription, "unitPrice")
        };
        if !price.is_finite() || price < 0.0 || !(qty * price).is_finite() {
            return Err(bad_request("Kuantitas dan harga resep tidak valid."));
        }
        let mut item = prescription.clone();
        item["unitPrice"] = json!(price);
        validated_prescriptions.push(item);
    }
    if let Some(plan_obj) = plan.as_object_mut() {
        plan_obj.insert("prescriptions".into(), json!(validated_prescriptions));
    }
    for procedure in array(&body["plan"], "procedures") {
        if procedure.get("tariff").is_some_and(|value| {
            !value.is_null()
                && !value
                    .as_f64()
                    .is_some_and(|number| number.is_finite() && number >= 0.0)
        }) {
            return Err(bad_request("Tarif tindakan tidak valid."));
        }
    }
    let si = array(&app.db, "soapRecords").iter().position(|row| {
        text(row, "visitId") == text(&visit, "id") && text(row, "facilityCode") == ctx.facility_code
    });
    let existing = si.map(|i| array(&app.db, "soapRecords")[i].clone());
    let timestamp = now();
    let incoming = json!({"id":existing.as_ref().map(|row|row["id"].clone()).unwrap_or_else(||json!(id("soap"))),"visitId":visit["id"],"facilityCode":ctx.facility_code,"patientId":patient["id"],"doctorId":ctx.user["id"],"doctorName":ctx.user["fullName"],"recordedAt":existing.as_ref().map(|row|row["recordedAt"].clone()).unwrap_or_else(||json!(timestamp)),"subjective":body["subjective"],"objective":body["objective"],"assessment":body["assessment"],"plan":plan,"satusehatEncounterId":existing.as_ref().map(|row|row["satusehatEncounterId"].clone()).unwrap_or_else(||json!("")),"syncedToSatusehat":false});
    let reason = text(body, "correctionReason").trim();
    let record = apply_clinical_record(existing.as_ref(), &incoming, &ctx.user, reason, &timestamp)
        .map_err(|message| {
            if message.starts_with("Otorisasi klinis ditolak") {
                forbidden(message)
            } else {
                conflict(message)
            }
        })?;
    let ii = array(&app.db, "invoices").iter().position(|row| {
        text(row, "visitId") == text(&visit, "id") && text(row, "facilityCode") == ctx.facility_code
    });
    let prior_invoice = ii.map(|i| array(&app.db, "invoices")[i].clone());
    if let Some(invoice) = &prior_invoice {
        if text(invoice, "status") != "BELUM_LUNAS"
            && existing
                .as_ref()
                .map(|old| old["plan"] != record["plan"])
                .unwrap_or(false)
        {
            return Err(conflict(
                "Rencana layanan pada tagihan yang telah diselesaikan tidak dapat diubah melalui pembaruan SOAP.",
            ));
        }
    }
    if let Some(old) = &existing {
        let mut revision = old.clone();
        revision["revisedAt"] = json!(timestamp);
        revision["revisedBy"] = ctx.user["id"].clone();
        revision["reason"] = json!(reason);
        array_mut(&mut app.db, "soapRevisions").push(revision);
    }
    if text(&ctx.user, "id") != text(&visit, "doctorId") {
        visit["handoffFromDoctorId"] = visit["doctorId"].clone();
        visit["handoffToDoctorId"] = ctx.user["id"].clone();
        visit["handoffAt"] = json!(timestamp);
    }
    if let Some(i) = si {
        array_mut(&mut app.db, "soapRecords")[i] = record.clone();
    } else {
        array_mut(&mut app.db, "soapRecords").push(record.clone());
    }
    if text(&record, "recordStatus") == "ADDENDUM_APPENDED"
        || prior_invoice
            .as_ref()
            .map(|invoice| text(invoice, "status") != "BELUM_LUNAS")
            .unwrap_or(false)
    {
        array_mut(&mut app.db, "visits")[vi] = visit.clone();
        audit(
            app,
            ctx,
            "RME_SOAP_AMENDMENT",
            text(&visit, "registrationNumber"),
            "Pengesahan koreksi/addendum rekam medis dengan riwayat perubahan tetap tersimpan.",
        );
        save(app)?;
        return json_response(
            201,
            json!({"soapRecord":record,"visit":visit,"invoice":prior_invoice.unwrap_or(Value::Null)}),
        );
    }
    let prescriptions = array(&record["plan"], "prescriptions").clone();
    let procedures = array(&record["plan"], "procedures").clone();
    let lab_codes = array(&record["plan"], "labRequestedParams").clone();
    let lab_params = parameters(&lab_codes, &body["pricing"]["labTariffs"])?;
    visit["vitals"] = vital_signs.clone();
    visit["soapId"] = record["id"].clone();
    visit["triageLevel"] = json!(auto_triage(&vital_signs));
    visit["status"] = json!(if !prescriptions.is_empty() || !lab_params.is_empty() {
        "FARMASI_LAB"
    } else {
        "KASIR"
    });
    visit["updatedAt"] = json!(timestamp);
    let poi = array(&app.db, "pharmacyOrders").iter().position(|order| {
        text(order, "visitId") == text(&visit, "id")
            && text(order, "facilityCode") == ctx.facility_code
    });
    if let Some(i) = poi {
        let order = array(&app.db, "pharmacyOrders")[i].clone();
        if text(&order, "status") != "ANTRIAN_RESEP" && order["items"] != json!(prescriptions) {
            return Err(conflict(
                "Resep yang sudah diproses farmasi tidak dapat diganti melalui SOAP.",
            ));
        }
        if text(&order, "status") == "ANTRIAN_RESEP" {
            if prescriptions.is_empty() {
                array_mut(&mut app.db, "pharmacyOrders").remove(i);
            } else {
                array_mut(&mut app.db, "pharmacyOrders")[i]["items"] = json!(prescriptions);
            }
        }
    } else if !prescriptions.is_empty() {
        array_mut(&mut app.db,"pharmacyOrders").push(json!({"id":id("pho"),"facilityCode":ctx.facility_code,"visitId":visit["id"],"patientId":patient["id"],"patientName":patient["fullName"],"mrNumber":patient["mrNumber"],"doctorName":record["doctorName"],"allergies":patient["allergies"],"items":prescriptions,"status":"ANTRIAN_RESEP","dispensedBatches":[],"createdAt":timestamp}));
    }
    let li = array(&app.db, "labOrders").iter().position(|order| {
        text(order, "visitId") == text(&visit, "id")
            && text(order, "facilityCode") == ctx.facility_code
            && text(order, "source") == "SOAP"
    });
    if let Some(i) = li {
        let order = array(&app.db, "labOrders")[i].clone();
        let old_codes: Vec<Value> = array(&order, "parameters")
            .iter()
            .map(|p| p["code"].clone())
            .collect();
        if text(&order, "status") == "SELESAI_VERIFIKASI" && old_codes != lab_codes {
            return Err(conflict(
                "Permintaan laboratorium terverifikasi tidak dapat diganti melalui SOAP.",
            ));
        }
        if text(&order, "status") != "SELESAI_VERIFIKASI" {
            if lab_params.is_empty() {
                array_mut(&mut app.db, "labOrders").remove(i);
            } else {
                array_mut(&mut app.db, "labOrders")[i]["parameters"] = json!(lab_params);
            }
        }
    } else if !lab_params.is_empty() {
        let notes = format!(
            "{} - {}",
            text(&record["assessment"], "primaryIcd10Code"),
            text(&record["assessment"], "primaryIcd10Name")
        );
        let mut order = lab_record(ctx, &visit, lab_params.clone(), &notes, "PERMINTAAN_BARU");
        order["source"] = json!("SOAP");
        array_mut(&mut app.db, "labOrders").push(order);
    }
    let mut items = vec![];
    let mut unpriced_items = vec![];
    let prior_items = prior_invoice
        .as_ref()
        .map(|invoice| array(invoice, "items").to_vec())
        .unwrap_or_default();
    let mut quote = |key: &str,
                     category: &str,
                     description: String,
                     quantity: f64,
                     price: &Value|
     -> Result<(), ApiError> {
        if price.is_null() {
            unpriced_items.push(json!({"key":key,"category":category,"description":description,"quantity":quantity}));
        } else if let Some(tariff) = price
            .as_f64()
            .filter(|number| number.is_finite() && *number >= 0.0)
        {
            let reused = prior_items.iter().find(|item| text(item, "key") == key).map(|item| item["id"].clone());
            items.push(json!({"id":reused.unwrap_or_else(|| json!(id("bli"))),"key":key,"category":category,"description":description,"quantity":quantity,"unitPrice":tariff.round(),"subtotal":(quantity*tariff.round()).round()}));
        } else {
            return Err(bad_request(
                "Tarif layanan harus berupa angka nonnegatif atau belum diisi.",
            ));
        }
        Ok(())
    };
    quote(
        "registration",
        "PENDAFTARAN",
        "Pendaftaran pasien".into(),
        1.0,
        &body["pricing"]["registrationFee"],
    )?;
    quote(
        "consultation",
        "KONSULTASI",
        "Konsultasi pemeriksa".into(),
        1.0,
        &body["pricing"]["consultationFee"],
    )?;
    for (index, procedure) in procedures.iter().enumerate() {
        quote(
            &format!("procedure-{index}"),
            "TINDAKAN",
            format!(
                "{} - {}",
                text(procedure, "icd9Code"),
                text(procedure, "name")
            ),
            1.0,
            &procedure["tariff"],
        )?;
    }
    for prescription in prescriptions {
        let qty = n(&prescription, "quantity");
        let price = n(&prescription, "unitPrice");
        quote(
            &format!("rx-{}", text(&prescription, "medicationId")),
            "FARMASI",
            format!(
                "{} ({} {})",
                text(&prescription, "medicationName"),
                qty,
                text(&prescription, "unit")
            ),
            qty,
            &json!(price),
        )?;
    }
    for parameter in lab_params {
        quote(
            &format!("lab-{}", text(&parameter, "code")),
            "LABORATORIUM",
            format!("Pemeriksaan Lab: {}", text(&parameter, "name")),
            1.0,
            &parameter["tariff"],
        )?;
    }
    if let Some(previous) = &prior_invoice {
        for item in array(previous, "items") {
            let category = text(item, "category");
            if matches!(category, "KAMAR_INAP" | "RADIOLOGI" | "LAINNYA") || text(item, "source") == "MANUAL" {
                items.push(item.clone());
            }
        }
    }
    let bpjs = visit_uses_bpjs(&visit);
    let totals = invoice_totals(&items, bpjs, 0.0);
    if !totals["subtotal"]
        .as_f64()
        .is_some_and(|subtotal| subtotal.is_finite())
    {
        return Err(bad_request(
            "Total rincian tarif melebihi batas angka yang dapat dicatat.",
        ));
    }
    let invoice_number = prior_invoice
        .as_ref()
        .map(|invoice| text(invoice, "invoiceNumber").to_owned())
        .unwrap_or_else(|| {
            format!(
                "INV/{}/{}/{:04}",
                prefix(&ctx.facility_code, 4),
                timestamp[..10].replace('-', ""),
                crate::http::next_document(
                    array(&app.db, "invoices"),
                    "invoiceNumber",
                    &format!(
                        "INV/{}/{}/",
                        prefix(&ctx.facility_code, 4),
                        timestamp[..10].replace('-', "")
                    ),
                )
            )
        });
    let mut invoice = json!({"id":prior_invoice.as_ref().map(|row|row["id"].clone()).unwrap_or_else(||json!(id("inv"))),"facilityCode":ctx.facility_code,"invoiceNumber":invoice_number,"visitId":visit["id"],"patientId":patient["id"],"patientName":patient["fullName"],"mrNumber":patient["mrNumber"],"guarantor":visit["guarantor"],"guarantorSettlement":if bpjs {json!("BPJS")} else {json!("PATIENT")},"items":items,"unpricedItems":unpriced_items,"pricingStatus":if unpriced_items.is_empty(){"COMPLETE"}else{"PENDING"},"subtotal":totals["subtotal"],"discountAmount":totals["discountAmount"],"bpjsCoveredAmount":totals["bpjsCoveredAmount"],"patientPayableAmount":totals["patientPayableAmount"],"paymentMethod":Value::Null,"status":"BELUM_LUNAS","createdAt":prior_invoice.as_ref().map(|row|row["createdAt"].clone()).unwrap_or_else(||json!(timestamp))});
    if existing
        .as_ref()
        .is_some_and(|old| old["plan"] == record["plan"])
    {
        if let Some(previous) = prior_invoice
            .as_ref()
            .filter(|old| text(old, "pricingSource") == "MANUAL")
        {
            invoice = previous.clone();
        }
    }
    invoice["claimRequestedAmount"] = if bpjs {
        json!((n(&invoice, "subtotal") - n(&invoice, "discountAmount")).max(0.0))
    } else {
        json!(0)
    };
    if let Some(i) = ii {
        array_mut(&mut app.db, "invoices")[i] = invoice.clone();
    } else {
        array_mut(&mut app.db, "invoices").push(invoice.clone());
    }
    array_mut(&mut app.db, "visits")[vi] = visit.clone();
    array_mut(&mut app.db,"bridgingLogs").push(json!({"id":id("brg-ss"),"facilityCode":ctx.facility_code,"targetSystem":"SATUSEHAT_FHIR_R4","resourceType":"Bundle (Encounter, Condition ICD-10, Observation Vitals, MedicationRequest)","referenceId":visit["id"],"patientName":patient["fullName"],"status":"QUEUED_LOCAL","externalId":"","latencyMs":0,"payloadPreview":{"resourceType":"Bundle","type":"transaction","localVisitId":visit["id"],"patientIhs":patient["ihsNumber"],"practitionerName":record["doctorName"],"icd10Primary":record["assessment"]["primaryIcd10Code"],"icd10Display":record["assessment"]["primaryIcd10Name"],"vitals":vital_signs,"prescriptionCount":array(&record["plan"],"prescriptions").len()},"timestamp":timestamp}));
    audit(
        app,
        ctx,
        "RME_SOAP_FINALIZE",
        text(&visit, "registrationNumber"),
        &format!(
            "Finalisasi RME SOAP pasien {} dengan diagnosis {}.",
            text(&patient, "fullName"),
            text(&record["assessment"], "primaryIcd10Code")
        ),
    );
    save(app)?;
    json_response(
        201,
        json!({"soapRecord":record,"visit":visit,"invoice":invoice}),
    )
}
