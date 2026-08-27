import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NoteData, SheetData } from '../../../types';
import { useStore } from '../../../store';
import {
  countForeignSteps,
  getAbsoluteHistoryDepth,
  getRevertState,
  getStaleReason,
  revertToEntry,
  trailToolObserver,
  useTrailStore,
} from '../activityTrail';

function makeSheet(id: string): SheetData {
  return {
    id,
    title: id,
    position: { x: 0, y: 0 },
    size: { width: 4, height: 4 },
    cells: {},
  };
}

function makeNote(id: string): NoteData {
  return {
    id,
    position: { x: 0, y: 0 },
    size: { width: 200, height: 200 },
    content: `note ${id}`,
    color: 'yellow',
    format: 'markdown',
  };
}

// Simulates what src/agent/webmcp/toolDispatch.ts will do around a tool call: capture the
// depth marker via onStart, run the mutation, hand the result to onFinish. `mutate` performs
// exactly the store mutation the "tool" would have performed.
function simulateAgentStep(tool: string, mutate: () => void, result: { ok: true; [k: string]: unknown }) {
  const entryId = trailToolObserver.onStart('eval', tool, {});
  mutate();
  trailToolObserver.onFinish(entryId, result);
  return entryId;
}

const initialAppState = useStore.getState();
const initialTrailState = useTrailStore.getState();

afterEach(() => {
  useStore.setState({
    sheets: initialAppState.sheets,
    sheetIds: initialAppState.sheetIds,
    charts: initialAppState.charts,
    chartIds: initialAppState.chartIds,
    notes: initialAppState.notes,
    noteIds: initialAppState.noteIds,
    selectedIds: initialAppState.selectedIds,
    transform: initialAppState.transform,
    history: initialAppState.history,
    future: initialAppState.future,
    historyBase: initialAppState.historyBase,
  });
  useTrailStore.setState({ entries: initialTrailState.entries });
  vi.restoreAllMocks();
});

describe('activityTrail onStart/onFinish', () => {
  it('captures the depth marker before the mutation runs, and records depthAfter once it finishes', () => {
    const depthBefore = getAbsoluteHistoryDepth();

    const entryId = trailToolObserver.onStart('eval', 'createSheet', { title: 'New Sheet' });
    const midEntry = useTrailStore.getState().entries.find((e) => e.id === entryId)!;
    expect(midEntry.undoDepth).toBe(depthBefore);
    expect(midEntry.status).toBe('running');

    useStore.getState().addSheet(makeSheet('s1'));
    trailToolObserver.onFinish(entryId, { ok: true, sheetId: 's1' });

    const finishedEntry = useTrailStore.getState().entries.find((e) => e.id === entryId)!;
    expect(finishedEntry.status).toBe('ok');
    expect(finishedEntry.depthAfter).toBe(depthBefore + 1);
    expect(finishedEntry.revertState).toBe('revertable');
    expect(finishedEntry.summary.length).toBeGreaterThan(0);
  });
});

describe('revertToEntry', () => {
  it('reverting the first of three writes restores the pre-first-write state', () => {
    const preSheetIds = Object.keys(useStore.getState().sheets);

    const id1 = simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('w1')), {
      ok: true,
      sheetId: 'w1',
    });
    simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('w2')), { ok: true, sheetId: 'w2' });
    simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('w3')), { ok: true, sheetId: 'w3' });

    expect(useStore.getState().sheets.w1).toBeDefined();
    expect(useStore.getState().sheets.w2).toBeDefined();
    expect(useStore.getState().sheets.w3).toBeDefined();

    const result = revertToEntry(id1);

    expect(result.ok).toBe(true);
    expect(Object.keys(useStore.getState().sheets).sort()).toEqual(preSheetIds.sort());
    expect(useStore.getState().sheets.w1).toBeUndefined();
    expect(useStore.getState().sheets.w2).toBeUndefined();
    expect(useStore.getState().sheets.w3).toBeUndefined();

    const entries = useTrailStore.getState().entries;
    expect(entries.every((e) => e.revertState === 'reverted')).toBe(true);
  });

  it('marks an entry stale once the user has undone past it, and refuses to revert it', () => {
    // Pre-existing state before this entry even starts, so there's room to undo "past" it.
    useStore.getState().addSheet(makeSheet('pre-existing'));

    const id1 = simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('stale1')), {
      ok: true,
      sheetId: 'stale1',
    });

    // The user manually undoes twice via the toolbar's Undo button: once for this entry's own
    // change, and once more past it (undoing the pre-existing write too).
    useStore.getState().undo();
    useStore.getState().undo();

    const entry = useTrailStore.getState().entries.find((e) => e.id === id1)!;
    expect(getRevertState(entry)).toBe('stale');
    expect(getStaleReason(entry)).toBe('undone-past');

    const result = revertToEntry(id1);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/already undid/i);
  });
});

