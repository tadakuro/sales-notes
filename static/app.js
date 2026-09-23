let cart = []; // {barcode,id,name,price,qty,stock}
let settings = { shop_name: 'My Store', currency: '₱', low_stock_at: '5' };
const $ = id => document.getElementById(id);
const money = n => settings.currency + ' ' + Number(n || 0).toFixed(2);

async function api(path, opts) {
  const r = await fetch(path, opts);
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch (e) { j = { error: t }; }
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}

// tabs
document.querySelectorAll('.tab').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tabpage').forEach(s => s.classList.add('hidden'));
  $('tab-' + b.dataset.tab).classList.remove('hidden');
  if (b.dataset.tab === 'products') loadProducts();
  if (b.dataset.tab === 'sales') todaySales();
});

async function loadSettings() {
  try { settings = Object.assign(settings, await api('/api/settings')); } catch (e) {}
  $('shopTitle').textContent = settings.shop_name || 'Cashier POS';
  $('sShop').value = settings.shop_name || '';
  $('sCur').value = settings.currency || '';
  $('sLow').value = settings.low_stock_at || '5';
}
async function saveSettings() {
  await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ shop_name: $('sShop').value, currency: $('sCur').value, low_stock_at: $('sLow').value }) });
  await loadSettings(); await loadStats(); alert('Saved');
}
async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('stTotal').textContent = money(s.today_total);
    $('stCount').textContent = s.today_count;
    $('stLow').textContent = s.low_stock;
  } catch (e) {}
}

// ---- POS ----
$('barcode').addEventListener('keydown', e => { if (e.key === 'Enter') lookupBarcode(); });
$('payment').addEventListener('input', () => {
  const t = cart.reduce((a, c) => a + c.price * c.qty, 0);
  $('changeAmt').textContent = money(Math.max(0, Number($('payment').value || 0) - t));
});

