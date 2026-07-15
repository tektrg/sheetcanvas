# Smart Visualization Defaults & Analysis Playbook — Plan

**Status:** Draft v2 — awaiting answers to open questions (end of doc)
**Date:** 2026-07-10 (v2 same day — analytics-review revision: dual-axis gating, X-type awareness, ordinal sort exception, direction-of-good coloring, question-archetype playbook, narration formatting)
**Owner:** Trung + agent

---

## 1. Why (user-visible impact)

Today the app draws *technically correct but badly formed* charts, and the AI agent analyzes without an analyst's instincts:

- A chart with a volume + rate pair (e.g. sessions + conversion %) defaults to **2 bar series** on one axis — the smaller series flattens to nothing. The readable form is bar + line with a **second (right) axis** — but *only* when the two series genuinely differ in scale or units; two same-unit series belong on one shared axis.
- 4+ series still render as bars — a dense, unreadable wall. Over time they should be lines; over categories they should be consolidated or become a sparkline table.
- Bars as the default are only right for a **single series** (or a small same-unit group over categories).
- For a dense single-object overview, a **sparkline table** (trend + summary metrics with heatmap/bar cells) is the best answer, but the generator only emits trend + one delta column.
- The agent reports numbers without trend, baseline comparison, or driver decomposition — the basics of analysis.

**After this plan:** every chart — whether a human clicks the chart button or the agent creates one — comes out in the right form by default; the sparkline table becomes a true KPI overview; and the agent analyzes like a trained analyst (trend first, always compared, drivers named).

**Core trade-off:** opinionated defaults occasionally surprise a user who wanted plain bars. Mitigation: every default remains overridable in the chart settings panel, and the agent states which rule fired ("2 series with different scales → bar + line, dual axis").

---

## 2. Current state (verified in code, 2026-07-10)

The renderer already supports most of what we need — the gap is **defaults and agent access**, not rendering capability.

| Capability | Today | Where |
| --- | --- | --- |
| Mixed series types in one chart (bar + line combo) | ✅ Yes — metrics mode only | `components/ChartNode.tsx:1259` reads `seriesTypes[colId]`, all series render inside one Recharts `<ComposedChart>` |
| Secondary / right Y-axis (dual axis) | ✅ Yes — metrics mode only | `rightAxisColumns[]` → second `<YAxis>` (`ChartNode.tsx:864, 1004-1018`), independent scaling per axis |
| Per-series config in the data model | ✅ Yes | `ChartConfig.seriesTypes`, `rightAxisColumns`, `seriesDisplayNames` (`types.ts:235-260`) |
| Agent can use combo / dual axis | ❌ No | `createChart` tool schema (`agent/tools.ts:268-320`) omits `seriesTypes` / `rightAxisColumns` — agent charts are single-type, single-axis |
| Group mode per-series types | ❌ No | Group-mode series all use the one global `type` (`ChartNode.tsx:1025-1137`) |
| Smart form selection (auto type / axis by data shape) | ❌ No | `App.tsx handleInitChart` (line 416-479) picks X column, metric, and granularity smartly — but chart **type** falls back to `'bar'`; the agent handler (`src/agent/clientToolExecutor.ts:657-776`) takes type verbatim from the model |
| Sparkline table with heatmap/bar summary columns | ❌ Not built in | Generator (`utils/sparklineHelpers.ts:185-202`) emits fixed 4 columns: Metric, Current, Trend (sparkline visual), Change %. The cell-format system already supports `visual: bar / heatmap` with `heatmapColor` — the generator just doesn't emit them |
| Scatter plot (relationship / correlation charts) | ❓ Unverified | Recharts supports `<Scatter>` natively, but whether `ChartNode.tsx` exposes a scatter type is unconfirmed — **verify at Phase 1 start**. Without it, "does X drive Y" questions have no valid form and the agent will fake it with a dual-axis line chart — the exact spurious-correlation trap F11 exists to prevent |

**Glossary for non-code readers:**

- *metrics mode* — the chart plots columns you name directly (already-aggregated data).
- *group mode* — the chart aggregates raw rows itself (like a chart-side pivot).
- *Recharts* — the standard React charting library the renderer is built on.

---

## 3. The rulebook

### 3.1 Chart form rules (F-rules)

**F0 — evaluation order & inputs (governs all rules below).** The X-axis type (**time/ordered** vs **categorical** vs **ordinal** — see F7) is a first-class input alongside series count and per-series scale/unit stats; rules that conflict resolve in this order: X-type constraints (F6/F3-categorical) → series-count caps (F4/F5) → dual-axis gate (F2) → cosmetics (F7/F8). Lines are only ever valid when X is ordered — connected points over unordered categories imply a trend that doesn't exist. `chartDefaults.ts` implements this as an explicit ordered pipeline so the test matrix is unambiguous.

