import React from 'react';
import { useStore } from '../../store';
import { formatValue } from '../../utils/formatting';
import { CellFormat } from '../../types';

// Maps the simple string prop authors write (format="currency") to the app's
// richer CellFormat. Anything unknown falls back to the cell's own stored format.
const FORMAT_ALIASES: Record<string, CellFormat> = {
  currency: { type: 'currency' },
  percent: { type: 'percent' },
  number: { type: 'number' },
  date: { type: 'date' },
  text: { type: 'text' },
};

const InertChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="mdx-inert font-mono text-xs text-red-500">{children}</span>
);

interface CellValueProps {
  sheet?: string; // sheet id
  cell?: string; // cell ref, e.g. "B4"
  format?: string; // currency | percent | number | date | text
}

/**
 * MDX-lite live component: renders a single, always-current value from a sheet
 * cell inline in a note. Reads the precomputed value from the store, so it
 * re-renders automatically whenever the underlying data recalculates.
 */
export const CellValue: React.FC<CellValueProps> = ({ sheet, cell, format }) => {
  const cellData = useStore(state =>
    sheet && cell && state.sheets[sheet] ? state.sheets[sheet].cells[cell] : undefined
  );
  const sheetExists = useStore(state => !!sheet && !!state.sheets[sheet]);

  if (!sheet || !cell) return <InertChip>[CellValue: sheet &amp; cell required]</InertChip>;
  if (!sheetExists) return <InertChip>[CellValue: sheet "{sheet}" not found]</InertChip>;

  const explicitFormat = format ? FORMAT_ALIASES[format] : undefined;
  const display = formatValue(cellData?.value ?? null, explicitFormat ?? cellData?.format);

  return <span className="mdx-cell-value font-semibold tabular-nums">{display || '—'}</span>;
};
