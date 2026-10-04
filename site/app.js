/* My Sales Notes — POS revamp (dark, mobile-first, offline-first).
 * Static site, localStorage first, optional Cloudflare Worker + D1 sync.
 * Data model (synced): entries + notes + note_state (legacy compat) + products.
 * UI: single direct-save form; day sales grouped per note with lock buttons.
 */
const SITE_KEY_HASH = "__SITE_KEY_HASH__";
const SITE_ENFORCED = typeof SITE_KEY_HASH === 'string' && !SITE_KEY_HASH.startsWith('__');
const SYNC_URL = "__SYNC_URL__";
const SYNC_ON = typeof SYNC_URL === 'string' && SYNC_URL.startsWith('http');

let settings = { shop_name: 'My Sales Notes', currency: 'Rp', shifts: { pagi: true, siang: true, lembur: true } };
let sessionKey = sessionStorage.getItem('sn_key') || null; // legacy site-key mode only

/* ---------- accounts (multi-user; one isolated panel per account) ----------
 * Legacy mode (uid '') uses the exact same unprefixed keys as before, so old
 * data keeps working. Each registered account gets its own prefixed namespace,
 * both locally and in D1 (account_id), so panels never cross.
 */
let ACC = { uid: '', username: '', token: '' };
const LS_ACCTS = 'sn_accounts'; // {uid:{username,token,verifier}} — this device's accounts
const LS_CUR = 'sn_current';    // current uid ('' = legacy site-key mode)
const LS_SUP = 'sn_acct_support'; // cached '0' when the Worker predates accounts
function accountsMode() {
  if (!SYNC_ON) return false;
  try { return localStorage.getItem(LS_SUP) !== '0'; } catch (e) { return true; }
}
async function probeAccounts() {
  if (!SYNC_ON || !navigator.onLine) return accountsMode();
  try {
    const h = await (await fetch(SYNC_URL + '/api/health')).json();
    localStorage.setItem(LS_SUP, h && h.accounts ? '1' : '0');
  } catch (e) { /* keep cached value / default */ }
  return accountsMode();
}
function loadAccts() { try { return JSON.parse(localStorage.getItem(LS_ACCTS)) || {}; } catch (e) { return {}; } }
function saveAccts(a) { try { localStorage.setItem(LS_ACCTS, JSON.stringify(a)); } catch (e) {} }
function authToken() { return ACC.token || sessionKey; }
function authed() {
  if (ACC.token) return true;
  return !!sessionKey && sessionStorage.getItem('sn_unlocked') === '1';
}
let viewDate = null;
let viewShift = 'pagi';
let payMethod = 'cash';
let editPid = null;

const $ = id => document.getElementById(id);
const localDay = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const todayStr = () => localDay(new Date());
const isIDR = () => ['rp', 'rp.', 'idr', 'rupiah'].includes(String(settings.currency || 'Rp').trim().toLowerCase());
const money = n => isIDR() ? 'Rp ' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 })
  : (settings.currency || 'Rp') + ' ' + Number(n || 0).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const nowIso = () => new Date().toISOString();

/* ---------- storage (namespaced per account) ---------- */
let LS_E = 'sn_entries', LS_N = 'sn_notes', LS_S = 'sn_settings', LS_P = 'sn_pin';
let LS_D = 'sn_dirty', LS_DN = 'sn_dirty_notes', LS_DS = 'sn_dirty_states';
let LS_ST = 'sn_states', LS_LP = 'sn_last_pull', LS_MG = 'sn_migrated';
let LS_PD = 'sn_products', LS_DP = 'sn_dirty_products';
let LS_SU = 'sn_settings_updated', LS_DSET = 'sn_dirty_settings';
function setNs(uid) {
  // '' (legacy) reproduces the exact historical keys; accounts get sn_<uid>_*.
  const p = uid ? 'sn_' + uid + '_' : 'sn_';
  LS_E = p + 'entries'; LS_N = p + 'notes'; LS_S = p + 'settings';
  LS_D = p + 'dirty'; LS_DN = p + 'dirty_notes'; LS_DS = p + 'dirty_states';
  LS_ST = p + 'states'; LS_LP = p + 'last_pull'; LS_MG = p + 'migrated';
  LS_PD = p + 'products'; LS_DP = p + 'dirty_products';
  LS_SU = p + 'settings_updated'; LS_DSET = p + 'dirty_settings';
  // LS_P (legacy device PIN) intentionally stays global — legacy mode only.
}
const loadEntries = () => { try { return JSON.parse(localStorage.getItem(LS_E)) || []; } catch (e) { return []; } };
const saveEntries = l => localStorage.setItem(LS_E, JSON.stringify(l));
const loadNotes = () => { try { return JSON.parse(localStorage.getItem(LS_N)) || []; } catch (e) { return []; } };
const saveNotes = l => localStorage.setItem(LS_N, JSON.stringify(l));
const loadProducts = () => { try { return JSON.parse(localStorage.getItem(LS_PD)) || []; } catch (e) { return []; } };
const saveProducts = l => localStorage.setItem(LS_PD, JSON.stringify(l));
const loadStates = () => { try { return JSON.parse(localStorage.getItem(LS_ST)) || {}; } catch (e) { return {}; } };

function markDirty(id) { try { const d = JSON.parse(localStorage.getItem(LS_D) || '[]'); if (!d.includes(id)) { d.push(id); localStorage.setItem(LS_D, JSON.stringify(d)); } } catch (e) {} }
function markDirtyNote(id) { try { const d = JSON.parse(localStorage.getItem(LS_DN) || '[]'); if (!d.includes(id)) { d.push(id); localStorage.setItem(LS_DN, JSON.stringify(d)); } } catch (e) {} }
function markDirtyState(id) { try { const d = JSON.parse(localStorage.getItem(LS_DS) || '[]'); if (!d.includes(id)) { d.push(id); localStorage.setItem(LS_DS, JSON.stringify(d)); } } catch (e) {} }
function markDirtyProduct(id) { try { const d = JSON.parse(localStorage.getItem(LS_DP) || '[]'); if (!d.includes(id)) { d.push(id); localStorage.setItem(LS_DP, JSON.stringify(d)); } } catch (e) {} }

function migrate() {
  const entries = loadEntries();
  let notes = loadNotes();
  let touchedE = false;
  entries.forEach(e => {
    if (!e.updated_at) { e.updated_at = e.created_at || nowIso(); touchedE = true; }
    if (e.deleted === undefined) { e.deleted = 0; touchedE = true; }
    if (!e.note_id) touchedE = true;
  });
  let touchedN = false;
  notes.forEach(n => {
    if (!n.updated_at) { n.updated_at = n.created_at || nowIso(); touchedN = true; }
    if (n.deleted === undefined) { n.deleted = 0; touchedN = true; }
    if (!n.shift) {
      // Backfill: infer shift from title, else default to pagi.
      // Old single-note days become Pagi so they keep syncing untouched.
      // Also maps the short-lived '1'/'2' values from the 2-shift build.
      const t = String(n.title || '').toLowerCase();
      if (t.includes('lembur') || t.includes('malam') || t.includes('shift 3') || t.includes('shift3')) n.shift = 'lembur';
      else if (t.includes('siang') || t.includes('shift 2') || t.includes('shift2') || t.includes('kasir 2')) n.shift = 'siang';
      else n.shift = 'pagi';
      touchedN = true;
    } else {
      const before = n.shift;
      n.shift = normShift(n.shift);
      if (n.shift !== before) touchedN = true;
    }
  });
  const orphans = entries.filter(e => !e.note_id);
  if (orphans.length) {
    const byDate = {};
    orphans.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    Object.keys(byDate).forEach(date => {
      let note = notes.find(n => !n.deleted && n.date === date);
      if (!note) { note = { id: uid(), date, title: 'Pagi', shift: 'pagi', created_at: nowIso(), updated_at: nowIso(), deleted: 0 }; notes.push(note); touchedN = true; }
      else if (!note.shift) { note.shift = 'pagi'; touchedN = true; }
      byDate[date].forEach(e => { e.note_id = note.id; });
    });
    touchedE = true;
  }
  if (touchedE) saveEntries(entries);
  if (touchedN) saveNotes(notes);
  if (!localStorage.getItem(LS_PD)) saveProducts([]);
  if (!localStorage.getItem(LS_DP)) localStorage.setItem(LS_DP, '[]');
  if (!localStorage.getItem(LS_ST)) localStorage.setItem(LS_ST, '{}');
  // One-time: push existing local shop settings so other devices adopt them.
  if (localStorage.getItem(LS_S) && !localStorage.getItem(LS_SU)) {
    localStorage.setItem(LS_SU, nowIso());
    try { localStorage.setItem(LS_DSET, '1'); } catch (e) {}
  }
  seedProductsFromEntries();
  if (!localStorage.getItem(LS_MG)) {
    localStorage.setItem(LS_D, JSON.stringify(entries.map(e => e.id)));
    localStorage.setItem(LS_DN, JSON.stringify(notes.map(n => n.id)));
    localStorage.setItem(LS_DP, JSON.stringify(loadProducts().map(p => p.id)));
    localStorage.setItem(LS_DS, JSON.stringify(Object.keys(loadStates())));
    localStorage.setItem(LS_MG, '1');
  }
}

