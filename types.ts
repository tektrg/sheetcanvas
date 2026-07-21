

import React from 'react';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

// `heatmapColor` selects the heatmap palette. Single-hue ('red' | 'green' | 'yellow')
// shades by rank between the column/row min and max. 'diverging' is sign-aware:
// zero is the neutral anchor, negatives shade red and positives shade green, each
// side scaled independently to its own extreme. `heatmapFlip` swaps the diverging
// polarity (green negative / red positive) for metrics where lower is better.
export type HeatmapColor = 'red' | 'green' | 'yellow' | 'diverging';
export type CellVisual = 'bar' | 'bar-row' | 'heatmap' | 'heatmap-row' | 'sparkline';

export type CellFormat =
  | { type: 'number'; decimals?: number; d3Format?: string; visual?: CellVisual; heatmapColor?: HeatmapColor; heatmapFlip?: boolean }
  | { type: 'currency'; symbol?: string; decimals?: number; d3Format?: string; visual?: CellVisual; heatmapColor?: HeatmapColor; heatmapFlip?: boolean }
  | { type: 'percent'; decimals?: number; d3Format?: string; visual?: CellVisual; heatmapColor?: HeatmapColor; heatmapFlip?: boolean }
  | { type: 'date'; dateFormat?: string; visual?: CellVisual; heatmapColor?: HeatmapColor; heatmapFlip?: boolean }
  | { type: 'text'; visual?: CellVisual; heatmapColor?: HeatmapColor; heatmapFlip?: boolean };

export interface SheetFormatRule {
  range: string;
  format: CellFormat;
  reason?: string;
  createdBy?: 'mcp' | 'user';
}

export interface CellData {
  raw: string;     // The formula or raw value entered by user (e.g., "=SUM(A1:A2)")
  value: string | number | null; // The computed result
  error?: string;
  format?: CellFormat;
}

export type PivotOperation = 'SUM' | 'COUNT' | 'AVG' | 'MIN' | 'MAX';

export interface PivotCondition {
  id?: string;
  columnId: string; // "A", "B", etc.
  type: FilterType;
  operator: FilterOperator;
  value: any; // string, number, [number, number], [string, string]
}

export interface PivotValue {
  column?: string;
  operation: PivotOperation;
  label?: string;
  conditions?: PivotCondition[];
  countRows?: boolean;
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
// S2 "direction of good": which way is an improvement for a given metric. Used
// to color the Change cell green=better / red=worse (not green=up). 'unknown'
// renders neutral single-hue intensity rather than guessing a polarity.
export type GoodDirection = 'up' | 'down' | 'unknown';
// Optional summary columns appended to the sparkline table (S1 KPI overview).
export type SparklineSummaryColumn = 'avg' | 'minmax' | 'share';

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

