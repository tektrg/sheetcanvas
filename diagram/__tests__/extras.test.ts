import { describe, expect, it } from 'vitest';
import { specToScene } from '../specToElements';
import { addItems } from '../extras';
import { findBySemanticId } from '../patch';
import type { DiagramElement } from '../types';

const CURVE = specToScene({
  kind: 'curve',
  spec: { points: [{ x: 0, y: 0 }, { x: 2, y: 8 }, { x: 4, y: 3 }, { x: 8, y: 6 }], annotations: [{ id: 'peak', at: 2, label: 'Peak of hype' }] },
}).elements;

const get = (els: DiagramElement[], id: string) => {
  const el = findBySemanticId(els, id);
  if (!el) throw new Error(`missing ${id}`);
  return el;
};
const box = (el: DiagramElement) => {
  const xs = el.points ? el.points.map((p) => el.x + p[0]) : [el.x, el.x + el.width];
  const ys = el.points ? el.points.map((p) => el.y + p[1]) : [el.y, el.y + el.height];
  return { x: Math.min(...xs), y: Math.min(...ys), r: Math.max(...xs), b: Math.max(...ys) };
};
const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x < b.r && b.x < a.r && a.y < b.b && b.y < a.b;

describe('addItems (comic items on any diagram)', () => {
  it('stands a stick man on an anchor and puts his speech above, clear of existing text', () => {
    const warnings: string[] = [];
    const els = addItems(CURVE, [
      { type: 'character', id: 'me', anchor: 'pt:peak' },
      { type: 'speech', id: 'omg', text: 'OMG', speaker: 'me' },
    ], warnings);
    expect(els.slice(0, CURVE.length)).toEqual(CURVE); // existing drawing untouched
    const peak = get(els, 'pt:peak');
    const legs = get(els, 'char:me:legs');
    expect(box(legs).b).toBeCloseTo(peak.y, 0); // feet on the peak dot
    const omg = get(els, 'speech:omg');
    expect(box(omg).b).toBeLessThan(box(get(els, 'char:me:head')).y);
    for (const text of CURVE.filter((el) => el.type === 'text')) expect(hit(box(omg), box(text))).toBe(false);
    expect(get(els, 'speech:omg:tail').type).toBe('line');
    expect(get(els, 'char:me:arms').roughness).toBe(0); // single-stroke sketch style
  });

  it('adds a title above the whole drawing', () => {
    const els = addItems(CURVE, [{ type: 'title', id: 'main', text: 'AI adoption mountains in enterprise' }], []);
    const title = get(els, 'title:main');
    const top = Math.min(...CURVE.map((el) => box(el).y));
    expect(title.y + title.height).toBeLessThan(top);
    expect(title.fontSize).toBe(24);
  });

  it('honours placement + offset and scene coordinates', () => {
    const els = addItems(CURVE, [
      { type: 'prop', id: 'door', kind: 'door', anchor: 'pt:peak', placement: 'right', offset: { x: 10 } },
      { type: 'character', id: 'b', x: 50, y: 300 },
    ], []);
    const peak = box(get(els, 'pt:peak'));
    expect(box(get(els, 'prop:door')).x).toBeGreaterThan(peak.r);
    expect(box(get(els, 'char:b:legs')).b).toBeCloseTo(300, 0);
  });

  it('rejects unknown anchors and duplicate ids', () => {
    expect(() => addItems(CURVE, [{ type: 'character', id: 'x', anchor: 'pt:nope' }], [])).toThrow(/anchor "pt:nope"/);
    const once = addItems(CURVE, [{ type: 'character', id: 'me', anchor: 'pt:peak' }], []);
    expect(() => addItems(once, [{ type: 'character', id: 'me', anchor: 'pt:peak' }], [])).toThrow(/already exists/);
  });
});
