# 202606061850 Conditional pivot COUNTIF/SUMIF

SheetCanvas pivot tables now support metric-level conditional values. Each `PivotValue` can carry an optional `label`, AND-only `conditions`, and `countRows` for row-count `COUNTIF` metrics.

Behavior:
- Source sheet filters are global context and apply before metric conditions.
- Conditional `SUM`/`COUNT` display as `SUMIF`/`COUNTIF` when auto-labeled.
- `COUNTIF` counts matching source rows.
- `SUMIF` sums numeric matching values, writes `0` for zero-match buckets that have source rows, and records pivot-scoped warnings for blank/non-numeric matching values.
- Missing row/column combinations in matrix pivots remain blank.
- Guided UI validation blocks incomplete condition values before creating/updating pivots.
- Agent `createPivot` accepts the same metric config shape and has a focused eval at `agent/evals/pivot-conditional.example.json`.

Verification from implementation:
- `npm test` covers legacy SUM, conditional SUMIF, COUNTIF, source filters, matrix totals, and condition validation.
- `npm run build` passes with existing html2canvas mixed-import and large-chunk warnings.
- `npm run agent:eval -- --cases agent/evals/pivot-conditional.example.json --timeout-ms 60000` passes.
- `npx tsc --noEmit` still fails only on the existing unrelated `components/OnboardingGuide.tsx:89` `frameWindow.Element` type issue.
