

import React from 'react';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type CellFormat = 
  | { type: 'number'; decimals?: number; d3Format?: string; visual?: 'bar' | 'bar-row' | 'heatmap' | 'heatmap-row' | 'sparkline'; heatmapColor?: 'red' | 'green' | 'yellow' }
  | { type: 'currency'; symbol?: string; decimals?: number; d3Format?: string; visual?: 'bar' | 'bar-row' | 'heatmap' | 'heatmap-row' | 'sparkline'; heatmapColor?: 'red' | 'green' | 'yellow' }
  | { type: 'percent'; decimals?: number; d3Format?: string; visual?: 'bar' | 'bar-row' | 'heatmap' | 'heatmap-row' | 'sparkline'; heatmapColor?: 'red' | 'green' | 'yellow' }
  | { type: 'date'; dateFormat?: string; visual?: 'bar' | 'bar-row' | 'heatmap' | 'heatmap-row' | 'sparkline'; heatmapColor?: 'red' | 'green' | 'yellow' }
  | { type: 'text'; visual?: 'bar' | 'bar-row' | 'heatmap' | 'heatmap-row' | 'sparkline'; heatmapColor?: 'red' | 'green' | 'yellow' };

export interface CellData {
  raw: string;     // The formula or raw value entered by user (e.g., "=SUM(A1:A2)")
  value: string | number | null; // The computed result
  error?: string;
  format?: CellFormat;
}

export type PivotOperation = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';

export interface PivotValue {
  column: string;
  operation: PivotOperation;
}

export interface PivotConfig {
  sourceSheetId: string;
  rowLabelCol: string; // Column ID
  colLabelCol?: string; // Column ID (optional)
  
  values: PivotValue[]; // Array of value configurations

  // Legacy support fields (optional)
  valueCol?: string;    
  operation?: PivotOperation;

  showRowTotals?: boolean;
  showColTotals?: boolean;
}

export type SparklineMode = 'metrics' | 'group';
export type SparklineCompareMode = 'vs_prev' | 'vs_avg' | 'vs_first';

export interface SparklineConfig {
  sourceSheetId: string;
  dateCol: string;
  mode: SparklineMode;
  compareMode?: SparklineCompareMode; // Default is 'vs_avg'
  
  // For 'metrics' mode
  dataCols?: string[]; // Array of column IDs
  
  // For 'group' mode
  groupCol?: string;
  valueCol?: string;
  operation?: PivotOperation;
}

export type FilterType = 'text' | 'number' | 'date';

export type FilterOperator = 
  | 'contains' | 'equals' | 'startsWith' | 'endsWith' // text
  | 'gt' | 'lt' | 'eq' | 'neq' | 'range' // number
  | 'before' | 'after' | 'on' | 'range'; // date

export interface FilterCondition {
  id: string;
  columnId: string; // "A", "B", etc.
  type: FilterType;
  operator: FilterOperator;
  value: any; // string, number, [number, number], [string, string]
}

export interface SortConfig {
  columnId: string;
  direction: 'asc' | 'desc';
}

// Data Connector Types
export type ConnectorType = 'google-sheets' | 'google-analytics' | 'csv-url' | 'clickhouse';

export interface ConnectorConfig {
  type: ConnectorType;
  name: string;
  // Generic params bucket
  params: Record<string, unknown>;
}

export interface ConnectorResult {
  title: string;
  data: string[][]; // Matrix of data [rows][cols]
}

export interface SheetData {
  id: string;
  position: Position;
  size: Size; // Number of rows/cols, not pixels
  title: string;
  cells: Record<string, CellData>; // Keyed by "A1", "B2", etc.
  colWidths?: Record<string, number>; // Key: stringified index "0", "1"
  pivotConfig?: PivotConfig; // If present, this sheet is a pivot table linked to sourceSheetId
  sparklineConfig?: SparklineConfig; // If present, this sheet is a sparkline table
  connectorConfig?: ConnectorConfig; // If present, this sheet is connected to external data
  setupRequired?: boolean; // If true, show setup UI
  filters?: FilterCondition[];
  sort?: SortConfig;
  showFilterPanel?: boolean; // Controls UI visibility of filter panel
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

export type ChartType = 'line' | 'bar' | 'pie' | 'area' | 'scatter' | 'treemap';
export type ChartMode = 'metrics' | 'group';
export type TimeGranularity = 'day' | 'week' | 'month' | 'quarter' | 'year';

export interface ChartConfig {
  mode?: ChartMode; // Default to 'metrics' if undefined
  
  // Metrics Mode (Manual Series)
  labelColumn: string; // Column letter, e.g. "A"
  dataColumns: string[]; // Array of column letters, e.g. ["B"]
  
  // Group Mode
  groupCol?: string; // X-Axis in Group Mode
  seriesGroupCol?: string; // Series Split in Group Mode
  valueCol?: string;
  operation?: PivotOperation;
  timeGranularity?: TimeGranularity; // If groupCol is a date

  color: string;
  highlightIndex: number; // -1 for none
  animation: boolean;
  type: ChartType;
  stacked?: boolean;
  showLabels?: boolean;
  rightAxisColumns?: string[]; // Columns that should use the right Y-axis
  seriesTypes?: Record<string, ChartType>; // Override type for specific series
}

export interface ChartData {
  id: string;
  sourceSheetId: string;
  position: Position;
  size: Size;
  title: string;
  config: ChartConfig;
  setupRequired?: boolean; // If true, show setup UI in the card
}

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'gray';

export interface NoteData {
  id: string;
  position: Position;
  size: Size; // In pixels
  content: string;
  color: NoteColor;
}

export interface SelectionContext {
  sheetId: string | null;
  cellId: string | null; // e.g., "A1"
  range: { start: CellCoordinate; end: CellCoordinate } | null;
}

export interface Command {
  id: string;
  label: string;
  subLabel?: string;
  icon?: React.ReactNode;
  shortcut?: string[]; 
  category: 'Suggested' | 'Navigation' | 'Sheet' | 'Cell' | 'Canvas' | 'Chart' | 'Calculator' | 'Data' | 'Go to';
  action: () => void;
  keywords?: string[]; // For better search matching
}
