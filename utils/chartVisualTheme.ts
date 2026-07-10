import type { CSSProperties } from 'react';

export interface ChartVisualTheme {
  textColor: string;
  mutedTextColor: string;
  gridColor: string;
  cursorFill: string;
  tooltipStyle: CSSProperties;
  chartFrameClassName: string;
  headerClassName: string;
  bodyClassName: string;
  chartAreaClassName: string;
  selectedFrameStyle: CSSProperties;
  frameStyle: CSSProperties;
  barRadius: [number, number, number, number];
  stackedBarRadius: [number, number, number, number];
  lineStrokeWidth: number;
  dotStyle: { r: number; fill: string; strokeWidth: number };
  activeDotStyle: { r: number; strokeWidth: number };
  pieStroke: string;
  pieStrokeWidth: number;
}

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

export const buildGradientId = (chartId: string, prefix: string, key: string | number) => {
  const safeKey = String(key).replace(/[^a-zA-Z0-9_-]/g, '');
  return `${prefix}-${chartId}-${safeKey || 'series'}`;
};

export const getAreaGradientStops = (color: string, darkMode: boolean) => ({
  startColor: mixChartColor(color, darkMode ? '#ffffff' : '#ffffff', darkMode ? 0.08 : 0.16),
  endColor: color,
  startOpacity: darkMode ? 0.46 : 0.36,
  endOpacity: darkMode ? 0.06 : 0.08,
});

export const getBarGradientStops = (color: string, darkMode: boolean) => ({
  startColor: mixChartColor(color, '#ffffff', darkMode ? 0.2 : 0.28),
  endColor: mixChartColor(color, darkMode ? '#000000' : '#111827', darkMode ? 0.08 : 0.04),
});

export const getChartVisualTheme = (darkMode: boolean, selected: boolean): ChartVisualTheme => {
  const frameStyle: CSSProperties = darkMode
    ? {
        background: 'linear-gradient(180deg, rgba(38,38,38,0.98) 0%, rgba(30,30,30,0.96) 100%)',
        boxShadow: '0 14px 30px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.05)',
      }
    : {
        background: 'linear-gradient(180deg, rgba(255,255,255,0.98) 0%, rgba(250,250,249,0.96) 100%)',
        boxShadow: '0 12px 28px rgba(15,23,42,0.08), inset 0 1px 0 rgba(255,255,255,0.8)',
      };

  return {
    textColor: darkMode ? '#d4d4d4' : '#525252',
    mutedTextColor: darkMode ? '#a3a3a3' : '#78716c',
    gridColor: darkMode ? 'rgba(115,115,115,0.18)' : 'rgba(120,113,108,0.16)',
    cursorFill: darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(15,23,42,0.04)',
    tooltipStyle: {
      backgroundColor: darkMode ? 'rgba(23,23,23,0.94)' : 'rgba(255,255,255,0.96)',
      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(15,23,42,0.1)'}`,
      color: darkMode ? '#fafafa' : '#292524',
      borderRadius: '10px',
      boxShadow: darkMode
        ? '0 18px 38px rgba(0,0,0,0.36)'
        : '0 18px 38px rgba(15,23,42,0.14)',
      backdropFilter: selected ? 'blur(10px)' : undefined,
    },
    chartFrameClassName: selected ? 'backdrop-blur-sm' : '',
    headerClassName: darkMode
      ? 'bg-gradient-to-b from-white/[0.04] to-transparent'
      : 'bg-gradient-to-b from-white/80 to-white/20',
    bodyClassName: darkMode
      ? 'bg-[linear-gradient(180deg,rgba(38,38,38,0.20),rgba(23,23,23,0.12))]'
      : 'bg-[linear-gradient(180deg,rgba(255,255,255,0.80),rgba(245,245,244,0.42))]',
    chartAreaClassName: darkMode
      ? 'rounded-lg bg-neutral-950/10 ring-1 ring-white/[0.03]'
      : 'rounded-lg bg-white/35 ring-1 ring-black/[0.03]',
    selectedFrameStyle: {
      ...frameStyle,
      boxShadow: darkMode
        ? '0 20px 48px rgba(0,0,0,0.38), 0 0 0 1px rgba(45,212,191,0.45), inset 0 1px 0 rgba(255,255,255,0.06)'
        : '0 20px 48px rgba(15,23,42,0.16), 0 0 0 1px rgba(20,184,166,0.45), inset 0 1px 0 rgba(255,255,255,0.9)',
    },
    frameStyle,
    barRadius: [7, 7, 0, 0],
    stackedBarRadius: [0, 0, 0, 0],
    lineStrokeWidth: 2.5,
    dotStyle: { r: 4, fill: darkMode ? '#171717' : '#ffffff', strokeWidth: 2 },
    activeDotStyle: { r: 6, strokeWidth: 0 },
    pieStroke: darkMode ? '#262626' : '#ffffff',
    pieStrokeWidth: 2,
  };
};
