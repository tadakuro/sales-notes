# My Sales Notes — personal daily sales notebook

No cashier system, no barcode, no stock. Just your own sales notes. Web app only.

**Live site:** https://tadakuro.github.io/sales-notes/

- **accounts**: visitors Daftar (register) / Masuk (login) with username + password —
  each account gets its own **private panel** (isolated `account_id` in D1 +
  per-account localStorage namespace), synced across that account's devices.
  Old site-key installs keep working against the same Worker (legacy shared panel).
- each day auto-starts a **fresh note** — entries auto-save with daily total
- entry fields: **item name, quantity, price, date, payment (Cash / QRIS)**, optional note
- totals: day total + Cash vs QRIS breakdown, monthly history, export/import JSON
- **no server, no install** — runs 100% in the browser, data stays in each device's localStorage

## Daily flow
1. **Day tab** lists that day's notes. **+ New note** starts another note under the
   same day (morning / evening / per customer — name them with ✏️ Rename).
2. Tap a note to open it, then fill **Item, Qty, Price, Cash/QRIS** → Save.
   Subtotal = qty × price. Each note has its own total + cash/qris split.
3. The day header accumulates **all notes** of the day.
4. Tomorrow = fresh day automatically. Old days stay in **History** (per-day
   totals with note counts).
5. **🔒 Close note** locks one note on all devices and snapshots (accumulates)
   its final total. Closed notes show a lock banner and get a 🔒 badge with
   locked totals per month. **Reopen** to edit again. Deleting a note removes
   its sales (synced).

## Shifts (Pagi / Siang / Lembur)
Lainnya → **⏰ Shift aktif**: toggle each shift on/off (min. 1 stays on).
Disabled shifts disappear from the Jual form; old data stays and still counts in
Stats/Riwayat. The toggle syncs per account, so all your devices follow.

## Multiple devices — auto sync
Sales sync automatically through Cloudflare Workers + D1 (free tier):
open the site on any device, log in to your account, everything appears.
Works offline too — entries queue locally and sync when back online
(header shows ✓ synced / … syncing / ✕ offline).
Manual Export/Import JSON remains as backup.
First login on a device that still holds pre-account data offers to move it
(with fresh ids) into your new private panel.

## Cloud sync setup (repo owner, one time)
1. Cloudflare account → get **Account ID** (domain overview page, right sidebar).
2. Create an **API token**: Profile → API Tokens → Create Token → custom:
   Account → **D1:Edit**, **Workers Scripts:Edit**.
3. Deploy (from this folder, needs `wrangler` — `npm i -g wrangler`):
```bash
export CLOUDFLARE_API_TOKEN=<token> CLOUDFLARE_ACCOUNT_ID=<account-id>
cd worker
wrangler d1 create sales-notes            # paste database_id into wrangler.toml
wrangler d1 execute sales-notes --file=schema.sql
wrangler secret put SITE_KEY              # same value as the SITE_KEY GitHub secret
wrangler deploy                           # note the https://….workers.dev URL
```
4. Point the site at it (empty = offline-only mode):
`gh secret set SYNC_URL -R tadakuro/sales-notes` with the worker URL.
Pushes redeploy the site automatically (~1 min).
5. After pulling worker updates, apply DB migrations in order then redeploy:
```bash
cd worker
for f in migrate-02.sql migrate-03.sql migrate-04.sql migrate-05.sql migrate-06.sql; do
  wrangler d1 execute sales-notes --file=$f
done
wrangler deploy
```
(`migrate-06.sql` adds `accounts`/`sessions` + per-row `account_id`. Fresh DBs
can use `schema.sql` directly. Re-run deploys are safe — all statements are
`IF NOT EXISTS`; `ALTER TABLE … ADD COLUMN` fails harmlessly if already applied,
so run each file and ignore "duplicate column" errors.)

## Accounts (repo owner)
- Registration is open: anyone with the site URL can Daftar. Endpoints are
  rate-limited per IP (`/api/register` 10/hour, `/api/login` 30/10 min);
  passwords are PBKDF2-SHA256 (60k rounds) salted hashes — never plaintext.
- Each account's rows are filtered by `account_id` on every pull/push; the upsert
  guard (`entries.account_id = excluded.account_id`) blocks cross-account
  overwrites even on id collision.
- Legacy `SITE_KEY` bearer still works and maps to the old shared panel,
  so pre-account app versions keep syncing.

## Read API (verify data anytime)
All scoped to the caller's account (`SITE_KEY` = legacy shared panel).
Get a token: browser DevTools → Application → Local Storage → `sn_accounts`
(copy any account's `token`), or use the raw `SITE_KEY` for the legacy panel.
```bash
W=https://sales-notes-sync.topia.workers.dev
AUTH="Authorization: Bearer <token-atau-site-key>"
curl -s "$W/api/sales?date=2026-10-04" -H "$AUTH"          # one day + summary
curl -s "$W/api/sales?date=2026-10-04&shift=pagi" -H "$AUTH"
curl -s "$W/api/history?month=2026-10" -H "$AUTH"          # per-day totals
curl -s "$W/api/stats?month=2026-10" -H "$AUTH"            # totals + top items
```

## Site key (repo owner, legacy mode only)
- Set it: `gh secret set SITE_KEY -R tadakuro/sales-notes` (prompts privately), or repo → Settings → Secrets → Actions → New secret `SITE_KEY`.
- Change/rotate it the same way — the `Deploy to Pages` workflow rebuilds the site automatically (~1 min).
- The workflow hashes `sn::<key>` with SHA-256 and injects only the hash into `site/app.js`. The raw key never lands in git.
- Honest limits: this is a static site, so the gate is a *casual* lock — all code ships to the browser, and anyone technical can bypass client-side checks. Use a long passphrase. Real access control would need a server in front.

## Deploy (GitHub Pages)
Pages source = **GitHub Actions** (workflow `.github/workflows/deploy-pages.yml` builds `site/` → deploys).
Just push to `main` — the site updates automatically in ~1 minute.

## Android APK
Same `site/` wrapped in an offline WebView (`android/`), built by CI:
- every `main` push → verification build (APK in the run's Artifacts)
- **Releases**: Actions → `Build APK` → `Run workflow` → fill `release_tag`
  (e.g. `v1.0.0`) → APK published at repo → Releases
- sideload on Android 7.0+, same site key as the web version; Export JSON/Excel
  saves to Downloads, Import reads JSON backup.

## Optional: local Python backend
`app.py` + `static/` is the older version with a real server + SQLite
(`python3 app.py --no-browser` → http://localhost:8000). The live
github.io site does not use it.

## Files
- `site/index.html`, `site/app.js`, `site/style.css` — the live Pages site source
- `worker/worker.js`, `worker/schema.sql`, `worker/wrangler.toml` — Cloudflare sync backend
- `.github/workflows/deploy-pages.yml` — injects key hash + sync URL + deploys
- `app.py`, `static/` — optional local backend version
