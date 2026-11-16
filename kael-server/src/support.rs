use crate::finance::append_service_charge;
use crate::http::{
    ApiResult, App, RequestContext, array, array_mut, audit, bad_request, id, json_response,
    next_document, not_found, now, require_service, save, text,
};
use crate::pharmacy::stock_mutation;
use serde_json::{Value, json};

fn n(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .or_else(|| value[key].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}
fn alias<'a>(value: &'a Value, first: &str, second: &str) -> &'a str {
    if text(value, first).is_empty() {
        text(value, second)
    } else {
        text(value, first)
    }
}
fn numeric_alias(value: &Value, keys: &[&str]) -> f64 {
    keys.iter()
        .find(|key| !value[**key].is_null())
        .map(|key| n(value, key))
        .unwrap_or(0.0)
}
fn default<'a>(value: &'a Value, key: &str, fallback: &'a str) -> &'a str {
    if text(value, key).is_empty() {
        fallback
    } else {
        text(value, key)
    }
}

pub fn handle(
    app: &mut App,
    ctx: &RequestContext,
    method: &str,
    path: &str,
    body: &Value,
) -> Option<ApiResult> {
    if method != "POST" {
        return None;
    }
    match path {
        "/api/procurement/po" => Some(procurement(app, ctx, body)),
        "/api/radiology" => Some(radiology(app, ctx, body)),
        "/api/referrals" => Some(referral(app, ctx, body)),
        "/api/bridging/sync" => Some(bridging(app, ctx, body)),
        "/api/evidence" => Some(evidence(app, ctx, body)),
        "/api/surgical-schedules" => Some(surgery(app, ctx, body)),
        "/api/staff/attendance" => Some(staff_record(app, ctx, body, "attendance", "ABSENSI")),
        "/api/staff/leave" => Some(staff_record(app, ctx, body, "leaveRequests", "CUTI")),
        "/api/staff/payroll" => Some(staff_record(app, ctx, body, "payrollRuns", "PENGGAJIAN")),
        _ => None,
    }
}

