// Tiny geometry helpers shared by comic figures, props and speech.
import type { SceneShape } from '../freeform';
import { hashSeed } from '../elementFactory';

export type Pt = { x: number; y: number };
export type Offset = [number, number];

/**
 * Maps offsets drawn for a right-facing item standing on (0,0) to panel
 * coordinates: scaled, mirrored when facing left, placed at `origin`.
 */
export function placer(origin: Pt, scale = 1, facing: 'left' | 'right' = 'right') {
  const flip = facing === 'left' ? -1 : 1;
  return ([dx, dy]: Offset): Pt => ({ x: origin.x + dx * scale * flip, y: origin.y + dy * scale });
}

export function polyline(id: string, pts: Pt[], extra: Partial<SceneShape> = {}): SceneShape {
  const [first] = pts;
  return { id, type: 'line', x: first.x, y: first.y, points: pts.map((p) => [p.x - first.x, p.y - first.y]), ...extra };
}

export function circle(id: string, center: Pt, r: number, extra: Partial<SceneShape> = {}): SceneShape {
  return { id, type: 'ellipse', x: center.x - r, y: center.y - r, width: r * 2, height: r * 2, ...extra };
}

export function box(id: string, a: Pt, b: Pt, extra: Partial<SceneShape> = {}): SceneShape {
  return { id, type: 'rect', x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y), ...extra };
}

const WOBBLE = 0.035;
const MAX_WOBBLE = 2.5;

/**
 * Hand-made wobble: splits each segment in thirds and nudges the inner points
 * sideways a little (deterministic per `key`), so even clean strokes look drawn.
 */
export function wobble(pts: Pt[], key: string): Pt[] {
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = len ? { x: -(b.y - a.y) / len, y: (b.x - a.x) / len } : { x: 0, y: 0 };
    for (const t of [1 / 3, 2 / 3]) {
      const amp = Math.min(MAX_WOBBLE, len * WOBBLE) * (((hashSeed(`${key}:${i}:${t}`) % 200) / 100) - 1);
      out.push({ x: a.x + (b.x - a.x) * t + n.x * amp, y: a.y + (b.y - a.y) * t + n.y * amp });
    }
    out.push(b);
  }
  return out;
}
