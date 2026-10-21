// Direct protocol fixtures with a REAL connected canvas. This does not grade
// ChatGPT's choice of tools or mobile host behavior; those need product runs.
import assert from 'node:assert/strict';

const [mode, origin = 'http://127.0.0.1:8787', session] = process.argv.slice(2);
const endpoint = `${origin}/mcp`;
let requestId = 0;
async function rpc(method, params, sessionId = session) {
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
  const { result } = await rpc('tools/call', { name, arguments: input });
  assert.ok(!result.isError, `${name}: ${JSON.stringify(result.content)}`);
  return result.structuredContent ?? JSON.parse(result.content[0].text);
}
if (mode === 'initialize') {
  const { response } = await rpc('initialize', {
    protocolVersion: '2025-06-18', capabilities: {},
    clientInfo: { name: 'sheetcanvas-review-fixtures', version: '1.0.1' },
  });
  console.log(response.headers.get('Mcp-Session-Id'));
} else if (mode === 'run') {
  assert.match(session ?? '', /^p_[a-f0-9]{64}$/);
  const launch = await tool('openSheetCanvas');
  assert.equal(launch.ready, true, 'Canvas must be connected and restored');
  for (const fixture of [
    { title: 'Quarterly Plan', rows: [['Quarter', 'Target'], ['Q1', '120'], ['Q2', '150']] },
    { title: 'Growth Check', rows: [['Month', 'Revenue'], ['Jan', '100'], ['Feb', '130']] },
    { title: 'Chart Fixture', rows: [['Quarter', 'Target'], ['Q1', '120'], ['Q2', '150']], chart: true },
    { title: 'Note Fixture', rows: [['Quarter', 'Target'], ['Q1', '120'], ['Q2', '150']], note: true },
  ]) {
    const created = await tool('createSheet', { title: fixture.title, data: fixture.rows });
    assert.ok(created.sheetId);
    const read = await tool('getRange', { sheetId: created.sheetId, range: 'A1:B3' });
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 2; column++) {
        const address = `${column ? 'B' : 'A'}${row + 1}`;
        assert.equal(read.cells[address].raw, fixture.rows[row][column], address);
      }
    }
    assert.equal(Number(read.cells.B3.value) - Number(read.cells.B2.value), 30);
    if (fixture.chart) {
      const chart = await tool('createChart', {
        sheetId: created.sheetId, type: 'bar', mode: 'metrics',
        labelColumn: 'A', dataColumns: ['B'], title: 'Target by Quarter',
      });
      assert.ok(chart.chartId);
    }
    if (fixture.note) {
      const note = await tool('createNote', {
        title: 'Plan takeaway', content: 'Q2 (150) exceeds Q1 (120) by 30.',
      });
      const readNote = await tool('readNote', { noteId: note.noteId });
      for (const value of ['120', '150', '30']) assert.ok(readNote.content.includes(value));
    }
    console.log(`PASS ${fixture.title} exact fixture and outputs`);
  }
  console.log('PASS direct fixture tools; ChatGPT web/mobile prompt grading remains separate');
} else if (mode === 'verify-recovery') {
  const listed = await tool('listSheets');
  const sheets = listed.sheets;
  for (const title of ['Quarterly Plan', 'Growth Check', 'Chart Fixture', 'Note Fixture']) {
    const sheet = sheets.find((entry) => entry.title === title);
    assert.ok(sheet, `Recovered sheet ${title}`);
    const read = await tool('getRange', { sheetId: sheet.sheetId ?? sheet.id, range: 'A1:B3' });
    assert.equal(String(read.cells.B3.raw), title === 'Growth Check' ? '130' : '150');
  }
  const notes = await tool('listNotes');
  const takeaway = notes.notes.find((note) => note.title.includes('Plan takeaway'));
  assert.ok(takeaway, 'Recovered report note');
  const report = await tool('readNote', { noteId: takeaway.noteId });
  for (const value of ['120', '150', '30']) assert.ok(report.content.includes(value));
  console.log('PASS fixture sheet IDs and cells survived canvas recreation');
} else {
  throw new Error('Usage: node scripts/mcp-review-fixtures.mjs initialize|run|verify-recovery [origin] [public-session]');
}
