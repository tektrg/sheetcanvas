import { Hono } from 'hono';
import { z } from 'zod';
import { toolDefs, TOOL_NAMES, type ToolName } from '../../../agent/tools';
import type { Env } from '../env';
import type { BridgeCallResult, BridgeStatus } from './bridge';
import { requireBearerToken } from '../auth';
import { ANALYSIS_PLAYBOOK } from '../agent/analysisPlaybook';

/**
 * Remote MCP endpoint (streamable HTTP, JSON responses) backed by a live
 * SheetCanvas browser tab via the CanvasBridge Durable Object.
 *
 * Routes:
 *   POST /api/mcp/token          – mint a canvas token (called by the SheetCanvas UI)
 *   GET  /api/mcp/bridge/:token  – WebSocket upgrade for the browser tab
 *   GET  /api/mcp/status/:token  – is a tab connected for this token?
 *   POST /mcp/:token             – the MCP endpoint external agents talk to
 */

// Only 2025-06-18: older revisions permit JSON-RPC batching, which this
// endpoint intentionally does not implement.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18'];
const SERVER_INFO = { name: 'sheetcanvas', version: '1.0.0' };
const TOKEN_PATTERN = /^[a-f0-9]{48}$/;
const MCP_EVENT_TYPES = {
  tokenGenerated: 'token_generated',
  exposeEnabled: 'expose_enabled',
  firstConnected: 'first_connected',
  toolCall: 'tool_call',
} as const;

// Converted once at module load — toolDefs is the single source of truth.
const MCP_TOOL_LIST = TOOL_NAMES.map((name) => ({
  name,
  description: toolDefs[name].description,
  inputSchema: z.toJSONSchema(toolDefs[name].inputSchema, {
    io: 'input',
    unrepresentable: 'any',
  }),
}));

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: '2.0' as const, id, error: { code, message } };
}

function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

// Hand-written stub surface: workers-types' generated RPC types blow up
// TypeScript's instantiation depth (TS2589) on these signatures.
interface CanvasBridgeStub {
  fetch(request: Request): Promise<Response>;
  callTool(name: string, input: Record<string, unknown>): Promise<BridgeCallResult>;
  getStatus(): Promise<BridgeStatus>;
}

function bridgeStubForToken(env: Env, token: string): CanvasBridgeStub {
  return env.CANVAS_BRIDGE.get(env.CANVAS_BRIDGE.idFromName(token)) as unknown as CanvasBridgeStub;
}

function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}

