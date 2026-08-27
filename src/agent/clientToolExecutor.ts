import { useStore } from '../../store';
import type { CellData, ChartData, ChartConfig, SheetData, NoteData, NoteColor, FilterCondition, SortConfig, SelectionContext, ChartType, PivotConfig, PivotValue, SparklineConfig, ConnectorType } from '../../types';
import { parseCellId, getCellId } from '../../utils/formulas';
import {
  CELL_HEIGHT,
  CELL_WIDTH,
  DEFAULT_CHART_SIZE,
  HEADER_COL_WIDTH,
  HEADER_ROW_HEIGHT,
  INITIAL_COLS,
  INITIAL_ROWS,
} from '../../constants';
import { accumulateChartFocus, accumulateNoteFocus, accumulateSheetFocus } from './agentFocusAccumulator';
import { runSheetQuery, sheetTableSchema } from './alasqlAdapter';
import { getClickhouseSchema, describeClickhouseTable } from '../../utils/clickhouseBackend';
import { getConnectorQueryProvider } from '../../utils/connectorQuery';
import { getGoogleAnalyticsMetadata, listGoogleAnalyticsPropertiesPage, type GoogleAnalyticsMetadataItem } from '../../utils/googleAnalyticsBackend';
import { DEFAULT_GOOGLE_SHEETS_RANGE } from '../../utils/googleSheetsBackend';
import { getChartPalette, readStoredChartColorSettings } from '../../utils/chartColorSchemes';
import { buildChartSeriesDisplayNames } from '../../utils/chartDisplay';
import { getColumnIdForIndex, getColumnIdSpan, getSheetDataBounds } from './sheetBounds';
import { computeChartDefaults } from '../../utils/chartDefaults';
import { buildSelectedCanvasSummary } from './selectedCanvasSummary';
import { applyFormatToSheet, type ApplyFormatInput } from './applyFormatTool';
import { placeOriginal, placeDerivative, placeNote } from '../../utils/canvasLayout';
import {
  createGaTrendBySourceSheet,
  enrichConnectionsForMcp,
  loadConnections,
  type BasicConnection,
} from './gaMcpTools';
import {
  handleCreateQuerySheet,
  handleCreateQuerySheetFromResult,
  handleQueryConnection,
  handleUpdateQuerySheet,
  rewriteClickhouseSqlForDescribedTable,
} from './querySheetTools';

const generateId = () => Math.random().toString(36).slice(2, 11);

const DEFAULT_NOTE_SIZE = { width: 420, height: 320 };

// Upper bound on cells an agent may drop into one createSheet call. Guards
// against a runaway paste; large/real datasets belong in a connector sheet.
const MAX_CREATE_SHEET_CELLS = 20000;

// Placement for agent-created objects routes through the shared canvas layout
// module (utils/canvasLayout.ts): originals stack down the left column,
// derivatives flow right along their source's row, notes float to the far right.

