import { describe, expect, it } from 'vitest';
import { mcpApp } from '../mcp/route';
import { SHEETCANVAS_APP_RESOURCE_URI, SHEETCANVAS_APP_TOOL_NAME } from '../mcp/pluginUi';
import type { Env } from '../env';

const TOKEN = 'a'.repeat(48);
const endpoint = `http://localhost/mcp/${TOKEN}`;

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

describe('ChatGPT MCP extension routes', () => {
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
});
