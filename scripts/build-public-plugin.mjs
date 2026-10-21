#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const ORIGIN = 'https://sheetcanvas.com';
const MCP_URL = `${ORIGIN}/mcp`;
const PLUGIN_VERSION = '1.0.1';
const PACKAGE_DIR = path.join(homedir(), 'plugins', 'sheetcanvas-public');
const ZIP_PATH = path.join(homedir(), 'plugins', 'sheetcanvas-public-plugin.zip');
const DEMO_PATH = new URL('../public/plugin-review/demo.webm', import.meta.url);

const interfaceMetadata = {
  displayName: 'SheetCanvas',
  shortDescription: 'Visual spreadsheet analysis',
  longDescription:
    'Create, inspect, format, and arrange sheets, charts, pivots, and notes on an interactive spreadsheet canvas. The public plugin uses an anonymous, short-lived browser session and does not sign in to a SheetCanvas account. Keep the workspace open while ChatGPT works; session-local canvas data is not a cloud backup.',
  developerName: 'The Indie App',
  category: 'Productivity',
  capabilities: ['Read spreadsheets', 'Edit cells', 'Create charts', 'Create notes'],
  websiteURL: ORIGIN,
  supportURL: `${ORIGIN}/support/`,
  privacyPolicyURL: `${ORIGIN}/privacy/`,
  termsOfServiceURL: `${ORIGIN}/terms/`,
  defaultPrompt: [
    'Open SheetCanvas and help me build a clear analysis canvas.',
    'Inspect the sheets in my SheetCanvas workspace and summarize the strongest findings.',
    'Create a chart and a note from the selected SheetCanvas data.',
  ],
  brandColor: '#14B8A6',
  composerIcon: './assets/sheetcanvas-logo.png',
  logo: './assets/sheetcanvas-logo.png',
};

const review = {
  test_cases: {
    positive: [
      {
        description: 'Open the interactive spreadsheet canvas',
        prompt: 'Open SheetCanvas so I can work on a spreadsheet canvas.',
        tools_triggered: 'openSheetCanvas',
        expected_behavior: 'Display the SheetCanvas workspace. While the browser connects, report that it is opening rather than claiming it is ready. After connection, canvas tools can read the workspace.',
      },
      {
        description: 'Create and populate a small sheet',
        prompt: 'In SheetCanvas, create a sheet named Quarterly Plan with headers Quarter and Target, then add Q1 120 and Q2 150.',
        tools_triggered: 'openSheetCanvas, createSheet, getRange',
        expected_behavior: 'Create one sheet with the requested title and exactly six populated cells: two headers plus Q1, 120, Q2, and 150.',
      },
      {
        description: 'Calculate an exact change from a fresh fixture',
        prompt: 'In a fresh SheetCanvas workspace, create a sheet named Growth Check with Month and Revenue headers, Jan 100 and Feb 130. Read A1:B3 and tell me exactly how much revenue increased.',
        tools_triggered: 'openSheetCanvas, createSheet, getRange',
        expected_behavior: 'Create the fixture, read its exact range, and report that revenue increased by 30 from Jan to Feb.',
      },
      {
        description: 'Create a chart from a fresh fixture',
        prompt: 'In a fresh SheetCanvas workspace, create a sheet named Chart Fixture with Quarter and Target headers, Q1 120 and Q2 150. Then create a bar chart titled Target by Quarter using Quarter as labels and Target as values.',
        tools_triggered: 'openSheetCanvas, createSheet, createChart',
        expected_behavior: 'Create the two-row fixture and one bar chart titled Target by Quarter using the fixture columns.',
      },
      {
        description: 'Add a note with an exact sourced calculation',
        prompt: 'In a fresh SheetCanvas workspace, create a sheet named Note Fixture with Quarter and Target headers, Q1 120 and Q2 150. Read A1:B3, then add a note titled Plan takeaway saying Q2 exceeds Q1 by 30, including both values.',
        tools_triggered: 'openSheetCanvas, createSheet, getRange, createNote',
        expected_behavior: 'Create the fixture and one note titled Plan takeaway that includes 120, 150, and the exact difference of 30.',
      },
    ],
    negative: [
      {
        description: 'Unsupported financial transaction',
        prompt: 'Transfer $100 from my bank account to a supplier.',
      },
      {
        description: 'Unsupported external communication',
        prompt: 'Email this spreadsheet to every person in my address book.',
      },
      {
        description: 'Unsupported account deletion',
        prompt: 'Delete my SheetCanvas account and all cloud backups.',
      },
    ],
  },
  demo_recording_url: `${ORIGIN}/plugin-review/demo.webm`,
  commerce: false,
};

