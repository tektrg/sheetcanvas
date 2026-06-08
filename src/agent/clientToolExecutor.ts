import { useStore } from '../../store';
import type { CellData, CellFormat, ChartData, ChartConfig, SheetData, FilterCondition, SortConfig, SelectionContext, ChartType, PivotConfig, PivotValue, SparklineConfig, ConnectorConfig } from '../../types';
import { parseCellId, getCellId } from '../../utils/formulas';
import { CELL_WIDTH, DEFAULT_CHART_SIZE, MAX_CONNECTED_IMPORT_COLS } from '../../constants';
import { runSheetQuery, sheetTableSchema } from './alasqlAdapter';
import { requestJson } from '../../utils/backendApi';
import { clickhouseResultToMatrix, queryClickhouse, getClickhouseSchema, describeClickhouseTable } from '../../utils/clickhouseBackend';
import { googleAnalyticsResultToMatrix, queryGoogleAnalytics, getGoogleAnalyticsMetadata, listGoogleAnalyticsPropertiesPage, type GoogleAnalyticsMetadataItem } from '../../utils/googleAnalyticsBackend';
import { DEFAULT_GOOGLE_SHEETS_RANGE, googleSheetsResultToMatrix, queryGoogleSheets } from '../../utils/googleSheetsBackend';
import { applyMatrixToSheet } from '../../utils/connectorSheet';
import { getChartPalette, readStoredChartColorSettings } from '../../utils/chartColorSchemes';
import { getColumnIdForIndex, getColumnIdSpan, getSheetDataBounds } from './sheetBounds';

