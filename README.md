# My Sales Notes — personal daily sales notebook

No cashier system, no barcode, no stock. Just your own sales notes. Web app only.

- runs on **Android (Termux), Windows, Linux** with no install (`python3 app.py`)
- deployable to **Render** free tier (`render.yaml` included, reads `$PORT`)
- **one access KEY** unlocks it from any device (no username)
- each day auto-starts a **fresh note** — entries auto-save with daily total
- entry fields: **item name, quantity, price, date, payment (Cash / QRIS)**, optional note
- totals: day total + Cash vs QRIS breakdown, monthly history, export/import JSON
- **SQLite** (`pos.db`), stdlib only — no pip install needed

## 1. Run locally
```bash
python3 app.py --no-browser
# then open http://localhost:8000 in your browser
```

## 2. First open
1. Create your access key (min 4 chars) — keep it private.
2. On any other device, open the same address and enter that key.

## 3. Daily flow
1. **Day note** tab opens on today. Change date with ‹ Prev / Next or the picker.
2. Fill **Item, Qty, Price, Cash/QRIS, Date** → Save. Subtotal = qty × price.
3. Top banner shows **total earnings + cash/qris split** for that day.
4. Tomorrow = new empty note automatically. Old days stay in **History**.

## 4. Deploy to Render (free)
1. Push this repo to GitHub.
2. Render → **New → Web Service** → select the repo (auto-detects `render.yaml`).
3. Open the `https://….onrender.com` URL, create your key, done.
4. Note: free tier sleeps when idle + SQLite is ephemeral — use **Settings → Export JSON** regularly as backup.

## Files
- `app.py` — backend + database (stdlib only)
- `static/index.html`, `app.js`, `style.css` — frontend
- `render.yaml` — Render deploy config
