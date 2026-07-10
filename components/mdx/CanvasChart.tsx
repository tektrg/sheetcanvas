import React, { useMemo } from 'react';
import { ChartNode } from '../ChartNode';
import { useStore } from '../../store';
import { CHART_COLORS } from '../../constants';
import { readStoredChartColorSettings } from '../../utils/chartColorSchemes';

// Stable no-op references so ChartNode's memo comparator does not thrash.
const noop = () => {};

interface CanvasChartProps {
  id?: string; // chart id
  height?: string | number;
  darkMode?: boolean;
}

/**
 * MDX-lite live component: renders an existing canvas chart inline inside a note.
 * Reuses ChartNode in its `embedded` mode (no drag/toolbar/resize chrome) so the
 * chart is derived live from its source sheet — a single source of truth.
 */
export const CanvasChart: React.FC<CanvasChartProps> = ({ id, height, darkMode }) => {
  const chartExists = useStore(state => !!id && !!state.charts[id]);
  const colorSettings = useMemo(() => readStoredChartColorSettings(), []);

  if (!id || !chartExists) {
    return (
      <span className="mdx-inert font-mono text-xs text-red-500">
        [CanvasChart: chart "{id ?? ''}" not found]
      </span>
    );
  }

  const resolvedHeight = Number(height) || 260;

  return (
    <div className="mdx-canvas-chart my-3" style={{ height: resolvedHeight, width: '100%' }}>
      <ChartNode
        id={id}
        embedded
        darkMode={darkMode}
        recentColors={CHART_COLORS as unknown as string[]}
        colorSettings={colorSettings}
        onColorSettingsChange={noop}
        onMouseDown={noop}
      />
    </div>
  );
};
