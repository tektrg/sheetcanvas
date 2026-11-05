// Chart look shared by the canvas (utils/chartVisualTheme.ts) and the published-page
// renderer (backend/src/render/chartSvg.ts). Pure data + color math: no React, no DOM.

/** Fill for the chart's `highlightIndex` bar / dot / pie slice. */
export const CHART_HIGHLIGHT_COLOR = '#f2c94c';
export const CHART_BAR_RADIUS = 7;
export const CHART_LINE_STROKE_WIDTH = 2.5;
export const CHART_DOT_RADIUS = 4;
export const CHART_DOT_STROKE_WIDTH = 2;
export const CHART_PIE_STROKE_WIDTH = 2;

const normalizeHex = (color: string) => {
  const value = color.replace('#', '').trim();
  return /^[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
};

const hexToRgb = (color: string) => {
  const value = normalizeHex(color);
  if (!value) return null;
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const channelToHex = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)))
  .toString(16)
  .padStart(2, '0');

export const mixChartColor = (baseColor: string, targetColor: string, amount: number) => {
  const base = hexToRgb(baseColor);
  const target = hexToRgb(targetColor);
  if (!base || !target) return baseColor;

  return `#${channelToHex(base.r + (target.r - base.r) * amount)}${channelToHex(base.g + (target.g - base.g) * amount)}${channelToHex(base.b + (target.b - base.b) * amount)}`;
};

export const getAreaGradientStops = (color: string, darkMode: boolean) => ({
  startColor: mixChartColor(color, '#ffffff', darkMode ? 0.08 : 0.16),
  endColor: color,
  startOpacity: darkMode ? 0.46 : 0.36,
  endOpacity: darkMode ? 0.06 : 0.08,
});
