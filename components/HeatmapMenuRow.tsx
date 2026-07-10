import React from 'react';
import { Palette, ArrowUpDown } from 'lucide-react';
import { CellFormat, HeatmapColor } from '../types';

interface HeatmapMenuRowProps {
  // The visual key that marks this heatmap active: 'heatmap' (column) or 'heatmap-row'.
  heatmapVisual: 'heatmap' | 'heatmap-row';
  // The action name the parent handler expects: 'heatmap' (column) or 'heatmap-row'.
  actionName: 'heatmap' | 'heatmap-row';
  currentFormat?: CellFormat;
  onAction: (action: string, param?: any) => void;
}

const SINGLE_HUE_SWATCHES: { color: Extract<HeatmapColor, 'red' | 'yellow' | 'green'>; className: string; title: string }[] = [
  { color: 'red', className: 'bg-red-500', title: 'Red' },
  { color: 'yellow', className: 'bg-yellow-400', title: 'Yellow' },
  { color: 'green', className: 'bg-teal-500', title: 'Green' },
];

const ACTIVE_RING = 'ring-2 ring-offset-1 ring-neutral-400';
const BASE_SWATCH = 'w-2.5 h-2.5 rounded-full hover:scale-125 transition-transform ring-1 ring-neutral-200 dark:ring-neutral-600';

/**
 * Shared heatmap menu row: label + single-hue swatches (red/yellow/green), a
 * two-tone diverging swatch, and a polarity flip toggle shown while diverging is
 * active. Used by both the column and row menus so the UI stays in sync.
 */
export const HeatmapMenuRow: React.FC<HeatmapMenuRowProps> = ({
  heatmapVisual,
  actionName,
  currentFormat,
  onAction,
}) => {
  const isActive = currentFormat?.visual === heatmapVisual;
  const activeColor = isActive ? currentFormat?.heatmapColor : undefined;
  const isDiverging = activeColor === 'diverging';
  const isFlipped = !!currentFormat?.heatmapFlip;
  // Default single hue is green when a heatmap is active with no explicit color.
  const greenIsActive = activeColor === 'green' || (isActive && !activeColor);

  return (
    <div className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between group">
      <button onClick={() => onAction(actionName)} className="flex items-center gap-2 flex-1 text-left">
        <Palette size={12} className="text-neutral-400" /> Heatmap
      </button>
      <div className="flex items-center gap-1 ml-2">
        {SINGLE_HUE_SWATCHES.map(({ color, className, title }) => {
          const swatchActive = color === 'green' ? greenIsActive : activeColor === color;
          return (
            <button
              key={color}
              onClick={(e) => { e.stopPropagation(); onAction(actionName, color); }}
              className={`${BASE_SWATCH} ${className} ${swatchActive ? ACTIVE_RING : ''}`}
              title={title}
            />
          );
        })}
        {/* Diverging (two-tone) swatch: red = negative, green = positive. */}
        <button
          onClick={(e) => { e.stopPropagation(); onAction(actionName, 'diverging'); }}
          className={`${BASE_SWATCH} bg-gradient-to-r ${isFlipped ? 'from-teal-500 to-red-500' : 'from-red-500 to-teal-500'} ${isDiverging ? ACTIVE_RING : ''}`}
          title="Diverging (red negative / green positive)"
        />
        {/* Polarity flip: only meaningful while diverging is active. */}
        {isDiverging && (
          <button
            onClick={(e) => { e.stopPropagation(); onAction(actionName, 'flip'); }}
            className={`p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-600 ${isFlipped ? 'text-teal-600 dark:text-teal-400' : 'text-neutral-400'}`}
            title="Flip polarity (swap red/green)"
          >
            <ArrowUpDown size={11} />
          </button>
        )}
      </div>
    </div>
  );
};
