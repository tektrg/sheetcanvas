import { describe, expect, it } from 'vitest';
import { getPaddedChartAxisMax } from '../chartAxis';

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
