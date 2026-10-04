-- Shared sales database (Cloudflare D1, SQLite).
-- Fresh install: wrangler d1 execute sales-notes --file=worker/schema.sql
-- Existing DBs: run worker/migrate-02.sql through worker/migrate-06.sql instead.
-- Multi-account: every data row carries account_id. '' = legacy shared
-- SITE_KEY panel; 'u_…' = registered account's private panel.
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    pass_salt TEXT NOT NULL,
    pass_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_username ON accounts(username);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_entries_acct ON entries(account_id, updated_at);

-- Notes: many per date. Synced like entries.
-- shift: pagi / siang / lembur — one open note per date+shift.
CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Note',
    shift TEXT NOT NULL DEFAULT 'pagi',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);
CREATE INDEX IF NOT EXISTS idx_notes_acct ON notes(account_id, updated_at);

-- Per-note close state (locked notes + snapshotted totals). Synced like entries.
CREATE TABLE IF NOT EXISTS note_state (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    closed INTEGER NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    cash_total REAL NOT NULL DEFAULT 0,
    qris_total REAL NOT NULL DEFAULT 0,
    count INTEGER NOT NULL DEFAULT 0,
    closed_at TEXT DEFAULT '',
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_states_acct ON note_state(account_id, updated_at);

-- Shop settings (shop name, currency, shifts). One row per account:
-- key='<account_id>:shop', legacy shared panel keeps key='shop'.
-- Last writer wins by updated_at. Synced like entries.
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);
-- Quick products catalog (one-tap sell). Synced like entries.
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
CREATE INDEX IF NOT EXISTS idx_products_acct ON products(account_id, updated_at);
