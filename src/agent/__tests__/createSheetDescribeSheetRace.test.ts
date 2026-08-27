// Regression coverage for a suspected race reported from the WebMCP smoke
// harness: `executeTool('createSheet', ...)` returned a sheetId that a very
// next `executeTool('describeSheet', { sheetId })` call then reported as
// "Unknown sheetId". See the investigation notes in this PR/commit message
// for the full 5-whys trace.
//
// Finding: `createSheet` (clientToolExecutor.ts) and `store.addSheet`
// (store.ts) contain zero internal `await`s. `useStore` is a plain
// `create<AppState>((set, get) => ...)` store with no middleware, and `set()`
// assigns the new state object synchronously before returning. That means
// the entire chain — id generation, `store.addSheet(newSheet)`, and the
// `return { ok: true, sheetId, ... }` — runs to completion in a single
// synchronous stretch of the async `executeClientTool` function, with no
// microtask boundary in between. By the time the Promise returned by
// `executeClientTool('createSheet', ...)` resolves, `useStore.getState()`
// already reflects the new sheet.
//
// These tests drive `executeClientTool` directly (bypassing the WebMCP
// transport/registry) to pin down that the APP's own createSheet -> describeSheet
// path cannot itself produce the reported symptom under any of the awkward
// timing shapes we could construct without browser/HMR involvement. Every
// case below is expected to PASS; if the underlying app logic ever regresses
// (e.g. someone moves store commit behind an await, or has describeSheet read
// from a different collection than addSheet writes to), one of these should fail.
import { afterEach, describe, expect, it } from 'vitest';
import type { SelectionResolver } from '../clientToolExecutor';
import { executeClientTool } from '../clientToolExecutor';
import { useStore } from '../../../store';

const resolver: SelectionResolver = {
  getSelection: () => ({ sheetId: null, cellId: null, range: null }),
};

const initialState = useStore.getState();

afterEach(() => {
  useStore.setState({
    sheets: initialState.sheets,
    sheetIds: initialState.sheetIds,
    charts: initialState.charts,
    chartIds: initialState.chartIds,
    notes: initialState.notes,
    noteIds: initialState.noteIds,
    selectedIds: initialState.selectedIds,
    transform: initialState.transform,
    history: initialState.history,
    future: initialState.future,
  });
});

async function createSheet(input: Record<string, unknown>) {
  return executeClientTool('createSheet', input, resolver) as Promise<{
    ok: boolean;
    sheetId?: string;
    error?: string;
  }>;
}

async function describeSheet(sheetId: string) {
  return executeClientTool('describeSheet', { sheetId }, resolver) as Promise<{
    ok: boolean;
    error?: string;
  }>;
}

describe('createSheet -> describeSheet: no observable race in app logic', () => {
  it('describeSheet immediately resolves the id createSheet just returned, no intervening await', async () => {
    const created = await createSheet({ title: 'Immediate' });
    expect(created.ok).toBe(true);
    const sheetId = created.sheetId!;

    // Zero work between the two calls beyond the mandatory await on each
    // Promise — this is the exact shape the harness used.
    const described = await describeSheet(sheetId);

    expect(described.ok).toBe(true);
  });

  it('describeSheet resolves the id via a .then() chain off the createSheet promise (no `await` keyword at all in between)', async () => {
    const result = await createSheet({ title: 'ThenChain' }).then((created) => {
      expect(created.ok).toBe(true);
      return describeSheet(created.sheetId!);
    });

    expect(result.ok).toBe(true);
  });

  it('a large sheet right at MAX_CREATE_SHEET_CELLS (20000) succeeds and is immediately describable', async () => {
    const rows = Array.from({ length: 100 }, (_, r) =>
      Array.from({ length: 200 }, (_, c) => `${r}-${c}`),
    ); // 100 * 200 = 20000, exactly at the cap
    const created = await createSheet({ title: 'AtCap', data: rows });
    expect(created.ok).toBe(true);

    const described = await describeSheet(created.sheetId!);
    expect(described.ok).toBe(true);
  });

  it('a sheet just over MAX_CREATE_SHEET_CELLS fails cleanly and returns no sheetId (no partial-create-with-id path)', async () => {
    const rows = Array.from({ length: 100 }, (_, r) =>
      Array.from({ length: 201 }, (_, c) => `${r}-${c}`),
    ); // 100 * 201 = 20100, over the cap
    const created = await createSheet({ title: 'OverCap', data: rows });

    expect(created.ok).toBe(false);
    expect(created.sheetId).toBeUndefined();
    // Confirm nothing partial landed in the store under any id.
    expect(Object.keys(useStore.getState().sheets).length).toBe(
      Object.keys(initialState.sheets).length,
    );
  });

  it('rapid consecutive creates: each new sheet is immediately describable right after its own create call', async () => {
    for (let i = 0; i < 25; i++) {
      const created = await createSheet({ title: `Rapid ${i}` });
      expect(created.ok).toBe(true);
      const described = await describeSheet(created.sheetId!);
      expect(described.ok).toBe(true);
    }
  });

  it('concurrent creates fired without awaiting between them each land under a distinct, describable id', async () => {
    // Fire all createSheet calls back-to-back without awaiting each one first,
    // simulating a client that doesn't serialize calls. Because createSheet has
    // no internal await, each call's synchronous body (id gen + store.addSheet)
    // still runs to completion before the next one starts (JS is single-threaded
    // and none of these yield), but this exercises that assumption directly
    // rather than just asserting it.
    const promises = Array.from({ length: 10 }, (_, i) => createSheet({ title: `Concurrent ${i}` }));
    const created = await Promise.all(promises);

    const ids = created.map((c) => {
      expect(c.ok).toBe(true);
      return c.sheetId!;
    });

    // All ids must be distinct.
    expect(new Set(ids).size).toBe(ids.length);

    const described = await Promise.all(ids.map((id) => describeSheet(id)));
    described.forEach((d) => expect(d.ok).toBe(true));
  });

  it('a describeSheet interleaved between two createSheet calls (another tool call "in flight") does not see a torn store', async () => {
    const first = await createSheet({ title: 'First' });
    expect(first.ok).toBe(true);

    // Start a second create, but race a describeSheet of the FIRST sheet
    // against it without awaiting the second create first.
    const secondPromise = createSheet({ title: 'Second' });
    const describedFirst = await describeSheet(first.sheetId!);
    const second = await secondPromise;

    expect(describedFirst.ok).toBe(true);
    expect(second.ok).toBe(true);

    const describedSecond = await describeSheet(second.sheetId!);
    expect(describedSecond.ok).toBe(true);
  });
});
