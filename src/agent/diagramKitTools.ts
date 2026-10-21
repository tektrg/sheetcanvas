// Thin adapter: runs @tektrg/diagram-kit's agentTools (validateDiagram,
// listDiagramTypes) for the canvas tool executor. Schemas/descriptions for the
// Copilot + MCP live in agent/tools.ts (the backend compiles that file and must
// not depend on the private package). Always on: read-only, no canvas state.
import type { ToolResult } from './clientToolExecutor';

export const DIAGRAM_KIT_TOOL_NAMES = ['validateDiagram', 'listDiagramTypes'] as const;
export type DiagramKitToolName = (typeof DIAGRAM_KIT_TOOL_NAMES)[number];

export async function runDiagramKitTool(name: DiagramKitToolName, input: unknown): Promise<ToolResult> {
  // Lazy: keeps the pele renderer out of the main chunk.
  const { agentTools } = await import('@tektrg/diagram-kit');
  const spec = agentTools.find((t) => t.name === name);
  if (!spec) return { ok: false, error: `diagram-kit has no tool ${name}` };
  const result = spec.handler(input ?? {}) as Record<string, unknown>;
  return { ok: true, ...result };
}
