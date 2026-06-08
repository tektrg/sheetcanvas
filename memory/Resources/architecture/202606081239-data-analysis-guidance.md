# 202606081239 Embedded data-analysis guidance

SheetCanvas Copilot should embed practical data-analysis best practices into the product experience, especially for business users who may describe outcomes rather than analytical workflows.

Direction:
- Treat data-analysis workflow guidance as advisory, not mandatory.
- Prefer durable, inspectable intermediate artifacts when they help users trust or reuse an insight.
- For chart requests that require aggregation over an existing sheet, a persistent pivot table is usually the best-practice intermediate step because it turns row-level data into a chartable summary and leaves the business logic visible.
- `querySheet` remains useful for exploration, validation, and edge cases, but temporary query results should not be the default stopping point when the user asked for a chartable aggregate.
- Conditional metric series, such as counting rows where different status columns equal specific values, are a natural fit for pivot metric values with row-count `COUNT` and metric-level conditions.

Example:
- User asks for a monthly line chart with two conditional applicant counts.
- Preferred workflow: inspect sheet and relevant columns, create a pivot grouped by the month/date column with two conditional count metrics, then create a line chart from that pivot.
