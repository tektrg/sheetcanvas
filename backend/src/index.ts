import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./env";
import { HttpError, toJsonError } from "./errors";
import { requireBearerToken } from "./auth";
import { decryptString, encryptString } from "./crypto";
import { executeClickhouseQuery, getClickhouseSchema, describeClickhouseTable } from "./clickhouse";
import {
  exchangeGoogleAnalyticsCode,
  getGoogleAnalyticsMetadata,
  listGoogleAnalyticsProperties,
  refreshGoogleAnalyticsAccessToken,
  runGoogleAnalyticsReport
} from "./googleAnalytics";
import { getConnectorById, insertClickhouseConnector, insertGoogleAnalyticsConnector, listConnectors } from "./db";
import {
  clickhouseCreateSchema,
  clickhouseDescribeSchema,
  clickhouseQuerySchema,
  clickhouseSchemaSchema,
  clickhouseTestSchema,
  googleAnalyticsAuthExchangeSchema,
  googleAnalyticsMetadataSchema,
  googleAnalyticsPropertiesSchema,
  googleAnalyticsQuerySchema
} from "./validation";
import { handleAgentRequest, handleQuotaRead } from "./agent/route";

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
    allowHeaders: ["Content-Type", "Authorization", "x-session-id"],
    exposeHeaders: ["x-agent-quota-used", "x-agent-quota-limit"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400
  })
);

app.options("*", (c) => c.body(null, 204));

app.onError((err, c) => {
  const { status, body } = toJsonError(err);
  if (status >= 500) {
    const url = new URL(c.req.url);
    console.error("[flexsheet-backend] unhandled error", {
      method: c.req.method,
      path: url.pathname,
      status,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err
    });
  }
  return c.json(body, status);
});

app.get("/health", (c) => c.json({ ok: true }));

app.post("/api/agent", (c) => {
  requireBearerToken(c.req.raw, c.env);
  return handleAgentRequest(c);
});
app.get("/api/agent/quota", (c) => {
  requireBearerToken(c.req.raw, c.env);
  return handleQuotaRead(c);
});

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
  if (connector.type !== "clickhouse") {
    throw new HttpError(400, "unsupported_connector", "Unsupported connector type");
  }
  if (!connector.url || !connector.username) {
    throw new HttpError(400, "missing_config", "Connector is missing connection details");
  }
  if (!connector.password_ciphertext_b64 || !connector.password_iv_b64) {
    throw new HttpError(400, "missing_secret", "Connector is missing credentials");
  }
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

app.post("/api/connectors/google-analytics/auth/exchange", async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const parsed = googleAnalyticsAuthExchangeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: parsed.error.message } }, 400);

  const clientId = c.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new HttpError(500, "missing_config", "GOOGLE_CLIENT_ID is not set");

  const token = await exchangeGoogleAnalyticsCode({
    code: parsed.data.code,
    codeVerifier: parsed.data.codeVerifier,
    redirectUri: parsed.data.redirectUri,
    clientId,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET?.trim()
  });

  if (!token.refresh_token) {
    throw new HttpError(400, "missing_refresh_token", "No refresh token returned. Re-consent is required.");
  }

  const { ciphertextB64, ivB64 } = await encryptString(token.refresh_token, c.env.ENCRYPTION_KEY_B64);
  const configJson = JSON.stringify({ scope: token.scope ?? null });

  const connector = await insertGoogleAnalyticsConnector(c.env, {
    id: crypto.randomUUID(),
    name: "Google Analytics",
    config_json: configJson,
    secret_ciphertext_b64: ciphertextB64,
    secret_iv_b64: ivB64,
    created_at_ms: Date.now(),
    updated_at_ms: Date.now()
  });

  return c.json({ connector }, 201);
});

app.post("/api/connectors/google-analytics/properties", async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const parsed = googleAnalyticsPropertiesSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: parsed.error.message } }, 400);

  const connector = await getConnectorById(c.env, parsed.data.connectorId);
  if (connector.type !== "google-analytics") {
    throw new HttpError(400, "unsupported_connector", "Unsupported connector type");
  }

  const clientId = c.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new HttpError(500, "missing_config", "GOOGLE_CLIENT_ID is not set");
  if (!connector.secret_ciphertext_b64 || !connector.secret_iv_b64) {
    throw new HttpError(400, "missing_secret", "Connector is missing credentials");
  }

  const refreshToken = await decryptString(
    connector.secret_ciphertext_b64,
    connector.secret_iv_b64,
    c.env.ENCRYPTION_KEY_B64
  );

  const access = await refreshGoogleAnalyticsAccessToken({
    refreshToken,
    clientId,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET?.trim()
  });

  const propertiesResult = await listGoogleAnalyticsProperties({
    accessToken: access.access_token,
    pageSize: parsed.data.pageSize,
    pageToken: parsed.data.pageToken
  });

  return c.json(propertiesResult);
});

