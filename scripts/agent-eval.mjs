import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';

const DEFAULT_CASES_PATH = 'agent/evals/sample.json';
const DEFAULT_APP_URL = 'http://127.0.0.1:5173/';
const DEFAULT_TIMEOUT_MS = 120_000;
const RUNS_DIR = '.agent-eval-runs';

function parseArgs(argv) {
  const args = {
    casesPath: DEFAULT_CASES_PATH,
    appUrl: process.env.AGENT_EVAL_APP_URL || DEFAULT_APP_URL,
    browserWsUrl: process.env.AGENT_EVAL_BROWSER_WS_URL || '',
    headless: true,
    includeRawMessages: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cases') args.casesPath = argv[++index];
    else if (arg === '--app-url') args.appUrl = argv[++index];
    else if (arg === '--browser-ws-url') args.browserWsUrl = argv[++index];
    else if (arg === '--headed') args.headless = false;
    else if (arg === '--include-raw-messages') args.includeRawMessages = true;
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++index]);
    else if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive number');
  }
  return args;
}

function printUsage() {
  console.log(`Usage: npm run agent:eval -- [options]

Options:
  --cases <path>         JSON eval cases file. Default: ${DEFAULT_CASES_PATH}
  --app-url <url>        Running SheetCanvas app URL. Default: ${DEFAULT_APP_URL}
  --browser-ws-url <url> Use an existing Chrome DevTools browser websocket.
  --headed              Show Chrome instead of running headless.
  --include-raw-messages Write raw AI SDK messages to the run log.
  --timeout-ms <ms>     Per-prompt timeout. Default: ${DEFAULT_TIMEOUT_MS}

The app and backend must already be running. The page is opened with ?agent_eval=1
so the real browser-side agent tools mutate the real canvas state.`);
}

function loadCases(casesPath) {
  const fullPath = resolve(casesPath);
  const parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
  const cases = Array.isArray(parsed) ? parsed : parsed.cases;
  if (!Array.isArray(cases) || cases.length === 0) {
    throw new Error(`${casesPath} must contain a non-empty cases[] array`);
  }
  return { cases, fullPath };
}

function findChromePath() {
	  const candidates = [
	    process.env.CHROME_PATH,
	    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
	    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
	    '/Applications/Chromium.app/Contents/MacOS/Chromium',
	  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Could not find Chrome/Chromium. Set CHROME_PATH to a browser executable.');
  }
  return found;
}

function withAgentEvalParam(appUrl) {
  const url = new URL(appUrl);
  url.searchParams.set('agent_eval', '1');
  return url.toString();
}

function httpOriginFromWebSocket(wsUrl) {
  const url = new URL(wsUrl);
  return `http://${url.host}`;
}

