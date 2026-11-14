use crate::domain::fefo;
use crate::http::{
    ApiError, ApiResult, App, RequestContext, array, array_mut, audit, bad_request, conflict, id,
    json_response, not_found, now, require_service, save, text,
};
use serde_json::{Value, json};

fn n(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .or_else(|| value[key].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}
fn value_or<'a>(value: &'a Value, key: &str, default: &'a str) -> &'a str {
    let result = text(value, key);
    if result.is_empty() { default } else { result }
}
fn medication_index(
    app: &App,
    ctx: &RequestContext,
    medication_id: &str,
) -> Result<usize, ApiError> {
    array(&app.db, "medications")
        .iter()
        .position(|m| {
            text(m, "id") == medication_id && text(m, "facilityCode") == ctx.facility_code
        })
        .ok_or_else(|| not_found("Data obat/alkes tidak ditemukan."))
}
fn valid_date(value: &str) -> bool {
    chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
}

pub(crate) fn stock_mutation(
    app: &mut App,
    ctx: &RequestContext,
    med: &Value,
    batch: &str,
    before: f64,
    after: f64,
    price: f64,
    kind: &str,
    reference: &str,
    counterparty: &str,
    notes: &str,
) {
    array_mut(&mut app.db,"medicationMutations").insert(0,json!({"id":id("mut"),"facilityCode":ctx.facility_code,"timestamp":now(),"medicationId":med["id"],"medicationCode":med["code"],"medicationName":med["name"],"batchNumber":batch,"unit":med["unit"],"type":kind,"quantityChange":after-before,"stockBefore":before,"stockAfter":after,"unitPrice":price,"totalValue":(after-before).abs()*price,"referenceId":reference,"counterpartyOrPatient":counterparty,"actorName":ctx.user["fullName"],"notes":notes}));
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
    if path == "/api/medications" {
        return Some(create(app, ctx, body));
    }
    if path == "/api/medications/batch-opname" {
        return Some(opname(app, ctx, None, body));
    }
    if let Some(rest) = path.strip_prefix("/api/pharmacy/") {
        if let Some(order) = rest.strip_suffix("/dispense") {
            return Some(dispense(app, ctx, order, body));
        }
    }
    if let Some(rest) = path.strip_prefix("/api/medications/") {
        if let Some(med) = rest.strip_suffix("/restock") {
            return Some(restock(app, ctx, med, body));
        }
        if let Some(med) = rest.strip_suffix("/dispense-direct") {
            return Some(direct(app, ctx, med, body));
        }
        if let Some(med) = rest.strip_suffix("/opname") {
            return Some(opname(app, ctx, Some(med), body));
        }
    }
    None
}

fn create(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["APOTEK", "KATALOG_OPNAME"],
        &["SUB_PHARMACY_INVENTORY_OPNAME"],
    )?;
    if ["code", "name", "genericName", "category", "form", "unit"]
        .iter()
        .any(|key| text(body, key).trim().is_empty())
    {
        return Err(bad_request(
            "Kode Obat, Nama Dagang, dan Nama Generik wajib diisi.",
        ));
    }
    let code = text(body, "code").trim().to_uppercase();
    if array(&app.db, "medications").iter().any(|m| {
        text(m, "facilityCode") == ctx.facility_code && text(m, "code").eq_ignore_ascii_case(&code)
    }) {
        return Err(conflict("Kode obat sudah digunakan di fasilitas ini."));
    }
    let stock = n(body, "initialStock");
    let buy = n(body, "buyPrice");
    let sell = n(body, "sellPrice");
    let minimum = n(body, "minStock");
    if [stock, buy, sell, minimum]
        .iter()
        .any(|v| !v.is_finite() || *v < 0.0)
        || !body["buyPrice"].is_number()
        || !body["sellPrice"].is_number()
    {
        return Err(bad_request(
            "Stok dan harga obat harus berupa angka nonnegatif.",
        ));
    }
    let batch = text(body, "initialBatchNumber").trim().to_uppercase();
    let expiry = text(body, "initialExpiryDate");
    if stock > 0.0 && (batch.is_empty() || !valid_date(expiry)) {
        return Err(bad_request(
            "Nomor batch dan tanggal kedaluwarsa wajib diisi untuk stok awal.",
        ));
    }
    let batches = if stock > 0.0 {
        vec![json!({"batchNumber":batch,"expiryDate":expiry,"stock":stock})]
    } else {
        vec![]
    };
    let med = json!({"id":id("med"),"facilityCode":ctx.facility_code,"code":code,"kfaCode":text(body,"kfaCode").trim(),"name":text(body,"name").trim(),"genericName":text(body,"genericName").trim(),"category":text(body,"category").trim(),"form":text(body,"form").trim(),"unit":text(body,"unit").trim(),"minStock":minimum,"buyPrice":buy,"sellPrice":sell,"contraindications":array(body,"contraindications"),"interactions":array(body,"interactions"),"batches":batches});
    array_mut(&mut app.db, "medications").insert(0, med.clone());
    if stock > 0.0 {
        stock_mutation(
            app,
            ctx,
            &med,
            &batch,
            0.0,
            stock,
            buy,
            "STOK_AWAL",
            &format!("INIT-{code}"),
            "Registrasi Master SKU Baru",
            &format!("Saldo stok awal master obat {}", text(&med, "name")),
        );
    }
    audit(
        app,
        ctx,
        "MEDICATION_MASTER_CREATE",
        &code,
        &format!(
            "Penambahan master obat {} dengan stok awal {stock}.",
            text(&med, "name")
        ),
    );
    save(app)?;
    json_response(201, med)
}

