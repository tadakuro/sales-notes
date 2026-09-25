/* Cashier POS frontend — proper UI logic */
let cart = []; // {barcode,id,name,price,qty,stock}
let settings = { shop_name: 'My Store', currency: 'Rp', low_stock_at: '5' };
let gridProducts = [];
let currentUser = null; // {id, username, display_name}
const $ = id => document.getElementById(id);
const isIDR = () => ['rp', 'rp.', 'idr', 'rupiah'].includes(String(settings.currency || 'Rp').trim().toLowerCase());
const fmtID = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
const money = n => isIDR() ? fmtID(n) : (settings.currency || 'Rp') + ' ' + Number(n || 0).toFixed(2);
const cashierName = () => (currentUser && (currentUser.display_name || currentUser.username)) || 'CSR';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const lowAt = () => Number(settings.low_stock_at || 5);

async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers);
  const tok = localStorage.getItem('pos_token');
  if (tok && !opts.headers['Authorization']) opts.headers['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(path, opts);
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch (e) { j = { error: t }; }
  if (r.status === 401 && !path.startsWith('/api/login') && !path.startsWith('/api/register')) {
    // session expired -> force login (but don't loop on /api/me during boot)
    if (path !== '/api/me') showAuth('Session expired — please login again.');
  }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

function toast(msg, type = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 320); }, ms);
}

// ---------- clock ----------
function tickClock() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('todayLabel').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
setInterval(tickClock, 10000); tickClock();

// ---------- tabs (header nav only; auth tabs handled separately) ----------
document.querySelectorAll('nav.tabs .tab[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav.tabs .tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tabpage').forEach(s => s.classList.add('hidden'));
  $('tab-' + b.dataset.tab).classList.remove('hidden');
  if (b.dataset.tab === 'products') loadProductsTable();
  if (b.dataset.tab === 'sales') todaySales();
  if (b.dataset.tab === 'pos') setTimeout(() => $('barcode').focus(), 50);
}));

// ---------- auth: login / register, cashier = login name (default CSR) ----------
function authErr(m) {
  const e = $('authErr');
  if (!m) { e.classList.add('hidden'); e.textContent = ''; return; }
  e.textContent = m; e.classList.remove('hidden');
}
function showAuth(msg) {
  $('authScreen').classList.remove('hidden');
  if (msg) authErr(msg);
}
function hideAuth() { $('authScreen').classList.add('hidden'); authErr(null); }
function setUser(u, tok) {
  currentUser = u || null;
  if (tok) localStorage.setItem('pos_token', tok);
  if (u) localStorage.setItem('pos_user', JSON.stringify(u));
  $('userName').textContent = cashierName();
  const cn = $('cashierName'); if (cn) cn.textContent = cashierName();
}
function bindAuth() {
  $('authTabLogin').addEventListener('click', () => {
    $('authTabLogin').classList.add('active'); $('authTabRegister').classList.remove('active');
    $('authLoginPane').classList.remove('hidden'); $('authRegPane').classList.add('hidden'); authErr(null);
  });
  $('authTabRegister').addEventListener('click', () => {
    $('authTabRegister').classList.add('active'); $('authTabLogin').classList.remove('active');
    $('authRegPane').classList.remove('hidden'); $('authLoginPane').classList.add('hidden'); authErr(null);
  });
  $('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('regConfirm').addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });
  $('btnLogin').addEventListener('click', doLogin);
  $('btnRegister').addEventListener('click', doRegister);
  $('btnLogout').addEventListener('click', doLogout);
}
async function doLogin() {
  const username = $('loginUser').value.trim();
  const password = $('loginPass').value;
  if (!username || !password) { authErr('Enter username + password.'); return; }
  $('btnLogin').disabled = true;
  try {
    const j = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }) });
    setUser({ id: j.id, username: j.username, display_name: j.display_name }, j.token);
    $('loginPass').value = '';
    hideAuth(); await afterLogin();
    toast('Welcome, ' + cashierName(), 'ok');
  } catch (e) { authErr('Login failed: ' + e.message); }
  $('btnLogin').disabled = false;
}
async function doRegister() {
  const username = $('regUser').value.trim();
  const display_name = $('regDisplay').value.trim() || username;
  const password = $('regPass').value;
  const confirm = $('regConfirm').value;
  if (!username) { authErr('Username required.'); return; }
  if (password.length < 4) { authErr('Password min. 4 chars.'); return; }
  if (password !== confirm) { authErr('Passwords do not match — retype confirmation.'); $('regConfirm').focus(); return; }
  $('btnRegister').disabled = true;
  try {
    const j = await api('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, display_name, password, confirm }) });
    setUser({ id: j.id, username: j.username, display_name: j.display_name }, j.token);
    $('regPass').value = ''; $('regConfirm').value = '';
    hideAuth(); await afterLogin();
    toast('Registered + logged in as ' + cashierName(), 'ok');
  } catch (e) { authErr('Register failed: ' + e.message); }
  $('btnRegister').disabled = false;
}
async function doLogout() {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  localStorage.removeItem('pos_token'); localStorage.removeItem('pos_user');
  currentUser = null; cart = [];
  setUser({ username: 'CSR', display_name: 'CSR' }, null);
  localStorage.removeItem('pos_token');
  renderCart(); showAuth();
}
async function afterLogin() {
  await loadSettings(); // refreshes cashier label
  setUser(currentUser, null);
  await Promise.all([loadStats(), loadGridProducts(), loadProductsTable()]);
  todaySales(); renderCart();
  setTimeout(() => $('barcode').focus(), 60);
}

// ---------- settings / stats ----------
async function loadSettings() {
  try { Object.assign(settings, await api('/api/settings')); } catch (e) {}
  $('shopTitle').textContent = settings.shop_name || 'Cashier POS';
  $('authShopName').textContent = settings.shop_name || 'Cashier POS';
  document.title = (settings.shop_name || 'Cashier POS') + ' — POS';
  $('sShop').value = settings.shop_name || '';
  $('sCur').value = settings.currency || 'Rp';
  $('sLow').value = settings.low_stock_at || '5';
  $('userName').textContent = cashierName();
  const cn = $('cashierName'); if (cn) cn.textContent = cashierName();
  renderCart();
}
async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('stTotal').textContent = money(s.today_total);
    $('stCount').textContent = s.today_count;
    $('stLow').textContent = s.low_stock;
    $('stProducts').textContent = s.products;
  } catch (e) {}
}

