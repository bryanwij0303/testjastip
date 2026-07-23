const fs = require('fs');
const vm = require('vm');

const checks = [];
function assert(cond, label) { checks.push({ ok: !!cond, label }); }

assert(fs.existsSync('api/index.js'), 'api/index.js exists');
assert(fs.existsSync('debug.html'), 'debug.html exists');

const code = fs.readFileSync('api/index.js', 'utf8');
assert(code.includes('VERCEL_API_CHAT'), 'vercel chat env referenced');
assert(code.includes('RAILWAY_API_CHAT') || code.includes('profound-kindness-production-6349.up.railway.app/api/chat'), 'railway chat referenced');
assert(code.includes('reply = chatRes.body.reply') || code.includes('reply = chatRes?.body?.reply'), 'reply extraction present');
assert(code.includes('chat-fallback'), 'source chat-fallback present');
try {
  new vm.Script(code, { filename: 'api/index.js' });
  assert(true, 'api/index.js syntax valid');
} catch (e) {
  assert(false, 'api/index.js syntax valid: ' + e.message);
}

const html = fs.readFileSync('debug.html', 'utf8');
assert(html.includes('/api/chat'), 'debug.html includes /api/chat');
assert(html.includes('/api/tracker'), 'debug.html includes /api/tracker');
assert(html.includes('/api/orders'), 'debug.html includes /api/orders');

let fail = 0;
for (const c of checks) {
  if (!c.ok) fail++;
  console.log((c.ok ? 'PASS' : 'FAIL') + ' ' + c.label);
}
console.log('TOTAL ' + checks.length + ' PASS ' + (checks.length - fail) + ' FAIL ' + fail);
process.exit(fail ? 1 : 0);
