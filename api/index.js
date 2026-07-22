const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const url = require('url');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://npqvbrexccwxoovdrzcc.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'sb_publishable_hkSvuVQtIut8FYQDqpJ8HQ_vuw1XdEu';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function sendJson(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(status);
  res.end(JSON.stringify(data));
}

async function parseJsonBody(req) {
  const raw = await req.text().catch(() => '');
  if (!raw || !raw.trim()) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

async function loadOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('order_id', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function loadTrips() {
  const { data, error } = await supabase
    .from('trips')
    .select('*');
  if (error) throw error;
  return data || [];
}

async function upsertOrder(body) {
  const order = {
    order_id: String(body.order_id || Date.now()),
    trip_id: Number(body.trip_id || 1),
    customer_name: String(body.customer_name || ''),
    customer_wa: String(body.customer_wa || ''),
    item_desc: String(body.item_desc || ''),
    cny_subtotal: Number(body.cny_subtotal || 0),
    weight_kg: Number(body.weight_kg || 0),
    volume_cbm: Number(body.volume_cbm || 0),
    shipping_method: String(body.shipping_method || ''),
    fee_rate: Number(body.fee_rate ?? 0.08),
    fee_rp: Number(body.fee_rp || 0),
    barang_rp: Number(body.barang_rp || 0),
    ongkir_rp: Number(body.ongkir_rp || 0),
    total_rp: Number(body.total_rp || 0),
    status: String(body.status || 'menunggu'),
    invoice_no: String(body.invoice_no || ''),
    paid_at: body.paid_at || null,
    notes: String(body.notes || ''),
  };
  const { data, error } = await supabase
    .from('orders')
    .upsert(order, { onConflict: 'order_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateOrderById(id, body) {
  const { data, error } = await supabase
    .from('orders')
    .update(body)
    .eq('order_id', String(id))
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function deleteOrderById(id) {
  const { data, error } = await supabase
    .from('orders')
    .delete()
    .eq('order_id', String(id))
    .select('order_id')
    .single();
  return data;
}

async function findOrder(q) {
  const term = String(q || '').trim();
  if (!term) return null;
  const byId = await supabase
    .from('orders')
    .select('*')
    .eq('order_id', term)
    .maybeSingle();
  if (byId.error) throw byId.error;
  if (byId.data) return byId.data;
  const byWa = await supabase
    .from('orders')
    .select('*')
    .ilike('customer_wa', `%${term.replace(/\D/g, '')}%`)
    .limit(1);
  if (byWa.error) throw byWa.error;
  return byWa.data?.[0] || null;
}

async function handler(req, res) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(204).end();

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const body = await parseJsonBody(req);

  try {
    if (pathname === '/api/orders') {
      if (req.method === 'GET') {
        const orders = await loadOrders();
        const trips = await loadTrips();
        return sendJson(res, 200, { orders, trips });
      }
      if (req.method === 'POST') {
        const order = await upsertOrder(body);
        return sendJson(res, 200, { ok: true, order });
      }
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    if (pathname === '/api/tracker') {
      if (req.method === 'GET') {
        const q = String(parsed.query.q || '').trim();
        const order = await findOrder(q);
        return order ? sendJson(res, 200, { order }) : sendJson(res, 404, { error: 'not_found' });
      }
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }

    if (pathname.startsWith('/api/admin/')) {
      if (pathname === '/api/admin/login' && req.method === 'POST') {
        const ADMIN_PASS = process.env.ADMIN_PASS || 'titiport123';
        if (body.password === ADMIN_PASS) return sendJson(res, 200, { ok: true, role: 'admin' });
        return sendJson(res, 401, { error: 'invalid' });
      }
      if (pathname === '/api/admin/orders' && req.method === 'GET') {
        const orders = await loadOrders();
        const trips = await loadTrips();
        return sendJson(res, 200, { orders, trips });
      }
      if (pathname === '/api/admin/orders' && req.method === 'POST') {
        const order = await upsertOrder(body);
        return sendJson(res, 200, { ok: true, order });
      }
      if (pathname.startsWith('/api/admin/orders/') && req.method === 'PATCH') {
        const id = pathname.split('/').pop();
        const order = await updateOrderById(id, body);
        return sendJson(res, 200, { ok: true, order });
      }
      if (pathname.startsWith('/api/admin/orders/') && req.method === 'DELETE') {
        const id = pathname.split('/').pop();
        const order = await deleteOrderById(id);
        return sendJson(res, 200, { ok: true, order });
      }
      return sendJson(res, 404, { error: 'not_found' });
    }

    return sendJson(res, 404, { error: 'not_found' });
  } catch (e) {
    return sendJson(res, 500, { error: e.message || 'server_error' });
  }
}

module.exports = handler;
