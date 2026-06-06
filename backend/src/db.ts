import { HttpError } from "./errors";
import type { Env } from "./env";

export type ConnectorType = "clickhouse" | "google-analytics" | "google-sheets";

export type ConnectorRow = {
  id: string;
  type: ConnectorType;
  name: string;
  url?: string | null;
  username?: string | null;
  password_ciphertext_b64?: string | null;
  password_iv_b64?: string | null;
  config_json?: string | null;
  secret_ciphertext_b64?: string | null;
  secret_iv_b64?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

export type PublicConnector = Pick<
  ConnectorRow,
  "id" | "type" | "name" | "url" | "username" | "config_json" | "created_at_ms" | "updated_at_ms"
>;

let connectorsSchemaEnsured = false;

async function ensureConnectorsSchema(env: Env) {
  if (connectorsSchemaEnsured) return;

  const cols = await env.DB.prepare("PRAGMA table_info(connectors)").all<{ name: string }>();
  const columnNames = new Set((cols.results ?? []).map((c) => c.name));

  if (columnNames.size === 0) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS connectors (
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
      )`
    ).run();
  }

  const refreshed = await env.DB.prepare("PRAGMA table_info(connectors)").all<{ name: string }>();
  const refreshedNames = new Set((refreshed.results ?? []).map((c) => c.name));

  const maybeAddColumn = async (name: string, typeSql: string) => {
    if (refreshedNames.has(name)) return;
    await env.DB.prepare(`ALTER TABLE connectors ADD COLUMN ${name} ${typeSql}`).run();
    refreshedNames.add(name);
  };

  await maybeAddColumn("url", "TEXT");
  await maybeAddColumn("username", "TEXT");
  await maybeAddColumn("password_ciphertext_b64", "TEXT");
  await maybeAddColumn("password_iv_b64", "TEXT");
  await maybeAddColumn("config_json", "TEXT");
  await maybeAddColumn("secret_ciphertext_b64", "TEXT");
  await maybeAddColumn("secret_iv_b64", "TEXT");
  await maybeAddColumn("created_at_ms", "INTEGER NOT NULL DEFAULT 0");
  await maybeAddColumn("updated_at_ms", "INTEGER NOT NULL DEFAULT 0");

  await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_connectors_type ON connectors(type)").run();

  connectorsSchemaEnsured = true;
}

export async function listConnectors(env: Env): Promise<PublicConnector[]> {
  await ensureConnectorsSchema(env);
  const res = await env.DB.prepare(
    "SELECT id, type, name, url, username, config_json, created_at_ms, updated_at_ms FROM connectors ORDER BY created_at_ms DESC"
  ).all<PublicConnector>();

  return res.results ?? [];
}

export async function insertClickhouseConnector(
  env: Env,
  row: Omit<ConnectorRow, "type" | "config_json" | "secret_ciphertext_b64" | "secret_iv_b64"> & { type?: ConnectorType }
): Promise<PublicConnector> {
  await ensureConnectorsSchema(env);
  const now = Date.now();
  const toInsert: ConnectorRow = {
    ...row,
    type: "clickhouse",
    config_json: null,
    secret_ciphertext_b64: null,
    secret_iv_b64: null,
    created_at_ms: row.created_at_ms ?? now,
    updated_at_ms: row.updated_at_ms ?? now
  };

  await env.DB.prepare(
    "INSERT INTO connectors (id, type, name, url, username, password_ciphertext_b64, password_iv_b64, config_json, secret_ciphertext_b64, secret_iv_b64, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      toInsert.id,
      toInsert.type,
      toInsert.name,
      toInsert.url,
      toInsert.username,
      toInsert.password_ciphertext_b64,
      toInsert.password_iv_b64,
      toInsert.config_json,
      toInsert.secret_ciphertext_b64,
      toInsert.secret_iv_b64,
      toInsert.created_at_ms,
      toInsert.updated_at_ms
    )
    .run();

  return {
    id: toInsert.id,
    type: toInsert.type,
    name: toInsert.name,
    url: toInsert.url,
    username: toInsert.username,
    config_json: toInsert.config_json,
    created_at_ms: toInsert.created_at_ms,
    updated_at_ms: toInsert.updated_at_ms
  };
}

export async function insertGoogleAnalyticsConnector(
  env: Env,
  row: Omit<
    ConnectorRow,
    | "type"
    | "url"
    | "username"
    | "password_ciphertext_b64"
    | "password_iv_b64"
  > & { type?: ConnectorType }
): Promise<PublicConnector> {
  await ensureConnectorsSchema(env);
  const now = Date.now();
  const toInsert: ConnectorRow = {
    ...row,
    type: "google-analytics",
    // Some dev databases may have older NOT NULL constraints from early schema
    // versions (e.g. url/username/password fields for ClickHouse-only support).
    // Store harmless placeholders so inserts don't fail across schema variants.
    url: "",
    username: "",
    password_ciphertext_b64: "",
    password_iv_b64: "",
    created_at_ms: row.created_at_ms ?? now,
    updated_at_ms: row.updated_at_ms ?? now
  };

  await env.DB.prepare(
    "INSERT INTO connectors (id, type, name, url, username, password_ciphertext_b64, password_iv_b64, config_json, secret_ciphertext_b64, secret_iv_b64, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      toInsert.id,
      toInsert.type,
      toInsert.name,
      toInsert.url,
      toInsert.username,
      toInsert.password_ciphertext_b64,
      toInsert.password_iv_b64,
      toInsert.config_json,
      toInsert.secret_ciphertext_b64,
      toInsert.secret_iv_b64,
      toInsert.created_at_ms,
      toInsert.updated_at_ms
    )
    .run();

  return {
    id: toInsert.id,
    type: toInsert.type,
    name: toInsert.name,
    url: toInsert.url,
    username: toInsert.username,
    config_json: toInsert.config_json,
    created_at_ms: toInsert.created_at_ms,
    updated_at_ms: toInsert.updated_at_ms
  };
}

export async function insertGoogleSheetsConnector(
  env: Env,
  row: Omit<
    ConnectorRow,
    | "type"
    | "url"
    | "username"
    | "password_ciphertext_b64"
    | "password_iv_b64"
  > & { type?: ConnectorType }
): Promise<PublicConnector> {
  await ensureConnectorsSchema(env);
  const now = Date.now();
  const toInsert: ConnectorRow = {
    ...row,
    type: "google-sheets",
    url: "",
    username: "",
    password_ciphertext_b64: "",
    password_iv_b64: "",
    created_at_ms: row.created_at_ms ?? now,
    updated_at_ms: row.updated_at_ms ?? now
  };

  await env.DB.prepare(
    "INSERT INTO connectors (id, type, name, url, username, password_ciphertext_b64, password_iv_b64, config_json, secret_ciphertext_b64, secret_iv_b64, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      toInsert.id,
      toInsert.type,
      toInsert.name,
      toInsert.url,
      toInsert.username,
      toInsert.password_ciphertext_b64,
      toInsert.password_iv_b64,
      toInsert.config_json,
      toInsert.secret_ciphertext_b64,
      toInsert.secret_iv_b64,
      toInsert.created_at_ms,
      toInsert.updated_at_ms
    )
    .run();

  return {
    id: toInsert.id,
    type: toInsert.type,
    name: toInsert.name,
    url: toInsert.url,
    username: toInsert.username,
    config_json: toInsert.config_json,
    created_at_ms: toInsert.created_at_ms,
    updated_at_ms: toInsert.updated_at_ms
  };
}

export async function getConnectorById(env: Env, id: string): Promise<ConnectorRow> {
  await ensureConnectorsSchema(env);
  const res = await env.DB.prepare("SELECT * FROM connectors WHERE id = ?").bind(id).first<ConnectorRow>();
  if (!res) throw new HttpError(404, "connector_not_found", "Connector not found");
  return res;
}