const generateId = () => Math.random().toString(36).slice(2, 11);

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
  | { ok: false; error: string };

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
          derivation: sheet.connectorConfig.derivation ?? null,
          lastError: sheet.connectorConfig.lastError ?? null,
          lastRefreshedAt: sheet.connectorConfig.lastRefreshedAt ?? null,
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
        return { ok: true, selection: sel };
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
        const result = runSheetQuery(sheet, input.sql, input.limit ?? 200);
        return { ok: true, schema, ...result };
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
        return { ok: true, sheetId: sheet.id, updatedCount: Object.keys(updates).length };
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
        return { ok: true, sheetId: sheet.id, filterCount: filters.length };
      }

      case 'applySort': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        store.saveSnapshot();
        store.updateSheet(sheet.id, { sort: (input.sort as SortConfig | null) ?? undefined });
        return { ok: true, sheetId: sheet.id, sort: input.sort };
      }

      case 'applyFormat': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        if (sheet.pivotConfig || sheet.sparklineConfig) {
          return {
            ok: false,
            error: `Sheet ${sheet.id} is a derived ${sheet.pivotConfig ? 'pivot' : 'sparkline'} table — format its source sheet (${(sheet.pivotConfig ?? sheet.sparklineConfig)!.sourceSheetId}) instead.`,
          };
        }
        const r = parseRange(input.range);
        if (!r) return { ok: false, error: `Invalid range: ${input.range}` };
        const format = input.format as CellFormat;
        const updates: Record<string, CellData> = {};
        for (let row = r.startRow; row <= r.endRow; row++) {
          for (let col = r.startCol; col <= r.endCol; col++) {
            const id = getCellId(col, row);
            const existing = sheet.cells[id] ?? { raw: '', value: null };
            updates[id] = { ...existing, format };
          }
        }
        store.saveSnapshot();
        // Merge to preserve every other cell on the sheet.
        store.updateSheet(sheet.id, { cells: { ...sheet.cells, ...updates } });
        return { ok: true, sheetId: sheet.id, range: input.range, cellsFormatted: Object.keys(updates).length };
      }

      case 'createChart': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const bounds = getSheetDataBounds(sheet);
        if (!columnExistsInBounds(input.labelColumn, bounds.width)) {
          return { ok: false, error: `labelColumn ${input.labelColumn} not in sheet` };
        }
        for (const dc of input.dataColumns as string[]) {
          if (!columnExistsInBounds(dc, bounds.width)) {
            return { ok: false, error: `dataColumn ${dc} not in sheet` };
          }
        }
        const colorSettings = readStoredChartColorSettings();
        const defaultPalette = getChartPalette(colorSettings, false);
        const config: ChartConfig = {
          type: input.type as ChartType,
          mode: 'metrics',
          labelColumn: input.labelColumn,
          dataColumns: input.dataColumns,
          color: defaultPalette[0],
          colorScheme: 'workspace',
          colorOverride: false,
          highlightIndex: -1,
          animation: true,
          showLabels: true,
        };
        const chart: ChartData = {
          id: generateId(),
          sourceSheetId: sheet.id,
          position: {
            x: sheet.position.x + sheet.size.width * CELL_WIDTH + 50,
            y: sheet.position.y,
          },
          size: DEFAULT_CHART_SIZE,
          title: input.title ?? `${sheet.title} chart`,
          config,
          setupRequired: false,
        };
        store.addChart(chart);
        return { ok: true, chartId: chart.id, sheetId: sheet.id };
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
          position: {
            x: source.position.x + source.size.width * CELL_WIDTH + 60,
            y: source.position.y,
          },
          size: { width: 4, height: 15 },
          cells: {},
          pivotConfig: config,
          setupRequired: false,
        };
        store.addSheet(newSheet);
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
        const config: SparklineConfig = {
          sourceSheetId: source.id,
          dateCol: input.dateCol,
          mode: input.mode,
          compareMode: input.compareMode ?? 'vs_avg',
          dataCols: input.mode === 'metrics' ? input.dataCols : undefined,
          groupCol: input.mode === 'group' ? input.groupCol : undefined,
          valueCol: input.mode === 'group' ? input.valueCol : undefined,
          operation: input.mode === 'group' ? input.operation : undefined,
        };
        const newSheet: SheetData = {
          id: generateId(),
          title: input.title ?? `Sparklines: ${source.title}`,
          position: {
            x: source.position.x + source.size.width * CELL_WIDTH + 60,
            y: source.position.y + 100,
          },
          size: { width: 4, height: 16 },
          cells: {},
          sparklineConfig: config,
          setupRequired: false,
        };
        store.addSheet(newSheet);
        return { ok: true, sheetId: newSheet.id, sourceSheetId: source.id };
      }

      case 'listConnections': {
        const res = await requestJson<{ connectors: Array<{ id: string; type: string; name: string }> }>('/api/connectors');
        const connections = (res.connectors || []).map((c) => ({ connectionId: c.id, type: c.type, name: c.name }));
        store.setConnections(connections);
        return { ok: true, connections };
      }

      case 'listConnectionProperties': {
        const { connectionId, pageSize, pageToken } = input as { connectionId: string; pageSize?: number; pageToken?: string };
        let connections = store.connections;
        if (!connections.length) {
          const res = await requestJson<{ connectors: Array<{ id: string; type: string; name: string }> }>('/api/connectors');
          connections = (res.connectors || []).map((c) => ({ connectionId: c.id, type: c.type, name: c.name }));
          store.setConnections(connections);
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
          const res = await requestJson<{ connectors: Array<{ id: string; type: string; name: string }> }>('/api/connectors');
          connections = (res.connectors || []).map((c) => ({ connectionId: c.id, type: c.type, name: c.name }));
          store.setConnections(connections);
        }
        const conn = connections.find((c) => c.connectionId === connectionId);
        if (!conn) return { ok: false, error: 'Connection not found: ' + connectionId };
        if (conn.type === 'clickhouse') {
          if (table) {
            const result = await describeClickhouseTable({ connectorId: connectionId, table });
            const schemaToken = makeSchemaToken();
            store.setConnectionSchemaToken(schemaToken, { connectionId, type: 'clickhouse', table, createdAt: Date.now() });
            return { ok: true, connectionId, type: 'clickhouse', table, schemaToken, columns: result.columns };
          }
          const result = await getClickhouseSchema({ connectorId: connectionId });
          return { ok: true, connectionId, type: 'clickhouse', tables: result.tables };
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
            spreadsheetIdOrUrlRequired: true,
            rangeOptional: true,
            defaultRange: DEFAULT_GOOGLE_SHEETS_RANGE,
            readOnly: true,
          };
        }
        return { ok: false, error: 'Unsupported connection type: ' + conn.type };
      }

      case 'createQuerySheet': {
        const { connectionId, schemaToken, type: connType, sql, propertyId, report, spreadsheetIdOrUrl, range, derivation, title } = input as {
          connectionId: string;
          schemaToken: string;
          type: 'clickhouse' | 'google-analytics' | 'google-sheets';
          sql?: string;
          propertyId?: string;
          report?: Record<string, unknown>;
          spreadsheetIdOrUrl?: string;
          range?: string;
          derivation: string;
          title?: string;
        };
        const tokenScope = store.connectionSchemaTokens[schemaToken];
        if (!tokenScope) return { ok: false, error: 'Run describeConnection first and pass its schemaToken' };
        if (tokenScope.connectionId !== connectionId || tokenScope.type !== connType) {
          return { ok: false, error: 'schemaToken does not match the requested connection/type' };
        }
        if (connType === 'google-analytics' && tokenScope.propertyId !== propertyId) {
          return { ok: false, error: 'schemaToken does not match the requested Google Analytics property' };
        }
        let matrix: string[][];
        let sheetTitle: string;
        let sourceTruncated = false;
        if (connType === 'clickhouse') {
          if (!sql) return { ok: false, error: 'sql is required for ClickHouse queries' };
          const result = await queryClickhouse({ connectorId: connectionId, sql });
          matrix = clickhouseResultToMatrix(result);
          sourceTruncated = !!result.truncated;
          sheetTitle = title ?? 'ClickHouse Query';
        } else if (connType === 'google-analytics') {
          if (!propertyId) return { ok: false, error: 'propertyId is required for Google Analytics queries' };
          const result = await queryGoogleAnalytics({ connectorId: connectionId, propertyId, report: report as any });
          matrix = googleAnalyticsResultToMatrix(result);
          sourceTruncated = !!result.truncated;
          sheetTitle = title ?? ('Analytics: ' + propertyId);
        } else if (connType === 'google-sheets') {
          if (!spreadsheetIdOrUrl) return { ok: false, error: 'spreadsheetIdOrUrl is required for Google Sheets queries' };
          const result = await queryGoogleSheets({ connectorId: connectionId, spreadsheetIdOrUrl, range });
          matrix = googleSheetsResultToMatrix(result);
          sourceTruncated = !!result.truncated;
          sheetTitle = title ?? 'Google Sheets';
        } else {
          return { ok: false, error: 'Unsupported connection type: ' + connType };
        }
        if (matrix.length < 2) {
          return {
            ok: false,
            error: 'Query returned no data rows. No sheet or chart was created; explain the empty result and stop.',
          };
        }
        const applied = applyMatrixToSheet(matrix);
        const position = store.getNextSheetPosition();
        const connectorConfig: ConnectorConfig = {
          type: connType,
          name: sheetTitle,
          connectionId,
          query:
            connType === 'clickhouse'
              ? { sql: sql! }
              : connType === 'google-analytics'
                ? { propertyId: propertyId!, report: (report ?? {}) as any }
                : { spreadsheetIdOrUrl: spreadsheetIdOrUrl!, range: range || DEFAULT_GOOGLE_SHEETS_RANGE },
          derivation,
          lastRefreshedAt: Date.now(),
          truncated: sourceTruncated || applied.truncated,
          lastError: '',
        };
        const newSheet: SheetData = {
          id: generateId(),
          title: sheetTitle,
          position,
          size: applied.size,
          cells: applied.cells,
          connectorConfig,
          setupRequired: false,
        };
        store.addSheet(newSheet);
        const importedHeaders = matrix[0].slice(0, MAX_CONNECTED_IMPORT_COLS);
        const headers = importedHeaders.map((h, i) => ({
          columnId: getCellId(i, 0).replace(/\d+$/, ''),
          header: h,
        }));
        const inferredTypes = importedHeaders.map((_, i) => {
          const s = matrix[1]?.[i] ?? '';
          if (s !== '' && !isNaN(Number(s))) return 'number';
          if (/\d{4}-\d{2}-\d{2}/.test(s) && !isNaN(Date.parse(s))) return 'date';
          return 'text';
        });
        return {
          ok: true,
          sheetId: newSheet.id,
          title: sheetTitle,
          rowCount: matrix.length - 1,
          headers,
          inferredTypes,
          derivation,
          truncated: applied.truncated,
        };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