  // Optional extra summary columns (Avg, Min/Max, Share-of-total).
  summaryColumns?: SparklineSummaryColumn[];
  // Per-metric direction-of-good, keyed by the row's metric label. When absent
  // for a row, direction is inferred from the metric name; unknown → neutral.
  goodDirections?: Record<string, GoodDirection>;
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
export type ConnectorType = 'google-sheets' | 'google-analytics' | 'clickhouse';

// Connector types that support schema discovery + query sheets (the registered providers).
export type QueryableConnectorType = 'clickhouse' | 'google-analytics' | 'google-sheets';

// Result of describeConnection, scoped to one connection (and optionally a table/property).
// Issued as a schemaToken so createQuerySheet can verify the agent described the source first.
export interface ConnectionSchemaScope {
  connectionId: string;
  type: QueryableConnectorType;
  table?: string;
  propertyId?: string;
  createdAt: number;
}

export type ClickhouseQuery = { sql: string };
export type GaQuery = { propertyId: string; report: GoogleAnalyticsReport };
export type GoogleSheetsQuery = { spreadsheetIdOrUrl: string; range?: string };

// Connector-specific query payload. Each connector provider owns the meaning of its payload;
// the surrounding `ConnectorConfig.type` is the discriminant.
export type ConnectorQueryPayload = ClickhouseQuery | GaQuery | GoogleSheetsQuery;

// Versioned envelope persisted on a connected sheet. The payload shape is connector-owned,
// keeping the "query" abstraction stable while letting each connector evolve independently.
export interface ConnectorQueryEnvelope<TPayload = ConnectorQueryPayload> {
  version: number;
  payload: TPayload;
}

export type ConnectorQueryBriefStatus = 'current' | 'stale';

export interface ConnectorQueryBrief {
  logic: string;
  scope: string[];
  sources: string[];
  judgmentNotes: string[];
  status?: ConnectorQueryBriefStatus;
  updatedAt?: number;
}

export type GoogleAnalyticsReport = {
  dateRanges?: Array<{ startDate: string; endDate: string }>;
  dimensions?: Array<{ name: string }>;
  metrics?: Array<{ name: string }>;
  dimensionFilter?: unknown;
  metricFilter?: unknown;
  orderBys?: unknown[];
  limit?: number;
};

export interface ConnectorConfig {
  type: ConnectorType;
  name: string;
  connectionId?: string;
  query?: ConnectorQueryEnvelope;
  derivation?: string;
  brief?: ConnectorQueryBrief;
  healthStatus?: 'healthy' | 'needs_reconnect' | 'error';
  healthErrorCode?: string;
  lastRefreshedAt?: number;
  truncated?: boolean;
  lastError?: string;
  params?: Record<string, unknown>;
}

export interface ConnectorResult {
  title: string;
  data: string[][]; // Matrix of data [rows][cols]
  truncated?: boolean;
}

export interface PrivateQueryResult {
  id: string;
  title: string;
  connectionId: string;
  type: QueryableConnectorType;
  matrix: string[][];
  connectorConfig: ConnectorConfig;
  rowCount: number;
  createdAt: number;
  updatedAt: number;
  queryDiagnostics?: unknown;
}

export interface SheetData {
  id: string;
  position: Position;
  size: Size; // Number of rows/cols, not pixels
  title: string;
  cells: Record<string, CellData>; // Keyed by "A1", "B2", etc.
  colWidths?: Record<string, number>; // Key: stringified index "0", "1"
  pivotConfig?: PivotConfig; // If present, this sheet is a pivot table linked to sourceSheetId
  pivotWarnings?: string[]; // Scoped warnings from pivot materialization
  // Warnings from the last propagated refresh: source columns this derived sheet
  // referenced were dropped/renamed/reordered. Distinct from pivotWarnings (which
  // describe materialization issues like blank SUMIF buckets). Surfaced on the card
  // and in the agent canvas summary; cleared on a clean refresh.
  refreshWarnings?: string[];
  sparklineConfig?: SparklineConfig; // If present, this sheet is a sparkline table
  connectorConfig?: ConnectorConfig; // If present, this sheet is connected to external data
  formatRules?: SheetFormatRule[]; // Presentation rules reapplied after derived-sheet refreshes
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
export type ChartColorSchemeId = 'neon' | 'pastel' | 'mono' | 'custom';
export type ChartColorSchemeOverride = 'workspace' | ChartColorSchemeId;

export interface ChartColorSettings {
  schemeId: ChartColorSchemeId;
  monoBaseColor: string;
  customPresetInput: string;
}

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
  colorScheme?: ChartColorSchemeOverride;
  colorOverride?: boolean;
  highlightIndex: number; // -1 for none
  animation: boolean;
  type: ChartType;
  stacked?: boolean;
  showLabels?: boolean;
  rightAxisColumns?: string[]; // Columns that should use the right Y-axis
  seriesTypes?: Record<string, ChartType>; // Override type for specific series
  seriesDisplayNames?: Record<string, string>; // Presentation labels keyed by column id or group series key
}

export interface ChartData {
  id: string;
  sourceSheetId: string;
  position: Position;
  size: Size;
  title: string;
  config: ChartConfig;
  setupRequired?: boolean; // If true, show setup UI in the card
  // Warnings from the last propagated refresh (e.g. a series column was dropped
  // because the source removed/renamed it). Cleared on a clean refresh.
  refreshWarnings?: string[];
}

export type NoteColor = 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'gray';

export type NoteContentFormat = 'html' | 'markdown';

export interface NoteData {
  id: string;
  position: Position;
  size: Size; // In pixels
  content: string;
  color: NoteColor;
  // Undefined = legacy HTML note (contentEditable). 'markdown' = MDX-lite note
  // rendered via markdown-to-jsx with a whitelist of live components.
  format?: NoteContentFormat;
  // Original HTML preserved when a legacy note is migrated to markdown, so a
  // bad conversion can be recovered / rendered as a fallback.
  legacyHtml?: string;
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
  category: 'Suggested' | 'Navigation' | 'Sheet' | 'Cell' | 'Canvas' | 'Chart' | 'Calculator' | 'Data' | 'Go to' | 'Agent';
  action: () => void;
  keywords?: string[]; // For better search matching
}
