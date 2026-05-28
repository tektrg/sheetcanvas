# 202605281739 Continuity ledger workflow

This repo uses `CONTINUITY.md` as the compaction-safe session briefing.

**Format (keep headings):** Goal / Constraints / Key decisions / State (Done/Now/Next) / Open questions / Working set.

## Lifecycle each turn
1. Read `CONTINUITY.md` at the start of every assistant turn.
2. Update it to reflect the latest goal / constraints / decisions / state.
3. Proceed with the work.
4. Update again whenever goal, constraints, decisions, progress (Done/Now/Next), or important tool outcomes change.
5. Mark uncertainty as `UNCONFIRMED` — never guess.

In replies: begin with a brief "Ledger Snapshot" (Goal + Now/Next + Open Questions). Print the full ledger only when it materially changes or on request.

## Why
Long-running SEO/deploy work spans many compactions; the ledger is the only reliable carryover. Stale handoffs have been flagged in QA passes when the ledger was not updated promptly.

## Relationship to other artifacts
- **In-turn plan tool / TaskCreate** — short-term execution scaffolding (3–7 steps, pending/in_progress/completed).
- **CONTINUITY.md** — long-running continuity across compaction (intent + current state). Not a step-by-step task list.
- **`memory/`** — durable cross-session knowledge (this PARA tree). Survives across compactions and across distinct features.

Keep all three consistent at the intent/progress level, not micro-step level.

## Links
- [[Resources/architecture/202605281734-product-overview]]
