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
    expect(Math.abs(body.y + body.points!.at(-1)![1] - seat.y)).toBeLessThan(6); // thigh rests just above the seat line
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


  describe('auto-layout', () => {
    const MINIMAL: ComicSpec = {
      panels: [{
        id: 'p1',
        items: [
          { type: 'prop', id: 'desk', kind: 'desk' },
          { type: 'prop', id: 'pc', kind: 'monitor', on: 'desk' },
          { type: 'prop', id: 'chair', kind: 'chair' },
          { type: 'character', id: 'me', pose: 'type', on: 'chair' },
          { type: 'character', id: 'wife', offPanel: true },
          { type: 'speech', id: 's1', text: 'Are you coming to bed?', speaker: 'wife' },
          { type: 'speech', id: 's2', text: "I can't. This is important.", speaker: 'me' },
          { type: 'speech', id: 's3', text: 'What?', speaker: 'wife' },
          { type: 'speech', id: 's4', text: 'Someone is wrong on the internet.', speaker: 'me' },
        ],
      }],
    };
    const box = (el: DiagramElement) => ({ x: el.x, y: el.y, width: el.width, height: el.height });
    const hit = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

    it('places everything from order alone: floor, scale, snapping', () => {
      const { elements, warnings } = specToScene({ kind: 'comic', spec: MINIMAL });
      for (const w of warnings) expect(w).toMatch(/grew \d+px taller/); // only headroom growth, never crowding
      const grown = byId(elements, 'panel:p1').height - 300;
      const desk = byId(elements, 'prop:desk');
      expect(desk.y + desk.points![1][1] + 70 * 1.35).toBeCloseTo(300 * 0.85 + grown); // desk legs stand on the floor line
      const stand = byId(elements, 'prop:pc:stand');
      expect(stand.y).toBeCloseTo(desk.y + desk.points![1][1]); // monitor sits on the desk top
      const body = byId(elements, 'char:me:body');
      expect(Math.abs(body.y + body.points!.at(-1)![1] - byId(elements, 'prop:chair:seat').y)).toBeLessThan(6); // seated
      const arms = byId(elements, 'char:me:arms');
      const hand = Math.max(...arms.points!.map((p) => arms.x + p[0]));
      expect(hand).toBeGreaterThan(desk.x + desk.points![1][0]); // hands reach over the desk edge
      const head = byId(elements, 'char:me:head');
      expect(head.height / (12 * 1.94)).toBeCloseTo(300 * 0.45 / 100); // scaled to panel height
    });

    it('speech stays inside the panel, never overlaps, and tails avoid other text', () => {
      const { elements } = specToScene({ kind: 'comic', spec: MINIMAL });
      const speech = ['s1', 's2', 's3', 's4'].map((id) => byId(elements, `speech:${id}`));
      for (const s of speech) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.width).toBeLessThanOrEqual(400);
      }
      for (let i = 0; i < speech.length; i++) for (let j = i + 1; j < speech.length; j++) expect(hit(box(speech[i]), box(speech[j]))).toBe(false);
      speech.forEach((s, i) => i && expect(s.y).toBeGreaterThan(speech[i - 1].y - 10)); // reading order top-down
      for (const tail of elements.filter((el) => el.customData?.id?.endsWith(':tail'))) {
        const pts = tail.points!.map(([px, py]) => ({ x: tail.x + px, y: tail.y + py }));
        const own = tail.customData!.id.replace(':tail', '');
        for (const s of speech.filter((s) => s.customData?.id !== own)) {
          for (let k = 0; k < pts.length - 1; k++) {
            const seg = { x: Math.min(pts[k].x, pts[k + 1].x), y: Math.min(pts[k].y, pts[k + 1].y), width: Math.abs(pts[k].x - pts[k + 1].x) || 0.1, height: Math.abs(pts[k].y - pts[k + 1].y) || 0.1 };
            if (!hit(seg, box(s))) continue;
            // bounding boxes touch: check the segment itself via sampling
            for (let t = 0; t <= 1; t += 0.02) {
              const p = { x: pts[k].x + (pts[k + 1].x - pts[k].x) * t, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t };
              expect(p.x > s.x && p.x < s.x + s.width && p.y > s.y && p.y < s.y + s.height).toBe(false);
            }
          }
        }
      }
    });

    it('corrects given coordinates that overflow or collide, with warnings', () => {
      const spec: ComicSpec = { panels: [{ id: 'p', items: [
        { type: 'character', id: 'a', x: 100 },
        { type: 'speech', id: 's1', text: 'A very long sentence that would spill', x: 390, y: 20, speaker: 'a' },
        { type: 'speech', id: 's2', text: 'Overlapping', x: 300, y: 20, speaker: 'a' },
      ] }] };
      const { elements, warnings } = specToScene({ kind: 'comic', spec });
      const s1 = byId(elements, 'speech:s1');
      expect(s1.x + s1.width).toBeLessThanOrEqual(400);
      expect(hit(box(s1), box(byId(elements, 'speech:s2')))).toBe(false);
      expect(warnings.join('\n')).toMatch(/speech:s1 moved/);
      expect(warnings.join('\n')).toMatch(/speech:s2 moved/);
    });

    it('snaps a nearby monitor and seated character, warns, and rejects bad `on`', () => {
      const spec: ComicSpec = { panels: [{ id: 'p', items: [
        { type: 'prop', id: 'desk', kind: 'desk', x: 250, y: 255 },
        { type: 'prop', id: 'pc', kind: 'monitor', x: 260, y: 150 },
        { type: 'prop', id: 'chair', kind: 'chair', x: 140, y: 255 },
        { type: 'character', id: 'me', x: 150, y: 250, pose: 'sit' },
      ] }] };
      const { elements, warnings } = specToScene({ kind: 'comic', spec });
      expect(warnings.join('\n')).toMatch(/prop:pc snapped onto desk/);
      expect(warnings.join('\n')).toMatch(/char:me snapped onto chair/);
      expect(byId(elements, 'char:me:body').x).toBeCloseTo(140);
      const bad: ComicSpec = { panels: [{ id: 'p', items: [{ type: 'character', id: 'me', pose: 'sit', on: 'nope' }] }] };
      expect(() => specToScene({ kind: 'comic', spec: bad })).toThrow(/on "nope", which is not a chair/);
    });

    it('puts the off-panel partner behind the typing character and sizes legs cleanly', () => {
      const { elements } = specToScene({ kind: 'comic', spec: MINIMAL });
      const tail = byId(elements, 'speech:s1:tail');
      const end = tail.points![tail.points!.length - 1];
      expect(tail.x + end[0]).toBeCloseTo(0); // character faces right, so the voice comes from the left edge
      const legs = byId(elements, 'char:me:legs');
      expect(legs.points).toHaveLength(7); // one profile leg hip -> knee -> foot (+2 wobble points per segment), no doubled lines
      const kneeX = legs.x + legs.points![3][0];
      const seat = byId(elements, 'prop:chair:seat');
      expect(kneeX).toBeGreaterThan(seat.x + seat.points![1][0]); // knee past the chair's front leg
      const right: ComicSpec = { panels: [{ id: 'p', items: [{ type: 'character', id: 'a' }, { type: 'character', id: 'b', offPanel: true, side: 'right' }, { type: 'speech', id: 's', text: 'Hey', speaker: 'b' }] }] };
      const t = byId(specToScene({ kind: 'comic', spec: right }).elements, 'speech:s:tail');
      expect(t.x + t.points![t.points!.length - 1][0]).toBeCloseTo(400);
    });

    it('grows the panel instead of covering drawings, and tails never cross limbs or props', () => {
      const busy: ComicSpec = { panels: [{ id: 'p', height: 200, items: [
        { type: 'character', id: 'a' }, { type: 'character', id: 'b' },
        ...['one two three four', 'five six seven eight', 'nine ten eleven twelve'].map((text, i) => ({ type: 'speech' as const, id: `s${i}`, text, speaker: i % 2 ? 'b' : 'a' })),
      ] }] };
      const { elements, warnings } = specToScene({ kind: 'comic', spec: busy });
      expect(warnings.join('\n')).toMatch(/panel p: grew \d+px taller/);
      const drawings = elements.filter((el) => el.customData?.id?.startsWith('char:'));
      for (const s of elements.filter((el) => /^speech:s\d$/.test(el.customData!.id))) for (const d of drawings) expect(hit(box(s), box(d))).toBe(false);
    });
  });
});

