-- D1 schema for connector storage (passwords are encrypted with AES-GCM at rest).
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  username TEXT,
  password_ciphertext_b64 TEXT,
  password_iv_b64 TEXT,
  config_json TEXT,
  secret_ciphertext_b64 TEXT,
  secret_iv_b64 TEXT,
  health_status TEXT NOT NULL DEFAULT 'healthy',
  health_error_code TEXT,
  health_error_message TEXT,
  health_checked_at_ms INTEGER,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_connectors_type ON connectors(type);

-- Persists one MCP token per browser client so the token survives localStorage
-- being cleared. client_id is a UUID generated once by the browser.
CREATE TABLE IF NOT EXISTS mcp_tokens (
  client_id TEXT PRIMARY KEY,
  token     TEXT NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL
);

-- Durable MCP activation/usage events. token_hash avoids duplicating bearer
-- capability URLs in analytics rows while still allowing per-token funnels.
CREATE TABLE IF NOT EXISTS mcp_events (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  tool_name TEXT,
  ok INTEGER NOT NULL DEFAULT 1,
  error_code TEXT,
  created_at_ms INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_events_type_created ON mcp_events(event_type, created_at_ms);
CREATE INDEX IF NOT EXISTS idx_mcp_events_token_created ON mcp_events(token_hash, created_at_ms);

-- Anonymous published pages (public /p/<slug>-<id>). No accounts: whoever holds
-- the edit key may republish/unpublish. Only the SHA-256 of the key is stored.
-- status: 'published' | 'unpublished' (unpublished rows keep id/slug for a 410).
CREATE TABLE IF NOT EXISTS published_pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  edit_key_hash TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL,
  word_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_published_pages_status_updated ON published_pages(status, updated_at);

-- Rolling per-IP publish counters for rate limiting (ip_hash, never the raw IP).
-- kind: 'publish' | 'republish'.
CREATE TABLE IF NOT EXISTS publish_events (
  ip_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_publish_events_ip_kind_created ON publish_events(ip_hash, kind, created_at);

-- Abuse / removal requests filed from the public page footer.
CREATE TABLE IF NOT EXISTS page_reports (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_page_reports_page ON page_reports(page_id, created_at);