// ---------- POS grid ----------
let searchDeb = null;
function bindPOS() {
  $('barcode').addEventListener('keydown', e => { if (e.key === 'Enter') lookupBarcode(); });
  $('btnAddBarcode').addEventListener('click', lookupBarcode);
  $('search').addEventListener('input', () => { clearTimeout(searchDeb); searchDeb = setTimeout(renderGrid, 180); });
  $('btnClearSearch').addEventListener('click', () => { $('search').value = ''; renderGrid(); $('search').focus(); });
  $('catFilter').addEventListener('change', renderGrid);
  $('hideOOS').addEventListener('change', renderGrid);
  $('btnRefreshGrid').addEventListener('click', async () => { await loadGridProducts(); toast('Products refreshed', 'ok'); });
  $('btnNewFromGrid').addEventListener('click', () => openProductModal({ barcode: $('search').value.trim() }));
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'SELECT') {
      e.preventDefault(); $('search').focus();
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); checkout(); }
  });
}

async function loadGridProducts() {
  try {
    gridProducts = await api('/api/products?q=');
    const cats = [...new Set(gridProducts.map(p => (p.category || '').trim()).filter(Boolean))].sort();
    const sel = $('catFilter').value;
    $('catFilter').innerHTML = '<option value="">All categories</option>' + cats.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    if (cats.includes(sel)) $('catFilter').value = sel;
    renderGrid();
  } catch (e) { toast('Failed to load products: ' + e.message, 'err'); }
}

function stockClass(p) {
  if (p.stock <= 0) return 'out';
  if (p.stock <= lowAt()) return 'low';
  return 'ok';
}
function stockLabel(p) {
  if (p.stock <= 0) return 'Out of stock';
  if (p.stock <= lowAt()) return `Low · ${p.stock}`;
  return `In stock · ${p.stock}`;
}