/* auto-fill quick products from item names already in sales entries
 * (so old notes' items appear as tappable products; runs on load + after sync) */
function seedProductsFromEntries() {
  try {
    const entries = loadEntries().filter(e => !e.deleted && e.item && String(e.item).trim());
    if (!entries.length) return;
    const prods = loadProducts();
    const known = new Set(prods.filter(p => !p.deleted).map(p => String(p.name).toLowerCase()));
    const lastPrice = {};
    entries.forEach(e => { lastPrice[String(e.item).trim()] = Number(e.price) || 0; });
    let added = 0;
    Object.keys(lastPrice).sort((a, b) => a.localeCompare(b)).forEach(name => {
      if (known.has(name.toLowerCase())) return;
      const now = nowIso(), id = uid();
      prods.push({ id, name, price: lastPrice[name], created_at: now, updated_at: now, deleted: 0 });
      markDirtyProduct(id);
      added++;
    });
    if (added) { saveProducts(prods); syncSoon(); }
  } catch (e) {}
}

/* writable note for new sales: one open note per date+shift,
 * so a day holds three notes (Pagi / Siang / Lembur). Old notes keep syncing. */
const SHIFT_ORDER = { pagi: 0, siang: 1, lembur: 2 };
function normShift(s) {
  const t = String(s ?? 'pagi').trim().toLowerCase();
  if (t === 'siang' || t === '2' || t === 'shift 2' || t === 'shift2') return 'siang';
  if (t === 'lembur' || t === '3' || t === 'shift 3' || t === 'shift3' || t === 'malam') return 'lembur';
  return 'pagi';
}
function shiftLabel(s) { const sh = normShift(s); return sh === 'siang' ? 'Siang' : sh === 'lembur' ? 'Lembur' : 'Pagi'; }
function shiftBadge(s) { const sh = normShift(s); return sh === 'siang' ? '🌤️ Siang' : sh === 'lembur' ? '🌙 Lembur' : '☀️ Pagi'; }
function writableNote(date, shift) {
  const sh = normShift(shift ?? viewShift);
  const day = loadNotes().filter(x => !x.deleted && x.date === date && normShift(x.shift) === sh)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const open = day.find(x => !isClosed(x.id));
  if (open) {
    // Heal old title ("Kasir") to shift title without breaking sync (bump updated_at).
    if (open.title !== shiftLabel(sh)) {
      const all = loadNotes();
      const i = all.findIndex(x => x.id === open.id);
      if (i >= 0) { all[i] = { ...all[i], title: shiftLabel(sh), shift: sh, updated_at: nowIso() }; saveNotes(all); markDirtyNote(open.id); open.title = shiftLabel(sh); }
    }
    return open;
  }
  const now = nowIso();
  const n = { id: uid(), date, title: shiftLabel(sh), shift: sh, created_at: now, updated_at: now, deleted: 0 };
  const all = loadNotes(); all.push(n); saveNotes(all); markDirtyNote(n.id);
  return n;
}
function isClosed(id) { const st = loadStates()[id]; return !!(st && st.closed === 1); }
function closeNote(id) {
  const n = loadNotes().find(x => x.id === id && !x.deleted);
  if (!n) return;
  if (isClosed(id)) { toast('Sudah dikunci', 'info'); return; }
  const list = loadEntries().filter(e => !e.deleted && e.note_id === id);
  if (!list.length) { toast('Belum ada penjualan di catatan ini', 'err'); return; }
  const s = summarize(list);
  if (!confirm(`Kunci "${n.title}" (${n.date})?\nTotal ${money(s.total)} · ${s.count} penjualan.\nLaporan otomatis dikirim ke Telegram.`)) return;
  const now = nowIso();
  const states = loadStates();
  states[id] = { date: n.date, closed: 1, total: s.total, cash_total: s.cash_total,
    qris_total: s.qris_total, count: s.count, closed_at: now, updated_at: now };
  localStorage.setItem(LS_ST, JSON.stringify(states));
  markDirtyState(id);
  renderSell(); renderStats(); syncSoon();
  toast('Catatan dikunci 🔒 ' + money(s.total), 'ok');
  // Auto-send the locked shift's report to Telegram (best-effort, lock already saved).
  try {
    const sh = normShift(n.shift);
    postShiftReport(n.date, sh).then(ok => {
      toast(ok ? 'Laporan ' + shiftLabel(sh) + ' terkirim otomatis ✈️' : 'Kunci tersimpan, laporan gagal terkirim', ok ? 'ok' : 'err');
    });
  } catch (e) {}
}
function reopenNote(id) {
  const states = loadStates();
  if (!states[id]) return;
  if (!confirm('Buka lagi catatan ini?')) return;
  states[id] = { ...states[id], closed: 0, updated_at: nowIso() };
  localStorage.setItem(LS_ST, JSON.stringify(states));
  markDirtyState(id);
  renderSell(); renderStats(); syncSoon();
  toast('Catatan dibuka lagi', 'ok');
}

function toast(msg, type = 'info', ms = 2400) {
  const el = document.createElement('div');
  el.className = 'toast ' + type; el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 320); }, ms);
}
function tickClock() {
  const d = new Date();
  $('clock').textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('todayLabel').textContent = d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}
setInterval(tickClock, 10000); tickClock();

/* ---------- tabs ---------- */
document.querySelectorAll('.bottomnav .tab[data-tab]').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.bottomnav .tab').forEach(x => x.classList.remove('active'));
  b.classList.add('active');
  document.querySelectorAll('.tabpage').forEach(s => s.classList.add('hidden'));
  $('tab-' + b.dataset.tab).classList.remove('hidden');
  if (b.dataset.tab === 'stats') renderStats();
  if (b.dataset.tab === 'history') loadHistory();
  if (b.dataset.tab === 'products') renderProducts();
  window.scrollTo({ top: 0 });
}));

