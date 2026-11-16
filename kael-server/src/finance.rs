use crate::domain::invoice_totals;
use crate::http::{
    ApiResult, App, RequestContext, array, array_mut, audit, bad_request, conflict, id,
    json_response, next_document, not_found, now, require_service, save, text,
};
use serde_json::{Value, json};

fn number(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .or_else(|| value[key].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

fn uses_bpjs(value: &Value) -> bool {
    text(value, "guarantorSettlement") == "BPJS" || text(value, "guarantor") == "BPJS_KESEHATAN"
}

fn recalculate(invoice: &mut Value, discount: f64) {
    let totals = invoice_totals(array(invoice, "items"), uses_bpjs(invoice), discount);
    for key in [
        "subtotal",
        "discountAmount",
        "bpjsCoveredAmount",
        "patientPayableAmount",
        "claimRequestedAmount",
    ] {
        invoice[key] = totals[key].clone();
    }
}

pub fn accounting_entry(
    app: &App,
    ctx: &RequestContext,
    account_code: &str,
    account_name: &str,
    kind: &str,
    category: &str,
    description: &str,
    amount: f64,
    reference: &str,
) -> Value {
    let timestamp = now();
    let day = timestamp[..10].replace('-', "");
    let head = format!(
        "JRN/{}/{}/",
        ctx.facility_code.chars().take(4).collect::<String>(),
        day
    );
    let sequence = next_document(array(&app.db, "accountingEntries"), "entryNumber", &head);
    json!({"id":id("acc"),"facilityCode":ctx.facility_code,"entryNumber":format!("{head}{sequence:04}"),"timestamp":timestamp,"accountCode":account_code,"accountName":account_name,"type":kind,"category":category,"description":description,"amount":amount.round(),"referenceId":reference})
}

pub fn record_books(app: &mut App, ctx: &RequestContext, entry: &Value) {
    array_mut(&mut app.db, "accountingEntries").push(entry.clone());
    let amount = number(entry, "amount").round();
    let income = text(entry, "type") == "PENDAPATAN";
    let (debit_code, debit_name, credit_code, credit_name) = if income {
        ("1-1100", "Kas dan setara kas", text(entry, "accountCode"), text(entry, "accountName"))
    } else {
        (text(entry, "accountCode"), text(entry, "accountName"), "1-1100", "Kas dan setara kas")
    };
    let timestamp = text(entry, "timestamp");
    let day = if timestamp.len() >= 10 { timestamp[..10].replace('-', "") } else { "00000000".into() };
    let head = format!("GL/{}/{}/", ctx.facility_code.chars().take(4).collect::<String>(), day);
    let sequence = next_document(array(&app.db, "doubleEntryJournals"), "journalNumber", &head);
    let journal = json!({"id":id("gl"),"facilityCode":ctx.facility_code,"journalNumber":format!("{head}{sequence:04}"),"timestamp":timestamp,"eventType":text(entry,"type"),"sourceTransactionId":text(entry,"referenceId"),"description":text(entry,"description"),"lines":[{"accountCode":debit_code,"accountName":debit_name,"debit":amount,"credit":0},{"accountCode":credit_code,"accountName":credit_name,"debit":0,"credit":amount}],"totalDebit":amount,"totalCredit":amount,"isBalanced":amount>0.0,"status":"POSTED_IMMUTABLE","actorName":ctx.user["fullName"]});
    array_mut(&mut app.db, "doubleEntryJournals").push(journal);
}

fn balanced_journal(app: &mut App, ctx: &RequestContext, description: &str, reference: &str, debit_code: &str, debit_name: &str, credit_code: &str, credit_name: &str, amount: f64) {
    balanced_journal_with_event(app, ctx, "INVENTORY", description, reference, debit_code, debit_name, credit_code, credit_name, amount);
}

fn balanced_journal_with_event(
    app: &mut App,
    ctx: &RequestContext,
    event_type: &str,
    description: &str,
    reference: &str,
    debit_code: &str,
    debit_name: &str,
    credit_code: &str,
    credit_name: &str,
    amount: f64,
) {
    let amount = amount.round();
    if !amount.is_finite() || amount <= 0.0 {
        return;
    }
    let timestamp = now();
    let day = if timestamp.len() >= 10 { timestamp[..10].replace('-', "") } else { "00000000".into() };
    let head = format!("GL/{}/{}/", ctx.facility_code.chars().take(4).collect::<String>(), day);
    let sequence = next_document(array(&app.db, "doubleEntryJournals"), "journalNumber", &head);
    let journal = json!({"id":id("gl"),"facilityCode":ctx.facility_code,"journalNumber":format!("{head}{sequence:04}"),"timestamp":timestamp,"eventType":event_type,"sourceTransactionId":reference,"description":description,"lines":[{"accountCode":debit_code,"accountName":debit_name,"debit":amount,"credit":0},{"accountCode":credit_code,"accountName":credit_name,"debit":0,"credit":amount}],"totalDebit":amount,"totalCredit":amount,"isBalanced":true,"status":"POSTED_IMMUTABLE","actorName":ctx.user["fullName"]});
    array_mut(&mut app.db, "doubleEntryJournals").push(journal);
}

pub fn inventory_receipt(app: &mut App, ctx: &RequestContext, amount: f64, description: &str, reference: &str) {
    let amount = amount.round();
    if !amount.is_finite() || amount <= 0.0 {
        return;
    }
    let entry = accounting_entry(app, ctx, "1-1400", "Persediaan Obat & BMHP", "ASET", "PERSEDIAAN", description, amount, reference);
    array_mut(&mut app.db, "accountingEntries").push(entry);
    balanced_journal(app, ctx, description, reference, "1-1400", "Persediaan Obat & BMHP", "2-1100", "Utang Dagang Distributor PBF", amount);
}

pub fn post_cogs(app: &mut App, ctx: &RequestContext, amount: f64, description: &str, reference: &str) {
    let amount = amount.round();
    if !amount.is_finite() || amount <= 0.0 {
        return;
    }
    let entry = accounting_entry(app, ctx, "5-1400", "HPP Obat dan BMHP", "BEBAN", "HPP_FARMASI", description, amount, reference);
    array_mut(&mut app.db, "accountingEntries").push(entry);
    balanced_journal(app, ctx, description, reference, "5-1400", "HPP Obat dan BMHP", "1-1400", "Persediaan Obat & BMHP", amount);
}

pub fn compute_visit_post_service_status(app: &App, facility_code: &str, visit_id: &str) -> Option<&'static str> {
    if visit_id.is_empty() {
        return None;
    }
    let orders_open = ["labOrders", "pharmacyOrders", "radiologyOrders"].iter().any(|key| {
        array(&app.db, key).iter().any(|row| {
            text(row, "visitId") == visit_id
                && text(row, "facilityCode") == facility_code
                && !matches!(
                    text(row, "status"),
                    "SELESAI_VERIFIKASI" | "DISERAHKAN" | "EXPERTISE_VERIFIED" | "BATAL" | ""
                )
        })
    });
    if orders_open {
        return Some("FARMASI_LAB");
    }
    let has_soap = array(&app.db, "visits").iter().any(|v| {
        text(v, "id") == visit_id
            && text(v, "facilityCode") == facility_code
            && !text(v, "soapId").trim().is_empty()
    }) || array(&app.db, "soapRecords").iter().any(|s| {
        text(s, "visitId") == visit_id && text(s, "facilityCode") == facility_code
    });
    let mut active_invoices = 0usize;
    let mut unpaid_invoices = 0usize;
    for inv in array(&app.db, "invoices") {
        if text(inv, "visitId") == visit_id && text(inv, "facilityCode") == facility_code {
            let st = text(inv, "status");
            if st != "BATAL" {
                active_invoices += 1;
                if !matches!(st, "LUNAS" | "KLAIM_DIAJUKAN" | "KLAIM_DISETUJUI") {
                    unpaid_invoices += 1;
                }
            }
        }
    }
    if has_soap && active_invoices > 0 && unpaid_invoices == 0 {
        Some("SELESAI")
    } else if !has_soap {
        Some("DIPERIKSA_DOKTER")
    } else {
        Some("KASIR")
    }
}

pub fn append_service_charge(
    app: &mut App,
    ctx: &RequestContext,
    visit_id: &str,
    patient_id: &str,
    patient_name: &str,
    mr_number: &str,
    guarantor: &str,
    settlement: &str,
    category: &str,
    description: &str,
    quantity: f64,
    unit_price: f64,
) {
    if patient_id.is_empty() || !unit_price.is_finite() || unit_price < 0.0 {
        return;
    }
    let quantity = if quantity.is_finite() && quantity > 0.0 { quantity } else { 1.0 };
    let unit_price = unit_price.round();
    let item = json!({"id":id("bli"),"key":format!("{category}:{description}"),"category":category,"description":description,"quantity":quantity,"unitPrice":unit_price,"subtotal":(quantity * unit_price).round()});
    if let Some(index) = array(&app.db, "invoices").iter().position(|invoice| {
        text(invoice, "facilityCode") == ctx.facility_code
            && text(invoice, "patientId") == patient_id
            && text(invoice, "visitId") == visit_id
            && text(invoice, "status") == "BELUM_LUNAS"
    }) {
        let mut invoice = array(&app.db, "invoices")[index].clone();
        let discount = number(&invoice, "discountAmount");
        array_mut(&mut invoice, "items").push(item);
        recalculate(&mut invoice, discount);
        array_mut(&mut app.db, "invoices")[index] = invoice;
        return;
    }
    let timestamp = now();
    let head = format!("INV/{}/{}/", ctx.facility_code.chars().take(4).collect::<String>(), timestamp[..10].replace('-', ""));
    let sequence = next_document(array(&app.db, "invoices"), "invoiceNumber", &head);
    let mut invoice = json!({"id":id("inv"),"facilityCode":ctx.facility_code,"invoiceNumber":format!("{head}{sequence:04}"),"visitId":visit_id,"patientId":patient_id,"patientName":patient_name,"mrNumber":mr_number,"guarantor":guarantor,"guarantorSettlement":if settlement == "BPJS" {"BPJS"} else {"PATIENT"},"items":[item],"unpricedItems":[],"pricingStatus":"COMPLETE","paymentMethod":Value::Null,"status":"BELUM_LUNAS","createdAt":timestamp});
    recalculate(&mut invoice, 0.0);
    array_mut(&mut app.db, "invoices").push(invoice);
}

pub fn handle(
    app: &mut App,
    ctx: &RequestContext,
    method: &str,
    path: &str,
    body: &Value,
) -> Option<ApiResult> {
    if method == "PUT" {
        if let Some(invoice_id) = path
            .strip_prefix("/api/invoices/")
            .and_then(|path| path.strip_suffix("/pricing"))
        {
            return Some(set_pricing(app, ctx, invoice_id, body));
        }
        return None;
    }
    if method != "POST" {
        return None;
    }
    if path == "/api/accounting" {
        return Some(manual_entry(app, ctx, body));
    }
    if path == "/api/finance/reconcile-claim" {
        return Some(reconcile(app, ctx, body));
    }
    if let Some(rest) = path.strip_prefix("/api/invoices/") {
        if let Some(invoice_id) = rest.strip_suffix("/pay") {
            return Some(pay(app, ctx, invoice_id, body));
        }
        if let Some(invoice_id) = rest.strip_suffix("/items") {
            return Some(add_item(app, ctx, invoice_id, body));
        }
        if let Some(invoice_id) = rest.strip_suffix("/components") {
            return Some(component_action(app, ctx, invoice_id, body));
        }
        if let Some(invoice_id) = rest.strip_suffix("/resolve-cancelled") {
            return Some(resolve_cancelled_invoice(app, ctx, invoice_id, body));
        }
    }
    None
}

fn component_action(app: &mut App, ctx: &RequestContext, invoice_id: &str, body: &Value) -> ApiResult {
    require_service(app, ctx, &["KASIR_AKUNTANSI"], &["SUB_CASHIER_BILLING_DEPOSIT"])?;
    let index = invoice_index(app, ctx, invoice_id)?;
    let mut invoice = array(&app.db, "invoices")[index].clone();
    if text(&invoice, "status") != "BELUM_LUNAS" {
        return Err(conflict("Komponen hanya dapat diubah pada tagihan yang belum diselesaikan."));
    }
    let component_id = text(body, "id");
    if component_id.is_empty() {
        return Err(bad_request("ID komponen tagihan wajib diisi."));
    }
    let action = text(body, "action");
    let mut items = array(&invoice, "items").clone();
    let mut unpriced = array(&invoice, "unpricedItems").clone();
    let mut cancelled = array(&invoice, "cancelledComponents").clone();
    let found = items.iter().any(|item| text(item, "id") == component_id)
        || unpriced.iter().any(|item| text(item, "id") == component_id || text(item, "key") == component_id);
    if !found {
        return Err(bad_request("Komponen tagihan tidak dikenal."));
    }
    let reason = text(body, "reason").trim();
    let audit_action;
    match action {
        "cancel" => {
            for item in &items {
                if text(item, "id") == component_id {
                    let mut entry = item.clone();
                    entry["cancelledAt"] = json!(now());
                    entry["cancelledBy"] = ctx.user["fullName"].clone();
                    entry["reason"] = json!(if reason.is_empty() { "Pembatalan komponen kasir" } else { reason });
                    cancelled.push(entry);
                }
            }
            for item in &unpriced {
                if text(item, "id") == component_id || text(item, "key") == component_id {
                    let mut entry = item.clone();
                    entry["cancelledAt"] = json!(now());
                    entry["cancelledBy"] = ctx.user["fullName"].clone();
                    entry["reason"] = json!(if reason.is_empty() { "Pembatalan komponen kasir" } else { reason });
                    cancelled.push(entry);
                }
            }
            items.retain(|item| text(item, "id") != component_id);
            unpriced.retain(|item| text(item, "id") != component_id && text(item, "key") != component_id);
            audit_action = "CASHIER_COMPONENT_CANCEL";
        }
        "adjust" => {
            let quantity = body["quantity"].as_f64().filter(|value| value.is_finite() && *value > 0.0)
                .ok_or_else(|| bad_request("Kuantitas baru harus berupa angka lebih dari nol."))?;
            let Some(item) = items.iter_mut().find(|item| text(item, "id") == component_id) else {
                return Err(bad_request("Komponen yang belum berharga tidak dapat diubah jumlahnya sebelum harga ditetapkan."));
            };
            let price = number(item, "unitPrice");
            if !(quantity * price).is_finite() {
                return Err(bad_request("Nilai komponen melebihi batas angka yang dapat dicatat."));
            }
            item["quantity"] = json!(quantity);
            item["subtotal"] = json!((quantity * price).round());
            audit_action = "CASHIER_COMPONENT_ADJUST";
        }
        _ => return Err(bad_request("Aksi komponen tagihan tidak valid.")),
    }
    let discount = number(&invoice, "discountAmount");
    invoice["items"] = json!(items);
    invoice["unpricedItems"] = json!(unpriced);
    invoice["cancelledComponents"] = json!(cancelled);
    invoice["pricingStatus"] = json!(if !unpriced.is_empty() || items.is_empty() { "PENDING" } else { "COMPLETE" });
    recalculate(&mut invoice, discount);
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
    audit(app, ctx, audit_action, text(&invoice, "invoiceNumber"), &format!("Komponen {component_id} aksi {action}."));
    save(app)?;
    json_response(200, invoice)
}

fn invoice_index(
    app: &App,
    ctx: &RequestContext,
    invoice_id: &str,
) -> Result<usize, crate::http::ApiError> {
    array(&app.db, "invoices")
        .iter()
        .position(|row| {
            text(row, "id") == invoice_id && text(row, "facilityCode") == ctx.facility_code
        })
        .ok_or_else(|| not_found("Tagihan kasir tidak ditemukan."))
}

fn pay(app: &mut App, ctx: &RequestContext, invoice_id: &str, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["KASIR_AKUNTANSI"],
        &["SUB_CASHIER_BILLING_DEPOSIT"],
    )?;
    let index = invoice_index(app, ctx, invoice_id)?;
    let mut invoice = array(&app.db, "invoices")[index].clone();
    if text(&invoice, "status") == "BATAL" {
        return Err(conflict(
            "Tagihan yang telah dibatalkan tidak dapat dilunasi atau diajukan klaim.",
        ));
    }
    let inv_visit_id = text(&invoice, "visitId");
    if !inv_visit_id.is_empty()
        && array(&app.db, "visits").iter().any(|v| {
            text(v, "id") == inv_visit_id
                && text(v, "facilityCode") == ctx.facility_code
                && text(v, "status") == "BATAL"
        })
    {
        return Err(conflict(
            "Kunjungan pasien telah dibatalkan; tagihan tidak dapat dilunasi.",
        ));
    }
    if matches!(text(&invoice, "status"), "LUNAS" | "KLAIM_DIAJUKAN") {
        let req_method = text(body, "paymentMethod");
        let req_discount = body.get("discountAmount").and_then(Value::as_f64);
        if (!req_method.is_empty() && req_method != text(&invoice, "paymentMethod"))
            || req_discount.is_some_and(|d| (d.round() - number(&invoice, "discountAmount").round()).abs() > 0.5)
        {
            return Err(conflict(
                "Tagihan sudah diselesaikan sebelumnya dengan metode atau nominal diskon berbeda.",
            ));
        }
        return json_response(200, invoice);
    }
    if array(&invoice, "items").is_empty() {
        return Err(conflict(
            "Tagihan tidak memiliki komponen layanan aktif untuk dilunasi.",
        ));
    }
    if text(&invoice, "pricingStatus") != "COMPLETE" {
        return Err(conflict(
            "Tagihan belum memiliki penetapan tarif lengkap. Tinjau dan tetapkan seluruh harga sebelum pembayaran.",
        ));
    }
    let discount = if body.get("discountAmount").is_some() {
        number(body, "discountAmount")
    } else {
        number(&invoice, "discountAmount")
    };
    if !discount.is_finite()
        || discount < 0.0
        || discount > number(&invoice, "subtotal")
        || body
            .get("discountAmount")
            .is_some_and(|value| !value.is_number())
    {
        return Err(bad_request(
            "Diskon harus berupa angka nonnegatif dan tidak melebihi subtotal.",
        ));
    }
    recalculate(&mut invoice, discount);
    let payment = text(body, "paymentMethod");
    if ![
        "TUNAI",
        "QRIS",
        "DEBIT_KREDIT",
        "KLAIM_BPJS",
        "PIUTANG_ASURANSI",
        "TRANSFER_BANK",
        "KARTU_DEBIT",
        "KARTU_KREDIT",
        "ASURANSI",
        "TRANSFER",
        "DEBIT",
        "KREDIT",
    ]
    .contains(&payment)
    {
        return Err(bad_request("Metode pembayaran tidak valid."));
    }
    if payment == "KLAIM_BPJS" && !uses_bpjs(&invoice) {
        return Err(bad_request(
            "Metode klaim BPJS hanya berlaku untuk tagihan dengan penjamin BPJS Kesehatan.",
        ));
    }
    invoice["paymentMethod"] = json!(payment);
    let credit = matches!(payment, "KLAIM_BPJS" | "PIUTANG_ASURANSI" | "ASURANSI");
    invoice["status"] = json!(if credit { "KLAIM_DIAJUKAN" } else { "LUNAS" });
    invoice["cashierName"] = ctx.user["fullName"].clone();
    let timestamp = now();
    if credit {
        invoice["claimRequestedAmount"] =
            json!((number(&invoice, "subtotal") - number(&invoice, "discountAmount")).max(0.0));
        invoice["claimSubmittedAt"] = json!(timestamp);
        invoice["paidAt"] = Value::Null;
    } else {
        invoice["paidAt"] = json!(timestamp);
        invoice["patientPayableAmount"] =
            json!((number(&invoice, "subtotal") - number(&invoice, "discountAmount")).max(0.0));
        invoice["totalReceivedAmount"] = invoice["patientPayableAmount"].clone();
    }
    let revenue = (number(&invoice, "subtotal") - number(&invoice, "discountAmount")).max(0.0);
    if !credit {
        let entry = accounting_entry(
            app,
            ctx,
            "4-1000",
            "Pendapatan Layanan Pasien",
            "PENDAPATAN",
            "LAYANAN_MEDIS",
            &format!(
                "Pelunasan Tagihan {} - {} ({})",
                text(&invoice, "invoiceNumber"),
                text(&invoice, "patientName"),
                text(&invoice, "mrNumber")
            ),
            revenue,
            text(&invoice, "invoiceNumber"),
        );
        record_books(app, ctx, &entry);
    } else if revenue > 0.0 {
        let desc = format!(
            "Pengakuan Piutang Klaim {} - {} ({})",
            text(&invoice, "invoiceNumber"),
            text(&invoice, "patientName"),
            text(&invoice, "mrNumber")
        );
        balanced_journal_with_event(
            app,
            ctx,
            "CLAIM_RECOGNIZED",
            &desc,
            text(&invoice, "invoiceNumber"),
            "1-1200",
            "Piutang Klaim JKN / Asuransi",
            "4-1015",
            "Pencairan Klaim JKN BPJS / Piutang Korporasi",
            revenue,
        );
    }
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
    let visit_id = text(&invoice, "visitId").to_owned();
    if let Some(next_status) = compute_visit_post_service_status(app, &ctx.facility_code, &visit_id) {
        if next_status == "SELESAI" {
            for visit in array_mut(&mut app.db, "visits").iter_mut().filter(|v| {
                text(v, "id") == visit_id
                    && text(v, "facilityCode") == ctx.facility_code
                    && text(v, "status") != "BATAL"
            }) {
                visit["status"] = json!("SELESAI");
                visit["updatedAt"] = json!(timestamp);
            }
        }
    }
    audit(
        app,
        ctx,
        if credit {
            "CASHIER_CLAIM_SUBMITTED"
        } else {
            "CASHIER_INVOICE_SETTLED"
        },
        text(&invoice, "invoiceNumber"),
        &format!(
            "{} Rp {revenue} melalui {payment}.",
            if credit {
                "Pengajuan klaim/piutang"
            } else {
                "Penerimaan pembayaran"
            }
        ),
    );
    save(app)?;
    json_response(200, invoice)
}

