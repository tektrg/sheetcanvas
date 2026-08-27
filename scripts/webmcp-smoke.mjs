// WebMCP verification harness — validates `document.modelContext` registration
// and execution behaviour for the 26 canvas tools (agent/tools.ts) exposed by
// src/agent/webmcp/*.
//
// FORKED from scripts/agent-eval.mjs: the Chrome-launch helpers, the raw-CDP
// `CdpClient` class, and the `Runtime.evaluate` plumbing live in
// ./webmcp-smoke-cdp.mjs (copied and adapted, not imported from
// agent-eval.mjs) so this stays a standalone, dependency-free smoke test. No
// Playwright, no new npm dependencies. Assertion logic and browser-side check
// functions live in ./webmcp-smoke-checks.mjs — split out to keep each file
// under this repo's ~700 LOC refactor trigger.
//
// ── Native-mode flag investigation (2026-08-27) ─────────────────────────────
// `document.modelContext` IS reachable on the locally installed **Google
// Chrome 151.0.7922.174 (stable channel)** using the launch flag
// `--enable-features=WebMCPTesting` — but ONLY when navigated to a real
// http(s) origin (this harness's `--app-url`, e.g. http://127.0.0.1:5173/).
// An initial probe against `about:blank` with the same flag (and every other
// candidate below) found nothing; re-testing the winning flag against the
// real app origin succeeded. Empirical conclusion: the feature is gated on a
// non-opaque origin (consistent with an origin-trial-shaped check), not on
// browser channel. The other candidates
// (`--enable-webmcp-testing`, `--enable-features=WebMCP`,
// `--enable-blink-features=ModelContext`, `--enable-blink-features=WebMCP`,
// `--enable-experimental-web-platform-features`,
// `--enable-features=WebMachineLearningModelContext`) did not work against
// the app origin either. All candidates are still tried, in order, at
// runtime against `--app-url` (see NATIVE_FLAG_CANDIDATES + detectNativeFlags
// below) — nothing is hardcoded to "always shim".
//
// Two more divergences from src/agent/webmcp/modelContext.ts's declared
// `ModelContextApi` interface were found empirically on this Chrome build
// (both plausibly early-origin-trial quirks, not final spec behaviour — but
// real, and this harness accommodates both rather than hiding them):
//   1. `executeTool()` rejects a bare tool-name string with `TypeError: ...
//      not of type 'RegisteredTool'`, even though the interface types the
//      first argument as `string | RegisteredToolHandle`. This harness
//      always resolves a `getTools()` handle first and calls
//      `executeTool(handle, input)` (see browserExecTool in
//      webmcp-smoke-checks.mjs).
//   2. `executeTool()` rejects a plain object `input` with `UnknownError:
//      Failed to parse input arguments` — it only accepts a JSON-STRINGIFIED
//      input, which it then parses internally before invoking the
//      registered tool's `execute(input, {signal})` with the parsed object
//      (confirmed: passing `JSON.stringify({})` to listSheets/listNotes
//      succeeds and the registered execute() sees a normal `{}`). This
//      harness JSON.stringifies `input` only in native mode — the shim
//      intentionally keeps the object-input contract modelContext.ts and
//      webmcpRegistry.ts are written against, so shim-mode assertions are
//      still testing OUR code's real contract, not this browser quirk.
// Neither of these is a defect in SheetCanvas: it currently only calls
// `registerTool`/`getTools`, never `executeTool`, so it never hits either
// divergence in production. Worth a heads-up if a future WebMCP consumer
// (ChatGPT's own browser integration) turns out to share this build's
// behaviour.
//
// A third finding, load-bearing for how this harness is structured (see
// settlePageAfterNavigate below): issuing ANY separate Node-side
// `Runtime.evaluate` round trip in the window right after `Page.navigate` —
// even one totally unrelated to the app, like `1+1` — permanently and
// silently breaks `document.modelContext` for the rest of that page's life.
// Root-caused via a dozen isolated trials; documented in full where it's
// actionable (settlePageAfterNavigate's comment).
//
// ── Two explicit modes ───────────────────────────────────────────────────
// native — real `document.modelContext` found after trying the candidate
//          launch flags. Exercises the browser's real implementation.
// shim   — a minimal, spec-faithful `document.modelContext` polyfill is
//          injected via CDP `Page.addScriptToEvaluateOnNewDocument` before
//          any app script runs. It still validates everything OUR code
//          controls: descriptor shape/budgets, additionalProperties
//          correctness, shaped-result budgets, reject-on-error, and
//          registration transitions. It does NOT validate the browser's own
//          WebMCP implementation (there is nothing to validate — it doesn't
//          exist on this machine).
//
// Never silently "passes green" when `document.modelContext` is absent: shim
// mode is loud about not being native (see printModeBanner), and
// `--require-native` makes shim mode a hard failure (see main()).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CdpClient,
  evaluate,
  findChromePath,
  httpOriginFromWebSocket,
  killStrayHarnessChromeProcesses,
  launchChrome,
  scaleTimeoutMs,
  waitForTargetWebSocket,
} from './webmcp-smoke-cdp.mjs';
import { makeAssertionTracker, runAssertions, runStaticSchemaAssertions } from './webmcp-smoke-checks.mjs';

