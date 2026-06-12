# Repository Guidelines

## Project Structure & Module Organization
The Vite entrypoints live at `index.html`, `index.tsx`, and `App.tsx`, which hydrate UI state from the Zustand store in `store.ts` and typed contracts in `types.ts`. Reusable UI lives in `components/`, with domain-specific helpers in `utils/` (formulas, clipboard parsing, data analysis) and shared enums in `constants.ts`. Hooks that wrap store selectors or browser APIs reside in `hooks/`, and `workers/` is reserved for long-running canvas or data-processing tasks. Keep any new assets colocated with their owning feature, and expose only typed props through the public component surface.

Backend services live under `backend/` as a Cloudflare Workers project (Wrangler + Hono) that provides a secure proxy layer for ClickHouse connectors. It stores connector metadata and encrypted credentials in D1, and exposes `/api/*` routes that the frontend will call instead of talking to ClickHouse directly.

## Build, Test, and Development Commands
- `npm install` – install React, Zustand, and charting dependencies pinned in `package.json`.
- `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort` – start the Vite dev server (HMR, local storage-backed state) on the dedicated SheetCanvas port 5173. Use this exact port when starting the app; if 5173 is occupied, stop the stale SheetCanvas server instead of letting Vite choose another port.
- `npm run build` – compile the TypeScript/React bundle and worker scripts into `dist/` with optimized chunks.
- `npm run preview` – serve the built bundle for smoke testing exact production behavior.
- `npm run seo:audit` – build the app and run the maintained SEO metadata/schema audit against source and `dist/`.

Backend (Cloudflare Worker) commands (run from `backend/`):
- `npm install` – install backend dependencies (Hono, Zod, Wrangler).
- `wrangler d1 execute DB --local --file ./schema.sql` – initialize local D1 schema.
- `wrangler dev src/index.ts --config wrangler.toml --local --port 8787` – run backend locally on port 8787.

## Deployment
Deploy the frontend with Wrangler Pages, not Vercel. Build first, then deploy the root `dist/` directory to the existing Cloudflare Pages project:

- `npm run seo:audit` – required pre-deploy check; this runs `npm run build` and validates crawlable SEO pages, sitemap entries, JSON-LD, and the root Vite app shell.
- `npx wrangler pages project list` – confirm the project is `sheetcanvas`, serving `sheetcanvas.pages.dev`, `sheetcanvas.com`, and `www.sheetcanvas.com`.
- `npx wrangler pages deploy dist --project-name sheetcanvas --branch main` – deploy the built frontend to production.
- `npx wrangler pages deployment list --project-name sheetcanvas` – confirm the latest production deployment source commit and preview URL.

After deployment, smoke check at minimum:
- `https://sheetcanvas.com/`
- `https://sheetcanvas.com/sitemap.xml`
- any newly added static SEO route, such as `https://sheetcanvas.com/connectors/google-analytics/`

Known-good reference from the May 27, 2026 deploy: project `sheetcanvas`, source commit `021c60c`, deployment `c1980e27-a5fe-44e0-8757-ca5ba3604029`, preview `https://c1980e27.sheetcanvas.pages.dev`.

## Coding Style & Naming Conventions
Author features in TypeScript with functional React components. Use two-space indentation, `PascalCase` for components/hooks, `camelCase` for functions and Zustand selectors, and `SCREAMING_SNAKE_CASE` for exported constants. Keep shared types in `types.ts` and prefer discriminated unions over `any`. Run code-formatting through your editor’s Prettier (aligned with the existing style), and colocate component-specific styles or helpers beside each component rather than in `src/` root.

## Testing Guidelines
There is no automated test harness yet, so rely on targeted manual QA flows: validate sheet creation, chart rendering, and import/export workflows through `npm run dev`, and document verification steps in the PR description. When introducing logic that can be isolated (e.g., utility in `utils/formulas.ts`), add lightweight unit tests using Vitest under `src/__tests__/` and wire `npm test` once the suite lands; structure files as `<module>.test.ts` with descriptive `describe`/`it` names.

For backend changes, smoke test locally with `wrangler dev` and hit `GET /health` plus one happy-path connector+query flow against a test ClickHouse instance.

