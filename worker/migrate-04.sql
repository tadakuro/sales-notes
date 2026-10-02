-- migrate-04: shift column for per-shift notes (Shift 1 / Shift 2 per day).
-- Run once: wrangler d1 execute sales-notes --remote --file=worker/migrate-04.sql
-- Backward compatible: old notes default to '1' (Shift 1).
ALTER TABLE notes ADD COLUMN shift TEXT NOT NULL DEFAULT '1';
