# SheetCanvas Project Memory

PARA + Zettelkasten knowledge base for this repo. Managed via the `memory-project` skill.

## Structure
- **Projects/** — active initiatives with goals/deadlines
- **Areas/** — ongoing responsibilities
  - `deployment/` — Wrangler Pages publish path
  - `seo/` — SEO operating model and audit contract
  - `dev-environment/` — local dev server ports and conventions
  - `workflow/` — CONTINUITY.md ledger, QA patterns
- **Resources/** — reusable reference material
  - `architecture/` — stack, backend, app structure
  - `branding/` — product network, theindie.app parent
  - `analytics/` — measurement IDs and analytics wiring
- **Archives/** — inactive material

## Entry points
- `AGENTS.md` (project root) — the agent entry point
- `CONTINUITY.md` (project root) — in-session ledger
- `memory/Resources/architecture/202605281734-product-overview.md` — start here for stack/why

## Adding a note
From the project root, use the `memory-project` skill scripts:
```bash
./.claude/skills/memory-project/scripts/para-note.sh Areas seo 'New decision title'
```
Or write directly with a `YYYYMMDDHHmm-title.md` filename inside the correct PARA folder.
