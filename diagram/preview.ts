// Stored picture of a diagram: Excalidraw's own SVG export, so the canvas card
// matches the editor pixel for pixel without loading Excalidraw to view it.
import type { DiagramElement } from './types';

export interface DiagramPreview {
  /** Self-contained SVG markup (fonts inlined) from Excalidraw's exportToSvg. */
  svg: string;
  /** previewKey() of the scene it was exported from; stale when it differs. */
  key: string;
}

/** Changes whenever anything visible changes: element ids/versions/deletion and the background. */
export function previewKey(elements: DiagramElement[], background?: string): string {
  const parts = elements.map((el) => `${el.id}:${el.version}${el.isDeleted ? 'x' : ''}`);
  return `${background ?? ''}|${parts.join(',')}`;
}

/** True when the stored picture is missing or no longer matches the scene. */
export const previewIsStale = (d: { elements: DiagramElement[]; appState?: { viewBackgroundColor?: string }; preview?: DiagramPreview }) =>
  d.preview?.key !== previewKey(d.elements, d.appState?.viewBackgroundColor);

/** <img> source for the SVG: rendered as an image, so its markup can never run script in the page. */
export const previewSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
