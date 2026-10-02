/* sales-notes-sync — Cloudflare Worker + D1.
 * Shared store for the github.io notebook. Every request (except preflight
 * and /api/health) must carry: Authorization: Bearer <SITE_KEY>.
 * wrangler secret put SITE_KEY   (same value as the SITE_KEY GitHub secret)
 */
const ORIGIN = 'https://tadakuro.github.io';

const CORS = {
  'Access-Control-Allow-Origin': ORIGIN,
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

function authed(req, env) {
  const h = req.headers.get('Authorization') || '';
  if (!h.startsWith('Bearer ')) return false;
  return same(h.slice(7), env.SITE_KEY || '');
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
    if (url.pathname === '/api/health') return json({ ok: true });
    if (!authed(req, env)) return json({ error: 'unauthorized' }, 401);

    try {
      // Pull everything changed since a timestamp (tombstones + notes + lock states + products).
      if (req.method === 'GET' && url.pathname === '/api/pull') {
        const since = url.searchParams.get('since') || '1970-01-01T00:00:00';
        const { results } = await env.DB.prepare(
          `SELECT ${COLS} FROM entries WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 2000`
        ).bind(since).all();
        let notes = [], states = [], products = [];
        try {
          const q = await env.DB.prepare(
            `SELECT ${NOTE_COLS} FROM notes WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500`
          ).bind(since).all();
          notes = q.results || [];
        } catch (e) {
          try {
            // pre-shift DBs (before migrate-04): fall back without shift column.
            const q2 = await env.DB.prepare(
              `SELECT id,date,title,created_at,updated_at,deleted FROM notes WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500`
            ).bind(since).all();
            notes = (q2.results || []).map(r => ({ ...r, shift: 'pagi' }));
          } catch (e2) { /* pre-notes DBs — entries still sync */ }
        }
        try {
          const s = await env.DB.prepare(
            `SELECT ${STATE_COLS} FROM note_state WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500`
          ).bind(since).all();
          states = s.results || [];
        } catch (e) { /* pre-states DBs — entries still sync */ }
        try {
          const p = await env.DB.prepare(
            `SELECT ${PROD_COLS} FROM products WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 500`
          ).bind(since).all();
          products = p.results || [];
        } catch (e) { /* pre-products DBs — entries still sync */ }
        return json({ entries: results || [], notes, states, products });
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
            `INSERT INTO entries (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               note_id=excluded.note_id, date=excluded.date, item=excluded.item, qty=excluded.qty,
               price=excluded.price, subtotal=excluded.subtotal,
               payment=excluded.payment, note=excluded.note,
               updated_at=excluded.updated_at, deleted=excluded.deleted
             WHERE excluded.updated_at > entries.updated_at`
          ).bind(
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
              `INSERT INTO notes (${NOTE_COLS}) VALUES (?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 date=excluded.date, title=excluded.title, shift=excluded.shift, created_at=excluded.created_at,
                 updated_at=excluded.updated_at, deleted=excluded.deleted
               WHERE excluded.updated_at > notes.updated_at`
            ).bind(
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
              `INSERT INTO note_state (${STATE_COLS}) VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 date=excluded.date, closed=excluded.closed, total=excluded.total,
                 cash_total=excluded.cash_total, qris_total=excluded.qris_total,
                 count=excluded.count, closed_at=excluded.closed_at, updated_at=excluded.updated_at
               WHERE excluded.updated_at > note_state.updated_at`
            ).bind(
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
              `INSERT INTO products (${PROD_COLS}) VALUES (?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, price=excluded.price, created_at=excluded.created_at,
                 updated_at=excluded.updated_at, deleted=excluded.deleted
               WHERE excluded.updated_at > products.updated_at`
            ).bind(
              p.id, name, price,
              String(p.created_at || new Date().toISOString()),
              String(p.updated_at || new Date().toISOString()),
              p.deleted ? 1 : 0
            ));
          }
          if (pstmts.length) await env.DB.batch(pstmts);
          productsApplied = pstmts.length;
        } catch (e) { /* table missing on old DBs — entries already saved */ }
        return json({ ok: true, applied: stmts.length, notesApplied, statesApplied, productsApplied });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error' }, 500);
    }
  },
};
