import { useStore } from '../../store';
import { computeDateAnchors } from '../../utils/dates';
import { getCellId } from '../../utils/formulas';
import type { SelectionContext } from '../../types';

export function buildAgentContextLine(
  selection: SelectionContext,
  options: { attachSelection?: boolean } = {},
): string {
  const { attachSelection = true } = options;
  const state = useStore.getState();
  const sheets = state.sheetIds.map((id) => {
    const s = state.sheets[id];
    const headers: string[] = [];
    for (let c = 0; c < s.size.width; c++) {
      const cell = s.cells[getCellId(c, 0)];
      const letter = getCellId(c, 0).replace(/\d+$/, '');
      const header = cell?.value ?? cell?.raw ?? '';
      headers.push(`${letter}=${String(header).slice(0, 24)}`);
    }
    return {
      sheetId: s.id,
      title: s.title,
      rowsCols: `${s.size.height}x${s.size.width}`,
      headers,
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
