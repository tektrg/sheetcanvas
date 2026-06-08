import { useStore } from '../../store';
import { computeDateAnchors } from '../../utils/dates';
import type { SelectionContext } from '../../types';
import { getColumnIdForIndex, getColumnIdSpan, getSheetDataBounds } from './sheetBounds';

export function buildAgentContextLine(
  selection: SelectionContext,
  options: { attachSelection?: boolean } = {},
): string {
  const { attachSelection = true } = options;
  const state = useStore.getState();
  const sheets = state.sheetIds.map((id) => {
    const s = state.sheets[id];
    const bounds = getSheetDataBounds(s);
    const headers: string[] = [];
    const columns: Array<{ columnId: string; headerCell: string; header: string }> = [];
    for (let c = 0; c < bounds.width; c++) {
      const letter = getColumnIdForIndex(c);
      const cell = s.cells[`${letter}1`];
      const header = cell?.value ?? cell?.raw ?? '';
      headers.push(`${letter}=${String(header).slice(0, 24)}`);
      columns.push({
        columnId: letter,
        headerCell: `${letter}1`,
        header: String(header).slice(0, 32),
      });
    }
    return {
      sheetId: s.id,
      title: s.title,
      rowsCols: `${bounds.height}x${bounds.width}`,
      columnIdSpan: getColumnIdSpan(bounds.width),
      rowNumbering: '1-based; row 1 is headers, data starts at row 2',
      headers,
      columns,
      hasFilters: (s.filters?.length ?? 0) > 0,
      hasSort: !!s.sort,
    };
  });
  const nowStr = new Date().toISOString();
  const dateAnchors = computeDateAnchors(nowStr);
  return JSON.stringify({
    sheets,
    selection: attachSelection ? selection : null,
    now: nowStr,
    dateAnchors,
  });
}
