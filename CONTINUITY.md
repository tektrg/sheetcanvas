Goal (incl. success criteria):
- Define and iterate the SheetCanvas SEO operating model while keeping `/` as the app and fastest path to value.
- Success means there is a concrete SOP for SEO infrastructure, URL strategy, page contracts, measurement, and first implementation steps.

Constraints/Assumptions:
- Follow AGENTS.md repository guidelines.
- Use tmux for terminal commands and log inspection.
- Coding work must use the coding-engineering-basics skill.
- Read files before editing.
- Frontend dev server starts must use the dedicated port 5173.
- The welcome can be dismissed through the design's own "watch later" button or Escape; the design files remain visually unchanged.
- User confirmed the parent entity should be theindie.app, sitewide product links should use product names only, SheetCanvas should keep the app first, and the studio story should be founder-led.
- User clarified `/` should remain the app for quick value; SEO support surfaces should sit around it.

Key decisions:
- Treat `G-FDXZ468S02` as the public GA4 measurement ID for site/app visit tracking, separate from the existing GA4 data connector OAuth flow.
- Keep SheetCanvas root as the Vite app; use structured data in `index.html` and footer/about links in static landing/guide assets instead of adding a visible app footer.
- Use the shared live product set: FastTab, Strider, Pineapple Log, GPT Breeze, SpeechToDo, SheetCanvas.
- Copied `landing-page-design` into Vite public assets at `flexsheet/public/landing-page-design`.
- `components/OnboardingGuide.tsx` now hosts `/landing-page-design/SheetCanvas%20Onboarding.html?embed=sheet` in a transparent full-screen iframe.
- `SheetCanvas Onboarding.html` supports `embed=sheet`, which hides the standalone design's fake app background/scrim while preserving the actual sheet design.
- The app host supplies the real blurred app scrim behind the embedded design sheet.
- Raised the welcome layer above app overlays to prevent host UI from covering the design.
- Added `aria-label={tooltip}` to toolbar icon buttons so the More menu can be accessed and verified reliably.
- Versioned the onboarding dismissed key to `sheetcanvas:onboarding-dismissed:v2` so users who dismissed the old welcome see the new embedded design once.
- SEO SOP should copy SpeechToDo's infrastructure pattern, not its marketing-homepage pattern.
- Frontend app starts should use `npm run dev -- --host 127.0.0.1 --port 5173 --strictPort`; if 5173 is occupied, stop the stale SheetCanvas server instead of auto-selecting another port.
- For the first SEO iteration, prioritize completing the root app crawl/preview baseline before adding support pages, because `/` remains the live app and primary product entry.
- Use a 1200x630 PNG as the canonical social preview image, with an SVG source kept beside it for maintainable edits.

