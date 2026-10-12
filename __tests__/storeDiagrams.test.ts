import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramData } from '../types';

const persistence = vi.hoisted(() => ({
  loadAppState: vi.fn(),
  saveFullState: vi.fn(),
  saveIncrementalState: vi.fn(),
}));

vi.mock('../utils/persistence', () => persistence);

import { useStore } from '../store';

const makeDiagram = (id: string): DiagramData => ({
  id,
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  elements: [],
  version: 1,
});

describe('store diagrams', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useStore.setState({
      sheets: {}, sheetIds: [], charts: {}, chartIds: [], notes: {}, noteIds: [],
      diagrams: {}, diagramIds: [], history: [], future: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads a save from before diagrams existed', async () => {
    persistence.loadAppState.mockResolvedValue({
      sheets: [],
      charts: [],
      notes: [{ id: 'n1', position: { x: 0, y: 0 }, size: { width: 1, height: 1 }, content: '# hi', color: 'yellow', format: 'markdown' }],
      privateQueryResults: [],
      transform: null,
    });
    await useStore.getState().init();
    expect(useStore.getState().noteIds).toEqual(['n1']);
    expect(useStore.getState().diagramIds).toEqual([]);
    expect(useStore.getState().diagrams).toEqual({});
  });

  it('loads persisted diagrams', async () => {
    persistence.loadAppState.mockResolvedValue({
      sheets: [], charts: [], notes: [], diagrams: [makeDiagram('d1')], privateQueryResults: [], transform: null,
    });
    await useStore.getState().init();
    expect(useStore.getState().diagramIds).toEqual(['d1']);
  });

  it('undo and redo cover diagram add, update and delete', () => {
    const store = useStore.getState();
    store.addDiagram(makeDiagram('d1'));
    expect(useStore.getState().diagramIds).toEqual(['d1']);

    useStore.getState().saveSnapshot();
    useStore.getState().updateDiagram('d1', { title: 'Org' });
    useStore.getState().undo();
    expect(useStore.getState().diagrams.d1.title).toBeUndefined();
    useStore.getState().redo();
    expect(useStore.getState().diagrams.d1.title).toBe('Org');

    useStore.getState().deleteDiagram('d1');
    expect(useStore.getState().diagramIds).toEqual([]);
    useStore.getState().undo();
    expect(useStore.getState().diagramIds).toEqual(['d1']);
    useStore.getState().undo();
    useStore.getState().undo();
    expect(useStore.getState().diagramIds).toEqual([]);
  });

  it('closes the editor when its diagram is deleted or undone away', () => {
    useStore.getState().addDiagram(makeDiagram('d3'));
    useStore.getState().setEditingDiagramId('d3');
    useStore.getState().deleteDiagram('d3');
    expect(useStore.getState().editingDiagramId).toBeNull();

    useStore.getState().undo();
    useStore.getState().setEditingDiagramId('d3');
    useStore.getState().undo(); // back to before addDiagram
    expect(useStore.getState().diagramIds).toEqual([]);
    expect(useStore.getState().editingDiagramId).toBeNull();
  });

  it('deleteSelected removes selected diagrams', () => {
    useStore.getState().addDiagram(makeDiagram('d2'));
    useStore.getState().select(['d2']);
    useStore.getState().deleteSelected();
    expect(useStore.getState().diagramIds).toEqual([]);
  });
});
