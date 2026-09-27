-- migrate-02: multi-note model on an existing sales-notes D1.
-- Run once: wrangler d1 execute sales-notes --remote --file=worker/migrate-02.sql
ALTER TABLE entries ADD COLUMN note_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_entries_note ON entries(note_id);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'Note',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_date ON notes(date);

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

-- superseded by note_state (per-note locks); safe to drop
DROP TABLE IF EXISTS day_state;
