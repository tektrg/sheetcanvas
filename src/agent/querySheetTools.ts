import type { ConnectorConfig, SheetData } from '../../types';
import { MAX_CONNECTED_IMPORT_COLS } from '../../constants';
import { applyMatrixToSheet } from '../../utils/connectorSheet';
import { getConnectorQueryProvider, rewriteClickhouseSqlForDescribedTable } from '../../utils/connectorQuery';
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

type StoreState = ReturnType<typeof useStore.getState>;

type CreateQuerySheetInput = {
  connectionId: string;
  schemaToken: string;
  type: 'clickhouse' | 'google-analytics' | 'google-sheets';
  queryPayload: Record<string, unknown>;
  derivation: string;
  brief?: ConnectorQueryBriefInput;
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

function summarizeImportedMatrix(matrix: string[][], derivation: string, truncated: boolean) {
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
    rowCount: matrix.length - 1,
    headers,
    inferredTypes,
    sampleRows,
    derivation,
    truncated,
  };
}

export async function handleCreateQuerySheet(store: StoreState, input: CreateQuerySheetInput): Promise<ToolResult> {
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

  if (matrix.length < 2) {
    const queryDiagnostics =
      query.type === 'google-analytics'
        ? summarizeGaReportDiagnostics({
            propertyId: query.propertyId,
            report: query.report as Record<string, unknown> | undefined,
            topHostnames: await getGaTopHostnames({
              connectionId,
              propertyId: query.propertyId,
              report: query.report as Record<string, unknown> | undefined,
            }),
          })
        : null;
    return {
      ok: false,
      error: 'Query returned no data rows. No sheet or chart was created; explain the empty result and stop.',
      queryDiagnostics,
    };
  }

  const applied = applyMatrixToSheet(matrix);
  const connectorConfig = buildConnectorConfigWithQuery(
    { type: connType, name: sheetTitle, connectionId } as ConnectorConfig,
    query,
    {
      derivation,
      brief: normalizedBrief.brief,
      lastRefreshedAt: Date.now(),
      truncated: sourceTruncated || applied.truncated,
      lastError: '',
    },
  );
  const newSheet: SheetData = {
    id: Math.random().toString(36).slice(2, 11),
    title: sheetTitle,
    position: store.getNextSheetPosition(),
    size: applied.size,
    cells: applied.cells,
    connectorConfig,
    setupRequired: false,
  };
  store.addSheet(newSheet);
  accumulateSheetFocus(newSheet);
  return {
    ok: true,
    sheetId: newSheet.id,
    title: sheetTitle,
    brief: connectorConfig.brief,
    ...summarizeImportedMatrix(matrix, derivation, applied.truncated),
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
    store.updateSheet(sheet.id, {
      connectorConfig: {
        ...baseConfig,
        brief: baseConfig.brief ? { ...baseConfig.brief, status: 'stale' } : undefined,
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
