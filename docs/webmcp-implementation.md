# WebMCP implementation notes

This is the engineering account behind the WebMCP door summarized in the [README](../README.md). Every number here was measured against the actual code in this repo (see methodology notes), not estimated. File paths are relative to the repo root.

## The shape of the problem

SheetCanvas already had one shared 26-tool registry (`agent/tools.ts`) and one executor (`src/agent/clientToolExecutor.ts`) feeding three doors: the in-app Copilot, a remote MCP server, and a CDP eval harness. Wiring in `document.modelContext` as a fourth door sounds like "call `registerTool` 26 times," but three hard, independent budget constraints made that naive approach fail outright, silently, or intermittently:

| Constraint | Limit | What breaks without handling it |
|---|---|---|
| Tool description length | 500 chars (OpenAI) | 13 of 26 `agent/tools.ts` descriptions are over — registration would either be rejected or silently truncated mid-sentence |
| Nested schema description length | 150 chars (OpenAI) | Several `.describe()` calls inside `agent/tools.ts` schemas (e.g. `createChart.seriesTypes`) exceed this |
| Tool **result** size | ~1.5K chars (OpenAI truncates output) | `getRange`, `querySheet`, `describeConnection`, and others can return results 10–800× that size — a silent mid-JSON truncation breaks the agent's next parse in confusing ways |

Each constraint is handled in a different module, on purpose, so a change to one can't silently regress another:

