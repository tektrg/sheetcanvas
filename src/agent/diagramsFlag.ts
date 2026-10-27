// Browser-side gate for agent diagram tools (the server has DIAGRAMS_ENABLED).
// On in dev; in production builds only with VITE_DIAGRAMS_ENABLED=true.
export function diagramsEnabled(env: { DEV?: boolean; VITE_DIAGRAMS_ENABLED?: string } = (import.meta as any).env ?? {}): boolean {
  if (env.DEV === true || env.VITE_DIAGRAMS_ENABLED === 'true') return true;
  if (typeof window !== 'undefined') {
    try {
      if (new URLSearchParams(window.location.search).get('diagrams') === '1') return true;
      if (window.localStorage?.getItem('diagrams_enabled') === 'true') return true;
    } catch {
      // Ignore URL/localStorage access errors
    }
  }
  return false;
}

export const DIAGRAM_TOOL_NAMES = ['createDiagram', 'updateDiagramElement', 'addToDiagram', 'readDiagram', 'listDiagrams'] as const;
