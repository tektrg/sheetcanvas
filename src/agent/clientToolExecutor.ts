import { useStore } from '../../store';
import type { CellData, CellFormat, ChartData, ChartConfig, SheetData, FilterCondition, SortConfig, SelectionContext, ChartType, PivotConfig, SparklineConfig } from '../../types';
import { parseCellId, getCellId } from '../../utils/formulas';
import { CELL_WIDTH, DEFAULT_CHART_SIZE, ACCENT_COLOR } from '../../constants';
import { runSheetQuery, sheetTableSchema } from './alasqlAdapter';

const generateId = () => Math.random().toString(36).slice(2, 11);

export type ToolResult =
  | { ok: true; [k: string]: unknown }
  | { ok: false; error: string };

export interface SelectionResolver {
  getSelection: () => SelectionContext;
}

function describeColumn(sheet: SheetData, colIndex: number) {
  const letter = getCellId(colIndex, 0).replace(/\d+$/, '');
  const header = sheet.cells[getCellId(colIndex, 0)];
  const samples: unknown[] = [];
  for (let r = 1; r < sheet.size.height && samples.length < 3; r++) {
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
    header: header?.value ?? header?.raw ?? null,
    inferredType,
    samples,
  };
}

function summarizeSheet(sheet: SheetData) {
  const columns: ReturnType<typeof describeColumn>[] = [];
  for (let c = 0; c < sheet.size.width; c++) columns.push(describeColumn(sheet, c));
  return {
    sheetId: sheet.id,
    title: sheet.title,
    rowCount: sheet.size.height,
    columnCount: sheet.size.width,
    columns,
    filters: sheet.filters ?? [],
    sort: sheet.sort ?? null,
    connector: sheet.connectorConfig
      ? { type: sheet.connectorConfig.type, name: sheet.connectorConfig.name }
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
          return {
            sheetId: s.id,
            title: s.title,
            rowCount: s.size.height,
            columnCount: s.size.width,
            headers: Array.from({ length: s.size.width }, (_, c) => {
              const h = s.cells[getCellId(c, 0)];
              return { columnId: getCellId(c, 0).replace(/\d+$/, ''), header: h?.value ?? h?.raw ?? null };
            }),
          };
        });
        return { ok: true, sheets };
      }

      case 'describeSheet': {
        const sheet = store.sheets[input.sheetId];
        if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
        const summary = summarizeSheet(sheet);
        const sampleRows: Record<string, unknown>[] = [];
        for (let r = 1; r < sheet.size.height && sampleRows.length < 5; r++) {
          const row: Record<string, unknown> = {};
          let hasAny = false;
          for (let c = 0; c < sheet.size.width; c++) {
            const letter = getCellId(c, 0).replace(/\d+$/, '');
            const cell = sheet.cells[getCellId(c, r)];
            const v = cell?.value ?? cell?.raw ?? null;
            if (v !== null && v !== '') hasAny = true;
            row[letter] = v;
          }
          if (hasAny) sampleRows.push(row);
        }
        return { ok: true, ...summary, sampleRows };
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
        const labelColIdx = colLetterToIndex(input.labelColumn);
        if (labelColIdx < 0 || labelColIdx >= sheet.size.width) {
          return { ok: false, error: `labelColumn ${input.labelColumn} not in sheet` };
        }
        for (const dc of input.dataColumns as string[]) {
          const idx = colLetterToIndex(dc);
          if (idx < 0 || idx >= sheet.size.width) {
            return { ok: false, error: `dataColumn ${dc} not in sheet` };
          }
        }
        const config: ChartConfig = {
          type: input.type as ChartType,
          mode: 'metrics',
          labelColumn: input.labelColumn,
          dataColumns: input.dataColumns,
          color: ACCENT_COLOR,
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
        const colsInSource = (letter: string) => {
          const idx = colLetterToIndex(letter);
          return idx >= 0 && idx < source.size.width;
        };
        if (!colsInSource(input.rowLabelCol)) {
          return { ok: false, error: `rowLabelCol ${input.rowLabelCol} not in sheet` };
        }
        if (input.colLabelCol && !colsInSource(input.colLabelCol)) {
          return { ok: false, error: `colLabelCol ${input.colLabelCol} not in sheet` };
        }
        for (const v of input.values as { column: string; operation: string }[]) {
          if (!colsInSource(v.column)) {
            return { ok: false, error: `value column ${v.column} not in sheet` };
          }
        }
        const config: PivotConfig = {
          sourceSheetId: source.id,
          rowLabelCol: input.rowLabelCol,
          colLabelCol: input.colLabelCol,
          values: input.values,
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
        const colsInSource = (letter: string) => {
          const idx = colLetterToIndex(letter);
          return idx >= 0 && idx < source.size.width;
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

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