/* ---------- auth gate ---------- */
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
function authErr(m) { const e = $('authErr'); if (!m) { e.classList.add('hidden'); e.textContent = ''; return; } e.textContent = m; e.classList.remove('hidden'); }
function showAuth() { $('authScreen').classList.remove('hidden'); }
function hideAuth() { $('authScreen').classList.add('hidden'); authErr(null); }
/* ---------- auth gate (accounts, with legacy key fallback) ---------- */
let authMode = 'login'; // 'login' | 'register' — account pane tab
function setAuthMode(m) {
  authMode = m;
  $('authTabLogin').className = m === 'login' ? 'active-tab' : '';
  $('authTabReg').className = m === 'register' ? 'active-tab' : '';
  $('btnAuthGo').textContent = m === 'register' ? 'Daftar + buka' : 'Masuk';
  authErr(null);
}
function renderAcctChips() {
  const box = $('authChips');
  if (!box) return;
  box.innerHTML = '';
  Object.values(loadAccts()).forEach(a => {
    const b = document.createElement('button');
    b.className = 'chip'; b.type = 'button'; b.textContent = a.username;
    b.addEventListener('click', () => { $('authUser').value = a.username; $('authPass').focus(); });
    box.appendChild(b);
  });
  box.classList.toggle('hidden', !box.children.length);
}
async function checkGate() {
  const saved = loadSettings();
  $('shopTitle').textContent = saved.shop_name;
  $('authShopName').textContent = saved.shop_name;
  await probeAccounts();
  const legacy = $('authSetupPane'), login = $('authLoginPane'), acct = $('authAcctPane');
  if (accountsMode()) {
    legacy.classList.add('hidden'); login.classList.add('hidden'); acct.classList.remove('hidden');
    $('authHint').textContent = 'Masuk untuk membuka panel tokomu — setiap akun punya catatan sendiri.';
    renderAcctChips(); setAuthMode(authMode); refreshTitles();
    if (ACC.token) { hideAuth(); afterLogin(true); syncNow(); return; }
    showAuth(); return;
  }
  // Legacy path: old Worker (no accounts) or offline-only build.
  // Legacy mode always uses the shared unprefixed store.
  ACC = { uid: '', username: '', token: '' }; setNs('');
  loadSettings(); refreshTitles();
  if (SITE_ENFORCED) { $('keyModeHint').textContent = 'Satu kunci situs (GitHub secret SITE_KEY) untuk semua perangkat.'; $('kOld').closest('.lbl').classList.add('hidden'); $('kNew').closest('.lbl').classList.add('hidden'); $('btnChangeKey').classList.add('hidden'); }
  acct.classList.add('hidden');
  if (SITE_ENFORCED) {
    legacy.classList.add('hidden'); login.classList.remove('hidden');
    $('authHint').textContent = 'Toko ini dikunci — masukkan kunci situs.';
    if (sessionStorage.getItem('sn_unlocked') === '1') { hideAuth(); afterLogin(); return; }
    showAuth(); return;
  }
  if (!localStorage.getItem(LS_P)) {
    legacy.classList.remove('hidden'); login.classList.add('hidden');
    $('authHint').textContent = 'Baru pertama kali? Buat satu kunci privat.';
  } else if (sessionStorage.getItem('sn_unlocked') === '1') { hideAuth(); afterLogin(); return; }
  else { legacy.classList.add('hidden'); login.classList.remove('hidden'); }
  showAuth();
}
function validUsernameLoose(u) { return /^[a-z0-9][a-z0-9_.-]{2,19}$/i.test(String(u || '').trim()); }
async function doAccountAuth() {
  const u = $('authUser').value.trim(), p = $('authPass').value;
  if (!validUsernameLoose(u)) { authErr('Username 3–20 karakter (huruf/angka/_ . -).'); return; }
  if (!p || p.length < 4) { authErr('Password min. 4 karakter.'); return; }
  if (!SYNC_ON) { authErr('Sync mati — akun butuh koneksi Worker.'); return; }
  const endpoint = authMode === 'register' ? '/api/register' : '/api/login';
  toast(authMode === 'register' ? 'Mendaftar…' : 'Masuk…', 'info', 1500);
  let r, j = {};
  try {
    r = await fetch(SYNC_URL + endpoint, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p }),
    });
    j = await r.json().catch(() => ({}));
  } catch (e) {
    if (await unlockOffline(u, p)) return; // remembered account, offline unlock
    authErr('Offline — tidak ada koneksi ke server.'); return;
  }
  if (!r.ok || !j.ok) {
    const map = { username_taken: 'Username sudah dipakai orang lain.', invalid_login: 'Username / password salah.', bad_username: 'Username tidak valid.', bad_password: 'Password min. 4 karakter.', rate_limited: 'Terlalu sering — coba lagi nanti.' };
    authErr(map[j.error] || ('Gagal (' + r.status + ').')); return;
  }
  await enterAccount(j.account.id, j.account.username, j.token, p);
  toast((authMode === 'register' ? 'Akun dibuat ✓ Selamat datang, ' : 'Selamat datang, ') + j.account.username, 'ok');
}
async function unlockOffline(u, p) {
  // No connection: unlock with this device's remembered password verifier.
  const hit = Object.entries(loadAccts()).find(([, a]) => String(a.username).toLowerCase() === u.toLowerCase());
  if (!hit || !hit[1].verifier || !hit[1].token) return false;
  if ((await hashPin(p)) !== hit[1].verifier) { authErr('Password salah (offline).'); return true; }
  await enterAccount(hit[0], hit[1].username, hit[1].token, null, true);
  toast('Dibuka offline ✓ ' + hit[1].username, 'ok');
  return true;
}
async function enterAccount(uid, username, token, password, offline) {
  ACC = { uid, username, token };
  try { localStorage.setItem(LS_CUR, uid); } catch (e) {}
  setNs(uid);
  const accts = loadAccts();
  if (password) accts[uid] = { username, token, verifier: await hashPin(password) };
  else accts[uid] = { username, token, verifier: (accts[uid] && accts[uid].verifier) || '' };
  saveAccts(accts);
  $('authPass').value = '';
  hideAuth(); afterLogin(true);
  await syncNow(); // pull this panel first…
  await adoptLegacyIfEmpty(); // …then offer to move this device's old data in
  await syncNow();
}
async function adoptLegacyIfEmpty() {
  // First login on a device that still holds pre-account data: offer to move it
  // (with fresh ids so rows can never collide with other accounts) into this panel.
  if (!ACC.uid) return;
  if (loadEntries().length || loadNotes().length || loadProducts().length) return;
  let legE = [];
  try { legE = JSON.parse(localStorage.getItem('sn_entries')) || []; } catch (e) {}
  if (!legE.length) return;
  if (!confirm('Pindahkan ' + legE.length + ' penjualan lama di HP ini ke akun ' + ACC.username + '?')) return;
  const get = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const notes = get('sn_notes') || [];
  const nmap = {}; notes.forEach(n => { nmap[n.id] = uid(); });
  saveEntries(legE.map(e => ({ ...e, id: uid(), note_id: nmap[e.note_id] || '' })));
  saveNotes(notes.map(n => ({ ...n, id: nmap[n.id] })));
  const states = get('sn_states') || {}, ns2 = {};
  Object.keys(states).forEach(k => { if (nmap[k]) ns2[nmap[k]] = states[k]; });
  localStorage.setItem(LS_ST, JSON.stringify(ns2));
  saveProducts((get('sn_products') || []).map(p => ({ ...p, id: uid() })));
  const legS = get('sn_settings');
  if (legS) { try { Object.assign(settings, legS); } catch (e) {} localStorage.setItem(LS_S, JSON.stringify(settings)); }
  localStorage.setItem(LS_DSET, '1');
  localStorage.removeItem(LS_MG); migrate(); // marks everything dirty → uploaded next sync
  refreshTitles(); renderAll();
  toast('Data lama siap diunggah ✓', 'ok');
}
async function doSetup() {
  if (SITE_ENFORCED) { authErr('Kunci diatur di repo secret.'); return; }
  const a = $('setupKey').value.trim(), b = $('setupKey2').value.trim();
  if (a.length < 4) { authErr('Min. 4 karakter.'); return; }
  if (a !== b) { authErr('Tidak sama.'); return; }
  localStorage.setItem(LS_P, await hashPin(a));
  sessionKey = a; sessionStorage.setItem('sn_key', a); sessionStorage.setItem('sn_unlocked', '1');
  $('setupKey').value = ''; $('setupKey2').value = '';
  hideAuth(); afterLogin(); toast('Kunci dibuat ✓', 'ok');
}
async function doLogin() {
  const k = $('loginKey').value;
  if (!k) { authErr('Isi kunci.'); return; }
  const want = SITE_ENFORCED ? SITE_KEY_HASH : localStorage.getItem(LS_P);
  if ((await hashPin(k)) !== want) { authErr('Kunci salah.'); return; }
  $('loginKey').value = '';
  sessionKey = k; sessionStorage.setItem('sn_key', k); sessionStorage.setItem('sn_unlocked', '1');
  hideAuth(); afterLogin(); toast('Terbuka ✓', 'ok');
}
async function doLogout() {
  if (ACC.uid) {
    if (ACC.token && SYNC_ON && navigator.onLine) {
      try { await fetch(SYNC_URL + '/api/logout', { method: 'POST', headers: { 'Authorization': 'Bearer ' + ACC.token } }); } catch (e) {}
    }
    ACC = { uid: '', username: '', token: '' };
    try { localStorage.setItem(LS_CUR, ''); } catch (e) {}
    setNs('');
  }
  sessionStorage.removeItem('sn_unlocked'); sessionStorage.removeItem('sn_key');
  sessionKey = null;
  showAuth(); checkGate();
}
function afterLogin(skipSync) {
  loadSettings(); refreshTitles(); migrate();
  viewDate = todayStr();
  if (!shiftEnabled(viewShift)) viewShift = firstShift();
  $('viewDate').value = viewDate;
  $('histMonth').value = todayStr().slice(0, 7);
  $('statMonth').value = todayStr().slice(0, 7);
  setShift(viewShift);
  renderAll();
  if (!skipSync) syncNow();
}

