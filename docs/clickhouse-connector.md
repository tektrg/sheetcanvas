# ClickHouse connector (backend proxy)

This document explains how Flexsheet’s ClickHouse connector works end-to-end: how the frontend stores a “connected sheet” configuration, how the backend stores encrypted credentials, and how queries are executed safely through a proxy so the browser never connects to ClickHouse directly.

## Why there is a backend

Flexsheet uses a Cloudflare Worker (`backend/`) as a proxy layer for ClickHouse:

- The browser never talks to ClickHouse directly (no CORS issues, no exposing internal hosts).
- ClickHouse credentials are never stored in the browser.
- Queries are constrained to read-only SQL and hard-limited for safety.

## High-level flow

1) User configures a ClickHouse connector in the UI (URL + username + password).
2) Frontend calls the backend to (optionally) test the credentials, then saves the connector.
3) Backend encrypts the password at rest in D1, and returns a “public connector” (no password).
4) User writes a SQL query in the UI and runs it.
5) Frontend calls the backend query endpoint with `connectorId` + `sql`.
6) Backend decrypts the stored password, executes the SQL against ClickHouse over HTTP, and returns rows/columns to the browser.
7) Frontend converts the result into a `string[][]` matrix and populates the sheet; the sheet stores a `connectorConfig` so it can be refreshed later.

## Frontend pieces

### Backend client

`utils/clickhouseBackend.ts` is the single place that talks to the backend:

- Base URL: `VITE_BACKEND_URL` (defaults to `http://localhost:8787`)
- Optional auth: `VITE_API_BEARER_TOKEN` (sent as `Authorization: Bearer <token>`)

It exposes:

- `listClickhouseConnectors()`
- `testClickhouseConnector(draft)`
- `createClickhouseConnector(draft)`
- `queryClickhouse({ connectorId, sql, limit? })`
- `clickhouseResultToMatrix(result)` (adapts backend response to sheet-friendly `string[][]`)

### “Connect Data” UI

`components/DataConnectorDialog.tsx` drives the ClickHouse connection flow:

- Loads the connector list from `GET /api/connectors`
- Supports creating a new connector (URL/username/password) via:
  - `POST /api/connectors/clickhouse/test` (optional “Test”)
  - `POST /api/connectors/clickhouse` (“Save connector”)
- Runs the query via `POST /api/query/clickhouse` and creates a sheet with `connectorConfig` like:

```ts
{
  type: 'clickhouse',
  name: 'ClickHouse',
  params: {
    connectorId,
    sql,
    lastRefreshedAt: Date.now(),
    truncated: boolean
  }
}
```

### Refreshing a connected sheet

`components/SheetNode.tsx` implements refresh/edit behavior for connected ClickHouse sheets:

- The sheet is treated as read-only (because it is computed from the connector)
- “Refresh” reruns the saved SQL via `queryClickhouse`
- On success, the sheet updates:
  - cells + size based on the returned matrix
  - `connectorConfig.params.lastRefreshedAt`
  - `connectorConfig.params.truncated`
- On failure, the sheet records `connectorConfig.params.lastError` so the UI can surface it

## Backend pieces

### API routes

Backend routes are defined in `backend/src/index.ts` (Hono).

All `/api/*` routes optionally require `Authorization: Bearer <token>` if the secret `API_BEARER_TOKEN` is set (see `backend/src/auth.ts`).

#### `GET /api/connectors`

Returns all saved connectors (public fields only):

```json
{
  "connectors": [
    {
      "id": "uuid",
      "type": "clickhouse",
      "name": "Prod ClickHouse",
      "url": "https://host:8443/?database=default",
      "username": "readonly",
      "created_at_ms": 1730000000000,
      "updated_at_ms": 1730000000000
    }
  ]
}
```

#### `POST /api/connectors/clickhouse/test`

Validates credentials by running a trivial query (`SELECT 1`).

Request:

```json
{ "url": "https://host:8443/?database=default", "username": "readonly", "password": "..." }
```

Response:

```json
{ "ok": true }
```

#### `POST /api/connectors/clickhouse`

Creates a stored connector. The password is encrypted and saved in D1. The response does not include the password.

