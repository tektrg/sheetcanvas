# Google Analytics connector plan (GA4)

Purpose: let a user connect, authenticate, and retrieve data from Google Analytics (GA4) to visualize it as a connected sheet on the Flexsheet canvas.

This plan mirrors the ClickHouse connector pattern: the frontend stores a “connected sheet” configuration, and a Cloudflare Worker backend proxies API calls and stores sensitive credentials encrypted at rest.

## Goals

- User can authenticate with Google and grant access to GA4 Analytics Data API.
- User can pick a GA4 property and define a report (dimensions/metrics/date range/filter/order/limit).
- App fetches data and creates a connected sheet on the canvas.
- Connected sheets can be refreshed and edited (report config changes) without re-authentication.
- Secrets/tokens are not stored in the browser; backend stores credentials encrypted.

## Non-goals (initial version)

- Universal Analytics (UA) support (deprecated).
- Full GA API surface (admin mutations, user management).
- Multi-tenant org-grade auth policies; start with single-user/local dev assumptions.
- Real-time streaming; this is a fetch/report connector.

## UX: user flow in the app

Entry point: “Connect Data” → “Google Analytics”.

1. Connect account
  - Show “Sign in with Google” / “Connect Google Analytics”.
  - After successful auth, show connected status and available GA4 properties.
2. Configure report
  - Property selector (dropdown of properties user can access).
  - Date range: preset (7/14/28/90 days) + custom range.
  - Dimensions (multi-select) and Metrics (multi-select).
  - Optional: filters, order by, limit.
  - “Preview” to fetch and render sample table.
3. Create connected sheet
  - “Run & Create Sheet” creates a sheet with `connectorConfig` and populated cells.
4. Connected sheet maintenance
  - Sheet header: “Refresh” and “Edit config”.
  - Refresh re-runs the report with stored connector + report config.

## Data model

### Frontend `connectorConfig`

Store enough to re-run the report without user input:

```ts
type GoogleAnalyticsConnectorConfig = {
  type: 'google-analytics';
  name: 'Google Analytics';
  params: {
    connectorId: string;          // refers to stored auth/identity in backend
    propertyId: string;           // GA4 property
    dateRange: {                  // normalized range config
      preset?: '7d' | '14d' | '28d' | '90d';
      startDate?: string;         // YYYY-MM-DD
      endDate?: string;           // YYYY-MM-DD
    };
    dimensions: string[];         // e.g. ["date", "sessionSource"]
    metrics: string[];            // e.g. ["activeUsers", "sessions"]
    filters?: unknown;            // structured filter expression (see “Report config”)
    orderBys?: unknown;           // order rules
    limit?: number;
    lastRefreshedAt?: number;
    truncated?: boolean;
    lastError?: string;
  };
};
```

### Backend storage (D1)

Extend the connector storage pattern to support Google Analytics.

Option A (recommended): keep a unified `connectors` table with per-type JSON fields:

- `id`, `type`, `name`, `created_at_ms`, `updated_at_ms`
- `config_json` (property defaults, etc.)
- `secret_ciphertext_b64`, `secret_iv_b64` (encrypted refresh token and any sensitive fields)

Option B: separate tables per connector type (more rigid, but explicit).

Stored secrets for GA:

- `refresh_token` (required for long-lived access)
- potentially `access_token` + expiry cache (optional; can always mint access token from refresh token)

## Authentication design

### Recommended: OAuth 2.0 Authorization Code + PKCE (browser) + backend token exchange

Why:

- Avoids storing tokens in the browser.
- Avoids a “client secret in the frontend”.
- Enables long-lived refresh via server-side storage.

Flow:

1. Frontend initiates OAuth with PKCE:
  - Generate `code_verifier` + `code_challenge`.
  - Redirect to Google OAuth consent screen.
2. Google redirects back to the app with `code`.
3. Frontend posts `{ code, code_verifier, redirect_uri }` to backend.
4. Backend calls Google token endpoint to exchange code for `{ access_token, refresh_token, expires_in }`.
5. Backend encrypts and stores `refresh_token` in D1 and returns a `connectorId` to the frontend.
6. Frontend uses `connectorId` for subsequent report queries.

Scopes (minimum viable):

- `https://www.googleapis.com/auth/analytics.readonly`
- `openid email profile` (optional, only if you want to display user identity)

Notes:

- Ensure refresh token is issued (Google may only return refresh token on first consent or with prompt settings). Plan for “force re-consent” UX if refresh token is missing.
- Token exchange requires CORS-safe backend endpoints; the Worker already handles CORS.

### Alternatives (defer)

- Pure SPA token handling (Google Identity Services access token in browser) is faster to build but stores tokens client-side and complicates refresh.
- Service account access (common for server-side GA access) is powerful but requires users to grant property access to the service account; higher setup friction.

