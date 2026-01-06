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

## Google Analytics (GA4) connector (OAuth + backend proxy)

The GA4 connector uses the Cloudflare Worker backend (under `backend/`) to exchange OAuth codes and store refresh tokens securely (encrypted in D1). The browser never sees the client secret.

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
