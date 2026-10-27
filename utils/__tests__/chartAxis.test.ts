import { describe, expect, it } from 'vitest';
import { getChartAxisScale, getPaddedChartAxisMax } from '../chartAxis';

describe('getPaddedChartAxisMax', () => {
  it('rounds a padded maximum to a stable two-significant-digit ceiling', () => {
    expect(getPaddedChartAxisMax(216)).toBe(240);
    expect(getPaddedChartAxisMax(1)).toBe(1.1);
    expect(String(getPaddedChartAxisMax(216))).not.toContain('000000000');
  });

  it('keeps small decimal ranges free of floating-point artifacts', () => {
    expect(getPaddedChartAxisMax(0.216)).toBe(0.24);
  });

  it('lets the chart library choose a domain when no positive finite maximum exists', () => {
    expect(getPaddedChartAxisMax(0)).toBe('auto');
    expect(getPaddedChartAxisMax(Number.POSITIVE_INFINITY)).toBe('auto');
  });
});

describe('getChartAxisScale', () => {
  it('keeps the 0 baseline for all-positive data', () => {
    expect(getChartAxisScale(0, 90)).toEqual({ domain: [0, 99] });
  });
  it('extends below 0 on nice ticks that include 0', () => {
    expect(getChartAxisScale(-40, 90)).toEqual({ domain: [-50, 100], ticks: [-50, 0, 50, 100] });
    expect(getChartAxisScale(-0.3, 0.8).ticks).toContain(0);
  });
  it('caps all-negative data at 0', () => {
    expect(getChartAxisScale(-40, 0)).toEqual({ domain: [-50, 0], ticks: [-50, -40, -30, -20, -10, 0] });
  });
});
