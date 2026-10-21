// Box helpers for comic auto-layout (overlap, clamping, segment crossing).
import type { Pt } from './draw';

export type Box = { x: number; y: number; width: number; height: number };

export const inflate = (b: Box, by: number): Box => ({ x: b.x - by, y: b.y - by, width: b.width + by * 2, height: b.height + by * 2 });

export const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

export const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

/** Liang-Barsky: does segment a->b pass through box? */
export function segmentHitsBox(a: Pt, b: Pt, box: Box): boolean {
  const d = { x: b.x - a.x, y: b.y - a.y };
  let t0 = 0;
  let t1 = 1;
  const edges: [number, number][] = [
    [-d.x, a.x - box.x],
    [d.x, box.x + box.width - a.x],
    [-d.y, a.y - box.y],
    [d.y, box.y + box.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) t0 = Math.max(t0, r);
    else t1 = Math.min(t1, r);
    if (t0 > t1) return false;
  }
  return true;
}

export const corners = (b: Box): Pt[] => [
  { x: b.x, y: b.y },
  { x: b.x + b.width, y: b.y },
  { x: b.x, y: b.y + b.height },
  { x: b.x + b.width, y: b.y + b.height },
];
