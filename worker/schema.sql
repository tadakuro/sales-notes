-- Shared sales database (Cloudflare D1, SQLite).
-- Run once: wrangler d1 execute sales-notes --file=worker/schema.sql
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
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

-- Per-day close state (locked notes + snapshotted totals). Synced like entries.
CREATE TABLE IF NOT EXISTS day_state (
    date TEXT PRIMARY KEY,
    closed INTEGER NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    cash_total REAL NOT NULL DEFAULT 0,
    qris_total REAL NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT DEFAULT '',
    updated_at TEXT NOT NULL
);
