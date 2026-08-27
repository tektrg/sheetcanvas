// Raw Chrome DevTools Protocol (CDP) helpers for scripts/webmcp-smoke.mjs.
//
// FORKED from scripts/agent-eval.mjs: the Chrome-launch helpers, the raw-CDP
// `CdpClient` class, and the `Runtime.evaluate` plumbing are copied and
// adapted here (not imported) so webmcp-smoke stays a standalone,
// dependency-free smoke test. No Playwright, no new npm dependencies.
// Extended with CdpClient event dispatch (`.on(method, cb)`), needed to
// capture console/exception traffic for the "zero InvalidStateError"
// assertion — agent-eval.mjs's CdpClient only handles id-keyed responses.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import http from 'node:http';

// ── Browser resolution — Chrome/Chromium ONLY, never Edge ──────────────────
// scripts/agent-eval.mjs prefers Microsoft Edge first. For a WebMCP check
// that is a trap (launching Edge when the point is to test Chrome's
// document.modelContext) — this harness deliberately excludes Edge entirely.

export function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].filter(Boolean);
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      'Could not find Chrome/Chromium (Edge is deliberately not a candidate for a WebMCP check). ' +
        'Set CHROME_PATH to a Chrome/Chromium/Chrome Canary executable.',
    );
  }
  return found;
}

// ── Chrome process lifecycle (forked from scripts/agent-eval.mjs) ──────────

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

// Shared between launchChrome's mkdtempSync call and
// killStrayHarnessChromeProcesses's pkill pattern — one source of truth so
// the two can never drift apart.
export const USER_DATA_DIR_PREFIX = 'sheetcanvas-webmcp-smoke-';

// Best-effort: a Chrome process left over from a prior run that crashed or
// was killed before its own cleanup ran (e.g. this harness itself got
// SIGKILLed, or a SIGINT landed between launch and the try/finally taking
// effect) holds a --user-data-dir under our tmp-dir prefix forever — wasted
// memory, and it can squat a debugging port a later run picks. Call this
// before every Chrome launch so a prior failure never leaks a browser into
// the next run (Defect 1: verification tooling must never leave stray state
// behind that could mask or confuse a later result).
export async function killStrayHarnessChromeProcesses() {
  return new Promise((resolvePromise) => {
    const cleanup = spawn('sh', ['-c', `pkill -f '${USER_DATA_DIR_PREFIX}' || true`], { stdio: 'ignore' });
    cleanup.once('exit', resolvePromise);
    cleanup.once('error', resolvePromise);
  });
}

// Wires `--timeout-ms` through to every timeout site in this harness: each
// call site's previously-hardcoded constant (tuned against a 30_000ms
// baseline) scales proportionally with the CLI flag instead of being dead
// weight. `--timeout-ms 30000` (the default) reproduces the original
// hardcoded values exactly.
export function scaleTimeoutMs(baselineMs, requestedTotalMs, referenceMs = 30_000) {
  return Math.max(1000, Math.round((baselineMs * requestedTotalMs) / referenceMs));
}

export async function launchChrome({ flags = [], headless = true }) {
  const userDataDir = mkdtempSync(join(tmpdir(), USER_DATA_DIR_PREFIX));
  const debuggingPort = await findFreePort();
  const chromePath = findChromePath();
  const chrome = spawn(
    chromePath,
    [
      `--user-data-dir=${userDataDir}`,
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${debuggingPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-sync',
      '--disable-extensions',
      headless ? '--headless=new' : '',
      ...flags,
      'about:blank',
    ].filter(Boolean),
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

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
    chromePath,
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
      // May have exited between the timeout and SIGKILL.
    }
  }
  await killChromeUserDataDir(userDataDir);
  // Give the OS a moment to release the profile dir's file handles before rmSync.
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
}

