// Freeform kind: explicit drawing primitives -> Excalidraw elements. Each
// shape's id becomes its semantic id. The comic kind compiles down to this.
import type { DiagramElement, FreeformShape, FreeformSpec } from './types';
import { createFreedraw, createLinear, createShape, createText } from './elementFactory';
import { resolveColor, resolveStrokeColor } from './colors';

/** A freeform shape plus an optional Excalidraw group (e.g. one stick figure). */
export type SceneShape = FreeformShape & { group?: string; wrapAt?: number };

const DEFAULT_CANVAS = { width: 800, height: 600 };
const DEFAULT_BOX = { width: 100, height: 60 };
const SHAPE_TYPE = { rect: 'rectangle', ellipse: 'ellipse', diamond: 'diamond' } as const;

const absolute = (shape: SceneShape) => (shape.points ?? []).map(([px, py]) => ({ x: shape.x + px, y: shape.y + py }));

function baseFor(shape: SceneShape): DiagramElement {
  switch (shape.type) {
    case 'rect':
    case 'ellipse':
    case 'diamond': {
      const el = createShape(
        shape.id,
        SHAPE_TYPE[shape.type],
        { x: shape.x, y: shape.y, width: shape.width ?? DEFAULT_BOX.width, height: shape.height ?? DEFAULT_BOX.height },
        shape.fill ? resolveColor(shape.fill) : 'transparent',
      );
      if (shape.type === 'rect' && !shape.roundness) el.roundness = null;
      return el;
    }
    case 'line':
    case 'arrow':
      return createLinear(shape.id, shape.type, absolute(shape), { curved: shape.roundness });
    case 'freedraw':
      return createFreedraw(shape.id, absolute(shape));
    case 'text':
      return createText(shape.id, shape.text ?? '', { x: shape.x, y: shape.y }, null, {
        fontSize: shape.fontSize,
        textAlign: shape.textAlign,
        wrapAt: shape.wrapAt,
      });
  }
}

function validate(shapes: SceneShape[]): void {
  const seen = new Set<string>();
  for (const shape of shapes) {
    if (seen.has(shape.id)) throw new Error(`Duplicate shape id "${shape.id}"`);
    seen.add(shape.id);
    const needsPoints = shape.type === 'line' || shape.type === 'arrow' || shape.type === 'freedraw';
    if (needsPoints && (shape.points?.length ?? 0) < 2) throw new Error(`Shape "${shape.id}" (${shape.type}) needs points with at least 2 [x,y] pairs`);
    if (shape.type === 'text' && !shape.text?.trim()) throw new Error(`Shape "${shape.id}" (text) needs text`);
  }
}

export function shapesToElements(shapes: SceneShape[]): DiagramElement[] {
  validate(shapes);
  return shapes.map((shape) => {
    const el = baseFor(shape);
    if (shape.color) el.strokeColor = resolveStrokeColor(shape.color);
    if (shape.strokeWidth !== undefined) el.strokeWidth = shape.strokeWidth;
    if (shape.strokeStyle) el.strokeStyle = shape.strokeStyle;
    if (shape.roughness !== undefined) el.roughness = shape.roughness;
    if (shape.group) el.groupIds = [shape.group];
    return el;
  });
}

export function freeformToElements(spec: FreeformSpec, warnings: string[]): DiagramElement[] {
  const elements = shapesToElements(spec.shapes);
  const canvas = { width: spec.width ?? DEFAULT_CANVAS.width, height: spec.height ?? DEFAULT_CANVAS.height };
  const outside = elements.filter((el) => el.x < 0 || el.y < 0 || el.x + el.width > canvas.width || el.y + el.height > canvas.height);
  if (outside.length > 0) {
    warnings.push(`Shapes extend past the ${canvas.width}x${canvas.height} canvas: ${outside.map((el) => el.customData?.id).join(', ')}`);
  }
  return elements;
}
