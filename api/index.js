const fs = require('fs');
const path = require('path');
const url = require('url');
const DATA_PATH = path.join(process.cwd(), 'data.json');
const ADMIN_PASS = process.env.ADMIN_PASS || 'titiport123';

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch (e) { return { orders: [], trips: [{ trip_id: 1, trip_name: 'China Taobao', country: 'CN', currency_code: 'CNY', rate: 2200, execution_rate: 1.0, status: 'active' }] }; }
}
function writeData(data) { fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8'); return data; }

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.statusCode = 200;
    return res.end();
  }
}

function bad(res, msg) {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: msg }));
}
function ok(res, data) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(data));
}

async function parseJsonBody(req) {
  try {
    if (req.body && typeof req.body === 'object') return req.body;
    const raw = await req.text();
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function makeOrder(body, data) {
  return {
    order_id: body.order_id || (data.orders.length ? Math.max(...data.orders.map(o => Number(o.order_id) || 0)) + 1 : 1),
    trip_id: Number(body.trip_id || 1),
    customer_name: String(body.customer_name || ''),
    customer_wa: String(body.customer_wa || ''),
    item_desc: String(body.item_desc || ''),
    cny_subtotal: Number(body.cny_subtotal || 0),
    weight_kg: Number(body.weight_kg || 0),
    volume_cbm: Number(body.volume_cbm || 0),
    shipping_method: String(body.shipping_method || ''),
    fee_rate: Number(body.fee_rate || 0.08),
    fee_rp: Number(body.fee_rp || 0),
    barang_rp: Number(body.barang_rp || 0),
    ongkir_rp: Number(body.ongkir_rp || 0),
    total_rp: Number(body.total_rp || 0),
    status: String(body.status || 'menunggu'),
    created_at: body.created_at || new Date().toISOString(),
    invoice_no: String(body.invoice_no || ''),
    paid_at: body.paid_at || '',
    notes: String(body.notes || '')
  };
}

module.exports = async (req, res) => {
  cors(req, res);
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  let body = {};
  try {
    body = await parseJsonBody(req);
  } catch (e) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'bad_request' }));
  }

  if (pathname === '/api/orders') {
    if (req.method === 'GET') return ok(res, readData());
    if (req.method === 'POST') {
      const data = readData();
      const order = makeOrder(body, data);
      data.orders.push(order);
      writeData(data);
      return ok(res, { ok: true, order });
    }
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'method_not_allowed' }));
  }

  if (pathname.startsWith('/api/admin/')) {
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      if (body.password === ADMIN_PASS) return ok(res, { ok: true, role: 'admin' });
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: 'invalid' }));
    }
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const data = readData();
      const tripFilter = parsed.query.trip;
      let orders = data.orders || [];
      if (tripFilter) orders = orders.filter(o => String(o.trip_id) === String(tripFilter));
      return ok(res, { orders, trips: data.trips });
    }
    if (pathname === '/api/admin/orders' && req.method === 'POST') {
      const data = readData();
      const order = makeOrder(body, data);
      data.orders.push(order);
      writeData(data);
      return ok(res, { ok: true, order });
    }
    if (pathname.startsWith('/api/admin/orders/') && req.method === 'PATCH') {
      const id = pathname.split('/').pop();
      const data = readData();
      const idx = data.orders.findIndex(o => String(o.order_id) === String(id));
      if (idx === -1) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'not_found' }));
      }
      data.orders[idx] = { ...data.orders[idx], ...body };
      writeData(data);
      return ok(res, { ok: true, order: data.orders[idx] });
    }
    if (pathname.startsWith('/api/admin/orders/') && req.method === 'DELETE') {
      const id = pathname.split('/').pop();
      const data = readData();
      const idx = data.orders.findIndex(o => String(o.order_id) === String(id));
      if (idx === -1) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'not_found' }));
      }
      const removed = data.orders.splice(idx, 1)[0];
      writeData(data);
      return ok(res, { ok: true, order: removed });
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'not_found' }));
  }

  res.statusCode = 404;
  res.setHeader('Content-Type', 'application/json');
  return res.end(JSON.stringify({ error: 'not_found' }));
};
