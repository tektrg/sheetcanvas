import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { specToScene } from '../specToElements';
import { patchElement, findBySemanticId } from '../patch';
import { summarizeElements } from '../summarize';
import { DiagramSvg } from '../renderSvg';
import type { ComicSpec, DiagramElement, FreeformSpec } from '../types';

const ids = (els: DiagramElement[]) => els.map((el) => el.customData?.id);
const byId = (els: DiagramElement[], id: string) => {
  const el = findBySemanticId(els, id);
  if (!el) throw new Error(`missing ${id}`);
  return el;
};

export const XKCD: ComicSpec = {
  panels: [{
    id: 'p1',
    items: [
      { type: 'prop', id: 'desk', kind: 'desk', x: 250, y: 270 },
      { type: 'prop', id: 'pc', kind: 'monitor', x: 270, y: 200, facing: 'left' },
      { type: 'prop', id: 'chair', kind: 'chair', x: 170, y: 270 },
      { type: 'speech', id: 's1', text: 'Are you coming to bed?', x: 270, y: 40, speaker: 'off' },
      { type: 'character', id: 'me', x: 170, y: 270, pose: 'type' },
      { type: 'character', id: 'off', x: 420, y: 40, offPanel: true },
      { type: 'speech', id: 's2', text: "I can't. Someone is wrong on the internet.", x: 140, y: 90, speaker: 'me' },
    ],
  }],
};

describe('freeform kind', () => {
  const spec: FreeformSpec = {
    shapes: [
      { id: 'box', type: 'rect', x: 10, y: 10, width: 80, height: 40, fill: 'yellow', color: 'red' },
      { id: 'wave', type: 'freedraw', x: 100, y: 100, points: [[0, 0], [10, 5], [20, -3]] },
      { id: 'hi', type: 'text', x: 200, y: 20, text: 'Hello', fontSize: 24, textAlign: 'center' },
      { id: 'link', type: 'arrow', x: 0, y: 0, points: [[0, 0], [50, 50]], strokeStyle: 'dashed', roughness: 2 },
    ],
  };

  it('maps primitives to Excalidraw elements with the shape id as semantic id', () => {
    const { elements, warnings } = specToScene({ kind: 'freeform', spec });
    expect(ids(elements)).toEqual(['box', 'wave', 'hi', 'link']);
    expect(warnings).toEqual([]);
    const box = byId(elements, 'box');
    expect(box).toMatchObject({ type: 'rectangle', backgroundColor: '#ffec99', strokeColor: '#e03131', roundness: null });
    const wave = byId(elements, 'wave');
    expect(wave).toMatchObject({ type: 'freedraw', x: 100, y: 100, width: 20, height: 8, simulatePressure: true });
    const hi = byId(elements, 'hi');
    expect(hi.fontSize).toBe(24);
    expect(hi.x + hi.width / 2).toBeCloseTo(200);
    expect(byId(elements, 'link')).toMatchObject({ strokeStyle: 'dashed', roughness: 2, endArrowhead: 'arrow' });
  });

  it('rejects missing points / text and duplicate ids; warns on off-canvas shapes', () => {
    const bad = (shape: FreeformSpec['shapes'][number]) => () => specToScene({ kind: 'freeform', spec: { shapes: [shape] } });
    expect(bad({ id: 'l', type: 'line', x: 0, y: 0 })).toThrow(/"l" \(line\) needs points/);
    expect(bad({ id: 't', type: 'text', x: 0, y: 0 })).toThrow(/"t" \(text\) needs text/);
    const dup = { id: 'a', type: 'rect' as const, x: 0, y: 0 };
    expect(() => specToScene({ kind: 'freeform', spec: { shapes: [dup, dup] } })).toThrow(/Duplicate shape id "a"/);
    const { warnings } = specToScene({ kind: 'freeform', spec: { width: 100, height: 100, shapes: [{ id: 'big', type: 'rect', x: 50, y: 50, width: 100 }] } });
    expect(warnings[0]).toMatch(/past the 100x100 canvas: big/);
  });

});