function renderGrid() {
  const q = $('search').value.trim().toLowerCase();
  const cat = $('catFilter').value;
  const hideOOS = $('hideOOS').checked;
  let list = gridProducts;
  if (cat) list = list.filter(p => (p.category || '') === cat);
  if (q) list = list.filter(p => (p.name || '').toLowerCase().includes(q) || (p.barcode || '').toLowerCase().includes(q) || (p.category || '').toLowerCase().includes(q));
  if (hideOOS) list = list.filter(p => p.stock > 0);
  list = [...list].sort((a, b) => (a.stock <= 0 ? 1 : 0) - (b.stock <= 0 ? 1 : 0) || String(a.name).localeCompare(String(b.name)));

  $('gridCount').textContent = list.length + ' item' + (list.length === 1 ? '' : 's');
  const g = $('productGrid'); g.innerHTML = '';
  $('gridEmpty').classList.toggle('hidden', list.length > 0);
  list.slice(0, 300).forEach(p => {
    const d = document.createElement('div');
    d.className = 'pcard' + (p.stock <= 0 ? ' oos' : '');
    d.innerHTML = `
      <span class="pcat">${esc(p.category || 'General')}</span>
      <div class="pname">${esc(p.name)}</div>
      <div class="pmeta"><span class="price">${esc(money(p.price))}</span><span class="stock-pill ${stockClass(p)}">${esc(stockLabel(p))}</span></div>
      <button class="btn ${p.stock <= 0 ? 'ghost' : 'primary'} small addbtn" ${p.stock <= 0 ? 'disabled' : ''}>${p.stock <= 0 ? 'Out of stock' : '+ Add'}</button>`;
    d.addEventListener('click', () => addToCart(p));
    g.appendChild(d);
  });
}

async function lookupBarcode() {
  const code = $('barcode').value.trim();
  if (!code) return;
  try {
    const p = await api('/api/product/' + encodeURIComponent(code));
    addToCart(p);
    toast(p.name + ' added', 'ok', 1400);
    $('barcode').value = ''; $('barcode').focus();
  } catch (e) {
    // unknown barcode -> offer to create
    openProductModal({ barcode: code });
    toast('New barcode — create the product', 'info');
  }
  loadStats();
}

// ---------- cart ----------
function cartTotal() { return cart.reduce((a, c) => a + c.price * c.qty, 0); }

function addToCart(p) {
  const f = cart.find(c => String(c.barcode) === String(p.barcode));
  const stock = Number(p.stock ?? 99);
  if (f) {
    if (f.qty + 1 > stock) { toast(`Only ${stock} in stock: ${p.name}`, 'err'); return; }
    f.qty++;
  } else {
    if (stock < 1) { toast('Out of stock: ' + p.name, 'err'); return; }
    cart.push({ barcode: p.barcode, id: p.id, name: p.name, price: Number(p.price), qty: 1, stock });
  }
  renderCart();
}

function renderCart() {
  const box = $('cartItems'); box.innerHTML = '';
  if (!cart.length) {
    box.innerHTML = '<div class="cart-empty">🛒 Cart is empty<br><small>Scan a barcode or tap a product to start.</small></div>';
  }
  cart.forEach((c, i) => {
    const sub = c.price * c.qty;
    const d = document.createElement('div');
    d.className = 'citem';
    d.innerHTML = `
      <div><div class="cname">${esc(c.name)}</div><div class="cbar">${esc(c.barcode || '')} · ${esc(money(c.price))}</div></div>
      <div class="csub">${esc(money(sub))}</div>
      <div class="qtyctl">
        <button data-a="dec" title="-1">−</button><span class="q">${c.qty}</span><button data-a="inc" title="+1">+</button>
        <button class="rm" data-a="rm">Remove</button>
      </div>`;
    d.querySelector('[data-a="dec"]').addEventListener('click', () => { c.qty--; if (c.qty <= 0) cart.splice(i, 1); renderCart(); });
    d.querySelector('[data-a="inc"]').addEventListener('click', () => {
      const live = gridProducts.find(p => String(p.barcode) === String(c.barcode));
      const max = live ? Number(live.stock) : c.stock;
      if (c.qty + 1 > max) { toast(`Only ${max} in stock`, 'err'); return; }
      c.qty++; renderCart();
    });
    d.querySelector('[data-a="rm"]').addEventListener('click', () => { cart.splice(i, 1); renderCart(); });
    box.appendChild(d);
  });
  const total = cartTotal();
  const n = cart.reduce((a, c) => a + c.qty, 0);
  $('cartMeta').textContent = n + ' item' + (n === 1 ? '' : 's') + ' · ' + cart.length + ' line' + (cart.length === 1 ? '' : 's');
  $('cartSubtotal').textContent = money(total);
  $('cartTotal').textContent = money(total);
  const pay = Number($('payment').value || 0);
  $('changeAmt').textContent = money(Math.max(0, pay - total));
  $('btnCheckout').disabled = !cart.length;
}

