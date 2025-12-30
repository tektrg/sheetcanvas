import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { toJsonError } from "./errors";
import { requireBearerToken } from "./auth";
import { decryptString, encryptString } from "./crypto";
import { executeClickhouseQuery } from "./clickhouse";
import { getConnectorById, insertClickhouseConnector, listConnectors } from "./db";
import { clickhouseCreateSchema, clickhouseQuerySchema, clickhouseTestSchema } from "./validation";

function parseAllowedOrigins(origins: string | undefined) {
  const v = (origins ?? "").trim();
  if (!v) return ["http://localhost:3000", "http://localhost:5173"];
  if (v === "*") return ["*"];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function getMaxRows(env: Env) {
  const raw = Number(env.MAX_ROWS ?? "5000");
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 100_000) : 5000;
}

function getTimeoutMs(env: Env) {
  const raw = Number(env.DEFAULT_TIMEOUT_MS ?? "15000");
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 120_000) : 15000;
}

const app = new Hono<{ Bindings: Env }>();

app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = parseAllowedOrigins(c.env.ALLOWED_ORIGINS);
      if (allowed.includes("*")) return origin ?? "*";
      if (!origin) return allowed[0] ?? "http://localhost:5173";
      return allowed.includes(origin) ? origin : "";
    },
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400
  })
);

app.options("*", (c) => c.body(null, 204));

app.onError((err, c) => {
  const { status, body } = toJsonError(err);
  return c.json(body, status);
});

app.get("/health", (c) => c.json({ ok: true }));

app.get("/api/connectors", async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const connectors = await listConnectors(c.env);
  return c.json({ connectors });
});

app.post("/api/connectors/clickhouse/test", async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const parsed = clickhouseTestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: parsed.error.message } }, 400);

  await executeClickhouseQuery({
    url: parsed.data.url,
    username: parsed.data.username,
    password: parsed.data.password,
    sql: "SELECT 1",
    maxRows: 1,
    timeoutMs: getTimeoutMs(c.env)
  });

  return c.json({ ok: true });
});

app.post("/api/connectors/clickhouse", async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const parsed = clickhouseCreateSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: parsed.error.message } }, 400);

  const name = parsed.data.name?.trim() || new URL(parsed.data.url).host;
  const { ciphertextB64, ivB64 } = await encryptString(parsed.data.password, c.env.ENCRYPTION_KEY_B64);

  const connector = await insertClickhouseConnector(c.env, {
    id: crypto.randomUUID(),
    name,
    url: parsed.data.url,
    username: parsed.data.username,
    password_ciphertext_b64: ciphertextB64,
    password_iv_b64: ivB64,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now()
  });

  return c.json({ connector }, 201);
});

app.post("/api/query/clickhouse", async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const body = await c.req.json().catch(() => null);
  const parsed = clickhouseQuerySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: parsed.error.message } }, 400);

  const connector = await getConnectorById(c.env, parsed.data.connectorId);
  const password = await decryptString(
    connector.password_ciphertext_b64,
    connector.password_iv_b64,
    c.env.ENCRYPTION_KEY_B64
  );

  const maxRows = Math.min(parsed.data.limit ?? getMaxRows(c.env), getMaxRows(c.env));
  const timeoutMs = parsed.data.timeoutMs ?? getTimeoutMs(c.env);

  const result = await executeClickhouseQuery({
    url: connector.url,
    username: connector.username,
    password,
    sql: parsed.data.sql,
    maxRows,
    timeoutMs
  });

  return c.json({
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    truncated: result.rows.length >= maxRows
  });
});

export default app;
