const fs = require('fs');
const path = require('path');
module.exports = async (req, res) => {
  const p = path.join(process.cwd(), 'data.json');
  let exists = false;
  let content = null;
  try { exists = fs.existsSync(p); content = exists ? fs.readFileSync(p, 'utf8').slice(0, 200) : null; } catch (e) {}
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify({ cwd: process.cwd(), path: p, exists, content }));
};