fn procurement(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(app, ctx, &["PENGADAAN_PBF"], &["SUB_PROCUREMENT_PO_PBF"])?;
    let supplier = alias(body, "supplierPbfName", "supplierName").trim();
    let original_items = array(body, "items");
    if supplier.is_empty() || original_items.is_empty() {
        return Err(bad_request(
            "Nama Distributor PBF dan daftar item pesanan wajib diisi.",
        ));
    }
    let receive = body["receiveImmediately"].as_bool().unwrap_or(false);
    let vat_rate = body["vatRatePct"]
        .as_f64()
        .filter(|rate| rate.is_finite() && (0.0..=100.0).contains(rate))
        .ok_or_else(|| {
            bad_request("Tarif PPN faktur harus diisi secara eksplisit antara 0 sampai 100 persen.")
        })?;
    let due_date = text(body, "dueDate");
    if !due_date.is_empty() && chrono::NaiveDate::parse_from_str(due_date, "%Y-%m-%d").is_err() {
        return Err(bad_request("Tanggal jatuh tempo faktur tidak valid."));
    }
    let timestamp = now();
    let mut items = vec![];
    let mut subtotal = 0.0;
    let mut discounts = 0.0;
    let head = format!(
        "PO/{}/{}/",
        ctx.facility_code.chars().take(4).collect::<String>(),
        timestamp[..7].replace('-', "")
    );
    let po_number = format!(
        "{head}{:04}",
        next_document(array(&app.db, "purchaseOrders"), "poNumber", &head)
    );
    for item in original_items {
        let qty = numeric_alias(item, &["orderedQty", "quantity"]);
        let price = numeric_alias(item, &["hnaUnitPrice", "unitCostHna", "hnaPrice"]);
        let discount = n(item, "discountPct");
        if !qty.is_finite()
            || qty <= 0.0
            || !price.is_finite()
            || price < 0.0
            || !["hnaUnitPrice", "unitCostHna", "hnaPrice"]
                .iter()
                .any(|key| item[*key].is_number())
            || !discount.is_finite()
            || !(0.0..=100.0).contains(&discount)
        {
            return Err(bad_request(
                "Jumlah, harga HNA, dan diskon item PBF tidak valid.",
            ));
        }
        let med_index = array(&app.db, "medications")
            .iter()
            .position(|med| {
                text(med, "facilityCode") == ctx.facility_code
                    && ((!text(item, "medicationId").is_empty()
                        && text(med, "id") == text(item, "medicationId"))
                        || (!text(item, "medicationCode").is_empty()
                            && text(med, "code") == text(item, "medicationCode")))
            })
            .ok_or_else(|| not_found("Item obat PBF tidak ditemukan di fasilitas ini."))?;
        let mut med = array(&app.db, "medications")[med_index].clone();
        let batch = text(item, "batchNumber").trim().to_uppercase();
        let expiry = text(item, "expiryDate");
        let today = &timestamp[..10];
        if receive
            && (batch.is_empty()
                || chrono::NaiveDate::parse_from_str(expiry, "%Y-%m-%d").is_err()
                || expiry < today)
        {
            return Err(bad_request(
                "Batch dan tanggal kedaluwarsa aktif diperlukan untuk penerimaan PBF.",
            ));
        }
        let item_subtotal = qty * price;
        let item_discount = (item_subtotal * discount / 100.0).round();
        subtotal += item_subtotal;
        discounts += item_discount;
        let mut normalized = item.clone();
        for (key, value) in [
            ("medicationId", med["id"].clone()),
            ("medicationCode", med["code"].clone()),
            ("medicationName", med["name"].clone()),
            ("orderedQty", json!(qty)),
            ("quantity", json!(qty)),
            ("hnaUnitPrice", json!(price)),
            ("unitCostHna", json!(price)),
            ("receivedQty", json!(if receive { qty } else { 0.0 })),
            ("subtotalHna", json!(item_subtotal)),
        ] {
            normalized[key] = value;
        }
        items.push(normalized);
        if receive {
            let batch_index = array(&med, "batches")
                .iter()
                .position(|row| text(row, "batchNumber").eq_ignore_ascii_case(&batch));
            let before = batch_index
                .map(|index| n(&array(&med, "batches")[index], "stock"))
                .unwrap_or(0.0);
            if let Some(index) = batch_index {
                array_mut(&mut med, "batches")[index]["stock"] = json!(before + qty);
                array_mut(&mut med, "batches")[index]["expiryDate"] = json!(expiry);
            } else {
                array_mut(&mut med, "batches")
                    .push(json!({"batchNumber":batch,"expiryDate":expiry,"stock":qty}));
            }
            med["buyPrice"] = json!(price);
            stock_mutation(
                app,
                ctx,
                &med,
                &batch,
                before,
                before + qty,
                price,
                "MASUK_PBF",
                &po_number,
                supplier,
                "Penerimaan pesanan distributor PBF",
            );
            array_mut(&mut app.db, "medications")[med_index] = med;
        }
    }
    let net = (subtotal - discounts).max(0.0);
    let vat = (net * vat_rate / 100.0).round();
    let total = net + vat;
    let invoice = alias(body, "invoicePbfNumber", "supplierInvoiceNo");
    let po = json!({"id":id("po"),"facilityCode":ctx.facility_code,"poNumber":po_number,"supplierPbfName":supplier,"supplierName":supplier,"orderDate":&timestamp[..10],"dueDate":due_date,"status":if receive{"RECEIVED_FULL"}else{"ORDERED"},"items":items,"subtotalHna":subtotal,"discountTotal":discounts,"totalDiscount":discounts,"vatRatePct":vat_rate,"ppnAmount":vat,"totalVat":vat,"grandTotalPayable":total,"totalAmount":total,"invoicePbfNumber":invoice,"supplierInvoiceNo":invoice,"createdBy":ctx.user["fullName"],"receivedAt":if receive{json!(timestamp)}else{Value::Null}});
    let journal = if receive {
        let tenant = array(&app.db, "facilities")
            .iter()
            .find(|row| text(row, "code") == ctx.facility_code)
            .map(|row| default(row, "tenantId", &ctx.facility_code).to_owned())
            .unwrap_or_else(|| ctx.facility_code.clone());
        let gl_head = format!(
            "GL/{}/{}/",
            ctx.facility_code.chars().take(4).collect::<String>(),
            timestamp[..10].replace('-', "")
        );
        let gl_seq = next_document(array(&app.db, "doubleEntryJournals"), "journalNumber", &gl_head);
        let journal = json!({"id":id("gl"),"tenantId":tenant,"facilityCode":ctx.facility_code,"journalNumber":format!("{gl_head}{gl_seq:04}"),"timestamp":timestamp,"eventType":"INVENTORY_RECEIVED_PBF","sourceTransactionId":po_number,"description":format!("Penerimaan Faktur PBF {supplier} ({invoice})"),"lines":[{"accountCode":"1-1400","accountName":"Persediaan Obat & BMHP (HNA + PPN)","accountCategory":"ASSET","debit":total.round(),"credit":0,"costCenterCode":"CC-FAR"},{"accountCode":"2-1100","accountName":"Utang Dagang Distributor PBF","accountCategory":"LIABILITY","debit":0,"credit":total.round(),"costCenterCode":"CC-FAR"}],"totalDebit":total.round(),"totalCredit":total.round(),"isBalanced":total>0.0,"status":"POSTED_IMMUTABLE","actorName":ctx.user["fullName"]});
        array_mut(&mut app.db, "doubleEntryJournals").push(journal.clone());
        journal
    } else {
        Value::Null
    };
    array_mut(&mut app.db, "purchaseOrders").push(po.clone());
    audit(
        app,
        ctx,
        "PROCUREMENT_PO_CREATED",
        &po_number,
        &format!("Penerbitan PO PBF {supplier} senilai Rp {total}; diterima: {receive}."),
    );
    save(app)?;
    json_response(201, json!({"purchaseOrder":po,"journal":journal}))
}

