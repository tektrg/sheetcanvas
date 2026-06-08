import alasql from 'alasql';
import type { SheetData } from '../../types';
import { getCellId } from '../../utils/formulas';
import { getSheetDataBounds } from './sheetBounds';

function sanitizeHeader(raw: unknown, fallback: string): string {
  const s = String(raw ?? '').trim();
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned || /^\d/.test(cleaned)) return fallback;
  return cleaned;
}

function coerce(value: unknown): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  const s = String(value).trim();
  if (s === '') return null;
  // Only coerce to number when the string round-trips losslessly. Preserves
  // leading-zero IDs ("01"), phone numbers, ZIPs, and avoids "1,234" → NaN.
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n) && String(n) === s) return n;
  }
  return s;
}

export interface SheetTable {
  columnLetters: string[];
  sqlColumns: string[];
  rows: Record<string, unknown>[];
}

export function buildSheetTable(sheet: SheetData): SheetTable {
  const { width, height } = getSheetDataBounds(sheet);
  const columnLetters: string[] = [];
  const sqlColumns: string[] = [];
  const usedNames = new Set<string>();

  for (let c = 0; c < width; c++) {
    const letter = getCellId(c, 0).replace(/\d+$/, '');
    columnLetters.push(letter);
    const headerCell = sheet.cells[getCellId(c, 0)];
    let name = sanitizeHeader(headerCell?.value ?? headerCell?.raw, `col_${letter.toLowerCase()}`);
    let unique = name;
    let suffix = 2;
    while (usedNames.has(unique)) unique = `${name}_${suffix++}`;
    usedNames.add(unique);
    sqlColumns.push(unique);
  }

  const rows: Record<string, unknown>[] = [];
  for (let r = 1; r < height; r++) {
    const row: Record<string, unknown> = {};
    let hasAny = false;
    for (let c = 0; c < width; c++) {
      const cell = sheet.cells[getCellId(c, r)];
      const v = cell ? (cell.value ?? cell.raw) : null;
      if (v !== null && v !== undefined && v !== '') hasAny = true;
      row[sqlColumns[c]] = coerce(v);
    }
    if (hasAny) rows.push(row);
  }

  return { columnLetters, sqlColumns, rows };
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

const SELECT_ONLY = /^\s*(WITH|SELECT)\b/i;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|MERGE|TRUNCATE|ATTACH|DETACH|EXEC|CALL|PRAGMA)\b/i;

export function runSheetQuery(sheet: SheetData, sql: string, limit = 200): QueryResult {
  if (!SELECT_ONLY.test(sql)) throw new Error('Only SELECT/WITH queries are allowed');
  if (FORBIDDEN.test(sql)) throw new Error('Mutation keywords are not allowed');

  const table = buildSheetTable(sheet);
  // alasql operates on JS arrays via parameterized "?" placeholder.
  // The table is referenced as the first parameter in FROM ?.
  // We rewrite "FROM t" / "JOIN t" to use a parameter.
  // Simpler: define a per-call function returning rows.
  const sqlWithTable = sql.replace(/\bFROM\s+t\b/gi, 'FROM ?').replace(/\bJOIN\s+t\b/gi, 'JOIN ?');
  if (!sqlWithTable.includes('?')) {
    throw new Error('Query must reference the sheet as table "t" (e.g. FROM t)');
  }

  const raw = (alasql as any)(sqlWithTable, [table.rows]);
  const rowsArr: any[] = Array.isArray(raw) ? raw : [];
  const columns = rowsArr.length > 0 ? Object.keys(rowsArr[0]) : [];
  const truncated = rowsArr.length > limit;
  const sliced = truncated ? rowsArr.slice(0, limit) : rowsArr;
  return {
    columns,
    rows: sliced.map((row) => columns.map((col) => row[col])),
    rowCount: rowsArr.length,
    truncated,
  };
}

export function sheetTableSchema(
  sheet: SheetData,
): { columnLetter: string; headerCell: string; header: unknown; sqlName: string; sampleValue: unknown }[] {
  const table = buildSheetTable(sheet);
  const sample = table.rows[0] ?? {};
  return table.columnLetters.map((letter, i) => {
    const headerCell = sheet.cells[getCellId(i, 0)];
    return {
      columnLetter: letter,
      headerCell: `${letter}1`,
      header: headerCell?.value ?? headerCell?.raw ?? null,
      sqlName: table.sqlColumns[i],
      sampleValue: sample[table.sqlColumns[i]] ?? null,
    };
  });
}
