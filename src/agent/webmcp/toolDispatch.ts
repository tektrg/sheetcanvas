// Single chokepoint every tool-calling door (in-app Copilot, remote MCP over
// the CanvasBridge WebSocket, WebMCP/ChatGPT, the eval harness) routes
// through to reach `executeClientTool`. Centralizing the call here — instead
// of each door importing `executeClientTool` directly — gives us one place
// to hang cross-cutting concerns (the activity-trail observer today) without
// touching every door's call site again later.
//
// `dispatchTool` returns the FULL, unshaped `ToolResult`. Output shaping for
// WebMCP's tighter character budget happens in `toolResultShaping.ts`, one
// layer up in `webmcpRegistry.ts` — never here, so the other doors (which
// want the full result) are unaffected.
import type { SelectionContext } from '../../../types';
import { executeClientTool, type SelectionResolver, type ToolResult } from '../clientToolExecutor';

export type ToolDoor = 'copilot' | 'chatgpt' | 'remote-mcp' | 'eval';

export interface ToolObserver {
  /** Called right before the tool runs. Returns an opaque id passed back to onFinish. */
  onStart(door: ToolDoor, tool: string, input: unknown): string;
  onFinish(entryId: string, result: ToolResult): void;
}

// Module-level slot rather than a direct import of an activity-trail module:
// another agent is building that module concurrently and will call
// setToolObserver itself once it exists. This file has zero knowledge of
// what (if anything) is listening.
let observer: ToolObserver | null = null;

export function setToolObserver(next: ToolObserver | null): void {
  observer = next;
}

export interface DispatchToolOptions {
  getSelection: () => SelectionContext;
  door: ToolDoor;
}

export async function dispatchTool(
  name: string,
  input: unknown,
  opts: DispatchToolOptions,
): Promise<ToolResult> {
  let entryId: string | null = null;
  if (observer) {
    try {
      entryId = observer.onStart(opts.door, name, input);
    } catch {
      // An observer bug must never block a tool call.
    }
  }

  const resolver: SelectionResolver = { getSelection: opts.getSelection };
  const result = await executeClientTool(name, input, resolver);

  if (observer && entryId !== null) {
    try {
      observer.onFinish(entryId, result);
    } catch {
      // Same guarantee on the way out.
    }
  }

  return result;
}