const DEFAULT_APP_URL = 'http://127.0.0.1:5173/';
const RUNS_DIR = '.webmcp-smoke-runs';

// ── Defect-1 hardening: fail loudly, never leak a browser ───────────────────
// This is a VERIFICATION tool — a run that throws, hangs, or is interrupted
// must never look like success (exit 0) and must never leave an orphaned
// Chrome process behind. Every Chrome instance this process launches
// registers itself here so any exit path (normal, thrown, unhandled
// rejection, or SIGINT) can close it. `main()`'s own try/finally already
// closes the browser on the happy/thrown-inside-main path; this is the
// backstop for everything else (a floating promise rejecting outside any
// awaited chain, a synchronous throw in an event listener, Ctrl-C).
const activeChromeInstances = new Set();

function trackChrome(chrome) {
  activeChromeInstances.add(chrome);
  return chrome;
}

async function closeAllTrackedChrome() {
  const instances = Array.from(activeChromeInstances);
  activeChromeInstances.clear();
  await Promise.allSettled(instances.map((chrome) => chrome.close()));
}

let fatalHandlerFired = false;
async function failFatally(label, error, exitCode = 1) {
  // Guard against re-entrancy: an uncaughtException thrown while this
  // handler itself is closing Chrome must not recurse into another exit.
  if (fatalHandlerFired) return;
  fatalHandlerFired = true;
  console.error(`\n${label}:`, error instanceof Error ? error.stack || error.message : error);
  try {
    await closeAllTrackedChrome();
  } catch (cleanupError) {
    console.error('(additionally failed to clean up Chrome during fatal-error handling):', cleanupError);
  }
  process.exit(exitCode);
}

process.on('unhandledRejection', (reason) => {
  void failFatally('Unhandled promise rejection', reason);
});
process.on('uncaughtException', (error) => {
  void failFatally('Uncaught exception', error);
});
process.on('SIGINT', () => {
  void failFatally('Interrupted (SIGINT)', new Error('Received SIGINT — aborting run'), 130);
});

// Candidate launch-time flags for reaching a real `document.modelContext`.
// Tried in order against the resolved browser; see file-header comment for
// what was empirically found on this machine. The known-good flag from that
// investigation (`--enable-features=WebMCPTesting`) is tried FIRST so a
// normal run doesn't pay for a doomed Chrome launch+probe of
// `--enable-webmcp-testing` (confirmed not to work here) before reaching it;
// every other candidate stays, in the same relative order, as a fallback if
// a future Chrome build stops responding to the known-good flag.
const NATIVE_FLAG_CANDIDATES = [
  ['--enable-features=WebMCPTesting'],
  ['--enable-webmcp-testing'],
  ['--enable-features=WebMCP'],
  ['--enable-blink-features=ModelContext'],
  ['--enable-blink-features=WebMCP'],
  ['--enable-experimental-web-platform-features'],
  ['--enable-features=WebMachineLearningModelContext'],
];

