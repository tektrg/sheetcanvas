// Keeps every diagram's stored SVG picture in step with its scene: agent
// writes, editor saves, undo/redo, and old diagrams that never had one.
// Exports are debounced per diagram so bursts of edits export once.
import { useEffect } from 'react';
import { useStore } from '../store';
import { previewIsStale, previewKey } from '../diagram/preview';
import { exportDiagramSvg } from '../components/diagramExport';
import type { DiagramData } from '../types';

export const PREVIEW_DEBOUNCE_MS = 500;

type Exporter = (elements: DiagramData['elements'], background?: string) => Promise<string>;

/** Store subscription that (re)exports stale previews; returns an unsubscribe. Exported for tests. */
export function watchDiagramPreviews(exporter: Exporter = exportDiagramSvg, delay = PREVIEW_DEBOUNCE_MS): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const inflight = new Map<string, string>(); // diagram id -> key being exported

  const run = async (id: string) => {
    timers.delete(id);
    const d = useStore.getState().diagrams[id];
    if (!d || !previewIsStale(d)) return;
    const background = d.appState?.viewBackgroundColor;
    const key = previewKey(d.elements, background);
    if (inflight.get(id) === key) return;
    inflight.set(id, key);
    try {
      const svg = await exporter(d.elements, background);
      const now = useStore.getState().diagrams[id];
      // Drop the result if the scene moved on meanwhile; that change scheduled its own export.
      if (now && previewKey(now.elements, now.appState?.viewBackgroundColor) === key) {
        useStore.getState().updateDiagram(id, { preview: { svg, key } });
      }
    } catch (error) {
      console.warn('[diagrams] preview export failed', id, error);
    } finally {
      if (inflight.get(id) === key) inflight.delete(id);
    }
  };

  const schedule = (diagrams: Record<string, DiagramData>) => {
    for (const d of Object.values(diagrams)) {
      if (!previewIsStale(d)) continue;
      clearTimeout(timers.get(d.id));
      // Missing pictures (new or old diagrams) export right away; edits wait for a pause.
      timers.set(d.id, setTimeout(() => void run(d.id), d.preview ? delay : 0));
    }
  };

  schedule(useStore.getState().diagrams);
  const unsubscribe = useStore.subscribe((state, prev) => {
    if (state.diagrams !== prev.diagrams) schedule(state.diagrams);
  });
  return () => {
    unsubscribe();
    timers.forEach(clearTimeout);
  };
}

export function useDiagramPreviews() {
  useEffect(() => watchDiagramPreviews(), []);
}
