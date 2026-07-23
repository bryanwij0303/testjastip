const { createClient } = require('@supabase/supabase-js');
const https = require('https');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TWENTY_API_KEY = process.env.TWENTY_API_KEY; // Format: TwentyAPI <token>
const TWENTY_WORKSPACE_ID = process.env.TWENTY_WORKSPACE_ID || '69fbaebc-5e32-486f-8527-24ec2330c419';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_ANON_KEY');
  process.exit(1);
}
if (!TWENTY_API_KEY) {
  console.error('Missing TWENTY_API_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function twentyRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: 'api.twenty.com',
      path: `/rest/workspaces/${TWENTY_WORKSPACE_ID}${path}`,
      method,
      headers: {
        'Authorization': TWENTY_API_KEY,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      },
      timeout: 20000
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
        resolve(parsed);
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function ensurePerson(order) {
  const phone = String(order.customer_wa || '').replace(/\D/g, '');
  const name = String(order.customer_name || '').trim();
  if (!phone && !name) return null;

  const { data: existing } = await supabase.from('crm_mappings').select('*').eq('order_id', order.order_id).maybeSingle();
  if (existing?.twenty_person_id) {
    return existing.twenty_person_id;
  }

  const payload = {
    name: name || `WA ${phone}`,
    phone: phone || undefined,
    source: 'WhatsApp'
  };
  const person = await twentyRequest('POST', '/people', payload);
  const personId = person?.data?.id || person?.id;
  if (personId) {
    await supabase.from('crm_mappings').upsert({ order_id: order.order_id, twenty_person_id: personId });
  }
  return personId;
}

async function ensureOpportunity(order, personId) {
  const { data: existing } = await supabase.from('crm_mappings').select('*').eq('order_id', order.order_id).maybeSingle();
  const existingOppId = existing?.twenty_opportunity_id;

  const stageMap = {
    menunggu: 'NEW_LEAD',
    dikerjakan: 'NEGOTIATION',
    selesai: 'WON',
    batal: 'LOST'
  };
  const stage = stageMap[order.status] || 'NEW_LEAD';

  const payload = {
    name: `Order ${order.order_id}`,
    description: String(order.item_desc || ''),
    stage,
    amount: Number(order.total_rp || 0),
    currency: 'IDR',
    ...(personId ? { personId } : {}),
    ...(existingOppId ? { id: existingOppId } : {})
  };

  const method = existingOppId ? 'PATCH' : 'POST';
  const path = existingOppId ? `/opportunities/${existingOppId}` : '/opportunities';
  const opp = await twentyRequest(method, path, payload);
  const oppId = opp?.data?.id || opp?.id || existingOppId;
  if (oppId && !existingOppId) {
    await supabase.from('crm_mappings').update({ twenty_opportunity_id: oppId }).eq('order_id', order.order_id);
  }
  return oppId;
}

async function ensureNote(order, personId) {
  const notePayload = {
    title: `Pesan WA order ${order.order_id}`,
    body: order.last_wa_message ? String(order.last_wa_message) : 'Order dari WhatsApp',
    direction: 'INBOUND',
    ...(personId ? { personId } : {})
  };
  const note = await twentyRequest('POST', '/notes', notePayload);
  return note?.data?.id || note?.id;
}

async function syncOrder(order) {
  try {
    const personId = await ensurePerson(order);
    const oppId = await ensureOpportunity(order, personId);
    await ensureNote(order, personId);
    console.log(`synced order=${order.order_id} person=${personId} opp=${oppId}`);
  } catch (err) {
    console.error(`sync failed order=${order.order_id}:`, err.message);
  }
}

async function main() {
  const since = process.argv[2] || new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: orders, error } = await supabase
    .from('orders')
    .select('*')
    .gte('updated_at', since)
    .order('updated_at', { ascending: true });

  if (error) {
    console.error('Supabase fetch error:', error.message);
    process.exit(1);
  }
  if (!orders || orders.length === 0) {
    console.log('no orders changed since', since);
    return;
  }

  for (const order of orders) {
    await syncOrder(order);
  }

  console.log(`done synced=${orders.length}`);
}

main().catch((e) => {
  console.error('fatal:', e);
  process.exit(1);
});
