/* sales-notes-sync — Cloudflare Worker + D1.
 * Multi-account store. Authed requests carry Authorization: Bearer <token>,
 * where <token> is either the legacy SITE_KEY (shared '' panel) or an
 * account session from /api/register or /api/login (private panel).
 * Public (no token): /api/health, POST /api/register, POST /api/login.
 * wrangler secret put SITE_KEY   (same value as the SITE_KEY GitHub secret)
 */
const ORIGIN = 'https://tadakuro.github.io';

// NOTE: '*' (not the Pages origin) so the Android APK build — which serves
// the same site from file:///android_asset — can call /api/* too. Auth still
// requires the SITE_KEY bearer token; CORS alone never grants access.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/* ---------- accounts (multi-user; each account = its own isolated panel) ----------
 * Legacy mode: Authorization Bearer <SITE_KEY> → shared account '' (old behaviour).
 * Account mode: Bearer <session token> → that account's rows only (account_id).
 * Fresh DBs: run worker/schema.sql. Existing DBs: also run worker/migrate-06.sql.
 */
function b64encode(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64decode(s) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}
function randHex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
}
const PBKDF2_ITERS = 60000;
async function hashPassword(password, saltB64) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64decode(saltB64), iterations: PBKDF2_ITERS },
    key, 256);
  return b64encode(bits);
}
function validUsername(u) { return typeof u === 'string' && /^[a-z0-9][a-z0-9_.-]{2,19}$/i.test(u.trim()); }
function validPassword(p) { return typeof p === 'string' && p.length >= 4 && p.length <= 128; }

// Tiny in-memory rate limiter (per isolate; best-effort abuse brake).
const RL = new Map();
function rateOk(key, limit, windowMs) {
  const now = Date.now();
  const cur = RL.get(key);
  if (!cur || cur.reset < now) { RL.set(key, { count: 1, reset: now + windowMs }); return true; }
  cur.count += 1;
  return cur.count <= limit;
}
function clientIp(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For') || 'unknown';
}

// Returns { id, username, token } for account sessions,
// { id:'', username:'', token } for legacy SITE_KEY, or null when unauthorized.
async function resolveAccount(req, env) {
  const h = req.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return null;
  const tok = h.slice(7);
  if (!tok) return null;
  if (env.SITE_KEY && same(tok, env.SITE_KEY)) return { id: '', username: '', token: tok };
  try {
    const s = await env.DB.prepare(
      'SELECT account_id, expires_at FROM sessions WHERE token = ?').bind(tok).first();
    if (!s) return null;
    if (String(s.expires_at || '') < new Date().toISOString()) {
      await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(tok).run().catch(() => {});
      return null;
    }
    const a = await env.DB.prepare(
      'SELECT id, username FROM accounts WHERE id = ?').bind(s.account_id).first();
    if (!a) return null;
    return { id: a.id, username: a.username, token: tok };
  } catch (e) { return null; }
}
async function newSession(env, accountId, days = 90) {
  const token = randHex(32);
  const now = new Date();
  const exp = new Date(now.getTime() + days * 86400000).toISOString();
  await env.DB.prepare(
    'INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?,?,?,?)'
  ).bind(token, accountId, now.toISOString(), exp).run();
  return { token, expires_at: exp };
}

const COLS = 'id,note_id,date,item,qty,price,subtotal,payment,note,updated_at,deleted';
const NOTE_COLS = 'id,date,title,shift,created_at,updated_at,deleted';
const STATE_COLS = 'id,date,closed,total,cash_total,qris_total,count,closed_at,updated_at';
const PROD_COLS = 'id,name,price,created_at,updated_at,deleted';