fn restock(app: &mut App, ctx: &RequestContext, medication_id: &str, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["APOTEK", "KATALOG_OPNAME", "MUTASI_STOK"],
        &["SUB_PHARMACY_INVENTORY_OPNAME"],
    )?;
    let index = medication_index(app, ctx, medication_id)?;
    let mut med = array(&app.db, "medications")[index].clone();
    let batch = text(body, "batchNumber").trim().to_uppercase();
    let expiry = text(body, "expiryDate");
    let qty = n(body, "quantity");
    if batch.is_empty() || !valid_date(expiry) || !qty.is_finite() || qty <= 0.0 {
        return Err(bad_request(
            "Nomor Batch, Tanggal Kedaluwarsa, dan Jumlah Stok Masuk (> 0) wajib diisi.",
        ));
    }
    let batch_index = array(&med, "batches")
        .iter()
        .position(|b| text(b, "batchNumber").eq_ignore_ascii_case(&batch));
    let before = batch_index
        .map(|i| n(&array(&med, "batches")[i], "stock"))
        .unwrap_or(0.0);
    if let Some(i) = batch_index {
        array_mut(&mut med, "batches")[i]["stock"] = json!(before + qty);
        array_mut(&mut med, "batches")[i]["expiryDate"] = json!(expiry);
    } else {
        array_mut(&mut med, "batches")
            .push(json!({"batchNumber":batch,"expiryDate":expiry,"stock":qty}));
    }
    let supplier = text(body, "supplierName").trim();
    let notes = format!("Penerimaan stok masuk Batch {batch} (ED {expiry}) dari {supplier}");
    stock_mutation(
        app,
        ctx,
        &med,
        &batch,
        before,
        before + qty,
        n(&med, "buyPrice"),
        "MASUK_PBF",
        &format!("PBF-{batch}"),
        supplier,
        &notes,
    );
    array_mut(&mut app.db, "medications")[index] = med.clone();
    audit(
        app,
        ctx,
        "INVENTORY_BATCH_RESTOCK",
        text(&med, "code"),
        &notes,
    );
    save(app)?;
    json_response(200, med)
}

fn allocate(
    app: &mut App,
    ctx: &RequestContext,
    med: &mut Value,
    quantity: f64,
    price: f64,
    reference: &str,
    counterparty: &str,
    notes: &str,
) -> Result<Vec<Value>, ApiError> {
    if !quantity.is_finite() || quantity <= 0.0 {
        return Err(bad_request("Jumlah obat harus lebih dari nol."));
    }
    let before = array(med, "batches").clone();
    let (updated, allocations) = fefo(&before, quantity).map_err(|shortfall| {
        bad_request(format!(
            "Stok {} tidak mencukupi (kurang {shortfall} {}).",
            text(med, "name"),
            text(med, "unit")
        ))
    })?;
    med["batches"] = json!(updated);
    for allocation in &allocations {
        let batch = text(allocation, "batchNumber");
        let stock = before
            .iter()
            .find(|b| text(b, "batchNumber") == batch)
            .map(|b| n(b, "stock"))
            .unwrap_or(0.0);
        stock_mutation(
            app,
            ctx,
            med,
            batch,
            stock,
            stock - n(allocation, "quantity"),
            price,
            "KELUAR_RESEP",
            reference,
            counterparty,
            notes,
        );
    }
    Ok(allocations)
}