/* ---------- settings ---------- */
/* ---------- settings (incl. per-account shift toggles) ---------- */
const SHIFT_KEYS = ['pagi', 'siang', 'lembur'];
function normShifts(v) {
  const d = { pagi: true, siang: true, lembur: true };
  if (v && typeof v === 'object') SHIFT_KEYS.forEach(k => { d[k] = v[k] !== false; });
  if (!d.pagi && !d.siang && !d.lembur) d.pagi = true; // at least one stays on
  return d;
}
function shiftEnabled(s) { return normShifts(settings.shifts)[normShift(s)]; }
function firstShift() { const c = normShifts(settings.shifts); return SHIFT_KEYS.find(k => c[k]) || 'pagi'; }
function loadSettings() {
  settings.shop_name = 'My Sales Notes'; settings.currency = 'Rp'; settings.shifts = null;
  try { Object.assign(settings, JSON.parse(localStorage.getItem(LS_S)) || {}); } catch (e) {}
  settings.shifts = normShifts(settings.shifts);
  return settings;
}
function refreshTitles() {
  $('shopTitle').textContent = settings.shop_name || 'My Sales Notes';
  $('authShopName').textContent = settings.shop_name || 'My Sales Notes';
  document.title = (settings.shop_name || 'My Sales Notes') + ' — Kasir';
  $('sShop').value = settings.shop_name || ''; $('sCur').value = settings.currency || 'Rp';
  renderShiftToggles();
  const acctLine = $('acctLine');
  if (acctLine) acctLine.innerHTML = ACC.uid
    ? ('Masuk sebagai <b>' + esc(ACC.username) + '</b> · panel pribadi tersinkron ke semua perangkat.')
    : 'Mode kunci lama — daftar/masuk untuk panel pribadi per akun.';
}
function renderShiftToggles() {
  const c = normShifts(settings.shifts);
  SHIFT_KEYS.forEach(k => {
    const b = $('shiftTg_' + k);
    if (b) b.className = c[k] ? 'on' : 'off';
  });
}
function toggleShift(k) {
  const c = normShifts(settings.shifts);
  c[k] = !c[k];
  if (!c.pagi && !c.siang && !c.lembur) { toast('Minimal 1 shift aktif', 'err'); return; }
  settings.shifts = c;
  saveSettings();
}
function saveSettings() {
  settings.shop_name = $('sShop').value.trim() || 'My Sales Notes';
  settings.currency = $('sCur').value.trim() || 'Rp';
  settings.shifts = normShifts(settings.shifts);
  localStorage.setItem(LS_S, JSON.stringify(settings));
  localStorage.setItem(LS_SU, nowIso());
  try { localStorage.setItem(LS_DSET, '1'); } catch (e) {}
  if (!shiftEnabled(viewShift)) setShift(firstShift());
  refreshTitles(); renderAll(); syncSoon(); toast('Tersimpan ✓ — dikirim ke semua perangkat', 'ok');
}
async function changeKey() {
  const o = $('kOld').value, n = $('kNew').value.trim();
  if (!o || n.length < 4) { toast('Password lama + baru (min 4) wajib', 'err'); return; }
  if (ACC.uid) {
    // Account mode: change login password server-side (revokes other devices).
    if (!SYNC_ON || !navigator.onLine) { toast('Butuh koneksi untuk ganti password', 'err'); return; }
    try {
      const r = await fetch(SYNC_URL + '/api/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + ACC.token },
        body: JSON.stringify({ old_password: o, new_password: n }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { toast(j.error === 'wrong_password' ? 'Password lama salah' : 'Gagal ganti password', 'err'); return; }
      const accts = loadAccts();
      if (accts[ACC.uid]) { accts[ACC.uid].verifier = await hashPin(n); saveAccts(accts); }
      $('kOld').value = ''; $('kNew').value = ''; toast('Password diganti ✓', 'ok');
    } catch (e) { toast('Offline — coba lagi nanti', 'err'); }
    return;
  }
  if (SITE_ENFORCED) { toast('Kunci situs diatur di GitHub secret.', 'err'); return; }
  if ((await hashPin(o)) !== localStorage.getItem(LS_P)) { toast('Kunci lama salah', 'err'); return; }
  localStorage.setItem(LS_P, await hashPin(n));
  $('kOld').value = ''; $('kNew').value = ''; toast('Kunci diganti ✓', 'ok');
}

/* ---------- shared ---------- */
function summarize(list) {
  const s = { total: 0, count: list.length, cash_total: 0, cash_count: 0, qris_total: 0, qris_count: 0 };
  list.forEach(e => {
    s.total += e.subtotal;
    if (e.payment === 'qris') { s.qris_total += e.subtotal; s.qris_count++; } else { s.cash_total += e.subtotal; s.cash_count++; }
  });
  s.total = Math.round(s.total * 100) / 100;
  s.cash_total = Math.round(s.cash_total * 100) / 100;
  s.qris_total = Math.round(s.qris_total * 100) / 100;
  return s;
}
const dayEntries = date => loadEntries().filter(e => !e.deleted && e.date === date);
function setPay(p) {
  payMethod = p;
  $('payCash').className = p === 'cash' ? 'active-cash' : '';
  $('payQris').className = p === 'qris' ? 'active-qris' : '';
}
function setShift(s) {
  let sh = normShift(s);
  if (!shiftEnabled(sh)) sh = firstShift();
  viewShift = sh;
  const ids = { pagi: 'shiftPagi', siang: 'shiftSiang', lembur: 'shiftLembur' };
  SHIFT_KEYS.forEach(k => {
    const el = $(ids[k]);
    if (!el) return;
    el.style.display = shiftEnabled(k) ? '' : 'none';
    el.className = viewShift === k ? 'active-shift' : '';
  });
  try { if (viewDate) renderSell(); } catch (e) {}
}

/* ---------- SELL ---------- */
function safe(fn) { try { fn(); } catch (e) { try { console.warn(e); } catch (_) {} } }
function renderAll() { safe(renderSell); safe(renderProducts); safe(renderStats); safe(loadHistory); safe(loadHeader); }
function loadHeader() {
  const t = summarize(dayEntries(todayStr()));
  $('stToday').textContent = money(t.total);
}
function renderSell() {
  const list = dayEntries(viewDate || todayStr());
  const s = summarize(list);
  $('totalLabel').textContent = 'Total · ' + (viewDate || todayStr());
  $('salesDate').textContent = '· ' + (viewDate || todayStr());
  $('dayTotal').textContent = money(s.total);
  $('cashTotal').textContent = money(s.cash_total); $('cashCount').textContent = s.cash_count;
  $('qrisTotal').textContent = money(s.qris_total); $('qrisCount').textContent = s.qris_count;
  $('dayCount').textContent = s.count;
  // Per-shift breakdown (Pagi / Siang / Lembur) for the viewed day.
  try {
    const byId = {};
    loadNotes().forEach(n => { byId[n.id] = n; });
    const sums = { pagi: { t: 0, c: 0 }, siang: { t: 0, c: 0 }, lembur: { t: 0, c: 0 } };
    list.forEach(e => {
      const n = byId[e.note_id];
      const sh = normShift(n ? n.shift : 'pagi');
      sums[sh].t += e.subtotal; sums[sh].c++;
    });
    const el = $('shiftTotals');
    if (el) el.textContent = `☀️ Pagi: ${money(sums.pagi.t)} (${sums.pagi.c}) · 🌤️ Siang: ${money(sums.siang.t)} (${sums.siang.c}) · 🌙 Lembur: ${money(sums.lembur.t)} (${sums.lembur.c})`;
  } catch (e) {}
  try {
    const hint = $('shareHint');
    if (hint) {
      const se = shiftEntries(viewDate || todayStr(), viewShift);
      const ss = summarize(se);
      hint.textContent = shiftBadge(viewShift) + ' · ' + (viewDate || todayStr()) + ' · ' + money(ss.total) + ' (' + ss.count + ' sales) — yang dibagikan hanya shift ini.';
    }
  } catch (e) {}
  renderDayList(list); loadHeader();
}
/* single direct-save form (merged cart + manual input) */
function fillForm(name, price) {
  $('fItem').value = name;
  $('fPrice').value = price;
  if (!Number($('fQty').value)) $('fQty').value = 1;
  updSub();
  $('fQty').focus();
  toast(name + ' → form', 'ok', 1200);
}
function updSub() {
  const q = Number($('fQty').value || 0), pr = Number($('fPrice').value || 0);
  $('fSub').textContent = money(q * pr);
}
function saveManual() {
  const item = $('fItem').value.trim();
  const qty = Math.floor(Number($('fQty').value || 0));
  const price = Number($('fPrice').value);
  if (!item) { toast('Nama barang wajib', 'err'); $('fItem').focus(); return; }
  if (!(qty > 0)) { toast('Qty harus > 0', 'err'); $('fQty').focus(); return; }
  if (!isFinite(price) || price < 0) { toast('Harga wajib (0 boleh)', 'err'); $('fPrice').focus(); return; }
  if (!shiftEnabled(viewShift)) { setShift(firstShift()); toast('Shift dialihkan ke ' + shiftLabel(viewShift), 'info'); }
  const note = writableNote(viewDate, viewShift);
  const now = nowIso();
  const sub = Math.round(qty * price * 100) / 100;
  const id = uid();
  const all = loadEntries();
  all.push({ id, note_id: note.id, date: viewDate, item, qty, price, subtotal: sub, payment: payMethod, note: '', created_at: now, updated_at: now, deleted: 0 });
  saveEntries(all);
  markDirty(id);
  $('fItem').value = ''; $('fQty').value = 1; $('fPrice').value = '';
  updSub();
  renderSell(); renderStats();
  toast(item + ' tersimpan ✓ ' + shiftLabel(viewShift) + ' (' + payMethod.toUpperCase() + ')', 'ok', 1500);
  syncSoon();
  setTimeout(() => $('fItem').focus(), 50);
}
function renderDayList(list) {
  const box = $('entries'); box.innerHTML = '';
  $('entriesEmpty').classList.toggle('hidden', list.length > 0);
  const byId = {};
  loadNotes().forEach(n => { byId[n.id] = n; });
  const groups = {};
  list.forEach(e => { const k = e.note_id || ''; (groups[k] = groups[k] || []).push(e); });
  Object.keys(groups)
    .sort((a, b) => {
      const na = byId[a], nb = byId[b];
      const sa = na ? normShift(na.shift) : 'pagi', sb = nb ? normShift(nb.shift) : 'pagi';
      if (sa !== sb) return (SHIFT_ORDER[sa] ?? 0) - (SHIFT_ORDER[sb] ?? 0);
      return String(na ? na.created_at : '').localeCompare(String(nb ? nb.created_at : ''));
    })
    .forEach(nid => {
      const n = byId[nid];
      const items = groups[nid].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const s = summarize(items);
      const sec = document.createElement('div');
      sec.className = 'note-sec';
      const locked = nid && isClosed(nid);
      const badge = n ? shiftBadge(n.shift) : '☀️ Pagi';
      const head = document.createElement('div');
      head.className = 'note-sec-head';
      head.innerHTML = `<b>${locked ? '🔒' : '📝'} ${esc(n ? n.title : 'Catatan')} · ${badge}</b><span>${items.length} item · ${esc(money(s.total))}</span>`;
      if (nid && n) {
        const lb = document.createElement('button');
        lb.className = 'btn small ghost';
        lb.textContent = locked ? 'Buka' : '🔒 Kunci';
        lb.addEventListener('click', () => { locked ? reopenNote(nid) : closeNote(nid); });
        head.appendChild(lb);
      }
      sec.appendChild(head);
      items.forEach(e => {
        const d = document.createElement('div');
        d.className = 'entry';
        d.innerHTML = `<div><div class="ename">${esc(e.item)}</div>
          <div class="emeta">${e.qty} × ${esc(money(e.price))} · <span class="paybadge ${e.payment}">${e.payment === 'qris' ? 'QRIS' : 'Cash'}</span></div></div>
          <div class="esub">${esc(money(e.subtotal))}</div>
          ${locked ? '' : '<div class="eactions"><button class="btn small ghost">Hapus</button></div>'}`;
        if (!locked) d.querySelector('button').addEventListener('click', () => delEntry(e.id));
        sec.appendChild(d);
      });
      box.appendChild(sec);
    });
}
function delEntry(id) {
  if (!confirm('Hapus penjualan ini?')) return;
  const all = loadEntries();
  const i = all.findIndex(e => e.id === id);
  if (i < 0) return;
  if (all[i].note_id && isClosed(all[i].note_id)) { toast('Catatan dikunci 🔒 — buka dulu untuk menghapus', 'err'); return; }
  all[i] = { ...all[i], deleted: 1, updated_at: nowIso() };
  saveEntries(all); markDirty(id);
  renderSell(); renderStats(); syncSoon(); toast('Dihapus', 'ok');
}

/* ---------- PRODUCTS ---------- */
function renderProducts() {
  if (!$('productList')) return;
  const list = loadProducts().filter(p => !p.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const box = $('productList'); box.innerHTML = '';
  $('productEmpty').classList.toggle('hidden', list.length > 0);
  list.forEach(p => {
    const d = document.createElement('div');
    d.className = 'pcard';
    d.innerHTML = `<div><b>${esc(p.name)}</b><small>${esc(money(p.price))}</small></div>
      <div class="pact"><button class="btn small">＋</button><button class="btn small ghost">✏️</button><button class="btn small ghost">🗑</button></div>`;
    const [bAdd, bEdit, bDel] = d.querySelectorAll('button');
    bAdd.addEventListener('click', () => {
      fillForm(p.name, p.price);
      document.querySelector('.bottomnav .tab[data-tab=sell]').click();
    });
    bEdit.addEventListener('click', () => {
      editPid = p.id; $('editPid').value = p.id;
      $('pName').value = p.name; $('pPrice').value = p.price;
      $('btnSaveProduct').textContent = '💾 Update';
      $('btnCancelProduct').classList.remove('hidden');
      $('pName').focus();
    });
    bDel.addEventListener('click', () => delProduct(p.id));
    box.appendChild(d);
  });
}
function saveProduct() {
  const name = $('pName').value.trim().slice(0, 100);
  const price = Number($('pPrice').value);
  if (!name) { toast('Nama produk wajib', 'err'); return; }
  if (!isFinite(price) || price < 0) { toast('Harga wajib', 'err'); return; }
  const list = loadProducts();
  const now = nowIso();
  if (editPid) {
    const i = list.findIndex(p => p.id === editPid);
    if (i >= 0) { list[i] = { ...list[i], name, price, updated_at: now, deleted: 0 }; markDirtyProduct(editPid); }
    toast('Produk diupdate ✓', 'ok');
  } else {
    const id = uid();
    list.push({ id, name, price, created_at: now, updated_at: now, deleted: 0 });
    markDirtyProduct(id);
    toast(name + ' ditambah ✓', 'ok');
  }
  saveProducts(list); cancelProductForm(); renderProducts(); syncSoon();
}
function cancelProductForm() {
  editPid = null; $('editPid').value = '';
  $('pName').value = ''; $('pPrice').value = '';
  $('btnSaveProduct').textContent = '💾 Simpan';
  $('btnCancelProduct').classList.add('hidden');
}
function delProduct(id) {
  const p = loadProducts().find(x => x.id === id);
  if (!p) return;
  if (!confirm(`Hapus "${p.name}"?`)) return;
  const list = loadProducts();
  const i = list.findIndex(x => x.id === id);
  list[i] = { ...list[i], deleted: 1, updated_at: nowIso() };
  saveProducts(list); markDirtyProduct(id);
  renderProducts(); syncSoon(); toast('Produk dihapus', 'ok');
}

/* ---------- STATS ---------- */
function renderStats() {
  if (!$('statMonth')) return;
  const m = $('statMonth').value || todayStr().slice(0, 7);
  $('statsLabel').textContent = 'Periode ' + m;
  const all = loadEntries().filter(e => !e.deleted);
  const t = summarize(all.filter(e => e.date === todayStr()));
  const mo = all.filter(e => e.date.slice(0, 7) === m);
  const ms = summarize(mo);
  const days = new Set(mo.map(e => e.date)).size;
  $('statToday').textContent = money(t.total);
  $('statMonthTotal').textContent = money(ms.total);
  $('statAvg').textContent = money(days ? ms.total / days : 0);
  $('statCash').textContent = money(ms.cash_total);
  $('statQris').textContent = money(ms.qris_total);
  $('statCount').textContent = ms.count + ' trx';
  const tot = ms.cash_total + ms.qris_total;
  const cp = tot ? Math.round(ms.cash_total / tot * 100) : 50;
  $('splitCashBar').style.width = cp + '%'; $('splitQrisBar').style.width = (100 - cp) + '%';
  $('splitLabel').textContent = `Cash ${cp}% · QRIS ${100 - cp}%`;
  // last 7 days: bars = earnings (Rp), line = sales count (trx)
  const labels = [], vals = [], counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = localDay(d);
    const dayList = all.filter(e => e.date === ds);
    labels.push(ds.slice(8));
    vals.push(dayList.reduce((a, e) => a + e.subtotal, 0));
    counts.push(dayList.length);
  }
  drawBars($('chartWeek'), vals, labels, counts);
  // best sellers
  const byItem = {};
  mo.forEach(e => { byItem[e.item] = byItem[e.item] || { qty: 0, total: 0 }; byItem[e.item].qty += e.qty; byItem[e.item].total += e.subtotal; });
  const top = Object.entries(byItem).sort((a, b) => b[1].total - a[1].total).slice(0, 5);
  const bl = $('bestList'); bl.innerHTML = top.length ? '' : '<p class="muted small">Belum ada data bulan ini.</p>';
  top.forEach(([name, v]) => {
    const r = document.createElement('div');
    r.className = 'best-row';
    r.innerHTML = `<span>${esc(name)} <small class="muted">×${v.qty}</small></span><b>${esc(money(v.total))}</b>`;
    bl.appendChild(r);
  });
}
function drawBars(cv, vals, labels, counts) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 320, H = 150;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...vals, 1);
  const maxC = Math.max(...(counts || []), 1);
  const n = vals.length, bw = (W - 16) / n;
  const pts = [];
  vals.forEach((v, i) => {
    const h = Math.max(4, (v / max) * (H - 46));
    const x = 8 + i * bw + bw * 0.2, w = bw * 0.6, y = H - 22 - h;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#34d399'); g.addColorStop(1, '#0ea5e9');
    ctx.fillStyle = i === n - 1 ? g : '#24314f';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); }
    else ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8b96b3'; ctx.font = '10px Inter,system-ui'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + w / 2, H - 8);
    // sales count dot position (scaled to same plot height)
    const c = (counts && counts[i]) || 0;
    const cy = H - 22 - Math.max(0, (c / maxC) * (H - 46));
    pts.push([x + w / 2, cy, c, v]);
  });
  if (counts) {
    ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach(([x, y], i) => { i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    pts.forEach(([x, y, c]) => {
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fde68a'; ctx.font = 'bold 9px Inter,system-ui'; ctx.textAlign = 'center';
      ctx.fillText(c + 'x', x, y - 7);
    });
  }
}

/* ---------- history ---------- */
function openDay(date) {
  viewDate = date;
  $('viewDate').value = date;
  safe(renderSell);
  const t = document.querySelector('.bottomnav .tab[data-tab="sell"]');
  if (t) t.click();
  else { document.querySelectorAll('.tabpage').forEach(s => s.classList.add('hidden')); $('tab-sell').classList.remove('hidden'); }
  window.scrollTo({ top: 0 });
}
function loadHistory() {
  if (!$('histMonth')) return;
  const m = $('histMonth').value || todayStr().slice(0, 7);
  const inMonth = loadEntries().filter(e => !e.deleted && e.date.slice(0, 7) === m);
  const byDay = {};
  inMonth.forEach(e => { (byDay[e.date] = byDay[e.date] || []).push(e); });
  const days = Object.keys(byDay).sort().reverse().map(d => ({ date: d, ...summarize(byDay[d]) }));
  const mt = summarize(inMonth);
  $('histTotal').textContent = money(mt.total);
  $('histCount').textContent = days.length + ' hari · ' + mt.count + ' trx';
  $('histAvg').textContent = money(days.length ? mt.total / days.length : 0);
  const tb = $('histTable').querySelector('tbody'); tb.innerHTML = '';
  if (!days.length) { tb.innerHTML = '<tr><td colspan="3" class="muted center">Belum ada penjualan.</td></tr>'; return; }
  days.forEach(d => {
    const tr = document.createElement('tr');
    tr.className = 'day-row';
    tr.innerHTML = `<td><b>${esc(d.date)}</b></td><td>${d.count}</td><td><b>${esc(money(d.total))}</b> <span class="link">›</span></td>`;
    tr.addEventListener('click', () => openDay(d.date));
    tb.appendChild(tr);
  });
}

/* ---------- backup ---------- */
/* ---------- share per-shift report (WA text + Excel CSV) ---------- */
function shiftEntries(date, shift) {
  const sh = normShift(shift ?? viewShift);
  const byId = {};
  loadNotes().forEach(n => { byId[n.id] = n; });
  return loadEntries()
    .filter(e => !e.deleted && e.date === date)
    .filter(e => normShift(byId[e.note_id] ? byId[e.note_id].shift : 'pagi') === sh)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
}
function fmtDateId(date) {
  try {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) { return date; }
}
function fmtTimeShort(d) {
  try {
    return new Date(d).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '');
  } catch (e) { return ''; }
}
function buildShiftReport(date, shift) {
  // Plain-text version: used for Copy / file fallback. Clean, no markdown symbols.
  const sh = normShift(shift ?? viewShift);
  const list = shiftEntries(date, sh);
  const s = summarize(list);
  const shop = settings.shop_name || 'My Sales Notes';
  const dateId = fmtDateId(date);
  const avg = s.count ? Math.round(s.total / s.count) : 0;
  const cashPct = s.total ? Math.round(s.cash_total / s.total * 100) : 0;
  const qrisPct = s.total ? Math.round(s.qris_total / s.total * 100) : 0;
  const bar = '━━━━━━━━━━━━━━';
  const lines = [];
  lines.push('LAPORAN PENJUALAN — ' + shop.toUpperCase());
  lines.push(bar);
  lines.push('Tanggal : ' + dateId);
  lines.push('Shift   : ' + shiftBadge(sh));
  lines.push(bar);
  lines.push('Total Pendapatan : ' + money(s.total));
  lines.push('Transaksi : ' + s.count + 'x  |  Rata-rata : ' + money(avg));
  lines.push('Tunai : ' + money(s.cash_total) + ' (' + s.cash_count + 'x, ' + cashPct + '%)');
  lines.push('QRIS  : ' + money(s.qris_total) + ' (' + s.qris_count + 'x, ' + qrisPct + '%)');
  lines.push(bar);
  if (!list.length) lines.push('Belum ada transaksi pada shift ini.');
  else {
    lines.push('Rincian Transaksi (' + list.length + ') :');
    list.forEach((e, i) => {
      const pay = e.payment === 'qris' ? 'QRIS' : 'Tunai';
      lines.push((i + 1) + '. ' + e.item + ' — ' + e.qty + ' x ' + money(e.price) + ' = ' + money(e.subtotal) + ' [' + pay + ']');
    });
  }
  lines.push(bar);
  lines.push('Disusun otomatis • ' + shop + ' • ' + fmtTimeShort(new Date()));
  return { list, summary: s, text: lines.join('\n') };
}
function buildShiftReportHtml(date, shift) {
  // Rich version for Telegram (parse_mode HTML). Proper <b>/<i>, escaped, truncated safely.
  const sh = normShift(shift ?? viewShift);
  const list = shiftEntries(date, sh);
  const s = summarize(list);
  const shop = settings.shop_name || 'My Sales Notes';
  const shopEsc = esc(shop);
  const shopUpEsc = esc(shop.toUpperCase());
  const dateId = esc(fmtDateId(date));
  const avg = s.count ? Math.round(s.total / s.count) : 0;
  const cashPct = s.total ? Math.round(s.cash_total / s.total * 100) : 0;
  const qrisPct = s.total ? Math.round(s.qris_total / s.total * 100) : 0;
  const bar = '━━━━━━━━━━━━━━';
  const L = [];
  L.push('🧾 <b>LAPORAN PENJUALAN</b>');
  L.push('<b>' + shopUpEsc + '</b>');
  L.push(bar);
  L.push('📅 ' + dateId);
  L.push('⏰ Shift: <b>' + esc(shiftBadge(sh)) + '</b>');
  L.push(bar);
  L.push('💰 Total Pendapatan');
  L.push('<b>' + esc(money(s.total)) + '</b>  •  ' + s.count + ' transaksi');
  L.push('Rata-rata: ' + esc(money(avg)) + ' / transaksi');
  L.push('');
  L.push('💵 Tunai: <b>' + esc(money(s.cash_total)) + '</b> (' + s.cash_count + 'x, ' + cashPct + '%)');
  L.push('📱 QRIS: <b>' + esc(money(s.qris_total)) + '</b> (' + s.qris_count + 'x, ' + qrisPct + '%)');
  L.push(bar);
  if (!list.length) {
    L.push('<i>Belum ada transaksi pada shift ini.</i>');
  } else {
    L.push('🧾 <b>Rincian Transaksi (' + list.length + ')</b>');
    const MAX_ITEMS = 60;
    const shown = list.slice(0, MAX_ITEMS);
    shown.forEach((e, i) => {
      const payIcon = e.payment === 'qris' ? '📱' : '💵';
      L.push('<b>' + (i + 1) + '.</b> ' + esc(e.item));
      L.push('   ' + e.qty + ' × ' + esc(money(e.price)) + ' = <b>' + esc(money(e.subtotal)) + '</b>  ' + payIcon);
    });
    if (list.length > MAX_ITEMS) L.push('<i>… +' + (list.length - MAX_ITEMS) + ' transaksi lainnya (lihat Excel)</i>');
  }
  L.push(bar);
  L.push('<i>Disusun otomatis • ' + shopEsc + ' • ' + esc(fmtTimeShort(new Date())) + '</i>');
  return { list, summary: s, html: L.join('\n') };
}
function shiftExcelContent(date, shift) {
  // HTML-table .xls: Excel opens it with title, colored header, borders,
  // and real numbers (Qty/Harga/Subtotal) so SUM() works.
  const sh = normShift(shift ?? viewShift);
  const { list, summary } = buildShiftReport(date, sh);
  const shop = settings.shop_name || 'My Sales Notes';
  let dateId = date;
  try {
    const [y, m, d] = date.split('-').map(Number);
    dateId = new Date(y, m - 1, d).toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  } catch (e) {}
  const avg = summary.count ? Math.round(summary.total / summary.count) : 0;
  const num = 'mso-number-format:"#,##0";';
  const th = 'background:#1F4E5F;color:#FFFFFF;font-weight:bold;text-align:center;';
  const td = 'border:.5pt solid #B0B0B0;';
  const right = td + 'text-align:right;' + num;
  const center = td + 'text-align:center;';
  let h = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">';
  h += '<head><meta charset="UTF-8"></head><body><table border="1" cellpadding="4" cellspacing="0">';
  h += '<tr><td colspan="6" style="font-size:16pt;font-weight:bold;">LAPORAN PENJUALAN — ' + esc(shop.toUpperCase()) + '</td></tr>';
  h += '<tr><td colspan="6">Tanggal: ' + esc(dateId) + ' &nbsp;|&nbsp; Shift: ' + esc(shiftLabel(sh)) + '</td></tr>';
  h += '<tr><td colspan="6"></td></tr>';
  h += '<tr><td style="' + th + '">No</td><td style="' + th + '">Item</td><td style="' + th + '">Qty</td>'
    + '<td style="' + th + '">Harga (Rp)</td><td style="' + th + '">Subtotal (Rp)</td><td style="' + th + '">Pembayaran</td></tr>';
  list.forEach((e, i) => {
    const pay = e.payment === 'qris' ? 'QRIS' : 'Tunai';
    h += '<tr><td style="' + center + '">' + (i + 1) + '</td>'
      + '<td style="' + td + '">' + esc(e.item) + '</td>'
      + '<td style="' + center + '">' + e.qty + '</td>'
      + '<td style="' + right + '">' + e.price + '</td>'
      + '<td style="' + right + '">' + e.subtotal + '</td>'
      + '<td style="' + center + '">' + pay + '</td></tr>';
  });
  h += '<tr><td colspan="6"></td></tr>';
  const sumRow = (label, val, extra) =>
    '<tr><td colspan="4" style="' + td + 'font-weight:bold;">' + label + '</td>'
    + '<td style="' + right + 'font-weight:bold;">' + val + '</td>'
    + '<td style="' + td + '">' + extra + '</td></tr>';
  h += sumRow('Total Pendapatan', summary.total, summary.count + ' transaksi');
  h += sumRow('Tunai', summary.cash_total, summary.cash_count + ' trx');
  h += sumRow('QRIS', summary.qris_total, summary.qris_count + ' trx');
  h += sumRow('Rata-rata / transaksi', avg, '');
  h += '<tr><td colspan="6">Disusun otomatis oleh ' + esc(shop) + '</td></tr>';
  h += '</table></body></html>';
  return h;
}
function shiftFileName(date, shift, ext) {
  return 'sales-' + date + '-' + normShift(shift ?? viewShift) + '.' + ext;
}
function downloadShiftExcel() {
  const date = viewDate || todayStr();
  const { list } = buildShiftReport(date, viewShift);
  if (!list.length) { toast('Shift ini masih kosong', 'err'); return; }
  const blob = new Blob([shiftExcelContent(date, viewShift)], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = shiftFileName(date, viewShift, 'xls');
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Excel shift ' + shiftLabel(viewShift) + ' diunduh ✓', 'ok');
}
async function copyShiftReport() {
  const date = viewDate || todayStr();
  const { list, text } = buildShiftReport(date, viewShift);
  if (!list.length) { toast('Shift ini masih kosong', 'err'); return; }
  try { await navigator.clipboard.writeText(text); toast('Teks laporan disalin ✓', 'ok'); }
  catch (e) { toast('Gagal menyalin', 'err'); }
}
async function postShiftReport(date, shift) {
  // Sends via Worker proxy (bot token stays server-side). Returns true on success.
  // Uses rich HTML formatting so Telegram renders bold/italic properly.
  if (!SYNC_ON) return false;
  if (!authed()) return false;
  if (!navigator.onLine) return false;
  const { html } = buildShiftReportHtml(date, shift);
  try {
    const r = await fetch(SYNC_URL + '/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken() },
      body: JSON.stringify({ date, shift: normShift(shift), text: html, parse_mode: 'HTML' }),
    });
    return r.ok;
  } catch (e) { return false; }
}
async function sendShiftTelegram() {
  const date = viewDate || todayStr();
  const { list } = buildShiftReport(date, viewShift);
  if (!list.length) { toast('Shift ini masih kosong', 'err'); return; }
  if (!SYNC_ON) { toast('Sync mati — Telegram butuh Worker', 'err'); return; }
  if (!authed()) { toast('Masuk dulu', 'err'); return; }
  toast('Mengirim ke Telegram…', 'info', 1500);
  const ok = await postShiftReport(date, viewShift);
  toast(ok ? 'Terkirim ke Telegram ✓ ' + shiftLabel(viewShift) : 'Gagal kirim — cek koneksi / bot', ok ? 'ok' : 'err');
}
async function shareShiftFile() {
  const date = viewDate || todayStr();
  const { list } = buildShiftReport(date, viewShift);
  if (!list.length) { toast('Shift ini masih kosong', 'err'); return; }
  const file = new File([shiftExcelContent(date, viewShift)], shiftFileName(date, viewShift, 'xls'), { type: 'application/vnd.ms-excel' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Laporan ' + shiftLabel(viewShift) + ' ' + date }); return; }
    catch (e) { if (String(e && e.name) === 'AbortError') return; }
  }
  // Fallback: download the Excel file.
  downloadShiftExcel();
}
function exportDB() {
  const blob = new Blob([JSON.stringify({ entries: loadEntries(), notes: loadNotes(), states: loadStates(), products: loadProducts(), settings, exported_at: nowIso() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sales-notes-' + todayStr() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Backup diunduh', 'ok');
}
async function importDB() {
  const f = $('importFile').files[0];
  if (!f) { toast('Pilih file JSON dulu', 'err'); return; }
  let j;
  try { j = JSON.parse(await f.text()); } catch (e) { toast('JSON tidak valid', 'err'); return; }
  const incoming = j.entries || j.sales;
  if (!incoming) { toast('File backup salah', 'err'); return; }
  if (!confirm('OK = TIMPA semua data\nCancel = TAMBAH di atas')) return;
  const stamp = nowIso();
  const list = [];
  (Array.isArray(incoming) ? incoming : []).forEach(e => {
    const date = String(e.date || '').trim();
    const item = String(e.item || e.name || '').trim();
    const qty = Number(e.qty ?? 1), price = Number(e.price ?? 0);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !item || !(qty > 0) || !(price >= 0)) return;
    const payment = String(e.payment || 'cash').toLowerCase() === 'qris' ? 'qris' : 'cash';
    list.push({ id: String(e.id || uid()), note_id: String(e.note_id || ''), date, item, qty, price, subtotal: Math.round(qty * price * 100) / 100, payment, note: '', created_at: e.created_at || stamp, updated_at: stamp, deleted: 0 });
  });
  saveEntries(list);
  if (j.settings && (j.settings.shop_name || j.settings.currency || j.settings.shifts)) {
  if (j.settings.shop_name) settings.shop_name = String(j.settings.shop_name).slice(0, 60);
  if (j.settings.currency) settings.currency = String(j.settings.currency).slice(0, 10);
  if (j.settings.shifts) settings.shifts = normShifts(j.settings.shifts);
    localStorage.setItem(LS_S, JSON.stringify(settings));
    localStorage.setItem(LS_SU, nowIso());
    try { localStorage.setItem(LS_DSET, '1'); } catch (e) {}
  }
  if (Array.isArray(j.notes)) {
    const nn = j.notes.map(n => ({ ...n, shift: normShift(n.shift || 'pagi') }));
    saveNotes(nn);
  }
  if (j.states) localStorage.setItem(LS_ST, JSON.stringify(j.states));
  if (Array.isArray(j.products)) { saveProducts(j.products); localStorage.setItem(LS_DP, JSON.stringify(j.products.map(p => p.id))); }
  localStorage.removeItem(LS_MG); migrate();
  $('importFile').value = '';
  renderAll(); syncSoon(); toast('Import ' + list.length + ' sales ✓', 'ok');
}

/* ---------- cloud sync (offline-first, +products) ---------- */
let syncing = false, syncTimer = null;
const LS_OK = 'sn_last_ok';
function pendingCount() {
  try {
    return (JSON.parse(localStorage.getItem(LS_D) || '[]').length)
      + (JSON.parse(localStorage.getItem(LS_DN) || '[]').length)
      + (JSON.parse(localStorage.getItem(LS_DS) || '[]').length)
      + (JSON.parse(localStorage.getItem(LS_DP) || '[]').length)
      + (localStorage.getItem(LS_DSET) === '1' ? 1 : 0);
  } catch (e) { return 0; }
}
function lastOkLabel() {
  const t = localStorage.getItem(LS_OK);
  if (!t) return 'belum pernah';
  try {
    const d = new Date(t);
    return d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  } catch (e) { return t; }
}
function setSyncState(s) {
  const el = $('syncDot');
  if (!el) return;
  const map = { ok: ['✓ synced', '#34d399'], sync: ['… syncing', '#fbbf24'], offline: ['✕ offline', '#f87171'], off: ['– sync off', '#8b96b3'], key: ['! masuk ulang', '#f87171'] };
  const [t, c] = map[s] || map.off;
  el.textContent = t; el.style.color = c;
  el.title = s === 'ok' ? ('terakhir sinkron ' + lastOkLabel())
    : s === 'offline' ? ('offline — tersimpan di HP ini, terkirim nanti · ' + pendingCount() + ' menunggu · terakhir ok ' + lastOkLabel())
    : t;
}
function sessionExpired() {
  setSyncState('key');
  syncing = false;
  if (ACC.uid) {
    // Token revoked/expired: keep username+verifier so offline unlock still works.
    ACC.token = '';
    const accts = loadAccts();
    if (accts[ACC.uid]) { accts[ACC.uid].token = ''; saveAccts(accts); }
    toast('Sesi berakhir — masuk lagi', 'err');
    showAuth(); checkGate();
  }
}
async function syncNow() {
  if (!SYNC_ON) { setSyncState('off'); return; }
  if (!authed()) return;
  if (syncing || !navigator.onLine) { if (!navigator.onLine) setSyncState('offline'); return; }
  syncing = true; setSyncState('sync');
  try {
    const dirtyIds = JSON.parse(localStorage.getItem(LS_D) || '[]');
    const dirtyNotes = JSON.parse(localStorage.getItem(LS_DN) || '[]');
    const dirtyStates = JSON.parse(localStorage.getItem(LS_DS) || '[]');
    const dirtyProds = JSON.parse(localStorage.getItem(LS_DP) || '[]');
    const dirtySettings = localStorage.getItem(LS_DSET) === '1';
    if (dirtyIds.length || dirtyNotes.length || dirtyStates.length || dirtyProds.length || dirtySettings) {
      const changes = loadEntries().filter(e => dirtyIds.includes(e.id)).slice(0, 500);
      const noteChanges = loadNotes().filter(x => dirtyNotes.includes(x.id)).slice(0, 200);
      const states = loadStates();
      const stateChanges = dirtyStates.filter(d => states[d]).map(d => ({ id: d, ...states[d] })).slice(0, 200);
      const prodChanges = loadProducts().filter(p => dirtyProds.includes(p.id)).slice(0, 200);
      const settingsPayload = dirtySettings
        ? { value: JSON.stringify({ shop_name: settings.shop_name, currency: settings.currency, shifts: normShifts(settings.shifts) }), updated_at: localStorage.getItem(LS_SU) || nowIso() }
        : undefined;
      const r = await fetch(SYNC_URL + '/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken() },
        body: JSON.stringify({ changes, notes: noteChanges, states: stateChanges, products: prodChanges, settings: settingsPayload }),
      });
      if (r.status === 401) { sessionExpired(); return; }
      if (!r.ok) throw new Error('push ' + r.status);
      localStorage.setItem(LS_D, JSON.stringify(dirtyIds.filter(id => !changes.some(e => e.id === id))));
      localStorage.setItem(LS_DN, JSON.stringify(dirtyNotes.filter(id => !noteChanges.some(x => x.id === id))));
      localStorage.setItem(LS_DS, JSON.stringify(dirtyStates.filter(d => !stateChanges.some(s => s.id === d))));
      localStorage.setItem(LS_DP, JSON.stringify(dirtyProds.filter(id => !prodChanges.some(p => p.id === id))));
      if (dirtySettings) localStorage.setItem(LS_DSET, '0');
    }
    const since = localStorage.getItem(LS_LP) || '1970-01-01T00:00:00';
    const r2 = await fetch(SYNC_URL + '/api/pull?since=' + encodeURIComponent(since), { headers: { 'Authorization': 'Bearer ' + authToken() } });
    if (r2.status === 401) { sessionExpired(); return; }
    if (!r2.ok) throw new Error('pull ' + r2.status);
    const { entries: remote, notes: remoteNotes, states: remoteStates, products: remoteProds, settings: remoteSettings } = await r2.json();
    let newest = since;
    const bump = u => { if (u > newest) newest = u; };
    if (remote && remote.length) {
      const map = {};
      loadEntries().forEach(e => { map[e.id] = e; });
      remote.forEach(re => {
        const cur = map[re.id];
        if (!cur) map[re.id] = re;
        else if ((re.updated_at || '') > (cur.updated_at || '')) map[re.id] = (cur.note_id && !re.note_id) ? cur : re;
        bump(re.updated_at);
      });
      saveEntries(Object.values(map));
    }
    if (remoteNotes && remoteNotes.length) {
      const map = {};
      loadNotes().forEach(x => { map[x.id] = x; });
      remoteNotes.forEach(rn => {
        if (!rn.shift) rn.shift = 'pagi';
        rn.shift = normShift(rn.shift);
        const cur = map[rn.id]; if (!cur || (rn.updated_at || '') > (cur.updated_at || '')) map[rn.id] = rn; bump(rn.updated_at); });
      saveNotes(Object.values(map));
    }
    if (remoteStates && remoteStates.length) {
      const states = loadStates();
      remoteStates.forEach(rs => { const cur = states[rs.id]; if (!cur || (rs.updated_at || '') > (cur.updated_at || '')) states[rs.id] = rs; bump(rs.updated_at); });
      localStorage.setItem(LS_ST, JSON.stringify(states));
    }
    if (remoteProds && remoteProds.length) {
      const map = {};
      loadProducts().forEach(p => { map[p.id] = p; });
      remoteProds.forEach(rp => { const cur = map[rp.id]; if (!cur || (rp.updated_at || '') > (cur.updated_at || '')) map[rp.id] = rp; bump(rp.updated_at); });
      saveProducts(Object.values(map));
    }
    if (remoteSettings && remoteSettings.length) {
      // Shop settings: newest updated_at wins (last writer wins across devices).
      const localTs = localStorage.getItem(LS_SU) || '';
      remoteSettings.forEach(rs => {
        bump(rs.updated_at);
        if ((rs.updated_at || '') > localTs) {
          try {
            const v = JSON.parse(rs.value || '{}');
            if (v.shop_name) settings.shop_name = String(v.shop_name).slice(0, 60);
            if (v.currency) settings.currency = String(v.currency).slice(0, 10);
            if (v.shifts) settings.shifts = normShifts(v.shifts);
            localStorage.setItem(LS_S, JSON.stringify(settings));
            localStorage.setItem(LS_SU, rs.updated_at);
            localStorage.setItem(LS_DSET, '0');
            refreshTitles();
          } catch (e) {}
        }
      });
    }
    localStorage.setItem(LS_LP, ((remote && remote.length) || (remoteNotes && remoteNotes.length) || (remoteStates && remoteStates.length) || (remoteProds && remoteProds.length) || (remoteSettings && remoteSettings.length)) ? newest : nowIso());
    try { seedProductsFromEntries(); } catch (e) {}
    renderAll();
    localStorage.setItem(LS_OK, nowIso());
    setSyncState('ok');
  } catch (e) {
    setSyncState('offline');
    // transient mobile drop? retry once in 10s instead of waiting for the 30s timer
    clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 10000);
  }
  syncing = false;
}
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); }

