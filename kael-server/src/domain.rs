use chrono::{DateTime, Utc};
use serde_json::{Value, json};

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value.get(key).and_then(Value::as_str).unwrap_or("")
}
fn number(value: &Value, key: &str) -> f64 {
    value
        .get(key)
        .and_then(Value::as_f64)
        .filter(|number| number.is_finite())
        .unwrap_or(0.0)
}
fn list(value: &Value, key: &str) -> Vec<Value> {
    value
        .get(key)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}
fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub fn normalize_facility(raw: &str) -> String {
    let mut normalized = String::new();
    for character in raw.trim().to_uppercase().chars() {
        if character.is_ascii_alphanumeric() {
            normalized.push(character);
        } else if !normalized.is_empty() && !normalized.ends_with('_') {
            normalized.push('_');
        }
    }
    normalized.trim_end_matches('_').to_string()
}

pub fn default_facility_config(facility: &Value, published_by: &str) -> Value {
    static TEMPLATES: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    let templates = TEMPLATES.get_or_init(|| {
        serde_json::from_str(FACILITY_TEMPLATES).expect("Template konfigurasi produksi valid")
    });
    let mut config = templates
        .get(text(facility, "type"))
        .unwrap_or(&templates["KLINIK_PRATAMA"])
        .clone();
    let now = timestamp();
    let created = if text(facility, "createdAt").is_empty() {
        now.as_str()
    } else {
        text(facility, "createdAt")
    };
    let date: String = created.chars().take(10).collect();
    let code = text(facility, "code");
    config["configId"] = json!(format!("cfg-{code}-v1"));
    config["tenantId"] = json!(if text(facility, "tenantId").is_empty() {
        code
    } else {
        text(facility, "tenantId")
    });
    config["facilityCode"] = json!(code);
    config["configVersion"] = json!(
        facility["activeConfigVersion"]
            .as_u64()
            .filter(|version| *version > 0)
            .unwrap_or(1)
    );
    config["effectiveDate"] = json!(date);
    config["publishedBy"] = json!(published_by);
    config["publishedAt"] = json!(created);
    if let Some(forms) = config["formSchemas"].as_array_mut() {
        for form in forms {
            form["effectiveDate"] = json!(date);
        }
    }
    config["documentTemplateHeader"] = json!({
        "institutionHeaderLine1":text(facility,"name").to_uppercase(),
        "institutionHeaderLine2":format!("{}, {} • Telp: {}",text(facility,"address"),text(facility,"city"),text(facility,"phone")),
        "citySignatureLabel":text(facility,"city"),"enableQrValidation":true
    });
    config
}

pub fn capability_catalog() -> Vec<Value> {
    static CATALOG: std::sync::OnceLock<Vec<Value>> = std::sync::OnceLock::new();
    CATALOG
        .get_or_init(|| {
            serde_json::from_str(CAPABILITIES).expect("Katalog kapabilitas produksi valid")
        })
        .clone()
}

pub fn validate_capabilities(capabilities: &[Value]) -> Result<(), String> {
    let catalog = capability_catalog();
    let mut blocking = Vec::new();
    for capability in capabilities {
        let Some(code) = capability.as_str() else {
            return Err("Konfigurasi memuat kapabilitas yang tidak dikenal.".into());
        };
        let Some(definition) = catalog
            .iter()
            .find(|definition| text(definition, "code") == code)
        else {
            return Err("Konfigurasi memuat kapabilitas yang tidak dikenal.".into());
        };
        let missing: Vec<_> = list(&definition["dependencies"], "allOf")
            .into_iter()
            .filter(|required| !capabilities.contains(required))
            .collect();
        if !missing.is_empty() {
            blocking.push(format!(
                "{code}: membutuhkan dependensi wajib [{}]",
                missing
                    .iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(", ")
            ));
        }
    }
    if blocking.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "Validasi ServiceActivationManifest gagal: {}",
            blocking.join(" | ")
        ))
    }
}

pub fn auto_triage(vitals: &Value) -> String {
    let vital = |key: &str| vitals.get(key).and_then(Value::as_f64).unwrap_or(f64::NAN);
    let gcs = vital("gcsEye") + vital("gcsVerbal") + vital("gcsMotor");
    let code = if vital("spo2") < 90.0
        || vital("systolic") > 200.0
        || vital("systolic") < 80.0
        || vital("heartRate") > 140.0
        || vital("respiratoryRate") > 30.0
        || gcs <= 8.0
    {
        "RESUSITASI_MERAH"
    } else if vital("spo2") < 94.0
        || vital("systolic") >= 160.0
        || vital("temperature") >= 39.0
        || vital("heartRate") > 115.0
        || vital("painScale") >= 7.0
        || gcs <= 12.0
    {
        "EMERGENSI_KUNING"
    } else if vital("temperature") >= 37.8
        || vital("painScale") >= 4.0
        || vital("systolic") >= 140.0
    {
        "URGENSI_HIJAU"
    } else {
        "NON_URGEN_PUTIH"
    };
    code.into()
}

pub fn invoice_totals(items: &[Value], guarantor: &str, discount: f64) -> Value {
    let subtotal: f64 = items
        .iter()
        .map(|item| number(item, "quantity") * number(item, "unitPrice"))
        .sum();
    let discount = discount.min(subtotal).max(0.0);
    let net = subtotal - discount;
    json!({"subtotal":subtotal,"discountAmount":discount,"bpjsCoveredAmount":0,"claimRequestedAmount":if guarantor == "BPJS_KESEHATAN" {net} else {0.0},
        "patientPayableAmount":if guarantor == "BPJS_KESEHATAN" {0.0} else {net}})
}

pub fn lab_templates() -> Vec<Value> {
    serde_json::from_str(LAB_TEMPLATES).expect("Katalog parameter laboratorium produksi valid")
}