fn set_pricing(app: &mut App, ctx: &RequestContext, invoice_id: &str, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["KASIR_AKUNTANSI"],
        &["SUB_CASHIER_BILLING_DEPOSIT"],
    )?;
    let index = invoice_index(app, ctx, invoice_id)?;
    let mut invoice = array(&app.db, "invoices")[index].clone();
    if text(&invoice, "status") != "BELUM_LUNAS" {
        return Err(conflict(
            "Penetapan tarif hanya dapat dilakukan pada tagihan yang belum diselesaikan.",
        ));
    }
    let inv_visit_id = text(&invoice, "visitId");
    if !inv_visit_id.is_empty()
        && array(&app.db, "visits").iter().any(|v| {
            text(v, "id") == inv_visit_id
                && text(v, "facilityCode") == ctx.facility_code
                && text(v, "status") == "BATAL"
        })
    {
        return Err(conflict(
            "Kunjungan pasien telah dibatalkan; penetapan tarif tidak dapat dilakukan.",
        ));
    }
    let submitted = body["items"].as_array().filter(|items| !items.is_empty())
        .ok_or_else(|| bad_request("Masukkan seluruh rincian tagihan, minimal satu item. Tarif nol harus diisi secara eksplisit."))?;
    let existing_items = array(&invoice, "items").clone();
    let mut remaining = array(&invoice, "unpricedItems").clone();
    if existing_items.is_empty() && remaining.is_empty() {
        return Err(bad_request("Tagihan tidak memiliki komponen yang dapat ditetapkan harganya."));
    }
    let mut items = existing_items;
    for item in submitted {
        let component_id = text(item, "id");
        let key = text(item, "key");
        if component_id.is_empty() && key.is_empty() {
            return Err(bad_request("Harga harus merujuk ID atau kunci komponen tagihan yang sudah tersimpan."));
        }
        let unit_price = item["unitPrice"].as_f64().filter(|value| value.is_finite() && *value >= 0.0)
            .ok_or_else(|| bad_request("Tarif setiap item harus diisi dengan angka nonnegatif, termasuk nol bila tanpa biaya."))?;
        if let Some(existing) = items.iter_mut().find(|row| (!component_id.is_empty() && text(row, "id") == component_id) || (!key.is_empty() && text(row, "key") == key)) {
            let quantity = number(existing, "quantity");
            if !quantity.is_finite() || quantity <= 0.0 {
                return Err(bad_request("Kuantitas komponen tersimpan tidak valid."));
            }
            let unit_price = unit_price.round();
            existing["unitPrice"] = json!(unit_price);
            existing["subtotal"] = json!((quantity * unit_price).round());
        } else if let Some(index) = remaining.iter().position(|row| (!key.is_empty() && text(row, "key") == key) || (!component_id.is_empty() && (text(row, "id") == component_id || text(row, "key") == component_id))) {
            let pending = remaining.remove(index);
            let quantity = number(&pending, "quantity");
            let quantity = if quantity.is_finite() && quantity > 0.0 { quantity } else { 1.0 };
            let unit_price = unit_price.round();
            items.push(json!({"id": if text(&pending, "id").is_empty() { json!(id("bli")) } else { pending["id"].clone() }, "key": if text(&pending, "key").is_empty() { json!(key) } else { pending["key"].clone() }, "category": pending["category"], "description": pending["description"], "quantity": quantity, "unitPrice": unit_price, "subtotal": (quantity * unit_price).round()}));
        } else {
            return Err(bad_request("Komponen tagihan tidak dikenal. Penetapan harga tidak boleh menambah atau mengganti komponen."));
        }
    }
    if !items.iter().map(|item| number(item, "subtotal")).sum::<f64>().is_finite() {
        return Err(bad_request("Total nilai tagihan melebihi batas angka yang dapat dicatat."));
    }
    invoice["items"] = json!(items);
    invoice["unpricedItems"] = json!(remaining);
    invoice["pricingStatus"] = json!(if remaining.is_empty() { "COMPLETE" } else { "PENDING" });
    invoice["pricingSource"] = json!("MANUAL");
    invoice["pricedAt"] = json!(now());
    invoice["pricedBy"] = ctx.user["id"].clone();
    let existing_discount = number(&invoice, "discountAmount");
    recalculate(&mut invoice, existing_discount);
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
    audit(
        app,
        ctx,
        "CASHIER_PRICING_CONFIRMED",
        text(&invoice, "invoiceNumber"),
        "Penetapan rincian tarif lengkap secara manual sebelum pembayaran.",
    );
    save(app)?;
    json_response(200, invoice)
}

