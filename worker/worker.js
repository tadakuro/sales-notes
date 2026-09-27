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

const COLS = 'id,date,item,qty,price,subtotal,payment,note,updated_at,deleted';

export default {
  async fetch(req, env) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/api/health') return json({ ok: true });
    if (!authed(req, env)) return json({ error: 'unauthorized' }, 401);

    try {
      // Pull everything changed since a timestamp (tombstones included).
      if (req.method === 'GET' && url.pathname === '/api/pull') {
        const since = url.searchParams.get('since') || '1970-01-01T00:00:00';
        const { results } = await env.DB.prepare(
          `SELECT ${COLS} FROM entries WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 2000`
        ).bind(since).all();
        return json({ entries: results || [] });
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
            `INSERT INTO entries (${COLS}) VALUES (?,?,?,?,?,?,?,?,?,?)
             ON CONFLICT(id) DO UPDATE SET
               date=excluded.date, item=excluded.item, qty=excluded.qty,
               price=excluded.price, subtotal=excluded.subtotal,
               payment=excluded.payment, note=excluded.note,
               updated_at=excluded.updated_at, deleted=excluded.deleted
             WHERE excluded.updated_at > entries.updated_at`
          ).bind(
            e.id, e.date, item, qty, price,
            Math.round(qty * price * 100) / 100, payment,
            String(e.note || '').slice(0, 500),
            String(e.updated_at || new Date().toISOString()),
            e.deleted ? 1 : 0
          ));
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true, applied: stmts.length });
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      return json({ error: 'server_error' }, 500);
    }
  },
};
