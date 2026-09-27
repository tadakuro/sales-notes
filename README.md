# My Sales Notes — personal daily sales notebook

No cashier system, no barcode, no stock. Just your own sales notes. Web app only.

**Live site:** https://tadakuro.github.io/sales-notes/ 🔒 key-locked

- **one site key** opens the gate on every device (stored as the `SITE_KEY` GitHub secret — only its hash is baked into the site, never the key itself)
- each day auto-starts a **fresh note** — entries auto-save with daily total
- entry fields: **item name, quantity, price, date, payment (Cash / QRIS)**, optional note
- totals: day total + Cash vs QRIS breakdown, monthly history, export/import JSON
- **no server, no install** — runs 100% in the browser, data stays in each device's localStorage

## Daily flow
1. **Day note** tab opens on today. Change date with ‹ Prev / Next or the picker.
2. Fill **Item, Qty, Price, Cash/QRIS, Date** → Save. Subtotal = qty × price.
3. Top banner shows **total earnings + cash/qris split** for that day.
4. Tomorrow = new empty note automatically. Old days stay in **History**.

## Multiple devices
Each device keeps its own notes. To move sales: **Settings → Export (JSON)** on device A → **Import** on device B.

## Site key (repo owner)
- Set it: `gh secret set SITE_KEY -R tadakuro/sales-notes` (prompts privately), or repo → Settings → Secrets → Actions → New secret `SITE_KEY`.
- Change/rotate it the same way — the `Deploy to Pages` workflow rebuilds the site automatically (~1 min).
- The workflow hashes `sn::<key>` with SHA-256 and injects only the hash into `site/app.js`. The raw key never lands in git.
- Honest limits: this is a static site, so the gate is a *casual* lock — all code ships to the browser, and anyone technical can bypass client-side checks. Use a long passphrase. Real access control would need a server in front.

## Deploy (GitHub Pages)
Pages source = **GitHub Actions** (workflow `.github/workflows/deploy-pages.yml` builds `site/` → deploys).
Just push to `main` — the site updates automatically in ~1 minute.

## Optional: local Python backend
`app.py` + `static/` is the older version with a real server + SQLite
(`python3 app.py --no-browser` → http://localhost:8000). The live
github.io site does not use it.

## Files
- `site/index.html`, `site/app.js`, `site/style.css` — the live Pages site source
- `.github/workflows/deploy-pages.yml` — injects key hash + deploys
- `app.py`, `static/` — optional local backend version
