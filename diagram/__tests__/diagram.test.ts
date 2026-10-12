import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { specToElements } from '../specToElements';
import { patchElement, findBySemanticId } from '../patch';
import { ensureSemanticIds } from '../ensureIds';
import { summarizeElements } from '../summarize';
import { DiagramSvg } from '../renderSvg';
import type { DiagramElement, DiagramSpec } from '../types';

const ORG: DiagramSpec = {
  kind: 'orgchart',
  spec: {
    nodes: [
      { id: 'ceo', label: 'CEO' },
      { id: 'cto', label: 'CTO', parentId: 'ceo', color: 'blue' },
      { id: 'cfo', label: 'CFO', parentId: 'ceo' },
    ],
  },
};

const FLOW: DiagramSpec = {
  kind: 'flow',
  spec: {
    nodes: [
      { id: 'start', label: 'Start', shape: 'ellipse' },
      { id: 'ok', label: 'OK?', shape: 'diamond' },
      { id: 'done', label: 'Done' },
    ],
    edges: [
      { from: 'start', to: 'ok' },
      { from: 'ok', to: 'done', label: 'yes' },
    ],
    direction: 'LR',
  },
};

const CURVE: DiagramSpec = {
  kind: 'curve',
  spec: {
    points: [{ x: 0, y: 0 }, { x: 1, y: 10 }, { x: 3, y: 2 }, { x: 10, y: 7 }],
    annotations: [{ id: 'peak', at: 1, label: 'Peak of Mount Stupid' }],
    axes: { x: 'Competence', y: 'Confidence' },
  },
};

const semanticIds = (els: DiagramElement[]) => els.map((el) => el.customData?.id);
const byId = (els: DiagramElement[]) => new Map(els.map((el) => [el.id, el]));

describe('specToElements', () => {
  it.each([ORG, FLOW, CURVE])('gives every element a unique semantic id ($kind)', (spec) => {
    const ids = semanticIds(specToElements(spec));
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each([ORG, FLOW])('binds arrows and labels to existing elements ($kind)', (spec) => {
    const els = specToElements(spec);
    const map = byId(els);
    for (const el of els) {
      if (el.type === 'arrow') {
        expect(map.get(el.startBinding!.elementId)?.boundElements).toContainEqual({ id: el.id, type: 'arrow' });
        expect(map.get(el.endBinding!.elementId)?.boundElements).toContainEqual({ id: el.id, type: 'arrow' });
      }
      if (el.type === 'text' && el.containerId) {
        expect(map.get(el.containerId)?.boundElements).toContainEqual({ id: el.id, type: 'text' });
      }
    }
  });

  it('uses readable semantic ids', () => {
    const ids = semanticIds(specToElements(ORG));
    expect(ids).toContain('node:ceo');
    expect(ids).toContain('node:ceo:label');
    expect(ids).toContain('edge:ceo->cto');
    expect(semanticIds(specToElements(CURVE))).toEqual(expect.arrayContaining(['curve:main', 'pt:peak', 'pt:peak:label', 'axis:x']));
  });

  it('is deterministic', () => {
    expect(specToElements(FLOW)).toEqual(specToElements(FLOW));
  });

  it('lays an org chart out top-down', () => {
    const map = new Map(specToElements(ORG).map((el) => [el.customData?.id, el]));
    expect(map.get('node:cto')!.y).toBeGreaterThan(map.get('node:ceo')!.y);
    expect(map.get('node:cto')!.y).toBe(map.get('node:cfo')!.y);
  });

  it('rejects edges to unknown nodes and duplicate ids', () => {
    expect(() => specToElements({ kind: 'flow', spec: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'x' }] } })).toThrow(/unknown node/);
    expect(() => specToElements({ kind: 'orgchart', spec: { nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] } })).toThrow(/Duplicate/);
  });
});