pub fn lab_flag(
    value: f64,
    minimum: f64,
    maximum: f64,
    critical_minimum: Option<f64>,
    critical_maximum: Option<f64>,
) -> String {
    if critical_minimum.is_some_and(|threshold| value <= threshold) {
        "CRITICAL_LOW"
    } else if critical_maximum.is_some_and(|threshold| value >= threshold) {
        "CRITICAL_HIGH"
    } else if value < minimum {
        "LOW"
    } else if value > maximum {
        "HIGH"
    } else {
        "NORMAL"
    }
    .into()
}

pub fn fefo(batches: &[Value], quantity: f64) -> Result<(Vec<Value>, Vec<Value>), f64> {
    let mut updated = batches.to_vec();
    let mut allocations = Vec::new();
    if quantity <= 0.0 {
        return Ok((updated, allocations));
    }
    updated.sort_by(|left, right| text(left, "expiryDate").cmp(text(right, "expiryDate")));
    let mut remaining = quantity;
    for batch in &mut updated {
        if remaining <= 0.0 {
            break;
        }
        let stock = number(batch, "stock");
        if stock <= 0.0 {
            continue;
        }
        let take = stock.min(remaining);
        batch["stock"] = json!(stock - take);
        remaining -= take;
        allocations.push(json!({"batchNumber":text(batch,"batchNumber"),"quantity":take}));
    }
    if remaining > 0.0 {
        Err(remaining)
    } else {
        Ok((updated, allocations))
    }
}

pub fn apply_clinical_record(
    existing: Option<&Value>,
    incoming: &Value,
    actor: &Value,
    reason: &str,
    now: &str,
) -> Result<Value, String> {
    if !incoming.is_object() {
        return Err("Payload rekam medis harus berupa objek.".into());
    }
    let license = text(actor, "sipValidUntil");
    let today: String = now.chars().take(10).collect();
    if !license.is_empty() && license < today.as_str() {
        return Err(format!(
            "Otorisasi klinis ditolak: Izin praktik (SIP/STR) atas nama {} telah kedaluwarsa pada {license}.",
            text(actor, "fullName")
        ));
    }
    if existing.is_none_or(|record| text(record, "recordStatus") == "DRAFT") {
        let mut record = incoming.clone();
        record["recordStatus"] = json!("SIGNED_LOCKED");
        record["signedAt"] = json!(now);
        record["signedBy"] = json!(text(actor, "fullName"));
        record["amendments"] = json!(
            existing
                .map(|record| list(record, "amendments"))
                .unwrap_or_default()
        );
        return Ok(record);
    }
    let existing = existing.expect("Rekam medis bertanda tangan tersedia");
    if reason.trim().chars().count() < 5 {
        return Err("Rekam medis telah disahkan (SIGNED_LOCKED). Sesuai Permenkes No. 24 Tahun 2022 Pasal 30, pengubahan langsung dilarang tanpa mencantumkan alasan koreksi resmi.".into());
    }
    let entered = text(existing, "recordedAt");
    let elapsed = DateTime::parse_from_rfc3339(entered)
        .ok()
        .zip(DateTime::parse_from_rfc3339(now).ok())
        .map(|(signed, now)| (now - signed).num_seconds() as f64 / 3600.0)
        .unwrap_or(f64::INFINITY);
    let summary = |record: &Value| {
        format!(
            "{} - {} ({})",
            text(&record["assessment"], "primaryIcd10Code"),
            text(&record["assessment"], "primaryIcd10Name"),
            text(&record["plan"], "therapyNotes")
        )
    };
    let mut amendment = json!({"id":format!("amd-{}",uuid::Uuid::new_v4()),"amendedAt":now,"amendedBy":text(actor,"fullName"),
        "authorRole":text(actor,"role"),"reason":reason.trim(),"previousAssessmentSummary":summary(existing),"newAssessmentSummary":summary(incoming)});
    let mut amendments = list(existing, "amendments");
    let mut record;
    if elapsed <= 48.0 {
        amendment["amendmentType"] = json!("CORRECTION_WITHIN_48H");
        record = incoming.clone();
        for key in ["id", "recordedAt", "signedAt", "signedBy"] {
            record[key] = existing[key].clone();
        }
        record["recordStatus"] = json!("AMENDED_WITHIN_48H");
    } else {
        return Err("Batas waktu koreksi 2x24 jam sejak input telah terlewati. Alur persetujuan koreksi melalui petugas rekam medis atau pimpinan belum tersedia; catatan asli tetap dipertahankan.".into());
    }
    amendments.push(amendment);
    record["amendments"] = json!(amendments);
    Ok(record)
}

pub const MODULE_KEYS: &[&str] = &[
    "DASHBOARD",
    "PENDAFTARAN",
    "SEMUA_PASIEN",
    "JADWAL_DOKTER",
    "IGD_TRIASE_EWS",
    "RME_DOKTER",
    "GIGI_ODONTOGRAM",
    "KIA_IMUNISASI",
    "PROLANIS_PRB",
    "RAWAT_INAP",
    "BEDAH_IBS",
    "MCU_SURAT_MEDIS",
    "APOTEK",
    "KATALOG_OPNAME",
    "MUTASI_STOK",
    "PENGADAAN_PBF",
    "LABORATORIUM",
    "RADIOLOGI_RIS",
    "PENUNJANG_RS",
    "KASIR_AKUNTANSI",
    "KLAIM_BPJS_PIUTANG",
    "KEUANGAN_OWNER",
    "NERACA_GL",
    "JASA_MEDIS_REMUN",
    "SDM_ERP",
    "SDM_JADWAL",
    "BRIDGING_SATUSEHAT",
    "LAPORAN_REGULASI",
    "SUPERUSER_CONTROL",
];