Request:

```json
{ "name": "Prod ClickHouse", "url": "https://host:8443/?database=default", "username": "readonly", "password": "..." }
```

Response (201):

```json
{
  "connector": {
    "id": "uuid",
    "type": "clickhouse",
    "name": "Prod ClickHouse",
    "url": "https://host:8443/?database=default",
    "username": "readonly",
    "created_at_ms": 1730000000000,
    "updated_at_ms": 1730000000000
  }
}
```

#### `POST /api/query/clickhouse`

Executes a query using a saved connector.

Request:

```json
{ "connectorId": "uuid", "sql": "SELECT count(*) AS n FROM events", "limit": 5000 }
```

Response:

```json
{
  "columns": [{ "name": "n", "type": "UInt64" }],
  "rows": [[12345]],
  "rowCount": 1,
  "truncated": false
}
```

### Credential storage (D1 + encryption)

Connector storage is a single D1 table (`backend/schema.sql`):

- `url`, `username` stored as plaintext
- password stored as:
  - `password_ciphertext_b64`
  - `password_iv_b64`

Passwords are encrypted/decrypted via WebCrypto AES-GCM (`backend/src/crypto.ts`) using `ENCRYPTION_KEY_B64` (base64-encoded 32 bytes).

### ClickHouse query execution

Query execution lives in `backend/src/clickhouse.ts`:

- HTTP interface: sends the SQL as a `POST` body to the configured ClickHouse URL
- Auth: `Authorization: Basic <base64(username:password)>`
- Default format: adds `default_format=JSONCompact` to the ClickHouse URL if not already set
- Timeout: aborts the request after `DEFAULT_TIMEOUT_MS` (default 15000ms; max 120000ms)
- Limits:
  - Rejects multi-statement queries (any `;`)
  - Only allows queries starting with `SELECT` or `WITH`
  - Rejects obvious write keywords (`insert`, `update`, `delete`, `drop`)
  - If the SQL has no `LIMIT`, appends `LIMIT <maxRows>`
  - `maxRows` is capped by `MAX_ROWS` (default 5000; max 100000)

### Errors

Backend errors are normalized to JSON:

```json
{ "error": { "code": "timeout", "message": "Query timed out" } }
```

The frontend client (`requestJson` in `utils/clickhouseBackend.ts`) surfaces `error.message` as the thrown `Error` message so UI code can display it directly.

## Configuration reference

Frontend (Vite):

- `VITE_BACKEND_URL` (default `http://localhost:8787`)
- `VITE_API_BEARER_TOKEN` (optional; must match backend `API_BEARER_TOKEN`)

Backend (Cloudflare Worker / Wrangler):

- `ENCRYPTION_KEY_B64` (required; base64 of 32 bytes)
- `API_BEARER_TOKEN` (optional; protects all `/api/*` routes)
- `ALLOWED_ORIGINS` (optional; comma-separated list, or `*`; defaults to `http://localhost:3000,http://localhost:5173`)
- `DEFAULT_TIMEOUT_MS` (optional; default `15000`)
- `MAX_ROWS` (optional; default `5000`)

## Local development checklist

See `backend/README.md` for the full local setup. In practice:

- Start both services: `npm run dev:local`
- Ensure the backend can encrypt: set `ENCRYPTION_KEY_B64` (for local dev, `backend/README.md` shows a `.dev.vars` approach)
- If you enable backend auth, set:
  - backend `API_BEARER_TOKEN` (Wrangler secret / `.dev.vars`)
  - frontend `VITE_API_BEARER_TOKEN`

## Troubleshooting

- `Failed to load connectors` in UI: backend not running, wrong `VITE_BACKEND_URL`, or backend auth enabled without `VITE_API_BEARER_TOKEN`.
- `Only SELECT/WITH queries are allowed`: backend blocks non-read-only SQL and multi-statement queries.
- `Query timed out`: increase `DEFAULT_TIMEOUT_MS` (or pass `timeoutMs` in the request if you add that to the frontend).
- Unexpected truncation: the backend enforces `MAX_ROWS` and the frontend enforces max imported rows/cols for sheet rendering.
