import { describe, expect, it } from 'vitest';
import { mcpApp } from '../mcp/route';
import type { Env } from '../env';

const DIAGRAM_TOOLS = ['createDiagram', 'updateDiagramElement', 'addToDiagram', 'readDiagram', 'listDiagrams'];
// scripts/mcp-production-preflight.mjs expects this many public tools (incl. the launcher).
const PUBLIC_TOOL_COUNT = 21; // includes read-only validateDiagram + listDiagramTypes
const TOKEN = 'b'.repeat(48);
const ORG_ARGS = { kind: 'orgchart', spec: { nodes: [{ id: 'ceo', label: 'CEO' }] } };

function makeEnv(extra: Partial<Env> = {}) {
  let publicActive = false;
  const bridgeCalls: string[] = [];
  const stub = {
    initializePublicSession: async () => { publicActive = true; },
    isPublicSessionActive: async () => publicActive,
    terminatePublicSession: async () => { publicActive = false; },
    callTool: async (name: string) => {
      bridgeCalls.push(name);
      return { ok: true, result: { ok: true } };
    },
  };
  const env = {
    CANVAS_BRIDGE: { idFromName: (name: string) => name, get: () => stub },
    DB: { prepare: () => ({ bind: () => ({ run: async () => ({}), first: async () => null }) }) },
    ...extra,
  } as unknown as Env;
  return { env, bridgeCalls };
}

async function post(env: Env, url: string, method: string, params?: Record<string, unknown>, session?: string) {
  const response = await mcpApp.request(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    },
    env,
  );
  return { response, body: (await response.json()) as Record<string, any> };
}

const toolNames = (body: Record<string, any>) => body.result.tools.map((t: { name: string }) => t.name);

describe('diagram tool gating on the MCP server', () => {
  it('never lists diagram tools on the public endpoint and keeps the public count unchanged', async () => {
    const { env } = makeEnv({ DIAGRAMS_ENABLED: 'true' });
    const init = await post(env, 'http://localhost/mcp', 'initialize', { protocolVersion: '2025-06-18' });
    const session = init.response.headers.get('Mcp-Session-Id') ?? '';
    const names = toolNames((await post(env, 'http://localhost/mcp', 'tools/list', undefined, session)).body);
    for (const tool of DIAGRAM_TOOLS) expect(names).not.toContain(tool);
    expect(names).toHaveLength(PUBLIC_TOOL_COUNT);
  });

  it('rejects public diagram tool calls before they reach the canvas', async () => {
    const { env, bridgeCalls } = makeEnv({ DIAGRAMS_ENABLED: 'true' });
    const init = await post(env, 'http://localhost/mcp', 'initialize', { protocolVersion: '2025-06-18' });
    const session = init.response.headers.get('Mcp-Session-Id') ?? '';
    const call = await post(env, 'http://localhost/mcp', 'tools/call', { name: 'createDiagram', arguments: ORG_ARGS }, session);
    expect(call.body.error.message).toContain('unavailable in anonymous sessions');
    expect(bridgeCalls).toEqual([]);
  });

  it('hides diagram tools on private canvases unless DIAGRAMS_ENABLED is "true"', async () => {
    const off = makeEnv();
    const offNames = toolNames((await post(off.env, `http://localhost/mcp/${TOKEN}`, 'tools/list')).body);
    for (const tool of DIAGRAM_TOOLS) expect(offNames).not.toContain(tool);
    const offCall = await post(off.env, `http://localhost/mcp/${TOKEN}`, 'tools/call', { name: 'createDiagram', arguments: ORG_ARGS });
    expect(offCall.body.error.message).toContain('Unknown tool');
    expect(off.bridgeCalls).toEqual([]);

    const on = makeEnv({ DIAGRAMS_ENABLED: 'true' });
    const onNames = toolNames((await post(on.env, `http://localhost/mcp/${TOKEN}`, 'tools/list')).body);
    expect(onNames).toEqual(expect.arrayContaining(DIAGRAM_TOOLS));
    expect(onNames).toHaveLength(offNames.length + DIAGRAM_TOOLS.length);
    const onCall = await post(on.env, `http://localhost/mcp/${TOKEN}`, 'tools/call', { name: 'createDiagram', arguments: ORG_ARGS });
    expect(onCall.body.result.isError).not.toBe(true);
    expect(on.bridgeCalls).toEqual(['createDiagram']);
  });
});
