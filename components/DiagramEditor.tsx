import React, { Suspense, useRef } from 'react';
import { X } from 'lucide-react';
import { useStore } from '../store';
import { ensureSemanticIds } from '../diagram/ensureIds';
import type { DiagramSceneApi } from './DiagramExcalidraw';

// Excalidraw fetches its fonts from EXCALIDRAW_ASSET_PATH (falling back to a
// CDN). Dev serves them straight from node_modules; the build copies them to
// /excalidraw-assets/ (see vite.config.ts).
const EXCALIDRAW_ASSET_PATH = (import.meta as any).env?.DEV
  ? '/node_modules/@excalidraw/excalidraw/dist/prod/'
  : '/excalidraw-assets/';

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

  const save = () => {
    const api = sceneApi.current;
    if (api) {
      const store = useStore.getState();
      store.saveSnapshot();
      store.updateDiagram(id, {
        elements: ensureSemanticIds(api.getElements()),
        appState: { viewBackgroundColor: api.getBackground() },
      });
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
            />
          </Suspense>
        </div>
      </div>
    </div>
  );
};