| # | Rule | Rationale |
| --- | --- | --- |
| F1 | **1 series → bar** (line if X is time; **horizontal bar** if labels are long or categories ≥ ~10) | Bars compare discrete values best; time reads as a line; long labels read sideways |
| F2 | **Dual axis is gated, never a count default.** Two (or more) series share **one axis** — grouped bars over categories, lines over time — *unless* the F2 gate fires: one series is a **rate/percentage paired with absolutes**, or magnitudes differ by **≥ ~10×**. Only then: volume series = bar on **left** axis, rate/small series = line on **right** axis. When neither series is a rate but scales still differ, prefer **rebasing both to index = 100** on one axis over a dual axis | Dual axes invite spurious-correlation reads and their relative scaling is arbitrary; same-unit pairs (this year vs last year) must share an axis. The volume-vs-rate combo is the one classic legitimate case |
| F3 | **3 same-unit series:** X is time → lines; X is categorical → grouped bars (3 is the ceiling). Mixed volume + rates → apply the F2 gate per series | Grouped bars get dense fast; lines over categories are invalid (F0) |
| F4 | **4+ series over time → lines, never bars.** 4+ series over categories → consolidate (F5) or sparkline table | Bars become an unreadable wall |
| F5 | **7+ series → don't plot all**: top-N + "Other" (N chosen so top-N covers ≥ ~80% of total, default 5; "Other" visually muted), or recommend a sparkline table instead | Beyond ~6 lines nothing is distinguishable; coverage-based N beats a fixed cutoff |
| F6 | **Time on the X-axis → line**, never grouped bars per period (area only when the story is cumulative/magnitude) | Trends read as continuous |
| F7 | **Categorical bars sorted by value** (descending) — **except ordinal categories** (months, age bands, funnel stages, size tiers), which keep their natural order | The ranking is the story — but value-sorting an ordinal scale destroys its story. Detect ordinal via known sequences (month/day names, numeric-range labels); when unsure, keep source order and emit a warning rather than sort |
| F8 | **Bars always start at zero**; lines may zoom into the data range, with the axis clearly labeled; rate series on a right axis use a 0-anchored or 0–100% range when natural | Truncated bars exaggerate differences; zoomed lines must show they're zoomed |
| F9 | **Pie only for ≤5 slices at one point in time**; otherwise a sorted bar | Angles are hard to compare |
| F10 | **Stacked bars only for part-of-whole over time, ≤5 segments**; 100%-stacked when the story is share shift | Mid-stack segments are unreadable beyond that |
| F11 | **Rate detection heuristic (feeds the F2 gate):** strong signal = percent number format / column metadata; weak signal = 0–1 or 0–100 bounds. Bounds alone never trigger a dual axis — small absolute counts (daily signups under 100) would false-positive | The gate must not fire on coincidence |
| F12 | **Relationship questions ("does X drive Y?") → scatter plot**, one dot per entity; bubble size only as a deliberate third dimension. Never answer a relationship question with a dual-axis line chart | Overlaid time series make any two trending metrics look correlated |
| F13 | **Long category labels or ≥ ~10 categories → horizontal bars** | Rotated/truncated labels are unreadable |

### 3.2 Analysis method rules (A-rules) — what the agent does before charting

| # | Rule | Rationale |
| --- | --- | --- |
| A0 | **Profile before analyzing**: check row coverage (date gaps), nulls, and obvious duplicates before drawing any conclusion; state material data-quality caveats | A trend over a table missing three weeks isn't a trend |
| A1 | **Trend first**: never report a number without its level, direction, and rate of change | A snapshot without trajectory isn't insight |
| A2 | **Always compare to a baseline — and pick the one that removes known seasonality**, stating which and why: daily data → same weekday or trailing 4-week average, never just "yesterday"; monthly/seasonal business → same period last year, not the prior month | A number without comparison is decoration; a comparison polluted by seasonality is misinformation |
| A3 | **Decompose to find the driver**: when a total moves, break by segment/source/channel and name what moved it — and distinguish **mix shift from rate change** (a blended rate can fall while every segment improves) | "Revenue fell 12%" → "driven by paid search, −40%"; Simpson's-paradox traps live here |
| A4 | **Concentration check (80/20)**: report how much of the total the top-5 explain | Focus follows concentration |
| A5 | **Flag anomalies — operationalized**: a point is anomalous when it falls outside ± 2 standard deviations of the trailing window (default: trailing 8 comparable periods); call it out in text, not just plotted | "Beyond the normal range" left undefined means every run invents its own; a crude testable rule beats vibes |
| A6 | **Partial-period honesty**: the current incomplete day/week/month is excluded or visibly marked | The #1 source of fake "declines" |
| A7 | **Averages lie**: when spread matters, show median or distribution alongside the mean | One whale skews everything |
| A8 | **Volume + rate together**: pair every rate with its denominator volume (feeds the F2 gate) | 100% conversion on 2 visits isn't a win |
| A9 | **Never claim causation from correlation**: relationship findings use hedged language ("moves with", "associated"), state strength, and name at least one plausible confounder | A confident "X drives Y" from the agent is the most damaging sentence it can produce |
| A10 | **Analyst number formatting in narration**: round to 2–3 significant digits with unit suffixes ("4.2K sessions, up 8% WoW"), never raw values ("4,231"); percentages to 1 decimal at most; always attach the unit and the comparison window | Precision theater buries the message; formatting is part of the analysis |

