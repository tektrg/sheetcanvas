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
