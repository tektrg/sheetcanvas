# 202605281734 Product overview

SheetCanvas is a spreadsheet-on-canvas web app. Live at https://sheetcanvas.com.

**Stack:** Vite + React 19 + TypeScript + Zustand (`store.ts`), recharts, xlsx, idb. Vite entry: `index.html` / `index.tsx` / `App.tsx`. Reusable UI in `components/`, domain helpers in `utils/`, hooks in `hooks/`, shared enums in `constants.ts`, shared types in `types.ts`.

**Backend:** Cloudflare Worker under `backend/` (Hono + Zod + D1). Proxies ClickHouse and brokers GA4 OAuth so the browser never sees credentials. D1 stores connector metadata and encrypted credentials. Exposes `/api/*`.

## Why the backend exists
Browser-only would leak ClickHouse passwords and the GA4 client secret. The worker holds encrypted credentials in D1.

## How to apply
- Don't propose direct browser → ClickHouse or browser-side GA4 token exchange.
- New connector work goes in `backend/src/`.
- Frontend talks to `/api/*` on backend, default `http://localhost:8787`, overridable via `VITE_BACKEND_URL` (and `VITE_API_BEARER_TOKEN` if backend auth is enabled).

## Links
- [[Areas/deployment/202605281735-wrangler-pages-deploy]]
- [[Areas/seo/202605281736-seo-operating-model]]
- [[Areas/dev-environment/202605281737-dev-server-ports]]
- [[Resources/branding/202605281738-product-network]]
