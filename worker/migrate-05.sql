-- migrate-05: shop settings sync (shop name, currency, WA number).
-- Single global row (key='shop'), last writer wins by updated_at.
-- Run once: wrangler d1 execute sales-notes --remote --file=worker/migrate-05.sql
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
);