## Agent Eval Harness
Use the browser-driven eval harness when changing Copilot/LLM behavior, client tools, data manipulation flows, chart creation, connector query behavior, or insight responses.

Prerequisites:
- Frontend must be running at `http://127.0.0.1:5173/` with `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`.
- Backend must be running locally on port `8787` when the eval uses the agent API or connectors.
- The eval bridge only registers on localhost and only in dev mode, or when `VITE_ENABLE_AGENT_EVAL=true` is explicitly set. The page must be opened with `?agent_eval=1`.

Commands:
- `npm run agent:eval` – run the default eval suite from `agent/evals/sample.json`.
- `npm run agent:eval -- --cases agent/evals/real-data.example.json` – run a specific eval file.
- `npm run agent:eval -- --timeout-ms 60000` – override the per-case prompt timeout.
- `npm run agent:eval -- --headed` – show the browser for visual debugging.
- `npm run agent:eval -- --include-raw-messages` – include raw AI SDK messages in the JSON run log.
- `npm run agent:eval -- --browser-ws-url <ws://...>` – reuse an already-running Chromium DevTools browser when local browser launch is flaky.

Outputs:
- Run logs are written to `.agent-eval-runs/`, which is intentionally gitignored.
- Each log includes prompt, run status/error, before/after canvas state, bounded sheet cell values/raw formulas, filters, sort state, created sheets/charts, selected IDs, assistant text, and summarized tool events.

Eval authoring:
- Add new evals under `agent/evals/`.
- Treat correct final canvas state as the pass condition, not just assistant wording.
- Prefer expectations that verify specific sheet/chart state: `minSheetsDelta`, `minChartsDelta`, `noNewSheets`, `noNewCharts`, `sheets`, `newSheets`, `newCharts`, `sheetTitleIncludes`, `chartTitleIncludes`, `assistantIncludes`, and `connectorSheetCreated`.
- For sheet state, use checks such as `titleIncludes`, `headersInclude`, `cellEquals`, `rangeIncludes`, `filters`, and `sort`.
- For chart state, use checks such as `titleIncludes`, `type`, `sourceSheetTitleIncludes`, `labelColumn`, `labelHeader`, `dataColumns`, `dataColumnsInclude`, and `dataHeadersInclude`.
- Run errors fail by default. Set `allowRunError` only for cases intentionally validating error behavior.
- Empty external query-result cases should assert `noNewSheets`, `noNewCharts`, and assistant copy that explains no data was returned and stops.

Browser notes:
- The runner prefers `CHROME_PATH` if set, then arm64 Microsoft Edge on this Mac, then Chrome/Chromium candidates.
- If Chromium launch fails, first clean stale eval browser processes matching `sheetcanvas-agent-eval`, then rerun. Keep active dev servers and ambiguous sessions.

## MCP Bridge (expose canvas tools to external agents)
The canvas's 16 Copilot tools (schemas in `agent/tools.ts`) are exposed to external MCP clients while the frontend stays a static site. Tool execution still happens in the browser tab (`src/agent/clientToolExecutor.ts`); the backend only relays.

Architecture:
- `backend/src/mcp/bridge.ts` – `CanvasBridge` Durable Object, one instance per canvas token. Holds the browser tab's WebSocket, serializes tool calls, 30s per-call timeout.
- `backend/src/mcp/route.ts` – `POST /api/mcp/token` (mint), `GET /api/mcp/bridge/:token` (browser WS upgrade), `GET /api/mcp/status/:token`, `POST /mcp/:token` (the MCP streamable-HTTP endpoint, JSON responses, stateless). Tool inputs are validated server-side against the shared zod schemas before forwarding.
- `src/agent/useMcpBridge.ts` – browser WS client with exponential-backoff reconnect; config persisted in localStorage key `sheetcanvas:mcp:v1`.
- `src/components/ConnectAgentDialog.tsx` – UI (plug icon in the Copilot panel header): mint/regenerate token, enable/disable toggle, copy MCP URL.

