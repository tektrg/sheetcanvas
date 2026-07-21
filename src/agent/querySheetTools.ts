import type { ConnectorConfig, PrivateQueryResult, QueryableConnectorType, SheetData } from '../../types';
import { MAX_CONNECTED_IMPORT_COLS } from '../../constants';
import { applyMatrixToSheet, limitConnectorMatrix } from '../../utils/connectorSheet';
import { getConnectorQueryProvider, rewriteClickhouseSqlForDescribedTable, type NormalizedConnectorQuery } from '../../utils/connectorQuery';
import {
  buildConnectorConfigWithQuery,
  refreshConnectedSheetFromQuery,
} from '../../utils/connectedSheetQueries';
import { getCellId } from '../../utils/formulas';
import { getColumnIdForIndex } from './sheetBounds';
import { getGaTopHostnames, summarizeGaReportDiagnostics } from './gaMcpTools';
import type { ToolResult } from './clientToolExecutor';
import { accumulateSheetFocus } from './agentFocusAccumulator';
import { useStore } from '../../store';
import { normalizeConnectorQueryBrief, type ConnectorQueryBriefInput } from './queryBrief';
import { isConnectorNeedsReconnectError } from '../../utils/backendApi';
import { placeOriginal } from '../../utils/canvasLayout';

type StoreState = ReturnType<typeof useStore.getState>;

type CreateQuerySheetInput = {
  connectionId: string;
  schemaToken: string;
  type: QueryableConnectorType;
  queryPayload: Record<string, unknown>;
  derivation: string;
  brief?: ConnectorQueryBriefInput;
  title?: string;
};

type QueryConnectionInput = CreateQuerySheetInput;

type CreateQuerySheetFromResultInput = {
  resultId: string;
  title?: string;
};

type UpdateQuerySheetInput = {
  sheetId: string;
  queryPayload?: Record<string, unknown>;
  derivation?: string;
  brief?: ConnectorQueryBriefInput;
  title?: string;
};

// Re-exported from the ClickHouse provider so the agent tool surface and tests share one rewrite.
export { rewriteClickhouseSqlForDescribedTable };

function summarizeImportedMatrix(matrix: string[][], derivation: string, truncated: boolean, rowCount = matrix.length - 1) {
  const importedHeaders = matrix[0].slice(0, MAX_CONNECTED_IMPORT_COLS);
  const headers = importedHeaders.map((h, i) => ({
    columnId: getCellId(i, 0).replace(/\d+$/, ''),
    header: h,
  }));
  const inferredTypes = importedHeaders.map((_, i) => {
    const sample = matrix[1]?.[i] ?? '';
    if (sample !== '' && !isNaN(Number(sample))) return 'number';
    if (/\d{4}-\d{2}-\d{2}/.test(sample) && !isNaN(Date.parse(sample))) return 'date';
    return 'text';
  });
  const sampleRows = matrix.slice(1, 6).map((row, rowIndex) => {
    const sample: Record<string, string | number> = { rowNumber: rowIndex + 2 };
    importedHeaders.forEach((_, colIndex) => {
      const columnId = getColumnIdForIndex(colIndex);
      sample[columnId] = row[colIndex] ?? '';
    });
    return sample;
  });

  return {
    rowCount,
    headers,
    inferredTypes,
    sampleRows,
    derivation,
    truncated,
  };
}

type ExecutedConnectorQuery = {
  connectionId: string;
  type: QueryableConnectorType;
  title: string;
  derivation: string;
  matrix: string[][];
  sourceTruncated: boolean;
  rowCount: number;
  connectorConfig: ConnectorConfig;
  queryDiagnostics?: unknown;
};

async function getEmptyQueryDiagnostics(connectionId: string, query: NormalizedConnectorQuery) {
  if (query?.type !== 'google-analytics') return null;
  return summarizeGaReportDiagnostics({
    propertyId: query.propertyId,
    report: query.report as Record<string, unknown> | undefined,
    topHostnames: await getGaTopHostnames({
      connectionId,
      propertyId: query.propertyId,
      report: query.report as Record<string, unknown> | undefined,
    }),
  });
}