fn add_item(app: &mut App, ctx: &RequestContext, invoice_id: &str, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["KASIR_AKUNTANSI"],
        &["SUB_CASHIER_BILLING_DEPOSIT"],
    )?;
    let index = invoice_index(app, ctx, invoice_id)?;
    let mut invoice = array(&app.db, "invoices")[index].clone();
    if text(&invoice, "status") != "BELUM_LUNAS" {
        return Err(conflict(
            "Tagihan yang telah diselesaikan tidak dapat ditambah item.",
        ));
    }
    let inv_visit_id = text(&invoice, "visitId");
    if !inv_visit_id.is_empty()
        && array(&app.db, "visits").iter().any(|v| {
            text(v, "id") == inv_visit_id
                && text(v, "facilityCode") == ctx.facility_code
                && text(v, "status") == "BATAL"
        })
    {
        return Err(conflict(
            "Kunjungan pasien telah dibatalkan; item tagihan tidak dapat ditambahkan.",
        ));
    }
    let quantity = number(body, "quantity");
    let price = number(body, "unitPrice");
    if text(body, "description").trim().is_empty()
        || !quantity.is_finite()
        || quantity <= 0.0
        || !price.is_finite()
        || price < 0.0
        || !body["unitPrice"].is_number()
    {
        return Err(bad_request(
            "Deskripsi, Kuantitas (>0), dan Tarif Satuan wajib diisi.",
        ));
    }
    let category = if text(body, "category").is_empty() {
        "TINDAKAN"
    } else {
        text(body, "category")
    };
    let price = price.round();
    array_mut(&mut invoice,"items").push(json!({"id":id("item"),"category":category,"description":text(body,"description").trim(),"quantity":quantity,"unitPrice":price,"subtotal":(quantity*price).round()}));
    let discount = number(&invoice, "discountAmount");
    recalculate(&mut invoice, discount);
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
    audit(
        app,
        ctx,
        "CASHIER_ADD_BILLING_ITEM",
        text(&invoice, "invoiceNumber"),
        &format!(
            "Penambahan biaya {} sebesar Rp {}.",
            text(body, "description"),
            quantity * price
        ),
    );
    save(app)?;
    json_response(200, invoice)
}

