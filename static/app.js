/* My Sales Notes frontend */
let settings = { shop_name: 'My Sales Notes', currency: 'Rp' };
let viewDate = new Date().toISOString().slice(0, 10);
let payMethod = 'cash';
let editingId = null;
const $ = id => document.getElementById(id);
const isIDR = () => ['rp', 'rp.', 'idr', 'rupiah'].includes(String(settings.currency || 'Rp').trim().toLowerCase());
const money = n => isIDR() ? 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
  : (settings.currency || 'Rp') + ' ' + Number(n || 0).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const todayStr = () => new Date().toISOString().slice(0, 10);

async function api(path, opts = {}) {
  opts.headers = Object.assign({}, opts.headers);
  const tok = localStorage.getItem('notes_token');
  if (tok && !opts.headers['Authorization']) opts.headers['Authorization'] = 'Bearer ' + tok;
  const r = await fetch(path, opts);
  const t = await r.text();
  let j = {};
  try { j = JSON.parse(t); } catch (e) { j = { error: t }; }
  if (r.status === 401 && path !== '/api/me') showAuth();
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

// ---------- auth (access key) ----------
function authErr(m) {
  const e = $('authErr');
  if (!m) { e.classList.add('hidden'); e.textContent = ''; return; }
  e.textContent = m; e.classList.remove('hidden');
}
function showAuth() { $('authScreen').classList.remove('hidden'); }
function hideAuth() { $('authScreen').classList.add('hidden'); authErr(null); }

async function checkSetup() {
  const pub = await api('/api/public-settings').catch(() => ({}));
  if (pub.shop_name) { settings.shop_name = pub.shop_name; $('shopTitle').textContent = pub.shop_name; $('authShopName').textContent = pub.shop_name; }
  const s = await api('/api/setup-needed');
  if (s.needed) {
    $('authSetupPane').classList.remove('hidden');
    $('authLoginPane').classList.add('hidden');
    $('authHint').textContent = 'First time? Create one private key. You will use it on any device.';
    setTimeout(() => $('setupKey').focus(), 60);
  } else {
    $('authSetupPane').classList.add('hidden');
    $('authLoginPane').classList.remove('hidden');
    $('authHint').textContent = 'Enter your access key to open your notes.';
    setTimeout(() => $('loginKey').focus(), 60);
  }
  showAuth();
}

async function doSetup() {
  const a = $('setupKey').value.trim(), b = $('setupKey2').value.trim();
  if (a.length < 4) { authErr('Key min. 4 chars.'); return; }
  if (a !== b) { authErr('Keys do not match.'); return; }
  try {
    const j = await api('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: a }) });
    localStorage.setItem('notes_token', j.token);
    hideAuth(); await afterLogin();
    toast('Key created — keep it private!', 'ok');
  } catch (e) { authErr('Setup failed: ' + e.message); }
}
async function doLogin() {
  const k = $('loginKey').value;
  if (!k) { authErr('Enter your key.'); return; }
  try {
    const j = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) });
    localStorage.setItem('notes_token', j.token);
    $('loginKey').value = '';
    hideAuth(); await afterLogin();
    toast('Unlocked ✓', 'ok');
  } catch (e) { authErr('Wrong key — try again.'); }
}
function doLogout() {
  api('/api/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('notes_token');
  showAuth(); checkSetup();
}

async function afterLogin() {
  await loadSettings();
  viewDate = todayStr();
  $('viewDate').value = viewDate;
  $('fDate').value = viewDate;
  await Promise.all([loadDay(), loadStats()]);
  loadHistoryMonthDefault();
  setTimeout(() => $('fItem').focus(), 80);
}

// ---------- settings / stats ----------
async function loadSettings() {
  try { Object.assign(settings, await api('/api/settings')); } catch (e) {}
  $('shopTitle').textContent = settings.shop_name || 'My Sales Notes';
  $('authShopName').textContent = settings.shop_name || 'My Sales Notes';
  document.title = (settings.shop_name || 'My Sales Notes') + ' — Sales Notes';
  $('sShop').value = settings.shop_name || '';
  $('sCur').value = settings.currency || 'Rp';
}
async function loadStats() {
  try {
    const s = await api('/api/stats');
    $('stToday').textContent = money(s.today_total);
    $('stMonth').textContent = money(s.month_total);
  } catch (e) {}
}

// ---------- day note ----------
function shiftDay(n) {
  const d = new Date(viewDate + 'T12:00:00');
  d.setDate(d.getDate() + n);
  setViewDate(d.toISOString().slice(0, 10));
}
function setViewDate(d) {
  viewDate = d;
  $('viewDate').value = d;
  if (!editingId) $('fDate').value = d;
  loadDay();
}

async function loadDay() {
  let j;
  try { j = await api('/api/day?date=' + encodeURIComponent(viewDate)); }
  catch (e) { toast('Failed to load day: ' + e.message, 'err'); return; }
  const isToday = viewDate === todayStr();
  $('dayHint').textContent = isToday ? '· today — fresh note each day' : (viewDate < todayStr() ? '· past note (read/edit)' : '· future date');
  $('totalLabel').textContent = 'Total earnings · ' + viewDate;
  $('dayTotal').textContent = money(j.total);
  $('cashTotal').textContent = money(j.cash_total);
  $('cashCount').textContent = j.cash_count;
  $('qrisTotal').textContent = money(j.qris_total);
  $('qrisCount').textContent = j.qris_count;
  $('dayCount').textContent = j.count;
  $('entriesTitle').textContent = isToday ? "Today's sales" : ('Sales · ' + viewDate);
  const box = $('entries'); box.innerHTML = '';
  $('entriesEmpty').classList.toggle('hidden', j.entries.length > 0);
  j.entries.forEach(e => {
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
  $('editId').value = e.id;
  $('formTitle').textContent = '✏️ Edit sale #' + e.id;
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
  $('editId').value = '';
  $('formTitle').textContent = '+ Add sale';
  $('btnSave').textContent = '💾 Save sale';
  $('btnCancelEdit').classList.add('hidden');
  $('fItem').value = ''; $('fQty').value = 1; $('fPrice').value = ''; $('fNote').value = '';
  $('fDate').value = viewDate;
  setPay('cash'); updSub();
}

async function saveEntry() {
  const item = $('fItem').value.trim();
  const qty = Number($('fQty').value || 0);
  const price = Number($('fPrice').value || 0);
  const dt = $('fDate').value || viewDate;
  const note = $('fNote').value.trim();
  if (!item) { toast('Item name required', 'err'); $('fItem').focus(); return; }
  if (!(qty > 0)) { toast('Quantity must be > 0', 'err'); $('fQty').focus(); return; }
  if (!(price >= 0) || $('fPrice').value === '') { toast('Price required (0 allowed)', 'err'); $('fPrice').focus(); return; }
  $('btnSave').disabled = true;
  try {
    if (editingId) {
      await api('/api/entries/' + editingId, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, qty, price, payment: payMethod, date: dt, note }) });
      toast('Updated ✓', 'ok');
    } else {
      await api('/api/entries', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item, qty, price, payment: payMethod, date: dt, note }) });
      toast(item + ' saved ✓', 'ok', 1500);
    }
    if (dt !== viewDate) setViewDate(dt); else await loadDay();
    cancelEdit();
  } catch (e) { toast('Save failed: ' + e.message, 'err'); }
  $('btnSave').disabled = false;
  setTimeout(() => $('fItem').focus(), 50);
}

