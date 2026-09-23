#!/usr/bin/env python3
"""
Simple Cashier / POS software
- stdlib only (no pip install needed) -> runs on Android/Termux, Windows, Linux
- SQLite database with barcode field
- Barcode scanner support: scanners type barcode + Enter, app looks it up,
  if not found it asks you to type product details manually.
- GitHub Actions builds this into a .exe (see .github/workflows/build-exe.yml)

Run:  python3 app.py
Then open: http://localhost:8000
"""
import json
import os
import sys
import sqlite3
import webbrowser
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from datetime import datetime

def app_dir():
    # When frozen with PyInstaller, exe dir; else script dir
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = app_dir()
DB_PATH = os.path.join(BASE_DIR, "pos.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
# dev fallback: static next to this source file when running from elsewhere
if not os.path.isdir(STATIC_DIR):
    _src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    if os.path.isdir(_src):
        STATIC_DIR = _src
PORT = int(os.environ.get("POS_PORT", "8000"))

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT UNIQUE,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    cost REAL NOT NULL DEFAULT 0,
    stock INTEGER NOT NULL DEFAULT 0,
    category TEXT DEFAULT '',
    created_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    datetime TEXT NOT NULL,
    date TEXT NOT NULL,
    total REAL NOT NULL,
    payment REAL NOT NULL,
    change REAL NOT NULL,
    cashier TEXT DEFAULT '',
    item_count INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    product_id INTEGER,
    barcode TEXT DEFAULT '',
    name TEXT NOT NULL,
    price REAL NOT NULL,
    qty INTEGER NOT NULL,
    subtotal REAL NOT NULL,
    FOREIGN KEY (sale_id) REFERENCES sales(id)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""

def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def init_db():
    con = db()
    con.executescript(SCHEMA)
    con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('shop_name','My Store')")
    con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('currency','₱')")
    con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('low_stock_at','5')")
    con.commit()
    # seed demo products on first run
    n = con.execute("SELECT COUNT(*) c FROM products").fetchone()["c"]
    if n == 0:
        now = datetime.now().isoformat(timespec="seconds")
        con.executemany(
            "INSERT INTO products(barcode,name,price,cost,stock,category,created_at) VALUES(?,?,?,?,?,?,?)",
            [
                ("480001111111", "Bottled Water 500ml", 20.0, 12.0, 50, "Drinks", now),
                ("480002222222", "Instant Noodles", 25.0, 15.0, 40, "Food", now),
                ("480003333333", "Coffee Sachet", 12.0, 7.0, 100, "Food", now),
            ],
        )
        con.commit()
    con.close()

def rows_to_list(rows):
    return [dict(r) for r in rows]

class Handler(BaseHTTPRequestHandler):
    server_version = "CashierPOS/1.0"

    def log_message(self, *a):
        pass  # quiet

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_json(self):
        ln = int(self.headers.get("Content-Length", 0) or 0)
        if not ln:
            return {}
        try:
            return json.loads(self.rfile.read(ln).decode())
        except Exception:
            return {}

    def serve_static(self, path):
        if path in ("/", "/index.html"):
            path = "/index.html"
        fpath = os.path.join(STATIC_DIR, unquote(path.lstrip("/")))
        if not os.path.abspath(fpath).startswith(os.path.abspath(STATIC_DIR)):
            self.send_error(403); return
        if not os.path.isfile(fpath):
            self.send_error(404); return
        ctype = "text/plain"
        if fpath.endswith(".html"): ctype = "text/html; charset=utf-8"
        elif fpath.endswith(".js"): ctype = "text/javascript; charset=utf-8"
        elif fpath.endswith(".css"): ctype = "text/css; charset=utf-8"
        with open(fpath, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)
        con = db()
        try:
            if p == "/" or p == "/index.html" or p.startswith("/static/") or p.endswith((".html", ".js", ".css")):
                con.close()
                # map /static/* -> /*
                if p.startswith("/static/"):
                    return self.serve_static(p[7:])
                return self.serve_static(p)
            if p == "/api/products":
                term = (q.get("q", [""])[0] or "").strip()
                if term:
                    like = f"%{term}%"
                    r = con.execute(
                        "SELECT * FROM products WHERE barcode LIKE ? OR name LIKE ? OR category LIKE ? ORDER BY name LIMIT 200",
                        (like, like, like)).fetchall()
                else:
                    r = con.execute("SELECT * FROM products ORDER BY name LIMIT 500").fetchall()
                return self.send_json(rows_to_list(r))
            if p.startswith("/api/product/"):
                code = unquote(p[len("/api/product/"):]).strip()
                r = con.execute("SELECT * FROM products WHERE barcode=?", (code,)).fetchone()
                if r: return self.send_json(dict(r))
                return self.send_json({"error": "not_found", "barcode": code}, 404)
            if p == "/api/sales":
                day = (q.get("date", [""])[0] or "").strip()
                if day:
                    r = con.execute("SELECT * FROM sales WHERE date=? ORDER BY id DESC", (day,)).fetchall()
                    tot = con.execute("SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM sales WHERE date=?", (day,)).fetchone()
                else:
                    r = con.execute("SELECT * FROM sales ORDER BY id DESC LIMIT 200").fetchall()
                    tot = con.execute("SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM sales").fetchone()
                return self.send_json({"sales": rows_to_list(r), "total": tot["t"], "count": tot["c"]})
            if p.startswith("/api/sales/"):
                sid = p[len("/api/sales/"):]
                s = con.execute("SELECT * FROM sales WHERE id=?", (sid,)).fetchone()
                if not s: return self.send_json({"error": "not_found"}, 404)
                items = con.execute("SELECT * FROM sale_items WHERE sale_id=?", (sid,)).fetchall()
                d = dict(s); d["items"] = rows_to_list(items)
                return self.send_json(d)
            if p == "/api/stats":
                today = datetime.now().strftime("%Y-%m-%d")
                t = con.execute("SELECT COALESCE(SUM(total),0) t, COUNT(*) c FROM sales WHERE date=?", (today,)).fetchone()
                low_at = int((con.execute("SELECT value FROM settings WHERE key='low_stock_at'").fetchone() or {"value": "5"})["value"] or 5)
                low = con.execute("SELECT COUNT(*) c FROM products WHERE stock<=?", (low_at,)).fetchone()["c"]
                prods = con.execute("SELECT COUNT(*) c FROM products").fetchone()["c"]
                return self.send_json({"today_total": t["t"], "today_count": t["c"], "low_stock": low, "products": prods, "date": today})
            if p == "/api/settings":
                r = con.execute("SELECT key,value FROM settings").fetchall()
                return self.send_json({x["key"]: x["value"] for x in r})
            if p == "/api/export":
                prods = rows_to_list(con.execute("SELECT * FROM products").fetchall())
                sales = rows_to_list(con.execute("SELECT * FROM sales ORDER BY id").fetchall())
                items = rows_to_list(con.execute("SELECT * FROM sale_items ORDER BY id").fetchall())
                sett = {x["key"]: x["value"] for x in con.execute("SELECT key,value FROM settings").fetchall()}
                return self.send_json({"products": prods, "sales": sales, "sale_items": items, "settings": sett,
                                        "exported_at": datetime.now().isoformat()})
            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass

    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        body = self.read_json()
        con = db()
        try:
            if p == "/api/products":
                barcode = (body.get("barcode") or "").strip()
                name = (body.get("name") or "").strip()
                if not name: return self.send_json({"error": "name_required"}, 400)
                if not barcode:  # allow no-barcode items: generate internal code
                    barcode = f"NOBC-{int(datetime.now().timestamp())}"
                try:
                    cur = con.execute(
                        "INSERT INTO products(barcode,name,price,cost,stock,category,created_at) VALUES(?,?,?,?,?,?,?)",
                        (barcode, name, float(body.get("price", 0) or 0), float(body.get("cost", 0) or 0),
                         int(body.get("stock", 0) or 0), (body.get("category") or "").strip(),
                         datetime.now().isoformat(timespec="seconds")))
                    con.commit()
                    r = con.execute("SELECT * FROM products WHERE id=?", (cur.lastrowid,)).fetchone()
                    return self.send_json(dict(r))
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "barcode_exists"}, 409)
            if p == "/api/stock":
                pid = int(body.get("id", 0) or 0)
                chg = int(body.get("qty_change", 0) or 0)
                con.execute("UPDATE products SET stock=stock+? WHERE id=?", (chg, pid))
                con.commit()
                r = con.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
                return self.send_json(dict(r) if r else {"error": "not_found"})
            if p == "/api/checkout":
                items = body.get("items") or []
                payment = float(body.get("payment", 0) or 0)
                cashier = (body.get("cashier") or "").strip()
                if not items: return self.send_json({"error": "empty_cart"}, 400)
                total, lines = 0.0, []
                for it in items:
                    qty = int(it.get("qty", 1) or 1)
                    prod = None
                    if it.get("barcode"):
                        prod = con.execute("SELECT * FROM products WHERE barcode=?", (it["barcode"],)).fetchone()
                    if prod is None and it.get("id"):
                        prod = con.execute("SELECT * FROM products WHERE id=?", (it["id"],)).fetchone()
                    if prod is None:
                        return self.send_json({"error": f'product_not_found: {it.get("barcode") or it.get("id")}'}, 400)
                    if prod["stock"] < qty:
                        return self.send_json({"error": f'insufficient_stock: {prod["name"]} (have {prod["stock"]})'}, 400)
                    sub = round(prod["price"] * qty, 2)
                    total += sub
                    lines.append((prod, qty, sub))
                total = round(total, 2)
                if payment < total:
                    return self.send_json({"error": f"payment_short: need {total}"}, 400)
                now = datetime.now()
                cur = con.execute(
                    "INSERT INTO sales(datetime,date,total,payment,change,cashier,item_count) VALUES(?,?,?,?,?,?,?)",
                    (now.isoformat(timespec="seconds"), now.strftime("%Y-%m-%d"), total, payment,
                     round(payment - total, 2), cashier, len(lines)))
                sid = cur.lastrowid
                for prod, qty, sub in lines:
                    con.execute(
                        "INSERT INTO sale_items(sale_id,product_id,barcode,name,price,qty,subtotal) VALUES(?,?,?,?,?,?,?)",
                        (sid, prod["id"], prod["barcode"], prod["name"], prod["price"], qty, sub))
                    con.execute("UPDATE products SET stock=stock-? WHERE id=?", (qty, prod["id"]))
                con.commit()
                s = con.execute("SELECT * FROM sales WHERE id=?", (sid,)).fetchone()
                d = dict(s); d["items"] = rows_to_list(con.execute("SELECT * FROM sale_items WHERE sale_id=?", (sid,)).fetchall())
                return self.send_json(d)
            if p == "/api/import":
                # used for moving DB to another device: {products:[...], overwrite:bool}
                prods = body.get("products") or []
                overwrite = bool(body.get("overwrite", False))
                n = 0
                for pr in prods:
                    try:
                        if overwrite:
                            con.execute(
                                "INSERT OR REPLACE INTO products(barcode,name,price,cost,stock,category,created_at) VALUES(?,?,?,?,?,?,?)",
                                (pr.get("barcode"), pr.get("name"), float(pr.get("price", 0) or 0),
                                 float(pr.get("cost", 0) or 0), int(pr.get("stock", 0) or 0),
                                 pr.get("category", ""), pr.get("created_at") or datetime.now().isoformat()))
                        else:
                            con.execute(
                                "INSERT OR IGNORE INTO products(barcode,name,price,cost,stock,category,created_at) VALUES(?,?,?,?,?,?,?)",
                                (pr.get("barcode"), pr.get("name"), float(pr.get("price", 0) or 0),
                                 float(pr.get("cost", 0) or 0), int(pr.get("stock", 0) or 0),
                                 pr.get("category", ""), pr.get("created_at") or datetime.now().isoformat()))
                        n += 1
                    except Exception:
                        pass
                con.commit()
                return self.send_json({"imported": n})
            if p == "/api/settings":
                for k, v in body.items():
                    con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (k, str(v)))
                con.commit()
                return self.send_json({"ok": True})
            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass

    def do_PUT(self):
        u = urlparse(self.path)
        p = u.path
        body = self.read_json()
        con = db()
        try:
            if p.startswith("/api/products/"):
                pid = p[len("/api/products/"):]
                cur = con.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
                if not cur: return self.send_json({"error": "not_found"}, 404)
                d = dict(cur)
                for f in ("barcode", "name", "category"):
                    if f in body and body[f] is not None: d[f] = str(body[f]).strip()
                for f in ("price", "cost"):
                    if f in body: d[f] = float(body[f] or 0)
                if "stock" in body: d["stock"] = int(body["stock"] or 0)
                try:
                    con.execute("UPDATE products SET barcode=?,name=?,price=?,cost=?,stock=?,category=? WHERE id=?",
                                (d["barcode"], d["name"], d["price"], d["cost"], d["stock"], d["category"], pid))
                    con.commit()
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "barcode_exists"}, 409)
                r = con.execute("SELECT * FROM products WHERE id=?", (pid,)).fetchone()
                return self.send_json(dict(r))
            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass

    def do_DELETE(self):
        u = urlparse(self.path)
        p = u.path
        con = db()
        try:
            if p.startswith("/api/products/"):
                pid = p[len("/api/products/"):]
                con.execute("DELETE FROM products WHERE id=?", (pid,))
                con.commit()
                return self.send_json({"ok": True})
            if p.startswith("/api/sales/"):
                sid = p[len("/api/sales/"):]
                con.execute("DELETE FROM sale_items WHERE sale_id=?", (sid,))
                con.execute("DELETE FROM sales WHERE id=?", (sid,))
                con.commit()
                return self.send_json({"ok": True})
            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass


def main():
    init_db()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Cashier POS running -> http://localhost:{PORT}")
    print(f"Database: {DB_PATH}")
    if "--no-browser" not in sys.argv and not getattr(sys, "frozen", False):
        try:
            threading.Timer(1.0, lambda: webbrowser.open(f"http://localhost:{PORT}")).start()
        except Exception:
            pass
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")

if __name__ == "__main__":
    main()
