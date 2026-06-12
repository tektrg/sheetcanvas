import type { ConnectorConfig, GoogleAnalyticsReport, SheetData } from '../types';
import { clickhouseResultToMatrix, queryClickhouse } from './clickhouseBackend';
import { googleAnalyticsResultToMatrix, queryGoogleAnalytics } from './googleAnalyticsBackend';
import { DEFAULT_GOOGLE_SHEETS_RANGE, googleSheetsResultToMatrix, queryGoogleSheets } from './googleSheetsBackend';
import { applyMatrixToSheet } from './connectorSheet';
import { MAX_CONNECTED_IMPORT_COLS, MAX_IMPORT_ROWS } from '../constants';

export type NormalizedConnectorQuery =
  | { type: 'clickhouse'; sql: string }
  | { type: 'google-analytics'; propertyId: string; report: GoogleAnalyticsReport }
  | { type: 'google-sheets'; spreadsheetIdOrUrl: string; range: string };

export type ConnectedSheetRefreshResult = {
  size: SheetData['size'];
  cells: SheetData['cells'];
  connectorConfig: ConnectorConfig;
  truncationMessage: string;
};

export function readConnectorQuery(config: ConnectorConfig): NormalizedConnectorQuery | null {
  const params = config.params ?? {};

  if (config.type === 'clickhouse') {
    const query = config.query && 'sql' in config.query ? config.query : null;
    return { type: 'clickhouse', sql: String(query?.sql ?? params.sql ?? '').trim() };
  }

  if (config.type === 'google-analytics') {
    const query = config.query && 'propertyId' in config.query ? config.query : null;
    return {
      type: 'google-analytics',
      propertyId: String(query?.propertyId ?? params.propertyId ?? '').trim(),
      report: ((query?.report ?? params.report) as GoogleAnalyticsReport | undefined) ?? {},
    };
  }

  if (config.type === 'google-sheets') {
    const query = config.query && 'spreadsheetIdOrUrl' in config.query ? config.query : null;
    return {
      type: 'google-sheets',
      spreadsheetIdOrUrl: String(query?.spreadsheetIdOrUrl ?? params.spreadsheetIdOrUrl ?? params.sheetId ?? '').trim(),
      range: String(query?.range ?? params.range ?? DEFAULT_GOOGLE_SHEETS_RANGE).trim() || DEFAULT_GOOGLE_SHEETS_RANGE,
    };
  }

  return null;
}

export function validateConnectorQuery(config: ConnectorConfig, query: NormalizedConnectorQuery): string | null {
  if (!config.connectionId?.trim()) return 'A real connection is required';

  if (query.type === 'clickhouse' && !query.sql.trim()) return 'SQL is required';
  if (query.type === 'google-analytics' && !query.propertyId.trim()) return 'GA4 property ID is required';
  if (query.type === 'google-sheets' && !query.spreadsheetIdOrUrl.trim()) return 'Google Sheets URL or ID is required';

  return null;
}

export function buildConnectorConfigWithQuery(
  config: ConnectorConfig,
  query: NormalizedConnectorQuery,
  updates: Partial<ConnectorConfig> = {},
): ConnectorConfig {
  const queryValue =
    query.type === 'clickhouse'
      ? { sql: query.sql.trim() }
      : query.type === 'google-analytics'
        ? { propertyId: query.propertyId.trim(), report: query.report }
        : { spreadsheetIdOrUrl: query.spreadsheetIdOrUrl.trim(), range: query.range.trim() || DEFAULT_GOOGLE_SHEETS_RANGE };

  return {
    ...config,
    query: queryValue,
    ...updates,
  };
}

export function getConnectorQuerySummary(config: ConnectorConfig): string {
  const query = readConnectorQuery(config);
  if (!query) return '';

  if (query.type === 'clickhouse') {
    return query.sql.split('\n').map(line => line.trim()).find(Boolean) ?? '';
  }

  if (query.type === 'google-analytics') {
    const dimensions = query.report.dimensions?.map(item => item.name).filter(Boolean).join(', ') || 'no dimensions';
    const metrics = query.report.metrics?.map(item => item.name).filter(Boolean).join(', ') || 'no metrics';
    const dateRange = query.report.dateRanges?.[0];
    const dateLabel = dateRange ? `${dateRange.startDate} to ${dateRange.endDate}` : 'default dates';
    return `${query.propertyId || 'No property'} - ${dimensions} - ${metrics} - ${dateLabel}`;
  }

  const range = query.range || DEFAULT_GOOGLE_SHEETS_RANGE;
  return `${query.spreadsheetIdOrUrl || 'No spreadsheet'} - ${range}`;
}

export async function refreshConnectedSheetFromQuery(
  config: ConnectorConfig,
  query: NormalizedConnectorQuery,
): Promise<ConnectedSheetRefreshResult> {
  const validationError = validateConnectorQuery(config, query);
  if (validationError) throw new Error(validationError);

  const connectorId = config.connectionId!.trim();
  let matrix: string[][];
  let sourceTruncated = false;

  if (query.type === 'clickhouse') {
    const result = await queryClickhouse({ connectorId, sql: query.sql.trim() });
    matrix = clickhouseResultToMatrix(result);
    sourceTruncated = !!result.truncated;
  } else if (query.type === 'google-analytics') {
    const result = await queryGoogleAnalytics({
      connectorId,
      propertyId: query.propertyId.trim(),
      report: query.report,
    });
    matrix = googleAnalyticsResultToMatrix(result);
    sourceTruncated = !!result.truncated;
  } else {
    const result = await queryGoogleSheets({
      connectorId,
      spreadsheetIdOrUrl: query.spreadsheetIdOrUrl.trim(),
      range: query.range.trim() || DEFAULT_GOOGLE_SHEETS_RANGE,
    });
    matrix = googleSheetsResultToMatrix(result);
    sourceTruncated = !!result.truncated;
  }

  const next = applyMatrixToSheet(matrix);
  return {
    size: next.size,
    cells: next.cells,
    connectorConfig: buildConnectorConfigWithQuery(config, query, {
      lastRefreshedAt: Date.now(),
      truncated: sourceTruncated || next.truncated,
      lastError: '',
    }),
    truncationMessage: getConnectorTruncationMessage(sourceTruncated, next.truncated),
  };
}

function getConnectorTruncationMessage(sourceTruncated: boolean, localTruncated: boolean) {
  if (localTruncated) return `Dataset truncated to ${MAX_IMPORT_ROWS} rows / ${MAX_CONNECTED_IMPORT_COLS} cols`;
  if (sourceTruncated) return 'Connector returned truncated data';
  return '';
}