// Derive a short human-readable title from a note's raw content: the first
// heading text, else the first non-empty line. Used by listNotes/readNote so
// agents can recognize a note without re-parsing its whole body.
const deriveNoteTitle = (content: string): string => {
  for (const line of (content ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^#{1,6}\s+(.*)/);
    return (heading ? heading[1] : t).slice(0, 120) || '(untitled note)';
  }
  return '(empty note)';
};

// Collapse a note's content into a one-line preview snippet for listNotes.
const deriveNotePreview = (content: string): string => {
  const flat = (content ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > 160 ? `${flat.slice(0, 157)}…` : flat;
};

export function centerCanvasOnSheet(
  sheet: SheetData,
  viewport: { innerWidth: number; innerHeight: number } | null =
    typeof window === 'undefined' ? null : window,
) {
  if (!viewport) return;

  const store = useStore.getState();
  const scale = store.transform.scale;
  const sheetWidth = sheet.size.width * CELL_WIDTH + HEADER_COL_WIDTH;
  const sheetHeight = sheet.size.height * CELL_HEIGHT + HEADER_ROW_HEIGHT;
  const sheetCenterX = sheet.position.x + sheetWidth / 2;
  const sheetCenterY = sheet.position.y + sheetHeight / 2;

  store.setTransform({
    scale,
    offset: {
      x: viewport.innerWidth / 2 - sheetCenterX * scale,
      y: viewport.innerHeight / 2 - sheetCenterY * scale,
    },
  });
}

const DEFAULT_GA_DIMENSIONS = new Set([
  'date',
  'sessionSource',
  'sessionMedium',
  'sessionCampaignName',
  'firstUserSource',
  'firstUserMedium',
  'pagePath',
  'pageTitle',
  'country',
  'deviceCategory',
]);

const DEFAULT_GA_METRICS = new Set([
  'activeUsers',
  'sessions',
  'totalUsers',
  'newUsers',
  'screenPageViews',
  'eventCount',
  'engagementRate',
  'bounceRate',
  'conversions',
]);

function makeSchemaToken(): string {
  return 'schema_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function compactGaMetadata(
  items: GoogleAnalyticsMetadataItem[],
  defaults: Set<string>,
  args: { search?: string; limit?: number; includeDescriptions?: boolean },
) {
  const limit = Math.max(1, Math.min(args.limit ?? 25, 50));
  const terms = (args.search ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);

  const filtered = terms.length
    ? items.filter((item) => {
        const haystack = `${item.apiName} ${item.displayName} ${item.description ?? ''}`.toLowerCase();
        return terms.some((term) => haystack.includes(term));
      })
    : items.filter((item) => defaults.has(item.apiName));

  const source = filtered.length ? filtered : items;
  const selected = source.slice(0, limit);
  return selected.map((item) => ({
    apiName: item.apiName,
    displayName: item.displayName,
    ...(args.includeDescriptions && item.description ? { description: item.description } : {}),
  }));
}

export type ToolResult =
  | { ok: true; [k: string]: unknown }
  | { ok: false; error: string; [k: string]: unknown };

export interface SelectionResolver {
  getSelection: () => SelectionContext;
}

function describeColumn(sheet: SheetData, colIndex: number, rowCount: number) {
  const letter = getColumnIdForIndex(colIndex);
  const headerCellId = `${letter}1`;
  const header = sheet.cells[getCellId(colIndex, 0)];
  const samples: unknown[] = [];
  for (let r = 1; r < rowCount && samples.length < 3; r++) {
    const cell = sheet.cells[getCellId(colIndex, r)];
    const v = cell?.value ?? cell?.raw;
    if (v !== null && v !== undefined && v !== '') samples.push(v);
  }
  let inferredType: 'number' | 'date' | 'text' = 'text';
  if (samples.length > 0) {
    const nums = samples.filter((v) => typeof v === 'number' || !Number.isNaN(Number(v)));
    if (nums.length === samples.length) inferredType = 'number';
    else if (samples.every((v) => !Number.isNaN(Date.parse(String(v))))) inferredType = 'date';
  }
  return {
    columnId: letter,
    headerCell: headerCellId,
    dataRange: `${letter}2:${letter}${rowCount}`,
    header: header?.value ?? header?.raw ?? null,
    inferredType,
    samples,
  };
}

function summarizeSheet(sheet: SheetData) {
  const columns: ReturnType<typeof describeColumn>[] = [];
  const bounds = getSheetDataBounds(sheet);
  for (let c = 0; c < bounds.width; c++) columns.push(describeColumn(sheet, c, bounds.height));
  return {
    sheetId: sheet.id,
    title: sheet.title,
    rowCount: bounds.height,
    columnCount: bounds.width,
    columnIdSpan: getColumnIdSpan(bounds.width),
    rowNumbering: '1-based; row 1 is headers, data starts at row 2',
    columns,
    filters: sheet.filters ?? [],
    sort: sheet.sort ?? null,
    connector: sheet.connectorConfig
      ? {
          type: sheet.connectorConfig.type,
          name: sheet.connectorConfig.name,
          connectionId: sheet.connectorConfig.connectionId ?? null,
          query: sheet.connectorConfig.query ?? null,
          params: sheet.connectorConfig.params ?? null,
          derivation: sheet.connectorConfig.derivation ?? null,
          brief: sheet.connectorConfig.brief ?? null,
          lastError: sheet.connectorConfig.lastError ?? null,
          lastRefreshedAt: sheet.connectorConfig.lastRefreshedAt ?? null,
          truncated: sheet.connectorConfig.truncated ?? false,
        }
      : null,
  };
}

function parseRange(range: string): { startCol: number; startRow: number; endCol: number; endRow: number } | null {
  const [a, b] = range.split(':');
  const start = parseCellId(a);
  const end = parseCellId(b ?? a);
  if (!start || !end) return null;
  return {
    startCol: Math.min(start.col, end.col),
    endCol: Math.max(start.col, end.col),
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
  };
}

function colLetterToIndex(letter: string): number {
  let col = 0;
  for (let i = 0; i < letter.length; i++) col = col * 26 + (letter.charCodeAt(i) - 64);
  return col - 1;
}

function normalizeColumnId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toUpperCase();
  return /^[A-Z]+$/.test(trimmed) ? trimmed : null;
}

function columnExistsInBounds(letter: string, columnCount: number): boolean {
  const idx = colLetterToIndex(letter);
  return idx >= 0 && idx < columnCount;
}

type CreateChartInput = {
  sheetId: string;
  type: ChartType;
  mode?: ChartConfig['mode'];
  labelColumn: string;
  dataColumns: string[];
  groupCol?: string;
  seriesGroupCol?: string;
  valueCol?: string;
  operation?: PivotConfig['values'][number]['operation'];
  seriesTypes?: Record<string, ChartType>;
  rightAxisColumns?: string[];
  title?: string;
  timeRange?: string;
  timeGranularity?: ChartConfig['timeGranularity'];
  aggregation?: PivotConfig['values'][number]['operation'];
  sourceGrain?: 'raw_rows' | 'already_aggregated' | 'pivot_summary' | 'unknown';
  allowDuplicateLabels?: boolean;
  analysisNotes?: string;
};

function getCellDisplayValue(cell: CellData | undefined): string | null {
  const value = cell?.value ?? cell?.raw;
  if (value === null || value === undefined || value === '') return null;
  return String(value);
}

function isDateLikeCell(cell: CellData | undefined): boolean {
  const value = cell?.value ?? cell?.raw;
  if (value === null || value === undefined || value === '') return false;
  if (cell?.format?.type === 'date') return true;
  if (typeof value === 'number') return false;
  const text = String(value).trim();
  const hasDateShape =
    /\b\d{4}[-/]\d{1,2}([-/]\d{1,2})?\b/.test(text) ||
    /\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(text) ||
    /\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\b/i.test(text);
  return hasDateShape && !Number.isNaN(Date.parse(text));
}

function summarizeChartLabels(sheet: SheetData, labelColumn: string, rowCount: number) {
  const labelColIndex = colLetterToIndex(labelColumn);
  const header = getCellDisplayValue(sheet.cells[`${labelColumn}1`]);
  const labelCounts = new Map<string, number>();
  let dateLikeCount = 0;
  let labelCount = 0;
  let minDateMs: number | null = null;
  let maxDateMs: number | null = null;

  for (let row = 1; row < rowCount; row += 1) {
    const cell = sheet.cells[getCellId(labelColIndex, row)];
    const label = getCellDisplayValue(cell);
    if (!label) continue;
    if (sheet.pivotConfig && label === 'Grand Total') continue;

    labelCount += 1;
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);

    if (isDateLikeCell(cell)) {
      dateLikeCount += 1;
      const ts = Date.parse(label);
      if (!Number.isNaN(ts)) {
        minDateMs = minDateMs === null ? ts : Math.min(minDateMs, ts);
        maxDateMs = maxDateMs === null ? ts : Math.max(maxDateMs, ts);
      }
    }
  }

  const duplicateLabels = Array.from(labelCounts.entries())
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, count]) => ({ label, count }));

  return {
    columnId: labelColumn,
    header,
    labelCount,
    uniqueLabelCount: labelCounts.size,
    duplicateLabels,
    dateLikeCount,
    isDateLike: labelCount > 0 && dateLikeCount / labelCount >= 0.8,
    availableTimeRange:
      minDateMs !== null && maxDateMs !== null
        ? {
            startDate: new Date(minDateMs).toISOString().slice(0, 10),
            endDate: new Date(maxDateMs).toISOString().slice(0, 10),
          }
        : null,
  };
}

