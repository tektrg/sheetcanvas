import { CHART_COLORS } from '../constants';
import { ChartColorSchemeId, ChartColorSchemeOverride, ChartColorSettings, ChartConfig } from '../types';

export const CHART_COLOR_SETTINGS_STORAGE_KEY = 'flexsheet-chart-color-settings';

export const DEFAULT_CHART_COLOR_SETTINGS: ChartColorSettings = {
  schemeId: 'neon',
  monoBaseColor: '#000000',
  customPresetInput: '',
};

export const CHART_SCHEME_OPTIONS: Array<{ id: ChartColorSchemeId; label: string }> = [
  { id: 'neon', label: 'Neon' },
  { id: 'pastel', label: 'Pastel' },
  { id: 'mono', label: 'Mono' },
  { id: 'custom', label: 'Custom' },
];

const BUILT_IN_PALETTES: Record<Exclude<ChartColorSchemeId, 'mono' | 'custom'>, { light: string[]; dark: string[] }> = {
  neon: {
    light: ['#00b8d9', '#ff2d95', '#8b5cf6', '#00c853', '#ffab00', '#ff5630', '#36b37e', '#0065ff'],
    dark: ['#00e5ff', '#ff4db8', '#a78bfa', '#39ff88', '#ffd166', '#ff7a59', '#57f2a8', '#4c9aff'],
  },
  pastel: {
    light: ['#dabbd8', '#e69b9f', '#81cad2', '#afb679', '#c2c9cc', '#f0e1de', '#f7c9b6', '#549bad', '#83bdc0'],
    dark: ['#e3cae1', '#edb0b3', '#9bd5dc', '#bfc694', '#d1d7d9', '#f3e7e5', '#f9d6c8', '#76afbd', '#9acacc'],
  },
};

const HEX_COLOR_PATTERN = /^#?[0-9a-f]{6}$/i;

export const normalizeHexColor = (value: string): string | null => {
  const trimmed = value.trim();
  if (!HEX_COLOR_PATTERN.test(trimmed)) return null;
  return `#${trimmed.replace('#', '').toLowerCase()}`;
};

export const parseCustomPaletteInput = (input: string): string[] => {
  const colors: string[] = [];
  input.split(',').forEach(part => {
    const color = normalizeHexColor(part);
    if (color && !colors.includes(color)) colors.push(color);
  });
  return colors;
};