Constraints to keep in mind:
- The token is a bearer capability in the URL; regenerating revokes by abandonment (the old Durable Object simply never gets a tab connection again).
- The tab must be open and the toggle on for tools to work; otherwise MCP clients get a clear "Canvas not connected" tool error.
- One tab per token: a newer tab takes over the connection and the older tab gets WS close code 4000 and stops reconnecting (status "replaced").
- A timed-out or disconnect-failed write may still have been applied by the tab — agents that retry writes can double-apply. Prefer read-back (getRange) over blind retry. The `initialize` response's `instructions` field tells MCP clients this too.
- The tab heartbeats `ping`/`pong` every 20s (DO auto-response) so dead sockets after laptop sleep reconnect instead of lingering as a zombie "connected" state.
- `mcpUrl`/`bridgeWsUrl` bake in the backend origin at mint time — switching `VITE_BACKEND_URL` (local↔prod) requires regenerating the URL from the dialog.
- Backend and frontend must use the same zod major/minor (currently ^4.4) — `agent/tools.ts` is compiled by both.

Smoke test: mint via `curl -X POST http://127.0.0.1:8787/api/mcp/token`, seed `sheetcanvas:mcp:v1` in the tab (or use the dialog), then `tools/list` and `tools/call listSheets` against `POST /mcp/<token>`.

## Project Memory
- Agents **must use the `memory-project` skill** to work with project memory.
- `AGENTS.md` is the entry point for agent context; read it first, then use the `memory-project` skill to consult the root `../memory/` folder for durable project knowledge.
- Write reusable insights, decisions, learnings, and analysis outputs into the repo root `../memory/` PARA structure instead of leaving them only in chat.
- Before repeating prior analysis or rediscovering project context, use the `memory-project` skill to search and read relevant notes from `../memory/`.
- Use `../memory/Resources/` for reusable reference knowledge (stack, branding, IDs), `../memory/Projects/` for active initiative notes, `../memory/Areas/` for ongoing responsibilities (deployment, SEO, dev-environment, workflow), and `../memory/Archives/` for inactive material.
- `CONTINUITY.md` remains the in-session ledger (compaction-safe); root `../memory/` is the durable cross-session knowledge layer behind it.

## Commit & Pull Request Guidelines
Follow the existing Conventional Commit style (`feat:`, optional scopes like `feat(charting): ...`) to keep `git log` navigable. Each PR should include: a concise summary, linked issue/task IDs when available, screenshots or GIFs for UI changes, reproduction steps for bug fixes, and a checklist of tested scenarios (keyboard shortcuts, multi-node selection, import limits). Favor small, reviewable commits and ensure lint/build succeed before requesting review.

## Continuity Ledger (compaction-safe)
Maintain a single Continuity Ledger for this workspace in 'CONTINUITY.md'. The ledger is the canonical session briefing
designed to survive context compaction; do not rely on earlier chat text unless it's reflected in the ledger.

### How it works
- At the start of every assistant turn: read 'CONTINUITY md', update it to reflect the latest
goal/constraints/decisions/state, then proceed with the work.
- Update 'CONTINUITY.md' again whenever any of these change: goal, constraints/assumptions, key decisions, progress state
(Done/Now/Next), or important tool outcomes.
- Keep it short and stable: facts only, no transcripts. Prefer bullets. Mark uncertainty as 'UNCONFIRMED' (never guess).
- If you notice missing recall or a compaction/summary event: refresh/rebuild the ledger from visible context, mark gaps
"UNCONFIRMED', ask up to 1-3 targeted questions, then continue.

### 'functions.update_plan' vs the Ledger
- 'functions update_plan is for short-term execution scaffolding while you work (a small 3-7 step plan with
pending/in_progress/completed).
- 'CONTINUITY md' is for long-running continuity across compaction (the "what/why/current state"), not a step-by-step task
list.
- Keep them consistent: when the plan or state changes, update the ledger at the intent/progress level (not every micro-step).

### In replies
- Begin with a brief "Ledger Snapshot" (Goal + Now/Next + Open Questions). Print the full ledger only when it materially
changes or when the user asks.

### 'CONTINUITY.md' format (keep headings)
- Goal (incl. success criteria):
- Constraints/Assumptions:
- Key decisions:
- State:
- Done:
- Now:
- Next:
- Open questions (UNCONFIRMED if needed):
- Working set (files/ids/commands):
