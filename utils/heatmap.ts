import type { HeatmapColor } from '../types';

// RGB triplets (as "r, g, b" strings for rgba()) for each single-hue palette.
const SINGLE_HUE_RGB: Record<'red' | 'green' | 'yellow', string> = {
  red: '239, 68, 68',
  green: '13, 148, 136',
  yellow: '234, 179, 8',
};

// Diverging endpoints: negative side red, positive side green (matches SINGLE_HUE_RGB).
const DIVERGING_NEGATIVE_RGB = SINGLE_HUE_RGB.red;
const DIVERGING_POSITIVE_RGB = SINGLE_HUE_RGB.green;

// Opacity envelope shared with the single-hue heatmap so text stays readable.
const MIN_OPACITY = 0.1;
const OPACITY_SPAN = 0.5;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));

const toRgba = (rgb: string, ratio: number): string =>
  `rgba(${rgb}, ${MIN_OPACITY + clamp01(ratio) * OPACITY_SPAN})`;

/**
 * Single-hue heatmap: shade by rank between the range min and max.
 * Returns 'transparent' when the value is non-numeric or the range is flat.
 */
export function singleHueHeatmapColor(
  value: number,
  min: number,
  max: number,
  colorKey: 'red' | 'green' | 'yellow',
): string {
  if (isNaN(value) || max === min) return 'transparent';
  const ratio = (value - min) / (max - min);
  return toRgba(SINGLE_HUE_RGB[colorKey], ratio);
}

/**
 * Diverging heatmap: zero is the neutral anchor. Negatives shade toward red and
 * positives toward green, each side scaled independently to its own extreme so the
 * most-negative cell is full red and the most-positive cell is full green. When
 * `flip` is true the polarity swaps (negatives green, positives red).
 *
 * `min` / `max` are the range's most-negative and most-positive numeric values.
 */
export function divergingHeatmapColor(
  value: number,
  min: number,
  max: number,
  flip = false,
): string {
  if (isNaN(value) || value === 0) return 'transparent';

  const negativeRgb = flip ? DIVERGING_POSITIVE_RGB : DIVERGING_NEGATIVE_RGB;
  const positiveRgb = flip ? DIVERGING_NEGATIVE_RGB : DIVERGING_POSITIVE_RGB;

  if (value > 0) {
    if (max <= 0) return 'transparent';
    return toRgba(positiveRgb, value / max);
  }
  // value < 0
  if (min >= 0) return 'transparent';
  return toRgba(negativeRgb, value / min); // value and min both negative → positive ratio
}

/**
 * Resolve the background color for a heatmap cell given its palette selection.
 */
export function heatmapCellColor(
  value: number,
  min: number,
  max: number,
  colorKey: HeatmapColor | undefined,
  flip = false,
): string {
  if (colorKey === 'diverging') return divergingHeatmapColor(value, min, max, flip);
  return singleHueHeatmapColor(value, min, max, colorKey ?? 'green');
}