async function killChromeUserDataDir(userDataDir) {
  const escaped = userDataDir.replace(/'/g, "'\\''");
  await new Promise((resolvePromise) => {
    const cleanup = spawn('sh', ['-c', `pkill -f '${escaped}' || true`], { stdio: 'ignore' });
    cleanup.once('exit', resolvePromise);
    cleanup.once('error', resolvePromise);
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

export function requestJson(url, { method = 'GET', timeoutMs = 1000 } = {}) {
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
    request.on('timeout', () => request.destroy(new Error(`HTTP request timed out after ${timeoutMs}ms: ${url}`)));
    request.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

// ── Raw CDP over WebSocket (forked from scripts/agent-eval.mjs, + events) ──

// Default bound for any raw CDP `send()` call that doesn't pass its own
// timeoutMs. Before this, only `Runtime.evaluate` (via evaluate() below) was
// ever bounded — `Page.enable`/`Target.createTarget`/`Page.navigate`/etc.
// could hang the whole run indefinitely on a wedged session with no
// diagnosis and no non-zero exit (Defect 1: a hang that never times out is
// as bad as a false PASS — it just fails silently instead of loudly).
const DEFAULT_SEND_TIMEOUT_MS = 15_000;

export class CdpClient {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.eventListeners = new Map();
    this.closed = false;
    // A mid-run socket close/error (crashed renderer, killed Chrome process,
    // an HMR-triggered navigation that tears down the session) previously
    // left any in-flight `send()` promise permanently unsettled — a silent
    // hang no `Runtime.evaluate`-specific timeout could catch because the
    // hang was in a DIFFERENT pending call. Reject everything outstanding
    // immediately instead. Defined before the listeners below (also used to
    // fail loudly on a malformed frame, rather than throwing inside an event
    // listener where the failure mode is implementation-dependent).
    const rejectAllPending = (error) => {
      this.closed = true;
      for (const callbacks of this.pending.values()) callbacks.reject(error);
      this.pending.clear();
    };
    webSocket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch (error) {
        rejectAllPending(new Error(`Failed to parse CDP message: ${error instanceof Error ? error.message : error}`));
        return;
      }
      if (message.id) {
        const callbacks = this.pending.get(message.id);
        if (!callbacks) return;
        this.pending.delete(message.id);
        if (message.error) callbacks.reject(new Error(message.error.message));
        else callbacks.resolve(message.result);
        return;
      }
      if (message.method) {
        const listeners = this.eventListeners.get(message.method);
        if (listeners) listeners.forEach((cb) => cb(message.params));
      }
    });
    webSocket.addEventListener('close', () => rejectAllPending(new Error('CDP WebSocket closed while request(s) were pending')));
    webSocket.addEventListener('error', (event) => rejectAllPending(new Error(`CDP WebSocket error while request(s) were pending: ${event?.message || event}`)));
  }

  static connect(wsUrl) {
    if (typeof WebSocket !== 'function') {
      throw new Error('This Node runtime does not provide global WebSocket. Use Node 22+.');
    }
    return new Promise((resolvePromise, reject) => {
      const webSocket = new WebSocket(wsUrl);
      const connectTimer = setTimeout(() => {
        try {
          webSocket.close();
        } catch {
          // best effort
        }
        reject(new Error(`Timed out connecting to CDP WebSocket: ${wsUrl}`));
      }, DEFAULT_SEND_TIMEOUT_MS);
      webSocket.addEventListener('open', () => {
        clearTimeout(connectTimer);
        resolvePromise(new CdpClient(webSocket));
      });
      webSocket.addEventListener('error', (event) => {
        clearTimeout(connectTimer);
        reject(new Error(`CDP WebSocket connection failed: ${event?.message || event}`));
      });
    });
  }

  send(method, params = {}, timeoutMs = DEFAULT_SEND_TIMEOUT_MS) {
    if (this.closed) {
      return Promise.reject(new Error(`CDP ${method} rejected: WebSocket is already closed`));
    }
    const id = this.nextId++;
    this.webSocket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, reject) => {
      const timer = timeoutMs > 0
        ? setTimeout(() => {
            this.pending.delete(id);
            reject(new Error(`CDP ${method} (id=${id}) timed out after ${timeoutMs}ms with no response`));
          }, timeoutMs)
        : null;
      this.pending.set(id, {
        resolve: (value) => {
          if (timer) clearTimeout(timer);
          resolvePromise(value);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      });
    });
  }

  on(method, cb) {
    if (!this.eventListeners.has(method)) this.eventListeners.set(method, new Set());
    this.eventListeners.get(method).add(cb);
    return () => this.eventListeners.get(method)?.delete(cb);
  }

  close() {
    try {
      this.webSocket.close();
    } catch {
      // Already closed/closing — nothing further to do.
    }
  }
}

// Bounded retries for a genuinely observed failure mode: Vite HMR (or any
// other same-target navigation) can destroy the page's execution context
// while a `Runtime.evaluate` is in flight. When that happens Chrome does not
// reliably send an error response for the orphaned call — it can just never
// answer, which is indistinguishable from a slow page until whatever
// timeout is set finally fires (this is the root cause behind the
// `Runtime.evaluate timed out after 20000ms` failure this harness was
// originally built to explain, not a case for "raise the timeout").
// Listening for `Runtime.executionContextDestroyed` lets us notice the
// teardown immediately and retry a fresh evaluate in the new context,
// instead of waiting out the full budget for a call that can never resolve.
const MAX_CONTEXT_DESTROYED_RETRIES = 2;

/**
 * Evaluates `expression` in `page` and returns its resolved value.
 * `timeoutMs` bounds the ENTIRE call, including any context-destroyed
 * retries — a retry consumes the remaining budget, it never extends it, so
 * this still fails loudly within `timeoutMs` rather than silently doubling
 * the wait. `label` (a short human-readable description of what this
 * evaluate is waiting for, e.g. "waiting for document.modelContext tool
 * list to stabilize") is folded into any thrown error so a timeout or
 * context-destroyed failure says what it was doing, not just where.
 */
export async function evaluate(page, expression, timeoutMs = 30_000, label = null) {
  const what = label ? ` — waiting for: ${label}` : '';
  const deadline = Date.now() + timeoutMs;
  let destroyedRetries = 0;

  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Runtime.evaluate timed out after ${timeoutMs}ms${what}` +
          (destroyedRetries > 0 ? ` (execution context was destroyed and retried ${destroyedRetries} time(s) mid-run — likely a page reload/HMR racing this evaluate)` : ''),
      );
    }

    let contextDestroyedReject;
    const contextDestroyed = new Promise((_, reject) => {
      contextDestroyedReject = () =>
        reject(Object.assign(new Error('Execution context destroyed'), { code: 'CONTEXT_DESTROYED' }));
    });
    const unsubscribe = page.on('Runtime.executionContextDestroyed', () => contextDestroyedReject());

    let result;
    try {
      result = await Promise.race([
        page.send(
          'Runtime.evaluate',
          { expression, awaitPromise: true, returnByValue: true, userGesture: true },
          remaining,
        ),
        contextDestroyed,
        new Promise((_, reject) => {
          setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), remaining);
        }),
      ]);
    } catch (error) {
      if (error && error.code === 'CONTEXT_DESTROYED' && destroyedRetries < MAX_CONTEXT_DESTROYED_RETRIES) {
        destroyedRetries += 1;
        continue; // Retry in the new execution context, consuming the same budget.
      }
      if (error && error.code === 'TIMEOUT') {
        throw new Error(`Runtime.evaluate timed out after ${timeoutMs}ms${what}`);
      }
      throw error instanceof Error ? new Error(`${error.message}${what}`) : error;
    } finally {
      unsubscribe();
    }

    if (result.exceptionDetails) {
      const description = result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed';
      throw new Error(`${description}${what}`);
    }
    return result.result?.value;
  }
}

/** Serializes `fn` (via `.toString()`) plus JSON-serializable `args` into an
 * immediately-invoked expression string suitable for `evaluate()`. `fn` runs
 * inside the browser page, not in this Node process. */
export function pageFunctionCall(fn, ...args) {
  return `(${fn})(...${JSON.stringify(args)})`;
}

export function httpOriginFromWebSocket(wsUrl) {
  const url = new URL(wsUrl);
  return `http://${url.host}`;
}

export async function waitForTargetWebSocket(origin, targetId, timeoutMs) {
  const startedAt = Date.now();
  let lastError = '';
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const targets = await requestJson(`${origin}/json/list`, { timeoutMs: 1000 });
      const target = Array.isArray(targets) ? targets.find((candidate) => candidate.id === targetId) : null;
      if (target?.webSocketDebuggerUrl) return target;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out resolving Chrome target ${targetId}. ${lastError}`);
}
