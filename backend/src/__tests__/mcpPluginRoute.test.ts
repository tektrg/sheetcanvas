import { describe, expect, it, vi } from 'vitest';
import { mcpApp } from '../mcp/route';
import {
  SHEETCANVAS_APP_RESOURCE_URI,
  SHEETCANVAS_APP_TOOL_NAME,
  SHEETCANVAS_PUBLIC_APP_RESOURCE_URI,
} from '../mcp/pluginUi';
import type { Env } from '../env';

const TOKEN = 'a'.repeat(48);
const endpoint = `http://localhost/mcp/${TOKEN}`;
const PUBLIC_BLOCKED_CONNECTOR_TOOLS = [
  'listConnections',
  'listConnectionProperties',
  'describeConnection',
  'createQuerySheet',
  'queryConnection',
  'createQuerySheetFromResult',
  'updateQuerySheet',
  'createGaTrendBySource',
];

async function rpc(method: string, params?: Record<string, unknown>) {
  const response = await mcpApp.request(
    endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    {} as Env,
  );

  return { response, body: await response.json() as Record<string, any> };
}

function createPublicEnv(browserConnected = false) {
  const pointers = new Map<string, { session: string; expiresAtMs: number }>();
  const sessions = new Map<string, { active: boolean; connected: boolean; calls: string[]; inputs: unknown[] }>();
  const stateFor = (name: string) => {
    if (!sessions.has(name)) sessions.set(name, { active: false, connected: browserConnected, calls: [], inputs: [] });
    return sessions.get(name)!;
  };
  return {
    env: {
      CANVAS_BRIDGE: {
        idFromName: (name: string) => name,
        get: (name: string) => {
          const state = stateFor(name);
          return {
            getStatus: async () => ({ browserConnected: state.connected }),
            initializePublicSession: async () => { state.active = true; },
            isPublicSessionActive: async () => state.active,
            terminatePublicSession: async () => { state.active = false; },
            registerPublicCanvasHandle: async (session: string, expiresAtMs: number) => { pointers.set(name, { session, expiresAtMs }); },
            resolvePublicCanvasHandle: async (nowMs: number) => {
              const pointer = pointers.get(name);
              if (!pointer || pointer.expiresAtMs <= nowMs) { pointers.delete(name); return null; }
              return pointer;
            },
            callTool: async (tool: string, input: unknown) => {
              state.calls.push(tool);
              state.inputs.push(input);
              return state.connected ? { ok: true, result: { received: tool } } : { ok: false, error: 'not-connected' };
            },
          };
        },
      },
    } as unknown as Env,
    isActive: () => [...sessions.values()].some((state) => state.active),
    sessionState: (session: string) => stateFor(`public:${session}`),
    pointers,
  };
}

