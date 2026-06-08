# 202606071455 Chart color schemes

Implemented chart color schemes for SheetCanvas charts.

Requirements captured:
- Workspace default scheme with per-chart override.
- Built-in schemes: neon, pastel, mono.
- Mono has one global base color, default .
- Schemes support light/dark variants by brightness.
- Users can create a custom preset by entering comma-separated hex colors.
- Recent/custom color picker colors remain separate from scheme presets.
- Agent-created charts use the workspace default scheme.
- Series colors cycle when series exceed palette length.

Implementation notes:
-  is the single source of truth for parsing, palette generation, scheme resolution, and inherited primary-color behavior.
-  now stores recent colors separately from global  in localStorage.
-  stores ;  distinguishes inherited scheme primary color from a manually selected primary color.
- Existing charts are not bulk-migrated. Charts without  keep their stored ; new charts use  and inherit palette changes until manually overridden.
- Custom presets are raw user colors in light mode and brightness-adjusted in dark mode.

Validation:
- 
> SheetCanvas@0.0.0 test
> vitest --run


 RUN  v4.1.8 /Users/trungluong/01_Project/SheetCanvas/flexsheet


 Test Files  4 passed (4)
      Tests  18 passed (18)
   Start at  14:57:58
   Duration  5.65s (transform 8.28s, setup 0ms, import 11.94s, tests 253ms, environment 1ms): 4 files, 18 tests passed.
- 
> SheetCanvas@0.0.0 build
> vite build

vite v6.4.1 building for production...
transforming...
✓ 2537 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                    13.34 kB │ gzip:   3.62 kB
dist/assets/index-BH_UeLkq.css      1.89 kB │ gzip:   0.80 kB
dist/assets/index-1NzhDdH6.js   2,231.40 kB │ gzip: 590.56 kB
✓ built in 27.40s: passed with existing html2canvas dynamic/static import warning and bundle size warning.
- components/OnboardingGuide.tsx(89,66): error TS2339: Property 'Element' does not exist on type 'WiredFrameWindow'.: still fails only on known unrelated  ().
- Two sequential QA/product-review passes: pass 1 found inherited-primary/custom-dark issues that were fixed; pass 2 found no blocking gaps.
