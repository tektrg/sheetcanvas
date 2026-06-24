import { afterEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../store';
import { buildAgentContextLine } from '../contextBuilder';

const initialState = useStore.getState();

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
});

describe('buildAgentContextLine private query results', () => {
  it('includes private result metadata for follow-up emission without raw data rows', () => {
    useStore.setState({
      privateQueryResults: {
        result_1: {
          id: 'result_1',
          title: 'Private profit probe',
          connectionId: 'clickhouse-1',
          type: 'clickhouse',
          matrix: [
            ['month', 'total_profit'],
            ['raw-row-month', 'raw-row-profit'],
          ],
          connectorConfig: {
            type: 'clickhouse',
            name: 'Private profit probe',
            connectionId: 'clickhouse-1',
            query: { version: 1, payload: { sql: 'SELECT month, total_profit FROM sales' } },
            brief: {
              logic: 'Reads monthly profit for private analysis.',
              scope: ['May 2026'],
              sources: ['sales'],
              judgmentNotes: ['Private result is not visible yet.'],
              status: 'current',
              updatedAt: 2,
            },
            truncated: false,
          },
          rowCount: 1,
          createdAt: 1,
          updatedAt: 2,
        },
      },
      privateQueryResultIds: ['result_1'],
    });

    const context = buildAgentContextLine({ sheetId: null, cellId: null, range: null });
    const parsed = JSON.parse(context);

    expect(parsed.privateQueryResults).toEqual([
      expect.objectContaining({
        resultId: 'result_1',
        title: 'Private profit probe',
        type: 'clickhouse',
        rowCount: 1,
        headers: [
          { columnId: 'A', header: 'month' },
          { columnId: 'B', header: 'total_profit' },
        ],
        truncated: false,
      }),
    ]);
    expect(context).not.toContain('raw-row-month');
    expect(context).not.toContain('raw-row-profit');
  });
});