fn manual_entry(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["KASIR_AKUNTANSI", "KEUANGAN_OWNER", "JASA_MEDIS_REMUN"],
        &["SUB_ACCOUNTING_DOUBLE_ENTRY"],
    )?;
    let amount = number(body, "amount");
    if text(body, "description").trim().is_empty() || !amount.is_finite() || amount <= 0.0 {
        return Err(bad_request(
            "Deskripsi jurnal dan Nominal (> 0) wajib diisi.",
        ));
    }
    let kind = if text(body, "type").is_empty() {
        "PENGELUARAN"
    } else {
        text(body, "type")
    };
    if !["PENDAPATAN", "PENGELUARAN"].contains(&kind) {
        return Err(bad_request("Jenis jurnal tidak valid."));
    }
    let account_code = if text(body, "accountCode").is_empty() {
        if kind == "PENDAPATAN" {
            "4-1090"
        } else {
            "5-3010"
        }
    } else {
        text(body, "accountCode")
    };
    let account_name = if text(body, "accountName").is_empty() {
        if kind == "PENDAPATAN" {
            "Pendapatan Operasional Lainnya"
        } else {
            "Beban Operasional Faskes"
        }
    } else {
        text(body, "accountName")
    };
    let category = if text(body, "category").is_empty() {
        "OPERASIONAL"
    } else {
        text(body, "category")
    };
    let reference = if text(body, "referenceId").is_empty() {
        id("MAN")
    } else {
        text(body, "referenceId").to_owned()
    };
    let entry = accounting_entry(
        app,
        ctx,
        account_code,
        account_name,
        kind,
        category,
        text(body, "description").trim(),
        amount,
        &reference,
    );
    record_books(app, ctx, &entry);
    audit(
        app,
        ctx,
        "ACCOUNTING_JOURNAL_POST",
        text(&entry, "entryNumber"),
        &format!("Pencatatan jurnal {kind} sebesar Rp {amount}."),
    );
    save(app)?;
    json_response(201, entry)
}