describe('patchElement', () => {
  it('changes only the named fields and keeps user geometry and style', () => {
    const user = specToElements(ORG).map((el) =>
      el.customData?.id === 'node:cto' ? { ...el, x: 999, y: 777, width: 300, strokeColor: '#ff0000', strokeWidth: 4 } : el,
    );
    const result = patchElement(user, 'node:cto', { label: 'Chief Tech', color: 'green', revealAt: 0.4 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const cto = findBySemanticId(result.elements, 'node:cto')!;
    expect(cto).toMatchObject({ x: 999, y: 777, width: 300, strokeColor: '#ff0000', strokeWidth: 4, backgroundColor: '#b2f2bb' });
    expect(cto.customData).toEqual({ id: 'node:cto', revealAt: 0.4 });
    expect(findBySemanticId(result.elements, 'node:cto:label')!.text).toBe('Chief Tech');
  });

  it('removes a node with its label and attached arrows, cleaning references', () => {
    const result = patchElement(specToElements(ORG), 'node:cto', { remove: true });
    if (!result.ok) throw new Error('patch failed');
    const ids = semanticIds(result.elements);
    expect(ids).not.toContain('node:cto');
    expect(ids).not.toContain('node:cto:label');
    expect(ids).not.toContain('edge:ceo->cto');
    const ceo = findBySemanticId(result.elements, 'node:ceo')!;
    expect(ceo.boundElements?.some((b) => b.id === 'edge:ceo->cto')).toBe(false);
  });

  it('sets draw on lines and rejects it on shapes or unknown ids', () => {
    const curve = specToElements(CURVE);
    const ok = patchElement(curve, 'curve:main', { draw: [0.1, 0.6] });
    expect(ok.ok && findBySemanticId(ok.elements, 'curve:main')!.customData?.draw).toEqual([0.1, 0.6]);
    expect(patchElement(curve, 'pt:peak', { draw: [0, 1] }).ok).toBe(false);
    expect(patchElement(curve, 'node:nope', { label: 'x' })).toEqual({ ok: false, error: 'Unknown element id: node:nope' });
  });
});

describe('ensureSemanticIds', () => {
  it('assigns user ids, dedupes copies, and drops deleted elements', () => {
    const [shape] = specToElements(ORG);
    const copy = { ...shape, id: 'copy-1' };
    const drawn = { ...shape, id: 'drawn', customData: undefined };
    const deleted = { ...shape, id: 'gone', isDeleted: true, customData: { id: 'user:7' } };
    const existingUser = { ...shape, id: 'u2', customData: { id: 'user:2' } };
    const result = ensureSemanticIds([shape, copy, drawn, deleted, existingUser]);
    expect(semanticIds(result)).toEqual(['node:ceo', 'user:3', 'user:4', 'user:2']);
  });
});

describe('ensureSemanticIds original wins', () => {
  it('keeps the id on the older element even when the copy comes first', () => {
    const [shape] = specToElements(ORG);
    const copy = { ...shape, id: 'copy-1', version: shape.version + 3 };
    const result = ensureSemanticIds([copy, shape]);
    expect(result.find((el) => el.id === shape.id)!.customData?.id).toBe('node:ceo');
    expect(result.find((el) => el.id === 'copy-1')!.customData?.id).toBe('user:1');
  });
});

describe('patchElement labels', () => {
  it('grows the container about its centre and centres a long multi-line label', () => {
    const els = specToElements(ORG);
    const before = findBySemanticId(els, 'node:cto')!;
    const label = 'Chief Technology Officer and Head of Platform\nSecond line\nThird line';
    const result = patchElement(els, 'node:cto', { label });
    if (!result.ok) throw new Error('patch failed');
    const shape = findBySemanticId(result.elements, 'node:cto')!;
    const text = findBySemanticId(result.elements, 'node:cto:label')!;
    expect(shape.width).toBeGreaterThan(before.width);
    expect(shape.height).toBeGreaterThan(before.height);
    expect(shape.width).toBeGreaterThanOrEqual(text.width);
    expect(shape.height).toBeGreaterThanOrEqual(text.height);
    const centre = (e: DiagramElement) => ({ x: e.x + e.width / 2, y: e.y + e.height / 2 });
    expect(centre(shape).x).toBeCloseTo(centre(before).x);
    expect(centre(shape).y).toBeCloseTo(centre(before).y);
    expect(centre(text).x).toBeCloseTo(centre(shape).x);
    expect(centre(text).y).toBeCloseTo(centre(shape).y);
  });
});

describe('summarizeElements', () => {
  it('folds labels into owners, reports edges by semantic id, omits geometry by default', () => {
    const summary = summarizeElements(specToElements(FLOW));
    expect(summary.find((s) => s.id === 'node:ok')).toEqual({ id: 'node:ok', type: 'diamond', label: 'OK?' });
    expect(summary.find((s) => s.id === 'edge:ok->done')).toMatchObject({ from: 'node:ok', to: 'node:done', label: 'yes' });
    expect(summary.some((s) => s.id.endsWith(':label'))).toBe(false);
    expect(summary.some((s) => s.geometry)).toBe(false);
    expect(summarizeElements(specToElements(FLOW), true).every((s) => s.geometry)).toBe(true);
  });
});

describe('DiagramSvg', () => {
  it('renders shapes, arrows and labels', () => {
    const markup = renderToStaticMarkup(React.createElement(DiagramSvg, { elements: specToElements(FLOW) }));
    expect(markup).toContain('<ellipse');
    expect(markup).toContain('<polygon');
    expect(markup).toContain('marker-end');
    expect(markup).toContain('OK?');
  });
});

describe('QA pass 2 converter rules', () => {
  const byId2 = (els: DiagramElement[]) => new Map(els.map((el) => [el.customData?.id, el]));

  it('wraps long labels at ~30 chars on word boundaries and sizes the node to fit', () => {
    const els = specToElements({ kind: 'orgchart', spec: { nodes: [{ id: 'a', label: 'Chief Executive Officer of the Whole Holding Group' }] } });
    const map = byId2(els);
    const text = map.get('node:a:label')!;
    expect(text.text).toBe('Chief Executive Officer of the\nWhole Holding Group');
    expect(text.text!.split('\n').every((line) => line.length <= 30)).toBe(true);
    expect(map.get('node:a')!.height).toBeGreaterThanOrEqual(text.height);
  });

  it('routes a back edge around the side so it does not overlap the forward edge', () => {
    const els = specToElements({ kind: 'flow', spec: {
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b', label: 'go' }, { from: 'b', to: 'a', label: 'retry' }],
    } });
    const map = byId2(els);
    const forward = map.get('edge:a->b')!;
    const back = map.get('edge:b->a')!;
    expect(forward.points).toHaveLength(2);
    expect(back.points).toHaveLength(3);
    const backMaxX = back.x + Math.max(...back.points!.map((p) => p[0]));
    expect(backMaxX).toBeGreaterThan(forward.x + 30);
    const fl = map.get('edge:a->b:label')!;
    const bl = map.get('edge:b->a:label')!;
    expect(Math.abs(fl.x - bl.x)).toBeGreaterThan(20);
  });

  it('rejects self-loops and org chart cycles with clear messages', () => {
    expect(() => specToElements({ kind: 'flow', spec: { nodes: [{ id: 'a', label: 'A' }], edges: [{ from: 'a', to: 'a' }] } }))
      .toThrow('Self-loops are not supported: edge a -> a');
    expect(() => specToElements({ kind: 'orgchart', spec: { nodes: [
      { id: 'a', label: 'A', parentId: 'c' }, { id: 'b', label: 'B', parentId: 'a' }, { id: 'c', label: 'C', parentId: 'b' },
    ] } })).toThrow(/parentId cycle: a -> c -> b -> a/);
  });

  it('clamps out-of-range curve annotations with a warning, and annotations are optional', async () => {
    const { specToScene } = await import('../specToElements');
    const scene = specToScene({ kind: 'curve', spec: { points: [{ x: 0, y: 0 }, { x: 10, y: 5 }], annotations: [{ id: 'far', at: 99, label: 'Far' }] } });
    expect(scene.warnings[0]).toMatch(/far: at=99 .*clamped to 10/);
    const dot = byId2(scene.elements).get('pt:far')!;
    expect(dot.x + dot.width / 2).toBe(560);
    expect(() => specToElements({ kind: 'curve', spec: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })).not.toThrow();
  });

  it('labelling an unlabelled arrow creates a bound label', () => {
    const els = specToElements(ORG);
    const result = patchElement(els, 'edge:ceo->cto', { label: 'reports' });
    if (!result.ok) throw new Error('patch failed');
    const arrow = findBySemanticId(result.elements, 'edge:ceo->cto')!;
    const label = findBySemanticId(result.elements, 'edge:ceo->cto:label')!;
    expect(label).toMatchObject({ text: 'reports', containerId: arrow.id });
    expect(arrow.boundElements).toContainEqual({ id: label.id, type: 'text' });
  });
});
