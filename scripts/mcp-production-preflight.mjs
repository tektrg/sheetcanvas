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
const REQUEST_TIMEOUT_MS = 15000;
const WRANGLER_TIMEOUT_MS = 45000;

const requiredRoutePatterns = [
  'sheetcanvas.com/api/*',
  'pattern = "sheetcanvas.com/mcp"',
  'sheetcanvas.com/mcp/*',
  'www.sheetcanvas.com/api/*',
  'pattern = "www.sheetcanvas.com/mcp"',
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
    } else if (!connectAgent.text.includes('Connect your agent to a canvas for business data.')) {
      recordFailure('/connect-agent/ is live but does not contain the agent-canvas headline.');
    } else {
      recordPass('/connect-agent/ contains the agent-canvas headline.');
    }
  } catch (error) {
    recordFailure(`/connect-agent/ fetch failed: ${error.message}`);
  }

  try {
    const support = await fetchText('/support/');
    if (!support.response.ok) {
      recordFailure(`/support/ returned HTTP ${support.response.status}.`);
    } else if (!support.text.includes('Help with SheetCanvas')) {
      recordFailure('/support/ is live but does not contain the public support heading.');
    } else {
      recordPass('/support/ contains the public support heading.');
    }
  } catch (error) {
    recordFailure(`/support/ fetch failed: ${error.message}`);
  }

  try {
    const sitemap = await fetchText('/sitemap.xml');
    if (!sitemap.response.ok) {
      recordFailure(`/sitemap.xml returned HTTP ${sitemap.response.status}.`);
    } else if (!sitemap.text.includes('/connect-agent/') || !sitemap.text.includes('/support/')) {
      recordFailure('/sitemap.xml does not include /connect-agent/ and /support/.');
    } else {
      recordPass('/sitemap.xml includes /connect-agent/ and /support/.');
    }
  } catch (error) {
    recordFailure(`/sitemap.xml fetch failed: ${error.message}`);
  }

  try {
    const llms = await fetchText('/llms.txt');
    if (!llms.response.ok) {
      recordFailure(`/llms.txt returned HTTP ${llms.response.status}.`);
    } else if (!llms.text.includes('/connect-agent/') || !llms.text.includes('/support/')) {
      recordFailure('/llms.txt does not include /connect-agent/ and /support/.');
    } else {
      recordPass('/llms.txt includes /connect-agent/ and /support/.');
    }
  } catch (error) {
    recordFailure(`/llms.txt fetch failed: ${error.message}`);
  }

  for (const [pathname, marker] of [
    ['/privacy/', 'Privacy notes for the SheetCanvas app.'],
    ['/terms/', 'Terms for using SheetCanvas.'],
  ]) {
    try {
      const page = await fetchText(pathname);
      if (!page.response.ok || !page.text.includes(marker)) {
        recordFailure(`${pathname} is missing or does not contain ${marker}.`);
      } else {
        recordPass(`${pathname} is live.`);
      }
    } catch (error) {
      recordFailure(`${pathname} fetch failed: ${error.message}`);
    }
  }

  try {
    const demo = await fetchText('/plugin-review/demo.webm');
    const contentType = demo.response.headers.get('content-type') ?? '';
    if (!demo.response.ok || !contentType.includes('video/webm') || demo.text.length < 100_000) {
      recordFailure('/plugin-review/demo.webm is missing or is not a usable WebM video.');
    } else {
      recordPass('/plugin-review/demo.webm is live as a WebM video.');
    }
  } catch (error) {
    recordFailure(`/plugin-review/demo.webm fetch failed: ${error.message}`);
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
    const initialized = await fetchText('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'sheetcanvas-preflight', version: '1.0.0' },
        },
      }),
    });
    const session = initialized.response.headers.get('mcp-session-id') ?? '';
    if (!initialized.response.ok) {
      recordFailure(`/mcp initialize returned HTTP ${initialized.response.status}.`);
    } else if (!/^p_[a-f0-9]{64}$/.test(session)) {
      recordFailure('/mcp initialize did not return a valid short-lived Mcp-Session-Id.');
    } else if (initialized.response.headers.get('cache-control') !== 'no-store') {
      recordFailure('/mcp initialize is missing Cache-Control: no-store.');
    } else {
      recordPass('/mcp public initialize returns an isolated no-store session.');

      const rpc = async (id, method, params) => {
        const result = await fetchText('/mcp', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Mcp-Session-Id': session,
          },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }),
        });
        return { ...result, body: JSON.parse(result.text) };
      };

      const tools = await rpc(2, 'tools/list');
      const toolNames = tools.body?.result?.tools?.map((tool) => tool.name) ?? [];
      if (!tools.response.ok || !toolNames.includes('openSheetCanvas')) {
        recordFailure('/mcp tools/list did not expose the public launcher.');
      } else if (PUBLIC_BLOCKED_CONNECTOR_TOOLS.some((name) => toolNames.includes(name))) {
        recordFailure('/mcp tools/list exposed connector access to an anonymous session.');
      } else {
        recordPass('/mcp tools/list exposes canvas tools without connector access.');
      }

      for (const blockedTool of PUBLIC_BLOCKED_CONNECTOR_TOOLS) {
        const blocked = await rpc(20 + PUBLIC_BLOCKED_CONNECTOR_TOOLS.indexOf(blockedTool), 'tools/call', {
          name: blockedTool,
          arguments: {},
        });
        if (!blocked.body?.error?.message?.includes('unavailable in anonymous sessions')) {
          recordFailure(`/mcp direct call did not block anonymous connector tool ${blockedTool}.`);
        }
      }
      if (!failures.some((failure) => failure.includes('anonymous connector tool'))) {
        recordPass('/mcp direct calls reject every anonymous connector tool.');
      }

      const opened = await rpc(3, 'tools/call', {
        name: 'openSheetCanvas',
        arguments: {},
      });
      if (
        opened.body?.result?.structuredContent?.ready !== false ||
        opened.body?.result?._meta?.bridgeSession !== session ||
        'bridgeSession' in (opened.body?.result?.structuredContent ?? {})
      ) {
        recordFailure('/mcp launcher falsely reported readiness or failed widget-only session isolation.');
      } else {
        recordPass('/mcp launcher reports opening until connected and keeps the session in widget-only metadata.');
      }

      const resourceUri = 'ui://sheetcanvas/workspace-public-v1.html';
      const resource = await rpc(4, 'resources/read', { uri: resourceUri });
      const resourceBody = resource.body?.result?.contents?.[0];
      if (
        resourceBody?.uri !== resourceUri ||
        resourceBody?.mimeType !== 'text/html;profile=mcp-app' ||
        resourceBody?.text?.includes(session)
      ) {
        recordFailure('/mcp public app resource is missing, malformed, or contains its session.');
      } else {
        recordPass('/mcp public app resource is cache-safe.');
      }

      const terminated = await fetchText('/mcp', {
        method: 'DELETE',
        headers: { 'Mcp-Session-Id': session },
      });
      if (terminated.response.status !== 204) {
        recordFailure(`/mcp session termination returned HTTP ${terminated.response.status}.`);
      } else {
        recordPass('/mcp session termination returned HTTP 204.');
      }
    }
  } catch (error) {
    recordFailure(`/mcp public initialize failed: ${error.message}`);
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
