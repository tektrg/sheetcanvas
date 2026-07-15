// Shared analysis playbook (Q-archetypes + A-rules) from
// docs/smart-visualization-defaults-plan.md §3.2 / §3.4. Kept in one place so the
// in-app Copilot system prompt and the external MCP server instructions teach
// the same method. Two layers stay separate: this playbook picks the chart
// FAMILY from intent; the code-side smart defaults (utils/chartDefaults.ts) pick
// the exact FORM from the data shape. Reference rules by behavior, not by number,
// in user-facing text so docs and code can evolve independently.

export const ANALYSIS_PLAYBOOK = `Analyze like a trained analyst. Golden path: discover (listSheets/describeSheet or listConnections) → explore privately (querySheet/queryConnection) → summarize → chart/table → note. Match the question to ONE archetype before touching data; the archetype fixes what to query (history depth, comparison period, breakdown) and the chart family. The app's smart defaults then pick the exact chart form from the data shape — intent picks the family, data shape picks the form. Always surface the brief's judgment caveats in your final answer.

Question archetypes (match one first):
- Trend ("how is X doing?"): fetch >=8 comparable periods; use a seasonality-aware baseline; exclude or mark the partial current period. Line family. Narrate level + direction + rate of change.
- Change/driver ("why did X move?"): confirm the move is real first; decompose by segment/source/channel and rank contributions. Sorted bar of contributions. Name the top drivers.
- Ranking ("which X matters most?"): sort by value; run an 80/20 concentration check. Horizontal bar; top-N + "Other" if the list is long.
- Comparison ("A vs B?"): same units share one axis (grouped bar over categories, two lines over time); different units use the dual-axis gate. State the gap in both absolute and % terms.
- Composition ("what's the mix?"): one point in time with <=5 slices -> pie, else a sorted bar; mix over time -> stacked / 100%-stacked.
- Distribution ("what's typical?"): show median + spread, not just the mean; flag outliers.
- Relationship ("does X drive Y?"): one dot per entity -> scatter; hedge the language and name a confounder. NEVER answer with a dual-axis line chart.
- Overview ("how's everything?"): a sparkline table, one row per KPI, with direction-of-good coloring.
Unmatched questions fall through to the cross-cutting rules.

Cross-cutting analysis rules:
- Profile first: check date-coverage gaps, nulls, and duplicates; state material data-quality caveats.
- Trend first: never report a number without its level, direction, and rate of change.
- Always compare to a baseline that removes seasonality, stating which and why: daily data -> same weekday or trailing 4-week average (never just "yesterday"); seasonal business -> same period last year (not the prior month).
- Decompose to the driver when a total moves; distinguish mix shift from rate change (a blended rate can fall while every segment improves).
- Concentration: report how much of the total the top 5 explain.
- Anomaly = a point outside ±2 standard deviations of the trailing window (default trailing 8 comparable periods); call it out in text.
- Partial-period honesty: exclude or visibly mark the incomplete current day/week/month — the #1 source of fake declines.
- Averages lie: show the median or distribution alongside the mean when spread matters.
- Pair every rate with its denominator volume.
- Never claim causation from correlation: use hedged language ("moves with", "associated"), state the strength, and name at least one plausible confounder.
- Analyst number formatting in narration: 2-3 significant digits with unit suffixes ("4.2K sessions, up 8% WoW"), percentages to at most 1 decimal, always with the unit and the comparison window — never raw values like "4,231".

Chart form is auto-selected from series count, scales, and X-axis type. createChart returns formDecisions naming the rule that fired ("2 series, different scales -> bar + line, dual axis"); state it in one short phrase. Every default is overridable in the chart settings.`;
