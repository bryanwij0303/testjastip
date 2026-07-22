module.exports = async (req, res) => {
  const raw = await req.text().catch(() => '');
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify({ method: req.method, bodyRaw: raw, bodyParsed: (() => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } })() }));
};
