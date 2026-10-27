-- Accounts-backed ownership for published pages (profiles at /@handle).
-- owner_user_id = theindie-api user id; NULL = anonymous (edit key only).
--
-- SQLite/D1 has no "ADD COLUMN IF NOT EXISTS", so this file is NOT safe to run
-- twice by hand. Apply it through Wrangler's migration tracker, which records it
-- in the d1_migrations table and skips it afterwards:
--   wrangler d1 migrations apply DB --local     (dev)
--   wrangler d1 migrations apply DB --remote    (prod, after schema.sql)
-- Fresh databases: run schema.sql first, then apply migrations.
ALTER TABLE published_pages ADD COLUMN owner_user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_published_pages_owner ON published_pages(owner_user_id, status, updated_at);
