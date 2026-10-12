// Agent edits by semantic id. Only the named fields change; the user's
// position, size, stroke and font edits are always preserved.
import type { DiagramElement, DiagramElementPatch } from './types';
import { measureText } from './elementFactory';
import { resolveColor } from './colors';

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

function withLabel(text: DiagramElement, label: string): DiagramElement {
  const size = measureText(label, text.fontSize);
  const centerX = text.x + text.width / 2;
  const centered = !!text.containerId;
  return {
    ...text,
    text: label,
    originalText: label,
    // Re-centre bound text on its old centre; free text keeps its top-left.
    x: centered ? centerX - size.width / 2 : text.x,
    width: size.width,
    height: size.height,
  };
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

export function patchElement(elements: DiagramElement[], semanticId: string, patch: DiagramElementPatch): PatchResult {
  const target = findBySemanticId(elements, semanticId);
  if (!target) return { ok: false, error: `Unknown element id: ${semanticId}` };

  if (patch.remove) return { ok: true, elements: removeElements(elements, collectRemoval(elements, target)) };

  if (patch.draw && !isLinear(target)) {
    return { ok: false, error: `draw only applies to lines/arrows, not ${target.type}` };
  }
  const labelElement = patch.label !== undefined ? findLabelElement(elements, target) : undefined;
  if (patch.label !== undefined && !labelElement) {
    return { ok: false, error: `Element ${semanticId} has no label to change` };
  }

  const updates = new Map<string, DiagramElement>();
  let next: DiagramElement = { ...target };
  if (patch.color !== undefined) {
    const color = resolveColor(patch.color);
    next = isShape(next) ? { ...next, backgroundColor: color } : { ...next, strokeColor: color };
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
    updates.set(labelElement.id, bump(withLabel(labelElement, patch.label as string)));
  }

  return { ok: true, elements: elements.map((el) => updates.get(el.id) ?? el) };
}
