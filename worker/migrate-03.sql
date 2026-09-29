-- migrate-03: quick products catalog for the POS revamp.
-- Run once: wrangler d1 execute sales-notes --remote --file=worker/migrate-03.sql
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_products_updated ON products(updated_at);