// Shifts: pagi / siang / lembur. Maps legacy '1'/'2' from the 2-shift build.
function normShift(s) {
  const t = String(s ?? 'pagi').trim().toLowerCase();
  if (t === 'siang' || t === '2' || t === 'shift 2' || t === 'shift2') return 'siang';
  if (t === 'lembur' || t === '3' || t === 'shift 3' || t === 'shift3' || t === 'malam') return 'lembur';
  return 'pagi';
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/health') return json({ ok: true, accounts: true, time: new Date().toISOString() });

    // ---- public account endpoints (no token yet) ----
    if (req.method === 'POST' && url.pathname === '/api/register') {
      if (!rateOk('reg:' + clientIp(req), 10, 3600000)) return json({ error: 'rate_limited' }, 429);
      const body = await req.json().catch(() => ({}));
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      if (!validUsername(username)) return json({ error: 'bad_username' }, 400);
      if (!validPassword(password)) return json({ error: 'bad_password' }, 400);
      try {
        const exists = await env.DB.prepare(
          'SELECT id FROM accounts WHERE LOWER(username) = LOWER(?)').bind(username).first();
        if (exists) return json({ error: 'username_taken' }, 409);
        const salt = b64encode(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await hashPassword(password, salt);
        const id = 'u_' + randHex(8);
        const now = new Date().toISOString();
        await env.DB.prepare(
          'INSERT INTO accounts (id, username, pass_salt, pass_hash, created_at) VALUES (?,?,?,?,?)'
        ).bind(id, username, salt, hash, now).run();
        const sess = await newSession(env, id);
        return json({ ok: true, token: sess.token, account: { id, username } });
      } catch (e) { return json({ error: 'server_error' }, 500); }
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (!rateOk('login:' + clientIp(req), 30, 600000)) return json({ error: 'rate_limited' }, 429);
      const body = await req.json().catch(() => ({}));
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      try {
        const row = await env.DB.prepare(
          'SELECT id, username, pass_salt, pass_hash FROM accounts WHERE LOWER(username) = LOWER(?)'
        ).bind(username).first();
        // Derive even when unknown so timing doesn't reveal which usernames exist.
        const salt = row ? row.pass_salt : b64encode(new Uint8Array(16));
        const calc = await hashPassword(password || 'x', salt);
        if (!row || !same(calc, row.pass_hash)) return json({ error: 'invalid_login' }, 401);
        const sess = await newSession(env, row.id);
        return json({ ok: true, token: sess.token, account: { id: row.id, username: row.username } });
      } catch (e) { return json({ error: 'server_error' }, 500); }
    }

    const acct = await resolveAccount(req, env);
    if (!acct) return json({ error: 'unauthorized' }, 401);
    // Per-account data scope. Legacy SITE_KEY mode keeps the old shared '' scope.
    const AID = acct.id || '';
    const shopKey = AID ? AID + ':shop' : 'shop';

    if (req.method === 'GET' && url.pathname === '/api/me') {
      return json({ ok: true, account: AID ? { id: acct.id, username: acct.username } : { id: '', username: '' } });
    }

    if (req.method === 'POST' && url.pathname === '/api/logout') {
      try {
        if (AID && acct.token) {
          await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(acct.token).run();
        }
      } catch (e) {}
      return json({ ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/password') {
      if (!AID) return json({ error: 'legacy_no_password' }, 400);
      const body = await req.json().catch(() => ({}));
      const oldPw = String(body.old_password || '');
      const newPw = String(body.new_password || '');
      if (!validPassword(newPw)) return json({ error: 'bad_password' }, 400);
      try {
        const row = await env.DB.prepare(
          'SELECT pass_salt, pass_hash FROM accounts WHERE id = ?').bind(AID).first();
        if (!row) return json({ error: 'unauthorized' }, 401);
        const calc = await hashPassword(oldPw || 'x', row.pass_salt);
        if (!same(calc, row.pass_hash)) return json({ error: 'wrong_password' }, 401);
        const salt = b64encode(crypto.getRandomValues(new Uint8Array(16)));
        const hash = await hashPassword(newPw, salt);
        await env.DB.prepare(
          'UPDATE accounts SET pass_salt = ?, pass_hash = ? WHERE id = ?').bind(salt, hash, AID).run();
        // Keep this device logged in, revoke everything else.
        if (acct.token) {
          await env.DB.prepare(
            'DELETE FROM sessions WHERE account_id = ? AND token != ?').bind(AID, acct.token).run();
        }
        return json({ ok: true });
      } catch (e) { return json({ error: 'server_error' }, 500); }
    }

    try {
      // Pull everything changed since a timestamp (tombstones + notes + lock states + products).
      if (req.method === 'GET' && url.pathname === '/api/pull') {
        const since = url.searchParams.get('since') || '1970-01-01T00:00:00';
        const { results } = await env.DB.prepare(
          `SELECT ${COLS} FROM entries WHERE account_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 2000`
        ).bind(AID, since).all();
        let notes = [], states = [], products = [], shopSettings = null;
        try {
          const q = await env.DB.prepare(
            `SELECT ${NOTE_COLS} FROM notes WHERE account_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500`
          ).bind(AID, since).all();
          notes = q.results || [];
        } catch (e) {
          try {
            // pre-shift DBs (before migrate-04): fall back without shift column.
            const q2 = await env.DB.prepare(
              `SELECT id,date,title,created_at,updated_at,deleted FROM notes WHERE account_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500`
            ).bind(AID, since).all();
            notes = (q2.results || []).map(r => ({ ...r, shift: 'pagi' }));
          } catch (e2) { /* pre-notes DBs — entries still sync */ }
        }
        try {
          const s = await env.DB.prepare(
            `SELECT ${STATE_COLS} FROM note_state WHERE account_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500`
          ).bind(AID, since).all();
          states = s.results || [];
        } catch (e) { /* pre-states DBs — entries still sync */ }
        try {
          const p = await env.DB.prepare(
            `SELECT ${PROD_COLS} FROM products WHERE account_id = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 500`
          ).bind(AID, since).all();
          products = p.results || [];
        } catch (e) { /* pre-products DBs — entries still sync */ }
        try {
          const g = await env.DB.prepare(
            `SELECT key, value, updated_at FROM settings WHERE key = ? AND updated_at > ? ORDER BY updated_at ASC LIMIT 10`
          ).bind(shopKey, since).all();
          shopSettings = g.results || [];
        } catch (e) { /* pre-settings DBs — entries still sync */ }
        return json({ entries: results || [], notes, states, products, settings: shopSettings });
      }

      // Push local changes. Newest updated_at wins per id, on both sides.
      if (req.method === 'POST' && url.pathname === '/api/push') {
        const body = await req.json().catch(() => ({}));
        const changes = Array.isArray(body.changes) ? body.changes.slice(0, 500) : [];
        const stmts = [];
        for (const e of changes) {
          if (!e || typeof e.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.date || '')) continue;
          const qty = Number(e.qty), price = Number(e.price);
          if (!(qty > 0) || !(price >= 0)) continue;
          const item = String(e.item || '').slice(0, 200);
          if (!item) continue;
          const payment = String(e.payment || 'cash').toLowerCase() === 'qris' ? 'qris' : 'cash';
          stmts.push(env.DB.prepare(
            `INSERT INTO entries (account_id, ${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               note_id=excluded.note_id, date=excluded.date, item=excluded.item, qty=excluded.qty,
               price=excluded.price, subtotal=excluded.subtotal,
               payment=excluded.payment, note=excluded.note,
               updated_at=excluded.updated_at, deleted=excluded.deleted
             WHERE excluded.updated_at > entries.updated_at AND entries.account_id = excluded.account_id`
          ).bind(
            AID,
            e.id, String(e.note_id || ''), e.date, item, qty, price,
            Math.round(qty * price * 100) / 100, payment,
            String(e.note || '').slice(0, 500),
            String(e.updated_at || new Date().toISOString()),
            e.deleted ? 1 : 0
          ));
        }
        if (stmts.length) await env.DB.batch(stmts);
        // Notes. Newest updated_at wins per id.
        let notesApplied = 0;
        try {
          const nchanges = Array.isArray(body.notes) ? body.notes.slice(0, 200) : [];
          const nstmts = [];
          for (const x of nchanges) {
            if (!x || typeof x.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.date || '')) continue;
            const shift = normShift(x.shift);
            nstmts.push(env.DB.prepare(
              `INSERT INTO notes (account_id, ${NOTE_COLS}) VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 date=excluded.date, title=excluded.title, shift=excluded.shift, created_at=excluded.created_at,
                 updated_at=excluded.updated_at, deleted=excluded.deleted
               WHERE excluded.updated_at > notes.updated_at AND notes.account_id = excluded.account_id`
            ).bind(
              AID,
              x.id, x.date, String(x.title || 'Note').slice(0, 60), shift,
              String(x.created_at || new Date().toISOString()),
              String(x.updated_at || new Date().toISOString()),
              x.deleted ? 1 : 0
            ));
          }
          if (nstmts.length) await env.DB.batch(nstmts);
          notesApplied = nstmts.length;
        } catch (e) {
          try {
            // pre-shift DBs: retry without shift column so old backends keep working.
            const nchanges = Array.isArray(body.notes) ? body.notes.slice(0, 200) : [];
            const nstmts = [];
            for (const x of nchanges) {
              if (!x || typeof x.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(x.date || '')) continue;
              nstmts.push(env.DB.prepare(
                `INSERT INTO notes (id,date,title,created_at,updated_at,deleted) VALUES (?,?,?,?,?,?)
                 ON CONFLICT(id) DO UPDATE SET
                   date=excluded.date, title=excluded.title, created_at=excluded.created_at,
                   updated_at=excluded.updated_at, deleted=excluded.deleted
                 WHERE excluded.updated_at > notes.updated_at`
              ).bind(
                x.id, x.date, String(x.title || 'Note').slice(0, 60),
                String(x.created_at || new Date().toISOString()),
                String(x.updated_at || new Date().toISOString()),
                x.deleted ? 1 : 0
              ));
            }
            if (nstmts.length) await env.DB.batch(nstmts);
            notesApplied = nstmts.length;
          } catch (e2) { /* table missing on old DBs — entries already saved */ }
        }
        // Per-note close-states. Newest updated_at wins per note id.
        let statesApplied = 0;
        try {
          const states = Array.isArray(body.states) ? body.states.slice(0, 200) : [];
          const sstmts = [];
          for (const s of states) {
            if (!s || typeof s.id !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s.date || '')) continue;
            const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
            sstmts.push(env.DB.prepare(
              `INSERT INTO note_state (account_id, ${STATE_COLS}) VALUES (?,?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 date=excluded.date, closed=excluded.closed, total=excluded.total,
                 cash_total=excluded.cash_total, qris_total=excluded.qris_total,
                 count=excluded.count, closed_at=excluded.closed_at, updated_at=excluded.updated_at
               WHERE excluded.updated_at > note_state.updated_at AND note_state.account_id = excluded.account_id`
            ).bind(
              AID,
              s.id, s.date, s.closed ? 1 : 0, num(s.total), num(s.cash_total),
              num(s.qris_total), Math.max(0, Math.floor(num(s.count))),
              String(s.closed_at || '').slice(0, 30),
              String(s.updated_at || new Date().toISOString())
            ));
          }
          if (sstmts.length) await env.DB.batch(sstmts);
          statesApplied = sstmts.length;
        } catch (e) { /* table missing on old DBs — entries already saved */ }
        // Products catalog. Newest updated_at wins per id.
        let productsApplied = 0;
        try {
          const pchanges = Array.isArray(body.products) ? body.products.slice(0, 200) : [];
          const pstmts = [];
          for (const p of pchanges) {
            if (!p || typeof p.id !== 'string') continue;
            const name = String(p.name || '').slice(0, 100);
            const price = Number(p.price);
            if (!name || !(price >= 0)) continue;
            pstmts.push(env.DB.prepare(
              `INSERT INTO products (account_id, ${PROD_COLS}) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, price=excluded.price, created_at=excluded.created_at,
                 updated_at=excluded.updated_at, deleted=excluded.deleted
               WHERE excluded.updated_at > products.updated_at AND products.account_id = excluded.account_id`
            ).bind(
              AID,
              p.id, name, price,
              String(p.created_at || new Date().toISOString()),
              String(p.updated_at || new Date().toISOString()),
              p.deleted ? 1 : 0
            ));
          }
          if (pstmts.length) await env.DB.batch(pstmts);
          productsApplied = pstmts.length;
        } catch (e) { /* table missing on old DBs — entries already saved */ }
        // Shop settings (single global row key='shop'). Newest updated_at wins.
        let settingsApplied = 0;
        try {
          const s = body.settings;
          if (s && typeof s.updated_at === 'string' && typeof s.value === 'string') {
            const val = s.value.slice(0, 2000);
            await env.DB.prepare(
              `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
               WHERE excluded.updated_at > settings.updated_at`
            ).bind(shopKey, val, String(s.updated_at).slice(0, 30)).run();
            settingsApplied = 1;
          }
        } catch (e) { /* table missing on old DBs — entries already saved */ }
        return json({ ok: true, applied: stmts.length, notesApplied, statesApplied, productsApplied, settingsApplied });
      }

      // Forward a shift report to Telegram (bot token stays server-side).
      // Secrets (never in git): wrangler secret put TELEGRAM_BOT_TOKEN
      //                         wrangler secret put TELEGRAM_CHAT_ID
      // Client sends pre-formatted HTML (parse_mode HTML) for a professional look.
      if (req.method === 'POST' && url.pathname === '/api/report') {
        const bot = env.TELEGRAM_BOT_TOKEN || '';
        const chat = env.TELEGRAM_CHAT_ID || '';
        if (!bot || !chat) return json({ error: 'telegram_not_configured' }, 501);
        const body = await req.json().catch(() => ({}));
        const text = String(body.text || '').slice(0, 4000);
        if (!text.trim()) return json({ error: 'empty_report' }, 400);
        const pm = String(body.parse_mode || 'HTML');
        const parse_mode = pm === 'HTML' || pm === 'MarkdownV2' || pm === 'Markdown' ? pm : 'HTML';
        const payload = { chat_id: chat, text, parse_mode, disable_web_page_preview: true };
        const tr = await fetch('https://api.telegram.org/bot' + bot + '/sendMessage', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!tr.ok) return json({ error: 'telegram_send_failed' }, 502);
        return json({ ok: true });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error' }, 500);
    }
  },
};