async function executeConnectorQueryForAgent(store: StoreState, input: CreateQuerySheetInput): Promise<ToolResult | ExecutedConnectorQuery> {
  const { connectionId, schemaToken, type: connType, queryPayload, derivation, title } = input;
  const normalizedBrief = normalizeConnectorQueryBrief(input.brief);
  if (normalizedBrief.error || !normalizedBrief.brief) {
    return { ok: false, error: normalizedBrief.error ?? 'Invalid brief' };
  }
  const tokenScope = store.connectionSchemaTokens[schemaToken];
  if (!tokenScope) return { ok: false, error: 'Run describeConnection first and pass its schemaToken' };
  if (tokenScope.connectionId !== connectionId || tokenScope.type !== connType) {
    return { ok: false, error: 'schemaToken does not match the requested connection/type' };
  }

  const provider = getConnectorQueryProvider(connType);
  if (!provider) return { ok: false, error: `Unsupported connector type: ${connType}` };

  // Each provider owns its create-time reconciliation (alias rewrites, property-match checks).
  const reconciled = provider.reconcileWithSchemaToken(provider.normalize(queryPayload ?? {}), tokenScope);
  if (reconciled.error || !reconciled.query) return { ok: false, error: reconciled.error ?? 'Invalid query' };
  const query = reconciled.query;

  const validationError = provider.validate(query);
  if (validationError) return { ok: false, error: validationError };

  const { matrix, truncated: sourceTruncated } = await provider.execute(connectionId, query);
  const sheetTitle = title ?? provider.defaultTitle(query);
  const rowCount = Math.max(0, matrix.length - 1);
  const connectorConfig = buildConnectorConfigWithQuery(
    { type: connType, name: sheetTitle, connectionId } as ConnectorConfig,
    query,
    {
      derivation,
      brief: normalizedBrief.brief,
      lastRefreshedAt: Date.now(),
      truncated: sourceTruncated,
      lastError: '',
    },
  );

  return {
    connectionId,
    type: connType,
    title: sheetTitle,
    derivation,
    matrix,
    sourceTruncated,
    rowCount,
    connectorConfig,
    queryDiagnostics: matrix.length < 2 ? await getEmptyQueryDiagnostics(connectionId, query) : undefined,
  };
}

function isToolError(result: ToolResult | ExecutedConnectorQuery): result is ToolResult {
  return (result as ToolResult).ok === false;
}

function createVisibleQuerySheet(store: StoreState, args: {
  title: string;
  matrix: string[][];
  connectorConfig: ConnectorConfig;
}) {
  const applied = applyMatrixToSheet(args.matrix);
  const connectorConfig = {
    ...args.connectorConfig,
    name: args.title,
    truncated: !!args.connectorConfig.truncated || applied.truncated,
  };
  const newSheet: SheetData = {
    id: Math.random().toString(36).slice(2, 11),
    title: args.title,
    position: placeOriginal(store),
    size: applied.size,
    cells: applied.cells,
    connectorConfig,
    setupRequired: false,
  };
  store.addSheet(newSheet);
  accumulateSheetFocus(newSheet);
  return { sheet: newSheet, applied };
}

export async function handleQueryConnection(store: StoreState, input: QueryConnectionInput): Promise<ToolResult> {
  const executed = await executeConnectorQueryForAgent(store, input);
  if (isToolError(executed)) return executed;

  if (executed.matrix.length < 2) {
    return {
      ok: false,
      error: 'Query returned no data rows. No private result, sheet, or chart was created; explain the empty result and stop.',
      queryDiagnostics: executed.queryDiagnostics,
    };
  }

  const limited = limitConnectorMatrix(executed.matrix);
  const now = Date.now();
  const connectorConfig = {
    ...executed.connectorConfig,
    truncated: executed.sourceTruncated || limited.truncated,
  };
  const result: PrivateQueryResult = {
    id: Math.random().toString(36).slice(2, 11),
    title: executed.title,
    connectionId: executed.connectionId,
    type: executed.type,
    matrix: limited.matrix,
    connectorConfig,
    rowCount: executed.rowCount,
    createdAt: now,
    updatedAt: now,
    queryDiagnostics: executed.queryDiagnostics,
  };
  store.addPrivateQueryResult(result);
  return {
    ok: true,
    resultId: result.id,
    title: result.title,
    brief: result.connectorConfig.brief,
    privateResult: true,
    visibleSheetCreated: false,
    nextVisibleStep: 'Use createQuerySheetFromResult when the result should become a visible sheet for charts or user inspection.',
    ...summarizeImportedMatrix(result.matrix, executed.derivation, !!connectorConfig.truncated, result.rowCount),
  };
}

export async function handleCreateQuerySheetFromResult(store: StoreState, input: CreateQuerySheetFromResultInput): Promise<ToolResult> {
  const privateResult = store.privateQueryResults[input.resultId];
  if (!privateResult) return { ok: false, error: `Unknown private query result: ${input.resultId}` };

  const title = input.title ?? privateResult.title;
  const { sheet } = createVisibleQuerySheet(store, {
    title,
    matrix: privateResult.matrix,
    connectorConfig: privateResult.connectorConfig,
  });
  return {
    ok: true,
    sheetId: sheet.id,
    title,
    resultId: privateResult.id,
    brief: sheet.connectorConfig?.brief,
    visibleSheetCreated: true,
    ...summarizeImportedMatrix(privateResult.matrix, sheet.connectorConfig?.derivation ?? '', !!sheet.connectorConfig?.truncated, privateResult.rowCount),
  };
}

