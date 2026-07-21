const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(process.cwd(), 'data.json');

function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  } catch (e) {
    return { orders: [], trips: [{ trip_id: 1, trip_name: 'China Taobao', country: 'CN', currency_code: 'CNY', rate: 2200, execution_rate: 1.0, status: 'active' }] };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  return data;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const data = readData();
  res.status(200).json(data);
};
