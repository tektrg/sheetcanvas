import { Hono } from 'hono';
import { z } from 'zod';
import { toolDefs, TOOL_NAMES, type ToolName } from '../../../agent/tools';
import type { Env } from '../env';
import type { BridgeCallResult, BridgeStatus } from './bridge';
import { requireBearerToken } from '../auth';
import { ANALYSIS_PLAYBOOK, PUBLIC_ANALYSIS_PLAYBOOK } from '../agent/analysisPlaybook';
import { MCP_TOOL_ANNOTATIONS } from '../../../agent/toolAnnotations';
import {
  SHEETCANVAS_APP_RESOURCE_URI,
  SHEETCANVAS_APP_TOOL,
  SHEETCANVAS_APP_TOOL_NAME,
  SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
  SHEETCANVAS_PUBLIC_APP_TOOL,
  buildSheetCanvasAppResource,
  buildPublicSheetCanvasAppResource,
} from './pluginUi';

/**
 * Remote MCP endpoint (streamable HTTP, JSON responses) backed by a live
 * SheetCanvas browser tab via the CanvasBridge Durable Object.
 *
 * Routes:
 *   POST /api/mcp/token          – mint a canvas token (called by the SheetCanvas UI)
 *   GET  /api/mcp/bridge/:token  – WebSocket upgrade for the browser tab
 *   GET  /api/mcp/status/:token  – is a tab connected for this token?
 *   POST /mcp/:token             – the MCP endpoint external agents talk to
 *   POST /mcp                    – anonymous, session-isolated public plugin
 */

// Only 2025-06-18: older revisions permit JSON-RPC batching, which this
// endpoint intentionally does not implement.
const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18'];
const SERVER_INFO = { name: 'sheetcanvas', version: '1.0.0' };
const TOKEN_PATTERN = /^[a-f0-9]{48}$/;
const PUBLIC_SESSION_PATTERN = /^p_[a-f0-9]{64}$/;
const PUBLIC_SESSION_TTL_MS = 2 * 60 * 60 * 1_000;
const MCP_EVENT_TYPES = {
  tokenGenerated: 'token_generated',
  exposeEnabled: 'expose_enabled',
  firstConnected: 'first_connected',
  toolCall: 'tool_call',
} as const;

// Converted once at module load — toolDefs is the single source of truth.
function toMcpTool(name: ToolName) {
  return {
    name,
    description: toolDefs[name].description,
    inputSchema: z.toJSONSchema(toolDefs[name].inputSchema, {
      io: 'input',
      unrepresentable: 'any',
    }),
    annotations: MCP_TOOL_ANNOTATIONS[name],
  };
}

// Agent-native diagrams: never on the anonymous public plugin (kept out of the
// ChatGPT Plugins Directory review surface), and on private canvases only when
// the DIAGRAMS_ENABLED env flag is "true".
const PRIVATE_ONLY_TOOL_NAMES = new Set<ToolName>([
  'createDiagram',
  'updateDiagramElement',
  'readDiagram',
  'listDiagrams',
]);

const ALWAYS_PRIVATE_TOOL_NAMES = TOOL_NAMES.filter((name) => !PRIVATE_ONLY_TOOL_NAMES.has(name));
const MCP_TOOL_LIST = [SHEETCANVAS_APP_TOOL, ...ALWAYS_PRIVATE_TOOL_NAMES.map(toMcpTool)];
const MCP_TOOL_LIST_WITH_DIAGRAMS = [SHEETCANVAS_APP_TOOL, ...TOOL_NAMES.map(toMcpTool)];

const diagramsEnabled = (env: Env) => env.DIAGRAMS_ENABLED?.trim() === 'true';

function privateToolNames(env: Env): readonly ToolName[] {
  return diagramsEnabled(env) ? TOOL_NAMES : ALWAYS_PRIVATE_TOOL_NAMES;
}
const PUBLIC_CONNECTOR_TOOL_NAMES = new Set<ToolName>([
  'listConnections',
  'listConnectionProperties',
  'describeConnection',
  'createQuerySheet',
  'queryConnection',
  'createQuerySheetFromResult',
  'updateQuerySheet',
  'createGaTrendBySource',
]);
const PUBLIC_TOOL_NAMES = TOOL_NAMES.filter(
  (name) => !PUBLIC_CONNECTOR_TOOL_NAMES.has(name) && !PRIVATE_ONLY_TOOL_NAMES.has(name),
);
const PUBLIC_MCP_TOOL_LIST = [SHEETCANVAS_PUBLIC_APP_TOOL, ...PUBLIC_TOOL_NAMES.map(toMcpTool)];

interface McpConnection {
  bridgeKey: string;
  analyticsToken: string;
  mode: 'private' | 'public';
  publicSession?: string;
}

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

function mintPublicSession(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const value = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `p_${value}`;
}

