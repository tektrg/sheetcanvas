// Excalidraw's built-in sloppiness (roughness: 1 Artist) is used instead of
// baking multi-point wobble into the geometry.
import type { DiagramElement } from './types';
import { applyStyle } from './style';

type P = [number, number];

/** Legacy helper: returns points directly without subdividing into extra wobble points. */
export function wobblePoints(points: P[], _key?: string): P[] {
  return points;
}

/** Applies Excalidraw's built-in sketchy style (roughness: 1 / Artist sloppiness). */
export function sketchify(elements: DiagramElement[]): DiagramElement[] {
  return applyStyle(elements, 'sketchy');
}