describe('comic kind', () => {
  const scene = () => specToScene({ kind: 'comic', spec: XKCD }).elements;

  it('builds panel, grouped stick figure, props and speech with semantic ids', () => {
    const elements = scene();
    expect(ids(elements)).toEqual(expect.arrayContaining([
      'panel:p1', 'prop:desk', 'prop:pc:screen', 'prop:pc:stand', 'prop:chair:back', 'prop:chair:seat',
      'char:me:head', 'char:me:body', 'char:me:arms', 'char:me:legs',
      'speech:s1', 'speech:s1:tail', 'speech:s2', 'speech:s2:tail',
    ]));
    expect(ids(elements).some((id) => id?.startsWith('char:off'))).toBe(false);
    expect(byId(elements, 'char:me:head').groupIds).toEqual(['char:me']);
    expect(byId(elements, 'panel:p1')).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    const s2 = byId(elements, 'speech:s2');
    expect(s2).toMatchObject({ fontFamily: 5, roughness: 1, strokeColor: '#1e1e1e' });
    expect(s2.text).toBe(s2.text?.toUpperCase());
  });

  it('tail stops short of the head; off-panel tail ends on the panel edge', () => {
    const elements = scene();
    const head = byId(elements, 'char:me:head');
    const center = { x: head.x + head.width / 2, y: head.y + head.height / 2 };
    const tail = byId(elements, 'speech:s2:tail');
    const [, [ex, ey]] = tail.points!;
    const gap = Math.hypot(tail.x + ex - center.x, tail.y + ey - center.y);
    expect(gap).toBeGreaterThan(head.width / 2);
    expect(gap).toBeLessThan(head.width / 2 + 20);
    const off = byId(elements, 'speech:s1:tail');
    expect(off.x + off.points![1][0]).toBeCloseTo(400);
  });

  it('sitting figure hips sit on the chair seat', () => {
    const elements = scene();
    const body = byId(elements, 'char:me:body');
    const seat = byId(elements, 'prop:chair:seat');
    expect(body.y + body.points![1][1]).toBeCloseTo(seat.y);
  });

  it('bubble tail, facing mirror, row layout, captions and shape items', () => {
    const spec: ComicSpec = {
      panels: [
        { id: 'a', items: [{ type: 'character', id: 'x', x: 100, y: 280, pose: 'wave', facing: 'left' }, { type: 'speech', id: 's', text: 'hi', x: 100, y: 60, speaker: 'x', tail: 'bubble' }] },
        { id: 'b', width: 200, items: [{ type: 'caption', id: 'c', text: 'Later' }, { type: 'shape', id: 'sun', shape: 'ellipse', x: 10, y: 10, width: 30, height: 30 }] },
      ],
    };
    const elements = specToScene({ kind: 'comic', spec }).elements;
    expect(byId(elements, 'speech:s:bubble').type).toBe('ellipse');
    const arms = byId(elements, 'char:x:arms');
    expect(Math.min(...arms.points!.map((p) => arms.x + p[0]))).toBeLessThan(100 - 20); // waving arm mirrored left
    expect(byId(elements, 'panel:b').x).toBe(420);
    expect(byId(elements, 'shape:sun')).toMatchObject({ type: 'ellipse', x: 430, y: 10 });
    const caption = byId(elements, 'caption:c');
    expect(caption.x + caption.width / 2).toBeCloseTo(520);
  });

  it('rejects unknown speakers and duplicate characters across panels', () => {
    const lone: ComicSpec = { panels: [{ id: 'p', items: [{ type: 'speech', id: 's', text: 'x', x: 0, y: 0, speaker: 'ghost' }] }] };
    expect(() => specToScene({ kind: 'comic', spec: lone })).toThrow(/unknown speaker "ghost"/);
    const char = { type: 'character' as const, id: 'me', x: 50, y: 250 };
    const twice: ComicSpec = { panels: [{ id: 'a', items: [char] }, { id: 'b', items: [char] }] };
    expect(() => specToScene({ kind: 'comic', spec: twice })).toThrow(/Duplicate character id "me"/);
  });

  it('works with patch, summary and SVG preview unchanged', () => {
    const elements = scene();
    const patched = patchElement(elements, 'speech:s2', { label: 'FINE.', color: 'red' });
    expect(patched.ok).toBe(true);
    if (patched.ok) expect(byId(patched.elements, 'speech:s2')).toMatchObject({ text: 'FINE.', strokeColor: '#e03131' });
    expect(summarizeElements(elements, false).some((s) => s.id === 'speech:s1')).toBe(true);
    const svg = renderToStaticMarkup(React.createElement(DiagramSvg, { elements: [...elements, ...specToScene({ kind: 'freeform', spec: { shapes: [{ id: 'f', type: 'freedraw', x: 0, y: 0, points: [[0, 0], [5, 5], [9, 2]] }] } }).elements] }));
    expect(svg).toContain('<ellipse');
    expect(svg).toContain('ARE YOU COMING');
    expect(svg).toMatch(/<path d="M0 0 C/);
  });

});