async function launchChrome({ headless }) {
  const userDataDir = mkdtempSync(join(tmpdir(), 'sheetcanvas-agent-eval-'));
  const debuggingPort = await findFreePort();
  console.log(`Launching Chrome on debugging port ${debuggingPort}...`);
  const chrome = spawn(findChromePath(), [
    `--user-data-dir=${userDataDir}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debuggingPort}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-extensions',
    headless ? '--headless=new' : '',
    'about:blank',
	  ].filter(Boolean), {
	    stdio: ['ignore', 'pipe', 'pipe'],
	  });

  const output = [];
  chrome.stdout.on('data', (chunk) => output.push(chunk.toString('utf8')));
  chrome.stderr.on('data', (chunk) => output.push(chunk.toString('utf8')));

	  let wsUrl;
	  try {
	    wsUrl = await waitForChromeWebSocket(debuggingPort, chrome, output);
	  } catch (error) {
	    await closeChromeProcess(chrome, userDataDir);
	    rmSync(userDataDir, { recursive: true, force: true });
	    throw error;
	  }

  return {
    chrome,
	    userDataDir,
	    browserWsUrl: wsUrl,
	    async close() {
	      await closeChromeProcess(chrome, userDataDir);
	      rmSync(userDataDir, { recursive: true, force: true });
	    },
	  };
	}

async function closeChromeProcess(chrome, userDataDir) {
  if (chrome.exitCode !== null || chrome.signalCode !== null) {
    await killChromeUserDataDir(userDataDir);
    return;
  }
  const pid = chrome.pid;
  chrome.kill('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolvePromise) => chrome.once('exit', () => resolvePromise(true))),
    new Promise((resolvePromise) => setTimeout(() => resolvePromise(false), 2500)),
  ]);
  if (!exited && pid) {
    try {
      chrome.kill('SIGKILL');
    } catch {
      // The process may have exited between the timeout and SIGKILL.
    }
  }
  await killChromeUserDataDir(userDataDir);
}

async function killChromeUserDataDir(userDataDir) {
  const escaped = userDataDir.replace(/'/g, "'\\''");
  await new Promise((resolvePromise) => {
    const cleanup = spawn('sh', ['-c', `pkill -f '${escaped}' || true`], {
      stdio: 'ignore',
    });
    cleanup.once('exit', resolvePromise);
    cleanup.once('error', resolvePromise);
  });
}

function findFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(() => {
        if (port) resolvePromise(port);
        else reject(new Error('Could not allocate a Chrome debugging port'));
      });
    });
    server.on('error', reject);
  });
}

async function waitForChromeWebSocket(debuggingPort, chrome, output) {
  return new Promise((resolvePromise, reject) => {
    let pollTimer;
    let settled = false;
    const finish = (error, wsUrl) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(pollTimer);
      chrome.stdout.off('data', onData);
      chrome.stderr.off('data', onData);
      chrome.off('exit', onExit);
      if (error) reject(error);
      else resolvePromise(wsUrl);
    };
    const onData = (chunk) => {
      const text = chunk.toString('utf8');
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
    };
    const onExit = (code) => {
      finish(new Error(`Chrome exited before DevTools was ready (code ${code ?? 'unknown'}). ${output.join('').slice(-1000)}`));
    };
    const timer = setTimeout(() => {
      const text = output.join('');
      const match = text.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
      else finish(new Error(`Timed out waiting for Chrome DevTools endpoint on ${debuggingPort}. ${text.slice(-1000)}`));
    }, 30_000);
    pollTimer = setInterval(() => {
      requestJson(`http://127.0.0.1:${debuggingPort}/json/version`, { timeoutMs: 1000 })
        .then((version) => {
          if (version.webSocketDebuggerUrl) finish(null, version.webSocketDebuggerUrl);
        })
        .catch(() => {});
    }, 250);
    chrome.stdout.on('data', onData);
    chrome.stderr.on('data', onData);
    chrome.on('exit', onExit);
  });
}

class CdpClient {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    webSocket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const callbacks = this.pending.get(message.id);
      if (!callbacks) return;
      this.pending.delete(message.id);
      if (message.error) callbacks.reject(new Error(message.error.message));
      else callbacks.resolve(message.result);
    });
  }

  static connect(wsUrl) {
    if (typeof WebSocket !== 'function') {
      throw new Error('This Node runtime does not provide global WebSocket. Use Node 22+.');
    }
    return new Promise((resolvePromise, reject) => {
      const webSocket = new WebSocket(wsUrl);
      webSocket.addEventListener('open', () => resolvePromise(new CdpClient(webSocket)));
      webSocket.addEventListener('error', reject);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
    });
  }

  close() {
    this.webSocket.close();
  }
}

