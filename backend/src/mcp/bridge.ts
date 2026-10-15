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
const PUBLIC_SESSION_EXPIRES_AT_KEY = 'public-session-expires-at';
const PUBLIC_SESSION_SNAPSHOT_KEY = 'public-session-snapshot';
const PUBLIC_SESSION_MODE_KEY = 'public-session-mode';
const PUBLIC_CONNECT_TIMEOUT_MS = 15_000;
const PUBLIC_SNAPSHOT_MAX_BYTES = 1_048_576;

/** Close code telling an older tab it was replaced — the tab must NOT reconnect. */
export const WS_CLOSE_REPLACED = 4000;

interface BrowserToolReply {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
  snapshot?: unknown;
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
  private publicReadySockets = new WeakSet<WebSocket>();
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
    const isPublic = await this.isPublicSessionActive(Date.now());
    if (!isPublic && await this.ctx.storage.get(PUBLIC_SESSION_MODE_KEY)) {
      return new Response('Public session expired', { status: 410 });
    }

    // Only one live tab per token — drop any previous connection. The close
    // code tells the old tab not to reconnect (avoids a two-tab eviction war).
    for (const existing of this.ctx.getWebSockets()) {
      this.publicReadySockets.delete(existing);
      existing.serializeAttachment({ publicReady: false, replaced: true });
      this.failPendingForSocket(existing, 'SheetCanvas workspace was replaced. Verify canvas state before retrying a write.');
      existing.close(WS_CLOSE_REPLACED, 'Replaced by a newer SheetCanvas tab');
    }

    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    if (isPublic) {
      pair[1].serializeAttachment({ publicReady: false });
      const snapshot = await this.readPublicSnapshot();
      pair[1].send(JSON.stringify({ type: 'session_restore', snapshot: snapshot ?? null }));
    }
    // Answer client heartbeats without waking the Durable Object — lets the
    // tab detect a dead socket (e.g. after laptop sleep) and reconnect fast.
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    let reply: BrowserToolReply & { type?: string };
    try {
      reply = JSON.parse(message);
    } catch {
      return;
    }
    if (!reply || typeof reply !== 'object') return;
    const isPublic = await this.isPublicSessionActive(Date.now());
    // Expired public sockets and replaced tabs may never mutate the session.
    if (!this.ctx.getWebSockets().includes(ws) || ws.deserializeAttachment()?.replaced === true) return;
    if (!isPublic && await this.ctx.storage.get(PUBLIC_SESSION_MODE_KEY)) return;
    if (isPublic && reply.type === 'canvas_ready') {
      this.publicReadySockets.add(ws);
      ws.serializeAttachment({ publicReady: true });
      return;
    }
    if (isPublic && reply.type === 'session_snapshot') {
      try {
        await this.savePublicSnapshot(reply.snapshot);
      } catch (error) {
        ws.send(JSON.stringify({ type: 'session_error', error: String(error) }));
      }
      return;
    }
    if (typeof reply.id !== 'string') return;
    const pending = this.pendingReplies.get(reply.id);
    if (!pending || pending.socket !== ws) return;
    if (isPublic && reply.ok) {
      try {
        await this.savePublicSnapshot(reply.snapshot);
      } catch (error) {
        reply = { id: reply.id, ok: false, error: `The tool already ran in the canvas, but session recovery could not be saved. Do not retry this write. Verify the current canvas and export your data before closing the workspace. ${error instanceof Error ? error.message : 'Session save failed.'}` };
      }
    }
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
    const isPublic = await this.isPublicSessionActive(Date.now());
    if (!isPublic && await this.ctx.storage.get(PUBLIC_SESSION_MODE_KEY)) return { browserConnected: false };
    return { browserConnected: this.ctx.getWebSockets().some((socket) => !socket.deserializeAttachment()?.replaced && (!isPublic || this.isPublicSocketReady(socket))) };
  }

  /** Marks this object as a short-lived anonymous public-plugin session. */
  async initializePublicSession(expiresAtMs: number): Promise<void> {
    await this.ctx.storage.put(PUBLIC_SESSION_EXPIRES_AT_KEY, expiresAtMs);
    await this.ctx.storage.put(PUBLIC_SESSION_MODE_KEY, true);
    await this.ctx.storage.setAlarm(expiresAtMs);
  }

  async isPublicSessionActive(nowMs: number): Promise<boolean> {
    const expiresAtMs = await this.ctx.storage.get<number>(PUBLIC_SESSION_EXPIRES_AT_KEY);
    if (typeof expiresAtMs !== 'number') return false;
    if (expiresAtMs > nowMs) return true;
    await this.terminatePublicSession();
    return false;
  }

  async terminatePublicSession(): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      await transaction.delete(PUBLIC_SESSION_EXPIRES_AT_KEY);
      const count = await transaction.get<number>(PUBLIC_SESSION_SNAPSHOT_KEY) ?? 0;
      for (let index = 0; index < count; index++) await transaction.delete(`${PUBLIC_SESSION_SNAPSHOT_KEY}:${index}`);
      await transaction.delete(PUBLIC_SESSION_SNAPSHOT_KEY);
    });
    for (const socket of this.ctx.getWebSockets()) {
      this.publicReadySockets.delete(socket);
      this.failPendingForSocket(socket, 'SheetCanvas public session ended');
      socket.close(1000, 'SheetCanvas public session ended');
    }
  }

  async alarm(): Promise<void> {
    await this.isPublicSessionActive(Date.now());
  }

  private isPublicSocketReady(socket: WebSocket): boolean {
    if (socket.deserializeAttachment()?.replaced === true) return false;
    return this.publicReadySockets.has(socket) || socket.deserializeAttachment()?.publicReady === true;
  }

  private async readPublicSnapshot(): Promise<unknown> {
    return this.ctx.storage.transaction(async (transaction) => {
      const count = await transaction.get<number>(PUBLIC_SESSION_SNAPSHOT_KEY) ?? 0;
      if (!count) return null;
      let serialized = '';
      for (let index = 0; index < count; index++) {
        serialized += await transaction.get<string>(`${PUBLIC_SESSION_SNAPSHOT_KEY}:${index}`) ?? '';
      }
      return JSON.parse(serialized);
    });
  }

  private async savePublicSnapshot(snapshot: unknown): Promise<void> {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) throw new Error('Invalid session snapshot');
    const state = snapshot as Record<string, unknown>;
    const allowed = ['version', 'sheets', 'charts', 'notes', 'transform'];
    const sheetFields = ['id', 'position', 'size', 'title', 'cells', 'colWidths', 'pivotConfig', 'pivotWarnings',
      'refreshWarnings', 'sparklineConfig', 'formatRules', 'setupRequired', 'filters', 'sort', 'showFilterPanel'];
    if (state.version !== 1 || Object.keys(state).some((key) => !allowed.includes(key)) ||
      !Array.isArray(state.sheets) || !Array.isArray(state.charts) || !Array.isArray(state.notes) ||
      !state.transform || typeof state.transform !== 'object' ||
      state.sheets.some((sheet) => !sheet || typeof sheet !== 'object' ||
        Object.keys(sheet).some((key) => !sheetFields.includes(key)))) {
      throw new Error('Invalid public session snapshot');
    }
    const serialized = JSON.stringify(snapshot);
    if (new TextEncoder().encode(serialized).byteLength > PUBLIC_SNAPSHOT_MAX_BYTES) {
      throw new Error('Session recovery supports canvases up to 1 MB. Export your data before closing the workspace.');
    }
    // Small chunks also fit the per-value limits of non-SQLite DO storage.
    await this.ctx.storage.transaction(async (transaction) => {
      const expiresAt = await transaction.get<number>(PUBLIC_SESSION_EXPIRES_AT_KEY);
      if (!expiresAt || expiresAt <= Date.now()) throw new Error('Public session expired');
      const previousCount = await transaction.get<number>(PUBLIC_SESSION_SNAPSHOT_KEY) ?? 0;
      const chunkCount = Math.ceil(serialized.length / 16_000);
      for (let index = 0; index < chunkCount; index++) {
        await transaction.put(`${PUBLIC_SESSION_SNAPSHOT_KEY}:${index}`, serialized.slice(index * 16_000, (index + 1) * 16_000));
      }
      for (let index = chunkCount; index < previousCount; index++) await transaction.delete(`${PUBLIC_SESSION_SNAPSHOT_KEY}:${index}`);
      await transaction.put(PUBLIC_SESSION_SNAPSHOT_KEY, chunkCount);
    });
  }

  private async dispatchToBrowser(name: string, input: unknown): Promise<BridgeCallResult> {
    const isPublic = await this.isPublicSessionActive(Date.now());
    if (!isPublic && await this.ctx.storage.get(PUBLIC_SESSION_MODE_KEY)) {
      return { ok: false, error: 'SheetCanvas session expired. Open SheetCanvas in a new conversation to start again.' };
    }
    let browserSocket = this.ctx.getWebSockets()[0];
    if (isPublic) {
      const deadlineMs = Date.now() + PUBLIC_CONNECT_TIMEOUT_MS;
      while (Date.now() < deadlineMs) {
        if (!(await this.isPublicSessionActive(Date.now()))) {
          return { ok: false, error: 'SheetCanvas session expired. Open SheetCanvas in a new conversation to start again.' };
        }
        browserSocket = this.ctx.getWebSockets().find((socket) => this.isPublicSocketReady(socket))!;
        if (browserSocket) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!browserSocket) {
        return { ok: false, error: 'SheetCanvas is still opening or reconnecting. Open SheetCanvas in this conversation, keep its workspace visible, then retry. No canvas changes were made.' };
      }
    }
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
