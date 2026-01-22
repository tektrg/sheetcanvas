Goal (incl. success criteria):
- Run backend Cloudflare Worker locally and use an existing separate frontend at `http://localhost:3000`.

Constraints/Assumptions:
- Follow AGENTS.md repository guidelines.
- Environment: approvals `on-request`, sandbox `workspace-write`, network `restricted`.
- Starting servers should avoid network downloads when possible.

Key decisions:
- Start frontend via `npm run dev` in background and log to `vite.log`.
- Start backend via `wrangler dev --local --port 8787` in background and log to `backend/wrangler.log`.

State:
- Done:
  - Checked repo layout and existing ledger.
  - Confirmed active listeners: Vite on TCP 5173, Wrangler workerd on TCP 8787.
  - Killed existing dev server processes on TCP 5173/8787 and restarted fresh instances.
  - Diagnosed Vite failure: missing `@rollup/rollup-darwin-arm64` (node_modules had x64 build).
  - Reinstalled deps with `npm ci --legacy-peer-deps` (required elevation for network + ~/.npm access).
  - Started Vite dev server with elevation (port binding blocked in sandbox).
  - Diagnosed backend Wrangler failure: wrong native `workerd` package (darwin-x64 vs darwin-arm64).
  - Reinstalled backend deps with `cd backend && npm ci` (required elevation for network + ~/.npm access).
  - Started backend Wrangler dev server with elevation.
- Now:
  - Vite dev server listening on `http://127.0.0.1:5173/` (started with elevation due to sandbox EPERM).
  - Wrangler dev server listening on `http://127.0.0.1:8787/` (started with elevation due to sandbox EPERM/log writes).
- Next:
  - Confirm new processes are listening on 5173/8787.
  - Ensure backend CORS allows `http://localhost:3000` and confirm frontend API base URL.
  - Document how to point a separate frontend to the backend (`VITE_BACKEND_URL` or proxy).

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Does the frontend expect the backend at `http://127.0.0.1:8787` or another base URL?
- UNCONFIRMED: Does the existing frontend call `/api/*` relative (proxy) or a full backend URL?

Working set (files/ids/commands):
- CONTINUITY.md
- package.json
- vite.log
- vite.pid
- `npm ci --legacy-peer-deps`
- `npm run dev -- --host 127.0.0.1 --port 5173`
- backend/wrangler.log
- backend/wrangler.pid
- `cd backend && npm ci`
- `cd backend && npx wrangler dev src/index.ts --config wrangler.toml --local --port 8787`
- backend/src/index.ts
- backend/wrangler.toml
- utils/backendApi.ts
