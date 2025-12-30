# Google Analytics (GA4) Connector Plan (Flexsheet)

## Goal & Scope
- Support GA4 pageviews + typed custom events across the app (sheet actions, charting, import/export).
- Keep feature code GA-agnostic via a small connector abstraction (easy to disable/swap).
- Include privacy + consent controls (no PII, no sensitive spreadsheet content).

## Assumptions / Inputs Needed
Decide these before implementation:
- Tracking method: `gtag.js` direct vs Google Tag Manager (GTM). (Default recommendation: `gtag.js` unless GTM is required.)
- “Pageview” semantics: route-based (if any) vs state-based (e.g., active sheet changes).
- Consent requirements: opt-in vs opt-out; whether a consent banner is required.
- Data policy: confirm what is explicitly forbidden (recommended: no cell text, no filenames, no clipboard contents, no email/usernames).

## Phase 0 — Discovery
1. Map key user flows to measure:
   - Create/open sheet
   - Edit cells / formulas
   - Create/render charts
   - Import/export
2. Identify navigation/view boundaries for pageviews (routes or view states).
3. Confirm environments:
   - Separate GA property/measurement ID for staging vs production (recommended).

## Phase 1 — Architecture & Contracts
### 1) Analytics Connector Interface
Create a minimal, stable API and keep all GA specifics inside it:
- `init(config)` (measurement id, debug, default consent)
- `setConsent(enabled: boolean)`
- `trackPageView(params)`
- `trackEvent(event)`
- `setUserProperties(props)` (optional, non-identifying only)
- `flush()` / `teardown()` (optional)

### 2) Typed Event Schema
Define a discriminated union in `types.ts` so events are type-safe and consistent:
- Common fields:
  - `eventName` (union literal)
  - `timestamp`
  - `appVersion`
  - `sessionId` (random UUID)
  - `sheetIdHash?` (hash, not raw)
  - `source` (toolbar/shortcut/menu)
  - `counts` (rows/cols/charts; use buckets where possible)
- Event groups:
  - `sheet_*`, `cell_*`, `formula_*`, `chart_*`, `import_*`, `export_*`, `error_*`, `perf_*`

### 3) Constants & Naming
- Keep event name literals centralized (e.g., `constants.ts`) or derived from the union so UI code never hardcodes GA strings.
- Enforce payload key whitelisting to prevent accidental leakage of sensitive data.

## Phase 2 — GA4 Implementation (gtag.js)
### 1) Configuration (Vite env)
- `VITE_GA_MEASUREMENT_ID` (required for enabling analytics)
- `VITE_ANALYTICS_DEBUG=1` (optional; dev logging + GA DebugView support)
- Optional: `VITE_ANALYTICS_ENABLED=1` to allow quick gating.

### 2) Script Loading (Consent-Gated)
- Lazy-load GA script only after consent is granted (or immediately if no consent gating is required):
  - Inject `https://www.googletagmanager.com/gtag/js?id=...`
  - Initialize `window.dataLayer` and `gtag('js', new Date())`
  - Call `gtag('config', id, { send_page_view: false })` (pageviews sent manually)

### 3) Consent Mode (If Applicable)
- If using Google Consent Mode, call:
  - `gtag('consent', 'default', { analytics_storage: 'denied'|'granted' })`
  - `gtag('consent', 'update', { analytics_storage: 'denied'|'granted' })` on changes
- Ensure no analytics requests happen before consent when required.

### 4) App Integration Points
- In `index.tsx` or `App.tsx`:
  - Initialize connector once.
  - Subscribe to consent state from Zustand (e.g., `store.ts`).
- Pageview tracking:
  - Track initial view on mount.
  - Track on view changes (route changes or significant state changes like active sheet switch).
  - Use stable page identifiers (e.g., `SheetView`, `ChartView`) and avoid embedding sensitive identifiers.
- Provide a `useAnalytics()` hook under `hooks/` returning typed `trackEvent` / `trackPageView`.
- Ensure no feature code imports `gtag` or touches `window.dataLayer` directly.

### 5) Safety Rails
- Payload sanitization:
  - Drop `undefined` values.
  - Enforce max string lengths.
  - Whitelist keys per event.
  - Bucket numeric values (e.g., range sizes, counts) to reduce fingerprinting and payload size.
- Avoid PII:
  - No cell contents, filenames, raw sheet IDs, emails, clipboard contents.
- Optional: respect “Do Not Track” policy (product decision).

## Phase 3 — Instrumentation Plan (Events to Track)
### Funnel / Core Success
- `sheet_created`
- `sheet_opened`
- `import_started`, `import_completed`, `import_failed`
- `export_started`, `export_completed`, `export_failed`

### Engagement
- `cell_edited` (only type: value/formula; never content)
- `selection_changed` (range size bucket)
- `formula_evaluated` (success/fail + duration bucket)

### Charting
- `chart_created` (chart type, seriesCount bucket)
- `chart_rendered` (duration bucket)
- `chart_error` (category/code only)

### Reliability
- `app_error` (error category/code only; no stack unless redacted and approved)
- `worker_error` (if workers are used)

### Performance (Optional, Sampled)
- Web Vitals (LCP/CLS/INP) as `perf_web_vital` events, sampled (e.g., 1–10%).

## Phase 4 — Consent UX (If Required)
- Add a small consent component in `components/`:
  - States: unknown → prompt; granted/denied; “Manage preferences”
  - Persist in Zustand + localStorage-backed state
- Ensure toggling consent updates connector and Consent Mode (if used).

## Phase 5 — Developer Experience
- Debug logging:
  - If `VITE_ANALYTICS_DEBUG=1`, log outgoing events/pageviews to console (still respecting consent).
- Noop fallback:
  - If `VITE_GA_MEASUREMENT_ID` is missing, connector becomes a no-op (no crashes).
- Dev-only runtime validation:
  - Validate event payloads match expected shapes (strip unknown fields).

## Phase 6 — Manual QA Checklist
### With Consent Denied
- No GA network requests.
- No GA script tag injected.
- No `gtag` calls emitted.

### With Consent Granted
- Script loads once.
- Initial pageview fires once (no duplicates).
- Pageview triggers on intended view changes (e.g., active sheet switch if designed).
- Key events fire:
  - Create sheet, edit cell, create chart, import/export

### Regression
- App startup behavior unchanged.
- No console errors.
- No noticeable performance regressions (especially canvas and chart rendering).

### Observability
- Verify events in GA DebugView (use debug mode/property).

## Phase 7 — Rollout
- Start behind an environment gate (enable in staging first).
- Add documentation:
  - `.env.example` values + setup steps
  - Clear privacy statement: what is tracked vs not tracked
- After staging verification, enable in production and monitor:
  - Event volume and error rates
  - Unexpected payload growth or sensitive fields (should be prevented by whitelisting)

