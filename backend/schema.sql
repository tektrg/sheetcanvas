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
