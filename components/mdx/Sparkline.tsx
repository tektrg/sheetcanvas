import React from 'react';
import { useStore } from '../../store';
import { parseCellId, getCellId } from '../../utils/formulas';
import { SheetData } from '../../types';

// Expand "B2:B12" (or a single "B2") into the ordered list of cell ids it covers.
const expandRange = (range: string): string[] => {
  const [startRef, endRef] = range.split(':');
  const start = parseCellId((startRef ?? '').trim());
  const end = parseCellId((endRef ?? startRef ?? '').trim());
  if (!start || !end) return [];

  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);

  const ids: string[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      ids.push(getCellId(col, row));
    }
  }
  return ids;
};

const collectNumericValues = (sheet: SheetData | undefined, range: string): number[] => {
  if (!sheet) return [];
  const values: number[] = [];
  for (const id of expandRange(range)) {
    const raw = sheet.cells[id]?.value;
    if (raw === null || raw === undefined || String(raw).trim() === '') continue;
    const numeric = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
    if (!isNaN(numeric)) values.push(numeric);
  }
  return values;
};

interface SparklineProps {
  sheet?: string; // sheet id
  range?: string; // e.g. "B2:B12"
  width?: string | number;
  height?: string | number;
  color?: string;
}

/**
 * MDX-lite live component: a tiny inline trend line drawn from a sheet range.
 * Pure SVG (no chart library) so it stays lightweight inside flowing text and
 * updates live as the range values change.
 */
export const Sparkline: React.FC<SparklineProps> = ({ sheet, range, width, height, color }) => {
  const sheetData = useStore(state => (sheet ? state.sheets[sheet] : undefined));

  if (!sheet || !range) {
    return <span className="mdx-inert font-mono text-xs text-red-500">[Sparkline: sheet &amp; range required]</span>;
  }

  const values = collectNumericValues(sheetData, range);
  const svgWidth = Number(width) || 80;
  const svgHeight = Number(height) || 20;

  if (values.length < 2) {
    return <span className="mdx-inert text-neutral-400">—</span>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const points = values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * (svgWidth - 2) + 1;
      const y = svgHeight - 1 - ((value - min) / span) * (svgHeight - 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className="mdx-sparkline inline-block align-middle"
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color || '#14b8a6'}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};
