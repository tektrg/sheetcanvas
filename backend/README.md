# Flexsheet Backend (Cloudflare Workers)

This backend provides a secure proxy layer for ClickHouse connectors so the browser never talks to ClickHouse directly and never stores passwords.

## Stack

- Cloudflare Workers (Fetch API runtime)
- Wrangler (dev + deploy)
- D1 (stores connector metadata + encrypted passwords)
- WebCrypto (AES-GCM) for encryption at rest

## Setup

1) Create a D1 database

```bash
wrangler d1 create flexsheet
```

2) Apply schema

```bash
wrangler d1 execute flexsheet --file ./backend/schema.sql
```

3) Configure `backend/wrangler.toml`

- Update the `database_name` to match the name you created.
- Add the generated `database_id` for production.

4) Set required secrets

```bash
wrangler secret put ENCRYPTION_KEY_B64
```

`ENCRYPTION_KEY_B64` must be a base64-encoded 32-byte key (AES-256).
You can also provide a comma-separated list of keys to support key rotation (the first key is used for encryption; all keys are tried for decryption).

Optional auth (recommended in production):

```bash
wrangler secret put API_BEARER_TOKEN
```

If set, all `/api/*` routes require `Authorization: Bearer <token>`.

## Local dev

From the repo root, you can start frontend + backend together:

```bash
npm run dev:local
```

Or run the backend by itself:

```bash
cd backend

# one-time: initialize local D1 schema
wrangler d1 execute DB --local --file ./schema.sql

# required for local encryption (create your own 32-byte key)
node -e "console.log('ENCRYPTION_KEY_B64='+require('crypto').randomBytes(32).toString('base64'))" >> .dev.vars

# start the worker
HOME=$PWD/.home WRANGLER_LOG_PATH=$PWD/.wrangler-logs WRANGLER_LOG=info \
wrangler dev src/index.ts --config wrangler.toml --local --port 8787
```

If you already have a local D1 database from an older schema, the worker will auto-add newly introduced columns on startup; you can also re-run the schema step above to create the table from scratch.

If you change `ENCRYPTION_KEY_B64`, existing connectors created with the old key will no longer decrypt. Either keep the old key in the comma-separated list (key rotation), or delete and recreate the affected connectors.

If you change the frontend dev server port, update `ALLOWED_ORIGINS` in `backend/wrangler.toml` (or override it via `.dev.vars`).

## API

- `GET /health`
- `GET /api/connectors`
- `POST /api/connectors/clickhouse/test`
- `POST /api/connectors/clickhouse`
- `POST /api/query/clickhouse`