const CAPABILITIES: &str = r###"[{"code":"SUB_PATIENT_MPI","capabilityGroup":"FRONT_OFFICE","name":"Direktori Pasien & Rekam Medis Lokal","mappedModule":"SEMUA_PASIEN","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{},"description":"Master identitas pasien per fasilitas dengan isolasi tenant dan nomor RM lokal."},{"code":"SUB_ADMISSION_OUTPATIENT","capabilityGroup":"FRONT_OFFICE","name":"Loket Pendaftaran Rawat Jalan","mappedModule":"PENDAFTARAN","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_PATIENT_MPI"]},"description":"Registrasi kunjungan sakit dan kunjungan sehat dengan deteksi otomatis pasien terdaftar."},{"code":"SUB_ADMISSION_EMERGENCY","capabilityGroup":"FRONT_OFFICE","name":"Admisi Gawat Darurat & Pasien Darurat","mappedModule":"IGD_TRIASE_EWS","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_IGD_TRIAGE_ATS"]},"description":"Registrasi cepat pasien IGD yang mengizinkan tindakan stabilisasi sebelum administrasi lengkap."},{"code":"SUB_DOCTOR_SCHEDULE_BOOKING","capabilityGroup":"FRONT_OFFICE","name":"Jadwal Praktik & Kuota Antrean","mappedModule":"JADWAL_DOKTER","implementationStatus":"PARTIAL","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_PATIENT_MPI"],"requiredEvidenceTypes":["SIP_NAKES"]},"description":"Pengaturan jadwal sesi praktik tenaga medis, kuota per sesi, dan perjanjian pasien."},{"code":"SUB_INPATIENT_BED_MGMT","capabilityGroup":"FRONT_OFFICE","name":"Manajemen Bangsal & Tempat Tidur","mappedModule":"RAWAT_INAP","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_PATIENT_MPI"],"requiredEvidenceTypes":["IZIN_OPERASIONAL"]},"description":"Peta tempat tidur rawat inap, mutasi kamar, pemulangan, dan pemantauan batas hari rawat."},{"code":"SUB_OUTPATIENT_SOAP_CPPT","capabilityGroup":"CLINICAL_RME","name":"Pemeriksaan Klinis & CPPT Multi-Profesi","mappedModule":"RME_DOKTER","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_ADMISSION_OUTPATIENT"],"requiredEvidenceTypes":["SIP_NAKES"]},"description":"Rekam medis elektronik SOAP dan CPPT kolaboratif dengan penguncian Permenkes 24/2022 Pasal 30."},{"code":"SUB_IGD_TRIAGE_ATS","capabilityGroup":"CLINICAL_RME","name":"Penanda Prioritas Klinis","mappedModule":"IGD_TRIASE_EWS","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"requiredEvidenceTypes":["SIP_NAKES"]},"description":"Penanda lokal berdasarkan tanda vital; keputusan triase ditetapkan oleh tenaga klinis, tanpa klaim penerapan ATS terverifikasi."},{"code":"SUB_CLINICAL_EWS_SCORING","capabilityGroup":"CLINICAL_RME","name":"Penanda Peringatan Tanda Vital","mappedModule":"IGD_TRIASE_EWS","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"anyOf":["SUB_OUTPATIENT_SOAP_CPPT","SUB_IGD_TRIAGE_ATS"]},"description":"Penanda lokal dari tanda vital yang tercatat; belum merupakan implementasi terverifikasi NEWS2, PEWS, atau MEOWS."},{"code":"SUB_DENTAL_ODONTOGRAM","capabilityGroup":"CLINICAL_RME","name":"Pelayanan Gigi & Peta Odontogram FDI","mappedModule":"GIGI_ODONTOGRAM","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_OUTPATIENT_SOAP_CPPT"],"requiredEvidenceTypes":["SIP_NAKES"]},"description":"Pemeriksaan kedokteran gigi dengan pemetaan 32 gigi standar FDI."},{"code":"SUB_ANC_BASIC","capabilityGroup":"MATERNAL_CHILD","name":"Pemeriksaan Kehamilan Dasar & KIA","mappedModule":"KIA_IMUNISASI","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"requiredEvidenceTypes":["SIP_NAKES"]},"description":"Pemeriksaan antenatal care, perhitungan usia kehamilan, HPL Naegele, dan skrining risiko."},{"code":"SUB_DELIVERY_PARTOGRAPH","capabilityGroup":"MATERNAL_CHILD","name":"Persalinan Normal, Partograf & Nifas","mappedModule":"KIA_IMUNISASI","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_ANC_BASIC"],"requiredEvidenceTypes":["IZIN_OPERASIONAL","SIP_NAKES"]},"description":"Pemantauan persalinan aktif, pencatatan partograf, dan perawatan pascapersalinan."},{"code":"SUB_HIGH_RISK_OBSTETRICS","capabilityGroup":"MATERNAL_CHILD","name":"Obstetri Risiko Tinggi & PONEK","mappedModule":"KIA_IMUNISASI","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_DELIVERY_PARTOGRAPH","SUB_INPATIENT_BED_MGMT"],"anyOf":["SUB_BLOOD_BANK_BDRS","SUB_LAB_PATHOLOGY"],"requiredEvidenceTypes":["IZIN_OPERASIONAL","SIP_NAKES"]},"description":"Penanganan rujukan kehamilan risiko tinggi dan komplikasi obstetri."},{"code":"SUB_IMMUNIZATION_VACCINE","capabilityGroup":"MATERNAL_CHILD","name":"Layanan Imunisasi & Vaksinasi","mappedModule":"KIA_IMUNISASI","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_PHARMACY_INVENTORY_OPNAME"]},"description":"Pencatatan jadwal imunisasi bayi, anak, dan dewasa beserta nomor batch vaksin."},{"code":"SUB_CHRONIC_DISEASE_REGISTRY","capabilityGroup":"CHRONIC_SPECIALIZED","name":"Registri Pemantauan Penyakit Kronis","mappedModule":"PROLANIS_PRB","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_OUTPATIENT_SOAP_CPPT"]},"description":"Pemantauan berkala indikator klinis pasien penyakit kronis tanpa syarat wajib lab patologi penuh."},{"code":"SUB_PROLANIS_CLUB","capabilityGroup":"CHRONIC_SPECIALIZED","name":"Manajemen Kohor Prolanis DM & Hipertensi","mappedModule":"PROLANIS_PRB","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_CHRONIC_DISEASE_REGISTRY"]},"description":"Evaluasi rasio peserta Prolanis terkendali untuk kohort Diabetes Melitus dan Hipertensi."},{"code":"SUB_PRB_MEDICATION_CONTINUITY","capabilityGroup":"CHRONIC_SPECIALIZED","name":"Program Rujuk Balik & Resep Kronis","mappedModule":"PROLANIS_PRB","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_CHRONIC_DISEASE_REGISTRY","SUB_REFERRAL_ORCHESTRATION"]},"description":"Tindak lanjut pasien rujuk balik dari FKRTL dan pengelolaan terapi obat kronis bulanan."},{"code":"SUB_SURGERY_IBS","capabilityGroup":"CHRONIC_SPECIALIZED","name":"Instalasi Bedah Sentral & Safety Checklist","mappedModule":"BEDAH_IBS","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_INPATIENT_BED_MGMT","SUB_CSSD_STERILIZATION"],"requiredEvidenceTypes":["IZIN_OPERASIONAL","SIP_NAKES","KALIBRASI_ALKES"]},"description":"Penjadwalan kamar operasi, daftar tilik keselamatan bedah WHO, dan pemakaian BMHP bedah."},{"code":"SUB_HEMODIALYSIS_UNIT","capabilityGroup":"CHRONIC_SPECIALIZED","name":"Unit Hemodialisis & Pemantauan Mesin","mappedModule":"BEDAH_IBS","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_OUTPATIENT_SOAP_CPPT"],"requiredEvidenceTypes":["IZIN_OPERASIONAL","SIP_NAKES","KALIBRASI_ALKES"]},"description":"Pelayanan dialisis ginjal dengan verifikasi kalibrasi mesin dan sertifikasi tenaga medis."},{"code":"SUB_MCU_MEDICAL_CERTIFICATES","capabilityGroup":"CHRONIC_SPECIALIZED","name":"Medical Check-Up & Surat Keterangan Medis","mappedModule":"MCU_SURAT_MEDIS","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_OUTPATIENT_SOAP_CPPT"]},"description":"Pemeriksaan paket MCU kelaikan kerja serta penerbitan Surat Sakit, Surat Sehat, dan Rujukan."},{"code":"SUB_PHARMACY_DISPENSING_FEFO","capabilityGroup":"PHARMACY_SUPPLY","name":"Pelayanan Resep, Dispensing Parsial & Retur","mappedModule":"APOTEK","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_PHARMACY_INVENTORY_OPNAME"],"requiredEvidenceTypes":["SIP_NAKES"]},"description":"Verifikasi resep 7 Benar, pemotongan stok FEFO ber-idempotensi, pemenuhan parsial, dan retur."},{"code":"SUB_PHARMACY_INVENTORY_OPNAME","capabilityGroup":"PHARMACY_SUPPLY","name":"Katalog Obat KFA, Stock Opname & Kartu Stok","mappedModule":"KATALOG_OPNAME","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{},"description":"Pengelolaan master obat KFA, stok sistem per batch, opname fisik, dan riwayat mutasi."},{"code":"SUB_PROCUREMENT_PO_PBF","capabilityGroup":"PHARMACY_SUPPLY","name":"Pengadaan PO, Faktur PBF & Retur Pembelian","mappedModule":"PENGADAAN_PBF","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_PHARMACY_INVENTORY_OPNAME","SUB_ACCOUNTING_DOUBLE_ENTRY"]},"description":"Siklus Purchase Order ke PBF, penerimaan batch faktur, dan pencatatan utang dagang otomatis."},{"code":"SUB_LAB_PATHOLOGY","capabilityGroup":"DIAGNOSTIC_SUPPORT","name":"Laboratorium Patologi Klinik","mappedModule":"LABORATORIUM","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"requiredEvidenceTypes":["SIP_NAKES","KALIBRASI_ALKES"]},"description":"Order pemeriksaan laboratorium, pelacakan spesimen, deteksi nilai kritis, dan verifikasi hasil."},{"code":"SUB_RADIOLOGY_IMAGING","capabilityGroup":"DIAGNOSTIC_SUPPORT","name":"Radiologi & Pencitraan Diagnostik","mappedModule":"RADIOLOGI_RIS","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"requiredEvidenceTypes":["IZIN_OPERASIONAL","SIP_NAKES","KALIBRASI_ALKES"]},"description":"Pemeriksaan Rontgen, USG, CT-Scan, dan EKG beserta pembacaan ekspertise radiologi."},{"code":"SUB_NUTRITION_DIETARY","capabilityGroup":"DIAGNOSTIC_SUPPORT","name":"Instalasi Gizi & Diet Rawat Inap","mappedModule":"PENUNJANG_RS","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_INPATIENT_BED_MGMT"]},"description":"Pengelolaan pesanan diet pasien rawat inap dan evaluasi asupan nutrisi."},{"code":"SUB_BLOOD_BANK_BDRS","capabilityGroup":"DIAGNOSTIC_SUPPORT","name":"Bank Darah & Distribusi Transfusi","mappedModule":"PENUNJANG_RS","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"requiredEvidenceTypes":["IZIN_OPERASIONAL"]},"description":"Manajemen persediaan kantong darah golongan A/B/AB/O dan uji silang serasi."},{"code":"SUB_CSSD_STERILIZATION","capabilityGroup":"DIAGNOSTIC_SUPPORT","name":"Sterilisasi Instrumen CSSD / Mitra Resmi","mappedModule":"PENUNJANG_RS","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"requiredEvidenceTypes":["KALIBRASI_ALKES"]},"description":"Pemantauan siklus sterilisasi instrumen medis melalui CSSD internal atau mitra berizin."},{"code":"SUB_IPSRS_AMBULANCE","capabilityGroup":"DIAGNOSTIC_SUPPORT","name":"Pemeliharaan Alkes IPSRS & Armada Ambulans","mappedModule":"PENUNJANG_RS","implementationStatus":"PARTIAL","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{},"description":"Jadwal kalibrasi alat kesehatan, pemeliharaan sarana gedung, dan kesiapan ambulans."},{"code":"SUB_CASHIER_BILLING_DEPOSIT","capabilityGroup":"FINANCE_ACCOUNTING","name":"Kasir, Deposit Rawat Inap & Penagihan","mappedModule":"KASIR_AKUNTANSI","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_ACCOUNTING_DOUBLE_ENTRY"]},"description":"Penyelesaian tagihan layanan, penerimaan deposit uang muka, refund, dan cetak kuitansi."},{"code":"SUB_CLAIM_FKTP_KBK","capabilityGroup":"FINANCE_ACCOUNTING","name":"Kapitasi Berbasis Kinerja & Klaim Non-Kapitasi","mappedModule":"KLAIM_BPJS_PIUTANG","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_CASHIER_BILLING_DEPOSIT"]},"description":"Pemantauan Angka Kontak, RRNS, RPPT Prolanis, serta klaim non-kapitasi FKTP."},{"code":"SUB_CLAIM_FKRTL_CASEMIX","capabilityGroup":"FINANCE_ACCOUNTING","name":"Klaim Casemix INA-CBG & Uji Coba iDRG","mappedModule":"KLAIM_BPJS_PIUTANG","implementationStatus":"IMPLEMENTED","defaultReadiness":"CONFIGURABLE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_CASHIER_BILLING_DEPOSIT"]},"description":"Grouping klaim FKRTL dengan pemisahan skema INA-CBG dan iDRG beserta analisis selisih tarif."},{"code":"SUB_ACCOUNTING_DOUBLE_ENTRY","capabilityGroup":"FINANCE_ACCOUNTING","name":"Akuntansi Double-Entry, Neraca & Laba Rugi","mappedModule":"KEUANGAN_OWNER","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{},"description":"Mesin jurnal berimbang Debit = Kredit, Buku Besar COA, Neraca, Laba Rugi, dan Cost Center."},{"code":"SUB_MEDICAL_FEE_PAYROLL","capabilityGroup":"FINANCE_ACCOUNTING","name":"Subledger Jasa Medis, SDM & Penggajian","mappedModule":"JASA_MEDIS_REMUN","implementationStatus":"PARTIAL","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_ACCOUNTING_DOUBLE_ENTRY"]},"description":"Perhitungan akrual jasa medis dokter/nakes, potongan PPh 21, jadwal shift, cuti, dan slip gaji."},{"code":"SUB_REGULATORY_REPORTS","capabilityGroup":"GOVERNANCE_INTEROP","name":"Pelaporan Regulasi LB1–LB4 & SIRS RL 1–5","mappedModule":"LAPORAN_REGULASI","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_REQUIRED","dependencies":{"allOf":["SUB_OUTPATIENT_SOAP_CPPT"]},"description":"Kompilasi laporan wajib Kemenkes sesuai klasifikasi fasilitas dengan ketertelusuran transaksi."},{"code":"SUB_REFERRAL_ORCHESTRATION","capabilityGroup":"GOVERNANCE_INTEROP","name":"Orkestrasi Rujukan, SRB & Integrasi SATUSEHAT","mappedModule":"BRIDGING_SATUSEHAT","implementationStatus":"IMPLEMENTED","defaultReadiness":"ACTIVE","integrationStatus":"NOT_CONFIGURED","dependencies":{"allOf":["SUB_PATIENT_MPI"]},"description":"State machine rujukan 7 tahap, validasi TACC, rujuk balik SRB, dan pengiriman bundel FHIR R4."}]"###;