### 3.3 Dense-overview rule (S-rule)

| # | Rule |
| --- | --- |
| S1 | When the user wants "one view of everything" / a KPI overview, the default answer is a **sparkline table**: per row → metric name, current value, mini trend, Δ vs baseline as a **heatmap** cell colored by *direction of good* (see S2), optional share-of-total as an in-cell **bar** |
| S2 | **Direction of good:** green = improvement, red = deterioration — *not* green = up. For cost, churn, bounce rate, refund rate, load time, **down is good**. The agent infers direction per metric from its name/context; when direction is unknown or ambiguous, use **neutral coloring** (single-hue intensity), never guess green-up |

### 3.4 Question archetype playbook (Q-rules) — question → recipe → chart family

The agent's first move on any analytical question is to match it to one of these 8 archetypes. Each recipe fixes: what to query (history depth, comparison period, breakdown), which baseline (per A2), which chart family, and the narration shape. The F-rules then pick the exact form within the family from the actual data shape — **intent picks the family, data shape picks the form**. Kept small and curated on purpose: 8 archetypes in the system prompt beat a growing lookup database (retrieval machinery, contradicting entries, missed lookups). Unmatched questions fall through to A-rules + F-rules directly.

| # | Archetype | Trigger examples | Recipe |
| --- | --- | --- | --- |
| Q1 | **Trend** | "How is X doing?" | Fetch enough history for the granularity (≥ 8 comparable periods); seasonality-aware baseline (A2); exclude/mark partial period (A6) → **line** family; narrate level + direction + rate of change (A1, A10) |
| Q2 | **Change / driver** | "Why did X drop?" | Confirm the change is real (A5, A6 first); decompose by segment/source/channel (A3); rank contributions → **sorted bar of contributions**; narrate the top drivers by name |
| Q3 | **Ranking** | "Which X matters most?" | Sort by value; 80/20 concentration check (A4) → **horizontal bar** (F13), top-N + Other if long (F5) |
| Q4 | **Comparison** | "A vs B?" | Same units → same axis, grouped bar (categorical) or two lines (time); different units → F2 gate; state the gap in both absolute and % terms |
| Q5 | **Composition** | "What's the mix?" | One point in time, ≤5 slices → pie (F9); else sorted bar; mix *over time* → stacked/100%-stacked (F10) |
| Q6 | **Distribution** | "What's typical?" | Median + spread, not just mean (A7) → histogram/box family; flag outliers |
| Q7 | **Relationship** | "Does X drive Y?" | Pair the two metrics per entity → **scatter** (F12), one dot per entity; narration hedged with confounder named (A9) — never a dual-axis line chart |
| Q8 | **Overview** | "How's everything?" | → **sparkline table** (S1/S2); one row per KPI; direction-of-good coloring |

---

## 4. Implementation phases

### Phase 1 — Smart chart defaults engine ⭐ (fixes all three original complaints)

**What the user sees:** create a chart with a volume + rate pair → automatic bar + line with a right axis (same-unit pairs stay on one shared axis). 4 series over time → lines. One series → clean bar. Works identically from the chart button and from agent chat.

**Build:**