async function delEntry(id) {
  if (!confirm('Delete this sale?')) return;
  try { await api('/api/entries/' + id, { method: 'DELETE' }); toast('Deleted', 'ok'); loadDay(); }
  catch (e) { toast(e.message, 'err'); }
}

// ---------- history ----------
function loadHistoryMonthDefault() { $('histMonth').value = todayStr().slice(0, 7); loadHistory(); }
async function loadHistory() {
  const m = $('histMonth').value || todayStr().slice(0, 7);
  let j;
  try { j = await api('/api/days?month=' + encodeURIComponent(m) + '&limit=100'); }
  catch (e) { toast('History failed: ' + e.message, 'err'); return; }
  $('histTotal').textContent = money(j.month_total || 0);
  $('histCount').textContent = j.days.length + ' selling days · ' + (j.month_count || 0) + ' sales';
  $('histAvg').textContent = money(j.days.length ? (j.month_total || 0) / j.days.length : 0);
  $('histLabel').textContent = m;
  const tb = $('histTable').querySelector('tbody'); tb.innerHTML = '';
  if (!j.days.length) { tb.innerHTML = '<tr><td colspan="5" class="muted center">No sales this month.</td></tr>'; return; }
  j.days.forEach(d => {
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

// ---------- settings ----------
async function saveSettings() {
  try {
    await api('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shop_name: $('sShop').value, currency: $('sCur').value }) });
    await loadSettings(); toast('Saved ✓', 'ok');
  } catch (e) { toast('Save failed: ' + e.message, 'err'); }
}
async function changeKey() {
  const o = $('kOld').value, n = $('kNew').value;
  if (!o || n.length < 4) { toast('Old key + new key (min 4) required', 'err'); return; }
  try {
    await api('/api/change-key', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ old_key: o, new_key: n }) });
    $('kOld').value = ''; $('kNew').value = '';
    toast('Key changed ✓ other devices logged out', 'ok');
  } catch (e) { toast('Change failed: ' + e.message, 'err'); }
}
async function exportDB() {
  try {
    const j = await api('/api/export');
    const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sales-notes-' + todayStr() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Backup downloaded', 'ok');
  } catch (e) { toast('Export failed: ' + e.message, 'err'); }
}
async function importDB() {
  const f = $('importFile').files[0];
  if (!f) { toast('Choose a JSON file first', 'err'); return; }
  let j;
  try { j = JSON.parse(await f.text()); } catch (e) { toast('Invalid JSON', 'err'); return; }
  if (!j.entries) { toast('Bad backup file', 'err'); return; }
  const ow = confirm('OK = REPLACE all current notes with backup\nCancel = ADD backup on top (keep current)');
  try {
    const r = await api('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: j.entries, overwrite: ow, settings: j.settings }) });
    toast('Imported ' + r.imported + ' sales', 'ok');
    await loadDay(); loadHistory(); loadStats(); loadSettings();
  } catch (e) { toast('Import failed: ' + e.message, 'err'); }
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
$('btnThisMonth').addEventListener('click', loadHistoryMonthDefault);
$('btnSaveSettings').addEventListener('click', saveSettings);
$('btnChangeKey').addEventListener('click', changeKey);
$('btnExport').addEventListener('click', exportDB);
$('btnImport').addEventListener('click', importDB);

// ---------- init ----------
(async () => {
  $('viewDate').value = viewDate;
  $('fDate').value = viewDate;
  $('histMonth').value = todayStr().slice(0, 7);
  setPay('cash'); updSub();
  const tok = localStorage.getItem('notes_token');
  if (tok) {
    try {
      await api('/api/me');
      hideAuth();
      await afterLogin();
    } catch (e) { await checkSetup(); }
  } else {
    await checkSetup();
  }
  try { await loadSettings(); } catch (e) {}
})();