const LAB_TEMPLATES: &str = r###"[{"code":"HGB","name":"Hemoglobin (Hb)","category":"HEMATOLOGI","unit":"g/dL","refMin":null,"refMax":null},{"code":"WBC","name":"Leukosit (Sel Darah Putih)","category":"HEMATOLOGI","unit":"10^3/uL","refMin":null,"refMax":null},{"code":"PLT","name":"Trombosit (Platelet)","category":"HEMATOLOGI","unit":"10^3/uL","refMin":null,"refMax":null},{"code":"HCT","name":"Hematokrit (Ht)","category":"HEMATOLOGI","unit":"%","refMin":null,"refMax":null},{"code":"GDS","name":"Glukosa Darah Sewaktu (GDS)","category":"KIMIA_DARAH","unit":"mg/dL","refMin":null,"refMax":null},{"code":"GDP","name":"Glukosa Darah Puasa (GDP)","category":"KIMIA_DARAH","unit":"mg/dL","refMin":null,"refMax":null},{"code":"CHOL","name":"Kolesterol Total","category":"KIMIA_DARAH","unit":"mg/dL","refMin":null,"refMax":null},{"code":"UA","name":"Asam Urat (Uric Acid)","category":"KIMIA_DARAH","unit":"mg/dL","refMin":null,"refMax":null},{"code":"CREAT","name":"Kreatinin Serum","category":"KIMIA_DARAH","unit":"mg/dL","refMin":null,"refMax":null},{"code":"NS1","name":"Antigen Dengue NS1 Rapid","category":"IMUNOSEROLOGI","unit":"Index","refMin":null,"refMax":null}]"###;

