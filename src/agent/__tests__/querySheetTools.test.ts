import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SheetData } from '../../../types';
import { useStore } from '../../../store';
import { executeClientTool } from '../clientToolExecutor';

const initialState = useStore.getState();
const emptySelectionResolver = {
  getSelection: () => ({ sheetId: null, cellId: null, range: null }),
};

function makeBrief(logic: string) {
  return {
    logic,
    scope: ['May 2026 transactions', 'Grouped by month and loyalty tier'],
    sources: ['hq_report.sales'],
    judgmentNotes: ['Only reflects rows included by the query filters and limits.'],
  };
}

function makeClickHouseQuerySheet(): SheetData {
  return {
    id: 'ch-sheet-1',
    title: 'ClickHouse: CH internal Appscript',
    position: { x: 0, y: 0 },
    size: { width: 5, height: 2 },
    cells: {
      A1: { raw: 'month', value: 'month' },
      B1: { raw: 'loyalty_tier', value: 'loyalty_tier' },
      C1: { raw: 'total_profit', value: 'total_profit' },
      A2: { raw: '2026-05', value: '2026-05' },
      B2: { raw: 'Ruby', value: 'Ruby' },
      C2: { raw: '1000', value: 1000 },
    },
    connectorConfig: {
      type: 'clickhouse',
      name: 'ClickHouse: CH internal Appscript',
      connectionId: 'clickhouse-1',
      query: { version: 1, payload: { sql: 'SELECT month, loyalty_tier, total_profit FROM hq_report.sales LIMIT 10' } },
      derivation: 'Original loyalty summary',
      brief: {
        ...makeBrief('Summarizes loyalty-tier profit from the original ClickHouse query.'),
        status: 'current',
        updatedAt: 1,
      },
      lastError: '',
    },
  };
}

afterEach(() => {
  useStore.setState({
    sheets: initialState.sheets,
    sheetIds: initialState.sheetIds,
    charts: initialState.charts,
    chartIds: initialState.chartIds,
    notes: initialState.notes,
    noteIds: initialState.noteIds,
    privateQueryResults: initialState.privateQueryResults,
    privateQueryResultIds: initialState.privateQueryResultIds,
    selectedIds: initialState.selectedIds,
    transform: initialState.transform,
    history: initialState.history,
    future: initialState.future,
    connections: initialState.connections,
    gaMetadataCache: initialState.gaMetadataCache,
    connectionSchemaTokens: initialState.connectionSchemaTokens,
  });
  vi.unstubAllGlobals();
});