function validateChartAnalysisIntent(sheet: SheetData, input: CreateChartInput, rowCount: number): ToolResult | null {
  const mode = input.mode ?? 'metrics';
  const labelColumn = mode === 'group' ? (input.groupCol ?? input.labelColumn) : input.labelColumn;
  const labelSummary = summarizeChartLabels(sheet, labelColumn, rowCount);
  const missingParameters: string[] = [];
  const guidance: string[] = [];
  const suggestedNextTools: string[] = [];

  if (mode === 'metrics' && labelSummary.isDateLike) {
    if (!input.timeRange) missingParameters.push('timeRange');
    if (!input.timeGranularity) missingParameters.push('timeGranularity');
    if (missingParameters.length > 0) {
      guidance.push(
        `Column ${input.labelColumn}${labelSummary.header ? ` (${labelSummary.header})` : ''} is date-like, so ask the user for the intended date range and time granularity before charting.`,
      );
      guidance.push('If the user wants the full available range, pass timeRange="full available range" explicitly.');
    }
  }

  const duplicateLabelsNeedAggregation =
    mode === 'metrics' &&
    labelSummary.duplicateLabels.length > 0 &&
    (labelSummary.isDateLike || input.type === 'line' || input.type === 'area' || input.type === 'scatter');

  if (duplicateLabelsNeedAggregation && !input.allowDuplicateLabels) {
    guidance.push(
      'The label column has repeated labels. For a trustworthy visualization, use chart group mode for a clean visual aggregate, or create a persistent pivot/summary when the user needs an inspectable analytical trail.',
    );
    suggestedNextTools.push('createChart', 'createPivot');
  }

  if (missingParameters.length > 0 || (duplicateLabelsNeedAggregation && !input.allowDuplicateLabels)) {
    return {
      ok: false,
      error:
        'Chart needs more analysis intent before it can be created without risking a misleading visualization.',
      missingParameters,
      labelSummary,
      guidance,
      suggestedNextTools,
    };
  }

  return null;
}

export { rewriteClickhouseSqlForDescribedTable };

