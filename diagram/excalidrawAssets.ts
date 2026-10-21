// Where Excalidraw fetches its self-hosted fonts, shared by the editor
// (components/DiagramEditor.tsx) and the SVG export (components/diagramExport.ts).
// Dev serves them straight from node_modules; the build copies them to
// /excalidraw-assets/ (see vite.config.ts).
export const EXCALIDRAW_ASSET_PATH = (import.meta as { env?: { DEV?: boolean } }).env?.DEV
  ? '/node_modules/@excalidraw/excalidraw/dist/prod/'
  : '/excalidraw-assets/';
