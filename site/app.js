/* My Sales Notes — GitHub Pages version (no backend, localStorage only) */
/* Site key gate: __SITE_KEY_HASH__ is replaced at deploy time with the
   SHA-256 of "sn::" + the SITE_KEY GitHub secret (see .github/workflows/deploy-pages.yml).
   Raw key never appears in the repo. When enforced, the same site key opens
   the gate on every device (notes themselves stay per-device in localStorage). */
const SITE_KEY_HASH = "__SITE_KEY_HASH__";
const SITE_ENFORCED = typeof SITE_KEY_HASH === 'string' && !SITE_KEY_HASH.startsWith('__');

let settings = { shop_name: 'My Sales Notes', currency: 'Rp' };
const localDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const todayStr = () => localDay(new Date());
let viewDate = todayStr();
let payMethod = 'cash';
let editingId = null;
const $ = id => document.getElementById(id);
const isIDR = () => ['rp', 'rp.', 'idr', 'rupiah'].includes(String(settings.currency || 'Rp').trim().toLowerCase());
const money = n => isIDR() ? 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
  : (settings.currency || 'Rp') + ' ' + Number(n || 0).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- storage ---------- */
const LS_E = 'sn_entries', LS_S = 'sn_settings', LS_P = 'sn_pin';
const loadEntries = () => { try { return JSON.parse(localStorage.getItem(LS_E)) || []; } catch (e) { return []; } };
const saveEntries = list => localStorage.setItem(LS_E, JSON.stringify(list));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

async function hashPin(pin) {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('sn::' + pin));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    let h = 5381; const s = 'sn::' + pin;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return 'dj:' + h.toString(16);
  }
}

function toast(msg, type = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 320); }, ms);
}

function tickClock() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('todayLabel').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
setInterval(tickClock, 10000); tickClock();

// ---------- tabs ----------
document.querySelectorAll('nav.tabs .tab[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('nav.tabs .tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tabpage').forEach(s => s.classList.add('hidden'));
  $('tab-' + b.dataset.tab).classList.remove('hidden');
  if (b.dataset.tab === 'history') loadHistory();
}));

// ---------- key gate ----------
function authErr(m) {
  const e = $('authErr');
  if (!m) { e.classList.add('hidden'); e.textContent = ''; return; }
  e.textContent = m; e.classList.remove('hidden');
}
function showAuth() { $('authScreen').classList.remove('hidden'); }
function hideAuth() { $('authScreen').classList.add('hidden'); authErr(null); }

function checkGate() {
  const saved = loadSettings();
  $('shopTitle').textContent = saved.shop_name;
  $('authShopName').textContent = saved.shop_name;
  document.title = saved.shop_name + ' — Sales Notes';
  if (SITE_ENFORCED) {
    // one site-wide key (from GitHub secret) — no per-device setup
    $('authSetupPane').classList.add('hidden');
    $('authLoginPane').classList.remove('hidden');
    $('authHint').textContent = 'This notebook is locked — enter the site key.';
    if (sessionStorage.getItem('sn_unlocked') === '1') { hideAuth(); afterLogin(); return; }
    setTimeout(() => $('loginKey').focus(), 60);
    showAuth();
    return;
  }
  if (!localStorage.getItem(LS_P)) {
    $('authSetupPane').classList.remove('hidden');
    $('authLoginPane').classList.add('hidden');
    $('authHint').textContent = 'First time on this device? Create one private key.';
    setTimeout(() => $('setupKey').focus(), 60);
  } else if (sessionStorage.getItem('sn_unlocked') === '1') {
    hideAuth(); afterLogin();
    return;
  } else {
    $('authSetupPane').classList.add('hidden');
    $('authLoginPane').classList.remove('hidden');
    $('authHint').textContent = 'Enter your access key to open this device\u2019s notes.';
    setTimeout(() => $('loginKey').focus(), 60);
  }
  showAuth();
}
async function doSetup() {
  if (SITE_ENFORCED) { authErr('Site key is managed in the repo settings.'); return; }
  const a = $('setupKey').value.trim(), b = $('setupKey2').value.trim();
  if (a.length < 4) { authErr('Key min. 4 chars.'); return; }
  if (a !== b) { authErr('Keys do not match.'); return; }
  localStorage.setItem(LS_P, await hashPin(a));
  sessionStorage.setItem('sn_unlocked', '1');
  $('setupKey').value = ''; $('setupKey2').value = '';
  hideAuth(); afterLogin();
  toast('Key created — notes stay in this browser', 'ok');
}
async function doLogin() {
  const k = $('loginKey').value;
  if (!k) { authErr('Enter your key.'); return; }
  const want = SITE_ENFORCED ? SITE_KEY_HASH : localStorage.getItem(LS_P);
  if ((await hashPin(k)) !== want) { authErr('Wrong key — try again.'); return; }
  $('loginKey').value = '';
  sessionStorage.setItem('sn_unlocked', '1');
  hideAuth(); afterLogin();
  toast('Unlocked ✓', 'ok');
}
function doLogout() {
  sessionStorage.removeItem('sn_unlocked');
  cancelEdit();
  showAuth(); checkGate();
}
function afterLogin() {
  loadSettings(); refreshTitles();
  viewDate = todayStr();
  $('viewDate').value = viewDate;
  $('fDate').value = viewDate;
  $('histMonth').value = todayStr().slice(0, 7);
  loadDay(); loadHistory();
  setTimeout(() => $('fItem').focus(), 80);
}

