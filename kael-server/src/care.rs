use crate::domain::{apply_clinical_record, auto_triage, invoice_totals, lab_flag, lab_templates};
use crate::http::{
    ApiError, ApiResult, App, RequestContext, array, array_mut, audit, bad_request, conflict,
    forbidden, id, is_practitioner, json_response, not_found, now, require_service, save, text,
};
use serde_json::{Value, json};

fn n(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .or_else(|| value[key].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
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

fn patient_data(app: &App, ctx: &RequestContext, body: &Value) -> Result<Value, ApiError> {
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
    let mut sequence = array(&app.db, "patients")
        .iter()
        .filter(|row| text(row, "facilityCode") == ctx.facility_code)
        .count()
        + 1;
    let generated = loop {
        let candidate = format!("RM-{initials}-{sequence:06}");
        if !array(&app.db, "patients").iter().any(|row| {
            text(row, "facilityCode") == ctx.facility_code && text(row, "mrNumber") == candidate
        }) {
            break candidate;
        }
        sequence += 1;
    };
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

fn create_patient(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["PENDAFTARAN", "SEMUA_PASIEN"],
        &["SUB_PATIENT_MPI"],
    )?;
    let patient = patient_data(app, ctx, body)?;
    array_mut(&mut app.db, "patients").insert(0, patient.clone());
    audit(
        app,
        ctx,
        "MPI_PATIENT_CREATE",
        text(&patient, "mrNumber"),
        &format!("Registrasi pasien {}.", text(&patient, "fullName")),
    );
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
        let existing = array(&app.db, "patients").iter().position(|patient| {
            text(patient, "facilityCode") == ctx.facility_code
                && ((!text(body, "patientId").is_empty()
                    && text(patient, "id") == text(body, "patientId"))
                    || text(patient, "nik") == text(&incoming, "nik"))
        });
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
            array_mut(&mut app.db, "patients").insert(0, patient.clone());
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
    let sequence = array(&app.db, "visits")
        .iter()
        .filter(|visit| text(visit, "facilityCode") == ctx.facility_code)
        .count()
        + 1;
    let poli = text(body, "polyclinic");
    let poli_prefix = match poli {
        "IGD" => "IGD",
        "POLI_GIGI" => "GIGI",
        "POLI_ANAK" => "ANK",
        _ => "PD",
    };
    let timestamp = now();
    let registration = format!(
        "REG/{}/{}/{sequence:03}",
        prefix(&ctx.facility_code, 4),
        timestamp[..10].replace('-', "")
    );
    let guarantor = text(body, "guarantor");
    if !["UMUM", "BPJS_KESEHATAN", "ASURANSI_SWASTA", "KORPORASI"].contains(&guarantor) {
        return Err(bad_request("Jenis penjamin tidak valid."));
    }
    let doctor = doctor.unwrap_or(Value::Null);
    let visit = json!({"id":id("vis"),"facilityCode":ctx.facility_code,"queueNumber":format!("{poli_prefix}-{sequence:03}"),"registrationNumber":registration,"patientId":patient["id"],"patientName":patient["fullName"],"mrNumber":patient["mrNumber"],"nik":patient["nik"],"gender":patient["gender"],"birthDate":patient["birthDate"],"polyclinic":poli,"doctorId":text(&doctor,"id"),"doctorName":text(&doctor,"fullName"),"guarantor":guarantor,"bpjsSepOrPcareNo":if guarantor=="BPJS_KESEHATAN"{body["bpjsSepOrPcareNo"].clone()}else{Value::Null},"triageLevel":auto_triage(&vital_signs),"status":"MENUNGGU","vitals":vital_signs,"chiefComplaint":text(body,"chiefComplaint").trim(),"createdAt":timestamp,"updatedAt":timestamp});
    array_mut(&mut app.db, "visits").insert(0, visit.clone());
    if guarantor == "BPJS_KESEHATAN" {
        array_mut(&mut app.db,"bridgingLogs").insert(0,json!({"id":id("brg"),"facilityCode":ctx.facility_code,"targetSystem":if poli=="IGD"{"BPJS_VCLAIM"}else{"BPJS_PCARE"},"resourceType":if poli=="IGD"{"Penerbitan SEP IGD V-Claim Otomatis"}else{"Pendaftaran Kunjungan Peserta P-Care"},"referenceId":visit["id"],"patientName":patient["fullName"],"status":"QUEUED_LOCAL","externalId":"","latencyMs":0,"payloadPreview":{"registrationNumber":registration,"noKartu":patient["bpjsNumber"],"polyclinic":poli,"keluhan":visit["chiefComplaint"],"triage":visit["triageLevel"]},"timestamp":timestamp}));
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
    save(app)?;
    json_response(
        201,
        if unified {
            json!({"patient":patient,"visit":visit,"isNewPatient":is_new})
        } else {
            visit
        },
    )
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
    let bed = json!({"id":id("bed"),"facilityCode":ctx.facility_code,"wardName":text(body,"wardName").trim(),"roomNumber":default(body,"roomNumber",&code),"bedClass":text(body,"bedClass").trim(),"bedCode":code,"dailyRate":rate,"status":"TERSEDIA"});
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
    ] {
        if let Some(object) = bed.as_object_mut() {
            object.remove(key);
        }
    }
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
            bed["patientId"] = patient["id"].clone();
            bed["patientName"] = patient["fullName"].clone();
            bed["mrNumber"] = patient["mrNumber"].clone();
            bed["admittedAt"] = json!(now());
            bed["attendingDoctor"] = practitioner["fullName"].clone();
            bed["diagnosis"] = json!(text(body, "diagnosis"));
        }
        "discharge" => {
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
                if let Some(value) = body.get("diagnosis") {
                    bed["diagnosis"] = value.clone();
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
    if codes.is_empty() {
        return Err(bad_request("Pilih parameter pemeriksaan laboratorium."));
    }
    let mut order = lab_record(
        ctx,
        &visit,
        parameters(codes, &body["tariffs"])?,
        default(body, "clinicalNotes", text(&visit, "chiefComplaint")),
        "PERMINTAAN_BARU",
    );
    order["billingStatus"] = json!("NOT_BILLED");
    array_mut(&mut app.db, "labOrders").insert(0, order.clone());
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
            && text(rx, "status") != "DISERAHKAN"
    });
    if !pending {
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
    for prescription in array(&body["plan"], "prescriptions") {
        let qty = n(prescription, "quantity");
        let price = n(prescription, "unitPrice");
        if !qty.is_finite()
            || qty <= 0.0
            || !price.is_finite()
            || price < 0.0
            || !prescription["unitPrice"].is_number()
            || !(qty * price).is_finite()
        {
            return Err(bad_request("Kuantitas dan harga resep tidak valid."));
        }
        if !array(&app.db, "medications").iter().any(|med| {
            text(med, "facilityCode") == ctx.facility_code
                && (text(med, "id") == text(prescription, "medicationId")
                    || text(med, "code") == text(prescription, "medicationCode"))
        }) {
            return Err(bad_request(
                "Obat dalam resep harus terdaftar di katalog fasilitas ini.",
            ));
        }
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
    let incoming = json!({"id":existing.as_ref().map(|row|row["id"].clone()).unwrap_or_else(||json!(id("soap"))),"visitId":visit["id"],"facilityCode":ctx.facility_code,"patientId":patient["id"],"doctorId":ctx.user["id"],"doctorName":ctx.user["fullName"],"recordedAt":existing.as_ref().map(|row|row["recordedAt"].clone()).unwrap_or_else(||json!(timestamp)),"subjective":body["subjective"],"objective":body["objective"],"assessment":body["assessment"],"plan":body["plan"],"satusehatEncounterId":existing.as_ref().map(|row|row["satusehatEncounterId"].clone()).unwrap_or_else(||json!("")),"syncedToSatusehat":false});
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
    if let Some(i) = si {
        array_mut(&mut app.db, "soapRecords")[i] = record.clone();
    } else {
        array_mut(&mut app.db, "soapRecords").insert(0, record.clone());
    }
    if text(&record, "recordStatus") == "ADDENDUM_APPENDED"
        || prior_invoice
            .as_ref()
            .map(|invoice| text(invoice, "status") != "BELUM_LUNAS")
            .unwrap_or(false)
    {
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
        array_mut(&mut app.db,"pharmacyOrders").insert(0,json!({"id":id("pho"),"facilityCode":ctx.facility_code,"visitId":visit["id"],"patientId":patient["id"],"patientName":patient["fullName"],"mrNumber":patient["mrNumber"],"doctorName":record["doctorName"],"allergies":patient["allergies"],"items":prescriptions,"status":"ANTRIAN_RESEP","dispensedBatches":[],"createdAt":timestamp}));
    }
    let li = array(&app.db, "labOrders").iter().position(|order| {
        text(order, "visitId") == text(&visit, "id")
            && text(order, "facilityCode") == ctx.facility_code
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
        let order = lab_record(ctx, &visit, lab_params.clone(), &notes, "PERMINTAAN_BARU");
        array_mut(&mut app.db, "labOrders").insert(0, order);
    }
    let mut items = vec![];
    let mut unpriced_items = vec![];
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
            items.push(json!({"id":id("bli"),"category":category,"description":description,"quantity":quantity,"unitPrice":tariff,"subtotal":quantity*tariff}));
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
    let totals = invoice_totals(&items, text(&visit, "guarantor"), 0.0);
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
                "INV/{}/{}/{:03}",
                prefix(&ctx.facility_code, 4),
                timestamp[..10].replace('-', ""),
                array(&app.db, "invoices").len() + 1
            )
        });
    let mut invoice = json!({"id":prior_invoice.as_ref().map(|row|row["id"].clone()).unwrap_or_else(||json!(id("inv"))),"facilityCode":ctx.facility_code,"invoiceNumber":invoice_number,"visitId":visit["id"],"patientId":patient["id"],"patientName":patient["fullName"],"mrNumber":patient["mrNumber"],"guarantor":visit["guarantor"],"items":items,"unpricedItems":unpriced_items,"pricingStatus":if unpriced_items.is_empty(){"COMPLETE"}else{"PENDING"},"subtotal":totals["subtotal"],"discountAmount":totals["discountAmount"],"bpjsCoveredAmount":totals["bpjsCoveredAmount"],"patientPayableAmount":totals["patientPayableAmount"],"paymentMethod":Value::Null,"status":"BELUM_LUNAS","createdAt":prior_invoice.as_ref().map(|row|row["createdAt"].clone()).unwrap_or_else(||json!(timestamp))});
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
    invoice["claimRequestedAmount"] = if text(&visit, "guarantor") == "BPJS_KESEHATAN" {
        json!((n(&invoice, "subtotal") - n(&invoice, "discountAmount")).max(0.0))
    } else {
        json!(0)
    };
    if let Some(i) = ii {
        array_mut(&mut app.db, "invoices")[i] = invoice.clone();
    } else {
        array_mut(&mut app.db, "invoices").insert(0, invoice.clone());
    }
    array_mut(&mut app.db, "visits")[vi] = visit.clone();
    array_mut(&mut app.db,"bridgingLogs").insert(0,json!({"id":id("brg-ss"),"facilityCode":ctx.facility_code,"targetSystem":"SATUSEHAT_FHIR_R4","resourceType":"Bundle (Encounter, Condition ICD-10, Observation Vitals, MedicationRequest)","referenceId":visit["id"],"patientName":patient["fullName"],"status":"QUEUED_LOCAL","externalId":"","latencyMs":0,"payloadPreview":{"resourceType":"Bundle","type":"transaction","localVisitId":visit["id"],"patientIhs":patient["ihsNumber"],"practitionerName":record["doctorName"],"icd10Primary":record["assessment"]["primaryIcd10Code"],"icd10Display":record["assessment"]["primaryIcd10Name"],"vitals":vital_signs,"prescriptionCount":array(&record["plan"],"prescriptions").len()},"timestamp":timestamp}));
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
