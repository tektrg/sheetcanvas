// Browser-side gate for agent diagram tools (the server has DIAGRAMS_ENABLED).
// On in dev; in production builds only with VITE_DIAGRAMS_ENABLED=true.
export function diagramsEnabled(env: { DEV?: boolean; VITE_DIAGRAMS_ENABLED?: string } = (import.meta as any).env ?? {}): boolean {
  return env.DEV === true || env.VITE_DIAGRAMS_ENABLED === 'true';
}

export const DIAGRAM_TOOL_NAMES = ['createDiagram', 'updateDiagramElement', 'addToDiagram', 'readDiagram', 'listDiagrams'] as const;
