// Harness contract tests, not real connected-canvas or ChatGPT prompt evidence.
import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const executeFile = promisify(execFile);
const canvasHandle = `c_${'a'.repeat(64)}`;
const bridgeSession = `p_${'b'.repeat(64)}`;
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  })));
});

async function mockCanvas(ready = true) {
  const calls: Array<{ name: string; input: Record<string, unknown>; transport: string }> = [];
  const sheets = new Map<string, { title: string; rows: string[][] }>();
  const notes = new Map<string, { title: string; content: string }>();
  let transportNumber = 0;
  const server = createServer(async (request, response) => {
    let text = '';
    for await (const chunk of request) text += chunk;
    const body = JSON.parse(text);
    response.setHeader('Content-Type', 'application/json');
    let result: unknown;
    if (body.method === 'initialize') {
      response.setHeader('Mcp-Session-Id', `transport-${++transportNumber}`);
      result = { protocolVersion: '2025-06-18', capabilities: {} };
    } else {
      const { name, arguments: input } = body.params;
      calls.push({ name, input, transport: String(request.headers['mcp-session-id']) });
      let output: unknown;
      if (name === 'openSheetCanvas') output = { ready, canvasHandle, expiresInSeconds: 7200 };
      else if (name === 'createSheet') {
        const sheetId = `sheet-${sheets.size + 1}`;
        sheets.set(sheetId, { title: input.title, rows: input.data });
        output = { sheetId };
      } else if (name === 'getRange') {
        const sheet = sheets.get(input.sheetId)!;
        const cells = Object.fromEntries(sheet.rows.flatMap((row, rowIndex) => row.map((raw, column) => [
          `${column ? 'B' : 'A'}${rowIndex + 1}`, { raw, value: raw },
        ])));
        output = { cells };
      } else if (name === 'createChart') output = { chartId: 'chart-1' };
      else if (name === 'createNote') {
        const noteId = `note-${notes.size + 1}`;
        notes.set(noteId, input);
        output = { noteId };
      } else if (name === 'readNote') output = notes.get(input.noteId);
      else if (name === 'listSheets') {
        output = { sheets: [...sheets].map(([sheetId, sheet]) => ({ sheetId, title: sheet.title })) };
      } else if (name === 'listNotes') {
        output = { notes: [...notes].map(([noteId, note]) => ({ noteId, title: note.title })) };
      } else throw new Error(`Unexpected harness tool ${name}`);
      result = { structuredContent: output, _meta: { bridgeSession } };
    }
    response.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  const origin = `http://127.0.0.1:${address.port}`;
  const run = (mode: string, handle?: string) => executeFile(process.execPath, [
    'scripts/mcp-review-fixtures.mjs', mode, origin, ...(handle ? [handle] : []),
  ]);
  return { calls, run };
}

describe('review fixture harness transport rotation', () => {
  it('returns an explicit trusted browser setup and can reuse a canvas', async () => {
    const mock = await mockCanvas(false);
    const initial = await mock.run('initialize');
    expect(JSON.parse(initial.stdout)).toEqual({ canvasHandle, bridgeSession, ready: false, expiresInSeconds: 7200 });
    expect(initial.stderr).toContain('Do not publish');
    await mock.run('initialize', canvasHandle);
    expect(mock.calls.map((call) => call.input)).toEqual([{}, { canvasHandle }]);
  });

  it('uses the same canvas handle on fresh transports for fixtures and recovery', async () => {
    const mock = await mockCanvas();
    expect((await mock.run('run', canvasHandle)).stdout).toContain('PASS direct fixture tools across fresh MCP transports');
    expect((await mock.run('verify-recovery', canvasHandle)).stdout).toContain('PASS fixture sheet IDs and cells survived canvas recreation');
    expect(mock.calls.length).toBeGreaterThan(15);
    expect(new Set(mock.calls.map((call) => call.transport)).size).toBe(mock.calls.length);
    expect(mock.calls.every((call) => call.input.canvasHandle === canvasHandle)).toBe(true);
  });

  it('fails without writes when the actual canvas is not ready', async () => {
    const mock = await mockCanvas(false);
    await expect(mock.run('run', canvasHandle)).rejects.toThrow('Canvas must be connected and restored');
    expect(mock.calls.map((call) => call.name)).toEqual(['openSheetCanvas']);
    await expect(mock.run('run', bridgeSession)).rejects.toThrow('Supply the canvasHandle');
    expect(mock.calls).toHaveLength(1);
  });
});