- **Description length** → `src/agent/webmcp/shortToolCopy.ts` (a second, hand-trimmed copy of every tool's title/description/param overrides)
- **Nested schema description length** → `src/agent/webmcp/webmcpDescriptors.ts` (`walkJsonSchemaNode`, word-boundary truncation at 150 chars)
- **Result size** → `src/agent/webmcp/toolResultShaping.ts` + `shapingShapers.ts` (per-tool shapers plus a generic backstop)

None of this touches `agent/tools.ts` itself — see [Why not edit `agent/tools.ts`](#why-not-edit-agenttoolsts) below.

## Why not edit `agent/tools.ts`

`agent/tools.ts`'s zod schemas and descriptions have three other consumers besides WebMCP:

1. The in-app Copilot (`backend/src/agent/route.ts`) — descriptions are written for Gemini with a long system prompt and app-specific priors; they're intentionally verbose.
2. The remote MCP server (`backend/src/mcp/route.ts`) — converts the same schemas with `z.toJSONSchema` and has a far larger result budget (no 1.5K cap), so it should stay undegraded.
3. The eval harness / test suite — asserts against the original descriptions.

Editing `agent/tools.ts` to fit OpenAI's caps would silently regress all three. Instead, `shortToolCopy.ts` is a second, parallel `Record<ToolName, ShortToolCopy>` — typed as `Record`, not `Partial`, so adding a 27th tool to `toolDefs` is a compile error here until it's covered. Measured against the live code:

```
13 of 26 tool descriptions exceed 500 chars, worst: createChart at 1,594 chars
max SHORT_TOOL_COPY description: 497 chars (deliberately hand-trimmed under the cap, not just truncated)
max SHORT_TOOL_COPY title: 30 chars (cap is 64)
max WebMCP tool name: 26 chars (cap is 30)
```

*(Measured with a throwaway Vite SSR script that imports `toolDefs` and `SHORT_TOOL_COPY` directly and checks `.length` on every entry — not eyeballed.)*

## The `additionalProperties: false` trap

WebMCP tool registration is stricter about extra properties than the remote MCP door needs to be, so `webmcpDescriptors.ts`'s `walkJsonSchemaNode` recursively sets `additionalProperties: false` on every schema node that has a `properties` key and no `additionalProperties` of its own — this is what makes a client's tool-calling UI treat the schema as a closed, well-typed form instead of an open bag.

The trap: **`z.record(...)` schemas already emit their own `additionalProperties`** (a value schema, not `false`), and have **no `properties` key at all**. A blanket "every object gets `additionalProperties: false`" pass would either leave `z.record` nodes untouched (fine) or, if implemented carelessly as "every object node gets it," overwrite their existing, load-bearing `additionalProperties` schema — making the tool structurally uncallable, because the whole point of those fields is an open, caller-defined key set.

Six such nodes exist in `agent/tools.ts` (confirmed by grepping for `.record(` directly against the file, not by trusting the source comment — see note below):

| Tool | Field | Line |
|---|---|---|
| `setCells` | `cells` | `agent/tools.ts:221` |
| `createChart` | `seriesTypes` | `agent/tools.ts:307` |
| `createSparkline` | `goodDirections` | `agent/tools.ts:374` |
| `createQuerySheet` | `queryPayload` | `agent/tools.ts:495` |
| `queryConnection` | `queryPayload` | `agent/tools.ts:511` |
| `updateQuerySheet` | `queryPayload` | `agent/tools.ts:534` |

`walkJsonSchemaNode`'s guard is the predicate `'properties' in obj && !('additionalProperties' in obj)` — it only sets `additionalProperties: false` when the node has neither already. Every `z.record` node fails that `'properties' in obj` check, so it's left alone; every ordinary object node gets closed. Verified directly: `setCells`'s emitted `cells` schema still has `additionalProperties: { type: "object", properties: {...} }` (the record's value schema), not `false`.

**Note on the count:** the code comment above `walkJsonSchemaNode` in `webmcpDescriptors.ts` says "Five such nodes exist in `toolDefs`" and lists exactly the six above (`cells`, `seriesTypes`, `goodDirections`, and `queryPayload` on three tools). The comment's prose number and its own enumerated list disagree — six nodes are named. This doesn't affect correctness (the guard is structural, not a hardcoded list), but it's worth fixing the comment.

The nested-description truncation (150 chars, word-boundary, `truncateAtWordBoundary`) and the `$schema` key strip both happen in the same recursive walk, after `SHORT_TOOL_COPY[name].params` overrides are applied — overrides win over truncation of the original verbose text.

## Input validation: WebMCP validates nothing

`document.modelContext.registerTool()` takes a JSON Schema for documentation/tool-picker purposes; it does not enforce it against `execute()`'s input at the browser API level. So `executeWrapped` (`webmcpRegistry.ts`) does it itself, first thing, using the *same* zod schema the other three doors use:

```ts
const parsed = toolDefs[name].inputSchema.safeParse(input);
if (!parsed.success) {
  const issueSummary = (parsed.error as z.ZodError).issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid input for ${name}: ${issueSummary}`.slice(0, INVALID_INPUT_MESSAGE_MAX_CHARS));
}
```

`INVALID_INPUT_MESSAGE_MAX_CHARS = 400`. The **parsed, coerced** data is what gets dispatched (`dispatchTool(name, parsed.data, ...)`), not the raw input — this matters because it keeps WebMCP's applied defaults identical to what the remote MCP backend produces (it `safeParse`s before forwarding too), so the two doors can't silently drift on default values.

### `.refine()` constraints are dropped from the emitted JSON Schema

Three tools use zod's `.refine()` for cross-field validation that JSON Schema can't express directly:

- `applyFormat` — exactly one of `format` or `preset`, not both
- `createSparkline` — `mode:"metrics"` requires `dataCols`; `mode:"group"` requires `groupCol` + `valueCol` + `operation`
- `updateNote` — at least one of `content` or `color`

We verified directly that `z.toJSONSchema()` drops these silently — the emitted schema for `applyFormat` has no `oneOf`/`not` encoding the XOR, `createSparkline`'s emitted schema has no `if`/`then` conditional on `mode`, and `updateNote`'s `required` array contains only `noteId`. An agent reading only the JSON Schema would believe `format` and `preset` are both optional and independently combinable, or that `updateNote({noteId})` alone is valid.

Since the constraint can't be encoded, it's **restated in prose** instead — in the tool's `SHORT_TOOL_COPY` description (e.g. `applyFormat`: *"Pass exactly one of format or preset, not both"*) or a per-param override. This is a conscious trade-off: the model can still violate the constraint, but `executeWrapped`'s `safeParse` (which re-applies the real zod schema, `.refine()` included) will still reject it at call time with a `ZodError` message — the prose is a hint to avoid a wasted round trip, not the enforcement layer.

## Result shaping

### Budget and layering

`WEBMCP_OUTPUT_BUDGET = 1400` (`shapingHelpers.ts`) — chosen with headroom under OpenAI's ~1.5K truncation so the agent's own wrapping doesn't push a borderline result over the edge.

Two layers, always applied in order (`toolResultShaping.ts`):

1. **Per-tool shaper** (`shapingShapers.ts`) — hand-written knowledge of which fields are "the answer" vs. "bulk," per tool. **14 shaper functions cover 17 tools** — `shapeConnectorSuccess`/`connectorErrorMessage` are shared by all four connector-result tools (`queryConnection`, `createQuerySheet`, `createQuerySheetFromResult`, `updateQuerySheet`), so 14 implementations produce 17 registry entries. The remaining 9 tools (`setCells`, `createSheet`, `applyFilter`, `applySort`, `createPivot`, `createSparkline`, `createNote`, `updateNote`, `deleteNote`) return a handful of scalar/id fields each and are intentionally unshaped — verified by reading their `return` statements in `clientToolExecutor.ts`.
2. **Generic backstop** (`applyBackstop`) — runs after every shaper (including the 9 with none), in three escalating steps, and guarantees the result fits regardless of how large or malformed the input is:
   - drop bulk fields in a fixed priority order (`sampleRows`, `rows`, `cells`, `tables`, `columns`, ... down to `queryShape`) until under budget
   - clip any remaining string field over 100 chars
   - collapse to identity fields only (`ok` + any `*Id` field, each capped to 200 chars)

### Measured shaping, by tool

Measured by importing `shapeSuccess`/`jsonLength` directly from `toolResultShaping.ts`/`shapingHelpers.ts` (via a Vite SSR script, no mocking) and feeding each shaper realistic synthetic payloads shaped like the tool's actual return type in `clientToolExecutor.ts`. These are *my own* measurements against this exact code — not reproductions of any prior benchmark — so treat the "before" sizes as representative of the described scenario, not a fixed constant:

| Tool | Scenario | Before | After | Reduction |
|---|---|---|---|---|
| `getRange` | 500 rows × 50 cols (a wide `A1:AX500` read) | 970,865 chars | 1,219 chars | ~800× |
| `querySheet` | 200 rows × 7 columns | 30,242 chars | 1,308 chars | ~23× |
| `describeConnection` | GA catalog: 150 dimensions + 120 metrics, each with a description | 68,392 chars | 1,037 chars | ~66× |
| `describeSheet` | 60 columns × 500 rows, 5 sample rows | 10,552 chars | 1,404 chars | ~7.5× |

The `describeSheet` case is the tightest of the four — at 60 columns, `columnsCompact` (`"A=Header0(number) B=Header1(number) ..."`) alone runs long enough that the generic backstop has to trim it further to land at 1,404 (just under the 1,400 target plus a few bytes of wrapper); a sheet with the more typical 10–15 columns would land well under budget from the per-tool shaper alone, with the backstop a no-op.

### Per-tool caps (the knobs, for reference)

From `shapingShapers.ts`'s named constants — these are what each shaper enforces before the backstop ever runs:

| Constant | Value | Tool(s) |
|---|---|---|
| `DESCRIBE_SHEET_MAX_COLUMNS` / `..._SAMPLE_ROWS` / `..._SAMPLE_COLS` | 40 / 2 / 12 | `describeSheet` |
| `LIST_SHEETS_MAX_SHEETS` / `..._HEADER_LINE_MAX` | 20 / 200 | `listSheets` |
| `CONNECTOR_SAMPLE_ROWS` / `..._SAMPLE_COLS` | 2 / 10 | `queryConnection`, `createQuerySheet`, `createQuerySheetFromResult`, `updateQuerySheet` |
| `DESCRIBE_CONNECTION_MAX_DIMS` / `..._MAX_METRICS` | 20 / 20 | `describeConnection` (GA) |
| `DESCRIBE_CONNECTION_MAX_TABLES` / `..._MAX_CH_COLUMNS` | 40 / 60 | `describeConnection` (ClickHouse) |
| `READ_NOTE_MAX_CONTENT_CHARS` | 900 | `readNote` |
| `LIST_NOTES_MAX` / `..._PREVIEW_MAX` | 15 / 80 | `listNotes` |
| `CREATE_CHART_MAX_FIRED_RULES` | 3 | `createChart` |
| `APPLY_FORMAT_MAX_DECISIONS` | 3 | `applyFormat` |
| `LIST_CONNECTION_PROPERTIES_MAX` | 15 | `listConnectionProperties` |
| `GA_TREND_MAX_COLUMNS` | 40 | `createGaTrendBySource` |
| `ERROR_MESSAGE_MAX_CHARS` | 600 | every error shaper |
| `QUERY_DIAGNOSTICS_MAX_CHARS` | 200 | connector error/diagnostics fields |

`READ_NOTE_MAX_CONTENT_CHARS = 900` is also the source of the "a note over ~1.2K chars can't round-trip" limit called out in the README: `readNote` clips at 900 chars, but `updateNote` is a full-content replace with no append/patch mode, so an agent that reads a clipped note and writes it back will truncate the note on the canvas, not just in its own view.

### `describeSheet`/`describeConnection` deliberately drop different things than you'd guess

- `describeSheet`'s shaper replaces the full `columns[]` array (each with header, inferred type, and up to 3 samples) with a single compact string (`columnsCompact`) — but leaves `requestedColumns` **completely unshaped**, because that field only appears when the caller asked about specific column letters (e.g. `AU`, `BB`) and is the direct, targeted answer to that question.
- `describeConnection`'s shaper drops `queryShape.payloadSchema` (the largest field) but keeps `requiredFields` and one worked example — the comment in `shapeQueryShape` is explicit that this pair is judged sufficient to teach the payload shape without the full schema. This is also *why* `describeConnection` under the 1.5K cap loses payload accuracy on Google Analytics specifically — GA's payload schema is the most complex of the three connector types, so dropping it costs the most there.
- `createChart`'s shaper drops `resolvedColumns` and `labelSummary` entirely — not for size, but because both echo real sheet header text and cell values back into the result. The code comment is explicit: **do not add them back without revisiting `createChart`'s missing `untrustedContentHint`** — their absence is the only reason that tool can omit the annotation.

## The registration state machine

`webmcpRegistry.ts` is a **module-level singleton**, deliberately not owned by a React hook's effect lifecycle, for two concrete reasons documented in the code:

1. `registerTool` rejects with `InvalidStateError` on a duplicate name.
2. The app runs under React 19 `StrictMode` (`index.tsx`), which double-invokes effects (mount → cleanup → mount) in dev. An effect that registers 26 tools asynchronously would race its own cleanup and hit duplicate-name rejections on every dev mount.

A module-level `Map<ToolName, RegistryEntry>` is idempotent by construction instead. Each entry carries:

```ts
interface RegistryEntry {
  controller: AbortController;   // unregisters this tool when aborted
  fingerprint: string;           // JSON of {name,title,description,inputSchema,annotations}
  inFlight: number;               // concurrent executeWrapped() calls in progress
  pendingRemoval: boolean;        // desired=false arrived while inFlight>0
  registeredAt: number;           // for the hysteresis check
}
```

### Reconcile pass (`runSingleReconcile`)

Every reconcile computes `desired = computeDesiredTools(gating)` (see next section) and diffs it against `registry`:

1. **Removal pass** (`registered \ desired`): if the tool has calls in flight, mark `pendingRemoval` and defer — never abort a call mid-flight. Otherwise, if it was registered less than `HYSTERESIS_MS = 2000` ago, skip for now (re-evaluated next pass) — this stops register/unregister flapping when gating toggles quickly, e.g. a sheet created then immediately deleted by an undo. Otherwise abort and remove.
2. **Add/replace pass** over `desired`: if already registered with the same `fingerprint`, cancel any pending removal and move on (no-op). If the fingerprint changed (a descriptor/annotation update), abort the old registration and re-register. If new, register.

Self-cleanup on the call side: `executeWrapped`'s `finally` block checks `pendingRemoval` after decrementing `inFlight` — a removal deferred because a call was in flight is swept the instant that call finishes, not on the next externally-triggered reconcile.

### Race handling

- **`InvalidStateError`** (the browser still holds a name our map thinks is free): retried exactly once via an `invalidStateRetried` Set — the name stays in "desired minus registered" and comes back through `registerOne` on the next pass. Only reported as a real failure if the retry also hits it.
- **`NotAllowedError`** (a Permissions-Policy denial): treated as a whole-surface failure, not per-tool — `blocked = true`, every registered tool is aborted and cleared, and no further registration is attempted on any future reconcile. Without this, a denied permission would retry 26 rejections on every future gating change forever.
- **Concurrent reconciles**: `reconcileWebMcpTools` coalesces onto a single in-flight run via a module-level `inflight` promise. A caller that arrives mid-run doesn't queue a second run; it records `pendingReason` and the current run's `finally` loop does exactly one more pass before resolving everyone's promise. This is the guard against the most likely source of duplicate-name `InvalidStateError`s: two overlapping reconciles racing straight into `registerTool`.
- **BFCache restore**: a bfcache-restored tab isn't "fully active," which makes `registerTool` reject. `useWebMcpBridge.ts` re-reconciles on both the generic `visibilitychange` event and the bfcache-specific `pageshow` event (`event.persisted`).

## The gating predicate

`webmcpToolGating.ts` decides which of the 26 tools are registered *right now*, keyed on **durable store facts**, not conversation history — explicitly not the same shape as the Copilot backend's `selectToolNames` (`backend/src/agent/route.ts:122`), which gates on "did `listConnections` appear in this turn's messages." WebMCP has no turn boundary; ChatGPT calls `getTools()` once and calls tools later, so a tool that vanishes between those two calls is an unrecoverable error for that door — hence gating on facts that only change when the canvas actually changes.

```ts
export interface GatingState {
  hasSheet: boolean;
  hasNote: boolean;
  hasSchemaToken: boolean;
  hasPrivateResult: boolean;
  hasConnectorSheet: boolean;
}
```

| Bucket | Count | Tools | Gated on |
|---|---|---|---|
| `NEVER_GATED` | 8 | `listSheets`, `getSelection`, `createSheet`, `createNote`, `listNotes`, `listConnections`, `listConnectionProperties`, `describeConnection` | always available |
| `SHEET_GATED` | 10 | `describeSheet`, `getRange`, `querySheet`, `setCells`, `applyFilter`, `applySort`, `applyFormat`, `createChart`, `createPivot`, `createSparkline` | `sheetIds.length > 0` |
| `NOTE_GATED` | 3 | `readNote`, `updateNote`, `deleteNote` | `noteIds.length > 0` |
| `SCHEMA_TOKEN_GATED` | 3 | `queryConnection`, `createQuerySheet`, `createGaTrendBySource` | a `describeConnection` call has minted a schema token |
| `PRIVATE_RESULT_GATED` | 1 | `createQuerySheetFromResult` | a private `queryConnection` result exists |
| `CONNECTOR_SHEET_GATED` | 1 | `updateQuerySheet` | any sheet has a `connectorConfig` |

8 + 10 + 3 + 3 + 1 + 1 = 26 — every tool is covered by exactly one bucket (`webmcpToolGating.test.ts` asserts this never drifts from `TOOL_NAMES`).

`listNotes` is explicitly called out in the source as **must never be gated**: it's how an agent learns there are zero notes, not just how it lists existing ones — gating it on `hasNote` would make it impossible to discover that.

`hasConnectorSheet` is the one gating fact that isn't a plain count — it requires scanning every sheet for a `connectorConfig`. It's memoized on `sheetIds` array identity, so a run of cell edits (which never replaces that array reference) costs nothing beyond the initial `===` check.

`gatingKey(state)` is a cheap string built purely from counts (`sheetIds.length|noteIds.length|schemaTokens count|privateResults count|hasConnectorSheet`) — deliberately *not* built from deep state, so it does not change on cell edits, only on sheet/note/connection/result **count** changes. `useWebMcpBridge.ts` subscribes to the store, compares this key, and debounces a reconcile by `GATING_CHANGE_DEBOUNCE_MS = 250` — this is what stops every keystroke elsewhere on the canvas from triggering WebMCP registration churn.

## The error path

WebMCP has no `isError` field on a tool result — failure is signaled only by **rejecting** the `execute()` promise with a string reason. `executeWrapped` (`webmcpRegistry.ts`) enforces the ordering documented in its own comment: **validate → dispatch on the door chokepoint → translate `ok:false` into a rejection → shape + JSON-round-trip the success payload.**

```ts
const result = await dispatchTool(name, parsed.data, { getSelection: resolveSelection, door: 'chatgpt' });