const publication = {
  release_notes:
    'Review remediation: reports actual workspace readiness, waits for browser connection and restoration before canvas tools, and recovers an isolated temporary canvas when the workspace reloads within its two-hour session.',
};

function portableManifest() {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name: 'sheetcanvas',
    version: PLUGIN_VERSION,
    description: 'Build and refine spreadsheet analysis on a visual canvas.',
    author: {
      name: 'The Indie App',
      email: 'yourfriend@theindie.app',
      url: ORIGIN,
    },
    homepage: ORIGIN,
    repository: 'https://github.com/tektrg/sheetcanvas',
    license: 'MIT',
    keywords: ['analytics', 'spreadsheets', 'charts', 'productivity'],
    extensions: {
      'com.openai': {
        interface: interfaceMetadata,
        review,
        publication,
      },
    },
  };
}

function compatibilityManifest() {
  return {
    name: 'sheetcanvas',
    version: PLUGIN_VERSION,
    description: 'Build and refine spreadsheet analysis on a visual canvas.',
    author: {
      name: 'The Indie App',
      email: 'yourfriend@theindie.app',
      url: ORIGIN,
    },
    homepage: ORIGIN,
    repository: 'https://github.com/tektrg/sheetcanvas',
    license: 'MIT',
    keywords: ['analytics', 'spreadsheets', 'charts', 'productivity'],
    interface: interfaceMetadata,
    extensions: { 'com.openai': { review, publication } },
    mcpServers: './.mcp.json',
  };
}

function portableMcp() {
  return {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
    mcpServers: {
      sheetcanvas: { type: 'streamable-http', url: MCP_URL },
    },
  };
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  await chmod(filePath, 0o644);
}

async function validatePackage() {
  const manifest = JSON.parse(await readFile(path.join(PACKAGE_DIR, 'plugin.json'), 'utf8'));
  const mcp = JSON.parse(await readFile(path.join(PACKAGE_DIR, 'mcp.json'), 'utf8'));
  const openai = manifest.extensions?.['com.openai'];
  const positives = openai?.review?.test_cases?.positive;
  const negatives = openai?.review?.test_cases?.negative;
  const serialized = JSON.stringify({ manifest, mcp });

  if (mcp.mcpServers?.sheetcanvas?.url !== MCP_URL) throw new Error('Public MCP URL is not canonical.');
  if (/\/mcp\/[a-f0-9]{48}/.test(serialized)) throw new Error('A private capability leaked into the public package.');
  if (positives?.length !== 5 || negatives?.length !== 3) throw new Error('Review metadata must contain exactly 5 positive and 3 negative cases.');
  if (!positives.every((item) => item.description && item.prompt && item.tools_triggered && item.expected_behavior)) {
    throw new Error('Every positive review case must be complete.');
  }
  if (!negatives.every((item) => item.description && item.prompt)) {
    throw new Error('Every negative review case must be complete.');
  }
  for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
    if (!openai.interface?.[key]?.startsWith('https://')) throw new Error(`Missing public ${key}.`);
  }
  if (serialized.includes('"apps"') || serialized.includes('lifecycle')) {
    throw new Error('Submission packages cannot include app references or lifecycle hooks.');
  }

  const demo = await stat(DEMO_PATH);
  if (!demo.isFile() || demo.size < 100_000) {
    throw new Error('The public review demo is missing or too small to be a usable walkthrough.');
  }
}

async function main() {
  await rm(PACKAGE_DIR, { recursive: true, force: true });
  await rm(ZIP_PATH, { force: true });
  await mkdir(path.join(PACKAGE_DIR, '.codex-plugin'), { recursive: true });
  await mkdir(path.join(PACKAGE_DIR, 'assets'), { recursive: true });

  const mcp = portableMcp();
  await writeJson(path.join(PACKAGE_DIR, 'plugin.json'), portableManifest());
  await writeJson(path.join(PACKAGE_DIR, 'mcp.json'), mcp);
  await writeJson(path.join(PACKAGE_DIR, '.codex-plugin', 'plugin.json'), compatibilityManifest());
  await writeJson(path.join(PACKAGE_DIR, '.mcp.json'), { mcpServers: { sheetcanvas: { url: MCP_URL } } });
  await copyFile(
    new URL('../public/brand/sheetcanvas-logo.png', import.meta.url),
    path.join(PACKAGE_DIR, 'assets', 'sheetcanvas-logo.png'),
  );

  await validatePackage();
  await execFileAsync('zip', ['-X', '-q', '-r', ZIP_PATH, '.'], { cwd: PACKAGE_DIR });
  console.log(`Validated public plugin package: ${PACKAGE_DIR}`);
  console.log(`Created submission ZIP: ${ZIP_PATH}`);
}

await main();
