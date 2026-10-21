// Compact, meaning-level view of a diagram for agents (readDiagram).
// Bound labels fold into their owner; geometry only on request.
import type { DiagramElement } from './types';
import { findLabelElement, semanticIdOf } from './patch';

export interface DiagramElementSummary {
  id: string;
  type: string;
  label?: string;
  color?: string;
  from?: string;
  to?: string;
  revealAt?: number;
  draw?: [number, number];
  geometry?: { x: number; y: number; width: number; height: number };
}

export function summarizeElements(elements: DiagramElement[], includeGeometry = false): DiagramElementSummary[] {
  const live = elements.filter((el) => !el.isDeleted);
  const semanticById = new Map<string, string>(live.map((el) => [el.id, semanticIdOf(el) ?? el.id]));
  const ownedLabel = (el: DiagramElement) => el.type === 'text' && !!el.containerId && semanticById.has(el.containerId);

  return live
    .filter((el) => !ownedLabel(el))
    .map((el) => {
      const label = findLabelElement(live, el)?.text;
      const isShape = el.type === 'rectangle' || el.type === 'ellipse' || el.type === 'diamond';
      const color = isShape ? el.backgroundColor : el.strokeColor;
      const summary: DiagramElementSummary = { id: semanticById.get(el.id) as string, type: el.type };
      if (label) summary.label = label;
      if (color && color !== 'transparent') summary.color = color;
      if (el.startBinding) summary.from = semanticById.get(el.startBinding.elementId);
      if (el.endBinding) summary.to = semanticById.get(el.endBinding.elementId);
      if (el.customData?.revealAt !== undefined) summary.revealAt = el.customData.revealAt;
      if (el.customData?.draw) summary.draw = el.customData.draw;
      if (includeGeometry) summary.geometry = { x: el.x, y: el.y, width: el.width, height: el.height };
      return summary;
    });
}