function bindCart() {
  $('payment').addEventListener('input', renderCart);
  document.querySelectorAll('[data-pay]').forEach(b => b.addEventListener('click', () => {
    const t = Math.round(cartTotal());
    if (b.dataset.pay === 'exact') $('payment').value = String(t);
    else $('payment').value = String(Number(b.dataset.pay)); // IDR tender: 50 … 100.000
    renderCart(); $('payment').focus();
  }));
  $('btnClearCart').addEventListener('click', clearCart);
  $('btnCheckout').addEventListener('click', checkout);
}

function clearCart() { cart = []; $('payment').value = ''; renderCart(); }

async function checkout() {
  if (!cart.length) { toast('Cart is empty', 'err'); return; }
  const total = cartTotal();
  const pay = Number($('payment').value || 0);
  if (pay < total) { toast('Payment short. Total ' + money(total), 'err'); $('payment').focus(); return; }
  $('btnCheckout').disabled = true; $('btnCheckout').textContent = 'Processing...';
  try {
    const s = await api('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart.map(c => ({ barcode: c.barcode, id: c.id, qty: c.qty })), payment: pay, cashier: cashierName() }) });
    showReceipt(s);
    clearCart();
    await Promise.all([loadStats(), loadGridProducts()]);
    toast('Sale #' + s.id + ' completed', 'ok');
  } catch (e) { toast('Checkout failed: ' + e.message, 'err'); }
  $('btnCheckout').disabled = false; $('btnCheckout').textContent = '⚡ Charge · Print receipt';
}

function showReceipt(s) {
  $('rId').textContent = '#' + s.id;
  const w = 30;
  const line = '-'.repeat(w);
  let t = `*** ${settings.shop_name} ***\n${s.datetime}\nCashier: ${s.cashier || '-'}\nSale #${s.id}\n${line}\n`;
  s.items.forEach(i => {
    t += `${i.name}\n  ${i.qty} x ${money(i.price)} = ${money(i.subtotal)}\n`;
  });
  t += `${line}\nTOTAL : ${money(s.total)}\nCASH  : ${money(s.payment)}\nCHANGE: ${money(s.change)}\n${line}\nThank you! Come again.`;
  $('rBody').textContent = t;
  $('receiptModal').classList.remove('hidden');
}
function bindReceipt() {
  const close = () => $('receiptModal').classList.add('hidden');
  $('btnCloseReceipt').addEventListener('click', close);
  $('btnCloseReceipt2').addEventListener('click', close);
  $('btnNewSale').addEventListener('click', () => { close(); $('barcode').focus(); });
  $('btnPrint').addEventListener('click', () => window.print());
  $('receiptModal').addEventListener('click', e => { if (e.target.id === 'receiptModal') close(); });
}

// ---------- products table ----------
function bindProducts() {
  $('pSearch').addEventListener('input', () => { clearTimeout(searchDeb); searchDeb = setTimeout(loadProductsTable, 200); });
  $('onlyLow').addEventListener('change', loadProductsTable);
  $('btnNewProduct').addEventListener('click', () => openProductModal());
}

async function loadProductsTable() {
  const q = $('pSearch').value || '';
  let list = [];
  try { list = await api('/api/products?q=' + encodeURIComponent(q)); }
  catch (e) { toast('Failed to load: ' + e.message, 'err'); return; }
  if ($('onlyLow').checked) list = list.filter(p => p.stock <= lowAt());
  // refresh grid cache too
  if (!q && !$('onlyLow').checked) { gridProducts = list; renderGrid(); }
  const tb = $('prodTable').querySelector('tbody'); tb.innerHTML = '';
  if (!list.length) { tb.innerHTML = '<tr><td colspan="7" class="muted center">No products found.</td></tr>'; return; }
  list.forEach(p => {
    const badge = p.stock <= 0 ? 'red' : (p.stock <= lowAt() ? 'amber' : 'green');
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="pname-cell"><b>${esc(p.name)}</b><small>margin: ${esc(money(p.price - (p.cost || 0)))}</small></td>
      <td><code>${esc(p.barcode)}</code></td><td>${esc(p.category || '—')}</td>
      <td><b>${esc(money(p.price))}</b></td><td class="muted">${esc(money(p.cost || 0))}</td>
      <td><span class="badge ${badge}">${p.stock}${p.stock <= lowAt() ? ' ⚠' : ''}</span></td>
      <td class="row-actions"></td>`;
    const td = tr.lastElementChild;
    const bE = document.createElement('button'); bE.className = 'btn small'; bE.textContent = 'Edit';
    bE.addEventListener('click', () => openProductModal(p));
    const bS = document.createElement('button'); bS.className = 'btn small ghost'; bS.textContent = '±Stock';
    bS.addEventListener('click', () => adjStock(p.id, p.name));
    const bD = document.createElement('button'); bD.className = 'btn small ghost'; bD.textContent = 'Del';
    bD.addEventListener('click', () => delProduct(p.id, p.name));
    td.append(bE, ' ', bS, ' ', bD);
    tb.appendChild(tr);
  });
}

// ---------- product modal ----------
function openProductModal(p) {
  $('pmId').value = (p && p.id) || '';
  $('pmTitle').textContent = (p && p.id) ? 'Edit product' : 'New product';
  $('pmBarcode').value = (p && p.barcode) || '';
  $('pmName').value = (p && p.name) || '';
  $('pmPrice').value = (p && p.price) ?? 0;
  $('pmCost').value = (p && p.cost) ?? 0;
  $('pmStock').value = (p && p.stock) ?? 0;
  $('pmCategory').value = (p && p.category) || '';
  $('pModal').classList.remove('hidden');
  setTimeout(() => ((p && p.id) ? $('pmName') : ($('pmBarcode').value ? $('pmName') : $('pmBarcode'))).focus(), 50);
}
function closeProductModal() { $('pModal').classList.add('hidden'); }
function bindProductModal() {
  $('btnCloseModal').addEventListener('click', closeProductModal);
  $('btnCancelModal').addEventListener('click', closeProductModal);
  $('pModal').addEventListener('click', e => { if (e.target.id === 'pModal') closeProductModal(); });
  $('btnSaveProduct').addEventListener('click', saveProduct);
}
async function saveProduct() {
  const id = $('pmId').value;
  const data = { barcode: $('pmBarcode').value.trim(), name: $('pmName').value.trim(), price: Number($('pmPrice').value || 0), cost: Number($('pmCost').value || 0), stock: Number($('pmStock').value || 0), category: $('pmCategory').value.trim() };
  if (!data.name) { toast('Name is required', 'err'); $('pmName').focus(); return; }
  try {
    let saved;
    if (id) saved = await api('/api/products/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    else saved = await api('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    closeProductModal();
    await Promise.all([loadProductsTable(), loadGridProducts(), loadStats()]);
    toast('Saved: ' + saved.name, 'ok');
    // if we just created from an unknown barcode, add straight to cart
    if (!id && saved && saved.stock > 0 && !document.getElementById('tab-pos').classList.contains('hidden')) {
      // don't auto-add unless barcode box had it — keep simple: focus scanner
      $('barcode').value = ''; $('barcode').focus();
    }
  } catch (e) { toast('Save failed: ' + e.message, 'err'); }
}
async function adjStock(id, name) {
  const v = prompt(`Stock change for "${name}"\n(e.g. +10 delivery, -2 damaged):`, '+10');
  if (v === null) return;
  const n = Number(v);
  if (!Number.isFinite(n) || n === 0) { toast('Enter a non-zero number', 'err'); return; }
  try {
    await api('/api/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, qty_change: n }) });
    await Promise.all([loadProductsTable(), loadGridProducts(), loadStats()]);
    toast('Stock updated', 'ok');
  } catch (e) { toast('Failed: ' + e.message, 'err'); }
}
async function delProduct(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await api('/api/products/' + id, { method: 'DELETE' });
    await Promise.all([loadProductsTable(), loadGridProducts(), loadStats()]);
    toast('Deleted', 'ok');
  } catch (e) { toast('Delete failed: ' + e.message, 'err'); }
}

// ---------- sales ----------
function bindSales() {
  $('btnLoadSales').addEventListener('click', loadSales);
  $('btnTodaySales').addEventListener('click', todaySales);
}
function todaySales() { $('salesDate').value = new Date().toISOString().slice(0, 10); loadSales(); }
async function loadSales() {
  const d = $('salesDate').value;
  let j;
  try { j = await api('/api/sales?date=' + encodeURIComponent(d || '')); }
  catch (e) { toast('Failed to load sales: ' + e.message, 'err'); return; }
  $('salesTotal').textContent = money(j.total);
  $('salesCount').textContent = j.count;
  $('salesAvg').textContent = money(j.count ? j.total / j.count : 0);
  $('salesDateLabel').textContent = d || 'All time';
  const tb = $('salesTable').querySelector('tbody'); tb.innerHTML = '';
  if (!j.sales.length) { tb.innerHTML = '<tr><td colspan="7" class="muted center">No sales for this period.</td></tr>'; return; }
  j.sales.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><b>#${s.id}</b></td><td>${esc(s.datetime)}</td><td>${esc(s.cashier || '—')}</td>
      <td>${s.item_count}</td><td><b>${esc(money(s.total))}</b></td><td class="muted">${esc(money(s.payment))}</td><td class="row-actions"></td>`;
    const td = tr.lastElementChild;
    const bR = document.createElement('button'); bR.className = 'btn small'; bR.textContent = '🧾 Receipt';
    bR.addEventListener('click', async () => { try { showReceipt(await api('/api/sales/' + s.id)); } catch (e) { toast(e.message, 'err'); } });
    const bD = document.createElement('button'); bD.className = 'btn small ghost'; bD.textContent = 'Void';
    bD.addEventListener('click', async () => {
      if (!confirm(`Void sale #${s.id} (${money(s.total)})? Stock is NOT restored.`)) return;
      try { await api('/api/sales/' + s.id, { method: 'DELETE' }); toast('Sale voided', 'ok'); loadSales(); loadStats(); }
      catch (e) { toast(e.message, 'err'); }
    });
    td.append(bR, ' ', bD);
    tb.appendChild(tr);
  });
}

// ---------- settings / sync ----------
function bindSettings() {
  $('btnSaveSettings').addEventListener('click', saveSettings);
  $('btnExport').addEventListener('click', exportDB);
  $('btnImport').addEventListener('click', importDB);
}
async function saveSettings() {
  try {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_name: $('sShop').value, currency: $('sCur').value, low_stock_at: $('sLow').value }) });
    await loadSettings(); await loadStats(); toast('Settings saved', 'ok');
  } catch (e) { toast('Save failed: ' + e.message, 'err'); }
}
async function exportDB() {
  try {
    const j = await api('/api/export');
    const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pos-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup downloaded', 'ok');
  } catch (e) { toast('Export failed: ' + e.message, 'err'); }
}
async function importDB() {
  const f = $('importFile').files[0];
  if (!f) { toast('Choose a JSON backup file first', 'err'); return; }
  let j;
  try { j = JSON.parse(await f.text()); } catch (e) { toast('Invalid JSON file', 'err'); return; }
  if (!j.products) { toast('Bad backup file', 'err'); return; }
  const ow = confirm('OK = replace duplicates with imported data\nCancel = keep existing, only add new barcodes');
  try {
    const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: j.products, overwrite: ow }) });
    toast('Imported ' + r.imported + ' products', 'ok');
    await Promise.all([loadProductsTable(), loadGridProducts(), loadStats()]);
  } catch (e) { toast('Import failed: ' + e.message, 'err'); }
}