async function openPage(browserWsUrl, url) {
  const origin = httpOriginFromWebSocket(browserWsUrl);
  console.log(`Opening ${url}...`);
  const browser = await CdpClient.connect(browserWsUrl);
  const { targetId } = await browser.send('Target.createTarget', { url });
  browser.close();
  const target = await waitForTargetWebSocket(origin, targetId, 5000);
  const page = await CdpClient.connect(target.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  return page;
}

async function waitForTargetWebSocket(origin, targetId, timeoutMs) {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await requestJson(`${origin}/json/list`, { timeoutMs: 1000 });
      const target = Array.isArray(targets)
        ? targets.find((candidate) => candidate.id === targetId)
        : null;
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out resolving Chrome target ${targetId}. ${lastError}`);
}

function requestJson(url, { method = 'GET', timeoutMs = 1000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      request.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms: ${url}`));
    }, timeoutMs);
    const request = http.request(url, { method, timeout: timeoutMs }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => {
        clearTimeout(timer);
        if ((response.statusCode ?? 500) < 200 || (response.statusCode ?? 500) >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${body.slice(0, 300)}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    request.on('timeout', () => {
      request.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms: ${url}`));
    });
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

async function evaluate(page, expression, timeoutMs = 30_000) {
  const result = await Promise.race([
    page.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Runtime.evaluate timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  }
  return result.result?.value;
}

function pageFunctionCall(fn, ...args) {
  return `(${fn})(...${JSON.stringify(args)})`;
}

async function waitForEvalBridge(page, timeoutMs) {
  console.log('Waiting for SheetCanvas eval bridge...');
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    const isReady = await evaluate(page, 'Boolean(window.__sheetCanvasAgentEval)', 5000).catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      return false;
    });
    if (isReady) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  const diagnostic = await evaluate(page, pageFunctionCall(() => ({
    location: window.location.href,
    title: document.title,
    bodyText: document.body?.innerText?.slice(0, 500) ?? '',
    hasRoot: !!document.getElementById('root'),
  })), 5000).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
  throw new Error(`Timed out waiting for window.__sheetCanvasAgentEval: ${JSON.stringify({ diagnostic, lastError })}`);
}

async function waitForCanvasReady(page, timeoutMs) {
  console.log('Waiting for initial canvas state...');
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    const summary = await evaluate(page, pageFunctionCall(() => {
      const evalApi = window.__sheetCanvasAgentEval;
      if (!evalApi) return { ready: false };
      const state = evalApi.getCanvasState();
      return {
        ready: state.sheets.length > 0 || state.charts.length > 0 || state.notes.length > 0,
        counts: {
          sheets: state.sheets.length,
          charts: state.charts.length,
          notes: state.notes.length,
        },
      };
    }), 5000).catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      return { ready: false };
    });
    if (summary.ready) return summary;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for SheetCanvas initial canvas state. ${lastError}`);
}

async function startPromptRun(page, prompt, options) {
  await evaluate(page, pageFunctionCall(
    (nextPrompt, nextOptions) => {
      window.__sheetCanvasAgentEvalLastRun = null;
      window.__sheetCanvasAgentEval.runPrompt(nextPrompt, nextOptions)
        .then((result) => {
          window.__sheetCanvasAgentEvalLastRun = result;
        })
        .catch((error) => {
          window.__sheetCanvasAgentEvalLastRun = {
            canvasState: window.__sheetCanvasAgentEval.getCanvasState(),
            error: error instanceof Error ? error.message : String(error),
            messages: window.__sheetCanvasAgentEval.getMessages(),
            status: window.__sheetCanvasAgentEval.getStatus(),
          };
        });
      return true;
    },
    prompt,
    options,
  ), 5000);
}

async function waitForPromptRunResult(page, timeoutMs) {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluate(
      page,
      'window.__sheetCanvasAgentEvalLastRun ?? null',
      5000,
    ).catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      return null;
    });
    if (result) return result;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  const fallback = await evaluate(page, pageFunctionCall(() => ({
    canvasState: window.__sheetCanvasAgentEval.getCanvasState(),
    error: `Agent eval runner timed out waiting for prompt result. ${window.__sheetCanvasAgentEval.getStatus()}`,
    messages: window.__sheetCanvasAgentEval.getMessages(),
    status: window.__sheetCanvasAgentEval.getStatus(),
  })), 5000).catch(() => ({
    canvasState: { sheets: [], charts: [], notes: [], selectedIds: [] },
    error: `Agent eval runner timed out waiting for prompt result. ${lastError}`,
    messages: [],
    status: 'error',
  }));
  return fallback;
}

function textFromMessage(message) {
  const parts = Array.isArray(message.parts) ? message.parts : [];
  return parts
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
    .trim();
}

function collectToolEvents(value, events = []) {
  if (!value || typeof value !== 'object') return events;
  if (Array.isArray(value)) {
    value.forEach((item) => collectToolEvents(item, events));
    return events;
  }
  const record = value;
  const type = typeof record.type === 'string' ? record.type : '';
  const toolName = typeof record.toolName === 'string'
    ? record.toolName
    : type.startsWith('tool-') ? type.slice('tool-'.length) : null;
  if (toolName) {
    events.push({
      toolName,
      state: record.state ?? null,
      hasInput: !!record.input,
      ok: record.output && typeof record.output === 'object' ? record.output.ok ?? null : null,
      error: record.output && typeof record.output === 'object' ? record.output.error ?? null : null,
    });
  }
  Object.values(record).forEach((child) => collectToolEvents(child, events));
  return events;
}

function summarizeMessages(messages) {
  return messages.map((message) => ({
    id: message.id,
    role: message.role,
    text: textFromMessage(message),
    toolEvents: collectToolEvents(message),
  }));
}

function finalAssistantText(messages) {
  return [...messages].reverse().find((message) => message.role === 'assistant')
    ? textFromMessage([...messages].reverse().find((message) => message.role === 'assistant'))
    : '';
}

function includesIgnoreCase(value, needle) {
  return String(value ?? '').toLowerCase().includes(String(needle).toLowerCase());
}

function assertExpectation(condition, message, failures) {
  if (!condition) failures.push(message);
}

function newItems(beforeItems, afterItems) {
  const beforeIds = new Set(beforeItems.map((item) => item.id));
  return afterItems.filter((item) => !beforeIds.has(item.id));
}

function headerForColumn(state, sheetId, columnId) {
  const sheet = state.sheets.find((candidate) => candidate.id === sheetId);
  return sheet?.headers.find((header) => header.columnId === columnId)?.header ?? null;
}

function valuesEqual(actual, expected) {
  return actual === expected || String(actual ?? '') === String(expected ?? '');
}

function cellForId(sheet, cellId) {
  return sheet.cells?.find((cell) => cell.cellId === cellId) ?? null;
}

function sheetMatchesExpectation(sheet, expected) {
  if (expected.titleIncludes && !includesIgnoreCase(sheet.title, expected.titleIncludes)) return false;
  if (expected.minRowCount !== undefined && sheet.rowCount < expected.minRowCount) return false;
  if (expected.connector !== undefined && Boolean(sheet.connector) !== Boolean(expected.connector)) return false;
  for (const fragment of expected.headersInclude ?? []) {
    if (!sheet.headers.some((header) => includesIgnoreCase(header.header, fragment))) return false;
  }
  for (const expectation of expected.cellEquals ?? []) {
    const cell = cellForId(sheet, expectation.cell);
    const field = expectation.field ?? 'value';
    if (!cell || !valuesEqual(cell[field], expectation.value)) return false;
  }
  for (const fragment of expected.rangeIncludes ?? []) {
    if (!sheet.cells?.some((cell) => includesIgnoreCase(cell.value, fragment) || includesIgnoreCase(cell.raw, fragment))) return false;
  }
  for (const expectedFilter of expected.filters ?? []) {
    const matched = sheet.filters?.some((filter) => Object.entries(expectedFilter).every(([key, value]) => valuesEqual(filter[key], value)));
    if (!matched) return false;
  }
  if (expected.sort) {
    if (!sheet.sort) return false;
    if (!Object.entries(expected.sort).every(([key, value]) => valuesEqual(sheet.sort[key], value))) return false;
  }
  return true;
}

function chartMatchesExpectation(chart, expected, state) {
  const sourceSheet = state.sheets.find((sheet) => sheet.id === chart.sourceSheetId);
  if (expected.titleIncludes && !includesIgnoreCase(chart.title, expected.titleIncludes)) return false;
  if (expected.type && chart.type !== expected.type) return false;
  if (expected.sourceSheetTitleIncludes && !includesIgnoreCase(sourceSheet?.title, expected.sourceSheetTitleIncludes)) return false;
  if (expected.labelColumn && chart.labelColumn !== expected.labelColumn) return false;
  if (expected.labelHeader && !includesIgnoreCase(headerForColumn(state, chart.sourceSheetId, chart.labelColumn), expected.labelHeader)) return false;
  if (expected.dataColumns) {
    if (chart.dataColumns.length !== expected.dataColumns.length) return false;
    if (!expected.dataColumns.every((column, index) => chart.dataColumns[index] === column)) return false;
  }
  for (const column of expected.dataColumnsInclude ?? []) {
    if (!chart.dataColumns.includes(column)) return false;
  }
  const dataHeaders = chart.dataColumns.map((column) => headerForColumn(state, chart.sourceSheetId, column));
  for (const fragment of expected.dataHeadersInclude ?? []) {
    if (!dataHeaders.some((header) => includesIgnoreCase(header, fragment))) return false;
  }
  return true;
}

function compactChartForFailure(chart, state) {
  const sourceSheet = state.sheets.find((sheet) => sheet.id === chart.sourceSheetId);
  return {
    title: chart.title,
    type: chart.type,
    sourceSheetTitle: sourceSheet?.title ?? null,
    labelColumn: chart.labelColumn,
    labelHeader: headerForColumn(state, chart.sourceSheetId, chart.labelColumn),
    dataColumns: chart.dataColumns,
    dataHeaders: chart.dataColumns.map((column) => headerForColumn(state, chart.sourceSheetId, column)),
  };
}

function evaluateCaseExpectations({ evalCase, beforeState, afterState, messages, result }) {
  const failures = [];
  const expectations = evalCase.expect ?? {};
  const sheetDelta = afterState.sheets.length - beforeState.sheets.length;
  const chartDelta = afterState.charts.length - beforeState.charts.length;
  const assistantText = finalAssistantText(messages);
  const addedSheets = newItems(beforeState.sheets, afterState.sheets);
  const addedCharts = newItems(beforeState.charts, afterState.charts);

  if (!expectations.allowRunError) {
    assertExpectation(!result?.error, `Run reported error: ${result?.error}`, failures);
    assertExpectation(result?.status === 'ready', `Expected final status "ready", got "${result?.status}".`, failures);
  }

  if (expectations.minSheetsDelta !== undefined) {
    assertExpectation(sheetDelta >= expectations.minSheetsDelta, `Expected at least ${expectations.minSheetsDelta} new sheet(s), got ${sheetDelta}.`, failures);
  }
  if (expectations.minChartsDelta !== undefined) {
    assertExpectation(chartDelta >= expectations.minChartsDelta, `Expected at least ${expectations.minChartsDelta} new chart(s), got ${chartDelta}.`, failures);
  }
  if (expectations.noNewSheets) {
    assertExpectation(sheetDelta === 0, `Expected no new sheets, got ${sheetDelta}.`, failures);
  }
  if (expectations.noNewCharts) {
    assertExpectation(chartDelta === 0, `Expected no new charts, got ${chartDelta}.`, failures);
  }
  for (const fragment of expectations.sheetTitleIncludes ?? []) {
    assertExpectation(afterState.sheets.some((sheet) => includesIgnoreCase(sheet.title, fragment)), `No sheet title included "${fragment}".`, failures);
  }
  for (const fragment of expectations.chartTitleIncludes ?? []) {
    assertExpectation(afterState.charts.some((chart) => includesIgnoreCase(chart.title, fragment)), `No chart title included "${fragment}".`, failures);
  }
  for (const fragment of expectations.assistantIncludes ?? []) {
    assertExpectation(includesIgnoreCase(assistantText, fragment), `Assistant response did not include "${fragment}".`, failures);
  }
  for (const fragment of expectations.assistantExcludes ?? []) {
    assertExpectation(
      !includesIgnoreCase(assistantText, fragment),
      `Assistant response included forbidden text "${fragment}".`,
      failures,
    );
  }
  if (expectations.connectorSheetCreated) {
    assertExpectation(afterState.sheets.some((sheet) => !!sheet.connector), 'Expected at least one connector-backed sheet.', failures);
  }
  for (const [index, expectedSheet] of (expectations.sheets ?? []).entries()) {
    assertExpectation(
      afterState.sheets.some((sheet) => sheetMatchesExpectation(sheet, expectedSheet)),
      `No sheet matched expectation #${index + 1}: ${JSON.stringify(expectedSheet)}.`,
      failures,
    );
  }
  for (const [index, expectedSheet] of (expectations.newSheets ?? []).entries()) {
    assertExpectation(
      addedSheets.some((sheet) => sheetMatchesExpectation(sheet, expectedSheet)),
      `No new sheet matched expectation #${index + 1}: ${JSON.stringify(expectedSheet)}.`,
      failures,
    );
  }
  for (const [index, expectedChart] of (expectations.newCharts ?? []).entries()) {
    assertExpectation(
      addedCharts.some((chart) => chartMatchesExpectation(chart, expectedChart, afterState)),
      `No new chart matched expectation #${index + 1}: ${JSON.stringify(expectedChart)}. New charts: ${JSON.stringify(addedCharts.map((chart) => compactChartForFailure(chart, afterState)))}`,
      failures,
    );
  }

  return {
    passed: failures.length === 0,
    failures,
    metrics: { sheetDelta, chartDelta, runError: result?.error ?? null },
  };
}

function runLogPath(evalCase, startedAt) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const safeCaseId = String(evalCase.id || basename(evalCase.prompt).slice(0, 24))
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return join(RUNS_DIR, `${startedAt}-${safeCaseId || 'case'}.json`);
}