// ── CLI args ─────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    appUrl: process.env.WEBMCP_SMOKE_APP_URL || DEFAULT_APP_URL,
    requireNative: false,
    timeoutMs: 30_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--app-url') args.appUrl = argv[++i];
    else if (arg === '--require-native') args.requireNative = true;
    else if (arg === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
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
  console.log(`Usage: npm run webmcp:smoke -- [options]

Options:
  --app-url <url>      Running SheetCanvas app URL. Default: ${DEFAULT_APP_URL}
  --require-native      Exit non-zero if a real document.modelContext could not
                         be reached (i.e. the run fell back to shim mode).
  --timeout-ms <ms>     Per-step timeout. Default: 30000

The dev server must already be running (npm run dev -- --host 127.0.0.1 --port
5173 --strictPort, in tmux). This harness only reads/curls it; it never starts
it for you.`);
}

// ── Preflight: dev server must already be up ────────────────────────────────

async function checkAppReachable(appUrl) {
  try {
    const response = await fetch(appUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `SheetCanvas dev server is not reachable at ${appUrl} (${reason}).\n` +
        `Start it first: tmux new -s sheetcanvas-dev-verify -d "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort", ` +
        `then re-run this script.`,
    );
  }
}

// ── Spec-faithful document.modelContext shim (shim mode only) ──────────────
// Injected verbatim via Page.addScriptToEvaluateOnNewDocument, so it exists
// before any app script (including React mount) runs. Mirrors
// src/agent/webmcp/modelContext.ts's declared shape.
const MODEL_CONTEXT_SHIM_SOURCE = `
(() => {
  if (typeof document.modelContext !== 'undefined') return; // never shadow a real implementation
  const NAME_RE = /^[A-Za-z0-9_.-]+$/;
  class ModelContextShim extends EventTarget {
    constructor() {
      super();
      this._tools = new Map();
    }
    registerTool(descriptor, options) {
      return new Promise((resolve, reject) => {
        const name = descriptor && descriptor.name;
        const description = descriptor && descriptor.description;
        const nameOk = typeof name === 'string' && name.length > 0 && name.length <= 128 && NAME_RE.test(name);
        const descOk = typeof description === 'string' && description.length > 0;
        if (!nameOk) { reject(new DOMException('Invalid tool name: ' + JSON.stringify(name), 'InvalidStateError')); return; }
        if (!descOk) { reject(new DOMException('Invalid or empty tool description for ' + name, 'InvalidStateError')); return; }
        if (this._tools.has(name)) { reject(new DOMException('Duplicate tool name: ' + name, 'InvalidStateError')); return; }
        this._tools.set(name, { descriptor });
        const signal = options && options.signal;
        if (signal) {
          if (signal.aborted) this._tools.delete(name);
          else signal.addEventListener('abort', () => { this._tools.delete(name); }, { once: true });
        }
        resolve(undefined);
      });
    }
    getTools(options) {
      const origin = window.location.origin;
      const fromOrigins = options && options.fromOrigins;
      const handles = Array.from(this._tools.values())
        .filter(() => !fromOrigins || fromOrigins.includes(origin))
        .map((entry) => ({
          name: entry.descriptor.name,
          title: entry.descriptor.title,
          description: entry.descriptor.description,
          inputSchema: entry.descriptor.inputSchema,
          window: null,
          origin,
          annotations: entry.descriptor.annotations,
        }));
      return Promise.resolve(handles);
    }
    executeTool(tool, input, options) {
      const name = typeof tool === 'string' ? tool : tool && tool.name;
      const entry = this._tools.get(name);
      if (!entry) return Promise.reject(new DOMException('Tool not found: ' + name, 'NotFoundError'));
      const signal = options && options.signal;
      return Promise.resolve()
        .then(() => entry.descriptor.execute(input, { signal }))
        .then((result) => {
          try { return JSON.stringify(result === undefined ? null : result); }
          catch (e) { return JSON.stringify({ _stringifyError: String(e) }); }
        });
      // Deliberately no .catch() here — a rejection from execute() must
      // propagate as a rejection from executeTool(), per spec.
    }
  }
  Object.defineProperty(document, 'modelContext', {
    value: new ModelContextShim(),
    configurable: true,
    writable: false,
  });
})();
`;

