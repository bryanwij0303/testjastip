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
  const navs = document.querySelectorAll('#mainNav a');
  const map={home:'homeCard',track:'trackCard',chat:'chatCard',products:'productsCard',orders:'ordersCard'};
  cards.forEach(el=>el.classList.add('hidden'));
  if(map[t] && document.getElementById(map[t])) document.getElementById(map[t]).classList.remove('hidden');
  if(t==='home'){document.getElementById('homeCard')?.classList.remove('hidden');} else {document.getElementById('homeCard')?.classList.add('hidden');}
  navs.forEach(a=>a.classList.remove('act'));
  const navMap={home:0,track:1,chat:2,products:3,orders:4};
  if(navs[navMap[t]]) navs[navMap[t]].classList.add('act');
  if(t==='home') renderDashboard();
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
  out.innerHTML = `Estimasi ongkir ke <b>${dest}</b> (${method}): <b>Rp ${Math.round(est).toLocaleString('id-ID')}</b><br><span class="muted">Harga bisa naik/turun. Hubungi CS via WA untuk harga pasti.</span>`;
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
    const reply = j.reply || 'Maaf, saya sedang gangguan. Bisa hubungi CS: https://wa.me/6285161593848';
    chatHistory.push({role:'assistant',content:reply});
    renderChat();
  } catch (e) {
    chatHistory.push({role:'assistant',content:'Sistem sedang gangguan, coba lagi sebentar.'});
    renderChat();
  }
}
function renderChat(){
  const box = document.getElementById('chatBox');
  box.innerHTML = chatHistory.map(m=>`<div style="margin:6px 0;padding:8px;border-radius:10px;background:${m.role==='user'?'var(--accent)':'var(--bg-3)'};color:${m.role==='user'?'#fff':'var(--text)'};align-self:${m.role==='user'?'flex-end':'flex-start'}">${escapeHtml(m.content)}</div>`).join('');
  box.scrollTop = box.scrollHeight;
}
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

const PRODUCTS = [
  {category:'Fashion',items:[{name:'Jaket kulit',est:'Rp250.000 - Rp800.000'},{name:'Sepatu sneakers',est:'Rp200.000 - Rp600.000'},{name:'Tas selempang',est:'Rp120.000 - Rp300.000'}]},
  {category:'Elektronik',items:[{name:'Power bank 20k',est:'Rp80.000 - Rp150.000'},{name:'Headphone BT',est:'Rp150.000 - Rp400.000'}]},
  {category:'Beauty',items:[{name:'Set skincare',est:'Rp180.000 - Rp500.000'}]}
];
function renderProducts(){
  const chips = document.getElementById('productChips');
  const list = document.getElementById('productsGrid');
  chips.innerHTML = PRODUCTS.map((p,i)=>`<button class="chip ${i===0?'act':''}" onclick="showProduct(${i})">${p.category}</button>`).join('');
  if(PRODUCTS[0]) showProduct(0);
}
function showProduct(idx){
  const p = PRODUCTS[idx];
  const list = document.getElementById('productsGrid');
  list.innerHTML = p.items.map(it=>`<div style="padding:10px;border:1px solid var(--border);border-radius:12px;margin:8px 0;background:var(--bg-2)"><div style="font-weight:700">${it.name}</div><div class="muted">Estimasi: ${it.est}</div></div>`).join('');
}

async function renderDashboard(){
  const j = await fetchData();
  const orders = j.orders || [];
  document.getElementById('kpiOrders').textContent = orders.length;
  document.getElementById('kpiRevenue').textContent = fmt(orders.reduce((a,b)=>a+Number(b.total_rp||0),0));
  document.getElementById('kpiCost').textContent = fmt(orders.reduce((a,b)=>a+Number(b.barang_rp||0),0));
  document.getElementById('kpiOut').textContent = orders.filter(o=>o.status==='menunggu').length;
  renderTop(orders);
}

function renderTop(orders){
  const m={};
  orders.forEach(o=>{const k=o.customer_name||'?'; m[k]=(m[k]||0)+1;});
  const arr=Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const tb=document.getElementById('topCustomers');
  if(!arr.length){ tb.innerHTML='<tr><td colspan="2" class="muted">Belum ada data</td></tr>'; return; }
  tb.innerHTML=arr.map(([k,v])=>`<tr><td>${k}</td><td style="text-align:right;font-weight:700">${v}</td></tr>`).join('');
}

function renderOrders(){
  const j = await fetchData();
  const orders = j.orders || [];
  const filtered = filterStatus ? orders.filter(o=>o.status===filterStatus) : orders;
  const tb = document.getElementById('ordersTable');
  if(!filtered.length){ tb.innerHTML='<tr><td colspan="6" class="muted">Belum ada orders</td></tr>'; return; }
  tb.innerHTML=filtered.slice(0,25).map(o=>`
    <tr>
      <td>${o.order_id}</td>
      <td>${o.customer_name||''}</td>
      <td><a class="link" href="https://wa.me/${String(o.customer_wa||'').replace(/\D/g,'')}" target="_blank">${o.customer_wa||''}</a></td>
      <td class="num">${fmt(o.total_rp)}</td>
      <td><span class="badge ${String(o.status||'').toLowerCase()}">${o.status||'-'}</span></td>
      <td>
        ${role==='admin'?`<a class="chip act" href="/invoice.html?order_id=${o.order_id}&customer_name=${encodeURIComponent(o.customer_name||'')}&wa=${o.customer_wa}&date=${o.created_at?o.created_at.slice(0,10):''}&status=${o.status}&rate=2200&items=${encodeURIComponent(JSON.stringify([{name:o.item_desc||'Item', qty:1, price_idr: Number(o.total_rp||0)}]))}" target="_blank">Invoice</a>`:''}
      </td>
    </tr>
  `).join('');
}

async function fetchData(){
  const r=await fetch(API); return r.json();
}

function setFilter(st){filterStatus=filterStatus===st?'':st;renderFilterChips();renderOrders();}
function renderFilterChips(){
  const chips=[['Unpaid','Unpaid'],['Paid','Paid'],['DP','Partial/DP'],['Menunggu','menunggu']];
  document.getElementById('filterChips').innerHTML=chips.map(([label,val])=>
    `<button class="chip ${filterStatus===val?'act':''}" onclick="setFilter('${val}')">${label}</button>`
  ).join('');
}

async function createOrder(){
  const body={
    trip_id: document.getElementById('fTrip').value||'1',
    customer_name: document.getElementById('fName').value,
    customer_wa: document.getElementById('fWa').value,
    item_desc: document.getElementById('fNotes').value,
    dp_paid_idr: Number(document.getElementById('fDp').value||0),
    status:'menunggu',
    notes: document.getElementById('fNotes').value
  };
  const r=await fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json();
  if(j.error){alert(j.error);return;}
  alert('Order tersimpan #'+j.order_id);
  document.getElementById('fName').value='';
  document.getElementById('fWa').value='';
  document.getElementById('fDp').value='';
  document.getElementById('fNotes').value='';
  renderOrders(); renderDashboard();
}

function scrollToForm(){const el=document.getElementById('fName'); el?.focus(); el?.scrollIntoView({behavior:'smooth',block:'center'});}

// init filter chips
renderFilterChips();
</script>