async function lookupBarcode() {
  const code = $('barcode').value.trim();
  if (!code) return;
  try {
    const p = await api('/api/product/' + encodeURIComponent(code));
    addToCart(p);
    $('barcode').value = ''; $('barcode').focus();
  } catch (e) {
    // NOT FOUND -> ask user to type manually (your requirement)
    if (confirm('Barcode "' + code + '" not in database.\n\nOK = create it now (type name/price manually)')) {
      openProductModal({ barcode: code });
    }
    $('barcode').select();
  }
  await loadStats();
}
function addToCart(p) {
  const f = cart.find(c => c.barcode === p.barcode);
  if (f) { if (f.qty + 1 > p.stock) { alert('Only ' + p.stock + ' in stock: ' + p.name); return; } f.qty++; }
  else { if (p.stock < 1) { alert('Out of stock: ' + p.name); return; } cart.push({ barcode: p.barcode, id: p.id, name: p.name, price: p.price, qty: 1, stock: p.stock }); }
  renderCart();
}
function renderCart() {
  const tb = $('cartTable').querySelector('tbody'); tb.innerHTML = '';
  let total = 0;
  cart.forEach((c, i) => {
    const sub = c.price * c.qty; total += sub;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${c.name}<br><small>${c.barcode}</small></td><td>${money(c.price)}</td>
      <td><button onclick="chQty(${i},-1)">−</button> ${c.qty} <button onclick="chQty(${i},1)">+</button></td>
      <td>${money(sub)}</td><td><button onclick="rmItem(${i})">x</button></td>`;
    tb.appendChild(tr);
  });
  $('cartTotal').textContent = money(total);
  $('changeAmt').textContent = money(Math.max(0, Number($('payment').value || 0) - total));
}
function chQty(i, d) { cart[i].qty += d; if (cart[i].qty <= 0) cart.splice(i, 1); renderCart(); }
function rmItem(i) { cart.splice(i, 1); renderCart(); }
function clearCart() { cart = []; $('payment').value = ''; renderCart(); }
function quickCash() { $('payment').value = cart.reduce((a, c) => a + c.price * c.qty, 0).toFixed(2); $('payment').dispatchEvent(new Event('input')); }

async function checkout() {
  if (!cart.length) { alert('Cart is empty'); return; }
  const total = cart.reduce((a, c) => a + c.price * c.qty, 0);
  const pay = Number($('payment').value || 0);
  if (pay < total) { alert('Payment short. Total ' + money(total)); return; }
  try {
    const s = await api('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: cart.map(c => ({ barcode: c.barcode, id: c.id, qty: c.qty })), payment: pay, cashier: $('cashier').value }) });
    showReceipt(s); clearCart(); loadStats();
  } catch (e) { alert('Checkout failed: ' + e.message); }
}
function showReceipt(s) {
  $('rId').textContent = '#' + s.id;
  let lines = `*** ${settings.shop_name} ***\n${s.datetime}\nCashier: ${s.cashier || '-'}\n--------------------------\n`;
  s.items.forEach(i => { lines += `${i.name} x${i.qty}\n  ${money(i.price)} = ${money(i.subtotal)}\n`; });
  lines += `--------------------------\nTOTAL: ${money(s.total)}\nCASH: ${money(s.payment)}\nCHANGE: ${money(s.change)}\n\nThank you!`;
  $('rBody').textContent = lines;
  $('receipt').classList.remove('hidden');
  $('receipt').scrollIntoView();
}
async function renderSearchSuggest() {
  const q = $('search').value.trim();
  const box = $('suggest'); box.innerHTML = '';
  if (q.length < 1) return;
  const list = await api('/api/products?q=' + encodeURIComponent(q));
  list.slice(0, 8).forEach(p => {
    const b = document.createElement('button');
    b.textContent = `${p.name} — ${money(p.price)} (stock ${p.stock})`;
    b.onclick = () => { addToCart(p); $('search').value = ''; box.innerHTML = ''; $('barcode').focus(); };
    box.appendChild(b);
  });
}

// ---- Products ----
async function loadProducts() {
  const q = $('pSearch').value || '';
  const list = await api('/api/products?q=' + encodeURIComponent(q));
  const tb = $('prodTable').querySelector('tbody'); tb.innerHTML = '';
  list.forEach(p => {
    const tr = document.createElement('tr');
    const low = p.stock <= Number(settings.low_stock_at || 5) ? ' ⚠️' : '';
    tr.innerHTML = `<td>${p.barcode}</td><td>${p.name}</td><td>${money(p.price)}</td><td>${p.stock}${low}</td><td>${p.category || ''}</td>`;
    const td = document.createElement('td');
    td.innerHTML = `<button onclick='editProduct(${p.id})'>Edit</button> <button onclick='adjStock(${p.id})'>±Stock</button> <button onclick='delProduct(${p.id})'>Del</button>`;
    tr.appendChild(td); tb.appendChild(tr);
  });
}
function openProductModal(p) {
  $('pmId').value = (p && p.id) || '';
  $('pmTitle').textContent = (p && p.id) ? 'Edit product' : 'New product';
  $('pmBarcode').value = (p && p.barcode) || '';
  $('pmName').value = (p && p.name) || '';
  $('pmPrice').value = (p && p.price) || 0;
  $('pmCost').value = (p && p.cost) || 0;
  $('pmStock').value = (p && p.stock) || 0;
  $('pmCategory').value = (p && p.category) || '';
  $('pModal').classList.remove('hidden');
}
function closeProductModal() { $('pModal').classList.add('hidden'); }
async function editProduct(id) {
  const list = await api('/api/products?q=');
  const p = list.find(x => x.id === id);
  if (p) openProductModal(p);
}
async function saveProduct() {
  const id = $('pmId').value;
  const data = { barcode: $('pmBarcode').value.trim(), name: $('pmName').value.trim(), price: Number($('pmPrice').value || 0), cost: Number($('pmCost').value || 0), stock: Number($('pmStock').value || 0), category: $('pmCategory').value.trim() };
  if (!data.name) { alert('Name required'); return; }
  try {
    if (id) await api('/api/products/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    else await api('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    closeProductModal(); loadProducts(); loadStats();
  } catch (e) { alert('Save failed: ' + e.message); }
}
async function adjStock(id) {
  const v = prompt('Enter stock change (e.g. +10 delivery, -2 damaged):', '+10');
  if (v === null) return;
  await api('/api/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, qty_change: Number(v) }) });
  loadProducts(); loadStats();
}
async function delProduct(id) {
  if (!confirm('Delete product?')) return;
  await api('/api/products/' + id, { method: 'DELETE' });
  loadProducts(); loadStats();
}

// ---- Sales ----
function todaySales() { $('salesDate').value = new Date().toISOString().slice(0, 10); loadSales(); }
async function loadSales() {
  const d = $('salesDate').value;
  const j = await api('/api/sales?date=' + encodeURIComponent(d || ''));
  $('salesTotal').textContent = money(j.total); $('salesCount').textContent = j.count;
  const tb = $('salesTable').querySelector('tbody'); tb.innerHTML = '';
  j.sales.forEach(s => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${s.id}</td><td>${s.datetime}</td><td>${s.item_count}</td><td>${money(s.total)}</td><td>${money(s.payment)}</td>`;
    const td = document.createElement('td');
    const b = document.createElement('button'); b.textContent = 'Receipt';
    b.onclick = async () => { const full = await api('/api/sales/' + s.id); showReceipt(full); };
    td.appendChild(b); tr.appendChild(td); tb.appendChild(tr);
  });
}

// ---- Export / Import (move DB to other device) ----
async function exportDB() {
  const j = await api('/api/export');
  const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pos-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
}
async function importDB() {
  const f = $('importFile').files[0];
  if (!f) { alert('Choose a JSON backup file first'); return; }
  const j = JSON.parse(await f.text());
  if (!j.products) { alert('Bad file'); return; }
  const ow = confirm('OK = replace duplicates with imported data\nCancel = keep existing, only add new barcodes');
  const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products: j.products, overwrite: ow }) });
  alert('Imported ' + r.imported + ' products'); loadProducts();
}

loadSettings(); loadStats(); renderCart();
$('barcode').focus();