if (result.ok === false) {
  throw new Error(buildErrorMessage(name, result as Record<string, unknown>));
}

return JSON.parse(JSON.stringify(shapeSuccess(name, result as Record<string, unknown>)));
```

`buildErrorMessage` (`toolResultShaping.ts`) folds whatever would normally be separate diagnostic fields (`schema`, `sqlGuidance`, `queryDiagnostics`, `guidance`, `missingParameters`, `suggestedNextTools`) into one string, capped at `ERROR_MESSAGE_MAX_CHARS = 600`, because a promise rejection only carries a message, not structured fields. Two examples where this enrichment is load-bearing, not incidental:

- **`querySheet`** — the failure message includes the sheet's real, sanitized SQL column names (`schema: A=hostname B=sessionsource ...`) plus `sqlGuidance`. The code comment calls this "the app's single most valuable error enrichment" — it's what lets the model self-correct a bad column name in its next call instead of guessing again.
- **`createChart`** — a validation failure (e.g. a date-like label column with no `timeRange`/`timeGranularity`) folds in `guidance` and `suggestedNextTools`. This is an intentional "ask the user" signal: losing it would make the agent retry blindly instead of asking for the missing parameter or switching to group mode / a pivot.

The `JSON.parse(JSON.stringify(...))` round-trip on the success path isn't cosmetic — it enforces serializability (a non-serializable return value would otherwise surface as a confusing WebMCP failure with no useful message) and gives `shapeSuccess`'s budget math something real to measure, since `jsonLength` is exactly `JSON.stringify(value).length`.

## Verification

- `npx vitest --run` — 479 tests across 27 files pass at time of writing, including four WebMCP-specific suites (`activityTrail`, `toolResultShaping`, `webmcpDescriptors`, `webmcpToolGating`).
- `npm run webmcp:smoke` (`scripts/webmcp-smoke.mjs`) is a standalone CDP harness (no Playwright, no new dependencies) forked from `scripts/agent-eval.mjs`. It tries a list of candidate Chrome launch flags for real `document.modelContext` first (`NATIVE_FLAG_CANDIDATES`), and falls back to injecting a spec-faithful polyfill via `Page.addScriptToEvaluateOnNewDocument` (shim mode) otherwise — shim mode validates everything this code controls (descriptor shape/budgets, `additionalProperties` correctness, shaped-result budgets, reject-on-error, registration transitions) but not the browser's own WebMCP implementation, and is loud about not being native (`--require-native` makes shim mode a hard failure rather than a silent pass).
- We ran it directly against a live local dev server for this submission: it launched Chrome with `--enable-features=WebMCPTesting` and reached **real, native** `document.modelContext` on stable Google Chrome 151.0.7922.174 — notable because the script's own header comment records an earlier investigation (2026-08-27) finding no working flag on that same Chrome version; whichever changed, native mode is reachable today. The run then hit a `document.readyState` timeout, most likely from concurrent hot-module-reloads in a dev server shared with other in-progress work in this environment rather than an app or harness bug — rerun on a quiet dev server for a clean pass.
