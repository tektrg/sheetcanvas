

export const CELL_WIDTH = 100;
export const CELL_HEIGHT = 34; // Slightly taller for breathing room
export const HEADER_COL_WIDTH = 44;
export const HEADER_ROW_HEIGHT = 30;
export const MIN_COL_WIDTH = 40;

export const INITIAL_ROWS = 8;
export const INITIAL_COLS = 6;

// Limits to prevent performance issues
export const MAX_IMPORT_ROWS = 50000; // Keep high to allow full data storage
export const MAX_IMPORT_COLS = 50;
export const MAX_RENDER_ROWS = 100; // Strict UI rendering limit for performance

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 3;

export const COLOR_PALETTE = {
  light: {
    grid: '#f0f0f0', // Very subtle grid dots
    headerBg: '#f7f7f5', // Notion-like light gray
    headerText: '#787774', // Notion-like text gray
    selection: '#0d9488', // teal-600
    selectionBg: 'rgba(13, 148, 136, 0.14)', 
  },
  dark: {
    grid: '#262626', 
    headerBg: '#1f1f1f', 
    headerText: '#9ca3af', 
    selection: '#14b8a6', // teal-500
    selectionBg: 'rgba(20, 184, 166, 0.2)',
  }
};

export const CHART_COLORS = [
  '#0d9488', // Teal
  '#eb5757', // Red
  '#f2c94c', // Yellow
  '#27ae60', // Green
  '#9b51e0', // Purple
  '#f2994a', // Orange
  '#56ccf2', // Light Blue
  '#ff9f43', // Pastel Orange
];

export const DEFAULT_CHART_SIZE = { width: 400, height: 400 };

// Notion-like pastel colors
export const NOTE_COLORS = {
  yellow: { bg: '#fff9c4', border: '#f5e79e', text: '#5c4b18' }, 
  blue: { bg: '#e3f2fd', border: '#bbdefb', text: '#0d47a1' },   
  green: { bg: '#e8f5e9', border: '#c8e6c9', text: '#1b5e20' },  
  pink: { bg: '#fce4ec', border: '#f8bbd0', text: '#880e4f' },   
  purple: { bg: '#f3e5f5', border: '#e1bee7', text: '#4a148c' }, 
  gray: { bg: '#f5f5f5', border: '#eeeeee', text: '#424242' },   
  
};

export const NOTE_COLORS_DARK = {
  yellow: { bg: '#422006', border: '#713f12', text: '#fef08a' }, 
  blue: { bg: '#172554', border: '#1e3a8a', text: '#bfdbfe' },   
  green: { bg: '#052e16', border: '#14532d', text: '#bbf7d0' },  
  pink: { bg: '#500724', border: '#831843', text: '#fbcfe8' },   
  purple: { bg: '#3b0764', border: '#581c87', text: '#e9d5ff' }, 
  gray: { bg: '#262626', border: '#404040', text: '#e5e5e5' },   
};