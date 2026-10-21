import React, { Suspense, useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { ensureSemanticIds } from '../diagram/ensureIds';
import { cardSizeFor, sameElements } from '../diagram/scene';
import type { DiagramSceneApi } from './DiagramExcalidraw';
import { EXCALIDRAW_ASSET_PATH } from '../diagram/excalidrawAssets';
import { previewKey, type DiagramPreview } from '../diagram/preview';
import { exportDiagramSvg } from './diagramExport';
import { PREVIEW_DEBOUNCE_MS } from '../hooks/useDiagramPreviews';

const DEFAULT_BACKGROUND = '#ffffff'; // Excalidraw's default canvas color

const DiagramExcalidraw = React.lazy(() => {
  (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH;
  return import('./DiagramExcalidraw');
});

interface DiagramEditorProps {
  id: string;
  darkMode?: boolean;
}

// Full-screen modal editor. While open, agent writes to this diagram are
// refused (store.editingDiagramId), so saving never overwrites them.
export const DiagramEditor: React.FC<DiagramEditorProps> = ({ id, darkMode }) => {
  const diagram = useStore(state => state.diagrams[id]);
  const setEditingDiagramId = useStore(state => state.setEditingDiagramId);
  const sceneApi = useRef<DiagramSceneApi | null>(null);
  const close = () => setEditingDiagramId(null);
  // Picture of the scene as edited, exported ~500ms after edits pause, so the
  // card is already up to date when Save lands.
  const draftPreview = useRef<DiagramPreview | null>(null);
  const exportTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(exportTimer.current), []);

  const exportDraft = async () => {
    const api = sceneApi.current;
    if (!api) return;
    const elements = ensureSemanticIds(api.getElements());
    const background = api.getBackground();
    const key = previewKey(elements, background);
    if (draftPreview.current?.key === key) return;
    try {
      draftPreview.current = { svg: await exportDiagramSvg(elements, background), key };
    } catch (error) {
      console.warn('[diagrams] editor preview export failed', error);
    }
  };
  const onSceneChange = () => {
    clearTimeout(exportTimer.current);
    exportTimer.current = setTimeout(() => void exportDraft(), PREVIEW_DEBOUNCE_MS);
  };

  const save = () => {
    const api = sceneApi.current;
    const current = useStore.getState().diagrams[id];
    if (api && current) {
      const elements = ensureSemanticIds(api.getElements());
      const background = api.getBackground();
      const changed = !sameElements(elements, current.elements) || (background ?? DEFAULT_BACKGROUND) !== (current.appState?.viewBackgroundColor ?? DEFAULT_BACKGROUND);
      if (changed) {
        const store = useStore.getState();
        store.saveSnapshot();
        store.updateDiagram(id, {
          elements,
          size: cardSizeFor(elements),
          appState: { viewBackgroundColor: background },
          // Fresh draft export if it matches what is saved; otherwise the preview watcher re-exports.
          ...(draftPreview.current?.key === previewKey(elements, background) ? { preview: draftPreview.current } : {}),
        });
      }
    }
    close();
  };

  if (!diagram) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-6"
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col w-full h-full max-w-6xl rounded-xl overflow-hidden shadow-2xl bg-white dark:bg-neutral-900">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 text-sm">
          <span className="flex-1 font-medium text-neutral-700 dark:text-neutral-200 truncate">{diagram.title ?? 'Diagram'}</span>
          <button className="px-3 py-1 rounded-md text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={close}>
            Cancel
          </button>
          <button className="px-3 py-1 rounded-md bg-teal-600 text-white hover:bg-teal-700" onClick={save} data-testid="diagram-editor-save">
            Save
          </button>
          <button className="p-1 rounded-md text-neutral-400 hover:text-neutral-600" title="Close without saving" onClick={close}>
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <Suspense fallback={<div className="p-6 text-sm text-neutral-500">Loading editor…</div>}>
            <DiagramExcalidraw
              elements={diagram.elements}
              background={diagram.appState?.viewBackgroundColor}
              darkMode={darkMode}
              onReady={(api) => { sceneApi.current = api; }}
              onChange={onSceneChange}
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
};
