const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(process.cwd(), 'data.json');

function readData() {
  try { return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8')); }
  catch (e) { return { orders: [] }; }
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const { q } = req.query;
  const data = readData();
  const order = (data.orders || []).find(o => String(o.order_id) === String(q) || String(o.customer_wa).includes(String(q)));
  res.status(200).json(order ? { order } : { error: 'not_found' });
};
