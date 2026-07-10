# General Analysis Playbook

## Purpose

A single operational guide for safe, auditable, and high-trust BI analysis.

## Core principles

- Auditability is more important than speed.
- Use SQL or deterministic calculation tools; avoid mental math for business results.
- Before presenting insights, verify the full analysis chain: metric definition, denominator, filters, grain, sample size, date coverage, null handling, duplicates, and period comparability.
- Make uncertainty explicit when evidence is weak.
- Clarify only blocking ambiguity before analysis.

## 1) Pre-analysis setup

### 1.1 Clarify intent and scope first

1. Confirm the business question and success criteria.
2. Ask focused clarifying questions when intent is unclear.
3. Ask for/offer choice-driven paths (e.g., WoW vs MoM vs YoY) only when needed.
4. Share a short analysis plan: tables, metrics, filters, and execution sequence.

### 1.2 Load context and references

1. Start with department/session-specific configuration and filters.
2. Load reference docs required for the query domain:
  - `department` configuration
  - data dictionary
  - metric formula references
3. If domain-specific tables (e.g., Jira) are used, load the corresponding module guidance first.

## 2) Data source truth and schema control

### 2.1 Always discover schema from the live source

- Inspect table schemas before first query.
- Use sample rows and dictionary checks before assuming column names/attribute names.
- For array/map/object fields, inspect structure first and use proper accessors.
- Treat documented field names and enum values as suggestions, not truth.

### 2.2 Use canonical data sources

- For official financials, prefer certified financial datasets (`ceo.fs_*`) if explicitly required.
- For store/product master data, use authoritative master tables/dictionaries rather than transactional copies.
- For dictionary lookups (`dictGet`), verify dictionary name, key type, and attribute names first.

## 3) Standards for filtering and metric definition

### Mandatory base filters (when applicable)

- Exclude non-retail entities:
  - `store_id NOT IN ('1000', '1004')`
  - `store_id NOT LIKE '19%'`
- Use valid-sales filters:
  - `delivery_status = 'completed'`
  - `transaction_type = 'Sale Transaction'`

### Revenue/price conventions

- Default revenue field: `final_amount_no_tax`
- ASP exception: `final_amount` (with tax)
- Do not manually estimate percentages or ratios.

## 4) Query design and execution

### Build method

1. Query incrementally.
2. Start with minimal date filter, then add filters one by one.
3. Keep date windows explicit and half-open:
  - `>= start_date` and `< end_date`
4. Use CTEs to stage complex logic and create validation checkpoints.
5. Prefer `sumIf`, `countIf`, `avgIf`, `uniqIf` for ClickHouse where appropriate.
6. Avoid `SELECT *` on wide fact tables.
7. Deduplicate RHS tables before joins to avoid join explosion.

### Time handling

- Define a single anchor date (`anchor_date`) and derive all periods from it.
- Use Monday week grain consistently when requested or standardized: `toStartOfWeek(report_date, 1)`.
- Check boundary logic for month/quarter edges to avoid empty or shifted windows.

## 5) Validation and cross-checks (mandatory discipline)

### 5.1 Baseline validation

For every analysis, confirm:

- NULL completeness
- Duplicate risks (`COUNT(*)` vs `COUNT(DISTINCT key)`)
- Date coverage continuity and gaps
- Outliers and distribution sanity
- Sample volume adequacy

### 5.2 Complex query cross-checks

Run atomic validation when any condition applies:

- Query complexity is high (long SQL)
- Multiple tables are joined
- `UNION` is used
- 3+ metrics are computed together

For each key metric:

1. Write a simpler atomic query with identical filters and anchor periods.
2. Compare metric values with the complex query output.
3. Debug/adjust if they diverge before insight generation.

### 5.3 Zero-result debugging protocol

1. Confirm raw data exists with a minimal date-only filter.
2. Add filters incrementally until the zero count appears.
3. Query distinct filter values at failure points and correct assumptions.
4. Re-run with corrected filters.

## 6) Statistical and reasoning guardrails

- Watch for: Simpson’s paradox, causation vs correlation confusion, cherry-picking, survivorship bias, small-sample overreach.
- Ensure denominator matches numerator population for each metric/time window.
- Use `NULLIF`/`ifNull`/`coalesce` for safe division and null handling.
- Never compare incompatible grains (daily vs monthly) without explicit conversion.
- Never compare partial periods to complete periods.

## 7) Analysis quality requirements

- Preserve logic, scope, sources, and assumptions in concise analysis notes.
- Keep uncertainty and limitations visible.
- Keep reporting concise and tied to computed outputs (tables/charts/query brief).
- For requested output with charts, ensure logic and interpretation are traceable to shown data.

## 8) Required analysis appendix

Every report should include an “Analysis Appendix: Verification Details” containing:

- Data sources and tables used
- Key metric formulas used
- Filters/exclusions and date ranges applied
- Grain, anchor/date logic, and key assumptions
- Caveats/limitations and any unresolved data quality concerns

## 9) Quality controls from current general-analysis notes

- Auditability and reproducibility are priority constraints.
- Use hidden query results for reasoning when needed, then materialize user-visible tables only when needed.
- State uncertainty explicitly whenever confidence is limited.

