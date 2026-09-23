# Cashier POS — simple cashier software

My suggestion vs Excel: **don't use Excel**. Excel formulas break easily, no barcode lookup, no stock auto-decrease, hard to print receipts. This app is better:
- runs on **Android (Termux), Windows, Linux** with no install (`python3 app.py`)
- builds to a **single `.exe`** on Windows via GitHub Actions
- **SQLite database** stores barcode → product, so any scanner on any device finds it; unknown barcodes prompt for manual entry
- features: product list + checkout, stock tracking + low-stock alerts, sales reports + printable receipts, export/import JSON to move data to another device

## 1. Run on Android (Termux) — now
```bash
cd cashier-pos
python3 app.py --no-browser
# then open http://localhost:8000 in Chrome
```

## 2. Run on Windows without .exe (Python)
```bat
python app.py
```

## 3. Get the .exe via GitHub Actions (recommended)
1. Create a GitHub repo, upload this `cashier-pos` folder contents.
2. Go to **Actions → Build Windows EXE → Run**.
   Every push to `main` also builds automatically.
3. Download artifact **CashierPOS-windows-exe** → `CashierPOS.exe`.
4. Double-click `CashierPOS.exe` on any Windows PC (no Python needed). Data saves to `pos.db` beside the exe.

To build `.exe` locally on Windows instead:
```bat
pip install pyinstaller
pyinstaller --onefile --noconsole --name CashierPOS --add-data "static;static" app.py
```

## 4. Barcode workflow (your requirement)
1. Click the **barcode box** in POS tab, scan with USB/Bluetooth scanner (acts as keyboard + Enter).
2. If barcode exists → product auto-added to cart.
3. If not → popup asks you to **type name/price/stock manually** → saved to database → next scan on any device (after Export→Import) finds it.

Multi-device sync: **Settings → Export JSON** on device A → copy file → **Import** on device B. (True live-sync needs a server — ask me if you want that next.)

## Files
- `app.py` — backend + database (stdlib only)
- `static/index.html`, `app.js`, `style.css` — frontend
- `.github/workflows/build-exe.yml` — builds the .exe
