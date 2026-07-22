module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.writeHead(200);
  res.end(JSON.stringify({
    adminPassSet: !!process.env.ADMIN_PASS,
    adminPassValue: process.env.ADMIN_PASS || null,
    supabaseUrlSet: !!process.env.SUPABASE_URL,
    supabaseUrlPrefix: process.env.SUPABASE_URL ? process.env.SUPABASE_URL.slice(0, 30) : null
  }));
};