fn direct(app: &mut App, ctx: &RequestContext, medication_id: &str, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["APOTEK", "MUTASI_STOK"],
        &["SUB_PHARMACY_INVENTORY_OPNAME"],
    )?;
    let index = medication_index(app, ctx, medication_id)?;
    let mut med = array(&app.db, "medications")[index].clone();
    let target = text(body, "patientOrUnitName").trim();
    if target.is_empty() {
        return Err(bad_request(
            "Jumlah Obat Keluar (> 0) dan Nama Pasien / Unit Tujuan wajib diisi.",
        ));
    }
    let quantity = n(body, "quantity");
    let price = n(&med, "sellPrice");
    allocate(
        app,
        ctx,
        &mut med,
        quantity,
        price,
        &id("DSP"),
        target,
        value_or(
            body,
            "notes",
            "Pengeluaran obat langsung / penyerahan farmasi FEFO",
        ),
    )?;
    let description = format!(
        "Pengeluaran Obat {} (-{quantity} {}) untuk {target}",
        text(&med, "name"),
        text(&med, "unit")
    );
    array_mut(&mut app.db, "medications")[index] = med.clone();
    audit(
        app,
        ctx,
        "PHARMACY_DIRECT_DISPENSE",
        text(&med, "code"),
        &description,
    );
    save(app)?;
    json_response(200, med)
}

fn dispense(app: &mut App, ctx: &RequestContext, order_id: &str, body: &Value) -> ApiResult {
    require_service(app, ctx, &["APOTEK"], &["SUB_PHARMACY_DISPENSING_FEFO"])?;
    let index = array(&app.db, "pharmacyOrders")
        .iter()
        .position(|row| {
            text(row, "id") == order_id && text(row, "facilityCode") == ctx.facility_code
        })
        .ok_or_else(|| not_found("Order resep farmasi tidak ditemukan."))?;
    let mut order = array(&app.db, "pharmacyOrders")[index].clone();
    if text(&order, "status") == "DISERAHKAN" {
        return Err(conflict("Resep ini sudah diserahkan sebelumnya."));
    }
    let mut dispensed = vec![];
    for item in array(&order, "items") {
        let med_index = array(&app.db, "medications")
            .iter()
            .position(|m| {
                text(m, "facilityCode") == ctx.facility_code
                    && (text(m, "id") == text(item, "medicationId")
                        || text(m, "code") == text(item, "medicationCode"))
            })
            .ok_or_else(|| {
                not_found(format!(
                    "Obat {} tidak ditemukan di fasilitas ini.",
                    text(item, "medicationName")
                ))
            })?;
        let mut med = array(&app.db, "medications")[med_index].clone();
        let price = item
            .get("unitPrice")
            .filter(|value| !value.is_null())
            .or_else(|| med.get("sellPrice"))
            .and_then(Value::as_f64)
            .filter(|price| price.is_finite() && *price >= 0.0)
            .ok_or_else(|| {
                bad_request(
                    "Harga penyerahan obat harus berasal dari resep atau katalog yang telah diisi.",
                )
            })?;
        let counterparty = format!(
            "Pasien: {} ({})",
            text(&order, "patientName"),
            text(&order, "mrNumber")
        );
        let notes = format!(
            "Penyerahan E-Resep FEFO ({} • {}) dr. {}",
            text(item, "dosage"),
            text(item, "signa"),
            text(&order, "doctorName")
        );
        for allocation in allocate(
            app,
            ctx,
            &mut med,
            n(item, "quantity"),
            price,
            order_id,
            &counterparty,
            &notes,
        )? {
            dispensed.push(json!({"medicationCode":med["code"],"batchNumber":allocation["batchNumber"],"quantity":allocation["quantity"]}));
        }
        array_mut(&mut app.db, "medications")[med_index] = med;
    }
    order["status"] = json!("DISERAHKAN");
    order["dispensedBatches"] = json!(dispensed);
    order["dispensedBy"] = ctx.user["fullName"].clone();
    order["dispensedAt"] = json!(now());
    order["pharmacistNotes"] = json!(value_or(
        body,
        "pharmacistNotes",
        "Telaah resep 7 benar terpenuhi, edukasi aturan pakai telah disampaikan."
    ));
    let pending_lab = array(&app.db, "labOrders").iter().any(|lab| {
        text(lab, "visitId") == text(&order, "visitId")
            && text(lab, "facilityCode") == ctx.facility_code
            && text(lab, "status") != "SELESAI_VERIFIKASI"
    });
    if !pending_lab {
        for visit in array_mut(&mut app.db, "visits").iter_mut().filter(|v| {
            text(v, "id") == text(&order, "visitId")
                && text(v, "facilityCode") == ctx.facility_code
                && text(v, "status") == "FARMASI_LAB"
        }) {
            visit["status"] = json!("KASIR");
            visit["updatedAt"] = json!(now());
        }
    }
    array_mut(&mut app.db, "pharmacyOrders")[index] = order.clone();
    audit(
        app,
        ctx,
        "PHARMACY_FEFO_DISPENSE",
        order_id,
        &format!(
            "Penyerahan obat FEFO untuk {}.",
            text(&order, "patientName")
        ),
    );
    save(app)?;
    json_response(200, order)
}

