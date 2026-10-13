// Agent edits by semantic id. Only the named fields change; the user's
// position, size, stroke and font edits are always preserved.
import type { DiagramElement, DiagramElementPatch } from './types';
import { addBoundElement, createText, measureText, wrapLabel } from './elementFactory';
import { resolveColor, resolveStrokeColor } from './colors';

export type PatchResult =
  | { ok: true; elements: DiagramElement[] }
  | { ok: false; error: string };

const isLinear = (el: DiagramElement) => el.type === 'arrow' || el.type === 'line';
const isShape = (el: DiagramElement) => el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond';

export const semanticIdOf = (el: DiagramElement) => el.customData?.id;

export function findBySemanticId(elements: DiagramElement[], id: string) {
  return elements.find((el) => !el.isDeleted && semanticIdOf(el) === id);
}

/** Text shown for an element: its own text, or the text bound inside it. */
export function findLabelElement(elements: DiagramElement[], el: DiagramElement) {
  if (el.type === 'text') return el;
  return elements.find((t) => !t.isDeleted && t.type === 'text' && t.containerId === el.id);
}

function bump(el: DiagramElement): DiagramElement {
  return { ...el, version: (el.version ?? 0) + 1, versionNonce: (el.versionNonce ?? 0) + 1, updated: Date.now() };
}

const LABEL_PADDING = { x: 28, y: 20 };

/** New text, re-centred on its old centre (bound text) or kept top-left (free text). */
function withLabel(text: DiagramElement, rawLabel: string): DiagramElement {
  const label = wrapLabel(rawLabel);
  const size = measureText(label, text.fontSize);
  const centered = !!text.containerId;
  const center = { x: text.x + text.width / 2, y: text.y + text.height / 2 };
  return {
    ...text,
    text: label,
    originalText: label,
    x: centered ? center.x - size.width / 2 : text.x,
    y: centered ? center.y - size.height / 2 : text.y,
    width: size.width,
    height: size.height,
  };
}

/** Grow a shape (about its centre) so `text` fits with padding; never shrinks user sizing. */
function fitContainer(shape: DiagramElement, text: DiagramElement): DiagramElement {
  const width = Math.max(shape.width, text.width + LABEL_PADDING.x * 2);
  const height = Math.max(shape.height, text.height + LABEL_PADDING.y * 2);
  if (width === shape.width && height === shape.height) return shape;
  return { ...shape, x: shape.x - (width - shape.width) / 2, y: shape.y - (height - shape.height) / 2, width, height };
}

/** Ids removed together with `target`: its bound text, attached arrows, and their labels. */
function collectRemoval(elements: DiagramElement[], target: DiagramElement): Set<string> {
  const ids = new Set<string>([target.id]);
  for (const el of elements) {
    if (el.startBinding?.elementId === target.id || el.endBinding?.elementId === target.id) ids.add(el.id);
  }
  for (const el of elements) {
    if (el.containerId && ids.has(el.containerId)) ids.add(el.id);
  }
  return ids;
}

function removeElements(elements: DiagramElement[], ids: Set<string>): DiagramElement[] {
  return elements
    .filter((el) => !ids.has(el.id))
    .map((el) => {
      const bound = el.boundElements?.filter((b) => !ids.has(b.id)) ?? null;
      const startGone = el.startBinding && ids.has(el.startBinding.elementId);
      const endGone = el.endBinding && ids.has(el.endBinding.elementId);
      if (bound?.length === el.boundElements?.length && !startGone && !endGone) return el;
      return bump({
        ...el,
        boundElements: bound && bound.length > 0 ? bound : null,
        ...(startGone ? { startBinding: null } : {}),
        ...(endGone ? { endBinding: null } : {}),
      });
    });
}

/** Creates a label bound to an arrow at its middle point. */
function addArrowLabel(elements: DiagramElement[], arrow: DiagramElement, label: string): DiagramElement[] {
  const points = arrow.points ?? [[0, 0]];
  const a = points[Math.floor((points.length - 1) / 2)];
  const b = points[Math.ceil((points.length - 1) / 2)];
  const mid = { x: arrow.x + (a[0] + b[0]) / 2, y: arrow.y + (a[1] + b[1]) / 2 };
  const text = createText(`${semanticIdOf(arrow) ?? arrow.id}:label`, label, mid, arrow.id);
  const updatedArrow = bump({ ...arrow });
  addBoundElement(updatedArrow, text);
  return [...elements.map((el) => (el.id === arrow.id ? updatedArrow : el)), text];
}

export function patchElement(elements: DiagramElement[], semanticId: string, patch: DiagramElementPatch): PatchResult {
  const target = findBySemanticId(elements, semanticId);
  if (!target) return { ok: false, error: `Unknown element id: ${semanticId}` };

  if (patch.remove) return { ok: true, elements: removeElements(elements, collectRemoval(elements, target)) };

  if (patch.draw && !isLinear(target)) {
    return { ok: false, error: `draw only applies to lines/arrows, not ${target.type}` };
  }
  const labelElement = patch.label !== undefined ? findLabelElement(elements, target) : undefined;
  if (patch.label !== undefined && !labelElement) {
    if (target.type !== 'arrow') return { ok: false, error: `Element ${semanticId} has no label to change` };
    return { ok: true, elements: addArrowLabel(elements, target, patch.label) };
  }

  const updates = new Map<string, DiagramElement>();
  let next: DiagramElement = { ...target };
  if (patch.color !== undefined) {
    next = isShape(next)
      ? { ...next, backgroundColor: resolveColor(patch.color) }
      : { ...next, strokeColor: resolveStrokeColor(patch.color) };
  }
  if (patch.revealAt !== undefined || patch.draw !== undefined) {
    next = {
      ...next,
      customData: {
        ...(next.customData ?? { id: semanticId }),
        ...(patch.revealAt !== undefined ? { revealAt: patch.revealAt } : {}),
        ...(patch.draw !== undefined ? { draw: patch.draw } : {}),
      },
    };
  }
  if (labelElement && labelElement.id === target.id) next = withLabel(next, patch.label as string);
  updates.set(target.id, bump(next));
  if (labelElement && labelElement.id !== target.id) {
    const text = withLabel(labelElement, patch.label as string);
    updates.set(labelElement.id, bump(text));
    if (isShape(target)) updates.set(target.id, bump(fitContainer(next, text)));
  }

  return { ok: true, elements: elements.map((el) => updates.get(el.id) ?? el) };
}