describe('hand-drawn style', () => {
  it('figures wobble deterministically and heads are slightly lopsided', async () => {
    const a = specToScene({ kind: 'comic', spec: XKCD }).elements;
    const b = specToScene({ kind: 'comic', spec: XKCD }).elements;
    const body = byId(a, 'char:me:body');
    expect(body.points!.length).toBe(4); // neck -> 2 wobble points -> hip
    expect(body.roundness).toEqual({ type: 2 });
    expect(byId(b, 'char:me:body').points).toEqual(body.points);
    const head = byId(a, 'char:me:head');
    expect(head.width).not.toBeCloseTo(head.height);
  });

  it('applyStyle maps style to roughness, varies width for rough, leaves text alone', async () => {
    const { applyStyle, defaultStyle } = await import('../style');
    const els = specToScene({ kind: 'comic', spec: XKCD }).elements;
    expect(defaultStyle('comic')).toBe('rough');
    expect(defaultStyle('flow')).toBeUndefined();
    const clean = applyStyle(els, 'clean');
    expect(byId(clean, 'char:me:arms').roughness).toBe(0);
    expect(byId(clean, 'speech:s1').roughness).toBe(byId(els, 'speech:s1').roughness);
    const rough = applyStyle(els, 'rough');
    const widths = rough.filter((el) => el.type !== 'text').map((el) => el.strokeWidth);
    expect(new Set(widths).size).toBeGreaterThan(1);
    for (const w of widths) expect(w).toBeGreaterThan(0);
    expect(applyStyle(els, 'rough')).toEqual(rough); // stable
  });

  it('patch sets roughness on shapes, rejects text', () => {
    const els = specToScene({ kind: 'comic', spec: XKCD }).elements;
    const ok = patchElement(els, 'char:me:arms', { roughness: 2 });
    expect(ok.ok && byId(ok.elements, 'char:me:arms').roughness).toBe(2);
    expect(patchElement(els, 'speech:s1', { roughness: 2 })).toMatchObject({ ok: false });
  });

  it('preview renders seeded rough strokes once roughjs is loaded', async () => {
    const { loadRoughGenerator, roughPaths } = await import('../roughPaths');
    const gen = await loadRoughGenerator();
    const els = specToScene({ kind: 'comic', spec: XKCD }).elements;
    const arms = byId(els, 'char:me:arms');
    const first = roughPaths(gen, arms)!;
    expect(first.length).toBeGreaterThan(0);
    expect(roughPaths(gen, arms)).toEqual(first); // same seed, same strokes
    expect(roughPaths(gen, { ...arms, roughness: 0 })).toBeNull();
    expect(roughPaths(gen, byId(els, 'speech:s1'))).toBeNull();
    const svg = renderToStaticMarkup(React.createElement(DiagramSvg, { elements: els }));
    expect(svg).toContain('<g opacity="1"><path d="M');
    expect(svg).toContain('ARE YOU COMING');
  });
});