async function hashToken(token: string): Promise<string> {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function recordMcpEvent(
  env: Env,
  event: {
    token: string;
    eventType: string;
    toolName?: string | null;
    ok?: boolean;
    errorCode?: string | null;
  },
) {
  try {
    const tokenHash = await hashToken(event.token);
    await env.DB.prepare(
      'INSERT INTO mcp_events (id, token_hash, event_type, tool_name, ok, error_code, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(
        crypto.randomUUID(),
        tokenHash,
        event.eventType,
        event.toolName ?? null,
        event.ok === false ? 0 : 1,
        event.errorCode ?? null,
        Date.now(),
      )
      .run();
  } catch (err) {
    console.warn('[sheetcanvas-mcp] analytics event write failed', {
      eventType: event.eventType,
      toolName: event.toolName,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function recordFirstConnectionIfNeeded(env: Env, token: string) {
  try {
    const tokenHash = await hashToken(token);
    const row = await env.DB.prepare(
      'SELECT id FROM mcp_events WHERE token_hash = ? AND event_type = ? LIMIT 1',
    )
      .bind(tokenHash, MCP_EVENT_TYPES.firstConnected)
      .first<{ id: string }>();
    if (row) return;
    await env.DB.prepare(
      'INSERT INTO mcp_events (id, token_hash, event_type, tool_name, ok, error_code, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
      .bind(crypto.randomUUID(), tokenHash, MCP_EVENT_TYPES.firstConnected, null, 1, null, Date.now())
      .run();
  } catch (err) {
    console.warn('[sheetcanvas-mcp] first connection analytics write failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleToolsCall(env: Env, token: string, request: JsonRpcRequest) {
  const id = request.id ?? null;
  const params = request.params ?? {};
  const toolName = params.name;
  if (typeof toolName !== 'string' || !TOOL_NAMES.includes(toolName as ToolName)) {
    return rpcError(id, -32602, `Unknown tool: ${String(toolName)}`);
  }

  const args = params.arguments ?? {};
  const parsed = toolDefs[toolName as ToolName].inputSchema.safeParse(args);
  if (!parsed.success) {
    return rpcError(id, -32602, `Invalid arguments for ${toolName}: ${parsed.error.message}`);
  }

  const bridge = bridgeStubForToken(env, token);
  const callResult = await bridge.callTool(toolName, parsed.data as Record<string, unknown>);
  if (!callResult.ok) {
    return rpcResult(id, {
      content: [{ type: 'text', text: callResult.error ?? 'Tool call failed' }],
      isError: true,
    });
  }
  await recordMcpEvent(env, {
    token,
    eventType: MCP_EVENT_TYPES.toolCall,
    toolName,
    ok: true,
  });
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(callResult.result ?? { ok: true }) }],
  });
}

function handleInitialize(request: JsonRpcRequest) {
  const requested = request.params?.protocolVersion;
  const protocolVersion =
    typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[0];
  return rpcResult(request.id ?? null, {
    protocolVersion,
    capabilities: { tools: {} },
    serverInfo: SERVER_INFO,
    instructions:
      'Tools execute inside a live SheetCanvas browser tab. If a call fails with "Canvas not connected", ask the user to open their SheetCanvas tab and enable "Expose to agents" in the Copilot panel. If a write tool times out, verify with a read (e.g. getRange) before retrying — the write may already have been applied.\n\n' +
      ANALYSIS_PLAYBOOK,
  });
}

async function handleMcpRequest(env: Env, token: string, request: JsonRpcRequest) {
  // JSON-RPC notifications (no id) must not get a response — the caller
  // returns 202. We don't execute them either: every method we support is
  // meaningless without a reply, and silently running tools/call would risk
  // unobserved writes.
  if (request.id === undefined || request.id === null) return null;

  switch (request.method) {
    case 'initialize':
      return handleInitialize(request);
    case 'ping':
      return rpcResult(request.id, {});
    case 'tools/list':
      return rpcResult(request.id, { tools: MCP_TOOL_LIST });
    case 'tools/call':
      return handleToolsCall(env, token, request);
    default:
      return rpcError(request.id, -32601, `Method not found: ${request.method}`);
  }
}

export const mcpApp = new Hono<{ Bindings: Env }>();

mcpApp.post('/api/mcp/token', async (c) => {
  requireBearerToken(c.req.raw, c.env);
  const origin = new URL(c.req.url).origin;
  const wsOrigin = origin.replace(/^http/, 'ws');

  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const clientId = typeof body.clientId === 'string' && body.clientId.length > 0 ? body.clientId : null;
  const force = body.force === true;

  // Look up an existing token for this clientId (unless the user is forcing regeneration).
  if (clientId && !force) {
    const row = await c.env.DB.prepare('SELECT token FROM mcp_tokens WHERE client_id = ?')
      .bind(clientId)
      .first<{ token: string }>();
    if (row) {
      return c.json({
        token: row.token,
        mcpUrl: `${origin}/mcp/${row.token}`,
        bridgeWsUrl: `${wsOrigin}/api/mcp/bridge/${row.token}`,
      });
    }
  }

  // Mint a new token and persist it.
  const token = mintToken();
  if (clientId) {
    await c.env.DB.prepare(
      'INSERT OR REPLACE INTO mcp_tokens (client_id, token, created_at_ms) VALUES (?, ?, ?)',
    )
      .bind(clientId, token, Date.now())
      .run();
  }
  await recordMcpEvent(c.env, {
    token,
    eventType: MCP_EVENT_TYPES.tokenGenerated,
    ok: true,
  });

  return c.json({
    token,
    mcpUrl: `${origin}/mcp/${token}`,
    bridgeWsUrl: `${wsOrigin}/api/mcp/bridge/${token}`,
  });
});

mcpApp.get('/api/mcp/bridge/:token', async (c) => {
  const token = c.req.param('token');
  if (!isValidToken(token)) return c.json({ error: { code: 'bad_token', message: 'Invalid token' } }, 400);
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: { code: 'upgrade_required', message: 'Expected WebSocket upgrade' } }, 426);
  }
  await recordMcpEvent(c.env, {
    token,
    eventType: MCP_EVENT_TYPES.exposeEnabled,
    ok: true,
  });
  await recordFirstConnectionIfNeeded(c.env, token);
  return bridgeStubForToken(c.env, token).fetch(c.req.raw);
});

mcpApp.get('/api/mcp/status/:token', async (c) => {
  const token = c.req.param('token');
  if (!isValidToken(token)) return c.json({ error: { code: 'bad_token', message: 'Invalid token' } }, 400);
  const status = await bridgeStubForToken(c.env, token).getStatus();
  return c.json(status);
});

mcpApp.post('/mcp/:token', async (c) => {
  const token = c.req.param('token');
  if (!isValidToken(token)) {
    return c.json(rpcError(null, -32600, 'Invalid canvas token in URL'), 404);
  }

  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) {
    return c.json(rpcError(null, -32700, 'Request body is not valid JSON'), 400);
  }
  if (!body || Array.isArray(body) || typeof body.method !== 'string') {
    return c.json(rpcError(null, -32600, 'Expected a single JSON-RPC request object'), 400);
  }

  const response = await handleMcpRequest(c.env, token, body as JsonRpcRequest);
  if (response === null) return c.body(null, 202);
  return c.json(response);
});

// MCP spec: server may reject GET (no server-initiated stream) and DELETE (no sessions).
mcpApp.get('/mcp/:token', (c) => c.json(rpcError(null, -32600, 'This server does not offer an SSE stream'), 405));
mcpApp.delete('/mcp/:token', (c) => c.body(null, 405));