0. **Verify scatter support in **`**ChartNode.tsx**` (see current-state table). If absent, add basic `<Scatter>` rendering in this phase or explicitly log F12/Q7 as deferred — do not leave relationship questions with no valid form.
1. **New shared module **`**utils/chartDefaults.ts**` — pure function, single source of truth:
  - Input: per-column stats (inferred type, magnitude range, rate signal per F11 — percent format = strong, bounds = weak), series count, X-column type (time/ordered vs categorical vs ordinal).
  - Output: `{ type, seriesTypes, rightAxisColumns, sort, warnings[] }` implementing F1–F13 as an **explicit ordered pipeline per F0** (X-type constraints → count caps → dual-axis gate → cosmetics), so conflicting rules resolve deterministically.
  - Reuses existing helpers `inferColumnType`, `getValidDataCount` from `utils/dataAnalysis.ts`.
  - Pure + unit-testable: table-driven tests mapping data shapes → expected form, including the trap cases: two same-unit series (must NOT dual-axis), 3 series over categories (must NOT be lines), ordinal categories (must NOT value-sort), small counts under 100 (must NOT be detected as rates).
2. **Agent path** — `src/agent/clientToolExecutor.ts` `case 'createChart'` (line ~657-719):
  - When the model omits form details, run `chartDefaults` and populate `seriesTypes` / `rightAxisColumns` before `store.addChart`.
  - Extend the `createChart` tool schema (`agent/tools.ts:268-320`) with optional `seriesTypes` and `rightAxisColumns` so the agent can also set them explicitly.
  - Response includes `formDecisions` (which rule fired, in plain English) so the agent can narrate it.
3. **UI path** — `App.tsx handleInitChart` (line ~416-479) calls the same module instead of falling back to `'bar'`.
4. **Group mode**: add per-series-type support to group mode in `ChartNode.tsx` (line 1025-1137) *or* — cheaper first step — have the defaults engine only auto-switch the global type (bars→lines at 4+ series) in group mode, and log combo as metrics-mode-only. **Recommend the cheap path first.**

**Out of scope for Phase 1:** top-N+Other consolidation (F5) — warning only; consolidation lands in Phase 4.

**Effort:** ~2–3 sessions. **Risk:** low — additive, defaults only fill fields the caller didn't set.

### Phase 2 — Sparkline table upgrade (the dense KPI overview)

**What the user sees:** "give me an overview" → one compact table: metric, current value, trend line, red/green delta cell, share-of-total bar.

**Build (in **`**utils/sparklineHelpers.ts**`** + **`**agent/tools.ts:338-357**`** + handler **`**clientToolExecutor.ts:907**`**):**

1. Emit **heatmap coloring on the Change column** by default (`visual:'heatmap'`) — colored by **direction of good (S2), not green-up/red-down**. Blocking requirement, not polish: the agent passes a per-metric `goodDirection: 'up' | 'down' | 'unknown'` (inferred from metric name/context — cost, churn, bounce, refund, latency → down is good); `unknown` renders neutral single-hue intensity. Unconditional green-positive would actively mislead on half of all business metrics.
2. Optional columns behind new config flags: **Avg**, **Min/Max**, **Share of total** (group mode) with `visual:'bar'`.
3. Extend `SparklineConfig` (`types.ts:72-85`) + tool schema with `summaryColumns?: ('avg'|'minmax'|'share')[]`; keep default = today's 4 columns + heatmap so existing sheets refresh unchanged (`refreshSparklineTable` already preserves formats, line 241-248).
4. Update `createSparkline` tool description to position it as the S1 dense-overview default.

**Effort:** ~1–2 sessions. **Risk:** low; refresh-compat is the one thing to test carefully.

### Phase 3 — Teach the agent the analysis playbook

**What the user sees:** the agent stops answering "sessions were 4,231" and starts answering "sessions are trending up 8% WoW, driven mostly by organic; current week partial and excluded."

**Build (instructions, not code) — structured around the Q-archetype playbook (§3.4), not loose rule prose:**

1. **Server-level golden path** — replace the connection-failure-only `instructions` string in `backend/src/mcp/route.ts:182` with: workflow (discover → explore privately → summarize → chart → note) + the **8-archetype playbook (Q1–Q8)** as the primary structure, with A0–A10 as cross-cutting rules and "surface the brief's judgment caveats in your final answer." Match question → archetype → recipe before touching data; the recipe dictates history depth, baseline, and chart family; `chartDefaults` picks the final form.
2. **Tool description updates** (`agent/tools.ts`):
  - `createChart`: restructure so sentence 1 = when to use; add one-line form guidance referencing auto-defaults ("form is auto-selected from series count/scales/X-type unless you override"); note the F12 scatter rule for relationship questions.
  - `createSparkline`: S1/Q8 positioning + the `goodDirection` contract (S2).
  - `queryConnection` / `querySheet`: nudge Q-recipes' data requirements (fetch ≥ 8 comparable periods for trends; fetch the seasonality-correct comparison period per A2).