/* ---------- bind ---------- */
$('btnSetup').addEventListener('click', doSetup);
$('loginKey').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
$('setupKey2').addEventListener('keydown', e => { if (e.key === 'Enter') doSetup(); });
$('btnLogin').addEventListener('click', doLogin);
$('authTabLogin').addEventListener('click', () => setAuthMode('login'));
$('authTabReg').addEventListener('click', () => setAuthMode('register'));
$('btnAuthGo').addEventListener('click', doAccountAuth);
$('authPass').addEventListener('keydown', e => { if (e.key === 'Enter') doAccountAuth(); });
$('authUser').addEventListener('keydown', e => { if (e.key === 'Enter') $('authPass').focus(); });
$('btnLogout').addEventListener('click', doLogout);
$('shiftTg_pagi').addEventListener('click', () => toggleShift('pagi'));
$('shiftTg_siang').addEventListener('click', () => toggleShift('siang'));
$('shiftTg_lembur').addEventListener('click', () => toggleShift('lembur'));
$('btnPrevDay').addEventListener('click', () => { const [y, m, d] = viewDate.split('-').map(Number); viewDate = localDay(new Date(y, m - 1, d - 1)); $('viewDate').value = viewDate; renderSell(); });
$('btnNextDay').addEventListener('click', () => { const [y, m, d] = viewDate.split('-').map(Number); viewDate = localDay(new Date(y, m - 1, d + 1)); $('viewDate').value = viewDate; renderSell(); });
$('btnToday').addEventListener('click', () => { viewDate = todayStr(); $('viewDate').value = viewDate; renderSell(); });
$('viewDate').addEventListener('change', e => { if (e.target.value) { viewDate = e.target.value; renderSell(); } });
$('payCash').addEventListener('click', () => setPay('cash'));
$('payQris').addEventListener('click', () => setPay('qris'));
if ($('shiftPagi')) $('shiftPagi').addEventListener('click', () => setShift('pagi'));
if ($('shiftSiang')) $('shiftSiang').addEventListener('click', () => setShift('siang'));
if ($('shiftLembur')) $('shiftLembur').addEventListener('click', () => setShift('lembur'));
$('btnSave').addEventListener('click', saveManual);
$('fQty').addEventListener('input', updSub);
$('fPrice').addEventListener('input', updSub);
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && ['fItem', 'fQty', 'fPrice'].includes(document.activeElement.id)) { e.preventDefault(); saveManual(); }
});
$('btnSaveProduct').addEventListener('click', saveProduct);
$('btnCancelProduct').addEventListener('click', cancelProductForm);
$('statMonth').addEventListener('change', renderStats);
$('btnLoadHist').addEventListener('click', loadHistory);
$('btnSaveSettings').addEventListener('click', saveSettings);
$('btnChangeKey').addEventListener('click', changeKey);
$('btnExport').addEventListener('click', exportDB);
$('btnImport').addEventListener('click', importDB);
if ($('btnShareTelegram')) $('btnShareTelegram').addEventListener('click', sendShiftTelegram);
if ($('btnShareExcel')) $('btnShareExcel').addEventListener('click', downloadShiftExcel);
if ($('btnShareFile')) $('btnShareFile').addEventListener('click', shareShiftFile);
if ($('btnCopyReport')) $('btnCopyReport').addEventListener('click', copyShiftReport);

/* ---------- init ---------- */
(function init() {
  // Restore this device's current account first — all storage below is namespaced.
  try {
    const cur = localStorage.getItem(LS_CUR) || '';
    const accts = loadAccts();
    if (cur && accts[cur] && accts[cur].token) ACC = { uid: cur, username: accts[cur].username, token: accts[cur].token };
    setNs(ACC.uid);
  } catch (e) { setNs(''); }
  loadSettings(); migrate();
  viewDate = todayStr();
  viewShift = firstShift();
  $('viewDate').value = viewDate;
  $('histMonth').value = todayStr().slice(0, 7);
  $('statMonth').value = todayStr().slice(0, 7);
  setPay('cash'); setShift(viewShift); updSub();
  setSyncState(SYNC_ON ? 'offline' : 'off');
  refreshTitles();
  checkGate();
  if (authed()) { renderAll(); syncNow(); }
  setInterval(() => { if (authed()) syncNow(); }, 30000);
  window.addEventListener('online', syncNow);
})();
