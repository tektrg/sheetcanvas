// Diagram-wide drawing style: how hand-drawn the strokes look.
import type { DiagramElement, DiagramKind } from './types';
import { hashSeed } from './elementFactory';
import { sketchify } from './sketch';

export type DiagramStyle = 'clean' | 'sketchy' | 'rough';
export type Roughness = 0 | 1 | 2;

export const STYLE_ROUGHNESS: Record<Exclude<DiagramStyle, 'sketchy'>, Roughness> = { clean: 0, rough: 2 };

/** Comics default to the xkcd single wobbly line; other kinds keep their converter's look. */
export const defaultStyle = (kind: DiagramKind): DiagramStyle | undefined => (kind === 'comic' ? 'sketchy' : undefined);

/**
 * clean: roughness 0. sketchy: one wobbly stroke baked into the geometry (see
 * sketch.ts). rough: Excalidraw's double stroke (roughness 2) with stroke width
 * varied ±15% per element, like a pen.
 */
export function applyStyle(elements: DiagramElement[], style: DiagramStyle | undefined): DiagramElement[] {
  if (!style) return elements;
  if (style === 'sketchy') return sketchify(elements);
  const roughness = STYLE_ROUGHNESS[style];
  return elements.map((el) => {
    if (el.type === 'text') return el;
    const variance = style === 'rough' ? 0.85 + (hashSeed(`${el.id}#width`) % 31) / 100 : 1;
    return { ...el, roughness, strokeWidth: Math.round(el.strokeWidth * variance * 100) / 100 };
  });
}