const FACILITY_TEMPLATES: &str = r###"{"KLINIK_PRATAMA":{"configVersion":1,"lifecycleStage":"ACTIVE","changeNotes":"Baseline konfigurasi kapabilitas awal fasilitas","enabledSubCapabilities":["SUB_PATIENT_MPI","SUB_ADMISSION_OUTPATIENT","SUB_DOCTOR_SCHEDULE_BOOKING","SUB_OUTPATIENT_SOAP_CPPT","SUB_DENTAL_ODONTOGRAM","SUB_ANC_BASIC","SUB_IMMUNIZATION_VACCINE","SUB_CHRONIC_DISEASE_REGISTRY","SUB_PROLANIS_CLUB","SUB_PRB_MEDICATION_CONTINUITY","SUB_MCU_MEDICAL_CERTIFICATES","SUB_PHARMACY_DISPENSING_FEFO","SUB_PHARMACY_INVENTORY_OPNAME","SUB_PROCUREMENT_PO_PBF","SUB_LAB_PATHOLOGY","SUB_CASHIER_BILLING_DEPOSIT","SUB_CLAIM_FKTP_KBK","SUB_ACCOUNTING_DOUBLE_ENTRY","SUB_MEDICAL_FEE_PAYROLL","SUB_REGULATORY_REPORTS","SUB_REFERRAL_ORCHESTRATION"],"activeServices":["PRAKTIK_UMUM","PRAKTIK_GIGI","KIA_KB_IMUNISASI","PROLANIS_PRB","FARMASI_FKTP"],"units":[{"unitCode":"PRAKTIK_UMUM","unitName":"Ruang Praktik Dokter Umum","unitType":"RUANG_PRAKTIK","costCenterCode":"CC-KL-UMUM","active":true},{"unitCode":"PRAKTIK_GIGI","unitName":"Ruang Praktik Dokter Gigi","unitType":"RUANG_PRAKTIK","costCenterCode":"CC-KL-GIGI","active":true},{"unitCode":"RUANG_KIA","unitName":"Ruang KIA, KB & Imunisasi","unitType":"RUANG_PRAKTIK","costCenterCode":"CC-KL-KIA","active":true},{"unitCode":"APOTEK_KLINIK","unitName":"Apotek Klinik","unitType":"DEPO_FARMASI","costCenterCode":"CC-KL-FAR","active":true}],"terminologyOverrides":{"outpatientUnitLabel":"Ruang Praktik","triageProtocol":"PENANDA_VITAL_LOKAL"},"formSchemas":[{"formCode":"FRM_SOAP_STANDARD","formName":"Formulir Rekam Medis SOAP & CPPT","schemaVersion":1,"targetModule":"RME_DOKTER","fields":[{"fieldKey":"chiefComplaint","label":"Keluhan Utama","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"vitals","label":"Tanda Vital Lengkap","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"primaryIcd10Code","label":"Diagnosis Primer ICD-10","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"nutritionalStatus","label":"Skrining Nutrisi MST","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Risiko Rendah","Risiko Sedang","Risiko Tinggi"]},{"fieldKey":"fallRiskAssessment","label":"Risiko Jatuh Morse/Humpty Dumpty","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Tidak Berisiko","Risiko Rendah","Risiko Tinggi"]}]}],"workflowPolicies":{"requirePaymentBeforeDispenseOutpatientUmum":false,"allowEmergencyOrderBeforeFullRegistration":true,"rmeCorrectionWindowHours":48},"tariffMultiplier":1,"billingPolicy":{},"pharmacyPolicy":{"allocationMethod":"FEFO"},"dashboardTargets":{},"externalConnectors":{"satusehatMode":"DISABLED","bpjsMode":"DISABLED"},"accountingPolicy":{"fiscalPeriodStatus":"OPEN"},"crossFacilitySharingPolicy":{"allowSameTenantReferralLookup":true,"requireExplicitConsentOrReferralToken":true}},"KLINIK_UTAMA":{"configVersion":1,"lifecycleStage":"ACTIVE","changeNotes":"Baseline konfigurasi kapabilitas awal fasilitas","enabledSubCapabilities":["SUB_PATIENT_MPI","SUB_ADMISSION_OUTPATIENT","SUB_DOCTOR_SCHEDULE_BOOKING","SUB_OUTPATIENT_SOAP_CPPT","SUB_DENTAL_ODONTOGRAM","SUB_ANC_BASIC","SUB_IMMUNIZATION_VACCINE","SUB_CHRONIC_DISEASE_REGISTRY","SUB_PROLANIS_CLUB","SUB_PRB_MEDICATION_CONTINUITY","SUB_MCU_MEDICAL_CERTIFICATES","SUB_PHARMACY_DISPENSING_FEFO","SUB_PHARMACY_INVENTORY_OPNAME","SUB_PROCUREMENT_PO_PBF","SUB_LAB_PATHOLOGY","SUB_CASHIER_BILLING_DEPOSIT","SUB_CLAIM_FKTP_KBK","SUB_ACCOUNTING_DOUBLE_ENTRY","SUB_MEDICAL_FEE_PAYROLL","SUB_REGULATORY_REPORTS","SUB_REFERRAL_ORCHESTRATION","SUB_INPATIENT_BED_MGMT","SUB_IGD_TRIAGE_ATS","SUB_CLINICAL_EWS_SCORING","SUB_DELIVERY_PARTOGRAPH","SUB_RADIOLOGY_IMAGING","SUB_CLAIM_FKRTL_CASEMIX"],"activeServices":["PRAKTIK_UMUM","POLIKLINIK_SPESIALIS","RAWAT_INAP_7_HARI","GIGI","KIA","LAB_DIAGNOSTIK"],"units":[{"unitCode":"PRAKTIK_UMUM","unitName":"Ruang Praktik Dokter Umum","unitType":"RUANG_PRAKTIK","costCenterCode":"CC-KL-UMUM","active":true},{"unitCode":"PRAKTIK_GIGI","unitName":"Ruang Praktik Dokter Gigi","unitType":"RUANG_PRAKTIK","costCenterCode":"CC-KL-GIGI","active":true},{"unitCode":"RUANG_KIA","unitName":"Ruang KIA, KB & Imunisasi","unitType":"RUANG_PRAKTIK","costCenterCode":"CC-KL-KIA","active":true},{"unitCode":"APOTEK_KLINIK","unitName":"Apotek Klinik","unitType":"DEPO_FARMASI","costCenterCode":"CC-KL-FAR","active":true}],"terminologyOverrides":{"outpatientUnitLabel":"Ruang Praktik","triageProtocol":"PENANDA_VITAL_LOKAL"},"formSchemas":[{"formCode":"FRM_SOAP_STANDARD","formName":"Formulir Rekam Medis SOAP & CPPT","schemaVersion":1,"targetModule":"RME_DOKTER","fields":[{"fieldKey":"chiefComplaint","label":"Keluhan Utama","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"vitals","label":"Tanda Vital Lengkap","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"primaryIcd10Code","label":"Diagnosis Primer ICD-10","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"nutritionalStatus","label":"Skrining Nutrisi MST","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Risiko Rendah","Risiko Sedang","Risiko Tinggi"]},{"fieldKey":"fallRiskAssessment","label":"Risiko Jatuh Morse/Humpty Dumpty","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Tidak Berisiko","Risiko Rendah","Risiko Tinggi"]}]}],"workflowPolicies":{"requirePaymentBeforeDispenseOutpatientUmum":false,"allowEmergencyOrderBeforeFullRegistration":true,"rmeCorrectionWindowHours":48},"tariffMultiplier":1,"billingPolicy":{},"pharmacyPolicy":{"allocationMethod":"FEFO"},"dashboardTargets":{},"externalConnectors":{"satusehatMode":"DISABLED","bpjsMode":"DISABLED"},"accountingPolicy":{"fiscalPeriodStatus":"OPEN"},"crossFacilitySharingPolicy":{"allowSameTenantReferralLookup":true,"requireExplicitConsentOrReferralToken":true}},"RSUD":{"configVersion":1,"lifecycleStage":"ACTIVE","changeNotes":"Baseline konfigurasi kapabilitas awal fasilitas","enabledSubCapabilities":["SUB_PATIENT_MPI","SUB_ADMISSION_OUTPATIENT","SUB_DOCTOR_SCHEDULE_BOOKING","SUB_OUTPATIENT_SOAP_CPPT","SUB_DENTAL_ODONTOGRAM","SUB_ANC_BASIC","SUB_IMMUNIZATION_VACCINE","SUB_CHRONIC_DISEASE_REGISTRY","SUB_PRB_MEDICATION_CONTINUITY","SUB_MCU_MEDICAL_CERTIFICATES","SUB_PHARMACY_DISPENSING_FEFO","SUB_PHARMACY_INVENTORY_OPNAME","SUB_PROCUREMENT_PO_PBF","SUB_LAB_PATHOLOGY","SUB_CASHIER_BILLING_DEPOSIT","SUB_ACCOUNTING_DOUBLE_ENTRY","SUB_MEDICAL_FEE_PAYROLL","SUB_REGULATORY_REPORTS","SUB_REFERRAL_ORCHESTRATION","SUB_INPATIENT_BED_MGMT","SUB_IGD_TRIAGE_ATS","SUB_CLINICAL_EWS_SCORING","SUB_DELIVERY_PARTOGRAPH","SUB_RADIOLOGY_IMAGING","SUB_CLAIM_FKRTL_CASEMIX","SUB_ADMISSION_EMERGENCY","SUB_HIGH_RISK_OBSTETRICS","SUB_SURGERY_IBS","SUB_HEMODIALYSIS_UNIT","SUB_NUTRITION_DIETARY","SUB_BLOOD_BANK_BDRS","SUB_CSSD_STERILIZATION","SUB_IPSRS_AMBULANCE"],"activeServices":["RAWAT_JALAN_SPESIALIS","IGD_24_JAM","RAWAT_INAP","BEDAH_IBS","HEMODIALISIS","LAB_PATOLOGI","RADIOLOGI"],"units":[{"unitCode":"POLI_PD","unitName":"Poliklinik Penyakit Dalam","unitType":"POLIKLINIK_SPESIALIS","costCenterCode":"CC-RJ-PD","active":true},{"unitCode":"POLI_ANAK","unitName":"Poliklinik Kesehatan Anak","unitType":"POLIKLINIK_SPESIALIS","costCenterCode":"CC-RJ-ANK","active":true},{"unitCode":"POLI_BEDAH","unitName":"Poliklinik Bedah Umum","unitType":"POLIKLINIK_SPESIALIS","costCenterCode":"CC-RJ-BDH","active":true},{"unitCode":"IGD_24","unitName":"Instalasi Gawat Darurat 24 Jam","unitType":"IGD","costCenterCode":"CC-IGD","active":true},{"unitCode":"RANAP_UTAMA","unitName":"Bangsal Rawat Inap Terpadu","unitType":"BANGSAL_RANAP","costCenterCode":"CC-RANAP","active":true},{"unitCode":"IBS_OK","unitName":"Instalasi Bedah Sentral","unitType":"KAMAR_OPERASI","costCenterCode":"CC-IBS","active":true},{"unitCode":"DEPO_UTAMA","unitName":"Instalasi Farmasi Sentral","unitType":"DEPO_FARMASI","costCenterCode":"CC-FAR","active":true}],"terminologyOverrides":{"outpatientUnitLabel":"Poliklinik","triageProtocol":"PENANDA_VITAL_LOKAL"},"formSchemas":[{"formCode":"FRM_SOAP_STANDARD","formName":"Formulir Rekam Medis SOAP & CPPT","schemaVersion":1,"targetModule":"RME_DOKTER","fields":[{"fieldKey":"chiefComplaint","label":"Keluhan Utama","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"vitals","label":"Tanda Vital Lengkap","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"primaryIcd10Code","label":"Diagnosis Primer ICD-10","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"nutritionalStatus","label":"Skrining Nutrisi MST","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Risiko Rendah","Risiko Sedang","Risiko Tinggi"]},{"fieldKey":"fallRiskAssessment","label":"Risiko Jatuh Morse/Humpty Dumpty","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Tidak Berisiko","Risiko Rendah","Risiko Tinggi"]}]}],"workflowPolicies":{"requirePaymentBeforeDispenseOutpatientUmum":false,"allowEmergencyOrderBeforeFullRegistration":true,"rmeCorrectionWindowHours":48},"tariffMultiplier":1,"billingPolicy":{},"pharmacyPolicy":{"allocationMethod":"FEFO"},"dashboardTargets":{},"externalConnectors":{"satusehatMode":"DISABLED","bpjsMode":"DISABLED"},"accountingPolicy":{"fiscalPeriodStatus":"OPEN"},"crossFacilitySharingPolicy":{"allowSameTenantReferralLookup":true,"requireExplicitConsentOrReferralToken":true}},"RS_SWASTA":{"configVersion":1,"lifecycleStage":"ACTIVE","changeNotes":"Baseline konfigurasi kapabilitas awal fasilitas","enabledSubCapabilities":["SUB_PATIENT_MPI","SUB_ADMISSION_OUTPATIENT","SUB_DOCTOR_SCHEDULE_BOOKING","SUB_OUTPATIENT_SOAP_CPPT","SUB_DENTAL_ODONTOGRAM","SUB_ANC_BASIC","SUB_IMMUNIZATION_VACCINE","SUB_CHRONIC_DISEASE_REGISTRY","SUB_PRB_MEDICATION_CONTINUITY","SUB_MCU_MEDICAL_CERTIFICATES","SUB_PHARMACY_DISPENSING_FEFO","SUB_PHARMACY_INVENTORY_OPNAME","SUB_PROCUREMENT_PO_PBF","SUB_LAB_PATHOLOGY","SUB_CASHIER_BILLING_DEPOSIT","SUB_ACCOUNTING_DOUBLE_ENTRY","SUB_MEDICAL_FEE_PAYROLL","SUB_REGULATORY_REPORTS","SUB_REFERRAL_ORCHESTRATION","SUB_INPATIENT_BED_MGMT","SUB_IGD_TRIAGE_ATS","SUB_CLINICAL_EWS_SCORING","SUB_DELIVERY_PARTOGRAPH","SUB_RADIOLOGY_IMAGING","SUB_CLAIM_FKRTL_CASEMIX","SUB_ADMISSION_EMERGENCY","SUB_HIGH_RISK_OBSTETRICS","SUB_SURGERY_IBS","SUB_HEMODIALYSIS_UNIT","SUB_NUTRITION_DIETARY","SUB_BLOOD_BANK_BDRS","SUB_CSSD_STERILIZATION","SUB_IPSRS_AMBULANCE"],"activeServices":["RAWAT_JALAN_SPESIALIS","IGD_24_JAM","RAWAT_INAP","BEDAH_IBS","HEMODIALISIS","LAB_PATOLOGI","RADIOLOGI"],"units":[{"unitCode":"POLI_PD","unitName":"Poliklinik Penyakit Dalam","unitType":"POLIKLINIK_SPESIALIS","costCenterCode":"CC-RJ-PD","active":true},{"unitCode":"POLI_ANAK","unitName":"Poliklinik Kesehatan Anak","unitType":"POLIKLINIK_SPESIALIS","costCenterCode":"CC-RJ-ANK","active":true},{"unitCode":"POLI_BEDAH","unitName":"Poliklinik Bedah Umum","unitType":"POLIKLINIK_SPESIALIS","costCenterCode":"CC-RJ-BDH","active":true},{"unitCode":"IGD_24","unitName":"Instalasi Gawat Darurat 24 Jam","unitType":"IGD","costCenterCode":"CC-IGD","active":true},{"unitCode":"RANAP_UTAMA","unitName":"Bangsal Rawat Inap Terpadu","unitType":"BANGSAL_RANAP","costCenterCode":"CC-RANAP","active":true},{"unitCode":"IBS_OK","unitName":"Instalasi Bedah Sentral","unitType":"KAMAR_OPERASI","costCenterCode":"CC-IBS","active":true},{"unitCode":"DEPO_UTAMA","unitName":"Instalasi Farmasi Sentral","unitType":"DEPO_FARMASI","costCenterCode":"CC-FAR","active":true}],"terminologyOverrides":{"outpatientUnitLabel":"Poliklinik","triageProtocol":"PENANDA_VITAL_LOKAL"},"formSchemas":[{"formCode":"FRM_SOAP_STANDARD","formName":"Formulir Rekam Medis SOAP & CPPT","schemaVersion":1,"targetModule":"RME_DOKTER","fields":[{"fieldKey":"chiefComplaint","label":"Keluhan Utama","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"vitals","label":"Tanda Vital Lengkap","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"primaryIcd10Code","label":"Diagnosis Primer ICD-10","fieldType":"TEXT","required":true,"isCoreLocked":true},{"fieldKey":"nutritionalStatus","label":"Skrining Nutrisi MST","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Risiko Rendah","Risiko Sedang","Risiko Tinggi"]},{"fieldKey":"fallRiskAssessment","label":"Risiko Jatuh Morse/Humpty Dumpty","fieldType":"SELECT","required":false,"isCoreLocked":false,"options":["Tidak Berisiko","Risiko Rendah","Risiko Tinggi"]}]}],"workflowPolicies":{"requirePaymentBeforeDispenseOutpatientUmum":false,"allowEmergencyOrderBeforeFullRegistration":true,"rmeCorrectionWindowHours":48},"tariffMultiplier":1,"billingPolicy":{},"pharmacyPolicy":{"allocationMethod":"FEFO"},"dashboardTargets":{},"externalConnectors":{"satusehatMode":"DISABLED","bpjsMode":"DISABLED"},"accountingPolicy":{"fiscalPeriodStatus":"OPEN"},"crossFacilitySharingPolicy":{"allowSameTenantReferralLookup":true,"requireExplicitConsentOrReferralToken":true}}}"###;
