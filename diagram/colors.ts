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
