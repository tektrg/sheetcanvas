// Builders for Excalidraw-compatible elements. Deterministic (seed derived
// from the element id) so the same spec always yields the same scene.
import type { DiagramElement } from './types';

export const DEFAULT_STROKE = '#1e1e1e';
const FONT_SIZE = 16;
const LINE_HEIGHT = 1.25;
const FONT_FAMILY_EXCALIFONT = 5;
// Hand-drawn fonts (Excalifont/Virgil, also used by the SVG preview) run wide.
const AVG_CHAR_WIDTH = 0.65;

export function hashSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 2147483647 || 1;
}

const WRAP_AT = 30;

/** Wraps each line at word boundaries to ~WRAP_AT chars (long words stay whole). */
export function wrapLabel(text: string, width = WRAP_AT): string {
  return text
    .split('\n')
    .map((line) => {
      const out: string[] = [];
      let current = '';
      for (const word of line.split(/\s+/).filter(Boolean)) {
        if (current && current.length + 1 + word.length > width) {
          out.push(current);
          current = word;
        } else {
          current = current ? `${current} ${word}` : word;
        }
      }
      out.push(current);
      return out.join('\n');
    })
    .join('\n');
}

export function measureText(text: string, fontSize = FONT_SIZE) {
  const lines = text.split('\n');
  const longest = Math.max(1, ...lines.map((line) => line.length));
  return {
    width: Math.ceil(longest * fontSize * AVG_CHAR_WIDTH),
    height: Math.ceil(lines.length * fontSize * LINE_HEIGHT),
  };
}

function baseElement(id: string, type: string, box: { x: number; y: number; width: number; height: number }): DiagramElement {
  const seed = hashSeed(id);
  return {
    id,
    type,
    ...box,
    angle: 0,
    strokeColor: DEFAULT_STROKE,
    backgroundColor: 'transparent',
    fillStyle: 'solid',
    strokeWidth: 2,
    strokeStyle: 'solid',
    roughness: 1,
    opacity: 100,
    roundness: null,
    seed,
    version: 1,
    versionNonce: hashSeed(`${id}#nonce`),
    isDeleted: false,
    groupIds: [],
    frameId: null,
    boundElements: null,
    updated: 1,
    link: null,
    locked: false,
    customData: { id },
  };
}

export function createShape(
  id: string,
  type: 'rectangle' | 'ellipse' | 'diamond',
  box: { x: number; y: number; width: number; height: number },
  backgroundColor = 'transparent',
): DiagramElement {
  return {
    ...baseElement(id, type, box),
    backgroundColor,
    roundness: type === 'rectangle' ? { type: 3 } : { type: 2 },
  };
}

export interface TextOptions {
  fontSize?: number;
  /** Free text only: at.x is the left edge, centre or right edge. */
  textAlign?: 'left' | 'center' | 'right';
  wrapAt?: number;
}

/** Free text (containerId null) or text bound inside a shape/arrow (centred on `at`). */
export function createText(
  id: string,
  text: string,
  at: { x: number; y: number },
  containerId: string | null = null,
  options: TextOptions = {},
): DiagramElement {
  const fontSize = options.fontSize ?? FONT_SIZE;
  text = wrapLabel(text, options.wrapAt);
  const size = measureText(text, fontSize);
  const centered = containerId !== null;
  const align = centered ? 'center' : options.textAlign ?? 'left';
  const shiftX = align === 'center' ? size.width / 2 : align === 'right' ? size.width : 0;
  return {
    ...baseElement(id, 'text', {
      x: at.x - shiftX,
      y: centered ? at.y - size.height / 2 : at.y,
      ...size,
    }),
    text,
    originalText: text,
    fontSize,
    fontFamily: FONT_FAMILY_EXCALIFONT,
    textAlign: align,
    verticalAlign: centered ? 'middle' : 'top',
    containerId,
    lineHeight: LINE_HEIGHT,
    autoResize: true,
  };
}

export function createLinear(
  id: string,
  type: 'arrow' | 'line',
  absolutePoints: { x: number; y: number }[],
  options: { curved?: boolean; fromId?: string; toId?: string } = {},
): DiagramElement {
  const origin = absolutePoints[0];
  const points = absolutePoints.map((p) => [p.x - origin.x, p.y - origin.y] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const binding = (elementId?: string) => (elementId ? { elementId, focus: 0, gap: 4 } : null);
  return {
    ...baseElement(id, type, {
      x: origin.x,
      y: origin.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    }),
    roundness: options.curved ? { type: 2 } : null,
    points,
    startBinding: binding(options.fromId),
    endBinding: binding(options.toId),
    startArrowhead: null,
    endArrowhead: type === 'arrow' ? 'arrow' : null,
    elbowed: false,
  };
}

/** Hand-drawn stroke through absolute points (Excalidraw freedraw). */
export function createFreedraw(id: string, absolutePoints: { x: number; y: number }[]): DiagramElement {
  const origin = absolutePoints[0];
  const points = absolutePoints.map((p) => [p.x - origin.x, p.y - origin.y] as [number, number]);
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    ...baseElement(id, 'freedraw', {
      x: origin.x,
      y: origin.y,
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    }),
    points,
    pressures: [],
    simulatePressure: true,
    lastCommittedPoint: null,
  };
}

/** Bind `child` (text or arrow) to `parent` in both directions. */
export function addBoundElement(parent: DiagramElement, child: DiagramElement): void {
  const kind = child.type === 'text' ? 'text' : 'arrow';
  parent.boundElements = [...(parent.boundElements ?? []), { id: child.id, type: kind }];
}

export function centerOf(el: { x: number; y: number; width: number; height: number }) {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}
