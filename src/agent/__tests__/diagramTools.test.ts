import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../../store';
import { toolDefs } from '../../../agent/tools';
import { executeClientTool } from '../clientToolExecutor';

const resolver = { getSelection: () => ({ sheetId: null, cellId: null, range: null }) };
const run = (name: string, input: unknown) => executeClientTool(name, input, resolver) as Promise<any>;

const ORG_INPUT = {
  kind: 'orgchart',
  title: 'Leadership',
  spec: { nodes: [{ id: 'ceo', label: 'CEO' }, { id: 'cto', label: 'CTO', parentId: 'ceo' }] },
};

describe('diagram tools', () => {
  beforeEach(() => {
    useStore.setState({
      sheets: {}, sheetIds: [], charts: {}, chartIds: [], notes: {}, noteIds: [],
      diagrams: {}, diagramIds: [], editingDiagramId: null, history: [], future: [],
    });
  });

  it('createDiagram adds a diagram and returns semantic element ids', async () => {
    const result = await run('createDiagram', ORG_INPUT);
    expect(result.ok).toBe(true);
    expect(result.elementIds).toEqual(expect.arrayContaining(['node:ceo', 'node:cto', 'edge:ceo->cto']));
    const diagram = useStore.getState().diagrams[result.diagramId];
    expect(diagram).toMatchObject({ title: 'Leadership', version: 1 });
    expect(diagram.size.width).toBeGreaterThan(0);
    expect(useStore.getState().diagramIds).toEqual([result.diagramId]);
  });

  it('createDiagram reports invalid specs as ok:false', async () => {
    const result = await run('createDiagram', { kind: 'flow', spec: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'zz' }] } });
    expect(result).toEqual({ ok: false, error: 'edge.to refers to unknown node id: zz' });
  });

  it('updateDiagramElement then readDiagram round-trips the change', async () => {
    const { diagramId } = await run('createDiagram', ORG_INPUT);
    const update = await run('updateDiagramElement', { diagramId, id: 'node:cto', patch: { label: 'VP Eng', color: 'blue' } });
    expect(update.ok).toBe(true);

    const read = await run('readDiagram', { diagramId });
    expect(read.kind).toBe('orgchart');
    expect(read.elements.find((e: any) => e.id === 'node:cto')).toMatchObject({ label: 'VP Eng', color: '#a5d8ff' });
    expect(read.elements.some((e: any) => e.geometry)).toBe(false);

    const list = await run('listDiagrams', {});
    expect(list.diagrams).toEqual([{ diagramId, title: 'Leadership', kind: 'orgchart', elementCount: 5 }]);
  });

  it('agent updates are undoable', async () => {
    const { diagramId } = await run('createDiagram', ORG_INPUT);
    await run('updateDiagramElement', { diagramId, id: 'node:cto', patch: { label: 'VP Eng' } });
    useStore.getState().undo();
    const read = await run('readDiagram', { diagramId });
    expect(read.elements.find((e: any) => e.id === 'node:cto').label).toBe('CTO');
  });

  it('returns ok:false for unknown diagram or element ids', async () => {
    expect(await run('readDiagram', { diagramId: 'nope' })).toEqual({ ok: false, error: 'Unknown diagramId: nope' });
    const { diagramId } = await run('createDiagram', ORG_INPUT);
    const result = await run('updateDiagramElement', { diagramId, id: 'node:ghost', patch: { label: 'x' } });
    expect(result).toEqual({ ok: false, error: 'Unknown element id: node:ghost' });
  });

  it('refuses agent updates while the user has the diagram open in the editor', async () => {
    const { diagramId } = await run('createDiagram', ORG_INPUT);
    useStore.getState().setEditingDiagramId(diagramId);
    const result = await run('updateDiagramElement', { diagramId, id: 'node:cto', patch: { label: 'x' } });
    expect(result).toEqual({ ok: false, error: 'diagram is being edited' });
  });

  it('createDiagram schema rejects a spec that does not match its kind', () => {
    const parsed = toolDefs.createDiagram.inputSchema.safeParse({ kind: 'curve', spec: ORG_INPUT.spec });
    expect(parsed.success).toBe(false);
    expect(toolDefs.createDiagram.inputSchema.safeParse(ORG_INPUT).success).toBe(true);
  });
});