export async function handleCreateQuerySheet(store: StoreState, input: CreateQuerySheetInput): Promise<ToolResult> {
  const executed = await executeConnectorQueryForAgent(store, input);
  if (isToolError(executed)) return executed;

  if (executed.matrix.length < 2) {
    return {
      ok: false,
      error: 'Query returned no data rows. No sheet or chart was created; explain the empty result and stop.',
      queryDiagnostics: executed.queryDiagnostics,
    };
  }

  const { sheet } = createVisibleQuerySheet(store, {
    title: executed.title,
    matrix: executed.matrix,
    connectorConfig: executed.connectorConfig,
  });
  return {
    ok: true,
    sheetId: sheet.id,
    title: executed.title,
    brief: sheet.connectorConfig?.brief,
    ...summarizeImportedMatrix(executed.matrix, executed.derivation, !!sheet.connectorConfig?.truncated, executed.rowCount),
  };
}

export async function handleUpdateQuerySheet(store: StoreState, input: UpdateQuerySheetInput): Promise<ToolResult> {
  const sheet = store.sheets[input.sheetId];
  if (!sheet) return { ok: false, error: `Unknown sheetId: ${input.sheetId}` };
  if (!sheet.connectorConfig) return { ok: false, error: `Sheet ${sheet.id} is not a connector query sheet` };

  const provider = getConnectorQueryProvider(sheet.connectorConfig.type);
  if (!provider) return { ok: false, error: `Unsupported connector type: ${sheet.connectorConfig.type}` };
  if (!input.queryPayload) {
    return { ok: false, error: `Missing queryPayload for ${sheet.connectorConfig.type} sheet ${sheet.id}` };
  }
  const normalizedBrief = normalizeConnectorQueryBrief(input.brief);
  if (normalizedBrief.error || !normalizedBrief.brief) {
    return { ok: false, error: normalizedBrief.error ?? 'Invalid brief', sheetId: sheet.id };
  }

  const query = provider.normalize(input.queryPayload);
  const baseConfig = buildConnectorConfigWithQuery(sheet.connectorConfig, query, {
    derivation: input.derivation ?? sheet.connectorConfig.derivation,
    brief: normalizedBrief.brief,
    name: input.title ?? sheet.connectorConfig.name,
  });

  store.saveSnapshot();
  try {
    const next = await refreshConnectedSheetFromQuery(baseConfig, query);
    const updatedSheet: SheetData = {
      ...sheet,
      title: input.title ?? sheet.title,
      size: next.size,
      cells: next.cells,
      connectorConfig: next.connectorConfig,
    };
    store.updateSheet(sheet.id, {
      title: input.title ?? sheet.title,
      size: next.size,
      cells: next.cells,
      connectorConfig: next.connectorConfig,
    });
    accumulateSheetFocus(updatedSheet);
    const matrix = Object.keys(next.cells).length ? sheetCellsToMatrix(next.cells, next.size) : [[]];
    return {
      ok: true,
      sheetId: sheet.id,
      title: input.title ?? sheet.title,
      brief: next.connectorConfig.brief,
      ...summarizeImportedMatrix(matrix, next.connectorConfig.derivation ?? '', next.connectorConfig.truncated ?? false),
      updatedExistingSheet: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const needsReconnect = isConnectorNeedsReconnectError(err);
    store.updateSheet(sheet.id, {
      connectorConfig: {
        ...baseConfig,
        brief: baseConfig.brief ? { ...baseConfig.brief, status: 'stale' } : undefined,
        ...(needsReconnect
          ? { healthStatus: 'needs_reconnect' as const, healthErrorCode: 'connector_needs_reconnect' }
          : {}),
        lastError: message,
      },
    });
    return { ok: false, error: message, sheetId: sheet.id, updatedExistingSheet: false };
  }
}

function sheetCellsToMatrix(cells: SheetData['cells'], size: SheetData['size']): string[][] {
  const rows: string[][] = [];
  for (let row = 0; row < size.height; row += 1) {
    const values: string[] = [];
    for (let col = 0; col < Math.min(size.width, MAX_CONNECTED_IMPORT_COLS); col += 1) {
      const cell = cells[getCellId(col, row)];
      const value = cell?.value ?? cell?.raw ?? '';
      values.push(String(value));
    }
    rows.push(values);
  }
  return rows;
}
