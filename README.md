<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1Ewxai_OCxKUTGbwct4xjOs87e_cdOnIZ

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Connect external agents (MCP Bridge)

Expose all 16 canvas tools to Claude Code or any MCP-compatible agent while the frontend stays a static site. Tools still execute in your browser tab; the Cloudflare Worker backend relays MCP calls over WebSocket.

**Quick start:**

1. Start the backend (see `backend/README.md`) on port 8787.
2. Open the app at `http://localhost:5173`.
3. Open the Copilot panel → click the **plug icon (⏚)** in the panel header.
4. Click **"Generate MCP server URL"** — mints a bearer token and starts the relay.
5. Copy the `claude mcp add` command shown in the dialog and run it:

```bash
claude mcp add sheetcanvas --transport http http://localhost:8787/mcp/<your-token>
```

6. In Claude Code, ask it to work with your canvas:

```
> list the sheets in my canvas
> set cell A1 to "Revenue" and B1 to 42
> run SELECT * FROM Sheet1 WHERE B > 10
```

**Key constraints:**
- The tab must stay open while agents are working — tools execute in the browser.
- One tab per token: opening the same token in a second tab takes over the relay; the first shows "taken over" in amber. Toggle the checkbox in the dialog to reclaim.
- The MCP URL is a bearer capability — treat it like a password. Regenerate at any time from the dialog to revoke the old one.
- For production, the token URL bakes in the backend origin. Regenerate after switching between local and prod backends.

For deployment: run `npx wrangler deploy` from `backend/` to ship the Durable Object migration before the first production use.

## ClickHouse connected sheets (backend proxy)

The ClickHouse connector uses a Cloudflare Worker backend (under `backend/`) so the browser never connects to ClickHouse directly and never stores passwords.

More detail: `docs/clickhouse-connector.md`

1) Start the backend:
- Follow `backend/README.md` and run the worker on `http://localhost:8787`

2) (Optional) Point the frontend at the backend:
- Default backend URL is `http://localhost:8787`
- Override with `VITE_BACKEND_URL` (and `VITE_API_BEARER_TOKEN` if backend auth is enabled)

3) In the app:
- Click “Connect Data” → “ClickHouse”
- Create/test/save a connector (URL/username/password)
- Enter SQL → “Run & Create Sheet”
- Use the sheet header buttons to “Refresh” and “Edit SQL”

## Google OAuth connectors (GA4 + Google Sheets)

The GA4 and Google Sheets connectors use the Cloudflare Worker backend (under `backend/`) to exchange OAuth codes and store refresh tokens securely (encrypted in D1). The browser never sees the client secret.

### Fixing `Error 403: access_denied` (add Test users)

If you see `Error 403: access_denied` on the Google OAuth screen during local dev, your OAuth consent screen is usually in **Testing** and your account is not allowlisted.

Add yourself as a test user:
1) Open Google Cloud Console and select the project that owns your OAuth client.
2) Go to **APIs & Services → OAuth consent screen**.
3) Confirm **Publishing status** is **Testing**.
4) In **Test users**, click **Add users**, enter your Google account email(s), then **Save**.

If the consent screen is set to **Internal**, only accounts in the Google Workspace org can sign in. For personal Gmail accounts, set the app to **External** (Testing is fine for local dev).

Before running locally, configure the OAuth client in Google Cloud Console (APIs & Services):
- OAuth consent screen:
  - If the app is in **Testing**, add your Google account under **Test users** (otherwise you’ll commonly get `Error 403: access_denied`).
  - If the app is **Internal**, you must use a Google Workspace account in the org (or switch to **External**).
- Credentials → OAuth 2.0 Client ID:
  - Authorized JavaScript origins: `http://localhost:3000`
  - Authorized redirect URIs: `http://localhost:3000/` (must match exactly)
- Enable APIs:
  - Google Analytics Data API
  - Google Analytics Admin API
  - Google Sheets API
 - Quick checks:
   - Frontend runs on `http://localhost:3000` (see `vite.config.ts`).
   - `VITE_GOOGLE_CLIENT_ID` in `.env.local` matches `GOOGLE_CLIENT_ID` in `backend/.dev.vars`.
   - After changing OAuth config, retry in a fresh tab (or clear site data) to avoid stale OAuth state.

1) Configure frontend OAuth:
- Set `VITE_GOOGLE_CLIENT_ID` in `.env.local`

2) Configure backend OAuth + encryption:
- Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `ENCRYPTION_KEY_B64` in `backend/.dev.vars` (local) or as Wrangler secrets (prod)

3) Start the backend:
- Run the worker on `http://localhost:8787` (see `backend/README.md`)

4) In the app:
- Click “Connect Data” → “Google Analytics”
- Click “Connect Google” to authorize, then select a connector + GA4 property and import a report
- Or click “Connect Data” → “Google Sheets”
- Click “Connect Google” to authorize, then select a connector, enter a spreadsheet URL or ID, and import a read-only A1 range