// Hand-written stub surface: workers-types' generated RPC types blow up
// TypeScript's instantiation depth (TS2589) on these signatures.
interface CanvasBridgeStub {
  fetch(request: Request): Promise<Response>;
  callTool(name: string, input: Record<string, unknown>): Promise<BridgeCallResult>;
  getStatus(): Promise<BridgeStatus>;
  initializePublicSession(expiresAtMs: number): Promise<void>;
  isPublicSessionActive(nowMs: number): Promise<boolean>;
  terminatePublicSession(): Promise<void>;
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

async function handleToolsCall(env: Env, connection: McpConnection, request: JsonRpcRequest) {
  const id = request.id ?? null;
  const params = request.params ?? {};
  const toolName = params.name;
  if (toolName === SHEETCANVAS_APP_TOOL_NAME) {
    const args = params.arguments ?? {};
    if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).length > 0) {
      return rpcError(id, -32602, `${SHEETCANVAS_APP_TOOL_NAME} does not accept arguments`);
    }
    return rpcResult(id, {
      content: [{ type: 'text', text: 'SheetCanvas is ready in the interactive workspace.' }],
      structuredContent: { ready: true },
      ...(connection.mode === 'public'
        ? { _meta: { bridgeSession: connection.publicSession } }
        : {}),
    });
  }
  if (typeof toolName !== 'string' || !TOOL_NAMES.includes(toolName as ToolName)) {
    return rpcError(id, -32602, `Unknown tool: ${String(toolName)}`);
  }
  if (connection.mode === 'public' && !PUBLIC_TOOL_NAMES.includes(toolName as ToolName)) {
    return rpcError(id, -32602, `Tool is unavailable in anonymous sessions: ${toolName}`);
  }
  if (connection.mode === 'private' && !privateToolNames(env).includes(toolName as ToolName)) {
    return rpcError(id, -32602, `Unknown tool: ${toolName}`);
  }

  const args = params.arguments ?? {};
  const parsed = toolDefs[toolName as ToolName].inputSchema.safeParse(args);
  if (!parsed.success) {
    return rpcError(id, -32602, `Invalid arguments for ${toolName}: ${parsed.error.message}`);
  }

  const bridge = bridgeStubForToken(env, connection.bridgeKey);
  const callResult = await bridge.callTool(toolName, parsed.data as Record<string, unknown>);
  if (!callResult.ok) {
    return rpcResult(id, {
      content: [{ type: 'text', text: callResult.error ?? 'Tool call failed' }],
      isError: true,
    });
  }
  await recordMcpEvent(env, {
    token: connection.analyticsToken,
    eventType: MCP_EVENT_TYPES.toolCall,
    toolName,
    ok: true,
  });
  return rpcResult(id, {
    content: [{ type: 'text', text: JSON.stringify(callResult.result ?? { ok: true }) }],
  });
}

function handleInitialize(request: JsonRpcRequest, mode: McpConnection['mode']) {
  const requested = request.params?.protocolVersion;
  const protocolVersion =
    typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
      ? requested
      : SUPPORTED_PROTOCOL_VERSIONS[0];
  return rpcResult(request.id ?? null, {
    protocolVersion,
    capabilities: { tools: {}, resources: {} },
    serverInfo: SERVER_INFO,
    instructions:
      (mode === 'public'
        ? 'Open the SheetCanvas workspace before using canvas tools. This public plugin uses an anonymous, short-lived session and does not access a SheetCanvas account. '
        : 'Tools execute inside a live SheetCanvas browser tab. If a call fails with "Canvas not connected", ask the user to open their SheetCanvas tab and enable "Expose to agents" in the Copilot panel. ') +
      'If a write tool times out, verify with a read (e.g. getRange) before retrying — the write may already have been applied.\n\n' +
      (mode === 'public' ? PUBLIC_ANALYSIS_PLAYBOOK : ANALYSIS_PLAYBOOK),
  });
}

