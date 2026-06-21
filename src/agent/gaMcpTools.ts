import type { ConnectionSchemaScope, ConnectorConfig, SheetData, SparklineConfig } from '../../types';
import { CELL_WIDTH, MAX_CONNECTED_IMPORT_COLS } from '../../constants';
import { applyMatrixToSheet } from '../../utils/connectorSheet';
import {
  googleAnalyticsResultToMatrix,
  listGoogleAnalyticsPropertiesPage,
  queryGoogleAnalytics,
} from '../../utils/googleAnalyticsBackend';
import { requestJson } from '../../utils/backendApi';
import { buildConnectorConfigWithQuery } from '../../utils/connectedSheetQueries';
import { accumulateSheetFocus } from './agentFocusAccumulator';
import { getColumnIdForIndex } from './sheetBounds';
import { normalizeConnectorQueryBrief, type ConnectorQueryBriefInput } from './queryBrief';

export type BasicConnection = { connectionId: string; type: string; name: string };

type GaTrendStore = {
  sheets: Record<string, SheetData>;
  setConnections: (connections: BasicConnection[]) => void;
  connectionSchemaTokens: Record<string, ConnectionSchemaScope>;
  getNextSheetPosition: () => { x: number; y: number };
  addSheet: (sheet: SheetData) => void;
};

export async function loadConnections(store: { setConnections: (connections: BasicConnection[]) => void }): Promise<BasicConnection[]> {
  const res = await requestJson<{ connectors: Array<{ id: string; type: string; name: string }> }>('/api/connectors');
  const connections = (res.connectors || []).map((c) => ({
    connectionId: c.id,
    type: c.type,
    name: c.name,
  }));
  store.setConnections(connections);
  return connections;
}

function getConnectionUsage(sheets: Record<string, SheetData>, connectionId: string) {
  const usedBySheets: Array<{ sheetId: string; title: string; derivation: string | null; query: ConnectorConfig['query'] | null }> = [];
  const propertyIds = new Set<string>();

  Object.values(sheets).forEach((sheet) => {
    const config = sheet.connectorConfig;
    if (!config || config.connectionId !== connectionId) return;
    const query = config.query ?? null;
    usedBySheets.push({
      sheetId: sheet.id,
      title: sheet.title,
      derivation: config.derivation ?? null,
      query,
    });
    const payload = query?.payload as Record<string, unknown> | undefined;
    if (payload && typeof payload.propertyId === 'string' && payload.propertyId) {
      propertyIds.add(payload.propertyId);
    }
  });

  return { usedBySheets, propertyIds: Array.from(propertyIds) };
}

async function describeGaConnectionHealth(connectionId: string) {
  try {
    const result = await listGoogleAnalyticsPropertiesPage({ connectorId: connectionId, pageSize: 10 });
    return {
      health: {
        status: 'ok',
        checkedAt: Date.now(),
        message: result.truncated
          ? 'Google Analytics properties are reachable; response was truncated.'
          : 'Google Analytics properties are reachable.',
      },
      propertyHints: result.properties.map((property) => ({
        propertyId: property.propertyId,
        displayName: property.displayName,
        accountDisplayName: property.accountDisplayName ?? null,
      })),
      propertiesTruncated: !!result.truncated,
    };
  } catch (err) {
    return {
      health: {
        status: 'error',
        checkedAt: Date.now(),
        message: err instanceof Error ? err.message : String(err),
      },
      propertyHints: [],
      propertiesTruncated: false,
    };
  }
}