// ---------- settings ----------
function loadSettings() {
  try { Object.assign(settings, JSON.parse(localStorage.getItem(LS_S)) || {}); } catch (e) {}
  return settings;
}
function refreshTitles() {
  $('shopTitle').textContent = settings.shop_name || 'My Sales Notes';
  $('authShopName').textContent = settings.shop_name || 'My Sales Notes';
  document.title = (settings.shop_name || 'My Sales Notes') + ' — Sales Notes';
  $('sShop').value = settings.shop_name || '';
  $('sCur').value = settings.currency || 'Rp';
}
function saveSettings() {
  settings.shop_name = $('sShop').value.trim() || 'My Sales Notes';
  settings.currency = $('sCur').value.trim() || 'Rp';
  localStorage.setItem(LS_S, JSON.stringify(settings));
  refreshTitles(); loadDay(); loadHistory(); loadStats();
  toast('Saved ✓', 'ok');
}
async function changeKey() {
  if (SITE_ENFORCED) { toast('Site key is managed in the GitHub repo secret.', 'err'); return; }
  const o = $('kOld').value, n = $('kNew').value.trim();
  if (!o || n.length < 4) { toast('Old key + new key (min 4) required', 'err'); return; }
  if ((await hashPin(o)) !== localStorage.getItem(LS_P)) { toast('Wrong old key', 'err'); return; }
  localStorage.setItem(LS_P, await hashPin(n));
  $('kOld').value = ''; $('kNew').value = '';
  toast('Key changed ✓', 'ok');
}
function applyKeyModeUI() {
  // hide per-device key controls when the site-wide secret key is enforced
  ['kOld', 'kNew', 'btnChangeKey'].forEach(id => {
    const wrap = $(id).closest('label') || $(id);
    if (SITE_ENFORCED) (id === 'btnChangeKey' ? $(id) : wrap).classList.add('hidden');
  });
  if (SITE_ENFORCED) {
    $('keyModeHint').textContent = 'One site-wide key (set in the GitHub repo secret SITE_KEY) opens the gate on every device. Change it there — the site redeploys automatically.';
  }
}

