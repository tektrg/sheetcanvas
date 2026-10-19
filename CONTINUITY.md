# Continuity Ledger

- Goal (incl. success criteria): Pages + Library steps 1-2 (branch `feat/pages-library`): notes become organizable pages (title, tags, createdAt/updatedAt, reserved `publish`), backward-compatible load migration, and a top-level Library tab (search, tag filter, sort, open on canvas, add/remove tags) built on `@tektrg/table-core`.
- Constraints/Assumptions: Local-only (IndexedDB), no accounts/server storage. table-core is consumed as a dependency, never copied in.
- Key decisions: Page = NoteData (no parallel entity). Page fields optional on the type, filled by `normalizeNotePage` on load (`migrateLoadedNote` in store.ts) and on `addNote`. Content/title/tags/format edits bump `updatedAt`; move/resize does not. Empty title = first line of the note. Library = full-screen view above the canvas (canvas stays mounted). "Open" = switch to Canvas, center on the note, select it. table-core dep is `file:../../table-core` (local clone of `tektrg/table-core` at tag v1.2.0, built `dist/`) because this Mac's gh token lacks `read:packages` for GitHub Packages.
- State: Done on branch; not pushed.
- Done: utils/pages.ts, utils/libraryQuery.ts, components/library/{LibraryView,ViewTabs}.tsx, store/App/types wiring, __tests__/pages.test.ts. npm test, tsc, build green; browser-verified (screenshots /tmp/sheetcanvas-library/).
- Now: Hand off.
- Next: Switch the dep to registry `@tektrg/table-core@1.2.0` + `.npmrc` once `gh auth refresh -h github.com -u tektrg -s read:packages` is done. Possible later: page editor view, publishing.
- Open questions (UNCONFIRMED if needed): Should tag edits be undoable (updateNote takes no snapshot today)?
- Working set (files/ids/commands): worktree /Users/wifey/01_Project/SheetCanvas/flexsheet-pages-library; table-core clone /Users/wifey/01_Project/table-core.