3. Mirror the same playbook in the in-app copilot system prompt (wherever the embedded agent's prompt lives — confirm during implementation).
4. **Keep the playbook in-prompt, not a lookup database**: 8 archetypes fit in the instruction budget and fire reliably; a retrievable database (with its retrieval misses and entry governance) is only worth building if the playbook demonstrably outgrows the prompt — revisit then, not now.

**Effort:** ~1 session + eval iteration. **Risk:** token growth in descriptions; mitigate by moving shared workflow text to the server instruction and *removing* the current duplicated fragments.

### Phase 4 — Guardrails & polish

1. **Top-N + "Other" consolidation** (F5) in group mode when series > threshold.
2. **Partial-period handling** (A6): detect incomplete trailing bucket after time-granularity grouping; exclude or render dimmed/dashed per the open question below.
3. **Renderer warnings** surfaced in chart config panel: bars with 4+ series, unsorted categorical bars, truncated bar axis.
4. **Categorical auto-sort** (F7) as a default in group mode.

**Effort:** ~2 sessions. **Risk:** partial-period detection has edge cases (timezones, sparse data) — ship behind a visible marker rather than silent exclusion first.

---

## 5. Verification per phase

- **Phase 1:** unit tests on `chartDefaults` (shape → form matrix, including the four trap cases: same-unit pair, categorical 3-series, ordinal sort, small-count rate false-positive); end-to-end via MCP: create 1-series, volume+rate pair, same-unit pair, 4-series-time, 4-series-categorical, and 8-series charts from chat, screenshot each, confirm forms match F-rules; confirm manual override in ChartConfigPanel still wins.
- **Phase 2:** create sparkline tables in both modes, confirm heatmap/bar cells render and survive a source-sheet edit + refresh; include one "down is good" metric (e.g. bounce rate falling) and confirm it colors green, plus one unknown-direction metric confirming neutral coloring.
- **Phase 3:** scripted eval prompts covering **all 8 archetypes** (one per Q-rule, e.g. "how are sessions doing?", "why did revenue drop?", "does ad spend drive signups?") judged for: correct archetype matched, trend stated, seasonality-correct baseline stated, driver named, caveat surfaced, numbers formatted per A10, no causal claim on Q7. Compare before/after.
- **Phase 4:** synthetic sheets with incomplete trailing week; verify marking/exclusion and no false positives on complete data.

---

## 6. Long-term maintenance notes

- **One rulebook, one module.** All form logic lives in `chartDefaults.ts`; UI and agent both consume it. Never re-implement a rule in a second place.
- Rules are **data, not prose**: the F-rule table above should map 1:1 to the test matrix, so adding a rule = add a row + a test. Precedence lives in F0 — a new rule must declare where it sits in the pipeline.
- **Two layers, kept separate:** the Q-playbook (intent → chart family, lives in agent instructions) and the F-rules (data shape → exact form, lives in code). Intent knowledge goes in the playbook; anything decidable from the data alone goes in code, where it's deterministic and testable.
- Agent-facing text (tool descriptions + server instruction) references rules by behavior, not by number, so docs and code can evolve independently.
- When the renderer gains capabilities (e.g. group-mode combo), only `chartDefaults.ts` and this doc need updating.

---

## 7. Open questions (answer before Phase 1 starts)

*Resolved in v2:* axis assignment follows rate/scale detection, not column position (F2/F11 gate — the old "first column = bar" question dissolves); single time series defaults to **line**, area only for cumulative stories (F6).

1. **F5 threshold:** consolidate to top-N + "Other" automatically, or warn-only and let all series render? (Phase 1 warns; Phase 4 consolidates — confirm consolidation is wanted at all.)
2. **Scope of smart defaults:** apply to human-clicked chart-button charts too (recommended, one consistent behavior), or agent-created only?
3. **A6 partial period:** exclude the incomplete trailing period by default, or show it dimmed/dashed? (Recommend: dimmed/dashed — honest without hiding data.)
4. **Scatter scope (F12/Q7):** if `ChartNode.tsx` lacks scatter support, add it in Phase 1 (recommended — otherwise relationship questions have no valid form) or defer to Phase 4 with the agent explicitly declining dual-axis substitutes?
5. **Direction-of-good source (S2):** agent-inferred from metric names only, or also a user-editable per-column setting for when inference is wrong? (Recommend: inference + neutral fallback first; the setting only if mislabels show up in practice.)
6. **Ordinal detection (F7):** known-sequence detection (month/day names, numeric ranges) with warn-don't-sort fallback — good enough, or do we want an explicit "ordinal" column type in the data model?

