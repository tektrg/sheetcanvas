# Continuity Ledger

- Goal (incl. success criteria): Anonymous publish (branch `feat/publish`): a note/page publishes to a public, crawlable `/p/<slug>-<id>` page with server-rendered SVG charts + capped data tables, auto-republishes on edit, can be paused/unpublished.
- Constraints/Assumptions: No accounts. Edit key = capability (only SHA-256 stored server-side; browser keeps it in IndexedDB db `sheetcanvas-publish-keys`, outside workspace export). Public pages never touch connectors; scheduled refresh runs only while the app is open. Not deployed; remote D1 untouched.
- Key decisions: Wire contract `shared/publishSnapshot.ts` (compiled by frontend + backend). Backend `backend/src/publish.ts` (routes) + `pagesRepo.ts` (D1/in-memory) + `render/*` (d3 → SVG strings, allowlist sanitizer, marked). OG via resvg-wasm (no fonts → shapes only), fallback redirect to brand OG png. Cache API keyed by page id, purged on PUT/DELETE, 60s TTL. Unpublish keeps row (410), wipes snapshot. Sitemap/llms list only pages >= 150 words.
- State: All 5 slices committed on `feat/publish`; not pushed.
- Done: backend API + renderer + routes + tests; SEO scripts; frontend menu/sync/tests; local e2e (publish → public page → hideData edit republished after 30s debounce → pause blocks republish → unpublish 410). Screenshots /tmp/sheetcanvas-publish/.
- Now: Hand off.
- Next (deploy): remote D1 `wrangler d1 execute DB --remote --file ./schema.sql`, `wrangler deploy` (adds /p, /og, sitemap-pages.xml, llms-pages.txt zone routes), then Pages deploy. Later: /e/* embeds (reuse `renderChartFigure`/`PAGE_STYLES`), OG text via bundled font, moderation view for `page_reports`.
- Open questions (UNCONFIRMED if needed): Canvas note publish button is in the hover-only top bar (Live badge visible on hover; always visible in Library).
- Working set (files/ids/commands): worktree /Users/wifey/01_Project/SheetCanvas/flexsheet-publish; local dev used ports 5174/8788 (5173/8787 belong to another session).
