import type { ConnectorConfig, ConnectorQueryBrief, ConnectorQueryPayload, SheetData } from '../types';
import { applyMatrixToSheet } from './connectorSheet';
import { MAX_CONNECTED_IMPORT_COLS, MAX_IMPORT_ROWS } from '../constants';
import { getConnectorQueryProvider, type NormalizedConnectorQuery } from './connectorQuery';

export type { NormalizedConnectorQuery } from './connectorQuery';

export type ConnectedSheetRefreshResult = {
  size: SheetData['size'];
  cells: SheetData['cells'];
  connectorConfig: ConnectorConfig;
  truncationMessage: string;
};

export function readConnectorQuery(config: ConnectorConfig): NormalizedConnectorQuery | null {
  const provider = getConnectorQueryProvider(config.type);
  if (!provider) return null;
  return provider.normalize((config.query?.payload as Record<string, unknown> | undefined) ?? {});
}

export function validateConnectorQuery(config: ConnectorConfig, query: NormalizedConnectorQuery): string | null {
  if (!config.connectionId?.trim()) return 'A real connection is required';
  const provider = getConnectorQueryProvider(query.type);
  if (!provider) return `Unsupported connector type: ${query.type}`;
  return provider.validate(query);
}

function markConnectorBriefStale(brief: ConnectorQueryBrief | undefined): ConnectorQueryBrief | undefined {
  if (!brief) return undefined;
  if (brief.status === 'stale') return brief;
  return { ...brief, status: 'stale' };
}

function isSameQueryPayload(
  previousPayload: ConnectorQueryPayload | undefined,
  nextPayload: ConnectorQueryPayload,
) {
  return JSON.stringify(previousPayload ?? null) === JSON.stringify(nextPayload);
}

export function buildConnectorConfigWithQuery(
  config: ConnectorConfig,
  query: NormalizedConnectorQuery,
  updates: Partial<ConnectorConfig> = {},
): ConnectorConfig {
  const provider = getConnectorQueryProvider(query.type);
  const payload = (provider ? provider.toPayload(query) : ({} as ConnectorQueryPayload));
  const version = provider?.version ?? 1;
  const { brief: explicitBrief, ...restUpdates } = updates;
  const brief =
    explicitBrief !== undefined
      ? explicitBrief
      : isSameQueryPayload(config.query?.payload, payload)
        ? config.brief
        : markConnectorBriefStale(config.brief);
  return {
    ...config,
    query: { version, payload },
    brief,
    ...restUpdates,
  };
}

export function getConnectorQuerySummary(config: ConnectorConfig): string {
  const query = readConnectorQuery(config);
  if (!query) return '';
  const provider = getConnectorQueryProvider(query.type);
  return provider ? provider.summarize(query) : '';
}

export async function refreshConnectedSheetFromQuery(
  config: ConnectorConfig,
  query: NormalizedConnectorQuery,
): Promise<ConnectedSheetRefreshResult> {
  const validationError = validateConnectorQuery(config, query);
  if (validationError) throw new Error(validationError);

  const provider = getConnectorQueryProvider(query.type)!;
  const connectorId = config.connectionId!.trim();
  const { matrix, truncated: sourceTruncated } = await provider.execute(connectorId, query);

  const next = applyMatrixToSheet(matrix);
  return {
    size: next.size,
    cells: next.cells,
    connectorConfig: buildConnectorConfigWithQuery(config, query, {
      healthStatus: 'healthy',
      healthErrorCode: '',
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
