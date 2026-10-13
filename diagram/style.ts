// Diagram-wide drawing style: how hand-drawn the strokes look.
import type { DiagramElement, DiagramKind } from './types';
import { hashSeed } from './elementFactory';

export type DiagramStyle = 'clean' | 'sketchy' | 'rough';
export type Roughness = 0 | 1 | 2;

export const STYLE_ROUGHNESS: Record<DiagramStyle, Roughness> = { clean: 0, sketchy: 1, rough: 2 };

/** Comics read hand-drawn by default; other kinds keep their converter's look. */
export const defaultStyle = (kind: DiagramKind): DiagramStyle | undefined => (kind === 'comic' ? 'rough' : undefined);

/** 'rough' also varies stroke width slightly (±15%, stable per element) like a pen. */
export function applyStyle(elements: DiagramElement[], style: DiagramStyle | undefined): DiagramElement[] {
  if (!style) return elements;
  const roughness = STYLE_ROUGHNESS[style];
  return elements.map((el) => {
    if (el.type === 'text') return el;
    const variance = style === 'rough' ? 0.85 + (hashSeed(`${el.id}#width`) % 31) / 100 : 1;
    return { ...el, roughness, strokeWidth: Math.round(el.strokeWidth * variance * 100) / 100 };
  });
}