export async function executeClientTool(
  name: string,
  input: any,
  resolver: SelectionResolver,
): Promise<ToolResult> {
  const store = useStore.getState();

  try {
    switch (name) {
      case 'listSheets': {
        const sheets = store.sheetIds.map((id) => {
          const s = store.sheets[id];
          const bounds = getSheetDataBounds(s);
          return {
            sheetId: s.id,
            title: s.title,
            rowCount: bounds.height,
            columnCount: bounds.width,
            columnIdSpan: getColumnIdSpan(bounds.width),
            rowNumbering: '1-based; row 1 is headers, data starts at row 2',
            headers: Array.from({ length: bounds.width }, (_, c) => {
              const columnId = getColumnIdForIndex(c);
              const h = s.cells[`${columnId}1`];
              return {
                columnId,
                headerCell: `${columnId}1`,
                header: h?.value ?? h?.raw ?? null,
              };
            }),
          };
        });
        return { ok: true, sheets };
      }

      case 'describeSheet': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const summary = summarizeSheet(sheet);
        const requestedColumnIds = Array.isArray(input.columnIds)
          ? input.columnIds
              .map(normalizeColumnId)
              .filter((columnId): columnId is string => !!columnId)
          : [];
        const requestedColumns = requestedColumnIds.map((columnId) => {
          const colIndex = colLetterToIndex(columnId);
          if (!columnExistsInBounds(columnId, summary.columnCount)) {
            return {
              columnId,
              exists: false,
              columnIdSpan: summary.columnIdSpan,
              message: `Column ${columnId} is outside occupied column span ${summary.columnIdSpan ?? '(empty)'}`,
            };
          }
          return {
            exists: true,
            ...describeColumn(sheet, colIndex, summary.rowCount),
          };
        });
        const sampleRows: Record<string, unknown>[] = [];
        const bounds = getSheetDataBounds(sheet);
        for (let r = 1; r < bounds.height && sampleRows.length < 5; r++) {
          const row: Record<string, unknown> = {};
          row.rowNumber = r + 1;
          let hasAny = false;
          for (let c = 0; c < bounds.width; c++) {
            const letter = getColumnIdForIndex(c);
            const cell = sheet.cells[getCellId(c, r)];
            const v = cell?.value ?? cell?.raw ?? null;
            if (v !== null && v !== '') hasAny = true;
            row[letter] = v;
          }
          if (hasAny) sampleRows.push(row);
        }
        return { ok: true, ...summary, requestedColumns, sampleRows };
      }

      case 'getSelection': {
        const sel = resolver.getSelection();
        return { ok: true, selection: sel, selectedCanvas: buildSelectedCanvasSummary(store) };
      }

      case 'getRange': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const r = parseRange(input.range);
        if (!r) return { ok: false, error: `Invalid range: ${input.range}` };
        const cells: Record<string, { raw: string; value: unknown }> = {};
        for (let row = r.startRow; row <= r.endRow; row++) {
          for (let col = r.startCol; col <= r.endCol; col++) {
            const id = getCellId(col, row);
            const cell = sheet.cells[id];
            if (cell) cells[id] = { raw: cell.raw, value: cell.value };
          }
        }
        return { ok: true, sheetId: sheet.id, range: input.range, cells };
      }

      case 'querySheet': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const schema = sheetTableSchema(sheet);
        try {
          const result = runSheetQuery(sheet, input.sql, input.limit ?? 200);
          return { ok: true, schema, ...result };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
            schema,
            sqlGuidance:
              'Use table "t" and the exact schema.sqlName values returned here; header-derived names may be compacted (for example hostname or sessionsource), not snake_case.',
          };
        }
      }

      case 'setCells': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        // Derived sheets (pivot/sparkline) recompute from their source; manual
        // cell writes would silently desync on the next source change.
        if (sheet.pivotConfig || sheet.sparklineConfig) {
          return {
            ok: false,
            error: `Sheet ${sheet.id} is a derived ${sheet.pivotConfig ? 'pivot' : 'sparkline'} table — write to its source sheet (${(sheet.pivotConfig ?? sheet.sparklineConfig)!.sourceSheetId}) instead.`,
          };
        }
        const updates: Record<string, CellData> = {};
        let maxCol = sheet.size.width - 1;
        let maxRow = sheet.size.height - 1;
        for (const [a1, payload] of Object.entries(input.cells as Record<string, { raw: string }>)) {
          const coord = parseCellId(a1);
          if (!coord) return { ok: false, error: `Invalid cell id: ${a1}` };
          maxCol = Math.max(maxCol, coord.col);
          maxRow = Math.max(maxRow, coord.row);
          const existing = sheet.cells[a1];
          // Leave value undefined so calc engine populates it (avoids string "42" for numerics).
          updates[a1] = { ...existing, raw: payload.raw, value: null } as CellData;
        }
        store.saveSnapshot();
        // Must merge with existing cells: updateSheet replaces the cells map wholesale,
        // so passing only the partial would wipe every untouched cell on the sheet.
        store.updateSheet(sheet.id, {
          cells: { ...sheet.cells, ...updates },
          size: { width: maxCol + 1, height: maxRow + 1 },
        });
        accumulateSheetFocus(useStore.getState().sheets[sheet.id] ?? sheet);
        return { ok: true, sheetId: sheet.id, updatedCount: Object.keys(updates).length };
      }

      case 'createSheet': {
        const createInput = input as { title?: string; data?: string[][] };
        const rows = createInput.data;

        if (rows && rows.length > 0) {
          const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
          const totalCells = rows.length * columnCount;
          if (totalCells > MAX_CREATE_SHEET_CELLS) {
            return {
              ok: false,
              error: `Too much data: ${rows.length} rows × ${columnCount} cols = ${totalCells} cells exceeds the ${MAX_CREATE_SHEET_CELLS}-cell limit for a single created sheet. Split the data or query it through a connector.`,
            };
          }

          const cells: Record<string, CellData> = {};
          rows.forEach((row, rowIndex) => {
            row.forEach((raw, colIndex) => {
              // Skip empty cells so the stored map stays sparse, matching how a
              // hand-filled sheet only persists cells the user actually typed.
              if (raw === '') return;
              const id = getCellId(colIndex, rowIndex);
              // Leave value null so the calc engine computes it (formulas resolve,
              // numeric literals become numbers instead of the string "42").
              cells[id] = { raw, value: null } as CellData;
            });
          });

          const newSheet: SheetData = {
            id: generateId(),
            title: createInput.title ?? 'New Sheet',
            position: placeOriginal(store),
            // Give the data room to breathe, like a normal spreadsheet: never
            // smaller than the default blank grid.
            size: {
              width: Math.max(columnCount, INITIAL_COLS),
              height: Math.max(rows.length, INITIAL_ROWS),
            },
            cells,
          };
          store.addSheet(newSheet);
          accumulateSheetFocus(useStore.getState().sheets[newSheet.id] ?? newSheet);
          return { ok: true, sheetId: newSheet.id, rowCount: rows.length, columnCount };
        }

        // No data → blank grid matching the app's own "New Sheet" button.
        const blankSheet: SheetData = {
          id: generateId(),
          title: createInput.title ?? 'New Sheet',
          position: placeOriginal(store),
          size: { width: INITIAL_COLS, height: INITIAL_ROWS },
          cells: {},
        };
        store.addSheet(blankSheet);
        accumulateSheetFocus(blankSheet);
        return { ok: true, sheetId: blankSheet.id, rowCount: 0, columnCount: 0 };
      }

      case 'applyFilter': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        // Tool schema sends value as an array; the runtime FilterCondition uses
        // scalar-or-tuple. Unwrap single-element arrays back to scalar.
        const filters: FilterCondition[] = (input.filters as any[]).map((f) => {
          const value = Array.isArray(f.value) && f.value.length === 1 ? f.value[0] : f.value;
          return { ...f, value, id: generateId() } as FilterCondition;
        });
        store.saveSnapshot();
        store.updateSheet(sheet.id, { filters });
        // `store` is a pre-update snapshot; safe here because applyFilter only
        // changes `filters`, never position/size — the bounding box is identical.
        accumulateSheetFocus(store.sheets[sheet.id] ?? sheet);
        return { ok: true, sheetId: sheet.id, filterCount: filters.length };
      }

      case 'applySort': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        store.saveSnapshot();
        store.updateSheet(sheet.id, { sort: (input.sort as SortConfig | null) ?? undefined });
        // `store` snapshot is safe: applySort only changes `sort`, never position/size.
        accumulateSheetFocus(store.sheets[sheet.id] ?? sheet);
        return { ok: true, sheetId: sheet.id, sort: input.sort };
      }

      case 'applyFormat': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const r = parseRange(input.range);
        if (!r) return { ok: false, error: `Invalid range: ${input.range}` };
        const formatted = applyFormatToSheet(sheet, input as ApplyFormatInput, r);
        store.saveSnapshot();
        store.updateSheet(sheet.id, { cells: formatted.cells, formatRules: formatted.formatRules });
        // `store` snapshot is safe: applyFormat only changes `cells`, never position/size.
        accumulateSheetFocus(store.sheets[sheet.id] ?? sheet);
        return {
          ok: true,
          sheetId: sheet.id,
          range: input.range,
          cellsFormatted: formatted.cellsFormatted,
          persistedOutputOverride: formatted.persistedOutputOverride,
          formatDecisions: formatted.formatDecisions,
        };
      }

      case 'createChart': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const chartInput = input as CreateChartInput;
        const chartMode = chartInput.mode ?? 'metrics';
        const groupCol = chartInput.groupCol ?? chartInput.labelColumn;
        const valueCol = chartInput.valueCol ?? chartInput.dataColumns[0];
        const operation = chartInput.operation ?? chartInput.aggregation ?? 'SUM';
        const bounds = getSheetDataBounds(sheet);
        if (!columnExistsInBounds(chartInput.labelColumn, bounds.width)) {
          return { ok: false, error: `labelColumn ${chartInput.labelColumn} not in sheet` };
        }
        for (const dc of chartInput.dataColumns) {
          if (!columnExistsInBounds(dc, bounds.width)) {
            return { ok: false, error: `dataColumn ${dc} not in sheet` };
          }
        }
        if (chartMode === 'group') {
          if (!columnExistsInBounds(groupCol, bounds.width)) {
            return { ok: false, error: `groupCol ${groupCol} not in sheet` };
          }
          if (!columnExistsInBounds(valueCol, bounds.width)) {
            return { ok: false, error: `valueCol ${valueCol} not in sheet` };
          }
          if (chartInput.seriesGroupCol && !columnExistsInBounds(chartInput.seriesGroupCol, bounds.width)) {
            return { ok: false, error: `seriesGroupCol ${chartInput.seriesGroupCol} not in sheet` };
          }
        }
        const validationError = validateChartAnalysisIntent(sheet, chartInput, bounds.height);
        if (validationError) return validationError;

        const labelSummary = summarizeChartLabels(sheet, chartMode === 'group' ? groupCol : chartInput.labelColumn, bounds.height);
        const colorSettings = readStoredChartColorSettings();
        const defaultPalette = getChartPalette(colorSettings, false);
        const seriesNameInputs =
          chartMode === 'group' && !chartInput.seriesGroupCol
            ? [{
                key: 'value_0',
                label: `${operation} of ${getCellDisplayValue(sheet.cells[`${valueCol}1`]) ?? valueCol}`,
              }]
            : chartInput.dataColumns.map(columnId => ({
                key: columnId,
                label: getCellDisplayValue(sheet.cells[`${columnId}1`]) ?? columnId,
              }));
        const seriesDisplayNames = buildChartSeriesDisplayNames(seriesNameInputs);

        // Smart visualization defaults (F-rules). Run the single-source-of-truth
        // engine to pick the chart form from the actual data shape. If the model
        // explicitly set seriesTypes/rightAxisColumns, respect its choice and
        // skip the auto-form; otherwise fill those fields (and correct an
        // ill-fitting bar/line base type) so the chart comes out well-formed.
        const modelSetForm =
          (chartInput.seriesTypes && Object.keys(chartInput.seriesTypes).length > 0) ||
          (chartInput.rightAxisColumns && chartInput.rightAxisColumns.length > 0);
        const formDecision = computeChartDefaults(sheet, {
          mode: chartMode,
          labelColumn: chartMode === 'group' ? groupCol : chartInput.labelColumn,
          dataColumns: chartInput.dataColumns,
          seriesGroupCol: chartMode === 'group' ? chartInput.seriesGroupCol : undefined,
          valueCol: chartMode === 'group' ? valueCol : undefined,
          requestedType: chartInput.type as ChartType,
        });
        const resolvedType = modelSetForm ? (chartInput.type as ChartType) : formDecision.type;
        const resolvedSeriesTypes = modelSetForm
          ? chartInput.seriesTypes
          : (Object.keys(formDecision.seriesTypes).length > 0 ? formDecision.seriesTypes : undefined);
        const resolvedRightAxis = modelSetForm
          ? chartInput.rightAxisColumns
          : (formDecision.rightAxisColumns.length > 0 ? formDecision.rightAxisColumns : undefined);

        const config: ChartConfig = {
          type: resolvedType,
          mode: chartMode,
          labelColumn: chartInput.labelColumn,
          dataColumns: chartInput.dataColumns,
          groupCol: chartMode === 'group' ? groupCol : undefined,
          seriesGroupCol: chartMode === 'group' ? chartInput.seriesGroupCol : undefined,
          valueCol: chartMode === 'group' ? valueCol : undefined,
          operation: chartMode === 'group' ? operation : undefined,
          timeGranularity: chartInput.timeGranularity,
          color: defaultPalette[0],
          colorScheme: 'workspace',
          colorOverride: false,
          highlightIndex: -1,
          animation: true,
          showLabels: chartInput.dataColumns.length === 1,
          seriesTypes: resolvedSeriesTypes,
          rightAxisColumns: resolvedRightAxis,
          seriesDisplayNames,
        };
        const chart: ChartData = {
          id: generateId(),
          sourceSheetId: sheet.id,
          position: placeDerivative(store, sheet.id),
          size: DEFAULT_CHART_SIZE,
          title: chartInput.title ?? `${sheet.title} chart`,
          config,
          setupRequired: false,
        };
        store.addChart(chart);
        accumulateChartFocus(chart);
        return {
          ok: true,
          chartId: chart.id,
          sheetId: sheet.id,
          resolvedColumns: {
            labelColumn: {
              columnId: chartInput.labelColumn,
              header: sheet.cells[`${chartInput.labelColumn}1`]?.value ?? sheet.cells[`${chartInput.labelColumn}1`]?.raw ?? null,
            },
            dataColumns: chartInput.dataColumns.map((columnId) => ({
              columnId,
              header: sheet.cells[`${columnId}1`]?.value ?? sheet.cells[`${columnId}1`]?.raw ?? null,
            })),
            groupCol: chartMode === 'group'
              ? {
                  columnId: groupCol,
                  header: sheet.cells[`${groupCol}1`]?.value ?? sheet.cells[`${groupCol}1`]?.raw ?? null,
                }
              : null,
            seriesGroupCol: chartMode === 'group' && chartInput.seriesGroupCol
              ? {
                  columnId: chartInput.seriesGroupCol,
                  header: sheet.cells[`${chartInput.seriesGroupCol}1`]?.value ?? sheet.cells[`${chartInput.seriesGroupCol}1`]?.raw ?? null,
                }
              : null,
            valueCol: chartMode === 'group'
              ? {
                  columnId: valueCol,
                  header: sheet.cells[`${valueCol}1`]?.value ?? sheet.cells[`${valueCol}1`]?.raw ?? null,
                }
              : null,
          },
          analysisIntent: {
            chartMode,
            timeRange: chartInput.timeRange ?? null,
            timeGranularity: chartInput.timeGranularity ?? null,
            aggregation: chartMode === 'group' ? operation : chartInput.aggregation ?? null,
            sourceGrain: chartInput.sourceGrain ?? null,
            analysisNotes: chartInput.analysisNotes ?? null,
          },
          formDecisions: {
            appliedType: resolvedType,
            usedSmartDefaults: !modelSetForm,
            firedRules: formDecision.firedRules,
            warnings: formDecision.warnings,
            rightAxisColumns: resolvedRightAxis ?? [],
            seriesTypes: resolvedSeriesTypes ?? {},
            topNSuggestion: formDecision.topN,
            horizontalRecommended: formDecision.horizontal,
          },
          labelSummary,
        };
      }

      case 'createNote': {
        const noteInput = input as { content: string; title?: string; color?: NoteColor };
        const trimmed = (noteInput.content ?? '').trim();
        if (!trimmed) return { ok: false, error: 'content is required' };

        const startsWithHeading = /^#{1,6}\s/.test(trimmed);
        const content = noteInput.title && !startsWithHeading
          ? `# ${noteInput.title}\n\n${trimmed}`
          : trimmed;

        const note: NoteData = {
          id: generateId(),
          position: placeNote(store),
          size: { ...DEFAULT_NOTE_SIZE },
          content,
          color: noteInput.color ?? 'yellow',
          format: 'markdown',
        };
        store.addNote(note);
        accumulateNoteFocus(note);
        return { ok: true, noteId: note.id };
      }

      case 'listNotes': {
        const notes = store.noteIds
          .map((id) => store.notes[id])
          .filter((n): n is NoteData => !!n)
          .map((n) => ({
            noteId: n.id,
            title: deriveNoteTitle(n.content),
            preview: deriveNotePreview(n.content),
            color: n.color,
            format: n.format ?? 'html',
          }));
        return { ok: true, notes };
      }

      case 'readNote': {
        const { noteId } = input as { noteId: string };
        const note = store.notes[noteId];
        if (!note) return { ok: false, error: `Unknown noteId: ${noteId}` };
        return {
          ok: true,
          noteId: note.id,
          title: deriveNoteTitle(note.content),
          content: note.content,
          color: note.color,
          format: note.format ?? 'html',
        };
      }

      case 'updateNote': {
        const upd = input as { noteId: string; content?: string; color?: NoteColor };
        const note = store.notes[upd.noteId];
        if (!note) return { ok: false, error: `Unknown noteId: ${upd.noteId}` };
        const updates: Partial<NoteData> = {};
        if (upd.content !== undefined) {
          const trimmed = upd.content.trim();
          if (!trimmed) return { ok: false, error: 'content cannot be empty' };
          updates.content = trimmed;
        }
        if (upd.color !== undefined) updates.color = upd.color;
        if (Object.keys(updates).length === 0) {
          return { ok: false, error: 'Provide at least one of content or color to update.' };
        }
        store.saveSnapshot();
        store.updateNote(note.id, updates);
        accumulateNoteFocus({ ...note, ...updates });
        return { ok: true, noteId: note.id };
      }

      case 'deleteNote': {
        const { noteId } = input as { noteId: string };
        if (!store.notes[noteId]) return { ok: false, error: `Unknown noteId: ${noteId}` };
        store.deleteNote(noteId);
        return { ok: true, noteId };
      }

      case 'createPivot': {
        const source = store.sheets[input.sheetId];
        if (!source) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const bounds = getSheetDataBounds(source);
        const colsInSource = (letter: string) => {
          return columnExistsInBounds(letter, bounds.width);
        };
        if (!colsInSource(input.rowLabelCol)) {
          return { ok: false, error: `rowLabelCol ${input.rowLabelCol} not in sheet` };
        }
        if (input.colLabelCol && !colsInSource(input.colLabelCol)) {
          return { ok: false, error: `colLabelCol ${input.colLabelCol} not in sheet` };
        }
        const pivotValues: PivotValue[] = (input.values as PivotValue[]).map(value => ({
          ...value,
          countRows: value.operation === 'COUNT' && (value.countRows || !value.column)
        }));
        for (const v of pivotValues) {
          if (!(v.operation === 'COUNT' && v.countRows) && (!v.column || !colsInSource(v.column))) {
            return { ok: false, error: `value column ${v.column ?? '(missing)'} not in sheet` };
          }
          for (const condition of v.conditions ?? []) {
            if (!colsInSource(condition.columnId)) {
              return { ok: false, error: `condition column ${condition.columnId} not in sheet` };
            }
          }
        }
        const config: PivotConfig = {
          sourceSheetId: source.id,
          rowLabelCol: input.rowLabelCol,
          colLabelCol: input.colLabelCol,
          values: pivotValues,
          showRowTotals: input.showRowTotals ?? true,
          showColTotals: input.showColTotals ?? true,
        };
        const newSheet: SheetData = {
          id: generateId(),
          title: input.title ?? `Pivot: ${source.title}`,
          position: placeDerivative(store, source.id),
          size: { width: 4, height: 15 },
          cells: {},
          pivotConfig: config,
          setupRequired: false,
        };
        store.addSheet(newSheet);
        accumulateSheetFocus(newSheet);
        return { ok: true, sheetId: newSheet.id, sourceSheetId: source.id };
      }

      case 'createSparkline': {
        const source = store.sheets[input.sheetId];
        if (!source) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const bounds = getSheetDataBounds(source);
        const colsInSource = (letter: string) => {
          return columnExistsInBounds(letter, bounds.width);
        };
        if (!colsInSource(input.dateCol)) {
          return { ok: false, error: `dateCol ${input.dateCol} not in sheet` };
        }
        if (input.mode === 'metrics') {
          for (const c of (input.dataCols as string[]) ?? []) {
            if (!colsInSource(c)) return { ok: false, error: `dataCol ${c} not in sheet` };
          }
        } else {
          if (!input.groupCol || !colsInSource(input.groupCol)) {
            return { ok: false, error: `groupCol ${input.groupCol} not in sheet` };
          }
          if (!input.valueCol || !colsInSource(input.valueCol)) {
            return { ok: false, error: `valueCol ${input.valueCol} not in sheet` };
          }
        }
        const sparkInput = input as typeof input & {
          summaryColumns?: SparklineConfig['summaryColumns'];
          goodDirections?: SparklineConfig['goodDirections'];
        };
        const config: SparklineConfig = {
          sourceSheetId: source.id,
          dateCol: input.dateCol,
          mode: input.mode,
          compareMode: input.compareMode ?? 'vs_avg',
          dataCols: input.mode === 'metrics' ? input.dataCols : undefined,
          groupCol: input.mode === 'group' ? input.groupCol : undefined,
          valueCol: input.mode === 'group' ? input.valueCol : undefined,
          operation: input.mode === 'group' ? input.operation : undefined,
          summaryColumns: sparkInput.summaryColumns,
          goodDirections: sparkInput.goodDirections,
        };
        const newSheet: SheetData = {
          id: generateId(),
          title: input.title ?? `Sparklines: ${source.title}`,
          position: placeDerivative(store, source.id),
          size: { width: 4, height: 16 },
          cells: {},
          sparklineConfig: config,
          setupRequired: false,
        };
        store.addSheet(newSheet);
        accumulateSheetFocus(newSheet);
        return { ok: true, sheetId: newSheet.id, sourceSheetId: source.id };
      }

      case 'listConnections': {
        const basicConnections = await loadConnections(store);
        const connections = await enrichConnectionsForMcp(store, basicConnections);
        return { ok: true, connections, selectedCanvas: buildSelectedCanvasSummary(store) };
      }

      case 'listConnectionProperties': {
        const { connectionId, pageSize, pageToken } = input as { connectionId: string; pageSize?: number; pageToken?: string };
        let connections = store.connections;
        if (!connections.length) {
          connections = await loadConnections(store);
        }
        const conn = connections.find((c) => c.connectionId === connectionId);
        if (!conn) return { ok: false, error: 'Connection not found: ' + connectionId };
        if (conn.type !== 'google-analytics') {
          return { ok: false, error: 'Properties are only supported for Google Analytics connections' };
        }
        const result = await listGoogleAnalyticsPropertiesPage({
          connectorId: connectionId,
          pageSize: Math.max(1, Math.min(pageSize ?? 50, 50)),
          pageToken,
        });
        return {
          ok: true,
          connectionId,
          type: 'google-analytics',
          properties: result.properties,
          nextPageToken: result.nextPageToken ?? null,
          truncated: !!result.truncated,
        };
      }

      case 'describeConnection': {
        const { connectionId, table, propertyId, search, limit, includeDescriptions } = input as {
          connectionId: string;
          table?: string;
          propertyId?: string;
          search?: string;
          limit?: number;
          includeDescriptions?: boolean;
        };
        let connections = store.connections;
        if (!connections.length) {
          connections = await loadConnections(store);
        }
        const conn = connections.find((c) => c.connectionId === connectionId);
        if (!conn) return { ok: false, error: 'Connection not found: ' + connectionId };
        // Provider-owned payload contract so the agent learns the exact queryPayload shape + examples.
        const queryShape = getConnectorQueryProvider(conn.type as ConnectorType)?.describeShape() ?? null;
        if (conn.type === 'clickhouse') {
          if (table) {
            const result = await describeClickhouseTable({ connectorId: connectionId, table });
            const schemaToken = makeSchemaToken();
            store.setConnectionSchemaToken(schemaToken, { connectionId, type: 'clickhouse', table, createdAt: Date.now() });
            return { ok: true, connectionId, type: 'clickhouse', table, schemaToken, queryShape, columns: result.columns };
          }
          const result = await getClickhouseSchema({ connectorId: connectionId });
          return { ok: true, connectionId, type: 'clickhouse', tables: result.tables, queryShape };
        }
        if (conn.type === 'google-analytics') {
          if (!propertyId) return { ok: false, error: 'propertyId is required for Google Analytics describeConnection' };
          const metadataCacheKey = connectionId + ':' + propertyId;
          const cached = store.gaMetadataCache[metadataCacheKey];
          const fullMetadata = cached ?? await getGoogleAnalyticsMetadata({ connectorId: connectionId, propertyId });
          if (!cached) store.setGaMetadata(metadataCacheKey, fullMetadata);
          const schemaToken = makeSchemaToken();
          store.setConnectionSchemaToken(schemaToken, { connectionId, type: 'google-analytics', propertyId, createdAt: Date.now() });
          const compactArgs = { search, limit, includeDescriptions };
          return {
            ok: true,
            connectionId,
            type: 'google-analytics',
            propertyId,
            schemaToken,
            queryShape,
            search: search ?? null,
            dimensions: compactGaMetadata(fullMetadata.dimensions, DEFAULT_GA_DIMENSIONS, compactArgs),
            metrics: compactGaMetadata(fullMetadata.metrics, DEFAULT_GA_METRICS, compactArgs),
            dimensionsTotal: fullMetadata.dimensions.length,
            metricsTotal: fullMetadata.metrics.length,
          };
        }
        if (conn.type === 'google-sheets') {
          const schemaToken = makeSchemaToken();
          store.setConnectionSchemaToken(schemaToken, { connectionId, type: 'google-sheets', createdAt: Date.now() });
          return {
            ok: true,
            connectionId,
            type: 'google-sheets',
            schemaToken,
            queryShape,
            spreadsheetIdOrUrlRequired: true,
            rangeOptional: true,
            defaultRange: DEFAULT_GOOGLE_SHEETS_RANGE,
            readOnly: true,
          };
        }
        return { ok: false, error: 'Unsupported connection type: ' + conn.type };
      }

      case 'createQuerySheet': {
        return handleCreateQuerySheet(store, input);
      }

      case 'queryConnection': {
        return handleQueryConnection(store, input);
      }

      case 'createQuerySheetFromResult': {
        return handleCreateQuerySheetFromResult(store, input);
      }

      case 'updateQuerySheet': {
        return handleUpdateQuerySheet(store, input);
      }

      case 'createGaTrendBySource': {
        return createGaTrendBySourceSheet({ input, store, generateId }) as Promise<ToolResult>;
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
