function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "api-info";
  const paths = {
    trips: rows(S.trips), orders: rows(S.orders), items: rows(S.items), payments: rows(S.payments)
  };
  if (action === "api-info") return cors({ message: "Jastip Tracker API", endpoints: ["GET /exec?action=trips|orders|items|payments", "POST /exec type=auth|trip-create|order-create|item-create|payment-add|wa-invoice"] });
  if (paths[action]) return cors({ [action === "trip" ? "trips" : action === "order" ? "orders" : action === "item" ? "items" : "payments"]: paths[action] });
  return cors({ ok: false, error: "unknown action" });
}

function doPost(e) {
  try { var body = JSON.parse(e.postData.contents); } catch (err) { return cors({ ok: false, error: "invalid json" }); }

  if (body.type === "auth") {
    if (body.key === "titiport123") return cors({ role: "admin" });
    var byWa = findOrderByWa(body.key);
    if (byWa) return cors({ role: "guest", wa: byWa.customer_wa, tripId: byWa.trip_id });
    var byId = findOrderById(body.key);
    if (ById) return cors({ role: "guest", wa: byId.customer_wa, tripId: byId.trip_id });
    return cors({ ok: false, error: "Password/WA/Order ID tidak ditemukan" });
  }

  if (body.type === "trips") return cors({ trips: rows(S.trips) });
  if (body.type === "orders") return cors({ orders: rows(S.orders) });
  if (body.type === "items") return cors({ items: rows(S.items) });
  if (body.type === "payments") return cors({ payments: rows(S.payments) });

  if (body.type === "trip-create") {
    if (body.admin_password !== "titiport123") return cors({ ok: false, error: "forbidden" });
    var id = nextId(S.trips);
    S.trips.appendRow([id, body.trip_name, body.country, body.currency_code, getRate(body.currency_code) || "", body.execution_rate || "", "active", now()]);
    return cors({ trip_id: id });
  }

  if (body.type === "order-create") {
    var id = nextId(S.orders);
    S.orders.appendRow([id, body.trip_id, body.customer_name, body.customer_wa, body.dp_paid_idr || 0, body.payment_status || "Unpaid", body.status || "menunggu", now(), body.notes || ""]);
    return cors({ ok: true, order_id: id });
  }

  if (body.type === "item-create") {
    var trip = rows(S.trips).find(function(t) { return String(t.trip_id) == String(body.trip_id); });
    var execRate = trip ? Number(trip.execution_rate || 0) : 0;
    var cost = Number(body.price_foreign || 0) * execRate;
    var sell = Number(body.price_sell_idr || cost * 1.2);
    var profit = sell - cost;
    var iid = nextId(S.items);
    S.items.appendRow([iid, body.order_id, body.trip_id, body.item_name, body.store_location || "", body.price_foreign, cost, sell, profit, body.status || "Pending", now()]);
    return cors({ ok: true, item_id: iid, price_cost_idr: cost, profit_idr: profit });
  }

  if (body.type === "payment-add") {
    var pid = nextId(S.payments);
    S.payments.appendRow([pid, body.order_id, body.amount_idr, body.method || "", body.status || "success", body.paid_at || now(), body.notes || ""]);
    return cors({ ok: true, payment_id: pid });
  }

  if (body.type === "wa-invoice") {
    var o = findOrderById(body.order_id);
    if (!o) return cors({ error: "order not found" });
    var text = "Hai " + o.customer_name + "\nTagihan order #" + o.order_id + "\nTotal: Rp " + Number(o.dp_paid_idr || 0).toLocaleString("id-ID") + "\nPesan: " + (o.notes || "Terima kasih");
    var url = encodeURIComponent(text);
    var wa = "https://wa.me/" + String(o.customer_wa).replace(/\D/g, "") + "?text=" + url;
    return cors({ ok: true, url: wa });
  }

  if (body.type === "wa-incoming") {
    var id = nextId(S.orders);
    var trip = rows(S.trips).find(function(t) { return String(t.trip_id) == String(body.trip_id || 1); });
    var notes = (body.item || "") + " | " + (body.notes || "");
    S.orders.appendRow([id, body.trip_id || 1, body.customer_name || "", body.customer_wa || "", 0, "Unpaid", "menunggu", now(), notes]);
    return cors({ ok: true, order_id: id });
  }

  return cors({ ok: false, error: "unknown" });
}

function doPut(e) { return doPost(e); }

function doDelete(e) { return cors({ ok: true }); }

function doOptions(e) {
  var out = ContentService.createTextOutput(JSON.stringify({ ok: true }));
  out.setMimeType(ContentService.MimeType.JSON);
  out.setHeader("Access-Control-Allow-Origin", "*");
  out.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  out.setHeader("Access-Control-Allow-Headers", "Content-Type");
  out.setHeader("Access-Control-Max-Age", "86400");
  return out;
}
