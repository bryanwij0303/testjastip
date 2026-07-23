const API = "/api/orders";
const API_TRACKER = "/api/tracker";
const API_ADMIN = "/api/admin";
let role='guest', wa='', tripId='', filterStatus='';

function fmt(n){
  if(n==null) return '-';
  const v = Number(n);
  if(!Number.isFinite(v)) return '-';
  return 'Rp ' + v.toLocaleString('id-ID');
}

function formatOrderText(order){
  if(!order) return 'Belum ada data order.';
  return [
    `Order ID: ${order.order_id||'-'}`,
    `Nama: ${order.customer_name||'-'}`,
    `Barang: ${order.item_desc||'-'}`,
    `Status: ${order.status||'-'}`,
    `Total: ${fmt(order.total_rp)}`,
    `Ongkir: ${fmt(order.ongkir_rp)}`,
    `Barang: ${fmt(order.barang_rp)}`
  ].join('\n');
}

function showTab(t){
  const cards = document.querySelectorAll('.card');
  cards.forEach(el=>el.classList.add('hidden'));
  const map={home:'homeCard',track:'trackCard',chat:'chatCard',products:'productsCard',orders:'ordersCard'};
  if(map[t] && document.getElementById(map[t])) document.getElementById(map[t]).classList.remove('hidden');
  if(t==='home') document.getElementById('homeCard')?.classList.remove('hidden');
  if(t==='orders') renderOrders();
  if(t==='products') renderProducts();
  if(t==='chat') document.getElementById('chatInput')?.focus();
}

function doLogin(){
  const key=document.getElementById('k').value.trim();
  if(!key) return alert('Isi password / WA');
  fetch(API_ADMIN+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:key})})
  .then(async r=>{ const j=await r.json(); if(!r.ok) throw j; return j; })
  .then(d=>{
    if(d.error) return alert('Login error: '+JSON.stringify(d));
    role=d.role||'guest'; wa=d.wa||''; tripId=d.tripId||'';
    if(role==='admin'){
      document.getElementById('rolePill').textContent='Admin';
      document.getElementById('adminCard').classList.remove('hidden');
      document.getElementById('ordersCard').classList.remove('hidden');
    } else {
      document.getElementById('rolePill').textContent='Tamu';
      document.getElementById('adminCard').classList.add('hidden');
      document.getElementById('ordersCard').classList.add('hidden');
    }
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('mainNav').classList.remove('hidden');
    renderDashboard(); renderOrders(); renderProducts();
  })
  .catch(e=>alert('Auth error: '+JSON.stringify(e)));
}

async function estimateShipping(){
  const dest = document.getElementById('estDestination').value;
  const method = document.getElementById('estMethod').value;
  const weight = Number(document.getElementById('estWeight').value||0);
  const volume = Number(document.getElementById('estVolume').value||0);
  const out = document.getElementById('estResult');
  if(!dest){ out.textContent='Pilih kota tujuan dulu.'; return; }
  const rateMap = {Sea:{base:40000,perKg:4000,perM3:150000},Air:{base:80000,perKg:9000,perM3:350000},Express:{base:120000,perKg:15000,perM3:600000}};
  const r = rateMap[method] || rateMap.Sea;
  const est = r.base + (weight * r.perKg) + (volume * r.perM3);
  out.innerHTML = `Estimasi ongkir ke <b>${dest}</b> (${method}): <b>Rp ${Math.round(est).toLocaleString('id-ID')}</b><br><span style="color:var(--muted);font-size:12px">Harga bisa naik/turun. Hubungi CS via WA untuk harga pasti.</span>`;
}

async function trackOrder(){
  const q = document.getElementById('trackInput').value.trim();
  const out = document.getElementById('trackResult');
  if(!q){ out.textContent='Isi Order ID / WA.'; return; }
  try {
    const r = await fetch(`${API_TRACKER}?q=${encodeURIComponent(q)}`);
    const j = await r.json();
    if(j.order){
      out.textContent = formatOrderText(j.order);
    } else {
      out.textContent = 'Order tidak ditemukan.';
    }
  } catch (e) {
    out.textContent = 'Gagal cek tracker.';
  }
}

let chatHistory = [];
async function sendChat(){
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if(!text) return;
  input.value = '';
  const box = document.getElementById('chatBox');
  chatHistory.push({role:'user',content:text});
  renderChat();
  try {
    const r = await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:text,history:chatHistory.slice(-10)})});
    const j = await r.json();
    const reply = j.reply || 'Maaf, saya sedang gangguan. Bisa hubungi CS: ';
    chatHistory.push({role:'assistant',content:reply});
    renderChat();
  } catch (e) {
    chatHistory.push({role:'assistant',content:'Sistem sedang gangguan, coba lagi sebentar.'});
    renderChat();
  }
}
function renderChat(){
  const box = document.getElementById('chatBox');
  box.innerHTML = chatHistory.map(m=>'<div style="margin:6px 0;padding:8px;border-radius:10px;background:'+(m.role==='user'?'var(--accent)':'var(--bg-3)')+';color:'+(m.role==='user'?'#fff':'var(--text)')+'">'+escapeHtml(m.content)+'</div>').join('');
  box.scrollTop = box.scrollHeight;
}
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const PRODUCTS = [
  {category:'Fashion',items:[{name:'Jaket kulit',est:'Rp250.000 - Rp800.000'},{name:'Sepatu sneakers',est:'Rp200.000 - Rp600.000'},{name:'Tas selempang',est:'Rp120.000 - Rp300.000'}]},
  {category:'Elektronik',items:[{name:'Power bank 20k',est:'Rp80.000 - Rp150.000'},{name:'Headphone BT',est:'Rp150.000 - Rp400.000'}]},
  {category:'Beauty & skincare',items:[{name:'Set skincare',est:'Rp180.000 - Rp500.000'}]}
];
function renderProducts(){
  const chips = document.getElementById('productChips');
  const list = document.getElementById('productsGrid');
  chips.innerHTML = PRODUCTS.map((p,i)=>'<button class="chip '+(i===0?'act':'')+'" onclick="showProduct('+i+')">'+p.category+'</button>').join('');
  if(PRODUCTS[0]) showProduct(0);
}
function showProduct(idx){
  const p = PRODUCTS[idx];
  const list = document.getElementById('productsGrid');
  list.innerHTML = p.items.map(it=>'<div style="padding:10px;border:1px solid var(--border);border-radius:12px;margin:8px 0;background:var(--bg-2)"><div style="font-weight:700">'+it.name+'</div><div style="color:var(--muted);font-size:12px">Estimasi: '+it.est+'</div></div>').join('');
}

async function renderDashboard(){}
async function renderOrders(){}
function renderFilterChips(){}
function createOrder(){}
function scrollToForm(){const el=document.getElementById('fName'); el?.focus(); el?.scrollIntoView({behavior:'smooth',block:'center'});}
renderFilterChips();
