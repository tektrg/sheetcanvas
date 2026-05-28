# 202605281740 GA4 measurement ID

Public GA4 measurement ID for sheetcanvas.com site/app visit tracking: **`G-FDXZ468S02`**.

Wired in `index.html` via explicit `window.dataLayer` + `window.gtag` setup.

## Distinction
This is **not** the GA4 **data connector** OAuth flow. Two separate things:
- **`G-FDXZ468S02`** — site telemetry for sheetcanvas.com (page views, sessions on the SheetCanvas app itself).
- **GA4 data connector** — backend OAuth flow in `backend/src/googleAnalytics.ts` that lets users pull *their own* GA4 reports into a connected sheet.

Don't conflate the two when debugging analytics issues.

## Links
- [[Areas/seo/202605281736-seo-operating-model]]
- [[Resources/architecture/202605281734-product-overview]]
