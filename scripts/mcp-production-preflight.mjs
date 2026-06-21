#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const SITE_ORIGIN = process.env.SHEETCANVAS_MCP_PREFLIGHT_ORIGIN || 'https://sheetcanvas.com';
const WRANGLER_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'wrangler');
const WRANGLER_CONFIG = join(PROJECT_ROOT, 'backend', 'wrangler.toml');
const ZERO_D1_DATABASE_ID = '00000000-0000-0000-0000-000000000000';
const MCP_TEST_TOKEN = '0'.repeat(48);
const REQUEST_TIMEOUT_MS = 15000;
const WRANGLER_TIMEOUT_MS = 45000;

const requiredRoutePatterns = [
  'sheetcanvas.com/api/*',
  'sheetcanvas.com/mcp/*',
  'www.sheetcanvas.com/api/*',
  'www.sheetcanvas.com/mcp/*',
];

const failures = [];
const warnings = [];

function recordPass(message) {
  console.log(`PASS ${message}`);
}

function recordFailure(message) {
  failures.push(message);
  console.error(`FAIL ${message}`);
}

function recordWarning(message) {
  warnings.push(message);
  console.warn(`WARN ${message}`);
}

function runCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: PROJECT_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
    timeout: options.timeoutMs ?? WRANGLER_TIMEOUT_MS,
  });
}

function summarizeCommandResult(result, timeoutMs = WRANGLER_TIMEOUT_MS) {
  if (result.error?.code === 'ETIMEDOUT') {
    return `timed out after ${timeoutMs}ms`;
  }

  const output = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  return output.split('\n').slice(-8).join('\n') || `exit status ${result.status}`;
}