async function runCase({ page, evalCase, args, startedAt }) {
  if (evalCase.fixture) {
    const fixtureState = await evaluate(page, pageFunctionCall((fixture) => {
      window.__sheetCanvasAgentEval.loadFixture(fixture);
      return window.__sheetCanvasAgentEval.getCanvasState();
    }, evalCase.fixture), 5000);
    const expectedSheetIds = (evalCase.fixture.sheets ?? []).map((sheet) => sheet.id);
    for (const sheetId of expectedSheetIds) {
      if (!fixtureState.sheets?.some((sheet) => sheet.id === sheetId)) {
        throw new Error(`Fixture failed to load sheet "${sheetId}". Loaded sheets: ${JSON.stringify(fixtureState.sheets?.map((sheet) => sheet.id) ?? [])}`);
      }
    }
  }
  const beforeState = await evaluate(page, 'window.__sheetCanvasAgentEval.getCanvasState()');
  const timeoutMs = evalCase.timeoutMs ?? args.timeoutMs;
  await startPromptRun(page, evalCase.prompt, {
    resetConversation: evalCase.resetConversation !== false,
    timeoutMs,
  });
  const result = await waitForPromptRunResult(page, timeoutMs + 5000);
  const afterState = result.canvasState;
  const messages = result.messages ?? [];
  const evaluation = evaluateCaseExpectations({ evalCase, beforeState, afterState, messages, result });
  const log = {
    id: evalCase.id,
    prompt: evalCase.prompt,
    startedAt,
    completedAt: new Date().toISOString(),
    appUrl: args.appUrl,
    status: result.status,
    runError: result.error,
    evaluation,
    beforeState,
    afterState,
    messages: summarizeMessages(messages),
    rawMessages: args.includeRawMessages ? messages : undefined,
  };
  const path = runLogPath(evalCase, startedAt);
  writeFileSync(path, `${JSON.stringify(log, null, 2)}\n`);
  return { ...evaluation, logPath: path };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { cases, fullPath } = loadCases(args.casesPath);
  const chrome = args.browserWsUrl
    ? { browserWsUrl: args.browserWsUrl, close: async () => {} }
    : await launchChrome({ headless: args.headless });
  let page;
  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const results = [];

  try {
    page = await openPage(chrome.browserWsUrl, withAgentEvalParam(args.appUrl));
    await waitForEvalBridge(page, args.timeoutMs);
    await waitForCanvasReady(page, args.timeoutMs);
    for (const evalCase of cases) {
      console.log(`Running ${evalCase.id ?? evalCase.prompt}`);
      const result = await runCase({ page, evalCase, args, startedAt });
      results.push({ id: evalCase.id, ...result });
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${evalCase.id ?? evalCase.prompt} -> ${result.logPath}`);
      if (!result.passed) result.failures.forEach((failure) => console.log(`  - ${failure}`));
    }
  } finally {
    page?.close();
    await chrome.close();
  }

  const failed = results.filter((result) => !result.passed);
  console.log(`Agent eval complete: ${results.length - failed.length}/${results.length} passed (${fullPath}).`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
