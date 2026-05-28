# SheetCanvas Agent MVP Plan

Status: in progress (2026-05-28)

## Goal
Ship an in-app Gemini-powered agent that helps users query existing data connectors, create charts, and filter/sort/format sheet data via natural language. MCP/Hub layers are explicitly deferred (P1+).

## SDK choice
- **Vercel AI SDK v5** + `@ai-sdk/google` (Gemini 2.5 Flash default).
- Client-side tools (Vercel SDK `onToolCall`) execute against Zustand directly.
- Direct `@google/genai` deferred until context caching becomes necessary.

## Architecture
```
React AgentChatPanel
  └─ useChat (Vercel AI SDK) ── SSE ──► Worker /api/agent
                                          streamText(google('gemini-2.5-flash'),
                                                     tools=clientToolDefs,
                                                     stopWhen=stepCountIs(8))
  Browser onToolCall → clientToolExecutor → Zustand actions
       └─ result returned up the stream → next agent step
```

- Backend never executes tools; it owns model auth, quota, and the system prompt.
- Frontend owns mutations and continues to work offline for non-agent use.

## Tool surface (10 primitives, no recipes in MVP)

Read: `listSheets`, `describeSheet`, `getSelection`, `getRange`, `querySheet` (AlaSQL over active sheet)
Write: `setCells`, `applyFilter`, `applySort`, `applyFormat`, `createChart`

All writes return `{ ok, summary, warnings? }` and flow through existing Zustand actions, so cmd-Z undoes them.

## Identity / quota
- Anonymous per-tab sessionId (UUID in sessionStorage).
- KV counter `agent:quota:{sessionId}:{YYYY-MM-DD}` capped at 50 turns/day. 429 above.
- Server-held `GOOGLE_API_KEY` secret in Worker env.

## Context strategy
- Default context: sheet list with column schema (header + sample value) + active selection.
- Agent calls `querySheet(sheetId, sql)` for ad-hoc inspection.
- No whole-sheet inline serialization in MVP.

## Out of scope (P1+)
- MCP server, Hub Durable Object, pairing codes
- Recipe tools
- Connector creation (manage existing only)
- Accounts, multi-device sessions
- Gemini Pro tier
- Live external-client edits (no Hub yet)

## File layout
```
agent/tools.ts                    Zod schemas (shared, root-level)
backend/src/agent/route.ts        Hono /api/agent route
backend/src/agent/quota.ts        KV counter
src/agent/clientToolExecutor.ts   tool → Zustand dispatcher
src/agent/alasqlAdapter.ts        register active sheet, run SELECT
src/agent/contextBuilder.ts       build initial schema+selection payload
src/agent/useAgentSession.ts      sessionId + useChat wrapper
src/components/AgentChatPanel.tsx slide-out panel + tool-call cards
```

## Exit criteria
1. Fresh user can ask 5 representative prompts and get correct mutations.
2. Quota enforced (50 Flash turns/day/session).
3. Cancel mid-stream works.
4. All agent mutations undoable via Cmd-Z.
5. `npm run build` clean. No regressions in `npm run seo:audit`.
6. Tool schemas live in one shared module ready for re-export to a future MCP layer.

## Unresolved (carried)
- AlaSQL vs duckdb-wasm — AlaSQL chosen for MVP; revisit if perf bites.
- Date naturalism ("last quarter") — model resolves to absolute dates in tool args for MVP.
- Cancel rollback — abort stream only; partial effects stay (user can undo).
- Selection-empty default — send active-sheet schema (small) inline.
- Telemetry — deferred to P1.

## Phased roadmap
- **MVP (now)**: in-app agent only, 10 primitives, KV quota.
- **P1**: Hub Durable Object + WebSocket loopback (in-app agent optionally through Hub to dogfood).
- **P2**: MCP server (streamableHttp) + pairing code UI; expose tool surface to external clients.
- **P3**: Recipe tools, eval harness, telemetry to D1, optional Pro tier.
