import { describe, expect, it } from 'vitest';
import {
  divergingHeatmapColor,
  heatmapCellColor,
  singleHueHeatmapColor,
} from '../heatmap';

// Helper: extract the numeric opacity (last channel) from an "rgba(r, g, b, a)" string.
const opacityOf = (rgba: string): number => {
  const match = rgba.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/);
  if (!match) throw new Error(`not an rgba string: ${rgba}`);
  return parseFloat(match[1]);
};

const RED = '239, 68, 68';
const GREEN = '13, 148, 136';

describe('singleHueHeatmapColor', () => {
  it('returns transparent for non-numeric values or a flat range', () => {
    expect(singleHueHeatmapColor(NaN, 0, 10, 'green')).toBe('transparent');
    expect(singleHueHeatmapColor(5, 5, 5, 'green')).toBe('transparent');
  });

  it('shades by rank between min and max regardless of sign', () => {
    // All-negative column still gets the full ramp (sign-blind, pre-existing behavior).
    const min = singleHueHeatmapColor(-100, -100, -10, 'green');
    const max = singleHueHeatmapColor(-10, -100, -10, 'green');
    expect(opacityOf(min)).toBeLessThan(opacityOf(max));
    expect(min).toContain(GREEN);
  });
});

describe('divergingHeatmapColor', () => {
  it('anchors neutral at zero (transparent) and for non-numeric values', () => {
    expect(divergingHeatmapColor(0, -100, 100)).toBe('transparent');
    expect(divergingHeatmapColor(NaN, -100, 100)).toBe('transparent');
  });

  it('colors positives green and negatives red', () => {
    expect(divergingHeatmapColor(50, -100, 100)).toContain(GREEN);
    expect(divergingHeatmapColor(-50, -100, 100)).toContain(RED);
  });

  it('scales each side independently to its own extreme', () => {
    // max=+5, min=-5000: a small positive is fully saturated on its own side.
    const strongestPositive = divergingHeatmapColor(5, -5000, 5);
    const strongestNegative = divergingHeatmapColor(-5000, -5000, 5);
    // Both hit the top of the opacity envelope (0.1 + 1*0.5 = 0.6).
    expect(opacityOf(strongestPositive)).toBeCloseTo(0.6, 5);
    expect(opacityOf(strongestNegative)).toBeCloseTo(0.6, 5);
  });

  it('shows no red when the whole range is positive', () => {
    // colMin is positive → negative branch never taken; positives still green.
    expect(divergingHeatmapColor(5, 5, 10)).toContain(GREEN);
    expect(divergingHeatmapColor(10, 5, 10)).toContain(GREEN);
  });

  it('shows no green when the whole range is negative', () => {
    expect(divergingHeatmapColor(-5, -10, -1)).toContain(RED);
  });

  it('flip swaps the polarity (negatives green, positives red)', () => {
    expect(divergingHeatmapColor(50, -100, 100, true)).toContain(RED);
    expect(divergingHeatmapColor(-50, -100, 100, true)).toContain(GREEN);
  });
});

describe('heatmapCellColor dispatch', () => {
  it('routes diverging to the sign-aware calculator', () => {
    expect(heatmapCellColor(-50, -100, 100, 'diverging')).toContain(RED);
  });

  it('routes single hues and defaults to green when color is undefined', () => {
    expect(heatmapCellColor(50, 0, 100, 'red')).toContain(RED);
    expect(heatmapCellColor(50, 0, 100, undefined)).toContain(GREEN);
  });
});
