import type { ToolName } from './tools';

// Anonymous canvases never acquire account-backed connector capabilities.
// Shared by server MCP filtering and every browser tool door.
export const PUBLIC_CONNECTOR_TOOL_NAMES = new Set<ToolName>([
  'listConnections', 'listConnectionProperties', 'describeConnection',
  'createQuerySheet', 'queryConnection', 'createQuerySheetFromResult',
  'updateQuerySheet', 'createGaTrendBySource',
]);

export function isPublicCanvasTool(name: string): boolean {
  return !PUBLIC_CONNECTOR_TOOL_NAMES.has(name as ToolName);
}
