// The ONLY module that imports Excalidraw. Loaded via React.lazy from
// DiagramEditor so the ~1 MB editor stays out of the main bundle.
import React from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import type { DiagramElement } from '../diagram/types';

export interface DiagramSceneApi {
  getElements: () => DiagramElement[];
  getBackground: () => string | undefined;
}

interface DiagramExcalidrawProps {
  elements: DiagramElement[];
  background?: string;
  darkMode?: boolean;
  onReady: (api: DiagramSceneApi) => void;
  /** Fires on every scene edit (Excalidraw onChange). */
  onChange?: () => void;
}

const DiagramExcalidraw: React.FC<DiagramExcalidrawProps> = ({ elements, background, darkMode, onReady, onChange }) => (
  <Excalidraw
    initialData={{
      elements: elements as never,
      appState: background ? { viewBackgroundColor: background } : {},
      scrollToContent: true,
    }}
    theme={darkMode ? 'dark' : 'light'}
    onChange={onChange}
    excalidrawAPI={(api) =>
      onReady({
        // Plain JSON copies: Excalidraw elements are frozen/readonly.
        getElements: () => JSON.parse(JSON.stringify(api.getSceneElementsIncludingDeleted())) as DiagramElement[],
        getBackground: () => api.getAppState().viewBackgroundColor,
      })
    }
  />
);

export default DiagramExcalidraw;
