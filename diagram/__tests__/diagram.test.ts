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
