export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface CellData {
  raw: string;     // The formula or raw value entered by user (e.g., "=SUM(A1:A2)")
  value: string | number | null; // The computed result
  error?: string;
}

export interface SheetData {
  id: string;
  position: Position;
  size: Size; // Number of rows/cols, not pixels
  title: string;
  cells: Record<string, CellData>; // Keyed by "A1", "B2", etc.
}

export interface CanvasTransform {
  scale: number;
  offset: Position;
}

export type CellCoordinate = { col: number; row: number }; // 0-indexed

export enum ToolMode {
  SELECT = 'SELECT',
  PAN = 'PAN',
}

export type ChartType = 'line' | 'bar' | 'pie' | 'area';

export interface ChartConfig {
  labelColumn: string; // Column letter, e.g. "A"
  dataColumns: string[]; // Array of column letters, e.g. ["B"]
  color: string;
  highlightIndex: number; // -1 for none
  animation: boolean;
  groupBy?: string;
  type: ChartType;
}

export interface ChartData {
  id: string;
  sourceSheetId: string;
  position: Position;
  size: Size;
  title: string;
  config: ChartConfig;
}

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'gray';

export interface NoteData {
  id: string;
  position: Position;
  size: Size; // In pixels
  content: string;
  color: NoteColor;
}