// ── Page open + console/exception capture ───────────────────────────────────

async function openPageAndNavigate(browserWsUrl, url, { injectShim, consoleSink }) {
  const origin = httpOriginFromWebSocket(browserWsUrl);
  const browser = await CdpClient.connect(browserWsUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  browser.close();
  const target = await waitForTargetWebSocket(origin, targetId, 5000);
  const page = await CdpClient.connect(target.webSocketDebuggerUrl);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Log.enable');

  if (consoleSink) attachConsoleCapture(page, consoleSink);
  if (injectShim) {
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: MODEL_CONTEXT_SHIM_SOURCE });
  }

  await page.send('Page.navigate', { url });
  await settlePageAfterNavigate();
  return page;
}

function attachConsoleCapture(page, sink) {
  page.on('Runtime.consoleAPICalled', (params) => {
    const text = (params.args || [])
      .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
      .join(' ');
    sink.push({ via: 'console', level: params.type, text, timestamp: params.timestamp });
  });
  page.on('Log.entryAdded', (params) => {
    const entry = params.entry || {};
    sink.push({ via: 'log', level: entry.level, text: entry.text, source: entry.source, timestamp: entry.timestamp });
  });
  page.on('Runtime.exceptionThrown', (params) => {
    const details = params.exceptionDetails || {};
    const text = details.exception?.description || details.text || 'Unhandled exception';
    sink.push({ via: 'exception', level: 'error', text, timestamp: params.timestamp });
  });
}

// Discovered empirically during harness development, reproduced 100% of the
// time across a dozen isolated trials: issuing ANY separate Node-side
// `Runtime.evaluate` round trip (even a single, trivial, self-contained one
// like `1+1`, and regardless of exact timing) in the window between
// `Page.navigate` and this page's first real interaction PERMANENTLY breaks
// `document.modelContext` for the rest of that page's life — it silently
// becomes `undefined`, with no console error, no exception, nothing in
// Runtime.exceptionThrown. A plain fixed settle delay with ZERO CDP traffic
// in that window never reproduces it; every "poll document.readyState via
// repeated/extra evaluate() calls" variant (the obvious, idiomatic way to
// write this wait) does, 100% of the time. This reads as a genuine
// Chrome/CDP-level race in this experimental origin-trial build (most likely
// an extra `Runtime.evaluate` racing the navigation-triggered execution
// context swap and binding the session to a stale/about:blank context) —
// not a SheetCanvas defect. Root-caused via a `1+1` no-op evaluate call
// reproducing it identically to a real readiness poll; documented here
// instead of a bug filed upstream since this Chrome build is a local
// origin-trial preview, not a stable release channel.
// Fix: do NOT evaluate anything here. A flat, generous, CDP-traffic-free
// delay is the only reliable way to let the page settle before the first
// real interaction (browserWaitForToolsStable / dynamic-import calls in
// webmcp-smoke-checks.mjs), which are themselves single evaluate() round
// trips that poll *inside* the browser rather than from Node — that pattern
// is safe.
const PAGE_SETTLE_MS = 4_000;
function settlePageAfterNavigate() {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, PAGE_SETTLE_MS));
}

// ── Native-mode flag detection ──────────────────────────────────────────────