async function publicRpc(
  env: Env,
  method: string,
  params?: Record<string, unknown>,
  session?: string,
) {
  const response = await mcpApp.request(
    'http://localhost/mcp',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(session ? { 'Mcp-Session-Id': session } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    env,
  );
  return { response, body: await response.json() as Record<string, any> };
}

describe('ChatGPT MCP extension routes', () => {
  it('routes one explicit canvas across rotated transports and preserves it after transport deletion', async () => {
    const { env, sessionState } = createPublicEnv();
    const transport = async () => (await publicRpc(env, 'initialize')).response.headers.get('Mcp-Session-Id')!;
    const sessionA = await transport();
    const opened = await publicRpc(env, 'tools/call', { name: SHEETCANVAS_APP_TOOL_NAME, arguments: {} }, sessionA);
    const { canvasHandle } = opened.body.result.structuredContent;
    const logical = opened.body.result._meta.bridgeSession;
    expect(canvasHandle).toMatch(/^c_[a-f0-9]{64}$/);
    expect(logical).not.toBe(sessionA);
    sessionState(logical).connected = true;
    const sessionB = await transport();
    const created = await publicRpc(env, 'tools/call', { name: 'createSheet', arguments: { canvasHandle, title: 'Quarterly Plan' } }, sessionB);
    const sessionC = await transport();
    const read = await publicRpc(env, 'tools/call', { name: 'listSheets', arguments: { canvasHandle } }, sessionC);
    expect(created.body.result.isError).not.toBe(true);
    expect(read.body.result.isError).not.toBe(true);
    expect(sessionState(logical).calls).toEqual(['createSheet', 'listSheets']);
    expect(sessionState(logical).inputs).toEqual([{ title: 'Quarterly Plan' }, {}]);
    await mcpApp.request('http://localhost/mcp', { method: 'DELETE', headers: { 'Mcp-Session-Id': sessionA } }, env);
    expect(sessionState(logical).active).toBe(true);
    const reopened = await publicRpc(env, 'tools/call', { name: SHEETCANVAS_APP_TOOL_NAME, arguments: { canvasHandle } }, sessionC);
    expect(reopened.body.result._meta.bridgeSession).toBe(logical);
    expect(reopened.body.result.structuredContent.ready).toBe(true);
  });
  it('fails closed for missing, invalid, unknown and expired handles without extending expiry or mutating canvases', async () => {
    vi.useFakeTimers();
    try {
      const { env, pointers, sessionState } = createPublicEnv();
      const transport = (await publicRpc(env, 'initialize')).response.headers.get('Mcp-Session-Id')!;
      const launch = (args: Record<string, unknown>) => publicRpc(env, 'tools/call', { name: SHEETCANVAS_APP_TOOL_NAME, arguments: args }, transport);
      const opened = (await launch({})).body.result;
      const handle = opened.structuredContent.canvasHandle;
      const pointer = pointers.get(`public-canvas:${handle}`)!;
      const originalExpiry = pointer.expiresAtMs;
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await launch({ canvasHandle: handle })).body.result.structuredContent.expiresInSeconds).toBe(7140);
      expect(pointer.expiresAtMs).toBe(originalExpiry);
      for (const canvasHandle of [undefined, '', null, 'c_invalid', `c_${'f'.repeat(64)}`]) {
        const response = await publicRpc(env, 'tools/call', { name: 'listSheets', arguments: { canvasHandle } }, transport);
        expect(response.body.error.code).toBe(-32602);
      }
      expect((await launch({ canvasHandle: `c_${'f'.repeat(64)}` })).body.error.code).toBe(-32602);
      expect((await launch({ unexpected: true })).body.error.code).toBe(-32602);
      expect(pointers.size).toBe(1);
      await vi.advanceTimersByTimeAsync(7_140_000);
      expect((await launch({ canvasHandle: handle })).body.error.code).toBe(-32602);
      expect(pointers.size).toBe(0);
      expect(sessionState(opened._meta.bridgeSession).calls).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('keeps separate transport sessions isolated and preserves an explicitly reused session', async () => {
    const { env, sessionState } = createPublicEnv();
    const first = await publicRpc(env, 'initialize');
    const second = await publicRpc(env, 'initialize');
    const sessionA = first.response.headers.get('Mcp-Session-Id')!;
    const sessionB = second.response.headers.get('Mcp-Session-Id')!;
    expect(sessionA).not.toBe(sessionB);
    const reopened = await publicRpc(env, 'initialize', undefined, sessionA);
    expect(reopened.response.headers.get('Mcp-Session-Id')).toBe(sessionA);
    const launch = (session: string) => publicRpc(env, 'tools/call', { name: SHEETCANVAS_APP_TOOL_NAME }, session);
    const canvasA = (await launch(sessionA)).body.result;
    const canvasB = (await launch(sessionB)).body.result;
    expect(canvasA._meta.bridgeSession).not.toBe(canvasB._meta.bridgeSession);
    const handle = canvasA.structuredContent.canvasHandle;
    await publicRpc(env, 'tools/call', { name: 'listSheets', arguments: { canvasHandle: handle } }, sessionB);
    expect(sessionState(canvasA._meta.bridgeSession).calls).toEqual(['listSheets']);
    expect(sessionState(canvasB._meta.bridgeSession).calls).toEqual([]);
    expect(sessionState(sessionA).calls).toEqual([]);
  });

  it('logs bounded correlation fingerprints without raw credentials, metadata or arguments', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const { env } = createPublicEnv();
      const initialized = await publicRpc(env, 'initialize');
      const session = initialized.response.headers.get('Mcp-Session-Id')!;
      const metadata = { 'openai/session': 'host-secret-session', 'openai/subject': 'host-secret-subject', unknown: 'metadata-secret' };
      await publicRpc(env, 'tools/call', { name: SHEETCANVAS_APP_TOOL_NAME, _meta: metadata, arguments: {} }, session);
      await publicRpc(env, 'tools/call', { name: 'untrusted-secret-name', _meta: { 'openai/session': 'x'.repeat(513), 'openai/subject': {} }, arguments: { password: 'argument-secret' } }, session);
      await publicRpc(env, 'tools/list', undefined, session);
      const logs = info.mock.calls.filter(([prefix]) => prefix === '[sheetcanvas-public-session]');
      expect(logs).toHaveLength(3);
      expect(logs[1][1]).toMatchObject({ method: 'tools/call', toolName: SHEETCANVAS_APP_TOOL_NAME, hasHostSession: true, hasHostSubject: true });
      expect(logs[1][1].sessionFingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(logs[1][1].sessionFingerprint).toBe(logs[0][1].sessionFingerprint);
      expect(logs[1][1].hostSessionFingerprint).toMatch(/^[a-f0-9]{16}$/);
      expect(logs[2][1]).toMatchObject({ hasHostSession: false, hasHostSubject: false });
      expect(logs[2][1]).not.toHaveProperty('toolName');
      expect(logs[2][1]).not.toHaveProperty('hostSessionFingerprint');
      const serialized = JSON.stringify(logs);
      for (const secret of [session, ...Object.values(metadata), 'argument-secret', 'untrusted-secret-name']) expect(serialized).not.toContain(secret);
    } finally {
      info.mockRestore();
    }
  });
  it('reports ready only once the public workspace has connected', async () => {
    const { env } = createPublicEnv(true);
    const initialized = await publicRpc(env, 'initialize');
    const session = initialized.response.headers.get('Mcp-Session-Id')!;
    const opened = await publicRpc(env, 'tools/call', { name: SHEETCANVAS_APP_TOOL_NAME, arguments: {} }, session);
    expect(opened.body.result.structuredContent).toMatchObject({ ready: true, canvasHandle: expect.stringMatching(/^c_[a-f0-9]{64}$/), expiresInSeconds: expect.any(Number) });
  });
  it('advertises tools and UI resources during initialization', async () => {
    const { response, body } = await rpc('initialize', { protocolVersion: '2025-06-18' });

    expect(response.status).toBe(200);
    expect(body.result.capabilities).toEqual({ tools: {}, resources: {} });
  });

  it('lists the app-only launcher and reads its interactive resource', async () => {
    const tools = await rpc('tools/list');
    const launcher = tools.body.result.tools.find(
      (tool: { name: string }) => tool.name === SHEETCANVAS_APP_TOOL_NAME,
    );
    expect(launcher?._meta?.['openai/ui']?.entrypoints).toEqual([{ type: 'global' }]);
    expect(launcher?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tools.body.result.tools.every((tool: { annotations?: Record<string, unknown> }) =>
      ['readOnlyHint', 'destructiveHint', 'openWorldHint'].every(
        (hint) => typeof tool.annotations?.[hint] === 'boolean',
      ),
    )).toBe(true);
    expect(tools.body.result.tools.find((tool: { name: string }) => tool.name === 'setCells')?.annotations)
      .toMatchObject({ destructiveHint: true, openWorldHint: false });
    expect(tools.body.result.tools.find((tool: { name: string }) => tool.name === 'queryConnection')?.annotations)
      .toMatchObject({ destructiveHint: false, openWorldHint: true });

    const resources = await rpc('resources/list');
    expect(resources.body.result.resources[0].uri).toBe(SHEETCANVAS_APP_RESOURCE_URI);

    const resource = await rpc('resources/read', { uri: SHEETCANVAS_APP_RESOURCE_URI });
    const content = resource.body.result.contents[0];
    expect(content.mimeType).toBe('text/html;profile=mcp-app');
    expect(content.text).toContain(`#mcp_token=${TOKEN}`);
    expect(content.text).not.toContain(`?mcp_token=${TOKEN}`);
  });

  it('runs the launcher without requiring a connected canvas bridge', async () => {
    const { body } = await rpc('tools/call', {
      name: SHEETCANVAS_APP_TOOL_NAME,
      arguments: {},
    });

    expect(body.result.structuredContent).toEqual({ ready: true });
    expect(body.result.isError).not.toBe(true);
  });

  it('isolates the public endpoint behind a short-lived MCP session', async () => {
    const { env, isActive } = createPublicEnv();
    const initialized = await publicRpc(env, 'initialize', { protocolVersion: '2025-06-18' });
    const session = initialized.response.headers.get('Mcp-Session-Id') ?? '';

    expect(initialized.response.status).toBe(200);
    expect(session).toMatch(/^p_[a-f0-9]{64}$/);
    expect(initialized.response.headers.get('cache-control')).toBe('no-store');
    expect(isActive()).toBe(true);

    const withoutSession = await publicRpc(env, 'tools/list');
    expect(withoutSession.response.status).toBe(400);

    const tools = await publicRpc(env, 'tools/list', undefined, session);
    const launcher = tools.body.result.tools.find(
      (tool: { name: string }) => tool.name === SHEETCANVAS_APP_TOOL_NAME,
    );
    expect(launcher._meta.ui.resourceUri).toBe(SHEETCANVAS_PUBLIC_APP_RESOURCE_URI);
    expect(launcher._meta.ui.visibility).toEqual(['model', 'app']);
    const publicToolNames = tools.body.result.tools.map((tool: { name: string }) => tool.name);
    for (const blockedTool of PUBLIC_BLOCKED_CONNECTOR_TOOLS) {
      expect(publicToolNames).not.toContain(blockedTool);
    }

    const opened = await publicRpc(
      env,
      'tools/call',
      { name: SHEETCANVAS_APP_TOOL_NAME, arguments: {} },
      session,
    );
    expect(opened.body.result.structuredContent).toMatchObject({ ready: false });
    expect(opened.body.result.content[0].text).toContain('opening');
    expect(opened.body.result._meta.bridgeSession).not.toBe(session);
    expect(opened.body.result._meta.canvasHandle).toBe(opened.body.result.structuredContent.canvasHandle);
    for (const tool of tools.body.result.tools.filter((tool: any) => tool.name !== SHEETCANVAS_APP_TOOL_NAME)) {
      expect(tool.inputSchema.required).toContain('canvasHandle');
    }

    for (const blockedTool of PUBLIC_BLOCKED_CONNECTOR_TOOLS) {
      const blockedConnector = await publicRpc(
        env,
        'tools/call',
        { name: blockedTool, arguments: {} },
        session,
      );
      expect(blockedConnector.body.error.message).toContain('unavailable in anonymous sessions');
    }

    const resource = await publicRpc(
      env,
      'resources/read',
      { uri: SHEETCANVAS_PUBLIC_APP_RESOURCE_URI },
      session,
    );
    expect(resource.body.result.contents[0].text).not.toContain(session);
    expect(resource.body.result.contents[0].text).not.toContain('mcp_token');

    const deleted = await mcpApp.request(
      'http://localhost/mcp',
      { method: 'DELETE', headers: { 'Mcp-Session-Id': session } },
      env,
    );
    expect(deleted.status).toBe(204);
    expect(isActive()).toBe(true); // Transport deletion must not end the logical canvas.

    const afterDelete = await publicRpc(env, 'tools/list', undefined, session);
    expect(afterDelete.response.status).toBe(404);
    expect(afterDelete.body.error.message).toContain('expired');
  });
});
