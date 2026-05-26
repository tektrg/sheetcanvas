# SheetCanvas SEO SOP

Purpose: grow qualified organic discovery for SheetCanvas while keeping `/` as the app and the fastest path to value.

This SOP is the operating baseline. Iterate it as search data, product positioning, and user feedback change.

## Principles

- App first: `/` is the live SheetCanvas app, not a marketing landing page.
- Quick value: search visitors should be able to open the canvas immediately.
- SEO supports the app: informational, comparison, connector, and docs pages should explain use cases without blocking product access.
- Crawlable where it matters: pages meant for search must be static or server-rendered enough for reliable indexing.
- Honest positioning: claims must match the current product, connectors, data handling, and local/offline behavior.
- Durable page contracts: every SEO page has a defined intent, primary keyword cluster, canonical URL, metadata, schema, CTA, and internal links.

## Reference Model

SpeechToDo uses a dedicated Astro marketing app with:

- shared SEO layout for title, description, canonical, Open Graph, Twitter, JSON-LD, RSS, and analytics;
- generated sitemap;
- public robots file;
- typed blog collection;
- topic pages, alternative pages, docs, legal pages, and localized pages.

SheetCanvas should reuse the infrastructure pattern, not the homepage pattern. SpeechToDo can use a marketing homepage because the product value needs framing. SheetCanvas should keep the root app because the product value is immediately visible.

## URL Strategy

### Product Entry

- `/` - live SheetCanvas app and primary product entry.
- `/app` - optional alias that redirects to `/` if needed for campaigns or docs.

The root app should be indexable unless a future production constraint makes indexing unsafe. It should include strong metadata and app schema, but it should not become a long marketing page.

### SEO Support Surfaces

Recommended initial routes:

- `/learn/` - concise product overview for visitors who want context before opening the app.
- `/docs/` - durable docs hub.
- `/use-cases/spreadsheet-canvas/`
- `/use-cases/csv-to-dashboard/`
- `/use-cases/local-spreadsheet-app/`
- `/use-cases/data-analysis-canvas/`
- `/connectors/clickhouse/`
- `/connectors/google-analytics/`
- `/alternatives/excel/`
- `/alternatives/google-sheets/`
- `/alternatives/airtable/`
- `/blog/`
- `/privacy/`
- `/terms/`
- `/rss.xml`
- `/robots.txt`
- `/sitemap-index.xml`

Defer localization until English pages have clear positioning, Search Console data, and stable page templates.

## Technical Setup

Preferred architecture:

- Keep the existing Vite React app at `/`.
- Add a small static/SSR marketing-docs surface for SEO pages.
- Use route/deploy rules so `/` serves the Vite app and SEO support pages serve crawlable HTML.

Implementation options:

- Astro app for support pages, modeled after SpeechToDo's `src/apps/marketing`.
- Static HTML pages only if speed matters more than maintainability for the first iteration.
- Vite-only routes only if each route can produce reliable page-specific metadata and crawlable content.

Baseline files to add or maintain:

- `public/robots.txt`
- `public/manifest.webmanifest`
- static OG images under `public/brand/`
- generated or maintained sitemap
- shared SEO metadata helper or layout for support pages
- structured data helper for JSON-LD
- Search Console verification once production domain is final
- GA4 site tracking, separate from GA4 connector OAuth

## Root App SEO Contract

The root app must have:

- title: describes SheetCanvas as a spreadsheet canvas, not only the brand name.
- meta description: says what the app does and why someone should open it.
- canonical URL.
- Open Graph and Twitter image tags.
- `SoftwareApplication` JSON-LD.
- `Organization` or publisher link to the parent studio where appropriate.
- favicon and app icons.
- no blocking overlays that prevent a first-time visitor from understanding the product.

The root app should not have:

- long invisible keyword blocks;
- large marketing copy above the usable product;
- crawl-only content that users cannot see;
- separate marketing CTAs that distract from opening/using the canvas.

## Page Template Contract

Every SEO support page should include:

