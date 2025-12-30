import { HttpError } from "./errors";
import type { Env } from "./env";

export type ConnectorType = "clickhouse";

export type ConnectorRow = {
  id: string;
  type: ConnectorType;
  name: string;
  url: string;
  username: string;
  password_ciphertext_b64: string;
  password_iv_b64: string;
  created_at_ms: number;
  updated_at_ms: number;
};

export type PublicConnector = Pick<ConnectorRow, "id" | "type" | "name" | "url" | "username" | "created_at_ms" | "updated_at_ms">;

export async function listConnectors(env: Env): Promise<PublicConnector[]> {
  const res = await env.DB.prepare(
    "SELECT id, type, name, url, username, created_at_ms, updated_at_ms FROM connectors ORDER BY created_at_ms DESC"
  ).all<PublicConnector>();

  return res.results ?? [];
}

export async function insertClickhouseConnector(
  env: Env,
  row: Omit<ConnectorRow, "type"> & { type?: ConnectorType }
): Promise<PublicConnector> {
  const now = Date.now();
  const toInsert: ConnectorRow = {
    ...row,
    type: "clickhouse",
    created_at_ms: row.created_at_ms ?? now,
    updated_at_ms: row.updated_at_ms ?? now
  };

  await env.DB.prepare(
    "INSERT INTO connectors (id, type, name, url, username, password_ciphertext_b64, password_iv_b64, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(
      toInsert.id,
      toInsert.type,
      toInsert.name,
      toInsert.url,
      toInsert.username,
      toInsert.password_ciphertext_b64,
      toInsert.password_iv_b64,
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
    created_at_ms: toInsert.created_at_ms,
    updated_at_ms: toInsert.updated_at_ms
  };
}

export async function getConnectorById(env: Env, id: string): Promise<ConnectorRow> {
  const res = await env.DB.prepare("SELECT * FROM connectors WHERE id = ?").bind(id).first<ConnectorRow>();
  if (!res) throw new HttpError(404, "connector_not_found", "Connector not found");
  if (res.type !== "clickhouse") throw new HttpError(400, "unsupported_connector", "Unsupported connector type");
  return res;
}

