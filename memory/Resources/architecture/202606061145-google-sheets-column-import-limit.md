# 202606061145 Google Sheets column import limit

Google Sheets range requests can return columns beyond `AX`, but connected sheet materialization currently clips imported matrices to `MAX_IMPORT_COLS`.

Relevant paths:
- Initial connector import duplicates the slice in `App.tsx` via `handleDataConnectImport`.
- Connector refresh and agent-created query sheets call `utils/connectorSheet.ts` `applyMatrixToSheet`.
- `constants.ts` sets `MAX_IMPORT_COLS = 50`, and the 50th spreadsheet column is `AX`. `BE` is column 57.

If a Google Sheets range such as `A:BE` imports only through `AX`, the likely root cause is the frontend import cap, not the backend A1 range request.
