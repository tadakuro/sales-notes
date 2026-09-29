/* My Sales Notes — POS revamp (dark, mobile-first, offline-first).
 * Static site, localStorage first, optional Cloudflare Worker + D1 sync.
 * Data model (synced): entries + notes + note_state (legacy compat) + products.
 * UI: single direct-save form; day sales grouped per note with lock buttons.
 */
const SITE_KEY_HASH = "__SITE_KEY_HASH__";
const SITE_ENFORCED = typeof SITE_KEY_HASH === 'string' && !SITE_KEY_HASH.startsWith('__');
const SYNC_URL = "__SYNC_URL__";
const SYNC_ON = typeof SYNC_URL === 'string' && SYNC_URL.startsWith('http');

let settings = { shop_name: 'My Sales Notes', currency: 'Rp' };
let sessionKey = sessionStorage.getItem('sn_key') || null;
let viewDate = null;
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

/* ---------- storage ---------- */
const LS_E = 'sn_entries', LS_N = 'sn_notes', LS_S = 'sn_settings', LS_P = 'sn_pin';
const LS_D = 'sn_dirty', LS_DN = 'sn_dirty_notes', LS_DS = 'sn_dirty_states';
const LS_ST = 'sn_states', LS_LP = 'sn_last_pull', LS_MG = 'sn_migrated';
const LS_PD = 'sn_products', LS_DP = 'sn_dirty_products';
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
  });
  const orphans = entries.filter(e => !e.note_id);
  if (orphans.length) {
    const byDate = {};
    orphans.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
    Object.keys(byDate).forEach(date => {
      let note = notes.find(n => !n.deleted && n.date === date);
      if (!note) { note = { id: uid(), date, title: 'Kasir', created_at: nowIso(), updated_at: nowIso(), deleted: 0 }; notes.push(note); touchedN = true; }
      byDate[date].forEach(e => { e.note_id = note.id; });
    });
    touchedE = true;
  }
  if (touchedE) saveEntries(entries);
  if (touchedN) saveNotes(notes);
  if (!localStorage.getItem(LS_PD)) saveProducts([]);
  if (!localStorage.getItem(LS_DP)) localStorage.setItem(LS_DP, '[]');
  if (!localStorage.getItem(LS_ST)) localStorage.setItem(LS_ST, '{}');
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

/* writable note for new sales: first open note of the date,
 * or a fresh one if all are locked (old notes keep syncing) */
