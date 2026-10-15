import { afterEach, describe, expect, it } from 'vitest';
import { executeClientTool } from '../clientToolExecutor';
import { capturePublicCanvasSnapshot, restorePublicCanvasSnapshot } from '../publicCanvasSession';
import { useStore } from '../../../store';

const initialState = useStore.getState();
afterEach(() => useStore.setState(initialState));

describe('public canvas session recovery', () => {
  it('recovers sheet ids and calculated data after canvas recreation without private state', async () => {
    await useStore.getState().init({ ephemeral: true });
    const created = await executeClientTool('createSheet', {
      title: 'Recovered', data: [['Name', 'Value'], ['A', 7]],
    }, { getSelection: () => ({ sheetId: null, cellId: null, range: null }) });
    expect(created.ok).toBe(true);
    const sheetId = useStore.getState().sheetIds[0];
    useStore.getState().updateSheet(sheetId, { connectorConfig: { type: 'clickhouse', name: 'private', connectionId: 'secret' } });
    useStore.setState({ connections: [{ connectionId: 'secret', name: 'private', type: 'clickhouse' }] });
    const snapshot = capturePublicCanvasSnapshot();
    expect(JSON.stringify(snapshot)).not.toContain('secret');
    await useStore.getState().init({ ephemeral: true });
    restorePublicCanvasSnapshot(snapshot);
    expect(useStore.getState().sheetIds).toEqual(snapshot.sheets.map(sheet => sheet.id));
    expect(Object.values(useStore.getState().sheets)[0].cells.B2.value).toBe(7);
    expect(useStore.getState().connections).toEqual([]);
    expect(useStore.getState().privateQueryResults).toEqual({});
  });

  it('rejects malformed recovery instead of falling back to a private workspace', () => {
    expect(() => restorePublicCanvasSnapshot({ version: 1, sheets: [] })).toThrow();
    restorePublicCanvasSnapshot(null);
    expect(useStore.getState().sheetIds).toEqual([]);
  });
});