State:
- Done:
  - Read `AGENTS.md`, `CONTINUITY.md`, project structure, and existing GA connector code before editing.
  - Added GA4 site tracking to `index.html` using measurement ID `G-FDXZ468S02`.
  - Used explicit `window.dataLayer` and `window.gtag` setup in the GA snippet.
  - Replaced the previous React onboarding content with a full-screen iframe host for the provided bottom-sheet artifact.
  - Preserved the provided design's own HTML, CSS, JS, fonts, and uploads under `public/landing-page-design`.
  - Verified the first-run welcome loads `SheetCanvas Onboarding.html`, renders "Learn the SheetCanvas object model", and has no extra host sheet.
  - Verified the design's own "watch later" button closes the app overlay.
  - Verified the toolbar path More -> Learn SheetCanvas reopens the same iframe after close.
  - Ran `npm run build`; it passes with only existing Vite chunk-size/html2canvas warnings.
  - Re-ran `npm run build` after the GA edit; it passes with the same existing Vite warnings.
  - Verified `dist/index.html` contains the GA measurement script.
  - Opened `http://127.0.0.1:5173/` in the in-app browser; the app renders, the GA script/snippet are present, and tab console errors are empty.
  - Checked active Vite logs for `sheetcanvas_bottom_sheet_dev`; no runtime errors found.
  - Added the theindie.app product network links and SheetCanvas publisher schema to the static landing, guide, root app HTML, and onboarding bottom-sheet iframe source.
  - Restarted the visible `flexsheet-dev` server at `http://127.0.0.1:3000/` and the `sheetcanvas_bottom_sheet_dev` server at `http://127.0.0.1:5173/`.
  - Smoke-tested `http://127.0.0.1:3000/`; it loads `/landing-page-design/SheetCanvas%20Onboarding.html` and renders "Learn the SheetCanvas object model".
  - Updated the embed to `/landing-page-design/SheetCanvas%20Onboarding.html?embed=sheet` so the screenshot no longer shows the standalone design's fake app background over the real app.
  - Verified `embed=sheet` sets `html[data-embed="sheet"]`, hides the design `.app` and `.scrim`, keeps the real app visible behind the host scrim, and preserves close/reopen behavior.
  - Reviewed SpeechToDo SEO setup and SheetCanvas current Vite app setup.
  - Added `docs/seo-sop.md` as the baseline SEO SOP.
  - Updated `AGENTS.md` to require frontend dev starts on dedicated port 5173 with `--strictPort`.
  - Corrected `metadata.json` product naming from legacy `Sheetable` to `SheetCanvas`.
  - Completed the root app SEO metadata baseline in `index.html`: descriptive title, canonical URL, Open Graph, Twitter card, theme color, manifest link, and app icons.
  - Added `public/manifest.webmanifest`.
  - Added `public/robots.txt`, `public/sitemap-index.xml`, and `public/sitemap.xml` for the current root app.
  - Added `public/brand/sheetcanvas-og.svg` and generated `public/brand/sheetcanvas-og.png` for social sharing.
  - Verified `npm run build`; it passes with the existing html2canvas dynamic/static import warning and existing large chunk warning.
  - Verified `dist/index.html` contains the expected title, description, canonical, OG/Twitter image, manifest link, `SoftwareApplication` schema, and GA4 snippet.
  - Verified JSON parsing for `metadata.json` and `public/manifest.webmanifest`; smoke-checked sitemap XML contents.
  - Verified built `dist/` includes robots, sitemap index, sitemap, manifest, and the 1200x630 PNG OG image.
  - Attempted local preview smoke test on `127.0.0.1:4173`; sandbox blocked server binding with `listen EPERM`.
  - Attempted tmux log/session inspection and cleanup, but tmux socket creation/connect is blocked in this sandbox with `Operation not permitted`.
  - Checked available `vite.log` and `backend/wrangler.log`; no current runtime errors in those logs, only startup/health output. Old archived Wrangler errors exist from prior dates and were not caused by this run.
- Now:
  - Root app SEO crawl/preview baseline is complete; HTTP preview was blocked by sandbox permissions.
- Next:
  - Add `/learn/` as the first crawlable support page using product-specific existing landing-page content, while keeping `/` as the app.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `docs/seo-sop.md`
- `index.html`
- `public/landing-page-design/SheetCanvas Landing v1.html`
- `public/landing-page-design/SheetCanvas.html`
- `public/landing-page-design/SheetCanvas Onboarding.html`
- `public/landing-page-design/onboarding.jsx`
- `components/OnboardingGuide.tsx`
- `components/OnboardingGuide.css`
- `components/Toolbar.tsx`
- `public/landing-page-design/`
- `public/manifest.webmanifest`
- `public/robots.txt`
- `public/sitemap-index.xml`
- `public/sitemap.xml`
- `public/brand/sheetcanvas-og.svg`
- `public/brand/sheetcanvas-og.png`
- `AGENTS.md`
- Dev server: `http://127.0.0.1:5173/` in tmux session `sheetcanvas_bottom_sheet_dev`