async function handleMcpRequest(env: Env, connection: McpConnection, request: JsonRpcRequest) {
  // JSON-RPC notifications (no id) must not get a response — the caller
  // returns 202. We don't execute them either: every method we support is
  // meaningless without a reply, and silently running tools/call would risk
  // unobserved writes.
  if (request.id === undefined || request.id === null) return null;

  switch (request.method) {
    case 'initialize':
      return handleInitialize(request, connection.mode);
    case 'ping':
      return rpcResult(request.id, {});
    case 'tools/list':
      return rpcResult(request.id, {
        tools:
          connection.mode === 'public'
            ? PUBLIC_MCP_TOOL_LIST
            : diagramsEnabled(env)
              ? MCP_TOOL_LIST_WITH_DIAGRAMS
              : MCP_TOOL_LIST,
      });
    case 'tools/call':
      return handleToolsCall(env, connection, request);
    case 'resources/list':
      return rpcResult(request.id, {
        resources: [
          {
            uri:
              connection.mode === 'public'
                ? SHEETCANVAS_PUBLIC_APP_RESOURCE_URI
                : SHEETCANVAS_APP_RESOURCE_URI,
            name: 'SheetCanvas workspace',
            title: 'SheetCanvas workspace',
            description: 'Interactive spreadsheet, chart, and analysis canvas.',
            mimeType: 'text/html;profile=mcp-app',
          },
        ],
      });
    case 'resources/read': {
      const uri = request.params?.uri;
      const expectedUri =
        connection.mode === 'public'
          ? SHEETCANVAS_PUBLIC_APP_RESOURCE_URI
          : SHEETCANVAS_APP_RESOURCE_URI;
      if (uri !== expectedUri) {
        return rpcError(request.id, -32002, `Resource not found: ${String(uri)}`);
      }
      return rpcResult(request.id, {
        contents: [
          connection.mode === 'public'
            ? buildPublicSheetCanvasAppResource()
            : buildSheetCanvasAppResource(connection.analyticsToken),
        ],
      });
    }
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

mcpApp.get('/api/mcp/public-bridge/:session', async (c) => {
  const session = c.req.param('session');
  if (!PUBLIC_SESSION_PATTERN.test(session)) {
    return c.json({ error: { code: 'bad_session', message: 'Invalid public session' } }, 400);
  }
  const bridge = bridgeStubForToken(c.env, `public:${session}`);
  if (!(await bridge.isPublicSessionActive(Date.now()))) {
    return c.json({ error: { code: 'expired_session', message: 'Public session expired' } }, 410);
  }
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: { code: 'upgrade_required', message: 'Expected WebSocket upgrade' } }, 426);
  }
  return bridge.fetch(c.req.raw);
});

mcpApp.post('/mcp', async (c) => {
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) {
    return c.json(rpcError(null, -32700, 'Request body is not valid JSON'), 400);
  }
  if (!body || Array.isArray(body) || typeof body.method !== 'string') {
    return c.json(rpcError(null, -32600, 'Expected a single JSON-RPC request object'), 400);
  }

  const request = body as JsonRpcRequest;
  let session = c.req.header('Mcp-Session-Id') ?? '';
  let bridge: CanvasBridgeStub;

  if (request.method === 'initialize') {
    if (!PUBLIC_SESSION_PATTERN.test(session)) session = '';
    if (PUBLIC_SESSION_PATTERN.test(session)) {
      bridge = bridgeStubForToken(c.env, `public:${session}`);
      if (!(await bridge.isPublicSessionActive(Date.now()))) session = '';
    }
    if (!session) {
      session = mintPublicSession();
      bridge = bridgeStubForToken(c.env, `public:${session}`);
      await bridge.initializePublicSession(Date.now() + PUBLIC_SESSION_TTL_MS);
    }
  } else {
    if (!PUBLIC_SESSION_PATTERN.test(session)) {
      return c.json(rpcError(request.id ?? null, -32600, 'Missing or invalid Mcp-Session-Id'), 400);
    }
    bridge = bridgeStubForToken(c.env, `public:${session}`);
    if (!(await bridge.isPublicSessionActive(Date.now()))) {
      return c.json(rpcError(request.id ?? null, -32001, 'MCP session expired'), 404);
    }
  }

  c.header('Mcp-Session-Id', session);
  c.header('Cache-Control', 'no-store');
  const response = await handleMcpRequest(
    c.env,
    {
      bridgeKey: `public:${session}`,
      analyticsToken: session,
      mode: 'public',
      publicSession: session,
    },
    request,
  );
  if (response === null) return c.body(null, 202);
  return c.json(response);
});

mcpApp.get('/mcp', (c) =>
  c.json(rpcError(null, -32600, 'This server does not offer an SSE stream'), 405));

mcpApp.delete('/mcp', async (c) => {
  const session = c.req.header('Mcp-Session-Id') ?? '';
  if (!PUBLIC_SESSION_PATTERN.test(session)) return c.body(null, 404);
  const bridge = bridgeStubForToken(c.env, `public:${session}`);
  if (!(await bridge.isPublicSessionActive(Date.now()))) return c.body(null, 404);
  await bridge.terminatePublicSession();
  return c.body(null, 204);
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

  const response = await handleMcpRequest(
    c.env,
    { bridgeKey: token, analyticsToken: token, mode: 'private' },
    body as JsonRpcRequest,
  );
  if (response === null) return c.body(null, 202);
  return c.json(response);
});

// MCP spec: server may reject GET (no server-initiated stream) and DELETE (no sessions).
mcpApp.get('/mcp/:token', (c) => c.json(rpcError(null, -32600, 'This server does not offer an SSE stream'), 405));
mcpApp.delete('/mcp/:token', (c) => c.body(null, 405));
