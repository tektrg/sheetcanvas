// Named colors agents may use; anything else (e.g. hex) passes through.
const NAMED_COLORS: Record<string, string> = {
  yellow: '#ffec99',
  blue: '#a5d8ff',
  green: '#b2f2bb',
  pink: '#fcc2d7',
  purple: '#d0bfff',
  gray: '#e9ecef',
  red: '#ffc9c9',
  orange: '#ffd8a8',
};

export const resolveColor = (color: string): string => NAMED_COLORS[color.toLowerCase()] ?? color;

// Stroke (line/text) colors: saturated, readable on white.
const NAMED_STROKES: Record<string, string> = {
  black: '#1e1e1e',
  yellow: '#f08c00',
  blue: '#1971c2',
  green: '#2f9e44',
  pink: '#c2255c',
  purple: '#6741d9',
  gray: '#868e96',
  red: '#e03131',
  orange: '#e8590c',
};

export const resolveStrokeColor = (color: string): string => NAMED_STROKES[color.toLowerCase()] ?? color;
