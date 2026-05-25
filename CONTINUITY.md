Goal (incl. success criteria):
- Review current code changes and adjust the onboarding guide so it has a real slide-up intro animation, the dismiss action says "watch later", and pricing information lives in a dedicated section instead of being mixed into workflow copy.

Constraints/Assumptions:
- Follow AGENTS.md repository guidelines.
- Use tmux for terminal commands and log inspection.
- Coding work must use the coding-engineering-basics skill.
- The app is free for now.

Key decisions:
- Onboarding optimizes for understanding the object/canvas mental model.
- The guide is both first-run onboarding and a persistent Learn drawer.
- Keep the seeded welcome note.
- Use in-app HyperFrames placeholders/storyboard prompts now; actual rendered videos later.
- Positioning copy: local processing is free; AI and cloud sync are planned later with pricing.

State:
- Done:
  - Read project instructions, coding-engineering-basics skill, HyperFrames skill, package metadata, App.tsx entry/render area, CommandBar, types, and current continuity ledger.
  - Identified existing onboarding as a welcome note seeded in `store.ts`.
  - Identified core app capabilities already present: CSV/XLSX import/drop, global command search, sheet sort/filter, chart creation, pivots/sparklines, notes, connectors, export/copy image, dark mode.
  - Added `components/OnboardingGuide.tsx` with eight workflow steps and HyperFrames storyboard placeholders.
  - Wired first-run dismissal via localStorage and persistent Learn access from the toolbar More menu.
  - Hid the toolbar while the guide is open to avoid hover artifacts beneath the bottom sheet.
  - Verified production build and browser smoke flow against `http://localhost:3000/`.
  - Added an explicit requestAnimationFrame-driven first-open slide-up intro animation.
  - Changed the dismiss control text to "watch later".
  - Moved free/local and future paid AI/cloud sync messaging into a dedicated Pricing section.
  - Verified `npm run build` exits 0 and Playwright smoke check confirms dialog, watch-later copy, and Pricing section.
  - Refined pricing layout so Pricing is a dedicated ninth onboarding step/section, not a repeated panel inside every workflow step.
  - Verified `npm run build` exits 0 and Playwright smoke check confirms the first workflow step does not show the pricing body, Pricing appears in nav, and clicking it opens the dedicated Pricing step.
- Now:
  - Handoff.
- Next:
  - Later: replace placeholders with rendered HyperFrames video assets.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Exact future pricing model for AI and cloud sync.

Working set (files/ids/commands):
- CONTINUITY.md
- App.tsx
- components/Toolbar.tsx
- components/OnboardingGuide.tsx
- `npm run build`
- Playwright smoke screenshot: `/tmp/sheetcanvas-onboarding-pricing-step.png`
