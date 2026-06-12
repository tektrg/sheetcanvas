import { DurableObject } from 'cloudflare:workers';

/**
 * CanvasBridge relays MCP tool calls to a live SheetCanvas browser tab.
 *
 * One Durable Object instance per canvas token. The browser tab holds a single
 * WebSocket to this object; MCP `tools/call` requests arrive via the
 * `callTool` RPC method and are forwarded over that socket. The tab executes
 * the tool against its in-browser canvas state and replies with the result.
 */

const TOOL_CALL_TIMEOUT_MS = 30_000;

/** Close code telling an older tab it was replaced — the tab must NOT reconnect. */
export const WS_CLOSE_REPLACED = 4000;

interface BrowserToolReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

// `result` carries whatever JSON the browser tool executor returned. Typed as
// `any` (not `unknown`) so the Durable Object RPC stub keeps a usable
// signature — workers-types collapses methods returning non-Serializable
// types like `unknown` to `never`.
export interface BridgeCallResult {
  ok: boolean;
  result?: any;
  error?: string;
}

export interface BridgeStatus {
  browserConnected: boolean;
}

export class CanvasBridge extends DurableObject {
  private pendingReplies = new Map<
    string,
    { resolve: (reply: BrowserToolReply) => void; timer: ReturnType<typeof setTimeout>; socket: WebSocket }
  >();
  // Serializes tool calls so concurrent MCP clients cannot interleave writes.
  private callQueue: Promise<unknown> = Promise.resolve();

  /** Browser tab connects here with a WebSocket upgrade request. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Only one live tab per token — drop any previous connection. The close
    // code tells the old tab not to reconnect (avoids a two-tab eviction war).
    for (const existing of this.ctx.getWebSockets()) {
      existing.close(WS_CLOSE_REPLACED, 'Replaced by a newer SheetCanvas tab');
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    // Answer client heartbeats without waking the Durable Object — lets the
    // tab detect a dead socket (e.g. after laptop sleep) and reconnect fast.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;
    let reply: BrowserToolReply;
    try {
      reply = JSON.parse(message);
    } catch {
      return;
    }
    if (!reply || typeof reply.id !== 'string') return;
    const pending = this.pendingReplies.get(reply.id);
    if (!pending) return;
    this.pendingReplies.delete(reply.id);
    clearTimeout(pending.timer);
    pending.resolve(reply);
  }

  webSocketClose(ws: WebSocket): void {
    this.failPendingForSocket(ws, 'SheetCanvas tab disconnected during the tool call');
  }

  webSocketError(ws: WebSocket): void {
    this.failPendingForSocket(ws, 'SheetCanvas tab connection errored during the tool call');
  }

  /** RPC from the Worker route handling MCP tools/call. */
  async callTool(name: string, input: unknown): Promise<BridgeCallResult> {
    const queued = this.callQueue.then(() => this.dispatchToBrowser(name, input));
    // Keep the queue alive even when a call fails.
    this.callQueue = queued.catch(() => undefined);
    return queued;
  }

  /** RPC from the Worker route for status checks. */
  async getStatus(): Promise<BridgeStatus> {
    return { browserConnected: this.ctx.getWebSockets().length > 0 };
  }

  private async dispatchToBrowser(name: string, input: unknown): Promise<BridgeCallResult> {
    const browserSocket = this.ctx.getWebSockets()[0];
    if (!browserSocket) {
      return {
        ok: false,
        error:
          'Canvas not connected. Open your SheetCanvas tab and enable "Expose to agents" in the Copilot panel, then retry.',
      };
    }

    const callId = crypto.randomUUID();
    const replyPromise = new Promise<BrowserToolReply>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(callId);
        resolve({ id: callId, ok: false, error: `Tool call timed out after ${TOOL_CALL_TIMEOUT_MS}ms` });
      }, TOOL_CALL_TIMEOUT_MS);
      this.pendingReplies.set(callId, { resolve, timer, socket: browserSocket });
    });

    try {
      browserSocket.send(JSON.stringify({ id: callId, name, input }));
    } catch (err) {
      const pending = this.pendingReplies.get(callId);
      if (pending) {
        this.pendingReplies.delete(callId);
        clearTimeout(pending.timer);
      }
      return { ok: false, error: `Failed to reach the SheetCanvas tab: ${err instanceof Error ? err.message : String(err)}` };
    }

    const reply = await replyPromise;
    return { ok: reply.ok, result: reply.result, error: reply.error };
  }

  /** Fail only the calls dispatched on the closing socket — a replacement tab
   *  may already have healthy in-flight calls of its own. */
  private failPendingForSocket(closedSocket: WebSocket, error: string): void {
    for (const [id, pending] of this.pendingReplies) {
      if (pending.socket !== closedSocket) continue;
      this.pendingReplies.delete(id);
      clearTimeout(pending.timer);
      pending.resolve({ id, ok: false, error });
    }
  }
}
