import type { ToolName } from './tools';

export interface SharedToolAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  openWorldHint: boolean;
}

/**
 * Safety and trust hints shared by browser WebMCP and the remote MCP server.
 * The remote server adds MCP-only hints such as destructiveHint separately.
 */
export const TOOL_ANNOTATIONS: Record<ToolName, SharedToolAnnotations> = {
  listSheets: { readOnlyHint: true, untrustedContentHint: true },
  describeSheet: { readOnlyHint: true, untrustedContentHint: true },
  getSelection: { readOnlyHint: true, untrustedContentHint: true },
  getRange: { readOnlyHint: true, untrustedContentHint: true },
  querySheet: { readOnlyHint: true, untrustedContentHint: true },
  setCells: {},
  createSheet: {},
  applyFilter: {},
  applySort: {},
  applyFormat: {},
  createChart: {},
  createPivot: {},
  createSparkline: {},
  createNote: {},
  listNotes: { readOnlyHint: true, untrustedContentHint: true },
  readNote: { readOnlyHint: true, untrustedContentHint: true },
  updateNote: {},
  deleteNote: {},
  listConnections: { readOnlyHint: true, untrustedContentHint: true },
  listConnectionProperties: { readOnlyHint: true, untrustedContentHint: true },
  describeConnection: { untrustedContentHint: true },
  createQuerySheet: { untrustedContentHint: true },
  queryConnection: { untrustedContentHint: true },
  createQuerySheetFromResult: { untrustedContentHint: true },
  updateQuerySheet: { untrustedContentHint: true },
  createGaTrendBySource: { untrustedContentHint: true },
  createDiagram: {},
  updateDiagramElement: {},
  readDiagram: { readOnlyHint: true, untrustedContentHint: true },
  listDiagrams: { readOnlyHint: true, untrustedContentHint: true },
};

/**
 * Complete MCP safety hints. Keep these separate from WebMCP because the
 * browser surface currently accepts only readOnlyHint/untrustedContentHint.
 */
export const MCP_TOOL_ANNOTATIONS: Record<ToolName, McpToolAnnotations> = {
  listSheets: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  describeSheet: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  getSelection: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  getRange: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  querySheet: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  setCells: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  createSheet: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  applyFilter: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  applySort: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  applyFormat: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  createChart: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  createPivot: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  createSparkline: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  createNote: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  listNotes: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  readNote: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  updateNote: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  deleteNote: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  listConnections: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  listConnectionProperties: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  describeConnection: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  createQuerySheet: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  queryConnection: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  createQuerySheetFromResult: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  updateQuerySheet: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  createGaTrendBySource: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  createDiagram: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  updateDiagramElement: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  readDiagram: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  listDiagrams: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
};
