use crate::domain::invoice_totals;
use crate::http::{
    ApiResult, App, RequestContext, array, array_mut, audit, bad_request, conflict, id,
    json_response, not_found, now, require_service, save, text,
};
use serde_json::{Value, json};

fn number(value: &Value, key: &str) -> f64 {
    value[key]
        .as_f64()
        .or_else(|| value[key].as_str().and_then(|s| s.parse().ok()))
        .unwrap_or(0.0)
}

fn recalculate(invoice: &mut Value, discount: f64) {
    let totals = invoice_totals(
        array(invoice, "items"),
        text(invoice, "guarantor"),
        discount,
    );
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
    json!({"id":id("acc"),"facilityCode":ctx.facility_code,"entryNumber":format!("JRN/{}/{}/{}",ctx.facility_code.chars().take(4).collect::<String>(),timestamp[..10].replace('-',""),array(&app.db,"accountingEntries").len()+1),"timestamp":timestamp,"accountCode":account_code,"accountName":account_name,"type":kind,"category":category,"description":description,"amount":amount,"referenceId":reference})
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
    }
    None
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
    if matches!(text(&invoice, "status"), "LUNAS" | "KLAIM_DIAJUKAN") {
        return json_response(200, invoice);
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
    if payment == "KLAIM_BPJS" && text(&invoice, "guarantor") != "BPJS_KESEHATAN" {
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
        array_mut(&mut app.db, "accountingEntries").insert(0, entry);
    }
    for visit in array_mut(&mut app.db, "visits").iter_mut().filter(|v| {
        text(v, "id") == text(&invoice, "visitId") && text(v, "facilityCode") == ctx.facility_code
    }) {
        visit["status"] = json!("SELESAI");
        visit["updatedAt"] = json!(timestamp);
    }
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
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
    let submitted = body["items"].as_array().filter(|items| !items.is_empty())
        .ok_or_else(|| bad_request("Masukkan seluruh rincian tagihan, minimal satu item. Tarif nol harus diisi secara eksplisit."))?;
    let mut items = vec![];
    let mut subtotal = 0.0;
    for item in submitted {
        let quantity = item["quantity"]
            .as_f64()
            .filter(|value| value.is_finite() && *value > 0.0)
            .ok_or_else(|| bad_request("Kuantitas item harus berupa angka lebih dari nol."))?;
        let unit_price = item["unitPrice"].as_f64().filter(|value| value.is_finite() && *value >= 0.0)
            .ok_or_else(|| bad_request("Tarif setiap item harus diisi dengan angka nonnegatif, termasuk nol bila tanpa biaya."))?;
        let category = text(item, "category");
        if ![
            "PENDAFTARAN",
            "KONSULTASI",
            "TINDAKAN",
            "FARMASI",
            "LABORATORIUM",
            "RADIOLOGI",
            "KAMAR_INAP",
            "BEDAH_IBS",
            "MCU",
        ]
        .contains(&category)
            || text(item, "description").trim().is_empty()
            || !(quantity * unit_price).is_finite()
        {
            return Err(bad_request(
                "Kategori, deskripsi, dan nilai item tagihan tidak valid.",
            ));
        }
        items.push(json!({"id":id("bli"),"category":category,"description":text(item,"description").trim(),"quantity":quantity,"unitPrice":unit_price,"subtotal":quantity*unit_price}));
        subtotal += quantity * unit_price;
        if !subtotal.is_finite() {
            return Err(bad_request(
                "Total nilai tagihan melebihi batas angka yang dapat dicatat.",
            ));
        }
    }
    invoice["items"] = json!(items);
    invoice["unpricedItems"] = json!([]);
    invoice["pricingStatus"] = json!("COMPLETE");
    invoice["pricingSource"] = json!("MANUAL");
    invoice["pricedAt"] = json!(now());
    invoice["pricedBy"] = ctx.user["id"].clone();
    recalculate(&mut invoice, 0.0);
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
    array_mut(&mut invoice,"items").push(json!({"id":id("item"),"category":category,"description":text(body,"description").trim(),"quantity":quantity,"unitPrice":price,"subtotal":quantity*price}));
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
    array_mut(&mut app.db, "accountingEntries").insert(0, entry.clone());
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
    if text(&invoice, "status") != "KLAIM_DIAJUKAN" || text(&invoice, "pricingStatus") != "COMPLETE"
    {
        return Err(conflict(
            "Penerimaan hanya dapat dicatat untuk klaim atau piutang yang sudah diajukan dengan tarif lengkap.",
        ));
    }
    let bpjs = text(&invoice, "guarantor") == "BPJS_KESEHATAN";
    let amount = body["receivedAmount"]
        .as_f64()
        .filter(|amount| amount.is_finite() && *amount > 0.0)
        .ok_or_else(|| bad_request("Masukkan nominal penerimaan aktual yang lebih dari nol."))?;
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
    let received = number(&invoice, "totalReceivedAmount") + amount;
    if !received.is_finite() {
        return Err(bad_request("Nominal kumulatif penerimaan tidak valid."));
    }
    let timestamp = now();
    let net = (number(&invoice, "subtotal") - number(&invoice, "discountAmount")).max(0.0);
    let settled = received >= net;
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
    let entry = accounting_entry(
        app,
        ctx,
        "4-1015",
        "Pencairan Klaim JKN BPJS / Piutang Korporasi",
        "PENDAPATAN",
        if bpjs { "KLAIM_BPJS" } else { "LAYANAN_MEDIS" },
        &format!(
            "Penerimaan klaim {} — {}",
            text(&invoice, "invoiceNumber"),
            text(&invoice, "patientName")
        ),
        amount,
        text(&invoice, "invoiceNumber"),
    );
    array_mut(&mut app.db, "invoices")[index] = invoice.clone();
    array_mut(&mut app.db, "accountingEntries").insert(0, entry.clone());
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
