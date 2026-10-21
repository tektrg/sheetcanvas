import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({
  loadAppState: vi.fn(),
  saveFullState: vi.fn(),
  saveIncrementalState: vi.fn(),
}));

vi.mock('../utils/persistence', () => persistence);

import { useStore } from '../store';

describe('ephemeral public plugin workspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      sheets: { private: { id: 'private' } as never },
      sheetIds: ['private'],
      charts: {},
      chartIds: [],
      notes: {},
      noteIds: [],
      privateQueryResults: { cached: { id: 'cached' } as never },
      privateQueryResultIds: ['cached'],
      connections: [{ connectionId: 'ga', type: 'google-analytics', name: 'Private GA' }],
    });
  });

  it('starts empty without loading or saving the persisted default workspace', async () => {
    await useStore.getState().init({ ephemeral: true });

    const state = useStore.getState();
    expect(persistence.loadAppState).not.toHaveBeenCalled();
    expect(persistence.saveFullState).not.toHaveBeenCalled();
    expect(persistence.saveIncrementalState).not.toHaveBeenCalled();
    expect(state.sheetIds).toEqual([]);
    expect(state.chartIds).toEqual([]);
    expect(state.noteIds).toEqual([]);
    expect(state.privateQueryResultIds).toEqual([]);
    expect(state.connections).toEqual([]);
  });
});
