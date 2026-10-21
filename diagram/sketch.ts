// 'sketchy' style: one wobbly pen stroke per line, baked into the points.
// Excalidraw always double-strokes at roughness >= 1, so the wobble lives in
// the geometry (roughness 0) and the editor and the canvas preview draw the
// exact same single line.
import type { DiagramElement } from './types';
import { hashSeed } from './elementFactory';

type P = [number, number];

const STEP = 22;
const ELLIPSE_POINTS = 20;

/** Wobble grows with stroke length: tiny segments stay put, long lines drift ~1.5px. */
const amplitude = (length: number) => Math.min(1.5, Math.max(0.2, length * 0.012));

/** Signed noise in [-1, 1], stable per key. */
const noise = (key: string) => (hashSeed(key) % 2001) / 1000 - 1;

/** Subdivides each segment every ~STEP px and nudges inner points sideways; vertices stay exact. */
export function wobblePoints(points: P[], key: string): P[] {
  const out: P[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1];
    const [bx, by] = points[i];
    const length = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.round(length / STEP));
    const nx = length ? -(by - ay) / length : 0;
    const ny = length ? (bx - ax) / length : 0;
    const amp = amplitude(length);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      const off = amp * noise(`${key}:${i}:${s}`);
      out.push([ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off]);
    }
    out.push(points[i]);
  }
  return out;
}

function outline(el: DiagramElement): P[] {
  const { width: w, height: h } = el;
  if (el.type === 'rectangle') return [[0, 0], [w, 0], [w, h], [0, h], [0, 0]];
  if (el.type === 'diamond') return [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2], [w / 2, 0]];
  // Ellipse: radius drifts a little around the loop and closes exactly on its start (no overlap loop).
  const pts: P[] = [];
  for (let i = 0; i < ELLIPSE_POINTS; i++) {
    const a = (i / ELLIPSE_POINTS) * Math.PI * 2;
    const drift = 1 + 0.03 * Math.sin(a * 2 + (hashSeed(el.id) % 7));
    pts.push([w / 2 + (w / 2) * Math.cos(a) * drift, h / 2 + (h / 2) * Math.sin(a) * drift]);
  }
  return [...pts, pts[0]];
}

const isShape = (el: DiagramElement) => el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond';

/**
 * Shapes holding text or arrows stay real shapes (labels and bindings need
 * them) and are drawn clean; everything else becomes a single wobbly line.
 */
export function sketchify(elements: DiagramElement[]): DiagramElement[] {
  const anchored = new Set(elements.flatMap((el) => [el.startBinding?.elementId, el.endBinding?.elementId, el.containerId]).filter(Boolean));
  return elements.map((el) => {
    if (el.type === 'text' || el.type === 'freedraw') return el;
    if (isShape(el) && (anchored.has(el.id) || el.boundElements?.length)) return { ...el, roughness: 0 };
    const source = isShape(el) ? outline(el) : (el.points ?? []);
    if (source.length < 2) return { ...el, roughness: 0 };
    const isEllipse = el.type === 'ellipse';
    const points = isEllipse ? source : wobblePoints(source, el.id);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    // Shift so the first point is the element origin, as Excalidraw expects.
    const [ox, oy] = points[0];
    return {
      ...el,
      type: isShape(el) ? 'line' : el.type,
      x: el.x + ox,
      y: el.y + oy,
      points: points.map(([px, py]) => [px - ox, py - oy] as P),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
      roughness: 0,
      roundness: { type: 2 },
      ...(isShape(el) ? { startArrowhead: null, endArrowhead: null, startBinding: null, endBinding: null, elbowed: false, polygon: true } : {}),
    };
  });
}
