import type { CellFormat, SheetData, SheetFormatRule } from '../../types';
import { formatCellsInRange, type ParsedA1Range, upsertFormatRule } from '../../utils/formatRules';
import { getColumnIdForIndex } from './sheetBounds';

type FormatPresetInput = {
  preset: 'integer' | 'decimal' | 'compactNumber' | 'currency' | 'compactCurrency' | 'percent' | 'date' | 'datetime' | 'duration' | 'text' | 'customD3';
  decimals?: number;
  symbol?: string;
  d3Format?: string;
  dateFormat?: string;
  visual?: CellFormat['visual'];
  heatmapColor?: CellFormat['heatmapColor'];
  heatmapFlip?: CellFormat['heatmapFlip'];
};

export type ApplyFormatInput = {
  sheetId: string;
  range: string;
  format?: CellFormat;
  preset?: FormatPresetInput;
  reason?: string;
};

function resolvePresetFormat(presetInput: FormatPresetInput): CellFormat {
  const visualProps = {
    visual: presetInput.visual,
    heatmapColor: presetInput.heatmapColor,
    heatmapFlip: presetInput.heatmapFlip,
  };

  switch (presetInput.preset) {
    case 'integer':
      return { type: 'number', decimals: presetInput.decimals ?? 0, ...visualProps };
    case 'decimal':
      return { type: 'number', decimals: presetInput.decimals ?? 2, ...visualProps };
    case 'compactNumber':
      return { type: 'number', d3Format: presetInput.d3Format ?? '.2s', ...visualProps };
    case 'currency':
      return { type: 'currency', symbol: presetInput.symbol ?? '$', decimals: presetInput.decimals ?? 2, ...visualProps };
    case 'compactCurrency':
      return { type: 'currency', symbol: presetInput.symbol ?? '$', d3Format: presetInput.d3Format ?? '$.2s', ...visualProps };
    case 'percent':
      return { type: 'percent', decimals: presetInput.decimals ?? 1, ...visualProps };
    case 'date':
      return { type: 'date', dateFormat: presetInput.dateFormat ?? 'YYYY-MM-DD', ...visualProps };
    case 'datetime':
      return { type: 'date', dateFormat: presetInput.dateFormat ?? 'Full', ...visualProps };
    case 'duration':
      return { type: 'number', d3Format: presetInput.d3Format ?? ',.2f', ...visualProps };
    case 'text':
      return { type: 'text', ...visualProps };
    case 'customD3':
      return { type: 'number', d3Format: presetInput.d3Format ?? '', ...visualProps };
    default:
      return { type: 'text', ...visualProps };
  }
}

function resolveApplyFormat(input: ApplyFormatInput): { format: CellFormat; preset: string | null } {
  if (input.preset) {
    return { format: resolvePresetFormat(input.preset), preset: input.preset.preset };
  }
  return { format: input.format as CellFormat, preset: null };
}

export function applyFormatToSheet(sheet: SheetData, input: ApplyFormatInput, range: ParsedA1Range) {
  const { format, preset } = resolveApplyFormat(input);
  const formatted = formatCellsInRange(sheet.cells, range, format, { includeMissingCells: true });
  const isDerivedSheet = !!(sheet.pivotConfig || sheet.sparklineConfig);
  const reason = input.reason ?? (preset ? `applied ${preset} presentation preset` : 'explicit presentation format');
  const formatRule: SheetFormatRule = {
    range: input.range,
    format,
    reason,
    createdBy: 'mcp',
  };
  const formatRules = isDerivedSheet
    ? upsertFormatRule(sheet.formatRules, formatRule)
    : sheet.formatRules;
  const formatDecisions = Array.from({ length: range.endCol - range.startCol + 1 }, (_, offset) => {
    const columnIndex = range.startCol + offset;
    const columnId = getColumnIdForIndex(columnIndex);
    return {
      sheetId: sheet.id,
      range: input.range,
      columnId,
      header: sheet.cells[`${columnId}1`]?.value ?? sheet.cells[`${columnId}1`]?.raw ?? null,
      preset,
      format,
      visual: format.visual ?? null,
      persistedOutputOverride: isDerivedSheet,
      reason,
    };
  });

  return {
    cells: formatted.cells,
    cellsFormatted: formatted.formattedCellIds.length,
    formatRules,
    formatDecisions,
    persistedOutputOverride: isDerivedSheet,
  };
}
