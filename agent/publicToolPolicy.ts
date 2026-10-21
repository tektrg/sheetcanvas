import type { ToolName } from './tools';

// Anonymous canvases never acquire account-backed connector capabilities.
// Shared by server MCP filtering and every browser tool door.
export const PUBLIC_CONNECTOR_TOOL_NAMES = new Set<ToolName>([
  'listConnections', 'listConnectionProperties', 'describeConnection',
  'createQuerySheet', 'queryConnection', 'createQuerySheetFromResult',
  'updateQuerySheet', 'createGaTrendBySource',
]);

// Agent diagrams stay on private canvases only (also kept off the public MCP list).
export const PUBLIC_EXCLUDED_DIAGRAM_TOOL_NAMES = new Set<string>([
  'createDiagram', 'updateDiagramElement', 'addToDiagram', 'readDiagram', 'listDiagrams',
]);

export function isPublicCanvasTool(name: string): boolean {
  return !PUBLIC_CONNECTOR_TOOL_NAMES.has(name as ToolName) && !PUBLIC_EXCLUDED_DIAGRAM_TOOL_NAMES.has(name);
}