// ---------- legacy globals ----------
window.lookupBarcode = lookupBarcode; window.checkout = checkout; window.clearCart = clearCart;
window.quickCash = () => { $('payment').value = String(Math.round(cartTotal())); renderCart(); };
window.openProductModal = openProductModal; window.closeProductModal = closeProductModal;
window.saveProduct = saveProduct; window.loadProducts = loadProductsTable; window.loadSales = loadSales;
window.todaySales = todaySales; window.saveSettings = saveSettings; window.exportDB = exportDB; window.importDB = importDB;
window.doLogin = doLogin; window.doRegister = doRegister; window.doLogout = doLogout;

// ---------- init ----------
bindPOS(); bindCart(); bindReceipt(); bindProducts(); bindProductModal(); bindSales(); bindSettings(); bindAuth();
(async () => {
  // restore session if token saved, else show login gate (default CSR hint)
  const savedTok = localStorage.getItem('pos_token');
  if (savedTok) {
    try {
      const me = await api('/api/me');
      setUser(me, null); hideAuth();
    } catch (e) { showAuth(); }
  } else {
    setUser({ username: 'CSR', display_name: 'CSR' }, null);
    localStorage.removeItem('pos_token');
    showAuth();
  }
  await loadSettings();
  await Promise.all([loadStats(), loadGridProducts(), loadProductsTable()]);
  todaySales();
  renderCart();
  if (currentUser && localStorage.getItem('pos_token')) $('barcode').focus();
  else $('loginUser').focus();
})();
