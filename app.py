#!/usr/bin/env python3
"""
My Sales Notes — personal daily sales notebook
- stdlib only (runs on Android/Termux, Windows, Linux)
- Login with a single access KEY (works from any device, no username)
- Daily note: each date auto-gets a fresh blank note
- Entry fields: item name, quantity, price, date, payment (cash/qris), optional note
- Day totals + cash/qris breakdown auto-saved in DB

Run:  python3 app.py [--no-browser]
Then: http://localhost:8000
"""
import hashlib
import secrets
import json
import os
import re
import sys
import sqlite3
import webbrowser
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
from datetime import datetime, date as date_cls

def app_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = app_dir()
DB_PATH = os.path.join(BASE_DIR, "pos.db")
STATIC_DIR = os.path.join(BASE_DIR, "static")
if not os.path.isdir(STATIC_DIR):
    _src = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
    if os.path.isdir(_src):
        STATIC_DIR = _src
PORT = int(os.environ.get("POS_PORT", os.environ.get("PORT", "8000")))

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    created_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    item TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    payment TEXT NOT NULL DEFAULT 'cash',
    note TEXT DEFAULT '',
    created_at TEXT DEFAULT '',
    updated_at TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
"""

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

def today_str():
    return date_cls.today().isoformat()

def valid_date(s):
    if not s or not DATE_RE.match(s):
        return False
    try:
        datetime.strptime(s, "%Y-%m-%d")
        return True
    except ValueError:
        return False

def norm_payment(p):
    p = (p or "cash").strip().lower()
    if p in ("qris", "qr", "transfer", "tf"):
        return "qris"
    return "cash"

def hash_key(key, salt_hex=None):
    if salt_hex is None:
        salt_hex = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", key.encode("utf-8"), bytes.fromhex(salt_hex), 100_000)
    return salt_hex, dk.hex()

def verify_key(key, salt_hex, hash_hex):
    try:
        _, h = hash_key(key, salt_hex)
        return secrets.compare_digest(h, hash_hex)
    except Exception:
        return False

def db():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    return con

def get_setting(con, key, default=""):
    r = con.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default

def init_db():
    con = db()
    con.executescript(SCHEMA)
    con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('shop_name','My Sales Notes')")
    con.execute("INSERT OR IGNORE INTO settings(key,value) VALUES('currency','Rp')")
    con.commit()
    con.close()

def rows_to_list(rows):
    return [dict(r) for r in rows]

def day_summary(con, day):
    r = con.execute(
        "SELECT COALESCE(SUM(subtotal),0) t, COUNT(*) c FROM entries WHERE date=?", (day,)
    ).fetchone()
    cash = con.execute(
        "SELECT COALESCE(SUM(subtotal),0) t, COUNT(*) c FROM entries WHERE date=? AND payment='cash'", (day,)
    ).fetchone()
    qris = con.execute(
        "SELECT COALESCE(SUM(subtotal),0) t, COUNT(*) c FROM entries WHERE date=? AND payment='qris'", (day,)
    ).fetchone()
    return {
        "date": day,
        "total": round(r["t"] or 0, 2),
        "count": r["c"],
        "cash_total": round(cash["t"] or 0, 2),
        "cash_count": cash["c"],
        "qris_total": round(qris["t"] or 0, 2),
        "qris_count": qris["c"],
    }

class Handler(BaseHTTPRequestHandler):
    server_version = "SalesNotes/2.0"

    def log_message(self, *a):
        pass

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

    def auth_token(self):
        auth = self.headers.get("Authorization", "") or ""
        if auth.startswith("Bearer "):
            return auth[7:].strip()
        cookie = self.headers.get("Cookie", "") or ""
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith("pos_token="):
                return part[len("pos_token="):].strip()
        return ""

    def authed(self, con):
        tok = self.auth_token()
        if not tok:
            return False
        return con.execute("SELECT 1 FROM sessions WHERE token=?", (tok,)).fetchone() is not None

    def need_auth(self, con):
        if not self.authed(con):
            self.send_json({"error": "not_logged_in"}, 401)
            return False
        return True

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

    # ---------------- GET ----------------
    def do_GET(self):
        u = urlparse(self.path)
        p, q = u.path, parse_qs(u.query)
        con = db()
        try:
            if p == "/" or p == "/index.html" or p.startswith("/static/") or p.endswith((".html", ".js", ".css")):
                con.close()
                if p.startswith("/static/"):
                    return self.serve_static(p[7:])
                return self.serve_static(p)

            if p == "/api/setup-needed":
                needed = not get_setting(con, "access_hash", "")
                return self.send_json({"needed": needed})

            if p == "/api/public-settings":
                return self.send_json({
                    "shop_name": get_setting(con, "shop_name", "My Sales Notes"),
                })

            if p == "/api/me":
                if not self.authed(con):
                    return self.send_json({"error": "not_logged_in"}, 401)
                return self.send_json({"ok": True})

            if p == "/api/settings":
                if not self.need_auth(con): return
                return self.send_json({
                    "shop_name": get_setting(con, "shop_name", "My Sales Notes"),
                    "currency": get_setting(con, "currency", "Rp"),
                })

            if p == "/api/day":
                if not self.need_auth(con): return
                day = (q.get("date", [""])[0] or "").strip() or today_str()
                if not valid_date(day):
                    return self.send_json({"error": "bad_date, use YYYY-MM-DD"}, 400)
                entries = rows_to_list(con.execute(
                    "SELECT * FROM entries WHERE date=? ORDER BY id ASC", (day,)).fetchall())
                out = day_summary(con, day)
                out["entries"] = entries
                return self.send_json(out)

            if p == "/api/days":
                if not self.need_auth(con): return
                month = (q.get("month", [""])[0] or "").strip()  # YYYY-MM
                limit = int((q.get("limit", ["60"])[0] or "60"))
                limit = max(1, min(limit, 500))
                if month and not re.match(r"^\d{4}-\d{2}$", month):
                    return self.send_json({"error": "bad_month, use YYYY-MM"}, 400)
                if month:
                    rows = con.execute(
                        """SELECT date, COALESCE(SUM(subtotal),0) total, COUNT(*) count,
                                  COALESCE(SUM(CASE WHEN payment='cash' THEN subtotal ELSE 0 END),0) cash_total,
                                  COALESCE(SUM(CASE WHEN payment='qris' THEN subtotal ELSE 0 END),0) qris_total
                           FROM entries WHERE substr(date,1,7)=? GROUP BY date ORDER BY date DESC LIMIT ?""",
                        (month, limit)).fetchall()
                    mtot = con.execute(
                        "SELECT COALESCE(SUM(subtotal),0) t, COUNT(*) c FROM entries WHERE substr(date,1,7)=?",
                        (month,)).fetchone()
                else:
                    rows = con.execute(
                        """SELECT date, COALESCE(SUM(subtotal),0) total, COUNT(*) count,
                                  COALESCE(SUM(CASE WHEN payment='cash' THEN subtotal ELSE 0 END),0) cash_total,
                                  COALESCE(SUM(CASE WHEN payment='qris' THEN subtotal ELSE 0 END),0) qris_total
                           FROM entries GROUP BY date ORDER BY date DESC LIMIT ?""",
                        (limit,)).fetchall()
                    mtot = None
                days = [dict(r) for r in rows]
                for d in days:
                    d["total"] = round(d["total"] or 0, 2)
                    d["cash_total"] = round(d["cash_total"] or 0, 2)
                    d["qris_total"] = round(d["qris_total"] or 0, 2)
                resp = {"days": days}
                if mtot:
                    resp["month"] = month
                    resp["month_total"] = round(mtot["t"] or 0, 2)
                    resp["month_count"] = mtot["c"]
                return self.send_json(resp)

            if p == "/api/stats":
                if not self.need_auth(con): return
                t = today_str()
                month = t[:7]
                tr = con.execute("SELECT COALESCE(SUM(subtotal),0) s, COUNT(*) c FROM entries WHERE date=?", (t,)).fetchone()
                mr = con.execute("SELECT COALESCE(SUM(subtotal),0) s, COUNT(*) c FROM entries WHERE substr(date,1,7)=?", (month,)).fetchone()
                ar = con.execute("SELECT COALESCE(SUM(subtotal),0) s, COUNT(*) c FROM entries").fetchone()
                dc = con.execute("SELECT COUNT(DISTINCT date) c FROM entries").fetchone()["c"]
                return self.send_json({
                    "today": t, "month": month,
                    "today_total": round(tr["s"] or 0, 2), "today_count": tr["c"],
                    "month_total": round(mr["s"] or 0, 2), "month_count": mr["c"],
                    "all_total": round(ar["s"] or 0, 2), "all_count": ar["c"],
                    "days_count": dc,
                })

            if p == "/api/export":
                if not self.need_auth(con): return
                entries = rows_to_list(con.execute("SELECT * FROM entries ORDER BY date, id").fetchall())
                sett = {x["key"]: x["value"] for x in con.execute(
                    "SELECT key,value FROM settings WHERE key IN ('shop_name','currency')").fetchall()}
                return self.send_json({"entries": entries, "settings": sett,
                                       "exported_at": datetime.now().isoformat()})

            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass

    # ---------------- POST ----------------
    def do_POST(self):
        u = urlparse(self.path)
        p = u.path
        body = self.read_json()
        con = db()
        try:
            if p == "/api/setup":
                if get_setting(con, "access_hash", ""):
                    return self.send_json({"error": "already_setup"}, 400)
                key = (body.get("key") or "").strip()
                if len(key) < 4:
                    return self.send_json({"error": "key_min_4_chars"}, 400)
                salt, h = hash_key(key)
                con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('access_salt',?)", (salt,))
                con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('access_hash',?)", (h,))
                con.commit()
                tok = secrets.token_hex(32)
                con.execute("INSERT INTO sessions(token,created_at) VALUES(?,?)",
                            (tok, datetime.now().isoformat(timespec="seconds")))
                con.commit()
                return self.send_json({"ok": True, "token": tok})

            if p == "/api/login":
                key = (body.get("key") or "").strip()
                salt = get_setting(con, "access_salt", "")
                h = get_setting(con, "access_hash", "")
                if not h:
                    return self.send_json({"error": "not_setup", "setup_needed": True}, 400)
                if not key or not verify_key(key, salt, h):
                    return self.send_json({"error": "wrong_key"}, 401)
                tok = secrets.token_hex(32)
                con.execute("INSERT INTO sessions(token,created_at) VALUES(?,?)",
                            (tok, datetime.now().isoformat(timespec="seconds")))
                con.commit()
                return self.send_json({"ok": True, "token": tok})

            if p == "/api/logout":
                tok = self.auth_token() or (body.get("token") or "")
                if tok:
                    con.execute("DELETE FROM sessions WHERE token=?", (tok,))
                    con.commit()
                return self.send_json({"ok": True})

            if p == "/api/change-key":
                if not self.need_auth(con): return
                old = (body.get("old_key") or "").strip()
                new = (body.get("new_key") or "").strip()
                salt = get_setting(con, "access_salt", "")
                h = get_setting(con, "access_hash", "")
                if not verify_key(old, salt, h):
                    return self.send_json({"error": "wrong_old_key"}, 401)
                if len(new) < 4:
                    return self.send_json({"error": "key_min_4_chars"}, 400)
                s2, h2 = hash_key(new)
                con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('access_salt',?)", (s2,))
                con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES('access_hash',?)", (h2,))
                # log out all other sessions
                me = self.auth_token()
                con.execute("DELETE FROM sessions WHERE token!=?", (me,))
                con.commit()
                return self.send_json({"ok": True})

            if p == "/api/settings":
                if not self.need_auth(con): return
                for k in ("shop_name", "currency"):
                    if k in body and body[k] is not None:
                        con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                                    (k, str(body[k]).strip() or ("My Sales Notes" if k == "shop_name" else "Rp")))
                con.commit()
                return self.send_json({"ok": True})

            if p == "/api/entries":
                if not self.need_auth(con): return
                day = (body.get("date") or "").strip() or today_str()
                item = (body.get("item") or "").strip()
                try:
                    qty = float(body.get("qty", 1) or 1)
                except (ValueError, TypeError):
                    return self.send_json({"error": "bad_qty"}, 400)
                try:
                    price = float(body.get("price", 0) or 0)
                except (ValueError, TypeError):
                    return self.send_json({"error": "bad_price"}, 400)
                payment = norm_payment(body.get("payment"))
                note = (body.get("note") or "").strip()
                if not valid_date(day):
                    return self.send_json({"error": "bad_date"}, 400)
                if not item:
                    return self.send_json({"error": "item_required"}, 400)
                if qty <= 0:
                    return self.send_json({"error": "qty_must_be_positive"}, 400)
                if price < 0:
                    return self.send_json({"error": "price_cant_be_negative"}, 400)
                sub = round(qty * price, 2)
                now = datetime.now().isoformat(timespec="seconds")
                cur = con.execute(
                    "INSERT INTO entries(date,item,qty,price,subtotal,payment,note,created_at,updated_at)"
                    " VALUES(?,?,?,?,?,?,?,?,?)",
                    (day, item, qty, price, sub, payment, note, now, now))
                con.commit()
                r = con.execute("SELECT * FROM entries WHERE id=?", (cur.lastrowid,)).fetchone()
                out = dict(r)
                out["day"] = day_summary(con, day)
                return self.send_json(out)

            if p == "/api/import":
                if not self.need_auth(con): return
                entries = body.get("entries") or []
                overwrite = bool(body.get("overwrite", False))
                if overwrite:
                    con.execute("DELETE FROM entries")
                n = 0
                for e in entries:
                    try:
                        day = (e.get("date") or "").strip()
                        item = (e.get("item") or "").strip()
                        if not valid_date(day) or not item:
                            continue
                        qty = float(e.get("qty", 1) or 1)
                        price = float(e.get("price", 0) or 0)
                        if qty <= 0 or price < 0:
                            continue
                        payment = norm_payment(e.get("payment"))
                        note = (e.get("note") or "")[:500]
                        sub = round(qty * price, 2)
                        now = e.get("created_at") or datetime.now().isoformat(timespec="seconds")
                        con.execute(
                            "INSERT INTO entries(date,item,qty,price,subtotal,payment,note,created_at,updated_at)"
                            " VALUES(?,?,?,?,?,?,?,?,?)",
                            (day, item, qty, price, sub, payment, note, now, now))
                        n += 1
                    except Exception:
                        pass
                if isinstance(body.get("settings"), dict):
                    for k in ("shop_name", "currency"):
                        if body["settings"].get(k):
                            con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                                        (k, str(body["settings"][k])[:80]))
                con.commit()
                return self.send_json({"imported": n})

            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass

    # ---------------- PUT ----------------
    def do_PUT(self):
        u = urlparse(self.path)
        p = u.path
        body = self.read_json()
        con = db()
        try:
            if p.startswith("/api/entries/"):
                if not self.need_auth(con): return
                eid = p[len("/api/entries/"):]
                cur = con.execute("SELECT * FROM entries WHERE id=?", (eid,)).fetchone()
                if not cur:
                    return self.send_json({"error": "not_found"}, 404)
                d = dict(cur)
                if "date" in body and body["date"]:
                    nd = str(body["date"]).strip()
                    if not valid_date(nd):
                        return self.send_json({"error": "bad_date"}, 400)
                    d["date"] = nd
                if "item" in body and body["item"] is not None:
                    v = str(body["item"]).strip()
                    if not v:
                        return self.send_json({"error": "item_required"}, 400)
                    d["item"] = v
                if "qty" in body:
                    try:
                        qv = float(body["qty"] or 0)
                    except (ValueError, TypeError):
                        return self.send_json({"error": "bad_qty"}, 400)
                    if qv <= 0:
                        return self.send_json({"error": "qty_must_be_positive"}, 400)
                    d["qty"] = qv
                if "price" in body:
                    try:
                        pv = float(body["price"] or 0)
                    except (ValueError, TypeError):
                        return self.send_json({"error": "bad_price"}, 400)
                    if pv < 0:
                        return self.send_json({"error": "price_cant_be_negative"}, 400)
                    d["price"] = pv
                if "payment" in body:
                    d["payment"] = norm_payment(body["payment"])
                if "note" in body and body["note"] is not None:
                    d["note"] = str(body["note"])[:500]
                d["subtotal"] = round(float(d["qty"]) * float(d["price"]), 2)
                d["updated_at"] = datetime.now().isoformat(timespec="seconds")
                con.execute(
                    "UPDATE entries SET date=?,item=?,qty=?,price=?,subtotal=?,payment=?,note=?,updated_at=? WHERE id=?",
                    (d["date"], d["item"], d["qty"], d["price"], d["subtotal"],
                     d["payment"], d["note"], d["updated_at"], eid))
                con.commit()
                r = con.execute("SELECT * FROM entries WHERE id=?", (eid,)).fetchone()
                out = dict(r)
                out["day"] = day_summary(con, d["date"])
                return self.send_json(out)
            if p == "/api/settings":
                if not self.need_auth(con): return
                for k in ("shop_name", "currency"):
                    if k in body and body[k] is not None:
                        con.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)",
                                    (k, str(body[k]).strip()))
                con.commit()
                return self.send_json({"ok": True})
            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass

    # ---------------- DELETE ----------------
    def do_DELETE(self):
        u = urlparse(self.path)
        p = u.path
        con = db()
        try:
            if p.startswith("/api/entries/"):
                if not self.need_auth(con): return
                eid = p[len("/api/entries/"):]
                con.execute("DELETE FROM entries WHERE id=?", (eid,))
                con.commit()
                return self.send_json({"ok": True})
            self.send_error(404)
        finally:
            try: con.close()
            except Exception: pass


def main():
    init_db()
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"My Sales Notes running -> http://localhost:{PORT}")
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
