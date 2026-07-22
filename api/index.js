const { createClient } = require('@supabase/supabase-js');
const url = require('url');
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://npqvbrexccwxoovdrzcc.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_hkSvuVQtIut8FYQDqpJ8HQ_vuw1XdEu';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function cors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.statusCode = 200; return res.end(); }
}

function sendJson(res, status, data) { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); }

module.exports = async (req, res) => {
  cors(req, res);
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/api/orders') {
    if (req.method === 'GET') {
      const { data: orders, error: oErr } = await supabase.from('orders').select('*').order('order_id', { ascending: true });
      if (oErr) return sendJson(res, 500, { error: oErr.message });
      const { data: trips, error: tErr } = await supabase.from('trips').select('*');
      if (tErr) return sendJson(res, 500, { error: tErr.message });
      return sendJson(res, 200, { orders: orders || [], trips: trips || [] });
    }
    if (req.method === 'POST') {
      
      const order_id = String(body.order_id || Date.now());
      const { data: order, error } = await supabase.from('orders').insert({
        order_id, trip_id: Number(body.trip_id || 1), customer_name: String(body.customer_name || ''), customer_wa: String(body.customer_wa || ''), item_desc: String(body.item_desc || ''),
        cny_subtotal: Number(body.cny_subtotal || 0), weight_kg: Number(body.weight_kg || 0), volume_cbm: Number(body.volume_cbm || 0), shipping_method: String(body.shipping_method || ''),
        fee_rate: Number(body.fee_rate || 0.08), fee_rp: Number(body.fee_rp || 0), barang_rp: Number(body.barang_rp || 0), ongkir_rp: Number(body.ongkir_rp || 0), total_rp: Number(body.total_rp || 0),
        status: String(body.status || 'menunggu'), created_at: body.created_at || new Date().toISOString(), invoice_no: String(body.invoice_no || ''), paid_at: body.paid_at || null, notes: String(body.notes || '')
      }).select().single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { ok: true, order });
    }
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  if (pathname === '/api/tracker') {
    if (req.method === 'GET') {
      const q = String(parsed.query.q || '').trim();
      if (!q) return sendJson(res, 404, { error: 'not_found' });
      const { data: byId } = await supabase.from('orders').select('*').eq('order_id', q).maybeSingle();
      if (byId) return sendJson(res, 200, { order: byId });
      const digits = q.replace(/\D/g, '');
      const { data: byWa } = await supabase.from('orders').select('*').ilike('customer_wa', `%${digits}%`).limit(1);
      const match = byWa && byWa[0] ? byWa[0] : null;
      return match ? sendJson(res, 200, { order: match }) : sendJson(res, 404, { error: 'not_found' });
    }
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  if (pathname === '/api/products') {
    return sendJson(res, 200, {
      categories: ['Fashion', 'Elektronik', 'Beauty & skincare', 'Home living', 'Aksesori'],
      products: [
        {name:'Jaket kulit', category:'Fashion', est:'Rp250.000 - Rp800.000'},
        {name:'Sepatu sneakers', category:'Fashion', est:'Rp200.000 - Rp600.000'},
        {name:'Tas selempang', category:'Fashion', est:'Rp120.000 - Rp300.000'},
        {name:'Power bank 20k', category:'Elektronik', est:'Rp80.000 - Rp150.000'},
        {name:'Headphone BT', category:'Elektronik', est:'Rp150.000 - Rp400.000'},
        {name:'Set skincare', category:'Beauty & skincare', est:'Rp180.000 - Rp500.000'},
        {name:'Lampu meja LED', category:'Home living', est:'Rp60.000 - Rp150.000'},
        {name:'Casing HP', category:'Aksesori', est:'Rp30.000 - Rp100.000'}
      ]
    });
  }

  if (pathname === '/api/estimate' && req.method === 'GET') {
    const dest = String(parsed.query.dest || '').trim();
    const method = String(parsed.query.method || 'Sea').trim();
    const weight = Number(parsed.query.weight || 0);
    const volume = Number(parsed.query.volume || 0);
    const rateMap = {Sea:{base:40000,perKg:4000,perM3:150000},Air:{base:80000,perKg:9000,perM3:350000},Express:{base:120000,perKg:15000,perM3:600000}};
    const r = rateMap[method] || rateMap.Sea;
    const est = r.base + (weight * r.perKg) + (volume * r.perM3);
    return sendJson(res, 200, { dest, method, weight, volume, estimated: Math.round(est), currency:'IDR' });
  }

  if (pathname === "/api/chat") {
    if (req.method === "POST") {
      const chatRaw = await new Promise(resolve => { let d=''; req.on('data',c=>d+=c); req.on('end',()=>resolve(d)); }).catch(()=>'');
      const chatBody = chatRaw ? JSON.parse(chatRaw) : {};
      const message = String(chatBody.message || "").trim();

      if (!message) return sendJson(res, 400, { error: 'message required' });
      const lower = message.toLowerCase();
      let reply = null;
      if (lower.includes('ongkir') || lower.includes('estimasi') || lower.includes('harga')) reply = 'Estimasi ongkir bisa dicek di tab Estimasi. Harga barang tergantung supplier China. Mau saya hubungkan ke CS? https://wa.me/6285161593848';
      else if (lower.includes('order') || lower.includes('pesan') || lower.includes('mau beli')) reply = 'Oke, saya bantu catat permintaan ordermu. Kirim detail barang + quantity ya. Setelah itu saya lanjut ke CS untuk konfirmasi.';
      else if (lower.includes('status') || lower.includes('lacak') || lower.includes('cek')) reply = 'Cek status order kamu lewat tab Tracker dengan Order ID atau nomor WA. Atau kirim ke saya, saya cek.';
      else if (lower.includes('halo') || lower.includes('hai') || lower.includes('info')) reply = 'Halo! Saya asisten Titiport. Kami jual titip barang dari China. Estimasi ongkir ada di website, atau tanya apa saja di sini.';
      else reply = 'Terima kasih sudah menanyakan. Bisa lebih spesifik? Misal estimasi ongkir, order, atau status. Atau langsung WA CS: https://wa.me/6285161593848';
      return sendJson(res, 200, { reply });
    }
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  if (pathname.startsWith('/api/admin/')) {
    const ADMIN_PASS = process.env.ADMIN_PASS || 'titiport123';
    if (pathname === '/api/admin/login' && req.method === 'POST') {
      
      if (body.password === ADMIN_PASS) return sendJson(res, 200, { ok: true, role: 'admin' });
      return sendJson(res, 401, { error: 'invalid' });
    }
    if (pathname === '/api/admin/orders' && req.method === 'GET') {
      const { data: orders, error: oErr } = await supabase.from('orders').select('*').order('order_id', { ascending: true });
      if (oErr) return sendJson(res, 500, { error: oErr.message });
      const { data: trips, error: tErr } = await supabase.from('trips').select('*');
      if (tErr) return sendJson(res, 500, { error: tErr.message });
      const tripFilter = parsed.query.trip;
      let filtered = orders || [];
      if (tripFilter) filtered = filtered.filter(o => String(o.trip_id) === String(tripFilter));
      return sendJson(res, 200, { orders: filtered, trips: trips || [] });
    }
    if (pathname === '/api/admin/orders' && req.method === 'POST') {
      
      const order_id = String(body.order_id || Date.now());
      const { data: order, error } = await supabase.from('orders').insert({
        order_id, trip_id: Number(body.trip_id || 1), customer_name: String(body.customer_name || ''), customer_wa: String(body.customer_wa || ''), item_desc: String(body.item_desc || ''),
        cny_subtotal: Number(body.cny_subtotal || 0), weight_kg: Number(body.weight_kg || 0), volume_cbm: Number(body.volume_cbm || 0), shipping_method: String(body.shipping_method || ''),
        fee_rate: Number(body.fee_rate || 0.08), fee_rp: Number(body.fee_rp || 0), barang_rp: Number(body.barang_rp || 0), ongkir_rp: Number(body.ongkir_rp || 0), total_rp: Number(body.total_rp || 0),
        status: String(body.status || 'menunggu'), created_at: body.created_at || new Date().toISOString(), invoice_no: String(body.invoice_no || ''), paid_at: body.paid_at || null, notes: String(body.notes || '')
      }).select().single();
      if (error) return sendJson(res, 500, { error: error.message });
      return sendJson(res, 200, { ok: true, order });
    }
  }

  return sendJson(res, 404, { error: 'not_found' });
};