describe('executeClientTool private connector queries', () => {
  it('stores connector query results invisibly until explicitly emitted as a sheet', async () => {
    const sql = 'SELECT month, total_profit FROM hq_report.sales LIMIT 2';
    useStore.setState({
      sheets: {},
      sheetIds: [],
      privateQueryResults: {},
      privateQueryResultIds: [],
      connectionSchemaTokens: {
        schema1234: {
          connectionId: 'clickhouse-1',
          type: 'clickhouse',
          table: 'hq_report.sales',
          createdAt: Date.now(),
        },
      },
    });
    vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900 });
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://localhost:8787/api/query/clickhouse');
      expect(JSON.parse(String(init?.body))).toEqual({
        connectorId: 'clickhouse-1',
        sql,
      });
      return {
        ok: true,
        json: async () => ({
          columns: [
            { name: 'month', type: 'String' },
            { name: 'total_profit', type: 'Float64' },
          ],
          rows: [['2026-05', 1000]],
          rowCount: 1,
          truncated: false,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const privateResult = await executeClientTool(
      'queryConnection',
      {
        connectionId: 'clickhouse-1',
        schemaToken: 'schema1234',
        type: 'clickhouse',
        queryPayload: { sql },
        derivation: 'Reads monthly profit for analysis without showing a table.',
        brief: makeBrief('Reads monthly profit for private analysis.'),
        title: 'Private profit probe',
      },
      emptySelectionResolver,
    );

    expect(privateResult.ok).toBe(true);
    expect(privateResult.visibleSheetCreated).toBe(false);
    expect(privateResult.resultId).toEqual(expect.any(String));
    const resultId = privateResult.resultId as string;
    let state = useStore.getState();
    expect(state.sheetIds).toEqual([]);
    expect(state.privateQueryResultIds).toEqual([resultId]);
    expect(state.privateQueryResults[resultId].matrix).toEqual([
      ['month', 'total_profit'],
      ['2026-05', '1000'],
    ]);

    const emitted = await executeClientTool(
      'createQuerySheetFromResult',
      {
        resultId,
        title: 'Visible profit result',
      },
      emptySelectionResolver,
    );

    expect(emitted.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sheetId = emitted.sheetId as string;
    state = useStore.getState();
    expect(state.privateQueryResultIds).toEqual([resultId]);
    expect(state.sheetIds).toEqual([sheetId]);
    const sheet = state.sheets[sheetId];
    expect(sheet.title).toBe('Visible profit result');
    expect(sheet.connectorConfig).toEqual(
      expect.objectContaining({
        name: 'Visible profit result',
        connectionId: 'clickhouse-1',
        query: { version: 1, payload: { sql } },
      }),
    );
    expect(sheet.cells.A1.raw).toBe('month');
    expect(sheet.cells.B2.raw).toBe('1000');
  });
});

describe('executeClientTool updateQuerySheet', () => {
  it('updates an existing ClickHouse query sheet in place instead of creating a replacement', async () => {
    const sheet = makeClickHouseQuerySheet();
    const nextSql = `
      SELECT
        month,
        loyalty_tier,
        total_profit,
        uniqExact(customer_id) AS customer_count,
        count() AS transaction_count,
        count() / uniqExact(customer_id) AS frequency
      FROM hq_report.sales
      GROUP BY month, loyalty_tier, total_profit
    `;
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
    });
    vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(url).toBe('http://localhost:8787/api/query/clickhouse');
        expect(JSON.parse(String(init?.body))).toEqual({
          connectorId: 'clickhouse-1',
          sql: nextSql.trim(),
        });
        return {
          ok: true,
          json: async () => ({
            columns: [
              { name: 'month', type: 'String' },
              { name: 'loyalty_tier', type: 'String' },
              { name: 'total_profit', type: 'Float64' },
              { name: 'customer_count', type: 'UInt64' },
              { name: 'transaction_count', type: 'UInt64' },
              { name: 'frequency', type: 'Float64' },
            ],
            rows: [['2026-05', 'Ruby', 1000, 50, 990, 19.8]],
            rowCount: 1,
            truncated: false,
          }),
        };
      }),
    );

    const result = await executeClientTool(
      'updateQuerySheet',
      {
        sheetId: sheet.id,
        queryPayload: { sql: nextSql },
        derivation: 'Added transaction frequency to the selected sheet.',
        brief: makeBrief('Adds customer and transaction counts to calculate transaction frequency.'),
      },
      emptySelectionResolver,
    );

    expect(result.ok).toBe(true);
    expect(result.sheetId).toBe(sheet.id);
    expect(useStore.getState().sheetIds).toEqual([sheet.id]);
    const updatedSheet = useStore.getState().sheets[sheet.id];
    expect(updatedSheet.connectorConfig?.query).toEqual({ version: 1, payload: { sql: nextSql.trim() } });
    expect(updatedSheet.connectorConfig?.derivation).toBe('Added transaction frequency to the selected sheet.');
    expect(updatedSheet.connectorConfig?.brief).toEqual(
      expect.objectContaining({
        logic: 'Adds customer and transaction counts to calculate transaction frequency.',
        status: 'current',
      }),
    );
    expect(updatedSheet.cells.F1.raw).toBe('frequency');
    expect(updatedSheet.cells.F2.raw).toBe('19.8');
  });

  it('preserves existing ClickHouse query sheet cells when an update query fails', async () => {
    const sheet = makeClickHouseQuerySheet();
    useStore.setState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
    });
    vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900 });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({ error: { message: 'ClickHouse error: missing column transaction_id' } }),
      })),
    );

    const result = await executeClientTool(
      'updateQuerySheet',
      {
        sheetId: sheet.id,
        queryPayload: { sql: 'SELECT transaction_id FROM sales' },
        brief: makeBrief('Attempts to inspect transaction IDs from the sales table.'),
      },
      emptySelectionResolver,
    );

    expect(result.ok).toBe(false);
    const updatedSheet = useStore.getState().sheets[sheet.id];
    expect(updatedSheet.cells).toBe(sheet.cells);
    expect(updatedSheet.connectorConfig?.query).toEqual({ version: 1, payload: { sql: 'SELECT transaction_id FROM sales' } });
    expect(updatedSheet.connectorConfig?.brief).toEqual(
      expect.objectContaining({
        logic: 'Attempts to inspect transaction IDs from the sales table.',
        status: 'stale',
      }),
    );
    expect(updatedSheet.connectorConfig?.lastError).toBe('ClickHouse error: missing column transaction_id');
  });
});
