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

  const CURVE_INPUT = {
    kind: 'curve',
    title: 'AI adoption mountains in enterprise',
    spec: { points: [{ x: 0, y: 0 }, { x: 2, y: 8 }, { x: 5, y: 3 }], annotations: [{ id: 'peak', at: 2, label: 'Peak' }] },
  };

  it('createDiagram draws extras and a visible title in one call', async () => {
    const result = await run('createDiagram', {
      ...CURVE_INPUT,
      showTitle: true,
      extras: [{ type: 'character', id: 'me', anchor: 'pt:peak' }, { type: 'speech', id: 'omg', text: 'OMG', speaker: 'me' }],
    });
    expect(result.ok).toBe(true);
    expect(result.elementIds).toEqual(expect.arrayContaining(['curve:main', 'char:me:head', 'speech:omg', 'title:main']));
  });

  it('addToDiagram adds items to an existing diagram (undoable) and returns only new ids', async () => {
    const { diagramId } = await run('createDiagram', CURVE_INPUT);
    const result = await run('addToDiagram', { diagramId, items: [{ type: 'character', id: 'me', anchor: 'pt:peak' }, { type: 'speech', id: 'omg', text: 'OMG', speaker: 'me' }] });
    expect(result.ok).toBe(true);
    expect(result.elementIds).toEqual(expect.arrayContaining(['char:me:head', 'speech:omg']));
    expect(result.elementIds).not.toContain('curve:main');
    const ids = () => useStore.getState().diagrams[diagramId].elements.map((el) => el.customData?.id);
    expect(ids()).toContain('speech:omg');
    useStore.getState().undo();
    expect(ids()).not.toContain('speech:omg');
  });

  it('addToDiagram reports bad anchors, unknown diagrams and the edit lock', async () => {
    const { diagramId } = await run('createDiagram', CURVE_INPUT);
    expect(await run('addToDiagram', { diagramId, items: [{ type: 'character', id: 'x', anchor: 'pt:zz' }] })).toMatchObject({ ok: false, error: expect.stringMatching(/anchor "pt:zz"/) });
    expect(await run('addToDiagram', { diagramId: 'nope', items: [{ type: 'title', id: 't', text: 'T' }] })).toMatchObject({ ok: false });
    useStore.setState({ editingDiagramId: diagramId });
    expect(await run('addToDiagram', { diagramId, items: [{ type: 'title', id: 't', text: 'T' }] })).toEqual({ ok: false, error: 'diagram is being edited' });
  });

  it('addToDiagram schema rejects unknown item types and fields', () => {
    const schema = toolDefs.addToDiagram.inputSchema;
    expect(schema.safeParse({ diagramId: 'd', items: [{ type: 'title', id: 't', text: 'x' }] }).success).toBe(true);
    expect(schema.safeParse({ diagramId: 'd', items: [{ type: 'robot', id: 't' }] }).success).toBe(false);
    expect(schema.safeParse({ diagramId: 'd', items: [{ type: 'character', id: 'a', anchor: 'pt:p', bogus: 1 }] }).success).toBe(false);
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


describe('createDiagram input validation (QA pass 2)', () => {
  const schema = toolDefs.createDiagram.inputSchema;
  const messages = (input: unknown) => {
    const parsed = schema.safeParse(input);
    return parsed.success ? [] : parsed.error.issues.map((i) => i.message);
  };

  it('names the exact failing field instead of "Invalid input"', () => {
    expect(messages({ kind: 'orgchart', spec: { nodes: [{ id: 'a' }] } })[0]).toMatch(/^spec\.nodes\.0\.label: /);
  });

  it('rejects unknown keys per kind (strict)', () => {
    expect(messages({ kind: 'flow', spec: { nodes: [{ id: 'a', label: 'A' }], edges: [], extra: 1 } }).join(' ')).toMatch(/spec: .*extra/i);
    expect(messages({ kind: 'orgchart', spec: { nodes: [{ id: 'a', label: 'A', shape: 'rect' }] } }).length).toBeGreaterThan(0);
  });

  it('rejects non-ASCII ids', () => {
    expect(messages({ kind: 'orgchart', spec: { nodes: [{ id: 'giám-đốc', label: 'A' }] } }).length).toBeGreaterThan(0);
  });

  it('defaults curve annotations and returns clamp warnings', async () => {
    const result = await run('createDiagram', { kind: 'curve', spec: { points: [{ x: 0, y: 0 }, { x: 4, y: 2 }] } });
    expect(result.ok).toBe(true);
    const warned = await run('createDiagram', { kind: 'curve', spec: { points: [{ x: 0, y: 0 }, { x: 4, y: 2 }], annotations: [{ id: 'p', at: -3, label: 'P' }] } });
    expect(warned.warnings[0]).toMatch(/clamped to 0/);
  });
});
