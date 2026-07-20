// === Jastip Business Tracker — Apps Script JSON API ===
// Deploy as Web App: Anyone, Execute as Me
// Frontend: GitHub Pages (index.html)
// Sheet ID: 105hC8dryir_u2N7PEUvDmfR7JpS2PRg4Nn3kv13vPXQ

const SS_ID = "105hC8dryir_u2N7PEUvDmfR7JpS2PRg4Nn3kv13vPXQ";
const SS = SpreadsheetApp.openById(SS_ID);
const S = {
  trips: SS.getSheetByName("Trips"),
  orders: SS.getSheetByName("Orders"),
  items: SS.getSheetByName("Items"),
  payments: SS.getSheetByName("Payments"),
  admins: SS.getSheetByName("Admins"),
};
const RATE_URL = "https://open.er-api.com/v6/latest/USD";

function getRate(code) {
  try {
    const r = UrlFetchApp.fetch(RATE_URL, { muteHttpExceptions: true });
    const d = JSON.parse(r.getContentText());
    const usd = d.rates[code], idr = d.rates.IDR;
    return usd && idr ? idr / usd : null;
  } catch (e) { return null; }
}

function rows(sheet) {
  if (!sheet) return [];
  const r = sheet.getDataRange().getValues();
  if (r.length < 2) return [];
  const h = r[0]; const out = [];
  for (let i = 1; i < r.length; i++) { const o = {}; for (let j = 0; j < h.length; j++) o[h[j]] = r[i][j]; out.push(o); }
  return out;
}

function nextId(sheet) {
  const v = sheet.getRange("A2:A" + sheet.getLastRow()).getValues();
  let mx = 0;
  for (let i = 0; i < v.length; i++) if (Number(v[i][0]) > mx) mx = Number(v[i][0]);
  return mx + 1;
}

function safe(v) { return v == null ? "" : v; }
function now() { return new Date().toISOString(); }
function findOrderById(id) { return rows(S.orders).find(o => String(o.order_id) == String(id)); }
function findOrderByWa(wa) { return rows(S.orders).find(o => String(o.customer_wa) == String(wa)); }

function ok(obj) { return ContentService.createTextOutput(JSON.stringify(Object.assign({ ok: true }, obj))).setMimeType(ContentService.MimeType.JSON); }
function err(m) { return ContentService.createTextOutput(JSON.stringify({ ok: false, error: m })).setMimeType(ContentService.MimeType.JSON); }
function isAdmin(p) { return p === "titiport123"; }

function doPost(e) {
  const p = JSON.parse(e.postData.contents);
  if (p.type === "auth") {
    if (p.key === "titiport123") return ok({ role: "admin" });
    const byWa = findOrderByWa(p.key);
    if (byWa) return ok({ role: "guest", wa: byWa.customer_wa, tripId: byWa.trip_id });
    const byId = findOrderById(p.key);
    if (ById) return ok({ role: "guest", wa: byId.customer_wa, tripId: byId.trip_id });
    return err("Password/WA/Order ID tidak ditemukan");
  }
  if (p.type === "trips") return ok({ trips: rows(S.trips) });
  if (p.type === "orders") return ok({ orders: rows(S.orders) });
  if (p.type === "items") return ok({ items: rows(S.items) });
  if (p.type === "payments") return ok({ payments: rows(S.payments) });
  if (p.type === "trip-create") {
    if (!isAdmin(p.admin_password)) return err("forbidden");
    const id = nextId(S.trips);
    S.trips.appendRow([id, p.trip_name, p.country, p.currency_code, getRate(p.currency_code) || "", p.execution_rate || "", "active", now()]);
    return ok({ trip_id: id });
  }
  if (p.type === "order-create") {
    const id = nextId(S.orders);
    S.orders.appendRow([id, p.trip_id, p.customer_name, p.customer_wa, p.dp_paid_idr || 0, p.payment_status || "Unpaid", p.status || "menunggu", now(), p.notes || ""]);
    return ok({ order_id: id });
  }
  if (p.type === "item-create") {
    const trip = rows(S.trips).find(t => String(t.trip_id) == String(p.trip_id));
    const execRate = trip ? Number(trip.execution_rate || 0) : 0;
    const cost = Number(p.price_foreign || 0) * execRate;
    const sell = Number(p.price_sell_idr || cost * 1.2);
    const profit = sell - cost;
    const id = nextId(S.items);
    S.items.appendRow([id, p.order_id, p.trip_id, p.item_name, p.store_location || "", p.price_foreign, cost, sell, profit, p.status || "Pending", now()]);
    return ok({ item_id: id, price_cost_idr: cost, profit_idr: profit });
  }
  if (p.type === "payment-add") {
    const id = nextId(S.payments);
    S.payments.appendRow([id, p.order_id, p.amount_idr, p.method || "", p.status || "success", p.paid_at || now(), p.notes || ""]);
    return ok({ payment_id: id });
  }
  if (p.type === "wa-invoice") return ok(waInvoice(p.order_id));
  return err("unknown");
}

function waInvoice(orderId) {
  const o = findOrderById(orderId);
  if (!o) return { error: "order not found" };
  const text = "Hai " + o.customer_name + "\nTagihan order #" + o.order_id + "\nTotal: Rp " + Number(o.dp_paid_idr || 0).toLocaleString("id-ID") + "\nPesan: " + (o.notes || "Terima kasih");
  const url = encodeURIComponent(text);
  const wa = "https://wa.me/" + String(o.customer_wa).replace(/\D/g, "") + "?text=" + url;
  return { ok: true, url: wa };
}

function doGet() {
  return ok({
    message: "Jastip Tracker API",
    endpoints: ["POST /exec type=auth", "POST /exec type=trips|orders|items|payments", "POST /exec type=trip-create|order-create|item-create|payment-add", "POST /exec type=wa-invoice"]
  });
}
