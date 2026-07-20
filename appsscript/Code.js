// === Jastip Business Tracker — Google Apps Script (NO Smart Lock) ===
// Paste ke Apps Script > Save > Deploy Web App (Anyone, Execute as Me)
// Login: admin=titiport123, guest=WA/Order ID
// Sheet: 105hC8dryir_u2N7PEUvDmfR7JpS2PRg4Nn3kv13vPXQ

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
  const trips = rows(S.trips);
  const orders = rows(S.orders);
  const items = rows(S.items);
  const payments = rows(S.payments);
  const totalOrders = orders.length;
  const totalRevenue = orders.reduce((a, b) => a + Number(safe(b.dp_paid_idr || 0)), 0);
  const totalCost = items.reduce((a, b) => a + Number(safe(b.price_cost_idr || 0)), 0);
  const outstanding = orders.filter(function(o) { return o.payment_status === "Unpaid"; }).length;
  const paid = orders.filter(function(o) { return o.payment_status === "Paid"; }).length;
  const topCustomers = {};
  orders.forEach(function(o) { var k = safe(o.customer_name || "?"); topCustomers[k] = (topCustomers[k] || 0) + 1; });
  var fmt = function(n) { return n == null ? "-" : "Rp " + Number(n).toLocaleString("id-ID"); };

  var tripOptions = "";
  for (var ti = 0; ti < trips.length; ti++) {
    var t = trips[ti];
    tripOptions += "<option value=\"" + t.trip_id + "\">" + safe(t.trip_name) + "</option>";
  }

  var topRows = "";
  var topArr = Object.keys(topCustomers).map(function(k) { return [k, topCustomers[k]]; }).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 5);
  for (var topi = 0; topi < topArr.length; topi++) {
    topRows += "<tr><td>" + safe(topArr[topi][0]) + "</td><td>" + topArr[topi][1] + "</td></tr>";
  }

  var recentRows = "";
  for (var ri = 0; ri < Math.min(orders.length, 15); ri++) {
    var o = orders[ri];
    recentRows += "<tr><td>" + o.order_id + "</td><td>" + safe(o.customer_name) + "</td><td>" + safe(o.customer_wa) + "</td><td class=\"total\">" + fmt(o.dp_paid_idr) + "</td><td><span class=\"badge " + String(o.payment_status || "").toLowerCase() + "\">" + o.payment_status + "</span></td><td><a href=\"https://wa.me/" + safe(o.customer_wa).replace(/\D/g, "") + "\" target=\"_blank\">WA</a></td></tr>";
  }

  var html = "<!DOCTYPE html><html lang=\"id\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,maximum-scale=1\"><title>Jastip Tracker</title>";
  html += "<style>";
  html += "*{box-sizing:border-box;font-family:Segoe UI,system-ui,sans-serif}html,body{margin:0;padding:0;background:#0f1115;color:#e8eaed}";
  html += ".app{max-width:480px;margin:0 auto;padding:12px 12px 80px 12px}";
  html += ".top{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}.top h1{color:#ff7a45;font-size:18px;margin:0}";
  html += ".grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:14px}";
  html += ".kpi{background:#1a1d23;border:1px solid #2a2e36;border-radius:14px;padding:14px;text-align:center}.kpi .v{font-size:18px;font-weight:700;color:#ff7a45}.kpi .l{font-size:11px;color:#9aa0a6;margin-top:4px}.kpi.ok .v{color:#6bffb0}.kpi.warn .v{color:#ffce6b}";
  html += ".card{background:#1a1d23;border:1px solid #2a2e36;border-radius:14px;padding:12px;margin-bottom:12px}.card h3{color:#ff7a45;margin:0 0 8px;font-size:14px}";
  html += "select,input{width:100%;padding:10px;border-radius:9px;border:1px solid #2a2e36;background:#0f1115;color:#e8eaed;margin:4px 0}";
  html += ".btn{width:100%;padding:12px;border:none;border-radius:9px;background:#ff7a45;color:#fff;font-weight:600;margin-top:8px}";
  html += ".btn2{background:#2a2e36;color:#e8eaed}";
  html += "table{width:100%;border-collapse:collapse;font-size:12px}th,td{padding:7px 5px;text-align:left;border-bottom:1px solid #2a2e36;color:#e8eaed}";
  html += ".total{color:#ff7a45;font-weight:700}";
  html += ".login{background:#1a1d23;border:1px solid #2a2e36;border-radius:14px;padding:24px;max-width:360px;margin:40px auto;text-align:center}";
  html += ".hidden{display:none}";
  html += ".nav{position:fixed;bottom:0;left:0;right:0;background:#13161c;border-top:1px solid #2a2e36;display:flex;justify-content:space-around;padding:8px 0;padding-bottom:max(8px,env(safe-area-inset-bottom));z-index:9}";
  html += ".nav a{color:#9aa0a6;text-decoration:none;font-size:11px;text-align:center;flex:1}";
  html += ".nav a.act{color:#ff7a45}.nav .ico{font-size:18px;display:block}";
  html += ".fab{position:fixed;right:14px;bottom:70px;background:#ff7a45;color:#fff;border:none;border-radius:50%;width:50px;height:50px;font-size:24px;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px #0005;z-index:9}";
  html += ".chips{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}";
  html += ".chip{background:#0f1115;border:1px solid #2a2e36;border-radius:20px;padding:6px 10px;font-size:12px;white-space:nowrap}";
  html += ".chip.act{background:#ff7a45;color:#fff;border-color:#ff7a45}";
  html += ".badge{padding:3px 8px;border-radius:20px;font-size:11px;font-weight:600}";
  html += ".menunggu{background:#3a2f12;color:#ffce6b}.diproses{background:#10324a;color:#6bb8ff}.dikirim{background:#103a2a;color:#6bffb0}.bayar{background:#3a1212;color:#ff8b8b}.batal{background:#2a2a2a;color:#888}";
  html += "</style></head><body>";
  html += "<div class=\"app\">";
  html += "<div id=\"loginPage\" class=\"login\">";
  html += "<h2 style=\"color:#ff7a45\">Jastip Tracker</h2>";
  html += "<p style=\"font-size:12px;color:#9aa0a6\">Admin: titiport123 | Tamu: nomor WA / Order ID</p>";
  html += "<input id=\"k\" placeholder=\"Password / WA / Order ID\">";
  html += "<button class=\"btn\" onclick=\"doLogin()\">Masuk</button>";
  html += "</div>";

  html += "<div id=\"app\" class=\"hidden\">";
  html += "<div class=\"top\"><h1>Jastip Tracker</h1><select id=\"tripSel\" onchange=\"renderDashboard()\">" + tripOptions + "</select></div>";
  html += "<div class=\"grid\">";
  html += "<div class=\"kpi\"><div class=\"v\" id=\"kpiOrders\">" + totalOrders + "</div><div class=\"l\">Order</div></div>";
  html += "<div class=\"kpi\"><div class=\"v\" id=\"kpiRevenue\">" + fmt(totalRevenue) + "</div><div class=\"l\">Revenue</div></div>";
  html += "<div class=\"kpi ok\"><div class=\"v\" id=\"kpiCost\">" + fmt(totalCost) + "</div><div class=\"l\">Modal</div></div>";
  html += "<div class=\"kpi warn\"><div class=\"v\" id=\"kpiOut\">" + outstanding + "</div><div class=\"l\">Outstanding</div></div>";
  html += "<div class=\"kpi ok\"><div class=\"v\" id=\"kpiPaid\">" + paid + "</div><div class=\"l\">Lunas</div></div>";
  html += "</div>";

  html += "<div class=\"card\"><h3>Top Customers</h3><div id=\"topCustomers\"><table><tr><th>Customer</th><th>Orders</th></tr>" + topRows + "</table></div></div>";
  html += "<div class=\"card\"><h3>Filter Orders</h3><div class=\"chips\" id=\"filterChips\"></div><div style=\"margin-top:8px;overflow-x:auto\"><table><tr><th>ID</th><th>Customer</th><th>WA</th><th>Total</th><th>Status</th><th>Aksi</th></tr><tbody id=\"ordersTable\">" + recentRows + "</tbody></table></div></div>";
  html += "<div class=\"card\"><h3>Trips</h3><div id=\"tripsList\"></div></div>";

  html += "<button class=\"fab\" onclick=\"openFab()\">+</button>";
  html += "<div class=\"nav\">";
  html += "<a href=\"#\" class=\"act\" onclick=\"showTab('home')\"><span class=\"ico\">\uD83C\uDFE0</span>Home</a>";
  html += "<a href=\"#\" onclick=\"showTab('orders')\"><span class=\"ico\">\uD83D\uDCCB</span>Orders</a>";
  html += "<a href=\"#\" onclick=\"showTab('scan')\"><span class=\"ico\">\uD83D\uDCF7</span>Scan</a>";
  html += "<a href=\"#\" onclick=\"showTab('trip')\"><span class=\"ico\">\uD83C\uDFF5</span>Trip</a>";
  html += "<a href=\"#\" onclick=\"showTab('more')\"><span class=\"ico\">\u22EE</span>More</a>";
  html += "</div>";
  html += "</div>";

  html += "<script>";
  html += "var role='guest',wa='',tripId='',trips=[],orders=[],items=[],payments=[],filterStatus='',tripFilter='';";
  html += "function fmt(n){return n==null?'-':'Rp '+Number(n).toLocaleString('id-ID');}";
  html += "function showTab(t){";
  html += "document.querySelectorAll('#app > div').forEach(function(el){if(el.id!=='loginPage' && !el.classList.contains('top') && !el.classList.contains('nav') && !el.classList.contains('fab')) el.classList.add('hidden')});";
  html += "document.querySelectorAll('.nav a').forEach(function(a){a.classList.remove('act')});";
  html += "if(t==='home'){document.getElementById('kpiOrders')&&(document.getElementById('app').querySelectorAll('.card')[0].classList.remove('hidden'));renderDashboard();}";
  html += "else if(t==='orders'){document.getElementById('ordersTable').closest('.card').classList.remove('hidden');renderOrders();}";
  html += "else if(t==='scan'){alert('Fitur scan struk: kirim foto ke n8n/OCR, atau input manual ke form item');}";
  html += "else if(t==='trip'){document.getElementById('tripsList').closest('.card').classList.remove('hidden');renderTrips();}";
  html += "else if(t==='more'){document.getElementById('topCustomers').closest('.card').classList.remove('hidden');renderTop();}";
  html += "}";
  html += "function doLogin(){";
  html += "var v=document.getElementById('k').value.trim();";
  html += "fetch(window.location.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'auth',key:v})})";
  html += ".then(function(r){return r.json()}).then(function(d){if(d.error){alert(d.error);return;}role=d.role;wa=d.wa||'';tripId=d.tripId||'';document.getElementById('loginPage').classList.add('hidden');document.getElementById('app').classList.remove('hidden');loadAll();});";
  html += "}";
  html += "async function loadAll(){await renderTrips();await renderDashboard();await renderOrders();}";
  html += "async function renderTrips(){";
  html += "var r=await fetch(window.location.href); var j=await r.json(); trips=j.trips||[];";
  html += "var sel=document.getElementById('tripSel'); var opts=''; for(var i=0;i<trips.length;i++){var tt=trips[i]; opts+='<option value=\"'+tt.trip_id+'\">'+tt.trip_name+'</option>';}";
  html += "sel.innerHTML=opts||'<option value=\"\">-</option>'; if(tripId) sel.value=tripId;";
  html += "}";
  html += "async function renderDashboard(){";
  html += "tripFilter=document.getElementById('tripSel').value;";
  html += "var r=await fetch(window.location.href); var j=await r.json(); orders=j.orders||[]; items=j.items||[]; payments=j.payments||[];";
  html += "var curOrders=tripFilter?orders.filter(function(o){return String(o.trip_id)==String(tripFilter);}):orders;";
  html += "var curItems=tripFilter?items.filter(function(i){return String(i.trip_id)==String(tripFilter);}):items;";
  html += "var totalOrders=curOrders.length; var totalRevenue=curOrders.reduce(function(a,b){return a+Number(b.dp_paid_idr||0);},0);";
  html += "var totalCost=curItems.reduce(function(a,b){return a+Number(b.price_cost_idr||0);},0);";
  html += "var outstanding=curOrders.filter(function(o){return o.payment_status==='Unpaid';}).length;";
  html += "var paid=curOrders.filter(function(o){return o.payment_status==='Paid';}).length;";
  html += "document.getElementById('kpiOrders').textContent=totalOrders; document.getElementById('kpiRevenue').textContent=fmt(totalRevenue);";
  html += "document.getElementById('kpiCost').textContent=fmt(totalCost); document.getElementById('kpiOut').textContent=outstanding; document.getElementById('kpiPaid').textContent=paid;";
  html += "renderTop(curOrders);";
  html += "}";
  html += "function renderTop(curOrders){";
  html += "var m={}; var src=curOrders||orders; for(var i=0;i<src.length;i++){var k=safe(src[i].customer_name||'?'); m[k]=(m[k]||0)+1;}";
  html += "var arr=Object.keys(m).map(function(k){return [k,m[k]];}).sort(function(a,b){return b[1]-a[1];}).slice(0,5);";
  html += "var rows=''; for(var i=0;i<arr.length;i++) rows+='<tr><td>'+safe(arr[i][0])+'</td><td>'+arr[i][1]+'</td></tr>';";
  html += "document.getElementById('topCustomers').innerHTML=rows?'<table><tr><th>Customer</th><th>Orders</th></tr>'+rows+'</table>':'<i>Belum ada data</i>';";
  html += "}";
  html += "function renderOrders(){";
  html += "var r=await fetch(window.location.href); var j=await r.json(); orders=j.orders||[];";
  html += "var filtered=filterStatus?orders.filter(function(o){return o.payment_status===filterStatus;}):orders;";
  html += "var tbody=''; for(var i=0;i<Math.min(filtered.length,25);i++){var o=filtered[i]; tbody+='<tr><td>'+o.order_id+'</td><td>'+safe(o.customer_name)+'</td><td>'+safe(o.customer_wa)+'</td><td class=\"total\">'+fmt(o.dp_paid_idr)+'</td><td><span class=\"badge '+String(o.payment_status||'').toLowerCase()+'\">'+o.payment_status+'</span></td><td><a href=\"https://wa.me/'+safe(o.customer_wa).replace(/\\D/g,'')+'\" target=\"_blank\">WA</a></td></tr>';}";
  html += "document.getElementById('ordersTable').innerHTML=tbody||'<tr><td colspan=\"6\">Belum ada orders</td></tr>';";
  html += "}";
  html += "function setFilter(st){filterStatus=filterStatus===st?'':st;renderFilterChips();renderOrders();}";
  html += "function renderFilterChips(){";
  html += "var chips=[['Unpaid','Unpaid'],['Paid','Paid'],['DP','Partial/DP'],['Menunggu','menunggu']]; var html='';";
  html += "for(var i=0;i<chips.length;i++){var c=chips[i]; html+='<button class=\"chip '+(filterStatus===c[1]?'act':'')+'\" onclick=\"setFilter(\\''+c[1]+'\\')\">'+c[0]+'</button>';}";
  html += "document.getElementById('filterChips').innerHTML=html;";
  html += "}";
  html += "function openFab(){alert('FAB: +Order / +Item / +Payment (akan dihubungkan ke n8n automation)');}";
  html += "function safe(v){return v==null?'':String(v);}";
  html += "</script>";

  html += "</body></html>";
  return ContentService.createTextOutput(html).setMimeType(ContentService.MimeType.HTML);
}