fn opname(
    app: &mut App,
    ctx: &RequestContext,
    medication_id: Option<&str>,
    body: &Value,
) -> ApiResult {
    require_service(
        app,
        ctx,
        &["APOTEK", "KATALOG_OPNAME"],
        &["SUB_PHARMACY_INVENTORY_OPNAME"],
    )?;
    let items = if let Some(med) = medication_id {
        vec![
            json!({"medicationId":med,"batchNumber":body["batchNumber"],"actualStock":body["actualStock"]}),
        ]
    } else {
        array(body, "items").clone()
    };
    if items.is_empty() {
        return Err(bad_request("Daftar item stok opname kosong."));
    }
    let mut updated = 0;
    let mut single = Value::Null;
    for item in items {
        let index = medication_index(app, ctx, text(&item, "medicationId"))?;
        let mut med = array(&app.db, "medications")[index].clone();
        let batch = text(&item, "batchNumber").trim();
        let batch_index = array(&med, "batches")
            .iter()
            .position(|b| text(b, "batchNumber").eq_ignore_ascii_case(batch))
            .ok_or_else(|| {
                not_found(format!(
                    "Batch {batch} tidak ditemukan pada item {}.",
                    text(&med, "name")
                ))
            })?;
        let actual = n(&item, "actualStock");
        if item.get("actualStock").is_none() || !actual.is_finite() || actual < 0.0 {
            return Err(bad_request("Stok fisik harus berupa angka nonnegatif."));
        }
        let previous = n(&array(&med, "batches")[batch_index], "stock");
        array_mut(&mut med, "batches")[batch_index]["stock"] = json!(actual);
        if actual != previous || medication_id.is_some() {
            stock_mutation(
                app,
                ctx,
                &med,
                batch,
                previous,
                actual,
                n(&med, "buyPrice"),
                "PENYESUAIAN_OPNAME",
                &format!("SO-{}", now()[..10].replace('-', "")),
                "Audit Stok Opname Fisik",
                value_or(body, "reason", "Penyesuaian stok opname fisik berkala"),
            );
            updated += 1;
        }
        array_mut(&mut app.db, "medications")[index] = med.clone();
        single = med;
    }
    audit(
        app,
        ctx,
        if medication_id.is_some() {
            "PHARMACY_STOCK_OPNAME"
        } else {
            "PHARMACY_BATCH_STOCK_OPNAME"
        },
        medication_id.unwrap_or("OPNAME"),
        &format!(
            "Penyesuaian stok fisik untuk {updated} batch. {}",
            text(body, "reason")
        ),
    );
    save(app)?;
    json_response(
        200,
        if medication_id.is_some() {
            single
        } else {
            json!({"updatedCount":updated,"mutationsCreated":updated})
        },
    )
}
