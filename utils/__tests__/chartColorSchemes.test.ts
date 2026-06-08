import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHART_COLOR_SETTINGS,
  buildSeriesPalette,
  getChartPrimaryColor,
  getChartPalette,
  getEffectiveChartPalette,
  normalizeHexColor,
  parseCustomPaletteInput,
} from '../chartColorSchemes';

describe('chartColorSchemes', () => {
  it('normalizes and filters comma-separated custom hex colors', () => {
    expect(parseCustomPaletteInput(' #ABCDEF, bad, 123456, #abcdef ')).toEqual([
      '#abcdef',
      '#123456',
    ]);
    expect(normalizeHexColor('00FFAA')).toBe('#00ffaa');
    expect(normalizeHexColor('#123')).toBeNull();
  });

  it('uses custom preset colors when custom scheme has valid input', () => {
    const palette = getChartPalette(
      { ...DEFAULT_CHART_COLOR_SETTINGS, schemeId: 'custom', customPresetInput: '#111111, #eeeeee' },
      false,
    );

    expect(palette).toEqual(['#111111', '#eeeeee']);
  });

  it('brightens custom preset colors in dark mode', () => {
    const settings = {
      ...DEFAULT_CHART_COLOR_SETTINGS,
      schemeId: 'custom' as const,
      customPresetInput: '#111111, #eeeeee',
    };

    expect(getChartPalette(settings, true)).not.toEqual(getChartPalette(settings, false));
  });

  it('generates mono shades from the global base color', () => {
    const lightPalette = getChartPalette(
      { ...DEFAULT_CHART_COLOR_SETTINGS, schemeId: 'mono', monoBaseColor: '#336699' },
      false,
    );
    const darkPalette = getChartPalette(
      { ...DEFAULT_CHART_COLOR_SETTINGS, schemeId: 'mono', monoBaseColor: '#336699' },
      true,
    );

    expect(lightPalette).toHaveLength(8);
    expect(darkPalette).toHaveLength(8);
    expect(lightPalette[0]).toBe('#336699');
    expect(darkPalette[0]).not.toBe(lightPalette[0]);
  });

  it('resolves per-chart overrides separately from workspace defaults', () => {
    const settings = { ...DEFAULT_CHART_COLOR_SETTINGS, schemeId: 'pastel' as const };

    expect(getEffectiveChartPalette({ colorScheme: 'workspace' }, settings, false)[0]).toBe(
      getChartPalette(settings, false, 'pastel')[0],
    );
    expect(getEffectiveChartPalette({ colorScheme: 'neon' }, settings, false)[0]).toBe(
      getChartPalette(settings, false, 'neon')[0],
    );
  });

  it('uses the product pastel palette for the built-in pastel scheme', () => {
    expect(getChartPalette(DEFAULT_CHART_COLOR_SETTINGS, false, 'pastel')).toEqual([
      '#dabbd8',
      '#e69b9f',
      '#81cad2',
      '#afb679',
      '#c2c9cc',
      '#f0e1de',
      '#f7c9b6',
      '#549bad',
      '#83bdc0',
    ]);
  });

  it('keeps the primary color first and cycles the remaining palette after it', () => {
    expect(buildSeriesPalette('#222222', ['#111111', '#222222', '#333333'])).toEqual([
      '#222222',
      '#111111',
      '#333333',
    ]);
  });

  it('inherits the scheme primary color until a chart has an explicit primary override', () => {
    const palette = ['#111111', '#222222'];

    expect(getChartPrimaryColor({
      color: '#ff0000',
      colorScheme: 'workspace',
      colorOverride: false,
    }, palette)).toBe('#111111');

    expect(getChartPrimaryColor({
      color: '#ff0000',
      colorScheme: 'workspace',
      colorOverride: true,
    }, palette)).toBe('#ff0000');
  });
});