fn radiology(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(app, ctx, &["RADIOLOGI_RIS"], &["SUB_RADIOLOGY_IMAGING"])?;
    let visit = array(&app.db, "visits")
        .iter()
        .find(|row| {
            text(row, "id") == text(body, "visitId")
                && text(row, "facilityCode") == ctx.facility_code
        })
        .cloned()
        .ok_or_else(|| not_found("Kunjungan pasien radiologi tidak ditemukan di fasilitas ini."))?;
    if text(body, "examName").trim().is_empty() || text(body, "modality").trim().is_empty() {
        return Err(bad_request(
            "Jenis dan modalitas pemeriksaan radiologi wajib diisi.",
        ));
    }
    let timestamp = now();
    let findings = alias(body, "findingsText", "findings").trim();
    let impression = alias(body, "impressionConclusion", "impression").trim();
    let tariff = body.get("tariff").filter(|value| !value.is_null());
    if tariff.is_some_and(|value| {
        !value
            .as_f64()
            .is_some_and(|tariff| tariff.is_finite() && tariff >= 0.0)
    }) {
        return Err(bad_request("Tarif radiologi tidak valid."));
    }
    let order = json!({"id":id("rad"),"facilityCode":ctx.facility_code,"visitId":visit["id"],"patientId":visit["patientId"],"patientName":visit["patientName"],"mrNumber":visit["mrNumber"],"modality":text(body,"modality").trim(),"examName":text(body,"examName").trim(),"clinicalIndication":default(body,"clinicalIndication",text(&visit,"chiefComplaint")),"priority":text(body,"priority"),"status":if findings.is_empty(){"ORDERED"}else{"EXPERTISE_VERIFIED"},"accessionNumber":id("ACC"),"findingsText":findings,"findings":findings,"impressionConclusion":impression,"impression":impression,"radiologistName":ctx.user["fullName"],"tariff":tariff,"pricingStatus":if tariff.is_some(){"COMPLETE"}else{"PENDING"},"billingStatus":"NOT_BILLED","createdAt":timestamp,"verifiedAt":if findings.is_empty(){Value::Null}else{json!(timestamp)}});
    array_mut(&mut app.db, "radiologyOrders").push(order.clone());
    if let Some(tariff) = order["tariff"].as_f64().filter(|tariff| tariff.is_finite() && *tariff > 0.0) {
        append_service_charge(
            app, ctx, text(&visit, "id"), text(&visit, "patientId"), text(&visit, "patientName"),
            text(&visit, "mrNumber"), text(&visit, "guarantor"), text(&visit, "guarantorSettlement"),
            "RADIOLOGI", &format!("Radiologi: {}", text(&order, "examName")), 1.0, tariff,
        );
        if let Some(rows) = app.db["radiologyOrders"].as_array_mut() {
        if let Some(last) = rows.last_mut() { last["billingStatus"] = json!("BILLED"); }
        }
    }
    audit(
        app,
        ctx,
        "RADIOLOGY_ORDER_CREATED",
        text(&order, "accessionNumber"),
        &format!(
            "Pemeriksaan {} untuk {}.",
            text(&order, "examName"),
            text(&visit, "patientName")
        ),
    );
    save(app)?;
    json_response(201, order)
}