export async function enrichConnectionsForMcp(store: GaTrendStore, basicConnections: BasicConnection[]) {
  const nameCounts = basicConnections.reduce<Record<string, number>>((acc, connection) => {
    const key = `${connection.type}:${connection.name}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  return Promise.all(
    basicConnections.map(async (connection) => {
      const usage = getConnectionUsage(store.sheets, connection.connectionId);
      const duplicateName = nameCounts[`${connection.type}:${connection.name}`] > 1;
      if (connection.type === 'google-analytics') {
        const health = await describeGaConnectionHealth(connection.connectionId);
        const hintedPropertyIds = new Set(health.propertyHints.map((property) => property.propertyId));
        const propertyHints = [
          ...health.propertyHints,
          ...usage.propertyIds
            .filter((propertyId) => !hintedPropertyIds.has(propertyId))
            .map((propertyId) => ({
              propertyId,
              displayName: propertyId,
              accountDisplayName: null,
              source: 'usedBySheet',
            })),
        ];
        return {
          ...connection,
          duplicateName,
          health: health.health,
          propertyHints,
          propertiesTruncated: health.propertiesTruncated,
          usedBySheets: usage.usedBySheets,
        };
      }
      return {
        ...connection,
        duplicateName,
        health: { status: 'unknown', checkedAt: null, message: 'Health probe is only implemented for Google Analytics connections.' },
        propertyHints: [],
        usedBySheets: usage.usedBySheets,
      };
    }),
  );
}

function buildExactHostFilter(hostName?: string) {
  if (!hostName) return undefined;
  return {
    filter: {
      fieldName: 'hostName',
      stringFilter: {
        matchType: 'EXACT',
        value: hostName,
      },
    },
  };
}

export function summarizeGaReportDiagnostics(args: {
  propertyId: string;
  report?: Record<string, unknown>;
  hostName?: string;
  topHostnames?: Array<{ hostName: string; metricValue: string }>;
}) {
  const report = args.report ?? {};
  return {
    propertyId: args.propertyId,
    dateRanges: Array.isArray(report.dateRanges) ? report.dateRanges : null,
    dimensions: Array.isArray(report.dimensions) ? report.dimensions : null,
    metrics: Array.isArray(report.metrics) ? report.metrics : null,
    dimensionFilter: report.dimensionFilter ?? null,
    hostNameFilter: args.hostName ?? null,
    topHostnames: args.topHostnames ?? [],
  };
}

export async function getGaTopHostnames(args: {
  connectionId: string;
  propertyId: string;
  report?: Record<string, unknown>;
}) {
  try {
    const metricName =
      Array.isArray(args.report?.metrics) &&
      typeof (args.report.metrics[0] as { name?: unknown } | undefined)?.name === 'string'
        ? String((args.report.metrics[0] as { name: string }).name)
        : 'sessions';
    const result = await queryGoogleAnalytics({
      connectorId: args.connectionId,
      propertyId: args.propertyId,
      report: {
        dateRanges: Array.isArray(args.report?.dateRanges) ? args.report.dateRanges as any : undefined,
        dimensions: [{ name: 'hostName' }],
        metrics: [{ name: metricName }],
        orderBys: [{ metric: { metricName }, desc: true }],
        limit: 10,
      },
    });
    return result.rows.map((row) => ({ hostName: row[0] ?? '', metricValue: row[1] ?? '' }));
  } catch {
    return [];
  }
}

export async function createGaTrendBySourceSheet(args: {
  input: {
    connectionId: string;
    schemaToken: string;
    propertyId: string;
    startDate: string;
    endDate: string;
    hostName?: string;
    sourceDimension?: 'sessionSource' | 'firstUserSource';
    metric?: 'sessions' | 'activeUsers' | 'totalUsers' | 'newUsers' | 'screenPageViews' | 'eventCount';
    brief?: ConnectorQueryBriefInput;
    title?: string;
  };
  store: GaTrendStore;
  generateId: () => string;
}) {
  const {
    connectionId,
    schemaToken,
    propertyId,
    startDate,
    endDate,
    hostName,
    sourceDimension = 'sessionSource',
    metric = 'sessions',
    brief,
    title,
  } = args.input;
  const normalizedBrief = normalizeConnectorQueryBrief(brief);
  if (normalizedBrief.error || !normalizedBrief.brief) {
    return { ok: false, error: normalizedBrief.error ?? 'Invalid brief' };
  }
  const tokenScope = args.store.connectionSchemaTokens[schemaToken];
  if (!tokenScope) return { ok: false, error: 'Run describeConnection first and pass its schemaToken' };
  if (tokenScope.connectionId !== connectionId || tokenScope.type !== 'google-analytics' || tokenScope.propertyId !== propertyId) {
    return { ok: false, error: 'schemaToken does not match the requested Google Analytics connection/property' };
  }

  const report = {
    dateRanges: [{ startDate, endDate }],
    dimensions: [
      { name: 'date' },
      { name: 'hostName' },
      { name: sourceDimension },
      { name: 'sessionMedium' },
    ],
    metrics: [{ name: metric }],
    dimensionFilter: buildExactHostFilter(hostName),
    orderBys: [{ dimension: { dimensionName: 'date' } }],
    limit: 10000,
  };
  const result = await queryGoogleAnalytics({ connectorId: connectionId, propertyId, report });
  const matrix = googleAnalyticsResultToMatrix(result);
  if (matrix.length < 2) {
    return {
      ok: false,
      error: 'Google Analytics trend returned no data rows. No sheet or sparkline was created.',
      queryDiagnostics: summarizeGaReportDiagnostics({
        propertyId,
        report,
        hostName,
        topHostnames: await getGaTopHostnames({ connectionId, propertyId, report }),
      }),
    };
  }

  const applied = applyMatrixToSheet(matrix);
  const sheetTitle = title ?? `${hostName ?? propertyId} GA daily trend by source`;
  const sourceSheet: SheetData = {
    id: args.generateId(),
    title: sheetTitle,
    position: args.store.getNextSheetPosition(),
    size: applied.size,
    cells: applied.cells,
    connectorConfig: buildConnectorConfigWithQuery(
      { type: 'google-analytics', name: sheetTitle, connectionId } as ConnectorConfig,
      { type: 'google-analytics', propertyId, report },
      {
        derivation: 'ga4-trend-by-source',
        brief: normalizedBrief.brief,
        lastRefreshedAt: Date.now(),
        truncated: result.truncated || applied.truncated,
        lastError: '',
      },
    ),
    setupRequired: false,
  };
  args.store.addSheet(sourceSheet);

  const sparklineConfig: SparklineConfig = {
    sourceSheetId: sourceSheet.id,
    dateCol: 'A',
    mode: 'group',
    compareMode: 'vs_avg',
    groupCol: 'C',
    valueCol: 'E',
    operation: 'SUM',
  };
  const sparklineSheet: SheetData = {
    id: args.generateId(),
    title: `Sparklines: ${sheetTitle}`,
    position: {
      x: sourceSheet.position.x + sourceSheet.size.width * CELL_WIDTH + 60,
      y: sourceSheet.position.y + 100,
    },
    size: { width: 4, height: 16 },
    cells: {},
    sparklineConfig,
    setupRequired: false,
  };
  args.store.addSheet(sparklineSheet);
  accumulateSheetFocus(sparklineSheet);
  return {
    ok: true,
    sheetId: sourceSheet.id,
    sparklineSheetId: sparklineSheet.id,
    propertyId,
    hostName: hostName ?? null,
    dateRange: { startDate, endDate },
    brief: sourceSheet.connectorConfig?.brief ?? null,
    sourceDimension,
    metric,
    rawRowCount: matrix.length - 1,
    truncated: result.truncated || applied.truncated,
    columns: matrix[0].slice(0, MAX_CONNECTED_IMPORT_COLS).map((header, index) => ({ columnId: getColumnIdForIndex(index), header })),
    suggestedNextTools: ['describeSheet', 'createChart'],
  };
}