// ---------- day note ----------
function dayList(date) { return loadEntries().filter(e => e.date === date).sort((a, b) => a.created_at.localeCompare(b.created_at)); }
function summarize(list) {
  const s = { total: 0, count: list.length, cash_total: 0, cash_count: 0, qris_total: 0, qris_count: 0 };
  list.forEach(e => {
    s.total += e.subtotal;
    if (e.payment === 'qris') { s.qris_total += e.subtotal; s.qris_count++; }
    else { s.cash_total += e.subtotal; s.cash_count++; }
  });
  s.total = Math.round(s.total * 100) / 100;
  s.cash_total = Math.round(s.cash_total * 100) / 100;
  s.qris_total = Math.round(s.qris_total * 100) / 100;
  return s;
}
function loadStats() {
  const all = loadEntries(), t = todayStr(), m = t.slice(0, 7);
  const td = summarize(all.filter(e => e.date === t));
  const mo = summarize(all.filter(e => e.date.slice(0, 7) === m));
  $('stToday').textContent = money(td.total);
  $('stMonth').textContent = money(mo.total);
}
function shiftDay(n) {
  const [y, m, dd] = viewDate.split('-').map(Number);
  setViewDate(localDay(new Date(y, m - 1, dd + n)));
}
function setViewDate(d) {
  viewDate = d;
  $('viewDate').value = d;
  if (!editingId) $('fDate').value = d;
  loadDay();
}
function loadDay() {
  const list = dayList(viewDate), s = summarize(list);
  const isToday = viewDate === todayStr();
  $('dayHint').textContent = isToday ? '· today — fresh note each day' : (viewDate < todayStr() ? '· past note (read/edit)' : '· future date');
  $('totalLabel').textContent = 'Total earnings · ' + viewDate;
  $('dayTotal').textContent = money(s.total);
  $('cashTotal').textContent = money(s.cash_total);
  $('cashCount').textContent = s.cash_count;
  $('qrisTotal').textContent = money(s.qris_total);
  $('qrisCount').textContent = s.qris_count;
  $('dayCount').textContent = s.count;
  $('entriesTitle').textContent = isToday ? "Today's sales" : ('Sales · ' + viewDate);
  const box = $('entries'); box.innerHTML = '';
  $('entriesEmpty').classList.toggle('hidden', list.length > 0);
  list.forEach(e => {
    const d = document.createElement('div');
    d.className = 'entry';
    d.innerHTML = `<div><div class="ename">${esc(e.item)}</div>
      <div class="emeta">${Number(e.qty)} × ${esc(money(e.price))} · <span class="paybadge ${e.payment}">${e.payment === 'qris' ? '📱 QRIS' : '💵 Cash'}</span>${e.note ? ' · ' + esc(e.note) : ''}</div></div>
      <div class="esub">${esc(money(e.subtotal))}</div>
      <div class="eactions"><button class="btn small">Edit</button> <button class="btn small ghost">Delete</button></div>`;
    const [bE, bD] = d.querySelectorAll('button');
    bE.addEventListener('click', () => startEdit(e));
    bD.addEventListener('click', () => delEntry(e.id));
    box.appendChild(d);
  });
  loadStats();
}
function setPay(p) {
  payMethod = p;
  $('payCash').className = p === 'cash' ? 'active-cash' : '';
  $('payQris').className = p === 'qris' ? 'active-qris' : '';
}
function updSub() {
  const q = Number($('fQty').value || 0), pr = Number($('fPrice').value || 0);
  $('fSub').value = money(q * pr);
}
function startEdit(e) {
  editingId = e.id;
  $('formTitle').textContent = '✏️ Edit sale';
  $('fItem').value = e.item;
  $('fQty').value = e.qty;
  $('fPrice').value = e.price;
  $('fNote').value = e.note || '';
  $('fDate').value = e.date;
  setPay(e.payment || 'cash');
  updSub();
  $('btnSave').textContent = '💾 Update sale';
  $('btnCancelEdit').classList.remove('hidden');
  $('fItem').focus();
}
function cancelEdit() {
  editingId = null;
  $('formTitle').textContent = '+ Add sale';
  $('btnSave').textContent = '💾 Save sale';
  $('btnCancelEdit').classList.add('hidden');
  $('fItem').value = ''; $('fQty').value = 1; $('fPrice').value = ''; $('fNote').value = '';
  $('fDate').value = viewDate;
  setPay('cash'); updSub();
}
function saveEntry() {
  const item = $('fItem').value.trim();
  const qty = Number($('fQty').value || 0);
  const price = $('fPrice').value === '' ? NaN : Number($('fPrice').value);
  const dt = $('fDate').value || viewDate;
  const note = $('fNote').value.trim();
  if (!item) { toast('Item name required', 'err'); $('fItem').focus(); return; }
  if (!(qty > 0)) { toast('Quantity must be > 0', 'err'); $('fQty').focus(); return; }
  if (!isFinite(price) || price < 0) { toast('Price required (0 allowed)', 'err'); $('fPrice').focus(); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dt)) { toast('Bad date', 'err'); return; }
  const all = loadEntries();
  const sub = Math.round(qty * price * 100) / 100;
  const now = new Date().toISOString();
  if (editingId) {
    const i = all.findIndex(e => e.id === editingId);
    if (i < 0) { toast('Not found', 'err'); cancelEdit(); return; }
    all[i] = { ...all[i], date: dt, item, qty, price, subtotal: sub, payment: payMethod, note };
    saveEntries(all);
    toast('Updated ✓', 'ok');
  } else {
    all.push({ id: uid(), date: dt, item, qty, price, subtotal: sub, payment: payMethod, note, created_at: now });
    saveEntries(all);
    toast(item + ' saved ✓', 'ok', 1500);
  }
  if (dt !== viewDate) setViewDate(dt); else loadDay();
  cancelEdit();
  setTimeout(() => $('fItem').focus(), 50);
}
function delEntry(id) {
  if (!confirm('Delete this sale?')) return;
  saveEntries(loadEntries().filter(e => e.id !== id));
  toast('Deleted', 'ok'); loadDay();
}

