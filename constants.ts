export const CELL_WIDTH = 100;
export const CELL_HEIGHT = 32;
export const HEADER_COL_WIDTH = 40;
export const HEADER_ROW_HEIGHT = 28;

export const INITIAL_ROWS = 8;
export const INITIAL_COLS = 6;

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 3;

export const COLOR_PALETTE = {
  light: {
    grid: '#e5e5e5', // neutral-200
    headerBg: '#fafafa', // neutral-50
    headerText: '#737373', // neutral-500
    selection: '#14b8a6', // teal-500
    selectionBg: 'rgba(20, 184, 166, 0.1)', // teal-500 @ 10%
  },
  dark: {
    grid: '#262626', // neutral-800 (Subtle on neutral-900)
    headerBg: '#262626', // neutral-800
    headerText: '#a3a3a3', // neutral-400
    selection: '#2dd4bf', // teal-400
    selectionBg: 'rgba(45, 212, 191, 0.2)', // teal-400 @ 20%
  }
};

export const CHART_COLORS = [
  '#93c5fd', // Pastel Blue
  '#fca5a5', // Pastel Red
  '#86efac', // Pastel Green
  '#fde047', // Pastel Yellow
  '#c4b5fd', // Pastel Violet
  '#f9a8d4', // Pastel Pink
  '#a5b4fc', // Pastel Indigo
  '#5eead4', // Pastel Teal
];

export const DEFAULT_CHART_SIZE = { width: 400, height: 300 };

export const NOTE_COLORS = {
  yellow: { bg: '#fef08a', border: '#fde047', text: '#854d0e' }, // yellow-200/300/800
  blue: { bg: '#bfdbfe', border: '#93c5fd', text: '#1e40af' },   // blue-200/300/800
  green: { bg: '#bbf7d0', border: '#86efac', text: '#166534' },  // green-200/300/800
  pink: { bg: '#fbcfe8', border: '#f9a8d4', text: '#9d174d' },   // pink-200/300/800
  purple: { bg: '#e9d5ff', border: '#d8b4fe', text: '#6b21a8' }, // purple-200/300/800
  gray: { bg: '#e5e5e5', border: '#d4d4d4', text: '#404040' },   // neutral-200/300/700
};

export const NOTE_COLORS_DARK = {
  yellow: { bg: '#422006', border: '#713f12', text: '#fef08a' }, // yellow-950/900/200
  blue: { bg: '#172554', border: '#1e3a8a', text: '#bfdbfe' },   // blue-950/900/200
  green: { bg: '#052e16', border: '#14532d', text: '#bbf7d0' },  // green-950/900/200
  pink: { bg: '#500724', border: '#831843', text: '#fbcfe8' },   // pink-950/900/200
  purple: { bg: '#3b0764', border: '#581c87', text: '#e9d5ff' }, // purple-950/900/200
  gray: { bg: '#262626', border: '#404040', text: '#e5e5e5' },   // neutral-800/700/200
};