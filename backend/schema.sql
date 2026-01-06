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