- one primary search intent;
- one H1 matching the page's job;
- concise intro that explains who the page is for;
- product-specific screenshots or app visuals where relevant;
- internal links to `/`, docs, related use cases, and related alternatives;
- one primary CTA back to the app;
- metadata title and description;
- canonical URL;
- JSON-LD, usually `WebPage` plus `BreadcrumbList`;
- last reviewed date when the content depends on product capabilities.

Comparison pages must be fair. They should explain workflow fit, not pretend SheetCanvas replaces every mature spreadsheet feature.

Connector pages must distinguish current shipped capability from planned integrations.

## Content Pillars

Initial content should focus on bottom and middle funnel intent:

- spreadsheet canvas workflows;
- CSV/XLSX analysis without spreadsheet tab sprawl;
- dashboard exploration from imported data;
- local-first spreadsheet workflows;
- ClickHouse and GA4 connected-sheet workflows;
- Excel, Google Sheets, Airtable, and BI-tool alternatives by workflow;
- practical tutorials using real SheetCanvas features.

Avoid generic "what is a spreadsheet" content until the product has enough domain authority to compete for broad informational terms.

## Internal Linking Rules

- The root app links to `/learn/`, `/docs/`, `/privacy/`, and `/terms` in a low-friction location that does not weaken app-first UX.
- Support pages link back to `/` with product-action CTAs such as "Open SheetCanvas".
- Use-case pages link to relevant connector, alternative, and docs pages.
- Alternative pages link to at least one use-case page and one docs page.
- Blog posts link to the nearest durable use-case or docs page.

## Measurement

Track weekly:

- indexed pages in Google Search Console;
- impressions, clicks, CTR, and average position by page;
- query clusters that already show impressions;
- pages with impressions but weak CTR;
- pages ranking positions 8-20 that can be improved;
- app visits from organic landing pages;
- CTA clicks from support pages to `/`;
- root app engagement from organic sessions.

Recommended scripts:

- `seo:gsc` for Search Console reporting once the verified domain is known.
- a simple metadata audit script that checks titles, descriptions, canonicals, OG images, robots, sitemap entries, and JSON-LD.
- a sitemap diff or drift check before deploys.

## Publishing Workflow

For a new SEO page:

1. Define page intent, primary keyword cluster, and route.
2. Draft the page against the page template contract.
3. Add metadata, canonical, schema, and internal links.
4. Add the route to sitemap generation.
5. Build and smoke test the page.
6. Check rendered HTML for title, description, canonical, OG image, and JSON-LD.
7. Submit or inspect URL in Search Console after deploy when appropriate.
8. Review performance after enough impressions accumulate.

For edits to existing pages:

1. Read current page content and Search Console context first.
2. Preserve the page's search intent unless deliberately repositioning it.
3. Update last reviewed date if product-sensitive claims changed.
4. Re-run metadata/schema checks.
5. Watch for CTR or position movement after deployment.

## Quality Bar

A page is not ready if:

- it could describe any generic spreadsheet product;
- it claims integrations or offline/local behavior beyond the shipped product;
- it lacks a clear CTA to open or understand SheetCanvas;
- it has no internal links;
- metadata duplicates another page;
- schema is missing or invalid;
- it cannot be rendered as meaningful HTML without app JavaScript.

## First Iteration Checklist

- Improve root app metadata in `index.html`.
- Correct product naming in `metadata.json` from legacy `Sheetable` to `SheetCanvas`.
- Add `robots.txt`.
- Add `manifest.webmanifest`.
- Add default OG image.
- Add root `SoftwareApplication` JSON-LD.
- Add `/learn/` as the first support page using the strongest existing landing-page content.
- Add `/docs/` or connect existing docs to a public route.
- Add sitemap generation or a maintained static sitemap.
- Add Search Console verification and reporting once the domain is final.

## Open Decisions

- Production domain and canonical host.
- Whether SEO support pages live in a new Astro app or are generated by the existing Vite project.
- Whether `/learn/` should be static HTML for speed or Astro for maintainability.
- Final parent-studio schema relationship for theindie.app.
- Whether `/app` should redirect to `/` immediately or remain unused.
