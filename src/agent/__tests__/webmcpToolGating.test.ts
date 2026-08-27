import { describe, expect, it } from 'vitest';
import type { AppState } from '../../../store';
import type { SheetData } from '../../../types';
import { TOOL_NAMES, type ToolName } from '../../../agent/tools';
import { computeDesiredTools, gatingKey, readGatingState } from '../webmcp/webmcpToolGating';

// Minimal AppState fixture builder — only the fields readGatingState/gatingKey
// actually touch need to be real; everything else is cast away.
function makeState(overrides: Partial<AppState> = {}): AppState {
  const base: Partial<AppState> = {
    sheets: {},
    sheetIds: [],
    noteIds: [],
    privateQueryResultIds: [],
    connectionSchemaTokens: {},
  };
  return { ...base, ...overrides } as AppState;
}

function makeSheet(id: string, overrides: Partial<SheetData> = {}): SheetData {
  return {
    id,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 1, height: 1 },
    cells: {},
    ...overrides,
  };
}

const NEVER_GATED: ToolName[] = [
  'listSheets',
  'getSelection',
  'createSheet',
  'createNote',
  'listNotes',
  'listConnections',
  'listConnectionProperties',
  'describeConnection',
];

describe('computeDesiredTools', () => {
  it('empty canvas exposes exactly the never-gated set, including listNotes but not describeSheet', () => {
    const gating = readGatingState(makeState());
    const desired = computeDesiredTools(gating);

    expect([...desired].sort()).toEqual([...NEVER_GATED].sort());
    expect(desired.has('listNotes')).toBe(true);
    expect(desired.has('describeSheet')).toBe(false);
  });

  it('adding a sheet exposes the 10 sheet-consuming tools', () => {
    const sheet = makeSheet('sheet-1');
    const state = makeState({ sheets: { [sheet.id]: sheet }, sheetIds: [sheet.id] });
    const desired = computeDesiredTools(readGatingState(state));

    const sheetTools: ToolName[] = [
      'describeSheet',
      'getRange',
      'querySheet',
      'setCells',
      'applyFilter',
      'applySort',
      'applyFormat',
      'createChart',
      'createPivot',
      'createSparkline',
    ];
    for (const tool of sheetTools) {
      expect(desired.has(tool)).toBe(true);
    }
    // Note/connector-gated tools should still be absent.
    expect(desired.has('readNote')).toBe(false);
    expect(desired.has('queryConnection')).toBe(false);
  });

  it('never returns a name outside TOOL_NAMES', () => {
    const sheet = makeSheet('sheet-1', {
      connectorConfig: { type: 'clickhouse', name: 'warehouse' },
    });
    const state = makeState({
      sheets: { [sheet.id]: sheet },
      sheetIds: [sheet.id],
      noteIds: ['note-1'],
      connectionSchemaTokens: {
        tok: { connectionId: 'c1', type: 'clickhouse', createdAt: Date.now() },
      },
      privateQueryResultIds: ['result-1'],
    });
    const desired = computeDesiredTools(readGatingState(state));

    for (const name of desired) {
      expect(TOOL_NAMES).toContain(name);
    }
  });
});

describe('gatingKey', () => {
  it('is unchanged when only cell contents change but stable counts remain the same', () => {
    const sheet = makeSheet('sheet-1', { cells: { A1: { raw: '1', value: 1 } } });
    const state = makeState({ sheets: { [sheet.id]: sheet }, sheetIds: [sheet.id] });
    const beforeKey = gatingKey(state);

    // Mutate cell contents in place (as a store update would produce a new
    // sheet object with edited cells) without touching sheetIds/noteIds/etc.
    const editedSheet: SheetData = {
      ...sheet,
      cells: { ...sheet.cells, A1: { raw: '2', value: 2 }, B1: { raw: 'x', value: 'x' } },
    };
    const nextState = makeState({
      sheets: { [editedSheet.id]: editedSheet },
      sheetIds: state.sheetIds, // same array reference — a cell edit never replaces this
    });

    expect(gatingKey(nextState)).toBe(beforeKey);
  });

  it('changes when a sheet is added', () => {
    const state = makeState();
    const beforeKey = gatingKey(state);

    const sheet = makeSheet('sheet-1');
    const nextState = makeState({ sheets: { [sheet.id]: sheet }, sheetIds: [sheet.id] });

    expect(gatingKey(nextState)).not.toBe(beforeKey);
  });
});
