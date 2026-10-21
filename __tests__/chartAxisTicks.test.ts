import { describe, expect, it } from 'vitest';
import { formatAxisTick } from '../utils/formatting';
import { toChartNumber, formatCompact } from '../shared/numberFormat';
import { formatCompact as serverFormatCompact } from '../backend/src/render/escape';

describe('formatAxisTick', () => {
  it('compacts large values instead of printing every digit', () => {
    expect(formatAxisTick(3800000)).toBe('3.8M');
    expect(formatAxisTick(1200)).toBe('1.2K');
    expect(formatAxisTick(40000000004)).toBe('40B');
    expect(formatAxisTick(3800000, { type: 'number' })).toBe('3.8M');
  });
  it('handles decimals, float noise and negatives', () => {
    expect(formatAxisTick(0.1 + 0.2)).toBe('0.3');
    expect(formatAxisTick(0.77)).toBe('0.8');
    expect(formatAxisTick(-2500)).toBe('-2.5K');
    expect(formatAxisTick(0)).toBe('0');
  });
  it('coerces numeric strings', () => {
    expect(formatAxisTick('1200000')).toBe('1.2M');
    expect(formatAxisTick('abc')).toBe('abc');
  });
  it('keeps explicit currency/percent formats', () => {
    expect(formatAxisTick(1200, { type: 'currency' })).toBe('$1,200.00');
    expect(formatAxisTick('0.25', { type: 'percent' })).toBe('25%');
  });
  it('matches the server renderer formatter', () => {
    expect(serverFormatCompact).toBe(formatCompact);
  });
});

describe('toChartNumber', () => {
  it('coerces numbers stored as strings', () => {
    expect(toChartNumber('3,400')).toBe(3400);
    expect(toChartNumber('-0.5')).toBe(-0.5);
    expect(toChartNumber('')).toBeNull();
    expect(toChartNumber('n/a')).toBeNull();
    expect(toChartNumber(NaN)).toBeNull();
  });
});
