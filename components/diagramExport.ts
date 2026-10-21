// Runs Excalidraw's own exportToSvg. Excalidraw (~1 MB) is imported lazily,
// once, and only to produce pictures; the canvas card just shows the result.
import type { DiagramElement } from '../diagram/types';
import { EXCALIDRAW_ASSET_PATH } from '../diagram/excalidrawAssets';

const EXPORT_PADDING = 16;
const DEFAULT_BACKGROUND = '#ffffff';

export async function exportDiagramSvg(elements: DiagramElement[], background?: string): Promise<string> {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
  const { exportToSvg, restoreElements } = await import('@excalidraw/excalidraw');
  const live = elements.filter((el) => !el.isDeleted);
  const svg = await exportToSvg({
    // Same normalisation the editor applies when it opens a scene.
    elements: restoreElements(live as never, null) as never,
    appState: { viewBackgroundColor: background ?? DEFAULT_BACKGROUND, exportBackground: true, exportPadding: EXPORT_PADDING } as never,
    files: null,
  });
  return svg.outerHTML;
}
