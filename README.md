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