async function fetchText(pathname, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${SITE_ORIGIN}${pathname}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text().catch(() => '');
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

function checkWorkerConfig() {
  if (!existsSync(WRANGLER_CONFIG)) {
    recordFailure(`Missing Worker config at ${WRANGLER_CONFIG}`);
    return;
  }

  const config = readFileSync(WRANGLER_CONFIG, 'utf8');

  if (config.includes(ZERO_D1_DATABASE_ID)) {
    recordFailure('backend/wrangler.toml still uses the placeholder D1 database_id.');
  } else {
    recordPass('backend/wrangler.toml has a non-placeholder D1 database_id.');
  }

  for (const routePattern of requiredRoutePatterns) {
    if (config.includes(routePattern)) {
      recordPass(`Worker route configured: ${routePattern}`);
    } else {
      recordFailure(`Missing Worker route in backend/wrangler.toml: ${routePattern}`);
    }
  }
}

function checkWranglerAuth() {
  if (process.env.SHEETCANVAS_MCP_PREFLIGHT_SKIP_WRANGLER_AUTH === '1') {
    recordWarning('Skipping Wrangler auth check because SHEETCANVAS_MCP_PREFLIGHT_SKIP_WRANGLER_AUTH=1.');
    return;
  }

  const hasApiToken = Boolean(process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN);
  if (hasApiToken) {
    recordPass('Cloudflare API token env var is present.');
    return;
  }

  if (!existsSync(WRANGLER_BIN)) {
    recordFailure('Wrangler is not installed at node_modules/.bin/wrangler.');
    return;
  }

  const whoamiTimeoutMs = 10000;
  const whoami = runCommand(WRANGLER_BIN, ['whoami'], { timeoutMs: whoamiTimeoutMs });
  if (whoami.status === 0) {
    recordPass('wrangler whoami completed without an API token env var.');
    return;
  }

  recordFailure(`wrangler whoami did not complete successfully: ${summarizeCommandResult(whoami, whoamiTimeoutMs)}`);
}

function checkWorkerDryRun() {
  if (process.env.SHEETCANVAS_MCP_PREFLIGHT_SKIP_WRANGLER_DRY_RUN === '1') {
    recordWarning('Skipping Worker dry-run because SHEETCANVAS_MCP_PREFLIGHT_SKIP_WRANGLER_DRY_RUN=1.');
    return;
  }

  if (process.env.SHEETCANVAS_MCP_PREFLIGHT_RUN_WRANGLER_DRY_RUN !== '1') {
    recordWarning('Skipping Worker dry-run by default; set SHEETCANVAS_MCP_PREFLIGHT_RUN_WRANGLER_DRY_RUN=1 to include it.');
    return;
  }

  if (!existsSync(WRANGLER_BIN)) {
    recordFailure('Cannot dry-run Worker deploy because Wrangler is missing.');
    return;
  }

  const outDir = mkdtempSync(join(tmpdir(), 'sheetcanvas-mcp-worker-dry-run-'));
  try {
    const dryRun = runCommand(
      WRANGLER_BIN,
      ['deploy', '--config', WRANGLER_CONFIG, '--dry-run', '--outdir', outDir],
      { timeoutMs: WRANGLER_TIMEOUT_MS },
    );

    if (dryRun.status === 0) {
      recordPass('Wrangler Worker dry-run completed.');
    } else {
      recordFailure(`Wrangler Worker dry-run failed: ${summarizeCommandResult(dryRun)}`);
    }
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
}

async function checkLiveStaticSurfaces() {
  try {
    const connectAgent = await fetchText('/connect-agent/');
    if (!connectAgent.response.ok) {
      recordFailure(`/connect-agent/ returned HTTP ${connectAgent.response.status}.`);
    } else if (!connectAgent.text.includes('Turn massive data into durable')) {
      recordFailure('/connect-agent/ is live but does not contain the MCP-first durable-insights headline.');
    } else {
      recordPass('/connect-agent/ contains the MCP-first durable-insights headline.');
    }
  } catch (error) {
    recordFailure(`/connect-agent/ fetch failed: ${error.message}`);
  }

  try {
    const sitemap = await fetchText('/sitemap.xml');
    if (!sitemap.response.ok) {
      recordFailure(`/sitemap.xml returned HTTP ${sitemap.response.status}.`);
    } else if (!sitemap.text.includes('/connect-agent/')) {
      recordFailure('/sitemap.xml does not include /connect-agent/.');
    } else {
      recordPass('/sitemap.xml includes /connect-agent/.');
    }
  } catch (error) {
    recordFailure(`/sitemap.xml fetch failed: ${error.message}`);
  }

  try {
    const llms = await fetchText('/llms.txt');
    if (!llms.response.ok) {
      recordFailure(`/llms.txt returned HTTP ${llms.response.status}.`);
    } else if (!llms.text.includes('/connect-agent/')) {
      recordFailure('/llms.txt does not include /connect-agent/.');
    } else {
      recordPass('/llms.txt includes /connect-agent/.');
    }
  } catch (error) {
    recordFailure(`/llms.txt fetch failed: ${error.message}`);
  }
}

async function checkLiveMcpRoutes() {
  try {
    const tokenResponse = await fetchText('/api/mcp/token', { method: 'POST' });
    if (tokenResponse.response.status === 405 || tokenResponse.response.status === 404) {
      recordFailure(`/api/mcp/token returned HTTP ${tokenResponse.response.status}; production is not routing /api/* to the Worker.`);
    } else {
      recordPass(`/api/mcp/token is handled by production with HTTP ${tokenResponse.response.status}.`);
    }
  } catch (error) {
    recordFailure(`/api/mcp/token fetch failed: ${error.message}`);
  }

  try {
    const mcpResponse = await fetchText(`/mcp/${MCP_TEST_TOKEN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
    });

    if (mcpResponse.response.status === 405 || mcpResponse.response.status === 404) {
      recordFailure(`/mcp/<token> returned HTTP ${mcpResponse.response.status}; production is not routing /mcp/* to the Worker.`);
    } else {
      recordPass(`/mcp/<token> is handled by production with HTTP ${mcpResponse.response.status}.`);
    }
  } catch (error) {
    recordFailure(`/mcp/<token> fetch failed: ${error.message}`);
  }
}

async function main() {
  console.log(`SheetCanvas MCP production preflight: ${SITE_ORIGIN}`);

  checkWorkerConfig();
  checkWranglerAuth();
  checkWorkerDryRun();
  await checkLiveStaticSurfaces();
  await checkLiveMcpRoutes();

  if (warnings.length > 0) {
    console.warn(`\nWarnings: ${warnings.length}`);
  }

  if (failures.length > 0) {
    console.error(`\nMCP production preflight failed with ${failures.length} issue(s):`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('\nMCP production preflight passed.');
}

await main();
