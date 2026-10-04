-- Multi-account: each account gets its own isolated panel.
-- Run after migrate-05: wrangler d1 execute sales-notes --file=worker/migrate-06.sql
-- Existing rows keep account_id '' (legacy shared SITE_KEY panel).
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
ALTER TABLE entries ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE notes ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE note_state ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
ALTER TABLE products ADD COLUMN account_id TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_entries_acct ON entries(account_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_acct ON notes(account_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_states_acct ON note_state(account_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_products_acct ON products(account_id, updated_at);
