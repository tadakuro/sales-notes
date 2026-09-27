# My Sales Notes — personal daily sales notebook

No cashier system, no barcode, no stock. Just your own sales notes. Web app only.

**Live site:** https://tadakuro.github.io/sales-notes/

- **one access KEY** locks your notes on each device (no username)
- each day auto-starts a **fresh note** — entries auto-save with daily total
- entry fields: **item name, quantity, price, date, payment (Cash / QRIS)**, optional note
- totals: day total + Cash vs QRIS breakdown, monthly history, export/import JSON
- **no server, no install** — runs 100% in the browser, data stays in the device's localStorage

## Daily flow
1. **Day note** tab opens on today. Change date with ‹ Prev / Next or the picker.
2. Fill **Item, Qty, Price, Cash/QRIS, Date** → Save. Subtotal = qty × price.
3. Top banner shows **total earnings + cash/qris split** for that day.
4. Tomorrow = new empty note automatically. Old days stay in **History**.

## Multiple devices
Each device keeps its own notes. To move sales: **Settings → Export (JSON)** on device A → **Import** on device B.

## Deploy (GitHub Pages)
The live site is served from the `docs/` folder via Pages (`main` branch → `/docs`).
Just push to `main` — the site updates automatically in ~1 minute.

## Optional: local Python backend
`app.py` + `static/` is the older version with a real server + SQLite
(`python3 app.py --no-browser` → http://localhost:8000). The live
github.io site does not use it.

## Files
- `docs/index.html`, `docs/app.js`, `docs/style.css` — the live Pages site
- `app.py`, `static/` — optional local backend version
