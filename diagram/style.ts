// Diagram-wide drawing style: uses Excalidraw's built-in sloppiness (roughness).
// 0: Architect (clean, straight lines)
// 1: Artist (sketchy, natural hand-drawn sloppiness)
// 2: Cartoonist (rough, loose double strokes)
import type { DiagramElement, DiagramKind } from './types';
import { hashSeed } from './elementFactory';

export type DiagramStyle = 'clean' | 'sketchy' | 'rough';
export type Roughness = 0 | 1 | 2;

export const STYLE_ROUGHNESS: Record<DiagramStyle, Roughness> = { clean: 0, sketchy: 1, rough: 2 };

/** Comics default to sketchy (Artist sloppiness, roughness 1); other kinds keep their converter's look. */
export const defaultStyle = (kind: DiagramKind): DiagramStyle | undefined => (kind === 'comic' ? 'sketchy' : undefined);

/**
 * Maps style directly to Excalidraw's built-in sloppiness (roughness):
 * - clean: 0 (Architect)
 * - sketchy: 1 (Artist)
 * - rough: 2 (Cartoonist, with stroke width varied ±15% per element)
 */
export function applyStyle(elements: DiagramElement[], style: DiagramStyle | undefined): DiagramElement[] {
  if (!style) return elements;
  const roughness = STYLE_ROUGHNESS[style];
  return elements.map((el) => {
    if (el.type === 'text') return el;
    const variance = style === 'rough' ? 0.85 + (hashSeed(`${el.id}#width`) % 31) / 100 : 1;
    return { ...el, roughness, strokeWidth: Math.round(el.strokeWidth * variance * 100) / 100 };
  });
}
