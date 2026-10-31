// Direct protocol fixtures with a REAL connected canvas. This does not grade
// ChatGPT's choice of tools or mobile host behavior; those need product runs.
// Setup: node scripts/mcp-review-fixtures.mjs initialize [origin]
// Open a trusted browser canvas with the returned bridgeSession (a secret).
// Check: node scripts/mcp-review-fixtures.mjs run [origin] <canvasHandle>
// After browser recreation: replace run with verify-recovery, same handle.
// Each tool uses a fresh MCP transport to exercise cross-transport continuity.
import assert from 'node:assert/strict';

const [mode, origin = 'http://127.0.0.1:8787', canvasHandle] = process.argv.slice(2);
const modes = ['initialize', 'run', 'verify-recovery'];
if (!modes.includes(mode)) {
  throw new Error('Usage: node scripts/mcp-review-fixtures.mjs initialize|run|verify-recovery [origin] [canvasHandle]');
}
if (mode !== 'initialize' || canvasHandle !== undefined) {
  assert.match(canvasHandle ?? '', /^c_[a-f0-9]{64}$/, 'Supply the canvasHandle, not an MCP transport or bridge credential');
}
const endpoint = `${origin}/mcp`;
let requestId = 0;
async function rpc(method, params, sessionId) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }),
    signal: AbortSignal.timeout(50_000),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(!body.error, JSON.stringify(body));
  return { response, result: body.result };
}
async function tool(name, input = {}) {
  const sessionId = await initializeTransport();
  const { result } = await rpc('tools/call', {
    name, arguments: { ...input, ...(canvasHandle ? { canvasHandle } : {}) },
  }, sessionId);
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  return {
    output: result.structuredContent ?? JSON.parse(result.content[0].text),
    metadata: result._meta,
  };
}
async function initializeTransport() {
  const { response } = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'sheetcanvas-review-fixtures', version: '1.0.2' },
  });
  const sessionId = response.headers.get('Mcp-Session-Id');
  assert.ok(sessionId, 'Server must return an MCP transport ID');
  return sessionId;
}
async function canvasTool(name, input = {}) {
  return (await tool(name, input)).output;
}
if (mode === 'initialize') {
  const { output, metadata } = await tool('openSheetCanvas');
  assert.match(output.canvasHandle ?? '', /^c_[a-f0-9]{64}$/);
  assert.match(metadata?.bridgeSession ?? '', /^p_[a-f0-9]{64}$/);
  console.error('Trusted browser setup only: bridgeSession grants temporary canvas access. Do not publish this output.');
  console.log(JSON.stringify({
    canvasHandle: output.canvasHandle,
    bridgeSession: metadata.bridgeSession,
    ready: output.ready,
    expiresInSeconds: output.expiresInSeconds,
  }));
} else if (mode === 'run') {
  const launch = await canvasTool('openSheetCanvas');
  assert.equal(launch.canvasHandle, canvasHandle, 'Launcher must reuse the explicit canvas');
  assert.equal(launch.ready, true, 'Canvas must be connected and restored');
  for (const fixture of [
    { title: 'Quarterly Plan', rows: [['Quarter', 'Target'], ['Q1', '120'], ['Q2', '150']] },
    { title: 'Growth Check', rows: [['Month', 'Revenue'], ['Jan', '100'], ['Feb', '130']] },
    { title: 'Chart Fixture', rows: [['Quarter', 'Target'], ['Q1', '120'], ['Q2', '150']], chart: true },
    { title: 'Note Fixture', rows: [['Quarter', 'Target'], ['Q1', '120'], ['Q2', '150']], note: true },
  ]) {
    const created = await canvasTool('createSheet', { title: fixture.title, data: fixture.rows });
    assert.ok(created.sheetId);
    const read = await canvasTool('getRange', { sheetId: created.sheetId, range: 'A1:B3' });
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 2; column++) {
        const address = `${column ? 'B' : 'A'}${row + 1}`;
        assert.equal(read.cells[address].raw, fixture.rows[row][column], address);
      }
    }
    assert.equal(Number(read.cells.B3.value) - Number(read.cells.B2.value), 30);
    if (fixture.chart) {
      const chart = await canvasTool('createChart', {
        sheetId: created.sheetId, type: 'bar', mode: 'metrics',
        labelColumn: 'A', dataColumns: ['B'], title: 'Target by Quarter',
      });
      assert.ok(chart.chartId);
    }
    if (fixture.note) {
      const note = await canvasTool('createNote', {
        title: 'Plan takeaway', content: 'Q2 (150) exceeds Q1 (120) by 30.',
      });
      const readNote = await canvasTool('readNote', { noteId: note.noteId });
      for (const value of ['120', '150', '30']) assert.ok(readNote.content.includes(value));
    }
    console.log(`PASS ${fixture.title} exact fixture and outputs`);
  }
  console.log('PASS direct fixture tools across fresh MCP transports; ChatGPT web/mobile prompt grading remains separate');
} else if (mode === 'verify-recovery') {
  const launch = await canvasTool('openSheetCanvas');
  assert.equal(launch.canvasHandle, canvasHandle);
  assert.equal(launch.ready, true, 'Recovered canvas must be connected and restored');
  const listed = await canvasTool('listSheets');
  const sheets = listed.sheets;
  for (const title of ['Quarterly Plan', 'Growth Check', 'Chart Fixture', 'Note Fixture']) {
    const sheet = sheets.find((entry) => entry.title === title);
    assert.ok(sheet, `Recovered sheet ${title}`);
    const read = await canvasTool('getRange', { sheetId: sheet.sheetId ?? sheet.id, range: 'A1:B3' });
    assert.equal(String(read.cells.B3.raw), title === 'Growth Check' ? '130' : '150');
  }
  const notes = await canvasTool('listNotes');
  const takeaway = notes.notes.find((note) => note.title.includes('Plan takeaway'));
  assert.ok(takeaway, 'Recovered report note');
  const report = await canvasTool('readNote', { noteId: takeaway.noteId });
  for (const value of ['120', '150', '30']) assert.ok(report.content.includes(value));
  console.log('PASS fixture sheet IDs and cells survived canvas recreation');
}
