import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

const SHEETCANVAS_ORIGIN = 'https://sheetcanvas.com';
const TOKEN_PATTERN = /^[a-f0-9]{48}$/;
const pluginDirectory = path.join(homedir(), 'plugins', 'sheetcanvas');
const clientIdPath = path.join(pluginDirectory, '.client-id');

async function readOrCreateClientId() {
  try {
    const existing = (await readFile(clientIdPath, 'utf8')).trim();
    if (existing) return existing;
  } catch {
    // First setup on this machine.
  }

  const clientId = randomUUID();
  await writeFile(clientIdPath, `${clientId}\n`, { mode: 0o600 });
  return clientId;
}

async function mintPersonalMcpUrl(clientId) {
  const response = await fetch(`${SHEETCANVAS_ORIGIN}/api/mcp/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ clientId }),
  });
  if (!response.ok) throw new Error(`SheetCanvas token setup failed (${response.status})`);

  const payload = await response.json();
  const token = typeof payload?.token === 'string' ? payload.token : '';
  const mcpUrl = typeof payload?.mcpUrl === 'string' ? payload.mcpUrl : '';
  if (!TOKEN_PATTERN.test(token) || mcpUrl !== `${SHEETCANVAS_ORIGIN}/mcp/${token}`) {
    throw new Error('SheetCanvas returned an invalid MCP endpoint');
  }
  return mcpUrl;
}

function compatibilityManifest() {
  return {
    name: 'sheetcanvas',
    version: '0.1.0',
    description: 'Build and refine spreadsheet analysis on a visual canvas.',
    author: {
      name: 'The Indie App',
      url: SHEETCANVAS_ORIGIN,
    },
    homepage: SHEETCANVAS_ORIGIN,
    repository: 'https://github.com/tektrg/sheetcanvas',
    license: 'MIT',
    interface: {
      displayName: 'SheetCanvas',
      shortDescription: 'Visual spreadsheet analysis',
      longDescription:
        'Create, inspect, format, and arrange sheets, charts, pivots, and live notes on an interactive analysis canvas.',
      developerName: 'The Indie App',
      category: 'Productivity',
      capabilities: ['Read', 'Write'],
      defaultPrompt: 'Open SheetCanvas and help me turn my data into a clear analysis canvas.',
      brandColor: '#14B8A6',
      composerIcon: './assets/sheetcanvas-logo.png',
      logo: './assets/sheetcanvas-logo.png',
    },
    mcpServers: './.mcp.json',
  };
}

function portableManifest() {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'sheetcanvas',
    version: '0.1.0',
    description: 'Build and refine spreadsheet analysis on a visual canvas.',
    author: {
      name: 'The Indie App',
      url: SHEETCANVAS_ORIGIN,
    },
    homepage: SHEETCANVAS_ORIGIN,
    repository: 'https://github.com/tektrg/sheetcanvas',
    license: 'MIT',
    keywords: ['analytics', 'spreadsheets', 'charts', 'productivity'],
    extensions: {
      'com.openai': {
        interface: {
          displayName: 'SheetCanvas',
          shortDescription: 'Visual spreadsheet analysis',
          longDescription:
            'Create, inspect, format, and arrange sheets, charts, pivots, and live notes on an interactive analysis canvas.',
          developerName: 'The Indie App',
          category: 'Productivity',
          capabilities: ['Read', 'Write'],
          websiteURL: SHEETCANVAS_ORIGIN,
          privacyPolicyURL: `${SHEETCANVAS_ORIGIN}/privacy/`,
          termsOfServiceURL: `${SHEETCANVAS_ORIGIN}/terms/`,
          defaultPrompt: [
            'Open SheetCanvas and help me turn this CSV into a clear analysis canvas.',
            'Inspect my SheetCanvas workspace and summarize the most important trends.',
            'Create a chart and a live report note from the selected SheetCanvas data.',
          ],
          brandColor: '#14B8A6',
          composerIcon: './assets/sheetcanvas-logo.png',
          logo: './assets/sheetcanvas-logo.png',
        },
      },
    },
  };
}

async function writeJson(filePath, value, mode = 0o644) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode });
  await chmod(filePath, mode);
}

async function main() {
  await mkdir(path.join(pluginDirectory, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(pluginDirectory, 'assets'), { recursive: true });

  const clientId = await readOrCreateClientId();
  const mcpUrl = await mintPersonalMcpUrl(clientId);
  const portableMcp = {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      sheetcanvas: {
        type: 'streamable-http',
        url: mcpUrl,
      },
    },
  };
  const compatibilityMcp = {
    mcpServers: {
      sheetcanvas: {
        url: mcpUrl,
      },
    },
  };

  await writeJson(path.join(pluginDirectory, 'plugin.json'), portableManifest());
  await writeJson(path.join(pluginDirectory, 'mcp.json'), portableMcp, 0o600);
  await writeJson(
    path.join(pluginDirectory, '.codex-plugin', 'plugin.json'),
    compatibilityManifest(),
  );
  await writeJson(path.join(pluginDirectory, '.mcp.json'), compatibilityMcp, 0o600);
  await copyFile(
    new URL('../public/brand/sheetcanvas-logo.png', import.meta.url),
    path.join(pluginDirectory, 'assets', 'sheetcanvas-logo.png'),
  );

  console.log(`SheetCanvas plugin package updated at ${pluginDirectory}`);
  console.log('The token-bound MCP URL was written with owner-only permissions and was not printed.');
}

await main();