fn reconcile(app: &mut App, ctx: &RequestContext, body: &Value) -> ApiResult {
    require_service(
        app,
        ctx,
        &["KLAIM_BPJS_PIUTANG"],
        &["SUB_CASHIER_BILLING_DEPOSIT"],
    )?;
    let index = invoice_index(app, ctx, text(body, "invoiceId"))?;
    let mut invoice = array(&app.db, "invoices")[index].clone();
    if text(&invoice, "status") == "BATAL" {
        return Err(conflict(
            "Tagihan klaim yang telah dibatalkan tidak dapat dicairkan.",
        ));
    }
    let claim_visit_id = text(&invoice, "visitId");
    let visit_cancelled = !claim_visit_id.is_empty()
        && array(&app.db, "visits").iter().any(|v| {
            text(v, "id") == claim_visit_id
                && text(v, "facilityCode") == ctx.facility_code
                && text(v, "status") == "BATAL"
        });
    let prev_received_check = number(&invoice, "totalReceivedAmount").round();
    if visit_cancelled
        && (prev_received_check <= 0.0
            || text(&invoice, "cancellationResolutionStatus") != "CONTINUE_RECEIVABLE")
    {
        return Err(conflict(
            "Kunjungan pasien pada klaim ini telah dibatalkan; pencairan klaim dihentikan sampai resolusi piutang ditetapkan.",
        ));
    }
    if text(&invoice, "status") != "KLAIM_DIAJUKAN" || text(&invoice, "pricingStatus") != "COMPLETE"
    {
        return Err(conflict(
            "Penerimaan hanya dapat dicatat untuk klaim atau piutang yang sudah diajukan dengan tarif lengkap.",
        ));
    }
    let bpjs = uses_bpjs(&invoice);
    let raw_amount = body["receivedAmount"]
        .as_f64()
        .filter(|amount| amount.is_finite() && *amount > 0.0)
        .ok_or_else(|| bad_request("Masukkan nominal penerimaan aktual yang lebih dari nol."))?;
    let amount = raw_amount.round();
    if amount <= 0.0 {
        return Err(bad_request("Nominal penerimaan setelah pembulatan Rupiah harus lebih dari nol."));
    }
    let reference = text(body, "paymentReference").trim();
    if reference.is_empty() {
        return Err(bad_request("Referensi pembayaran aktual wajib diisi."));
    }
    if array(&invoice, "claimReceipts")
        .iter()
        .any(|receipt| text(receipt, "paymentReference") == reference)
    {
        return Err(conflict(
            "Referensi penerimaan ini sudah tercatat pada tagihan.",
        ));
    }
    let net = (number(&invoice, "subtotal") - number(&invoice, "discountAmount")).max(0.0).round();
    let prev_received = number(&invoice, "totalReceivedAmount").round();
    let received = prev_received + amount;
    if !received.is_finite() {
        return Err(bad_request("Nominal kumulatif penerimaan tidak valid."));
    }
    if received > net {
        return Err(conflict(
            "Nominal kumulatif penerimaan klaim melebihi nilai tagihan bersih.",
        ));
    }
    let timestamp = now();
    let final_settlement = body["final"] == true;
    let settled = received >= net || (final_settlement && received > 0.0);
    let writeoff_amount = if final_settlement && received < net {
        (net - received).round()
    } else {
        0.0
    };
    if writeoff_amount > 0.0 {
        invoice["claimAdjustment"] = json!(writeoff_amount);
    }
    invoice["status"] = json!(if settled { "LUNAS" } else { "KLAIM_DIAJUKAN" });
    invoice["paidAt"] = if settled {
        json!(timestamp)
    } else {
        Value::Null
    };
    invoice["totalReceivedAmount"] = json!(received);
    if bpjs {
        invoice["bpjsCoveredAmount"] = json!(received);
    }
    array_mut(&mut invoice,"claimReceipts").push(json!({"amount":amount,"paymentReference":reference,"receivedAt":timestamp,"receivedBy":ctx.user["id"]}));
    invoice["cashierName"] = json!(format!(
        "{} (Otorisasi Keuangan)",
        text(&ctx.user, "fullName")
    ));
    let inv_num = text(&invoice, "invoiceNumber").to_owned();
    let rec_desc = format!(
        "Penerimaan klaim {} — {}",
        inv_num,
        text(&invoice, "patientName")
    );
    let entry = accounting_entry(
        app,
        ctx,
        "4-1015",
        "Pencairan Klaim JKN BPJS / Piutang Korporasi",
        "PENDAPATAN",
        if bpjs { "KLAIM_BPJS" } else { "LAYANAN_MEDIS" },
        &rec_desc,
        amount,
        &inv_num,
    );
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
    let has_recognized = array(&app.db, "doubleEntryJournals").iter().any(|j| {
        text(j, "facilityCode") == ctx.facility_code
            && text(j, "sourceTransactionId") == inv_num
            && text(j, "eventType") == "CLAIM_RECOGNIZED"
    });
    if !has_recognized && net > 0.0 {
        balanced_journal_with_event(
            app,
            ctx,
            "CLAIM_RECOGNIZED",
            &format!("Pengakuan Piutang Klaim {} — {}", inv_num, text(&invoice, "patientName")),
            &inv_num,
            "1-1200",
            "Piutang Klaim JKN / Asuransi",
            "4-1015",
            "Pencairan Klaim JKN BPJS / Piutang Korporasi",
            net,
        );
    }
    array_mut(&mut app.db, "accountingEntries").push(entry.clone());
    balanced_journal_with_event(
        app,
        ctx,
        "CLAIM_RECEIPT",
        &rec_desc,
        &inv_num,
        "1-1100",
        "Kas dan setara kas",
        "1-1200",
        "Piutang Klaim JKN / Asuransi",
        amount,
    );
    if writeoff_amount > 0.0 {
        let adj_desc = format!(
            "Penyesuaian selisih klaim final {} — {}",
            inv_num,
            text(&invoice, "patientName")
        );
        let adj_entry = accounting_entry(
            app,
            ctx,
            "5-1900",
            "Selisih / Penyesuaian Klaim JKN & Piutang",
            "BEBAN",
            "OPERASIONAL",
            &adj_desc,
            writeoff_amount,
            &inv_num,
        );
        array_mut(&mut app.db, "accountingEntries").push(adj_entry);
        balanced_journal_with_event(
            app,
            ctx,
            "CLAIM_ADJUSTED",
            &adj_desc,
            &inv_num,
            "5-1900",
            "Selisih / Penyesuaian Klaim JKN & Piutang",
            "1-1200",
            "Piutang Klaim JKN / Asuransi",
            writeoff_amount,
        );
    }
    let rec_visit_id = text(&invoice, "visitId").to_owned();
    if let Some("SELESAI") = compute_visit_post_service_status(app, &ctx.facility_code, &rec_visit_id) {
        for visit in array_mut(&mut app.db, "visits").iter_mut().filter(|v| {
            text(v, "id") == rec_visit_id
                && text(v, "facilityCode") == ctx.facility_code
                && text(v, "status") != "BATAL"
        }) {
            visit["status"] = json!("SELESAI");
            visit["updatedAt"] = json!(timestamp);
        }
    }
    audit(
        app,
        ctx,
        "FINANCE_CLAIM_RECONCILED",
        text(&invoice, "invoiceNumber"),
        &format!(
            "Penerimaan klaim/piutang Rp {amount}, referensi {reference}; kumulatif Rp {received}."
        ),
    );
    save(app)?;
    json_response(200, json!({"invoice":invoice,"entry":entry}))
}