async function detectNativeFlags(appUrl, timeoutMs) {
  const probeTimeoutMs = scaleTimeoutMs(5_000, timeoutMs);
  const attempts = [];
  for (const flags of NATIVE_FLAG_CANDIDATES) {
    let chrome;
    try {
      chrome = trackChrome(await launchChrome({ flags, headless: true }));
      const page = await openPageAndNavigate(chrome.browserWsUrl, appUrl, { injectShim: false, consoleSink: null });
      const hasNative = await evaluate(
        page,
        "typeof document.modelContext !== 'undefined' && typeof document.modelContext.registerTool === 'function'",
        probeTimeoutMs,
        `probing for native document.modelContext with flags ${JSON.stringify(flags)}`,
      ).catch(() => false);
      page.close();
      attempts.push({ flags, hasNative });
      if (hasNative) return { flags, attempts };
    } catch (error) {
      attempts.push({ flags, hasNative: false, error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (chrome) {
        await chrome.close();
        activeChromeInstances.delete(chrome);
      }
    }
  }
  return { flags: null, attempts };
}

// ── Reporting ────────────────────────────────────────────────────────────────

function printModeBanner(mode, requireNative, nativeAttempts, chromePath) {
  console.log(`\nResolved browser: ${chromePath}`);
  console.log(`Mode: ${mode.toUpperCase()}`);
  if (mode === 'native') {
    const winner = nativeAttempts.find((a) => a.hasNative);
    console.log(`  Reached real document.modelContext with flags: ${JSON.stringify(winner?.flags ?? [])}`);
  } else {
    console.log('  *** document.modelContext NOT reached natively on this browser. ***');
    console.log('  *** Falling back to a spec-faithful IN-PROCESS SHIM. Native browser behaviour is UNVERIFIED. ***');
    console.log(`  Tried ${nativeAttempts.length} candidate flag set(s), none exposed document.modelContext:`);
    for (const attempt of nativeAttempts) {
      console.log(`    - ${JSON.stringify(attempt.flags)}${attempt.error ? ` (error: ${attempt.error})` : ''}`);
    }
    if (requireNative) {
      console.log('  --require-native was passed: this run WILL fail regardless of assertion results.');
    }
  }
}

function printAssertionTable(results) {
  console.log('\nAssertion results:');
  const idWidth = Math.max(...results.map((r) => String(r.id).length), 2);
  // Recorded out of numeric order (behavioral assertions run on one page,
  // static schema checks on a separate one — see main()); sort for a
  // scannable 1..10,10b report regardless of execution order.
  const sorted = [...results].sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10) || String(a.id).localeCompare(String(b.id)));
  for (const r of sorted) {
    // A skipped assertion never ran its actual check (missing precondition,
    // e.g. an earlier step's sheet id) — reported distinctly from FAIL so it
    // isn't confused with an observed rejection, and distinctly from PASS so
    // it never silently green-lights an unproven claim (see
    // makeAssertionTracker's comment). Both SKIP and FAIL still make the
    // overall run non-zero — see main()'s failedAssertions.
    const status = r.skipped ? 'SKIP' : r.passed ? 'PASS' : 'FAIL';
    console.log(`  [${String(r.id).padEnd(idWidth)}] ${status}  ${r.label}`);
    console.log(`         ${r.detail}`);
  }
}

