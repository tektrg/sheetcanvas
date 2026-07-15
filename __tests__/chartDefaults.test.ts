import { describe, expect, it } from 'vitest';
import {
  pickChartForm,
  detectOrdinalCategories,
  detectRateSignal,
  type ChartShape,
  type SeriesShape,
} from '../utils/chartDefaults';

const series = (id: string, over: Partial<SeriesShape> = {}): SeriesShape => ({
  id,
  magnitude: over.magnitude ?? 100,
  min: over.min ?? 0,
  max: over.max ?? 200,
  rateSignal: over.rateSignal ?? 'none',
  label: over.label,
});

const shape = (over: Partial<ChartShape>): ChartShape => ({
  xType: over.xType ?? 'time',
  categoryCount: over.categoryCount ?? 5,
  labelMaxLength: over.labelMaxLength ?? 6,
  isOrdinal: over.isOrdinal ?? false,
  series: over.series ?? [series('B')],
  requestedType: over.requestedType ?? 'bar',
  supportsDualAxis: over.supportsDualAxis ?? true,
  labelColumn: over.labelColumn ?? 'A',
});

describe('pickChartForm — single series (F1)', () => {
  it('single series over categories → bar', () => {
    const d = pickChartForm(shape({ xType: 'categorical', series: [series('B')] }));
    expect(d.type).toBe('bar');
  });
  it('single series over time → line', () => {
    const d = pickChartForm(shape({ xType: 'time', series: [series('B')] }));
    expect(d.type).toBe('line');
  });
});

describe('pickChartForm — dual-axis gate (F2)', () => {
  it('rate paired with absolutes → bar + line dual axis', () => {
    const d = pickChartForm(
      shape({
        xType: 'time',
        series: [series('B', { magnitude: 5000 }), series('C', { rateSignal: 'strong', magnitude: 0.04, max: 0.06 })],
      })
    );
    expect(d.type).toBe('bar');
    expect(d.rightAxisColumns).toEqual(['C']);
    expect(d.seriesTypes.C).toBe('line');
    expect(d.seriesTypes.B).toBe('bar');
  });

  it('TRAP: two same-unit series must NOT dual-axis', () => {
    const d = pickChartForm(
      shape({
        xType: 'time',
        series: [series('B', { magnitude: 1000 }), series('C', { magnitude: 1100 })],
      })
    );
    expect(d.rightAxisColumns).toEqual([]);
    expect(d.type).toBe('line'); // 2 same-unit over time → lines
  });

  it('≥10× magnitude difference → dual axis with scale warning', () => {
    const d = pickChartForm(
      shape({
        xType: 'time',
        series: [series('B', { magnitude: 10000 }), series('C', { magnitude: 50 })],
      })
    );
    expect(d.rightAxisColumns).toEqual(['C']);
    expect(d.warnings.join(' ')).toMatch(/index = 100/);
  });

  it('gate does not fire in group mode (no dual-axis support) → warning', () => {
    const d = pickChartForm(
      shape({
        xType: 'time',
        supportsDualAxis: false,
        series: [series('B', { magnitude: 5000 }), series('C', { rateSignal: 'strong', magnitude: 0.04 })],
      })
    );
    expect(d.rightAxisColumns).toEqual([]);
    expect(d.warnings.join(' ')).toMatch(/metrics mode/);
  });
});

describe('pickChartForm — count caps (F3/F4)', () => {
  it('TRAP: 3 series over categories must NOT be lines (grouped bars)', () => {
    const d = pickChartForm(
      shape({ xType: 'categorical', series: [series('B'), series('C'), series('D')] })
    );
    expect(d.type).toBe('bar');
  });

  it('3 same-unit series over time → lines', () => {
    const d = pickChartForm(
      shape({ xType: 'time', series: [series('B'), series('C'), series('D')] })
    );
    expect(d.type).toBe('line');
  });

  it('4+ series over time → lines', () => {
    const d = pickChartForm(
      shape({ xType: 'time', series: [series('B'), series('C'), series('D'), series('E')] })
    );
    expect(d.type).toBe('line');
    expect(d.firedRules.join(' ')).toMatch(/F4/);
  });

  it('4+ series over categories → bars flagged as a wall', () => {
    const d = pickChartForm(
      shape({ xType: 'categorical', series: [series('B'), series('C'), series('D'), series('E')] })
    );
    expect(d.type).toBe('bar');
    expect(d.warnings.join(' ')).toMatch(/wall/);
  });

  it('7+ series → top-N recommendation (F5)', () => {
    const many = Array.from({ length: 8 }, (_, i) => series(String.fromCharCode(66 + i)));
    const d = pickChartForm(shape({ xType: 'time', series: many }));
    expect(d.topN).toBeGreaterThan(0);
    expect(d.firedRules.join(' ')).toMatch(/F5/);
  });
});

describe('pickChartForm — cosmetics (F7/F13)', () => {
  it('categorical bars are value-sorted descending', () => {
    const d = pickChartForm(shape({ xType: 'categorical', series: [series('B')], labelColumn: 'A' }));
    expect(d.sort).toEqual({ columnId: 'A', direction: 'desc' });
  });

  it('TRAP: ordinal categories must NOT be value-sorted', () => {
    const d = pickChartForm(
      shape({ xType: 'ordinal', isOrdinal: true, series: [series('B')], labelColumn: 'A' })
    );
    expect(d.sort).toBeNull();
  });

  it('long labels or many categories → horizontal recommendation', () => {
    const d = pickChartForm(
      shape({ xType: 'categorical', categoryCount: 12, series: [series('B')] })
    );
    expect(d.horizontal).toBe(true);
  });
});

describe('pickChartForm — intentional types kept', () => {
  it.each(['pie', 'scatter', 'area', 'treemap'] as const)('keeps requested %s', (t) => {
    const d = pickChartForm(shape({ requestedType: t, series: [series('B'), series('C')] }));
    expect(d.type).toBe(t);
    expect(d.rightAxisColumns).toEqual([]);
  });
});

describe('detectOrdinalCategories (F7)', () => {
  it('detects month names', () => {
    expect(detectOrdinalCategories(['Jan', 'Feb', 'Mar', 'Apr'])).toBe(true);
  });
  it('detects numeric range bands', () => {
    expect(detectOrdinalCategories(['18-24', '25-34', '35-44'])).toBe(true);
  });
  it('detects size tiers', () => {
    expect(detectOrdinalCategories(['S', 'M', 'L', 'XL'])).toBe(true);
  });
  it('plain nominal categories are not ordinal', () => {
    expect(detectOrdinalCategories(['Chrome', 'Safari', 'Firefox', 'Edge'])).toBe(false);
  });
});

describe('detectRateSignal (F11)', () => {
  it('percent format → strong', () => {
    expect(detectRateSignal({ formatType: 'percent', min: 0, max: 0.5, count: 30 })).toBe('strong');
  });
  it('rate word in header → strong', () => {
    expect(detectRateSignal({ header: 'Conversion Rate', min: 0, max: 100, count: 30 })).toBe('strong');
  });
  it('TRAP: small counts under 100 must NOT read as a rate', () => {
    expect(detectRateSignal({ header: 'Daily Signups', min: 0, max: 80, count: 30 })).toBe('none');
  });
  it('bounded 0–1 fraction → weak (never gates alone)', () => {
    expect(detectRateSignal({ min: 0, max: 0.9, count: 30 })).toBe('weak');
  });
});