app.post("/api/query/google-analytics", async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const body = await c.req.json().catch(() => null);
  const parsed = googleAnalyticsQuerySchema.safeParse(body);
  if (!parsed.success) return c.json({ error: { code: "bad_request", message: parsed.error.message } }, 400);

  const connector = await getConnectorById(c.env, parsed.data.connectorId);
  if (connector.type !== "google-analytics") {
    throw new HttpError(400, "unsupported_connector", "Unsupported connector type");
  }

  const clientId = c.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new HttpError(500, "missing_config", "GOOGLE_CLIENT_ID is not set");
  if (!connector.secret_ciphertext_b64 || !connector.secret_iv_b64) {
    throw new HttpError(400, "missing_secret", "Connector is missing credentials");
  }

  const refreshToken = await decryptString(
    connector.secret_ciphertext_b64,
    connector.secret_iv_b64,
    c.env.ENCRYPTION_KEY_B64
  );

  const access = await refreshGoogleAnalyticsAccessToken({
    refreshToken,
    clientId,
    clientSecret: c.env.GOOGLE_CLIENT_SECRET?.trim()
  });

  const maxRows = getMaxRows(c.env);
  const normalizedPropertyId = parsed.data.propertyId.replace(/^properties\//i, "");
  const result = await runGoogleAnalyticsReport({
    accessToken: access.access_token,
    propertyId: normalizedPropertyId,
    report: parsed.data.report,
    maxRows
  });

  return c.json({
    columns: result.columns,
    rows: result.rows,
    rowCount: result.rowCount,
    truncated: result.truncated
  });
});

app.post('/api/connectors/clickhouse/schema', async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const parsed = clickhouseSchemaSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'bad_request', message: parsed.error.message } }, 400);
  const connector = await getConnectorById(c.env, parsed.data.connectorId);
  if (connector.type !== 'clickhouse') throw new HttpError(400, 'unsupported_connector', 'Unsupported connector type');
  if (!connector.url || !connector.username) throw new HttpError(400, 'missing_config', 'Connector is missing connection details');
  if (!connector.password_ciphertext_b64 || !connector.password_iv_b64) throw new HttpError(400, 'missing_secret', 'Connector is missing credentials');
  const password = await decryptString(connector.password_ciphertext_b64, connector.password_iv_b64, c.env.ENCRYPTION_KEY_B64);
  const result = await getClickhouseSchema({ url: connector.url, username: connector.username, password, database: parsed.data.database, timeoutMs: getTimeoutMs(c.env) });
  return c.json(result);
});

app.post('/api/connectors/clickhouse/describe', async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const parsed = clickhouseDescribeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'bad_request', message: parsed.error.message } }, 400);
  const connector = await getConnectorById(c.env, parsed.data.connectorId);
  if (connector.type !== 'clickhouse') throw new HttpError(400, 'unsupported_connector', 'Unsupported connector type');
  if (!connector.url || !connector.username) throw new HttpError(400, 'missing_config', 'Connector is missing connection details');
  if (!connector.password_ciphertext_b64 || !connector.password_iv_b64) throw new HttpError(400, 'missing_secret', 'Connector is missing credentials');
  const password = await decryptString(connector.password_ciphertext_b64, connector.password_iv_b64, c.env.ENCRYPTION_KEY_B64);
  const result = await describeClickhouseTable({ url: connector.url, username: connector.username, password, table: parsed.data.table, timeoutMs: getTimeoutMs(c.env) });
  return c.json(result);
});

app.post('/api/connectors/google-analytics/metadata', async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const parsed = googleAnalyticsMetadataSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'bad_request', message: parsed.error.message } }, 400);
  const connector = await getConnectorById(c.env, parsed.data.connectorId);
  if (connector.type !== 'google-analytics') throw new HttpError(400, 'unsupported_connector', 'Unsupported connector type');
  const clientId = c.env.GOOGLE_CLIENT_ID?.trim();
  if (!clientId) throw new HttpError(500, 'missing_config', 'GOOGLE_CLIENT_ID is not set');
  if (!connector.secret_ciphertext_b64 || !connector.secret_iv_b64) throw new HttpError(400, 'missing_secret', 'Connector is missing credentials');
  const refreshToken = await decryptString(connector.secret_ciphertext_b64, connector.secret_iv_b64, c.env.ENCRYPTION_KEY_B64);
  const access = await refreshGoogleAnalyticsAccessToken({ refreshToken, clientId, clientSecret: c.env.GOOGLE_CLIENT_SECRET?.trim() });
  const result = await getGoogleAnalyticsMetadata({ accessToken: access.access_token, propertyId: parsed.data.propertyId });
  return c.json(result);
});

export default app;