## Backend API design

Follow the ClickHouse pattern: `GET /api/connectors`, plus GA-specific endpoints.

### Connector lifecycle

- `GET /api/connectors`
  - returns public connector metadata for all types (or filter by `type`).
- `POST /api/connectors/google-analytics/auth/start` (optional)
  - backend returns `authorizationUrl` (if you want backend to construct OAuth URL).
  - alternatively, frontend constructs the URL and only uses `/auth/exchange`.
- `POST /api/connectors/google-analytics/auth/exchange`
  - request: `{ code, codeVerifier, redirectUri }`
  - response: `{ connector: { id, type, name, ... } }`
  - backend stores refresh token encrypted.
- `POST /api/connectors/google-analytics/test` (optional but useful)
  - validates the connector by listing accessible properties or running a trivial report.

### Querying/reporting

- `POST /api/query/google-analytics`
  - request: `{ connectorId, propertyId, report }`
  - response: `{ columns, rows, rowCount, truncated }` (same shape as ClickHouse, to reuse UI plumbing)

Where `report` is a structured config mirroring GA4 Data API `runReport`:

```ts
type GoogleAnalyticsReport = {
  dateRanges: Array<{ startDate: string; endDate: string }>;
  dimensions: Array<{ name: string }>;
  metrics: Array<{ name: string }>;
  dimensionFilter?: unknown;
  metricFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
};
```

## Report-to-sheet mapping

Backend returns a tabular response:

- `columns`: derived from dimensions + metrics (and any special fields like “date”)
- `rows`: strings (or primitives) per row, aligned with columns

Frontend uses a `googleAnalyticsResultToMatrix` utility similar to `clickhouseResultToMatrix`:

- Header row is column names.
- Convert null/undefined to empty string.
- Convert objects to JSON string (should be rare if backend normalizes).

Truncation:

- Backend enforces `MAX_ROWS` (same mechanism as ClickHouse).
- Frontend still enforces `MAX_IMPORT_ROWS` / `MAX_IMPORT_COLS` for rendering safety.

## Security, privacy, and compliance

- Never store OAuth tokens in browser storage.
- Encrypt refresh tokens at rest in D1 (AES-GCM with `ENCRYPTION_KEY_B64`).
- Protect `/api/*` with optional `API_BEARER_TOKEN` (already supported).
- Use read-only scope only.
- Log hygiene: never log tokens, auth codes, or full responses that might contain PII.
- Consider adding basic input validation:
  - `propertyId` format
  - max counts for dimensions/metrics
  - allowed date range size (prevent massive backfills)

## Rate limits and performance

- Cache short-lived `access_token` in memory per connector for `expires_in` window to avoid refreshing on every request (optional optimization).
- Add request timeout (`DEFAULT_TIMEOUT_MS`) and fail fast with clear errors.
- Consider backoff/retry only for transient 429/5xx (be conservative).

## Error model (frontend-friendly)

Match backend error normalization:

```json
{ "error": { "code": "ga_auth_failed", "message": "..." } }
```

Common error codes to plan for:

- `unauthorized` / `forbidden` (missing/invalid bearer token to backend)
- `ga_auth_failed` (code exchange failed)
- `ga_token_expired` / `ga_refresh_failed`
- `ga_permission_denied` (user lacks access to property)
- `bad_request` (invalid report config)
- `timeout`

## Milestones (incremental delivery)

1. Backend: connector type + encrypted refresh token storage
  - D1 schema updates
  - `/auth/exchange` endpoint
  - `/api/connectors` includes GA connectors
2. Backend: report execution
  - Use refresh token to mint access token
  - Call GA4 Analytics Data API `runReport`
  - Return `{ columns, rows, rowCount, truncated }`
3. Frontend: UI + connected sheet
  - Add GA section to `DataConnectorDialog`
  - Auth button + callback handling (PKCE)
  - Report builder + preview
  - Create connected sheet with `connectorConfig`
4. Refresh/edit support in `SheetNode`
  - Refresh button re-runs report
  - Edit config updates stored report params on the sheet
5. Hardening
  - Better validation + limits
  - Clear errors + re-auth flow
  - Docs + troubleshooting

## Manual QA checklist

- Auth:
  - first-time consent returns refresh token and connector persists across reload
  - re-consent flow works if refresh token missing/revoked
- Query:
  - run a basic report (date + activeUsers) and creates a sheet
  - refresh re-fetches and updates sheet
  - invalid report config yields readable error
- Security:
  - no tokens stored in localStorage/IndexedDB
  - backend rejects unauthenticated `/api/*` if `API_BEARER_TOKEN` set

