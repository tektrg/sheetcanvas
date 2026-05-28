# 202605281736 SEO operating model

**Hard rule:** `/` is the live Vite app and the fastest path to value. Do **not** replace it with a marketing homepage. SEO support surfaces live as static `public/**/index.html` routes:

- `public/learn/`, `public/docs/`
- `public/connectors/<x>/` (e.g. `clickhouse`, `google-analytics`)
- `public/use-cases/<x>/` (spreadsheet-canvas, csv-to-dashboard, local-spreadsheet-app, data-analysis-canvas)
- `public/alternatives/<x>/` (excel, google-sheets, airtable)
- `public/blog/<slug>/` + `public/blog/index.html`
- `public/privacy/`, `public/terms/`

## Page contract (every support page must have)
- Title, meta description, canonical, OG/Twitter tags
- `WebPage` + `BreadcrumbList` JSON-LD (blog posts also `BlogPosting`)
- Visible `Last reviewed:` date
- A link back to `/`
- At least one link to another support page

`scripts/seo-audit.mjs` enforces this contract plus sitemap/robots/RSS coverage and the root app-shell mount/module entry.

## Tooling
- Sitemap generated from `scripts/seo-route-config.mjs` via `npm run seo:sitemap`.
- RSS generated from blog page JSON-LD via `npm run seo:rss`.
- `/app` and `/app/` aliases 301 → `/` via `public/_redirects`.
- SOP details: `docs/seo-sop.md`.
- Search Console reporting: `npm run seo:gsc` (delegates to `~/clawd/bin/gsc-report`, defaults to `sc-domain:sheetcanvas.com`).

## Why
SOP copied from SpeechToDo's infrastructure pattern (not its marketing-homepage pattern) because `/` must remain the product entry.

## How to apply
New SEO pages: add static route → bidirectional links → update `seo-route-config.mjs` → `npm run seo:audit`. Never add a visible footer or marketing block to the root app; use no-JS fallback links in `index.html` instead.

## Links
- [[Resources/architecture/202605281734-product-overview]]
- [[Areas/deployment/202605281735-wrangler-pages-deploy]]
- [[Resources/branding/202605281738-product-network]]
- [[Resources/analytics/202605281740-ga4-measurement-id]]