describe('countForeignSteps', () => {
  it('counts a human edit interleaved between two agent steps as one foreign step', () => {
    const id1 = simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('f1')), {
      ok: true,
      sheetId: 'f1',
    });

    // A human edit made directly through the UI: goes through the same store action, but with
    // no trail entry wrapped around it (no observer call), because it didn't come through a
    // tool dispatch.
    useStore.getState().addNote(makeNote('human-note'));

    simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('f2')), { ok: true, sheetId: 'f2' });

    expect(countForeignSteps(id1)).toBe(1);
  });

  it('is zero when every intervening snapshot belongs to a trail entry', () => {
    const id1 = simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('g1')), {
      ok: true,
      sheetId: 'g1',
    });
    simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('g2')), { ok: true, sheetId: 'g2' });

    expect(countForeignSteps(id1)).toBe(0);
  });
});

describe('MAX_HISTORY / historyBase regression', () => {
  it('keeps depth markers correct once more than 50 snapshots have been saved', () => {
    const id1 = simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('shift-0')), {
      ok: true,
      sheetId: 'shift-0',
    });
    const entry1 = useTrailStore.getState().entries.find((e) => e.id === id1)!;

    // 55 more writes: MAX_HISTORY is 50, so this forces store.ts's saveSnapshot() to shift()
    // repeatedly and increment historyBase several times.
    let lastId = id1;
    for (let i = 1; i <= 55; i++) {
      lastId = simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet(`shift-${i}`)), {
        ok: true,
        sheetId: `shift-${i}`,
      });
    }

    expect(useStore.getState().historyBase).toBeGreaterThan(0);
    expect(useStore.getState().history.length).toBeLessThanOrEqual(50);

    // entry1's target snapshot has been shifted out from under it. Before the historyBase fix,
    // a raw array-index comparison would silently point at whatever now sits at that stale
    // index instead of recognizing the eviction — this must instead read as unambiguously
    // stale (below-floor), not as revertable-to-the-wrong-moment.
    expect(getRevertState(entry1)).toBe('stale');
    expect(getStaleReason(entry1)).toBe('below-floor');
    expect(revertToEntry(id1).ok).toBe(false);

    // The most recent entry (well inside the last-50 window) must still be exactly revertable,
    // proving historyBase + history.length tracked absolute depth correctly through the shifts.
    const lastEntry = useTrailStore.getState().entries.find((e) => e.id === lastId)!;
    expect(getRevertState(lastEntry)).toBe('revertable');
    const result = revertToEntry(lastId);
    expect(result.ok).toBe(true);
    expect(useStore.getState().sheets['shift-55']).toBeUndefined();
  });
});

describe('observer resilience', () => {
  it('never lets an observer failure propagate into the caller', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const originalSetState = useTrailStore.setState;
    // Force every internal store write the observer makes to throw, simulating an unexpected
    // bug in the trail's own bookkeeping.
    useTrailStore.setState = () => {
      throw new Error('simulated trail store failure');
    };

    let entryId = '';
    expect(() => {
      entryId = trailToolObserver.onStart('eval', 'createSheet', { title: 'x' });
    }).not.toThrow();
    expect(() => trailToolObserver.onFinish(entryId, { ok: true, sheetId: 'x' })).not.toThrow();

    useTrailStore.setState = originalSetState;

    // The trail must recover cleanly once the failure clears — no permanent corruption from
    // the injected error.
    const id2 = simulateAgentStep('createSheet', () => useStore.getState().addSheet(makeSheet('after-failure')), {
      ok: true,
      sheetId: 'after-failure',
    });
    expect(useTrailStore.getState().entries.some((e) => e.id === id2)).toBe(true);
    expect(useStore.getState().sheets['after-failure']).toBeDefined();

    consoleErrorSpy.mockRestore();
  });
});
