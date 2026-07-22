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
  if (req.method === 'OPTIONS') return res.status(200).end();
}

function bad(res, msg) { return res.status(400).json({ error: msg }); }
function ok(res, data) { return res.status(200).json(data); }

module.exports = async (req, res) => {
  cors(req, res);
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  let body = {};
  try { body = await req.json().catch(async () => { const t = await req.text(); try { return JSON.parse(t); } catch(e){ return {}; } }); } catch (e) { body = {}; }

  if (pathname === '/api/orders') {
    if (req.method === 'GET') return ok(res, readData());
    if (req.method === 'POST') {
      let body = {};
      try { body = await req.json().catch(() => ({})); } catch (e) { }
      const data = readData();
      const order = {
        order_id: body.order_id || (data.orders.length ? Math.max(...data.orders.map(o => Number(o.order_id) || 0)) + 1 : 1),
        trip_id: body.trip_id || 1,
        customer_name: body.customer_name || '',
        customer_wa: body.customer_wa || '',
        item_desc: body.item_desc || '',
        cny_subtotal: Number(body.cny_subtotal || 0),
        weight_kg: Number(body.weight_kg || 0),
        volume_cbm: Number(body.volume_cbm || 0),
        shipping_method: body.shipping_method || '',
        fee_rate: Number(body.fee_rate || 0.08),
        fee_rp: Number(body.fee_rp || 0),
        barang_rp: Number(body.barang_rp || 0),
        ongkir_rp: Number(body.ongkir_rp || 0),
        total_rp: Number(body.total_rp || 0),
        status: body.status || 'menunggu',
        created_at: body.created_at || new Date().toISOString(),
        invoice_no: body.invoice_no || '',
        paid_at: body.paid_at || '',
        notes: body.notes || ''
      };
      data.orders.push(order);
      writeData(data);
      return ok(res, { ok: true, order });
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (pathname === '/api/tracker') {
    if (req.method === 'GET') {
      const q = parsed.query.q || '';
      const data = readData();
      const order = (data.orders || []).find(o => String(o.order_id) === String(q) || String(o.customer_wa).includes(String(q)));
      return order ? ok(res, { order }) : res.status(404).json({ error: 'not_found' });
    }
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  if (pathname.startsWith('/api/admin/')) {
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      let body = {};
      try { body = await req.json().catch(() => ({})); } catch (e) { }
      if (body.password === ADMIN_PASS) return ok(res, { ok: true, role: 'admin' });
      return res.status(401).json({ error: 'invalid' });
    }
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const data = readData();
      const tripFilter = parsed.query.trip;
      let orders = data.orders || [];
      if (tripFilter) orders = orders.filter(o => String(o.trip_id) === String(tripFilter));
      return ok(res, { orders, trips: data.trips });
    }
    if (pathname === '/api/admin/orders' && req.method === 'POST') {
      let body = {};
      try { body = await req.json().catch(() => ({})); } catch (e) { }
      const data = readData();
      const order = {
        order_id: body.order_id || (data.orders.length ? Math.max(...data.orders.map(o => Number(o.order_id) || 0)) + 1 : 1),
        trip_id: body.trip_id || 1,
        customer_name: body.customer_name || '',
        customer_wa: body.customer_wa || '',
        item_desc: body.item_desc || '',
        cny_subtotal: Number(body.cny_subtotal || 0),
        weight_kg: Number(body.weight_kg || 0),
        volume_cbm: Number(body.volume_cbm || 0),
        shipping_method: body.shipping_method || '',
        fee_rate: Number(body.fee_rate || 0.08),
        fee_rp: Number(body.fee_rp || 0),
        barang_rp: Number(body.barang_rp || 0),
        ongkir_rp: Number(body.ongkir_rp || 0),
        total_rp: Number(body.total_rp || 0),
        status: body.status || 'menunggu',
        created_at: body.created_at || new Date().toISOString(),
        invoice_no: body.invoice_no || '',
        paid_at: body.paid_at || '',
        notes: body.notes || ''
      };
      data.orders.push(order);
      writeData(data);
      return ok(res, { ok: true, order });
    }
    return res.status(404).json({ error: 'not_found' });
  }

  return res.status(404).json({ error: 'not_found' });
};