fn referral(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["RME_DOKTER", "BRIDGING_SATUSEHAT"],
        &["SUB_REFERRAL_ORCHESTRATION"],
    )?;
    if [
        "destinationFacilityCode",
        "destinationFacilityName",
        "primaryIcd10Code",
    ]
    .iter()
    .any(|key| text(body, key).trim().is_empty())
    {
        return Err(bad_request(
            "Fasilitas tujuan rujukan dan kode ICD-10 wajib diisi.",
        ));
    }
    let patient = array(&app.db, "patients")
        .iter()
        .find(|row| {
            text(row, "facilityCode") == ctx.facility_code
                && ((!text(body, "patientId").is_empty()
                    && text(row, "id") == text(body, "patientId"))
                    || (!text(body, "nik").is_empty() && text(row, "nik") == text(body, "nik")))
        })
        .cloned()
        .ok_or_else(|| not_found("Pasien rujukan tidak ditemukan di fasilitas ini."))?;
    let facility = array(&app.db, "facilities")
        .iter()
        .find(|row| text(row, "code") == ctx.facility_code)
        .cloned()
        .ok_or_else(|| not_found("Fasilitas asal tidak ditemukan."))?;
    let code = text(body, "primaryIcd10Code").trim().to_uppercase();
    let timestamp = now();
    let head = format!(
        "RUJ/{}/{}/",
        ctx.facility_code.chars().take(4).collect::<String>(),
        timestamp[..10].replace('-', "")
    );
    let number = format!("{head}{:04}", next_document(array(&app.db, "referrals"), "referralNumber", &head));
    let record = json!({"id":id("ref"),"referralNumber":number,"patientId":patient["id"],"patientName":patient["fullName"],"nik":patient["nik"],"bpjsNumber":patient["bpjsNumber"],"originFacilityCode":ctx.facility_code,"originFacilityName":facility["name"],"destinationFacilityCode":text(body,"destinationFacilityCode").trim(),"destinationFacilityName":text(body,"destinationFacilityName").trim(),"direction":text(body,"direction"),"state":"CREATED","primaryIcd10Code":code,"primaryIcd10Name":default(body,"primaryIcd10Name",&code),"isSkdi4aDiagnosis":body["isSkdi4aDiagnosis"].as_bool(),"hasTaccException":body["hasTaccException"].as_bool(),"taccCategory":body["taccCategory"],"taccJustification":body["taccJustification"],"clinicalSummary":text(body,"clinicalSummary"),"stabilizationProvided":text(body,"stabilizationProvided"),"prbCarePlanNotes":body["prbCarePlanNotes"],"createdAt":timestamp,"updatedAt":timestamp});
    array_mut(&mut app.db, "referrals").push(record.clone());
    audit(
        app,
        ctx,
        "REFERRAL_ORCHESTRATION_CREATE",
        &number,
        &format!(
            "Rujukan untuk {} ke {}.",
            text(&patient, "fullName"),
            text(body, "destinationFacilityName")
        ),
    );
    save(app)?;
    json_response(201, record)
}

fn bridging(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["BRIDGING_SATUSEHAT"],
        &["SUB_REFERRAL_ORCHESTRATION"],
    )?;
    let target = text(body, "targetSystem");
    if ![
        "SATUSEHAT_FHIR_R4",
        "BPJS_PCARE",
        "BPJS_VCLAIM",
        "IOMT_GATEWAY",
    ]
    .contains(&target)
    {
        return Err(bad_request("Sistem tujuan tidak valid."));
    }
    let entry = json!({"id":id("brg"),"facilityCode":ctx.facility_code,"targetSystem":target,"resourceType":default(body,"resourceType","Permintaan sinkronisasi"),"referenceId":id("ref"),"patientName":text(body,"patientName"),"status":"QUEUED_LOCAL","externalId":"","latencyMs":0,"payloadPreview":if body["payloadPreview"].is_object(){body["payloadPreview"].clone()}else{json!({})},"timestamp":now()});
    array_mut(&mut app.db, "bridgingLogs").push(entry.clone());
    audit(
        app,
        ctx,
        "BRIDGING_MANUAL_SYNC",
        target,
        &format!(
            "Permintaan sinkronisasi {} dicatat dalam antrean lokal.",
            text(&entry, "resourceType")
        ),
    );
    save(app)?;
    json_response(201, entry)
}

