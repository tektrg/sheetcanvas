import { describe, expect, it } from 'vitest';
import { DIAGRAM_SPEC_SCHEMAS } from '../../../agent/tools';

const spec = {
  shapes: [
    { id: 'box', type: 'rect', x: 10, y: 10, width: 80, height: 40 },
    { id: 'wave', type: 'freedraw', x: 100, y: 100, points: [[0, 0], [10, 5]] },
  ],
};

const XKCD = {
  panels: [{
    id: 'p1',
    items: [
      { type: 'prop', id: 'desk', kind: 'desk', x: 250, y: 270 },
      { type: 'character', id: 'me', x: 170, y: 270, pose: 'type' },
      { type: 'character', id: 'off', x: 420, y: 40, offPanel: true },
      { type: 'speech', id: 's1', text: 'Are you coming to bed?', x: 270, y: 40, speaker: 'off' },
      { type: 'speech', id: 's2', text: 'Hi', x: 300, y: 80, speaker: { x: 10, y: 10 }, tail: 'bubble' },
      { type: 'shape', id: 'sun', shape: 'ellipse', x: 10, y: 10 },
    ],
  }],
};

describe('freeform/comic spec schemas', () => {
  it('schema is strict and caps shape count', () => {
    const schema = DIAGRAM_SPEC_SCHEMAS.freeform;
    expect(schema.safeParse(spec).success).toBe(true);
    expect(schema.safeParse({ shapes: [{ id: 'x', type: 'rect', x: 0, y: 0, bogus: 1 }] }).success).toBe(false);
    expect(schema.safeParse({ shapes: [{ id: 'bad id', type: 'rect', x: 0, y: 0 }] }).success).toBe(false);
    const many = Array.from({ length: 501 }, (_, i) => ({ id: `s${i}`, type: 'rect', x: 0, y: 0 }));
    expect(schema.safeParse({ shapes: many }).success).toBe(false);
  });
  it('schema accepts the xkcd example and rejects bad items with paths', () => {
    expect(DIAGRAM_SPEC_SCHEMAS.comic.safeParse(XKCD).success).toBe(true);
    const bad = DIAGRAM_SPEC_SCHEMAS.comic.safeParse({ panels: [{ id: 'p', items: [{ type: 'prop', id: 'x', kind: 'sofa', x: 0, y: 0 }] }] });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(['panels', 0, 'items', 0, 'kind']);
  });
});
