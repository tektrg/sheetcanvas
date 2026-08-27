// Generic, tool-agnostic helpers shared by every per-tool shaper in
// shapingShapers.ts and by the backstop/public API in toolResultShaping.ts.
// Pure, no store, no React — see toolResultShaping.ts for the import
// boundary this module exists to keep.
import { parseCellId } from '../../../utils/formulas';

/** Target ceiling for a shaped tool result once JSON-stringified. Chosen with
 * headroom under OpenAI's ~1.5K-character truncation so the agent's own
 * wrapping (ids, whitespace) doesn't push a borderline result over the edge. */
export const WEBMCP_OUTPUT_BUDGET = 1400;

export const ERROR_MESSAGE_MAX_CHARS = 600;
export const OMITTED_NOTE_MAX_CHARS = 80;
export const QUERY_DIAGNOSTICS_MAX_CHARS = 200;
// Reserve for the rest of a shaped payload's fields when budgeting how many
// rows a row-bearing tool (getRange, querySheet) can afford to include.
export const ROW_BUDGET_RESERVE_CHARS = 300;

export function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export function capMessage(message: string, max: number): string {
  return message.length > max ? message.slice(0, max) : message;
}

// Truncation-note builder. Hard-capped at OMITTED_NOTE_MAX_CHARS: `_omitted`
// exists to tell the agent what was cut and how to page for more via other
// retained fields (columnIdSpan, rowCount, returnedRange, nextPageToken) —
// it is not a place for prose, so its cost must never grow with how much was
// truncated.
export function omittedNote(parts: Array<string | undefined | null | false>): string {
  return parts
    .filter((p): p is string => !!p)
    .join('; ')
    .slice(0, OMITTED_NOTE_MAX_CHARS);
}

export function pick(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in obj) out[key] = obj[key];
  }
  return out;
}

// Budget-aware array clipper shared by every tool that returns row-shaped
// data (getRange's rows, querySheet's rows). Always keeps at least one row
// (if any exist) so a single oversized row doesn't produce an empty result;
// the generic backstop is the final safety net if that one row is still too
// big.
export function clipRowsToBudget<T>(
  rows: T[],
  baseOverheadChars: number,
  budgetChars: number,
): { rows: T[]; truncated: boolean } {
  const kept: T[] = [];
  let used = baseOverheadChars;
  for (const row of rows) {
    const size = jsonLength(row) + 1;
    if (kept.length > 0 && used + size > budgetChars) break;
    used += size;
    kept.push(row);
  }
  return { rows: kept, truncated: kept.length < rows.length };
}

// ── A1 range helpers (self-contained: no import from clientToolExecutor,
// which would pull in the store transitively) ───────────────────────────

export interface RangeBounds {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

export function parseRangeRef(range: string): RangeBounds | null {
  const [a, b] = String(range ?? '').split(':');
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
