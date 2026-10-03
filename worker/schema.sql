-- Shared sales database (Cloudflare D1, SQLite).
-- Fresh install: wrangler d1 execute sales-notes --file=worker/schema.sql
-- Existing DBs: run worker/migrate-02.sql then worker/migrate-03.sql instead.
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    note_id TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    item TEXT NOT NULL,
    qty REAL NOT NULL DEFAULT 1,
    price REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    payment TEXT NOT NULL DEFAULT 'cash',
    note TEXT DEFAULT '',
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entries_updated ON entries(updated_at);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
CREATE INDEX IF NOT EXISTS idx_entries_note ON entries(note_id);

-- Notes: many per date. Synced like entries.
-- shift: pagi / siang / lembur — one open note per date+shift.
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Note',
    shift TEXT NOT NULL DEFAULT 'pagi',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);

-- Per-note close state (locked notes + snapshotted totals). Synced like entries.
CREATE TABLE IF NOT EXISTS note_state (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    cash_total REAL NOT NULL DEFAULT 0,
    qris_total REAL NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT DEFAULT '',
    updated_at TEXT NOT NULL
);

-- Shop settings (shop name, currency, WA number). Single global row
-- key='shop', last writer wins by updated_at. Synced like entries.
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);
-- Quick products catalog (one-tap sell). Synced like entries.
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
