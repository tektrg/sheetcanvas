// Typed feature-detection shim for the WebMCP `document.modelContext` API.
//
// The API lives on `document.modelContext`, NOT `navigator.modelContext` — it
// moved in the spec on 2026-05-27. There is no shipped TS lib type for it yet,
// so we declare the shape ourselves (same idiom as the `window.__sheetCanvasAgentEval`
// augmentation in AgentEvalBridge.tsx) and feature-detect at call time rather
// than assuming any particular browser has it.

export interface WebMcpAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export interface WebMcpToolDescriptor {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  execute: (input: unknown, ctx: { signal: AbortSignal }) => Promise<unknown>;
  annotations?: WebMcpAnnotations;
}

export interface RegisteredToolHandle {
  name: string;
  title?: string;
  description: string;
  inputSchema?: Record<string, unknown>;
  window: unknown;
  origin: string;
  annotations?: WebMcpAnnotations;
}

export interface ModelContextApi extends EventTarget {
  registerTool(
    tool: WebMcpToolDescriptor,
    options?: { exposedTo?: string[]; signal?: AbortSignal }
  ): Promise<undefined>;
  getTools(options?: { fromOrigins?: string[] }): Promise<RegisteredToolHandle[]>;
  executeTool(
    tool: string | RegisteredToolHandle,
    input?: unknown,
    options?: { signal?: AbortSignal }
  ): Promise<string>;
}

declare global {
  interface Document {
    modelContext?: ModelContextApi;
  }
}

/**
 * Returns `document.modelContext` when the current environment actually
 * implements it, or `null` otherwise (no DOM, older browser, no in-page agent).
 * Callers should treat `null` as "WebMCP is unavailable" and skip registration
 * rather than throwing.
 */
export function getModelContext(): ModelContextApi | null {
  if (typeof document === 'undefined') return null;
  const modelContext = document.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
  return modelContext;
}
