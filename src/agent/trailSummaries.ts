/**
 * Turns a tool call (name + input + result) into a short, human-readable line for the agent
 * activity trail — e.g. "Wrote 12 cells to Monthly Budget". Field names below were read
 * directly off each tool's actual return shape in clientToolExecutor.ts / querySheetTools.ts,
 * not guessed.
 *
 * Sheet/chart titles are resolved from the live store at call time (finish time), so a later
 * rename doesn't retroactively change what an earlier trail line says the agent touched.
 */

import type { ToolName } from '../../agent/tools';
import type { ToolResult } from './clientToolExecutor';
import { useStore } from '../../store';

type Summarizer = (input: any, result: ToolResult) => string;

const MAX_SUMMARY_LENGTH = 90;

function truncate(text: string): string {
  return text.length <= MAX_SUMMARY_LENGTH ? text : `${text.slice(0, MAX_SUMMARY_LENGTH - 1)}…`;
}

function isOk(result: ToolResult): boolean {
  return !!result && typeof result === 'object' && (result as { ok?: boolean }).ok === true;
}

function sheetTitle(sheetId: string | undefined | null, fallback = 'a sheet'): string {
  if (!sheetId) return fallback;
  return useStore.getState().sheets[sheetId]?.title ?? fallback;
}

function chartTitle(chartId: string | undefined | null, fallback = 'a chart'): string {
  if (!chartId) return fallback;
  return useStore.getState().charts[chartId]?.title ?? fallback;
}

// Every delete* action in store.ts calls saveSnapshot() BEFORE removing the object (see
// store.ts deleteNote/deleteSheet/deleteChart), so the snapshot it just pushed still has the
// pre-delete object even though live state no longer does. By the time this tool's onFinish
// fires, that snapshot is the newest entry in history — this is how "Deleted note 'X'" can
// name what was deleted instead of just echoing its id back.
function titleFromLastSnapshot(
  kind: 'notes' | 'sheets' | 'charts',
  id: string | undefined | null,
  deriveTitle: (obj: any) => string,
  fallback: string,
): string {
  if (!id) return fallback;
  const history = useStore.getState().history;
  const last = history[history.length - 1];
  const obj = (last as any)?.[kind]?.[id];
  return obj ? deriveTitle(obj) : fallback;
}

