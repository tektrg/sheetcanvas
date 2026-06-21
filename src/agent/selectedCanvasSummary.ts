import type { AppState } from '../../store';
import type { ChartData, NoteData, SheetData } from '../../types';
import { getColumnIdForIndex, getColumnIdSpan, getSheetDataBounds } from './sheetBounds';

const MAX_SELECTED_HEADERS = 60;
const NOTE_PREVIEW_MAX_LENGTH = 160;

type SelectedCanvasSheet = {
  type: 'sheet';
  sheetId: string;
  title: string;
  rowCount: number;
  columnCount: number;
  columnIdSpan: string | null;
  rowNumbering: string;
  headers: Array<{ columnId: string; headerCell: string; header: unknown }>;
  headersTruncated: boolean;
  hasFilters: boolean;
  hasSort: boolean;
  connector: {
    type: string;
    name: string;
    connectionId: string | null;
    derivation: string | null;
    truncated: boolean | null;
    lastError: string | null;
    lastRefreshedAt: number | null;
  } | null;
  pivot: {
    sourceSheetId: string;
    rowLabelCol: string;
    colLabelCol: string | null;
    valuesCount: number;
    showRowTotals: boolean | null;
    showColTotals: boolean | null;
  } | null;
  sparkline: {
    sourceSheetId: string;
    dateCol: string;
    mode: string;
    compareMode: string | null;
    dataCols: string[] | null;
    groupCol: string | null;
    valueCol: string | null;
    operation: string | null;
  } | null;
};

type SelectedCanvasChart = {
  type: 'chart';
  chartId: string;
  title: string;
  sourceSheetId: string;
  sourceSheetTitle: string | null;
  chartType: ChartData['config']['type'];
  mode: ChartData['config']['mode'] | null;
  labelColumn: string;
  dataColumns: string[];
  groupCol: string | null;
  seriesGroupCol: string | null;
  valueCol: string | null;
  aggregation: string | null;
  timeGranularity: string | null;
  stacked: boolean | null;
  rightAxisColumns: string[] | null;
  seriesTypes: Record<string, string> | null;
};

type SelectedCanvasNote = {
  type: 'note';
  noteId: string;
  preview: string;
};

export type SelectedCanvasItem = SelectedCanvasSheet | SelectedCanvasChart | SelectedCanvasNote;

export type SelectedCanvasSummary = {
  items: SelectedCanvasItem[];
};

type CanvasStateForSelection = Pick<
  AppState,
  'selectedIds' | 'sheets' | 'charts' | 'notes'
>;

function summarizeSelectedSheet(sheet: SheetData): SelectedCanvasSheet {
  const bounds = getSheetDataBounds(sheet);
  const headerCount = Math.min(bounds.width, MAX_SELECTED_HEADERS);
  const headers = Array.from({ length: headerCount }, (_, colIndex) => {
    const columnId = getColumnIdForIndex(colIndex);
    const headerCell = `${columnId}1`;
    const header = sheet.cells[headerCell];
    return {
      columnId,
      headerCell,
      header: header?.value ?? header?.raw ?? null,
    };
  });

  return {
    type: 'sheet',
    sheetId: sheet.id,
    title: sheet.title,
    rowCount: bounds.height,
    columnCount: bounds.width,
    columnIdSpan: getColumnIdSpan(bounds.width),
    rowNumbering: '1-based; row 1 is headers, data starts at row 2',
    headers,
    headersTruncated: bounds.width > MAX_SELECTED_HEADERS,
    hasFilters: (sheet.filters?.length ?? 0) > 0,
    hasSort: !!sheet.sort,
    connector: sheet.connectorConfig
      ? {
          type: sheet.connectorConfig.type,
          name: sheet.connectorConfig.name,
          connectionId: sheet.connectorConfig.connectionId ?? null,
          derivation: sheet.connectorConfig.derivation ?? null,
          brief: sheet.connectorConfig.brief ?? null,
          truncated: sheet.connectorConfig.truncated ?? null,
          lastError: sheet.connectorConfig.lastError ?? null,
          lastRefreshedAt: sheet.connectorConfig.lastRefreshedAt ?? null,
        }
      : null,
    pivot: sheet.pivotConfig
      ? {
          sourceSheetId: sheet.pivotConfig.sourceSheetId,
          rowLabelCol: sheet.pivotConfig.rowLabelCol,
          colLabelCol: sheet.pivotConfig.colLabelCol ?? null,
          valuesCount: sheet.pivotConfig.values.length,
          showRowTotals: sheet.pivotConfig.showRowTotals ?? null,
          showColTotals: sheet.pivotConfig.showColTotals ?? null,
        }
      : null,
    sparkline: sheet.sparklineConfig
      ? {
          sourceSheetId: sheet.sparklineConfig.sourceSheetId,
          dateCol: sheet.sparklineConfig.dateCol,
          mode: sheet.sparklineConfig.mode,
          compareMode: sheet.sparklineConfig.compareMode ?? null,
          dataCols: sheet.sparklineConfig.dataCols ?? null,
          groupCol: sheet.sparklineConfig.groupCol ?? null,
          valueCol: sheet.sparklineConfig.valueCol ?? null,
          operation: sheet.sparklineConfig.operation ?? null,
        }
      : null,
  };
}

function summarizeSelectedChart(
  chart: ChartData,
  sheets: CanvasStateForSelection['sheets'],
): SelectedCanvasChart {
  const sourceSheet = sheets[chart.sourceSheetId];
  return {
    type: 'chart',
    chartId: chart.id,
    title: chart.title,
    sourceSheetId: chart.sourceSheetId,
    sourceSheetTitle: sourceSheet?.title ?? null,
    chartType: chart.config.type,
    mode: chart.config.mode ?? null,
    labelColumn: chart.config.labelColumn,
    dataColumns: chart.config.dataColumns,
    groupCol: chart.config.groupCol ?? null,
    seriesGroupCol: chart.config.seriesGroupCol ?? null,
    valueCol: chart.config.valueCol ?? null,
    aggregation: chart.config.operation ?? null,
    timeGranularity: chart.config.timeGranularity ?? null,
    stacked: chart.config.stacked ?? null,
    rightAxisColumns: chart.config.rightAxisColumns ?? null,
    seriesTypes: chart.config.seriesTypes ?? null,
  };
}

function summarizeSelectedNote(note: NoteData): SelectedCanvasNote {
  return {
    type: 'note',
    noteId: note.id,
    preview: note.content.slice(0, NOTE_PREVIEW_MAX_LENGTH),
  };
}

export function buildSelectedCanvasSummary(
  state: CanvasStateForSelection,
): SelectedCanvasSummary {
  const items = Array.from(state.selectedIds).flatMap((selectedId): SelectedCanvasItem[] => {
    const sheet = state.sheets[selectedId];
    if (sheet) return [summarizeSelectedSheet(sheet)];

    const chart = state.charts[selectedId];
    if (chart) return [summarizeSelectedChart(chart, state.sheets)];

    const note = state.notes[selectedId];
    if (note) return [summarizeSelectedNote(note)];

    return [];
  });

  return { items };
}