// ---------- history ----------
function loadHistory() {
  const m = $('histMonth').value || todayStr().slice(0, 7);
  const inMonth = loadEntries().filter(e => e.date.slice(0, 7) === m);
  const byDay = {};
  inMonth.forEach(e => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  const days = Object.keys(byDay).sort().reverse().map(d => ({ date: d, ...summarize(byDay[d]) }));
  const mt = summarize(inMonth);
  $('histTotal').textContent = money(mt.total);
  $('histCount').textContent = days.length + ' selling days · ' + mt.count + ' sales';
  $('histAvg').textContent = money(days.length ? mt.total / days.length : 0);
  $('histLabel').textContent = m;
  const tb = $('histTable').querySelector('tbody'); tb.innerHTML = '';
  if (!days.length) { tb.innerHTML = '<tr><td colspan="5" class="muted center">No sales this month.</td></tr>'; return; }
  days.forEach(d => {
    const tr = document.createElement('tr');
    tr.className = 'day-row';
    tr.innerHTML = `<td><b>${esc(d.date)}</b></td><td>${d.count}</td><td class="muted">${esc(money(d.cash_total))}</td><td class="muted">${esc(money(d.qris_total))}</td><td><b>${esc(money(d.total))}</b></td>`;
    tr.addEventListener('click', () => {
      setViewDate(d.date);
      document.querySelectorAll('nav.tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.tab === 'note'));
      document.querySelectorAll('.tabpage').forEach(s => s.classList.add('hidden'));
      $('tab-note').classList.remove('hidden');
    });
    tb.appendChild(tr);
  });
}

// ---------- backup ----------
function exportDB() {
  const blob = new Blob([JSON.stringify({ entries: loadEntries(), settings, exported_at: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sales-notes-' + todayStr() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Backup downloaded', 'ok');
}
async function importDB() {
  const f = $('importFile').files[0];
  if (!f) { toast('Choose a JSON file first', 'err'); return; }
  let j;
  try { j = JSON.parse(await f.text()); } catch (e) { toast('Invalid JSON', 'err'); return; }
  const incoming = j.entries || j.sales || j.products;
  if (!incoming) { toast('Bad backup file', 'err'); return; }
  const ow = confirm('OK = REPLACE all current notes with backup\nCancel = ADD backup on top (keep current)');
  let list = ow ? [] : loadEntries();
  let n = 0;
  // normalize entries from our export or legacy python-server exports
  (Array.isArray(incoming) ? incoming : []).forEach(e => {
    const date = String(e.date || '').trim();
    const item = String(e.item || e.name || '').trim();
    const qty = Number(e.qty ?? 1), price = Number(e.price ?? 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !item || !(qty > 0) || !(price >= 0)) return;
    const payment = String(e.payment || 'cash').toLowerCase() === 'qris' ? 'qris' : 'cash';
    list.push({ id: uid(), date, item, qty, price, subtotal: Math.round(qty * price * 100) / 100,
      payment, note: String(e.note || '').slice(0, 500), created_at: e.created_at || new Date().toISOString() });
    n++;
  });
  if (j.settings) {
    if (j.settings.shop_name) settings.shop_name = String(j.settings.shop_name).slice(0, 80);
    if (j.settings.currency) settings.currency = String(j.settings.currency).slice(0, 10);
    localStorage.setItem(LS_S, JSON.stringify(settings));
    refreshTitles();
  }
  saveEntries(list);
  $('importFile').value = '';
  toast('Imported ' + n + ' sales', 'ok');
  loadDay(); loadHistory();
}

// ---------- bind ----------
$('btnSetup').addEventListener('click', doSetup);
$('loginKey').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('setupKey2').addEventListener('keydown', e => { if (e.key === 'Enter') doSetup(); });
$('btnLogin').addEventListener('click', doLogin);
$('btnLogout').addEventListener('click', doLogout);
$('btnPrevDay').addEventListener('click', () => shiftDay(-1));
$('btnNextDay').addEventListener('click', () => shiftDay(1));
$('btnToday').addEventListener('click', () => setViewDate(todayStr()));
$('viewDate').addEventListener('change', e => { if (e.target.value) setViewDate(e.target.value); });
$('payCash').addEventListener('click', () => setPay('cash'));
$('payQris').addEventListener('click', () => setPay('qris'));
$('fQty').addEventListener('input', updSub);
$('fPrice').addEventListener('input', updSub);
$('btnSave').addEventListener('click', saveEntry);
$('btnCancelEdit').addEventListener('click', cancelEdit);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && ['fItem', 'fQty', 'fPrice', 'fNote'].includes(document.activeElement.id)) { e.preventDefault(); saveEntry(); }
});
$('btnLoadHist').addEventListener('click', loadHistory);
$('btnThisMonth').addEventListener('click', () => { $('histMonth').value = todayStr().slice(0, 7); loadHistory(); });
$('btnSaveSettings').addEventListener('click', saveSettings);
$('btnChangeKey').addEventListener('click', changeKey);
$('btnExport').addEventListener('click', exportDB);
$('btnImport').addEventListener('click', importDB);

// ---------- init ----------
(function init() {
  loadSettings();
  $('viewDate').value = viewDate;
  $('fDate').value = viewDate;
  $('histMonth').value = todayStr().slice(0, 7);
  setPay('cash'); updSub();
  applyKeyModeUI();
  checkGate();
  if (sessionStorage.getItem('sn_unlocked') === '1' && (SITE_ENFORCED || localStorage.getItem(LS_P))) { loadDay(); loadHistory(); }
})();