// Mirrors clientToolExecutor.ts's local (unexported) deriveNoteTitle: first heading text, else
// first non-empty line.
function deriveNoteTitleForSummary(note: { content?: string }): string {
  for (const line of (note.content ?? '').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const heading = t.match(/^#{1,6}\s+(.*)/);
    return (heading ? heading[1] : t).slice(0, 60) || 'a note';
  }
  return 'a note';
}

export const SUMMARIZERS: Partial<Record<ToolName, Summarizer>> = {
  setCells: (input, result) => {
    if (!isOk(result)) return `Failed to write cells to ${sheetTitle(input?.sheetId)}`;
    const r = result as any;
    const count = r.updatedCount ?? Object.keys(input?.cells ?? {}).length;
    return `Wrote ${count} cell${count === 1 ? '' : 's'} to ${sheetTitle(r.sheetId ?? input?.sheetId)}`;
  },
  createSheet: (input, result) => {
    if (!isOk(result)) return 'Failed to create sheet';
    const r = result as any;
    const title = sheetTitle(r.sheetId, input?.title ?? 'New Sheet');
    return r.rowCount ? `Created sheet '${title}' (${r.rowCount} rows)` : `Created sheet '${title}'`;
  },
  createChart: (input, result) => {
    if (!isOk(result)) return 'Failed to create chart';
    const r = result as any;
    const title = chartTitle(r.chartId, input?.title ?? 'chart');
    const type = input?.type ? `${input.type} chart` : 'chart';
    return `Added ${type} '${title}'`;
  },
  createPivot: (input, result) => {
    if (!isOk(result)) return 'Failed to create pivot';
    const r = result as any;
    const source = sheetTitle(r.sourceSheetId ?? input?.sheetId);
    const byCol = input?.colLabelCol ?? input?.rowLabelCol;
    return `Pivoted ${source}${byCol ? ` by ${byCol}` : ''}`;
  },
  createSparkline: (input, result) => {
    if (!isOk(result)) return 'Failed to create sparklines';
    const r = result as any;
    return `Added sparklines from ${sheetTitle(r.sourceSheetId ?? input?.sheetId)}`;
  },
  querySheet: (input, result) => {
    if (!isOk(result)) return `Query failed on ${sheetTitle(input?.sheetId)}`;
    const r = result as any;
    const rowCount = Array.isArray(r.rows) ? r.rows.length : undefined;
    return `Queried ${sheetTitle(input?.sheetId)}${rowCount !== undefined ? ` (${rowCount} rows)` : ''}`;
  },
  applyFormat: (input, result) => {
    if (!isOk(result)) return `Failed to format ${input?.range ?? 'range'}`;
    const formatKind = input?.preset?.preset ?? input?.format?.type ?? 'custom';
    return `Formatted ${input?.range ?? '?'} as ${formatKind}`;
  },
  applyFilter: (input, result) => {
    if (!isOk(result)) return `Failed to filter ${sheetTitle(input?.sheetId)}`;
    const r = result as any;
    const count = r.filterCount ?? (Array.isArray(input?.filters) ? input.filters.length : 0);
    return `Filtered ${sheetTitle(input?.sheetId)} (${count} condition${count === 1 ? '' : 's'})`;
  },
  applySort: (input, result) => {
    if (!isOk(result)) return `Failed to sort ${sheetTitle(input?.sheetId)}`;
    return `Sorted ${sheetTitle(input?.sheetId)}`;
  },
  createNote: (input, result) => {
    if (!isOk(result)) return 'Failed to create note';
    return `Added note${input?.title ? ` '${input.title}'` : ''}`;
  },
  updateNote: (input, result) => {
    if (!isOk(result)) return 'Failed to update note';
    return 'Updated note';
  },
  deleteNote: (input, result) => {
    const r = result as any;
    const noteId = r?.noteId ?? input?.noteId;
    const title = titleFromLastSnapshot('notes', noteId, deriveNoteTitleForSummary, 'a note');
    return isOk(result) ? `Deleted note '${title}'` : `Failed to delete note '${title}'`;
  },
  listSheets: (_input, result) => {
    const r = result as any;
    const count = isOk(result) && Array.isArray(r.sheets) ? r.sheets.length : undefined;
    return count !== undefined ? `Listed ${count} sheet${count === 1 ? '' : 's'}` : 'Listed sheets';
  },
  describeSheet: (input) => `Inspected ${sheetTitle(input?.sheetId)}`,
  getSelection: () => 'Checked current selection',
  getRange: (input) => `Read range ${input?.range ?? '?'} from ${sheetTitle(input?.sheetId)}`,
  listNotes: (_input, result) => {
    const r = result as any;
    const count = isOk(result) && Array.isArray(r.notes) ? r.notes.length : undefined;
    return count !== undefined ? `Listed ${count} note${count === 1 ? '' : 's'}` : 'Listed notes';
  },
  readNote: (_input, result) => {
    const r = result as any;
    return isOk(result) && r.title ? `Read note '${r.title}'` : 'Read note';
  },
  listConnections: (_input, result) => {
    const r = result as any;
    const count = isOk(result) && Array.isArray(r.connections) ? r.connections.length : undefined;
    return count !== undefined ? `Listed ${count} connection${count === 1 ? '' : 's'}` : 'Listed connections';
  },
  listConnectionProperties: () => 'Listed connection properties',
  describeConnection: (input) => `Inspected connection ${input?.connectionId ?? ''}`.trim(),
  createQuerySheet: (_input, result) => {
    if (!isOk(result)) return 'Failed to create query sheet';
    const r = result as any;
    return `Created sheet '${r.title ?? sheetTitle(r.sheetId, 'query result')}' from connector query`;
  },
  createQuerySheetFromResult: (_input, result) => {
    if (!isOk(result)) return 'Failed to create sheet from query result';
    const r = result as any;
    return `Created sheet '${r.title ?? sheetTitle(r.sheetId, 'query result')}' from saved query result`;
  },
  updateQuerySheet: (input, result) => {
    if (!isOk(result)) return `Failed to refresh ${sheetTitle(input?.sheetId)}`;
    const r = result as any;
    return `Refreshed ${sheetTitle(r.sheetId ?? input?.sheetId)} from connector`;
  },
  queryConnection: (_input, result) => {
    if (!isOk(result)) return 'Connector query failed';
    const r = result as any;
    return `Queried connector — '${r.title ?? 'query'}'`;
  },
  createGaTrendBySource: (_input, result) => {
    if (!isOk(result)) return 'Failed to create GA trend sheet';
    const r = result as any;
    return `Created GA trend sheet '${r.title ?? sheetTitle(r.sheetId, 'GA trend')}'`;
  },
};

const ID_FALLBACK_KEYS = ['sheetId', 'chartId', 'noteId', 'resultId', 'connectionId', 'id'] as const;

function fallbackSummary(tool: string, result: ToolResult): string {
  if (result && typeof result === 'object' && (result as { ok?: boolean }).ok === false) {
    return truncate(`${tool} failed: ${(result as { error?: string }).error ?? 'unknown error'}`);
  }
  const firstId =
    result && typeof result === 'object'
      ? ID_FALLBACK_KEYS.map((k) => (result as Record<string, unknown>)[k]).find((v) => typeof v === 'string')
      : undefined;
  return truncate(firstId ? `${tool} (${firstId})` : tool);
}

export function summarize(tool: string, input: unknown, result: ToolResult): string {
  const summarizer = (SUMMARIZERS as Record<string, Summarizer>)[tool];
  if (!summarizer) return fallbackSummary(tool, result);
  try {
    return truncate(summarizer(input, result));
  } catch {
    return fallbackSummary(tool, result);
  }
}