function writeRunLog({ startedAt, mode, requireNative, appUrl, chromePath, nativeAttempts, assertionResults, extra }) {
  mkdirSync(RUNS_DIR, { recursive: true });
  const path = join(RUNS_DIR, `${startedAt}.json`);
  const log = {
    startedAt,
    completedAt: new Date().toISOString(),
    appUrl,
    chromePath,
    mode,
    requireNative,
    nativeAttempts,
    assertionResults,
    extra,
  };
  writeFileSync(path, `${JSON.stringify(log, null, 2)}\n`);
  return path;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await checkAppReachable(args.appUrl);
  // Defect 1: a Chrome instance orphaned by a prior crashed/killed run must
  // never be left running into this one — clean up before launching.
  await killStrayHarnessChromeProcesses();

  const startedAt = new Date().toISOString().replace(/[:.]/g, '-');
  const { flags: nativeFlags, attempts: nativeAttempts } = await detectNativeFlags(args.appUrl, args.timeoutMs);
  const mode = nativeFlags ? 'native' : 'shim';
  const chromePath = findChromePath();

  printModeBanner(mode, args.requireNative, nativeAttempts, chromePath);

  const chrome = trackChrome(await launchChrome({ flags: nativeFlags ?? [], headless: true }));
  // Shared across both pages (not just the behavior page) so assertion 10b
  // ("zero InvalidStateError in console") actually covers the schema page's
  // console too — that page's own dynamic import of app source is
  // documented (runStaticSchemaAssertions' comment) to be able to corrupt
  // ITS OWN reconcile loop, which is exactly the kind of thing 10b exists to
  // catch.
  const consoleSink = [];
  let behaviorPage;
  let schemaPage;
  const tracker = makeAssertionTracker();
  let extra = null;
  let schemaExtra = null;

  try {
    // Two separate pages/targets on the same browser: the schema-check page's
    // dynamic imports of app source (see runStaticSchemaAssertions' comment
    // in webmcp-smoke-checks.mjs) must never share a page with the
    // behavioral/registration assertions. Schema page runs FIRST because it
    // also computes the gating-expectation table (a dynamic import of
    // webmcpToolGating.ts) that the behavior page's assertions 1 and 10
    // depend on — that import may only ever happen on this disposable page,
    // never the live one under test (same reasoning, see
    // webmcp-smoke-checks.mjs's top-of-file comment).
    schemaPage = await openPageAndNavigate(chrome.browserWsUrl, args.appUrl, { injectShim: mode === 'shim', consoleSink });
    schemaExtra = await runStaticSchemaAssertions(schemaPage, tracker, args.timeoutMs);

    behaviorPage = await openPageAndNavigate(chrome.browserWsUrl, args.appUrl, { injectShim: mode === 'shim', consoleSink });
    extra = await runAssertions(behaviorPage, tracker, consoleSink, mode, args.timeoutMs, schemaExtra.gatingTable);
  } finally {
    schemaPage?.close();
    behaviorPage?.close();
    await chrome.close();
    activeChromeInstances.delete(chrome);
  }

  printAssertionTable(tracker.results);

  const failedAssertions = tracker.results.filter((r) => !r.passed);
  const skippedAssertions = tracker.results.filter((r) => r.skipped);
  const nativeRequiredButShim = mode === 'shim' && args.requireNative;

  const logPath = writeRunLog({
    startedAt,
    mode,
    requireNative: args.requireNative,
    appUrl: args.appUrl,
    chromePath,
    nativeAttempts,
    assertionResults: tracker.results,
    extra: { ...extra, ...schemaExtra, nativeRequiredButShim },
  });
  console.log(`\nRun log: ${logPath}`);

  // A skipped assertion (see makeAssertionTracker) is already counted inside
  // failedAssertions (record() forces passed=false for it) — overallPass
  // never goes green while one exists, it just gets a clearer message here.
  const overallPass = failedAssertions.length === 0 && !nativeRequiredButShim;
  if (nativeRequiredButShim) {
    console.log(`\n--require-native was set but mode=shim (document.modelContext was not reachable). Failing regardless of assertion outcome.`);
  }
  console.log(
    `\nWEBMCP SMOKE: ${overallPass ? 'PASS' : 'FAIL'} (mode=${mode})${
      overallPass
        ? ''
        : ` — ${failedAssertions.length} of ${tracker.results.length} assertions failed${
            skippedAssertions.length ? ` (${skippedAssertions.length} of those skipped, not observed-failing)` : ''
          }${nativeRequiredButShim ? ' (+ --require-native unmet)' : ''}`
    }`,
  );
  process.exit(overallPass ? 0 : 1);
}

main().catch((error) => {
  void failFatally('Fatal error in main()', error);
});