function writableNote(date) {
  const day = loadNotes().filter(x => !x.deleted && x.date === date)
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  const open = day.find(x => !isClosed(x.id));
  if (open) return open;
  const now = nowIso();
  const title = day.length ? ('Kasir ' + (day.length + 1)) : 'Kasir';
  const n = { id: uid(), date, title, created_at: now, updated_at: now, deleted: 0 };
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
  if (!confirm(`Kunci "${n.title}" (${n.date})?\nTotal ${money(s.total)} · ${s.count} penjualan.`)) return;
  const now = nowIso();
  const states = loadStates();
  states[id] = { date: n.date, closed: 1, total: s.total, cash_total: s.cash_total,
    qris_total: s.qris_total, count: s.count, closed_at: now, updated_at: now };
  localStorage.setItem(LS_ST, JSON.stringify(states));
  markDirtyState(id);
  renderSell(); renderStats(); syncSoon();
  toast('Catatan dikunci 🔒 ' + money(s.total), 'ok');
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
function checkGate() {
  const saved = loadSettings();
  $('shopTitle').textContent = saved.shop_name;
  $('authShopName').textContent = saved.shop_name;
  if (SITE_ENFORCED) {
    $('authSetupPane').classList.add('hidden'); $('authLoginPane').classList.remove('hidden');
    $('authHint').textContent = 'Toko ini dikunci — masukkan kunci situs.';
    if (sessionStorage.getItem('sn_unlocked') === '1') { hideAuth(); afterLogin(); return; }
    showAuth(); return;
  }
  if (!localStorage.getItem(LS_P)) {
    $('authSetupPane').classList.remove('hidden'); $('authLoginPane').classList.add('hidden');
    $('authHint').textContent = 'Baru pertama kali? Buat satu kunci privat.';
  } else if (sessionStorage.getItem('sn_unlocked') === '1') { hideAuth(); afterLogin(); return; }
  else { $('authSetupPane').classList.add('hidden'); $('authLoginPane').classList.remove('hidden'); }
  showAuth();
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
function doLogout() {
  sessionStorage.removeItem('sn_unlocked'); sessionStorage.removeItem('sn_key');
  sessionKey = null;
  showAuth(); checkGate();
}
function afterLogin() {
  loadSettings(); refreshTitles(); migrate();
  viewDate = todayStr();
  $('viewDate').value = viewDate;
  $('histMonth').value = todayStr().slice(0, 7);
  $('statMonth').value = todayStr().slice(0, 7);
  renderAll(); syncNow();
}

/* ---------- settings ---------- */
function loadSettings() { try { Object.assign(settings, JSON.parse(localStorage.getItem(LS_S)) || {}); } catch (e) {} return settings; }
function refreshTitles() {
  $('shopTitle').textContent = settings.shop_name || 'My Sales Notes';
  $('authShopName').textContent = settings.shop_name || 'My Sales Notes';
  document.title = (settings.shop_name || 'My Sales Notes') + ' — Kasir';
  $('sShop').value = settings.shop_name || ''; $('sCur').value = settings.currency || 'Rp';
}
function saveSettings() {
  settings.shop_name = $('sShop').value.trim() || 'My Sales Notes';
  settings.currency = $('sCur').value.trim() || 'Rp';
  localStorage.setItem(LS_S, JSON.stringify(settings));
  refreshTitles(); renderAll(); toast('Tersimpan ✓', 'ok');
}
async function changeKey() {
  if (SITE_ENFORCED) { toast('Kunci situs diatur di GitHub secret.', 'err'); return; }
  const o = $('kOld').value, n = $('kNew').value.trim();
  if (!o || n.length < 4) { toast('Kunci lama + baru (min 4) wajib', 'err'); return; }
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
  renderQuick(); renderDayList(list); loadHeader();
}
function renderQuick() {
  const q = ($('prodSearch').value || '').toLowerCase();
  const prods = loadProducts().filter(p => !p.deleted && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 30);
  const box = $('quickGrid'); box.innerHTML = '';
  $('quickEmpty').classList.toggle('hidden', prods.length > 0);
  prods.forEach(p => {
    const b = document.createElement('button');
    b.className = 'qcard';
    b.innerHTML = `<b>${esc(p.name)}</b><span>${esc(money(p.price))}</span>`;
    b.addEventListener('click', () => fillForm(p.name, p.price));
    box.appendChild(b);
  });
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
  const note = writableNote(viewDate);
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
  toast(item + ' tersimpan ✓ (' + payMethod.toUpperCase() + ')', 'ok', 1500);
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
    .sort((a, b) => String(byId[a] ? byId[a].created_at : '').localeCompare(String(byId[b] ? byId[b].created_at : '')))
    .forEach(nid => {
      const n = byId[nid];
      const items = groups[nid].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      const s = summarize(items);
      const sec = document.createElement('div');
      sec.className = 'note-sec';
      const locked = nid && isClosed(nid);
      const head = document.createElement('div');
      head.className = 'note-sec-head';
      head.innerHTML = `<b>${locked ? '🔒' : '📝'} ${esc(n ? n.title : 'Catatan')}</b><span>${items.length} item · ${esc(money(s.total))}</span>`;
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
  saveProducts(list); cancelProductForm(); renderProducts(); renderQuick(); syncSoon();
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
  renderProducts(); renderQuick(); syncSoon(); toast('Produk dihapus', 'ok');
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
  // last 7 days bar
  const labels = [], vals = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = localDay(d);
    labels.push(ds.slice(8));
    vals.push(all.filter(e => e.date === ds).reduce((a, e) => a + e.subtotal, 0));
  }
  drawBars($('chartWeek'), vals, labels);
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
function drawBars(cv, vals, labels) {
  if (!cv) return;
  const dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 320, H = 150;
  cv.width = W * dpr; cv.height = H * dpr;
  const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const max = Math.max(...vals, 1);
  const n = vals.length, bw = (W - 16) / n;
  vals.forEach((v, i) => {
    const h = Math.max(4, (v / max) * (H - 40));
    const x = 8 + i * bw + bw * 0.2, w = bw * 0.6, y = H - 22 - h;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#34d399'); g.addColorStop(1, '#0ea5e9');
    ctx.fillStyle = i === n - 1 ? g : '#24314f';
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, 5); ctx.fill(); }
    else ctx.fillRect(x, y, w, h);
    ctx.fillStyle = '#8b96b3'; ctx.font = '10px Inter,system-ui'; ctx.textAlign = 'center';
    ctx.fillText(labels[i], x + w / 2, H - 8);
  });
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
  if (Array.isArray(j.notes)) saveNotes(j.notes);
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
      + (JSON.parse(localStorage.getItem(LS_DP) || '[]').length);
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
  const map = { ok: ['✓ synced', '#34d399'], sync: ['… syncing', '#fbbf24'], offline: ['✕ offline', '#f87171'], off: ['– sync off', '#8b96b3'], key: ['! kunci salah', '#f87171'] };
  const [t, c] = map[s] || map.off;
  el.textContent = t; el.style.color = c;
  el.title = s === 'ok' ? ('terakhir sinkron ' + lastOkLabel())
    : s === 'offline' ? ('offline — tersimpan di HP ini, terkirim nanti · ' + pendingCount() + ' menunggu · terakhir ok ' + lastOkLabel())
    : t;
}
async function syncNow() {
  if (!SYNC_ON) { setSyncState('off'); return; }
  if (!sessionKey || sessionStorage.getItem('sn_unlocked') !== '1') return;
  if (syncing || !navigator.onLine) { if (!navigator.onLine) setSyncState('offline'); return; }
  syncing = true; setSyncState('sync');
  try {
    const dirtyIds = JSON.parse(localStorage.getItem(LS_D) || '[]');
    const dirtyNotes = JSON.parse(localStorage.getItem(LS_DN) || '[]');
    const dirtyStates = JSON.parse(localStorage.getItem(LS_DS) || '[]');
    const dirtyProds = JSON.parse(localStorage.getItem(LS_DP) || '[]');
    if (dirtyIds.length || dirtyNotes.length || dirtyStates.length || dirtyProds.length) {
      const changes = loadEntries().filter(e => dirtyIds.includes(e.id)).slice(0, 500);
      const noteChanges = loadNotes().filter(x => dirtyNotes.includes(x.id)).slice(0, 200);
      const states = loadStates();
      const stateChanges = dirtyStates.filter(d => states[d]).map(d => ({ id: d, ...states[d] })).slice(0, 200);
      const prodChanges = loadProducts().filter(p => dirtyProds.includes(p.id)).slice(0, 200);
      const r = await fetch(SYNC_URL + '/api/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + sessionKey },
        body: JSON.stringify({ changes, notes: noteChanges, states: stateChanges, products: prodChanges }),
      });
      if (r.status === 401) { setSyncState('key'); syncing = false; return; }
      if (!r.ok) throw new Error('push ' + r.status);
      localStorage.setItem(LS_D, JSON.stringify(dirtyIds.filter(id => !changes.some(e => e.id === id))));
      localStorage.setItem(LS_DN, JSON.stringify(dirtyNotes.filter(id => !noteChanges.some(x => x.id === id))));
      localStorage.setItem(LS_DS, JSON.stringify(dirtyStates.filter(d => !stateChanges.some(s => s.id === d))));
      localStorage.setItem(LS_DP, JSON.stringify(dirtyProds.filter(id => !prodChanges.some(p => p.id === id))));
    }
    const since = localStorage.getItem(LS_LP) || '1970-01-01T00:00:00';
    const r2 = await fetch(SYNC_URL + '/api/pull?since=' + encodeURIComponent(since), { headers: { 'Authorization': 'Bearer ' + sessionKey } });
    if (r2.status === 401) { setSyncState('key'); syncing = false; return; }
    if (!r2.ok) throw new Error('pull ' + r2.status);
    const { entries: remote, notes: remoteNotes, states: remoteStates, products: remoteProds } = await r2.json();
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
      remoteNotes.forEach(rn => { const cur = map[rn.id]; if (!cur || (rn.updated_at || '') > (cur.updated_at || '')) map[rn.id] = rn; bump(rn.updated_at); });
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
    localStorage.setItem(LS_LP, ((remote && remote.length) || (remoteNotes && remoteNotes.length) || (remoteStates && remoteStates.length) || (remoteProds && remoteProds.length)) ? newest : nowIso());
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
$('btnLogout').addEventListener('click', doLogout);
$('btnPrevDay').addEventListener('click', () => { const [y, m, d] = viewDate.split('-').map(Number); viewDate = localDay(new Date(y, m - 1, d - 1)); $('viewDate').value = viewDate; renderSell(); });
$('btnNextDay').addEventListener('click', () => { const [y, m, d] = viewDate.split('-').map(Number); viewDate = localDay(new Date(y, m - 1, d + 1)); $('viewDate').value = viewDate; renderSell(); });
$('btnToday').addEventListener('click', () => { viewDate = todayStr(); $('viewDate').value = viewDate; renderSell(); });
$('viewDate').addEventListener('change', e => { if (e.target.value) { viewDate = e.target.value; renderSell(); } });
$('prodSearch').addEventListener('input', renderQuick);
$('payCash').addEventListener('click', () => setPay('cash'));
$('payQris').addEventListener('click', () => setPay('qris'));
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

/* ---------- init ---------- */
(function init() {
  loadSettings(); migrate();
  viewDate = todayStr();
  $('viewDate').value = viewDate;
  $('histMonth').value = todayStr().slice(0, 7);
  $('statMonth').value = todayStr().slice(0, 7);
  setPay('cash'); updSub();
  setSyncState(SYNC_ON ? 'offline' : 'off');
  if (SITE_ENFORCED) { $('keyModeHint').textContent = 'Satu kunci situs (GitHub secret SITE_KEY) untuk semua perangkat.'; $('kOld').closest('.lbl').classList.add('hidden'); $('kNew').closest('.lbl').classList.add('hidden'); $('btnChangeKey').classList.add('hidden'); }
  refreshTitles();
  checkGate();
  if (sessionStorage.getItem('sn_unlocked') === '1') { renderAll(); syncNow(); }
  setInterval(() => { if (sessionStorage.getItem('sn_unlocked') === '1') syncNow(); }, 30000);
  window.addEventListener('online', syncNow);
})();