const hexToRgb = (hex: string) => {
  const normalized = normalizeHexColor(hex) || DEFAULT_CHART_COLOR_SETTINGS.monoBaseColor;
  const value = normalized.slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const rgbToHex = (r: number, g: number, b: number) => {
  const toHex = (channel: number) => Math.max(0, Math.min(255, Math.round(channel)))
    .toString(16)
    .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const mix = (base: string, target: string, amount: number) => {
  const from = hexToRgb(base);
  const to = hexToRgb(target);
  return rgbToHex(
    from.r + (to.r - from.r) * amount,
    from.g + (to.g - from.g) * amount,
    from.b + (to.b - from.b) * amount,
  );
};

const buildMonoPalette = (baseColor: string, darkMode: boolean) => {
  const base = normalizeHexColor(baseColor) || DEFAULT_CHART_COLOR_SETTINGS.monoBaseColor;
  const targets = darkMode
    ? ['#ffffff', '#ffffff', '#ffffff', '#ffffff', '#000000', '#000000', '#ffffff', '#000000']
    : ['#ffffff', '#ffffff', '#000000', '#ffffff', '#000000', '#ffffff', '#000000', '#ffffff'];
  const amounts = darkMode
    ? [0.18, 0.3, 0.44, 0.58, 0.1, 0.22, 0.72, 0.34]
    : [0, 0.18, 0.18, 0.34, 0.32, 0.5, 0.46, 0.64];

  return amounts.map((amount, index) => mix(base, targets[index], amount));
};

/**
 * Build a smooth single-hue ramp for mono charts, sized to the exact number of
 * segments. Darkest = the base color (first series), lightening toward near-white
 * (last series) — the classic dark→light stacked-bar look. In dark mode the dark
 * end is lifted off the panel background so it stays visible.
 */
export const buildMonoRamp = (baseColor: string, darkMode: boolean, count: number): string[] => {
  const base = normalizeHexColor(baseColor) || DEFAULT_CHART_COLOR_SETTINGS.monoBaseColor;
  const n = Math.max(1, Math.floor(count));
  const startAmount = darkMode ? 0.28 : 0;   // 0 = pure base color at the dark end
  const endAmount = darkMode ? 0.9 : 0.85;   // near-white at the light end
  if (n === 1) return [mix(base, '#ffffff', startAmount)];
  return Array.from({ length: n }, (_, index) => {
    const t = startAmount + (endAmount - startAmount) * (index / (n - 1));
    return mix(base, '#ffffff', t);
  });
};

const adjustCustomPaletteForMode = (colors: string[], darkMode: boolean) => {
  if (!darkMode) return colors;
  return colors.map(color => mix(color, '#ffffff', 0.18));
};

export const getEffectiveChartScheme = (
  chartConfig: Pick<ChartConfig, 'colorScheme'> | undefined,
  settings: ChartColorSettings,
): ChartColorSchemeId => {
  const override = chartConfig?.colorScheme;
  return !override || override === 'workspace' ? settings.schemeId : override;
};

export const getChartPalette = (
  settings: ChartColorSettings,
  darkMode: boolean,
  schemeId: ChartColorSchemeId = settings.schemeId,
): string[] => {
  if (schemeId === 'mono') return buildMonoPalette(settings.monoBaseColor, darkMode);
  if (schemeId === 'custom') {
    const customColors = parseCustomPaletteInput(settings.customPresetInput);
    return customColors.length > 0 ? adjustCustomPaletteForMode(customColors, darkMode) : CHART_COLORS;
  }
  return BUILT_IN_PALETTES[schemeId][darkMode ? 'dark' : 'light'];
};

export const getEffectiveChartPalette = (
  chartConfig: Pick<ChartConfig, 'colorScheme'> | undefined,
  settings: ChartColorSettings,
  darkMode: boolean,
) => getChartPalette(settings, darkMode, getEffectiveChartScheme(chartConfig, settings));

export const getChartPrimaryColor = (
  chartConfig: Pick<ChartConfig, 'color' | 'colorOverride' | 'colorScheme'>,
  palette: string[],
) => {
  if (!chartConfig.colorScheme || chartConfig.colorOverride) return chartConfig.color;
  return palette[0] || chartConfig.color;
};

export const buildSeriesPalette = (primaryColor: string, palette: string[]) => {
  const normalizedPrimary = normalizeHexColor(primaryColor) || primaryColor;
  return [primaryColor, ...palette.filter(color => color.toLowerCase() !== normalizedPrimary.toLowerCase())];
};

export const readStoredChartColorSettings = (): ChartColorSettings => {
  if (typeof window === 'undefined') return DEFAULT_CHART_COLOR_SETTINGS;

  const stored = window.localStorage.getItem(CHART_COLOR_SETTINGS_STORAGE_KEY);
  if (!stored) return DEFAULT_CHART_COLOR_SETTINGS;

  try {
    const parsed = JSON.parse(stored) as Partial<ChartColorSettings>;
    const schemeId = CHART_SCHEME_OPTIONS.some(option => option.id === parsed.schemeId)
      ? parsed.schemeId as ChartColorSchemeId
      : DEFAULT_CHART_COLOR_SETTINGS.schemeId;

    return {
      schemeId,
      monoBaseColor: normalizeHexColor(parsed.monoBaseColor || '') || DEFAULT_CHART_COLOR_SETTINGS.monoBaseColor,
      customPresetInput: typeof parsed.customPresetInput === 'string' ? parsed.customPresetInput : '',
    };
  } catch {
    return DEFAULT_CHART_COLOR_SETTINGS;
  }
};
