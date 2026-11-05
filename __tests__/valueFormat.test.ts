import { describe, expect, it } from 'vitest';
import type { CellFormat } from '../types';
import { formatAxisTick, formatValue } from '../utils/formatting';
import { formatAxisTickValue, formatLabelValue, formatNumericValue, isSafeD3Format, type ValueFormat } from '../shared/valueFormat';

const FORMATS: Array<CellFormat & ValueFormat> = [
  { type: 'number' },
  { type: 'number', decimals: 2 },
  { type: 'currency' },
  { type: 'currency', decimals: 0 },
  { type: 'percent' },
  { type: 'percent', decimals: 1 },
  { type: 'number', d3Format: ',.1f' },
  { type: 'currency', d3Format: '$,.0f' },
  { type: 'number', d3Format: '.2s' },
];
const VALUES = [0, 7, -3.5, 0.0421, 1234.5678, 96000, -1_250_000];

describe('shared/valueFormat (published charts) matches the canvas formatter', () => {
  it('formatNumericValue === formatValue for every numeric format and value', () => {
    for (const format of FORMATS) {
      for (const value of VALUES) expect(formatNumericValue(value, format), JSON.stringify([format, value])).toBe(formatValue(value, format));
    }
  });

  it('formatAxisTickValue === formatAxisTick (compact for plain numbers, own format otherwise)', () => {
    for (const format of [undefined, ...FORMATS]) {
      for (const value of VALUES) expect(formatAxisTickValue(value, format), JSON.stringify([format, value])).toBe(formatAxisTick(value, format));
    }
  });

  it('formats currency / percent / d3 the way the canvas does', () => {
    expect(formatNumericValue(96000, { type: 'currency', decimals: 0 })).toBe('$96,000');
    expect(formatNumericValue(0.034, { type: 'percent', decimals: 1 })).toBe('3.4%');
    expect(formatNumericValue(1234.5, { type: 'number', d3Format: ',.1f' })).toBe('1,234.5');
  });

  it('labels without a format use compact numbers instead of raw digits', () => {
    expect(formatLabelValue(1234.5678)).toBe('1.2K');
    expect(formatLabelValue(0.75)).toBe('0.75');
    expect(formatLabelValue(96000, { type: 'currency', decimals: 0 })).toBe('$96,000');
  });
});

describe('isSafeD3Format', () => {
  it('accepts normal specifiers', () => {
    for (const spec of [',.0f', '$,.2f', '.1%', '.2s', '+,d', '<<8']) expect(isSafeD3Format(spec), spec).toBe(true);
  });

  it('rejects garbage, oversized, unbounded-width and non-printable specifiers', () => {
    for (const spec of ['', 'zzz', '$(echo INJECTED)', ',.0f'.repeat(10), '99999999999', ',.999f', 'é.2f', '.2f\n', 42, null]) {
      expect(isSafeD3Format(spec), String(spec)).toBe(false);
    }
  });
});
