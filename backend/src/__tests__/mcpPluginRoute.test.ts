import { describe, expect, it } from 'vitest';
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
  let active = false;
  const stub = {
    getStatus: async () => ({ browserConnected }),
    initializePublicSession: async () => { active = true; },
    isPublicSessionActive: async () => active,
    terminatePublicSession: async () => { active = false; },
  };
  return {
    env: {
      CANVAS_BRIDGE: {
        idFromName: (name: string) => name,
        get: () => stub,
      },
    } as unknown as Env,
    isActive: () => active,
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
  it('reports ready only once the public workspace has connected', async () => {
    const { env } = createPublicEnv(true);
    const initialized = await publicRpc(env, 'initialize');
    const session = initialized.response.headers.get('Mcp-Session-Id')!;
    const opened = await publicRpc(env, 'tools/call', { name: SHEETCANVAS_APP_TOOL_NAME, arguments: {} }, session);
    expect(opened.body.result.structuredContent).toEqual({ ready: true });
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
    expect(opened.body.result.structuredContent).toEqual({ ready: false });
    expect(opened.body.result.content[0].text).toContain('opening');
    expect(opened.body.result._meta).toEqual({ bridgeSession: session });

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
    expect(isActive()).toBe(false);

    const afterDelete = await publicRpc(env, 'tools/list', undefined, session);
    expect(afterDelete.response.status).toBe(404);
    expect(afterDelete.body.error.message).toContain('expired');
  });
});
