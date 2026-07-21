const fs = require('fs');
const path = require('path');
const https = require('https');

const API = process.env.VERCEL_GIT_COMMIT_AUTHOR || 'titiport-bot';
const TOKEN = process.env.GITHUB_TOKEN;
const OWNER = 'bryanwij0303';
const REPO = 'testjastip';
const BRANCH = 'main';
const DATA_PATH = path.join(process.cwd(), 'data.json');

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch (e) { return { orders: [], trips: [{ trip_id: 1, trip_name: 'China Taobao', country: 'CN', currency_code: 'CNY', rate: 2200, execution_rate: 1.0, status: 'active' }] }; }
}
function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

async function commitToGit() {
  if (!TOKEN) return false;
  const content = Buffer.from(fs.readFileSync(DATA_PATH, 'utf8')).toString('base64');
  const body = JSON.stringify({
    message: 'chore: update data.json from Vercel Function',
    content,
    branch: BRANCH,
  });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.github.com',
      path: `/repos/${OWNER}/${REPO}/contents/data.json`,
      method: 'PUT',
      headers: { 'Authorization': `token ${TOKEN}`, 'User-Agent': 'titiport-bot', 'Content-Type': 'application/json' },
    }, (res) => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => resolve(res.statusCode === 200 || res.statusCode === 201));
    });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const data = readData();

  if (req.method === 'GET') {
    return res.status(200).json(data);
  }

  if (req.method === 'POST') {
    let body = {};
    try { body = await req.json().catch(() => ({})); } catch (e) { }
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
      notes: body.notes || '',
    };

    data.orders[data.orders.length ? data.orders.length : 0] = order;
    writeData(data);
    await commitToGit();
    return res.status(200).json({ ok: true, order });
  }

  res.status(405).json({ error: 'method_not_allowed' });
};