fn resolve_cancelled_invoice(
    app: &mut App,
    ctx: &RequestContext,
    invoice_id: &str,
    body: &Value,
) -> ApiResult {
    require_service(
        app,
        ctx,
        &["KLAIM_BPJS_PIUTANG", "KASIR_AKUNTANSI"],
        &["SUB_CASHIER_BILLING_DEPOSIT"],
    )?;
    let index = invoice_index(app, ctx, invoice_id)?;
    let mut invoice = array(&app.db, "invoices")[index].clone();
    let action = text(body, "action").trim();
    let reason = text(body, "reason").trim();
    if reason.is_empty() {
        return Err(bad_request("Alasan resolusi tagihan wajib diisi."));
    }
    let idem_key = text(body, "idempotencyKey").trim();
    let reference_for_fp = text(body, "paymentReference").trim();
    let refund_fp_val = body.get("refundAmount").and_then(Value::as_f64).map(|v| v.round()).unwrap_or(-1.0);
    let op_fp = format!("{invoice_id}|{action}|{reference_for_fp}|{refund_fp_val}|{reason}");
    if !idem_key.is_empty() {
        if let Some(existing_idem) = array(&app.db, "idempotencyRecords").iter().find(|row| {
            text(row, "key") == idem_key
                && text(row, "facilityCode") == ctx.facility_code
                && text(row, "action") == "INVOICE_RESOLVE_CANCELLED"
        }) {
            let stored_fp = text(existing_idem, "fingerprint");
            if !stored_fp.is_empty() && stored_fp != op_fp {
                return Err(conflict(
                    "Idempotency key sudah digunakan untuk resolusi tagihan dengan data berbeda.",
                ));
            }
            return json_response(200, existing_idem["response"].clone());
        }
    }
    if action == "REFUND" {
        let reference = text(body, "paymentReference").trim();
        if reference.is_empty() {
            return Err(bad_request("Referensi bukti pengembalian dana wajib diisi."));
        }
        let raw_refund = body
            .get("refundAmount")
            .filter(|v| v.is_number())
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && *v > 0.0)
            .ok_or_else(|| {
                bad_request("Nominal pengembalian dana wajib diisi berupa angka lebih dari nol.")
            })?;
        let refund_amount = raw_refund.round();
        if refund_amount <= 0.0 {
            return Err(bad_request("Nominal pengembalian dana setelah pembulatan harus lebih dari nol."));
        }
        if let Some(existing_receipt) = array(&invoice, "refundReceipts")
            .iter()
            .find(|r| text(r, "paymentReference") == reference)
        {
            if (number(existing_receipt, "amount").round() - refund_amount).abs() < 0.5
                && text(existing_receipt, "reason") == reason
            {
                return json_response(200, invoice);
            }
            return Err(conflict(
                "Referensi pengembalian dana ini sudah tercatat dengan nominal atau alasan berbeda.",
            ));
        }
    }
    let inv_visit_id = text(&invoice, "visitId");
    let visit_cancelled = !inv_visit_id.is_empty()
        && array(&app.db, "visits").iter().any(|v| {
            text(v, "id") == inv_visit_id
                && text(v, "facilityCode") == ctx.facility_code
                && text(v, "status") == "BATAL"
        });
    let res_status = text(&invoice, "cancellationResolutionStatus");
    if !visit_cancelled && !matches!(res_status, "NEEDS_RESOLUTION" | "CONTINUE_RECEIVABLE") {
        return Err(conflict(
            "Resolusi pembatalan hanya berlaku untuk tagihan dari kunjungan yang telah dibatalkan.",
        ));
    }
    if matches!(res_status, "WRITEOFF_RESOLVED") {
        return Err(conflict("Tagihan batal ini sudah diselesaikan melalui write-off."));
    }
    let prev_received = number(&invoice, "totalReceivedAmount").round();
    if prev_received <= 0.0 || matches!(text(&invoice, "status"), "BATAL" | "LUNAS") {
        return Err(conflict(
            "Resolusi pembatalan hanya berlaku untuk tagihan aktif yang sudah menerima pembayaran sebagian.",
        ));
    }
    let net = (number(&invoice, "subtotal") - number(&invoice, "discountAmount"))
        .max(0.0)
        .round();
    let timestamp = now();
    match action {
        "CONTINUE_RECEIVABLE" => {
            invoice["cancellationResolutionStatus"] = json!("CONTINUE_RECEIVABLE");
            invoice["cancellationResolutionReason"] = json!(reason);
            invoice["cancellationResolvedBy"] = ctx.user["id"].clone();
            invoice["cancellationResolvedAt"] = json!(timestamp);
        }
        "WRITEOFF_REMAINING" => {
            let writeoff = (net - prev_received).max(0.0).round();
            invoice["claimAdjustment"] = json!(writeoff);
            invoice["status"] = json!("LUNAS");
            invoice["paidAt"] = json!(timestamp);
            invoice["cancellationResolutionStatus"] = json!("WRITEOFF_RESOLVED");
            invoice["cancellationResolutionReason"] = json!(reason);
            invoice["cancellationResolvedBy"] = ctx.user["id"].clone();
            invoice["cancellationResolvedAt"] = json!(timestamp);
            if writeoff > 0.0 {
                let inv_num = text(&invoice, "invoiceNumber").to_owned();
                let has_recognized = array(&app.db, "doubleEntryJournals").iter().any(|j| {
                    text(j, "facilityCode") == ctx.facility_code
                        && text(j, "sourceTransactionId") == inv_num
                        && text(j, "eventType") == "CLAIM_RECOGNIZED"
                });
                if !has_recognized && net > 0.0 {
                    balanced_journal_with_event(
                        app,
                        ctx,
                        "CLAIM_RECOGNIZED",
                        &format!("Pengakuan Piutang Klaim {} — {}", inv_num, text(&invoice, "patientName")),
                        &inv_num,
                        "1-1200",
                        "Piutang Klaim JKN / Asuransi",
                        "4-1015",
                        "Pencairan Klaim JKN BPJS / Piutang Korporasi",
                        net,
                    );
                }
                let desc = format!(
                    "Penghapusan sisa piutang kunjungan batal {} — {}",
                    inv_num,
                    text(&invoice, "patientName")
                );
                let adj = accounting_entry(
                    app,
                    ctx,
                    "5-1900",
                    "Selisih / Penyesuaian Klaim JKN & Piutang",
                    "BEBAN",
                    "OPERASIONAL",
                    &desc,
                    writeoff,
                    &inv_num,
                );
                array_mut(&mut app.db, "accountingEntries").push(adj);
                balanced_journal_with_event(
                    app,
                    ctx,
                    "CLAIM_ADJUSTED",
                    &desc,
                    &inv_num,
                    "5-1900",
                    "Selisih / Penyesuaian Klaim JKN & Piutang",
                    "1-1200",
                    "Piutang Klaim JKN / Asuransi",
                    writeoff,
                );
            }
        }
        "REFUND" => {
            let refund_amount = body["refundAmount"]
                .as_f64()
                .filter(|v| v.is_finite() && *v > 0.0)
                .map(|v| v.round())
                .ok_or_else(|| bad_request("Nominal pengembalian dana tidak valid."))?;
            if refund_amount <= 0.0 || refund_amount > prev_received {
                return Err(bad_request(
                    "Nominal pengembalian dana tidak boleh melebihi jumlah yang telah diterima.",
                ));
            }
            let reference = text(body, "paymentReference").trim();
            let remaining_received = (prev_received - refund_amount).max(0.0).round();
            invoice["totalReceivedAmount"] = json!(remaining_received);
            if remaining_received == 0.0 {
                invoice["status"] = json!("BATAL");
            }
            invoice["cancellationResolutionStatus"] = json!("REFUND_RESOLVED");
            invoice["cancellationResolutionReason"] = json!(reason);
            invoice["cancellationResolvedBy"] = ctx.user["id"].clone();
            invoice["cancellationResolvedAt"] = json!(timestamp);
            array_mut(&mut invoice, "refundReceipts").push(json!({
                "amount": refund_amount,
                "paymentReference": reference,
                "reason": reason,
                "refundedAt": timestamp,
                "refundedBy": ctx.user["id"]
            }));
            let desc = format!(
                "Pengembalian dana (refund) {} — {}",
                text(&invoice, "invoiceNumber"),
                text(&invoice, "patientName")
            );
            let refund_entry = accounting_entry(
                app,
                ctx,
                "4-1015",
                "Pengembalian Penerimaan Klaim / Layanan",
                "PENGELUARAN",
                "REFUND",
                &desc,
                refund_amount,
                text(&invoice, "invoiceNumber"),
            );
            array_mut(&mut app.db, "accountingEntries").push(refund_entry);
            balanced_journal_with_event(
                app,
                ctx,
                "REFUND_APPROVED",
                &desc,
                text(&invoice, "invoiceNumber"),
                "4-1015",
                "Pengembalian Penerimaan Klaim / Layanan",
                "1-1100",
                "Kas dan setara kas",
                refund_amount,
            );
        }
        _ => return Err(bad_request("Aksi resolusi pembatalan tidak valid.")),
    }
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
    if !idem_key.is_empty() {
        array_mut(&mut app.db, "idempotencyRecords").push(json!({
            "id": id("idem"),
            "idempotencyKey": idem_key,
            "key": idem_key,
            "facilityCode": ctx.facility_code,
            "action": "INVOICE_RESOLVE_CANCELLED",
            "fingerprint": op_fp,
            "response": invoice,
            "createdAt": timestamp
        }));
    }
    audit(
        app,
        ctx,
        "FINANCE_CANCELLED_INVOICE_RESOLVED",
        text(&invoice, "invoiceNumber"),
        &format!("Resolusi tagihan batal ({action}): {reason}"),
    );
    save(app)?;
    json_response(200, invoice)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use crate::storage::Storage;
    use std::collections::HashMap;
    use std::path::PathBuf;

    fn test_app() -> (App, RequestContext, PathBuf) {
        let root = std::env::temp_dir().join(format!("kael-fin-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("test.sqlite");
        let seed = json!({
            "serverConfig": { "sessionTimeoutMinutes": 480 },
            "users": [{ "id": "usr-1", "username": "fin", "fullName": "Finance Staff", "role": "ADMIN_KEUANGAN", "active": true }],
            "facilities": [{ "code": "FAC1", "name": "RS Test", "type": "RSUD", "active": true }],
            "roles": [{ "id": "ADMIN_KEUANGAN", "active": true, "modules": ["KASIR_AKUNTANSI", "KLAIM_BPJS_PIUTANG"] }],
            "facilityConfigs": [{
                "facilityCode": "FAC1",
                "lifecycleStage": "ACTIVE",
                "enabledSubCapabilities": ["SUB_CASHIER_BILLING_DEPOSIT", "SUB_ACCOUNTING_DOUBLE_ENTRY"]
            }],
            "patients": [{ "id": "pat-1", "facilityCode": "FAC1", "fullName": "Pasien Uji", "mrNumber": "RM-000001" }],
            "visits": [{ "id": "vis-1", "facilityCode": "FAC1", "patientId": "pat-1", "status": "KASIR", "soapId": "soap-1" }],
            "soapRecords": [{ "id": "soap-1", "facilityCode": "FAC1", "visitId": "vis-1" }],
            "invoices": [{
                "id": "inv-1",
                "facilityCode": "FAC1",
                "invoiceNumber": "INV/FAC1/20261117/0001",
                "visitId": "vis-1",
                "patientId": "pat-1",
                "patientName": "Pasien Uji",
                "mrNumber": "RM-000001",
                "guarantor": "BPJS_KESEHATAN",
                "guarantorSettlement": "BPJS",
                "items": [{ "id": "bli-1", "key": "consultation", "category": "KONSULTASI", "description": "Konsultasi", "quantity": 1, "unitPrice": 100000, "subtotal": 100000 }],
                "unpricedItems": [],
                "pricingStatus": "COMPLETE",
                "subtotal": 100000,
                "discountAmount": 0,
                "bpjsCoveredAmount": 100000,
                "patientPayableAmount": 0,
                "status": "BELUM_LUNAS"
            }],
            "accountingEntries": [],
            "doubleEntryJournals": [],
            "auditLogs": [],
            "idempotencyRecords": []
        });
        Storage::create(&db_path, &seed).unwrap();
        let (store, db) = Storage::load(&db_path).unwrap();
        let app = App {
            config: Config {
                bind: "127.0.0.1".into(),
                port: 0,
                db_path: db_path.clone(),
                web_root: None,
                client_origins: vec![],
            },
            store,
            db,
            sessions: HashMap::new(),
            sessions_digest: 1,
            login_failures: HashMap::new(),
        };
        let ctx = RequestContext {
            user: json!({ "id": "usr-1", "username": "fin", "fullName": "Finance Staff", "role": "ADMIN_KEUANGAN" }),
            facility_code: "FAC1".into(),
            token: "tok".into(),
        };
        (app, ctx, root)
    }

    fn account_balance(app: &App, code: &str) -> f64 {
        let mut bal = 0.0;
        for j in array(&app.db, "doubleEntryJournals") {
            for line in array(j, "lines") {
                if text(line, "accountCode") == code {
                    bal += number(line, "debit") - number(line, "credit");
                }
            }
        }
        bal
    }

    #[test]
    fn claim_final_writeoff_balances_cash_and_receivable_gl() {
        let (mut app, ctx, root) = test_app();
        pay(&mut app, &ctx, "inv-1", &json!({ "paymentMethod": "KLAIM_BPJS" })).unwrap();
        assert_eq!(account_balance(&app, "1-1200"), 100000.0);
        assert_eq!(account_balance(&app, "1-1100"), 0.0);

        reconcile(
            &mut app,
            &ctx,
            &json!({
                "invoiceId": "inv-1",
                "receivedAmount": 30000,
                "paymentReference": "REF-JKN-1",
                "final": true
            }),
        )
        .unwrap();

        assert_eq!(account_balance(&app, "1-1100"), 30000.0);
        assert_eq!(account_balance(&app, "1-1200"), 0.0);
        assert_eq!(account_balance(&app, "5-1900"), 70000.0);
        assert_eq!(account_balance(&app, "4-1015"), -100000.0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cancelled_invoice_partial_refund_is_idempotent_and_validates_amount() {
        let (mut app, ctx, root) = test_app();
        pay(&mut app, &ctx, "inv-1", &json!({ "paymentMethod": "KLAIM_BPJS" })).unwrap();
        reconcile(
            &mut app,
            &ctx,
            &json!({ "invoiceId": "inv-1", "receivedAmount": 50000, "paymentReference": "REF-1" }),
        )
        .unwrap();
        array_mut(&mut app.db, "visits")[0]["status"] = json!("BATAL");
        array_mut(&mut app.db, "invoices")[0]["cancellationResolutionStatus"] = json!("NEEDS_RESOLUTION");

        assert!(resolve_cancelled_invoice(&mut app, &ctx, "inv-1", &json!({
            "action": "REFUND", "reason": "Batal", "paymentReference": "RF-0"
        })).is_err());
        assert!(resolve_cancelled_invoice(&mut app, &ctx, "inv-1", &json!({
            "action": "REFUND", "reason": "Batal", "paymentReference": "RF-0", "refundAmount": "10000"
        })).is_err());
        assert!(resolve_cancelled_invoice(&mut app, &ctx, "inv-1", &json!({
            "action": "REFUND", "reason": "Batal", "paymentReference": "RF-0", "refundAmount": 0
        })).is_err());

        let r1 = resolve_cancelled_invoice(&mut app, &ctx, "inv-1", &json!({
            "action": "REFUND", "reason": "Koreksi batal", "paymentReference": "RF-10K", "refundAmount": 10000
        })).unwrap();
        assert_eq!(r1.body.as_ref().unwrap()["totalReceivedAmount"], json!(40000.0));

        let r2 = resolve_cancelled_invoice(&mut app, &ctx, "inv-1", &json!({
            "action": "REFUND", "reason": "Koreksi batal", "paymentReference": "RF-10K", "refundAmount": 10000
        })).unwrap();
        assert_eq!(r2.body.as_ref().unwrap()["totalReceivedAmount"], json!(40000.0));
        assert_eq!(array(&app.db["invoices"][0], "refundReceipts").len(), 1);
        let refund_journals = array(&app.db, "doubleEntryJournals")
            .iter()
            .filter(|j| text(j, "eventType") == "REFUND_APPROVED")
            .count();
        assert_eq!(refund_journals, 1);
        assert_eq!(account_balance(&app, "1-1100"), 40000.0);
        let _ = std::fs::remove_dir_all(&root);
    }
}
