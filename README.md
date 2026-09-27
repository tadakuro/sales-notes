# My Sales Notes — personal daily sales notebook

No cashier system, no barcode, no stock. Just your own sales notes.

- runs on **Android (Termux), Windows, Linux** with no install (`python3 app.py`)
- **one access KEY** unlocks it from any device (no username)
- each day auto-starts a **fresh note** — entries auto-save with daily total
- entry fields: **item name, quantity, price, date, payment (Cash / QRIS)**, optional note
- totals: day total + Cash vs QRIS breakdown, monthly history, export/import JSON
- **SQLite** (`pos.db`), stdlib only

## 1. Run on Android (Termux)
```bash
cd cashier-pos
python3 app.py --no-browser
# then open http://localhost:8000 in Chrome
```

## 2. First open
1. Create your access key (min 4 chars) — keep it private.
2. On any other device, open the same address and enter that key.

## 3. Daily flow
1. **Day note** tab opens on today. Change date with ‹ Prev / Next or the picker.
2. Fill **Item, Qty, Price, Cash/QRIS, Date** → Save. Subtotal = qty × price.
3. Top banner shows **total earnings + cash/qris split** for that day.
4. Tomorrow = new empty note automatically. Old days stay in **History**.

## 4. Build .exe (Windows, via GitHub Actions)
Same as before: Actions → Build Windows EXE → download artifact.
Data saves to `pos.db` beside the exe.

Old cashier DB (if any) was archived to `pos.db.bak-*`.

## Files
- `app.py` — backend + database (stdlib only)
- `static/index.html`, `app.js`, `style.css` — frontend
- `.github/workflows/build-exe.yml` — builds the .exe
