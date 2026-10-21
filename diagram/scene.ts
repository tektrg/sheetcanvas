// Scene-level helpers shared by the agent tools and the editor.
import type { DiagramElement } from './types';

type Point = { x: number; y: number };

const absolutePoints = (el: DiagramElement): Point[] =>
  (el.points ?? [[0, 0]]).map(([px, py]) => ({ x: el.x + px, y: el.y + py }));

export function sceneBounds(elements: DiagramElement[]) {
  const live = elements.filter((el) => !el.isDeleted);
  if (live.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of live) {
    const pts = el.points ? absolutePoints(el) : [{ x: el.x, y: el.y }, { x: el.x + el.width, y: el.y + el.height }];
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

const CARD_PADDING = 40;
const CARD_MIN = { width: 320, height: 220 };
const CARD_MAX = { width: 1200, height: 900 };

/** Canvas card size that fits the scene (clamped). */
export function cardSizeFor(elements: DiagramElement[]) {
  const bounds = sceneBounds(elements);
  return {
    width: Math.round(Math.min(CARD_MAX.width, Math.max(CARD_MIN.width, bounds.width + CARD_PADDING * 2))),
    height: Math.round(Math.min(CARD_MAX.height, Math.max(CARD_MIN.height, bounds.height + CARD_PADDING * 2))),
  };
}

/** True when both scenes have the same elements at the same versions. */
export function sameElements(a: DiagramElement[], b: DiagramElement[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((el, i) => el.id === b[i].id && el.version === b[i].version);
}
