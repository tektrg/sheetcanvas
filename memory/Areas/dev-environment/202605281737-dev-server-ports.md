# 202605281737 Dev server ports

Frontend runs on **`http://127.0.0.1:5173`** — the dedicated SheetCanvas port. Start with:

```bash
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Backend Wrangler dev runs on **`127.0.0.1:8787`** (from `backend/`).

## Why 5173
- `AGENTS.md` declares 5173 as the dedicated SheetCanvas port (sibling apps on this machine claim other ports).
- `--strictPort` is required so a stale server on 5173 fails loudly instead of silently shifting Vite to another port (which breaks CORS to the backend and produces stale tabs that look "working" against an old build).

## Known mismatch — `vite.config.ts`
`vite.config.ts` currently hardcodes `server.port: 3000`. This contradicts the canonical 5173 convention. Until reconciled, **always pass `--port 5173 --strictPort` explicitly** so the flag overrides the config. Reconciliation options:
- Change `vite.config.ts` to `port: 5173` (preferred — matches AGENTS.md).
- Or leave the explicit flag in `npm run dev` invocations.

## How to apply
- Start the dev server with the full command above; don't rely on `npm run dev` alone until `vite.config.ts` is reconciled.
- Persistent tmux session name for the dev server: `sheetcanvas_bottom_sheet_dev` (per CONTINUITY.md history). `flexsheet-dev` is an older alias still seen in some tmux panes.
- If 5173 is bound by a stale SheetCanvas server, kill the stale pane rather than letting Vite pick another port.

## Links
- [[Resources/architecture/202605281734-product-overview]]
- [[Areas/workflow/202605281739-continuity-ledger]]