fn evidence(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    if text(&ctx.user, "role") != "SUPERUSER" {
        require_service(app, ctx, &["SUPERUSER_CONTROL", "LAPORAN_REGULASI"], &[])?;
    }
    let kind = text(body, "evidenceType").trim().to_uppercase();
    let allowed = ["SIP_NAKES", "SIP_STR_NAKES", "SIPA_APOTEKER", "IZIN_OPERASIONAL", "KALIBRASI_ALKES", "MOU_PIHAK_KETIGA", "IZIN_BAPETEN_RADIOLOGI"];
    let valid_until = text(body, "validUntil").trim();
    if !allowed.contains(&kind.as_str())
        || text(body, "documentNumber").trim().is_empty()
        || chrono::NaiveDate::parse_from_str(valid_until, "%Y-%m-%d").is_err()
    {
        return Err(bad_request("Jenis bukti, nomor dokumen, dan masa berlaku (YYYY-MM-DD) wajib diisi dengan benar."));
    }
    let target_facility = if !ctx.facility_code.is_empty() {
        ctx.facility_code.clone()
    } else {
        crate::domain::normalize_facility(text(body, "facilityCode"))
    };
    if target_facility.is_empty() {
        return Err(bad_request("Pilih fasilitas aktif sebelum mendaftarkan bukti."));
    }
    let record = json!({"id":id("evd"),"facilityCode":target_facility,"evidenceType":kind,"documentNumber":text(body,"documentNumber").trim(),"referenceNumber":text(body,"documentNumber").trim(),"subjectName":text(body,"holderName").trim(),"holderOrVendorName":text(body,"holderName").trim(),"validUntil":valid_until,"verificationStatus":"VERIFIED_ACTIVE","verifiedBy":text(&ctx.user,"username"),"createdAt":now()});
    array_mut(&mut app.db, "evidenceRegistry").push(record.clone());
    audit(app, ctx, "EVIDENCE_REGISTERED", text(&record, "documentNumber"), &format!("Bukti {kind} dicatat."));
    save(app)?;
    json_response(201, record)
}

fn surgery(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(app, ctx, &["BEDAH_IBS"], &["SUB_SURGERY_IBS"])?;
    if text(body, "procedureName").trim().is_empty() || text(body, "scheduledStart").trim().is_empty() {
        return Err(bad_request("Nama tindakan dan jadwal operasi wajib diisi."));
    }
    let record = json!({"id":id("ibs"),"facilityCode":ctx.facility_code,"patientId":text(body,"patientId"),"patientName":text(body,"patientName").trim(),"mrNumber":text(body,"mrNumber").trim(),"procedureName":text(body,"procedureName").trim(),"icd9CmCode":text(body,"icd9CmCode").trim(),"operatingRoomCode":text(body,"operatingRoomCode").trim(),"surgeonName":text(body,"surgeonName").trim(),"anesthesiologistName":text(body,"anesthesiologistName").trim(),"scheduledStart":text(body,"scheduledStart").trim(),"status":"SCHEDULED","whoSignInCompleted":false,"whoTimeOutCompleted":false,"whoSignOutCompleted":false,"createdAt":now()});
    array_mut(&mut app.db, "surgicalSchedules").push(record.clone());
    audit(app, ctx, "SURGERY_SCHEDULED", text(&record, "id"), &format!("Jadwal {}.", text(&record, "procedureName")));
    save(app)?;
    json_response(201, record)
}

fn staff_record(app: &mut App, ctx: &RequestContext, body: &Value, collection: &str, action: &str) -> ApiResult {
    if text(&ctx.user, "role") != "SUPERUSER" {
        require_service(app, ctx, &["SDM_ERP", "SDM_JADWAL"], &[])?;
    }
    if ctx.facility_code.is_empty() {
        return Err(bad_request("Pilih fasilitas aktif sebelum mencatat data SDM."));
    }
    let staff_name = text(body, "staffName").trim();
    if staff_name.is_empty() {
        return Err(bad_request("Nama pegawai wajib diisi."));
    }
    let amount = body["amount"]
        .as_f64()
        .filter(|amount| amount.is_finite() && *amount >= 0.0)
        .unwrap_or(0.0)
        .round();
    let record = json!({"id":id("sdm"),"facilityCode":ctx.facility_code,"staffName":staff_name,"kind":action,"note":text(body,"note").trim(),"amount":amount,"date":text(body,"date").trim(),"status":if action == "CUTI" {"APPROVED"} else {"RECORDED"},"createdAt":now(),"createdBy":text(&ctx.user,"username")});
    array_mut(&mut app.db, collection).push(record.clone());
    if action == "PENGGAJIAN" && amount > 0.0 {
        let entry = crate::finance::accounting_entry(
            app,
            ctx,
            "5-2100",
            "Beban Gaji & Remunerasi SDM",
            "PENGELUARAN",
            "GAJI_SDM",
            &format!("Penggajian SDM — {staff_name}"),
            amount,
            text(&record, "id"),
        );
        crate::finance::record_books(app, ctx, &entry);
    }
    audit(app, ctx, action, text(&record, "id"), &format!("{action} {staff_name}."));
    save(app)?;
    json_response(201, record)
}
