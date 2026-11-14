import { Hono } from 'hono';
import { z } from 'zod';
import { toolDefs, TOOL_NAMES, type ToolName } from '../../../agent/tools';
import type { Env } from '../env';
import type { BridgeCallResult, BridgeStatus } from './bridge';
import { mintPublicCapability, PUBLIC_CANVAS_HANDLE_PATTERN, PUBLIC_CANVAS_TTL_MS,
  publicCanvasInputSchema, type PublicCanvasPointer } from './publicCanvasHandle';
import { requireBearerToken } from '../auth';
import { ANALYSIS_PLAYBOOK, PUBLIC_ANALYSIS_PLAYBOOK } from '../agent/analysisPlaybook';
import { MCP_TOOL_ANNOTATIONS } from '../../../agent/toolAnnotations';
import { PUBLIC_CONNECTOR_TOOL_NAMES } from '../../../agent/publicToolPolicy';
import {
  SHEETCANVAS_APP_RESOURCE_URI,
  SHEETCANVAS_APP_TOOL,
  SHEETCANVAS_APP_TOOL_NAME,
  SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
  SHEETCANVAS_PUBLIC_APP_TOOL,
  buildSheetCanvasAppResource,
  buildPublicSheetCanvasAppResource,
  claudeUiDomain,
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
const SERVER_INFO = { name: 'sheetcanvas', version: '1.0.1' };
const TOKEN_PATTERN = /^[a-f0-9]{48}$/;
const PUBLIC_SESSION_PATTERN = /^p_[a-f0-9]{64}$/;
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
  'addToDiagram',
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
const PUBLIC_TOOL_NAMES = TOOL_NAMES.filter(
  (name) => !PUBLIC_CONNECTOR_TOOL_NAMES.has(name) && !PRIVATE_ONLY_TOOL_NAMES.has(name),
);
const PUBLIC_MCP_TOOL_LIST = [SHEETCANVAS_PUBLIC_APP_TOOL, ...PUBLIC_TOOL_NAMES.map((name) => {
  const tool = toMcpTool(name);
  return { ...tool, inputSchema: publicCanvasInputSchema(tool.inputSchema) };
})];

interface McpConnection {
  bridgeKey: string;
  analyticsToken: string;
  mode: 'private' | 'public';
  publicSession?: string;
  /** Set when the connector URL carries `?client=claude`; Claude's ui.domain is derived from it. */
  claudeServerUrl?: string;
}

function claudeServerUrlFor(requestUrl: string): string | undefined {
  return new URL(requestUrl).searchParams.get('client') === 'claude' ? requestUrl : undefined;
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

// Hand-written stub surface: workers-types' generated RPC types blow up
// TypeScript's instantiation depth (TS2589) on these signatures.
interface CanvasBridgeStub {
  fetch(request: Request): Promise<Response>;
  callTool(name: string, input: Record<string, unknown>): Promise<BridgeCallResult>;
  getStatus(): Promise<BridgeStatus>;
  initializePublicSession(expiresAtMs: number): Promise<void>;
  isPublicSessionActive(nowMs: number): Promise<boolean>;
  terminatePublicSession(): Promise<void>;
  registerPublicCanvasHandle(session: string, expiresAtMs: number): Promise<void>;
  resolvePublicCanvasHandle(nowMs: number): Promise<PublicCanvasPointer | null>;
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

// Diagnostics deliberately exclude request bodies, URLs and raw capabilities.
// Host identifiers are opaque hints only; never use these logs as authorization.
async function logPublicSessionDiagnostic(session: string, request?: JsonRpcRequest) {
  const method = request?.method ?? 'browser/connect';
  if (!['initialize', 'tools/call', 'browser/connect'].includes(method)) return;
  const metadata = request?.params?._meta;
  const hints = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown> : {};
  const readHint = (name: string) => {
    const value = hints[name];
    return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : null;
  };
  const hostSession = readHint('openai/session');
  const hostSubject = readHint('openai/subject');
  const requestedTool = request?.params?.name;
  const toolName = requestedTool === SHEETCANVAS_APP_TOOL_NAME ||
    (typeof requestedTool === 'string' && TOOL_NAMES.includes(requestedTool as ToolName))
    ? requestedTool : undefined;
  console.info('[sheetcanvas-public-session]', {
    method,
    ...(toolName ? { toolName } : {}),
    sessionFingerprint: (await hashToken(session)).slice(0, 16),
    hasHostSession: hostSession !== null,
    hasHostSubject: hostSubject !== null,
    ...(hostSession ? { hostSessionFingerprint: (await hashToken(`session:${hostSession}`)).slice(0, 16) } : {}),
    ...(hostSubject ? { hostSubjectFingerprint: (await hashToken(`subject:${hostSubject}`)).slice(0, 16) } : {}),
  });
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
  const suppliedArgs = params.arguments ?? {};
  let publicCanvas: (PublicCanvasPointer & { canvasHandle: string }) | undefined;
  if (connection.mode === 'public' && (toolName === SHEETCANVAS_APP_TOOL_NAME || PUBLIC_TOOL_NAMES.includes(toolName as ToolName))) {
    if (!suppliedArgs || typeof suppliedArgs !== 'object' || Array.isArray(suppliedArgs)) {
      return rpcError(id, -32602, 'Expected an arguments object');
    }
    if (toolName === SHEETCANVAS_APP_TOOL_NAME && Object.keys(suppliedArgs).some((key) => key !== 'canvasHandle')) {
      return rpcError(id, -32602, 'openSheetCanvas accepts only an optional canvasHandle');
    }
    const handle = (suppliedArgs as Record<string, unknown>).canvasHandle;
    if (toolName === SHEETCANVAS_APP_TOOL_NAME && handle === undefined) {
      const session = mintPublicCapability('p');
      const canvasHandle = mintPublicCapability('c');
      const expiresAtMs = Date.now() + PUBLIC_CANVAS_TTL_MS;
      await bridgeStubForToken(env, `public:${session}`).initializePublicSession(expiresAtMs);
      await bridgeStubForToken(env, `public-canvas:${canvasHandle}`).registerPublicCanvasHandle(session, expiresAtMs);
      publicCanvas = { session, canvasHandle, expiresAtMs };
    } else {
      if (typeof handle !== 'string' || !PUBLIC_CANVAS_HANDLE_PATTERN.test(handle)) {
        return rpcError(id, -32602, 'A valid canvasHandle returned by openSheetCanvas is required. No canvas changes were made.');
      }
      const pointer = await bridgeStubForToken(env, `public-canvas:${handle}`).resolvePublicCanvasHandle(Date.now());
      if (!pointer || !(await bridgeStubForToken(env, `public:${pointer.session}`).isPublicSessionActive(Date.now()))) {
        return rpcError(id, -32602, 'Canvas handle is unknown or expired. Open a new SheetCanvas workspace. No canvas changes were made.');
      }
      publicCanvas = { ...pointer, canvasHandle: handle };
    }
  }
  if (toolName === SHEETCANVAS_APP_TOOL_NAME) {
    const args = suppliedArgs;
    if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).some((key) => key !== 'canvasHandle' || connection.mode !== 'public')) {
      return rpcError(id, -32602, `${SHEETCANVAS_APP_TOOL_NAME} does not accept arguments`);
    }
    const ready = connection.mode === 'private' ||
      (await bridgeStubForToken(env, `public:${publicCanvas!.session}`).getStatus()).browserConnected;
    return rpcResult(id, {
      content: [{ type: 'text', text: ready ? 'SheetCanvas is ready in the interactive workspace.' :
        'SheetCanvas is opening in the interactive workspace. Canvas tools wait briefly for it to connect; keep the workspace visible.' }],
      structuredContent: { ready, ...(publicCanvas ? { canvasHandle: publicCanvas.canvasHandle,
        expiresInSeconds: Math.max(0, Math.floor((publicCanvas.expiresAtMs - Date.now()) / 1000)) } : {}) },
      ...(connection.mode === 'public'
        ? { _meta: { bridgeSession: publicCanvas!.session, canvasHandle: publicCanvas!.canvasHandle } }
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

  const args = connection.mode === 'public'
    ? Object.fromEntries(Object.entries(suppliedArgs as Record<string, unknown>).filter(([key]) => key !== 'canvasHandle'))
    : suppliedArgs;
  const parsed = toolDefs[toolName as ToolName].inputSchema.safeParse(args);
  if (!parsed.success) {
    return rpcError(id, -32602, `Invalid arguments for ${toolName}: ${parsed.error.message}`);
  }

  const bridge = bridgeStubForToken(env, publicCanvas ? `public:${publicCanvas.session}` : connection.bridgeKey);
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
        ? 'Call openSheetCanvas before canvas tools. Save its canvasHandle and pass that exact handle with every canvas tool call, including after transport reconnection. Reopen the same workspace by passing the handle to openSheetCanvas; omit it only to create a new canvas. Handles grant access only to an anonymous canvas and expire after two hours without extension. Never print or share handles with unrelated tools. This plugin does not access a SheetCanvas account. '
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
      const uiDomain = connection.claudeServerUrl
        ? await claudeUiDomain(connection.claudeServerUrl)
        : undefined;
      return rpcResult(request.id, {
        contents: [
          connection.mode === 'public'
            ? buildPublicSheetCanvasAppResource(uiDomain)
            : buildSheetCanvasAppResource(connection.analyticsToken, uiDomain),
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
  await logPublicSessionDiagnostic(session);
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
      session = mintPublicCapability('p');
      bridge = bridgeStubForToken(c.env, `public:${session}`);
      await bridge.initializePublicSession(Date.now() + PUBLIC_CANVAS_TTL_MS);
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
  await logPublicSessionDiagnostic(session, request);
  const response = await handleMcpRequest(
    c.env,
    {
      bridgeKey: `public:${session}`,
      analyticsToken: session,
      mode: 'public',
      publicSession: session,
      claudeServerUrl: claudeServerUrlFor(c.req.url),
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
    { bridgeKey: token, analyticsToken: token, mode: 'private', claudeServerUrl: claudeServerUrlFor(c.req.url) },
    body as JsonRpcRequest,
  );
  if (response === null) return c.body(null, 202);
  return c.json(response);
});

// MCP spec: server may reject GET (no server-initiated stream) and DELETE (no sessions).
mcpApp.get('/mcp/:token', (c) => c.json(rpcError(null, -32600, 'This server does not offer an SSE stream'), 405));
mcpApp.delete('/mcp/:token', (c) => c.body(null, 405));
