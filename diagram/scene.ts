// Scene-level helpers shared by the agent tools and the editor.
import type { DiagramElement } from './types';
import { sceneBounds } from './renderSvg';

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
