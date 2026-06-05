#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = process.cwd();
const WRAPPER_PATH = join(PROJECT_ROOT, 'scripts', 'search-console-report.mjs');
const DEFAULT_SITE_URL = 'sc-domain:sheetcanvas.com';

function fail(message) {
  console.error(`Search Console report smoke failed: ${message}`);
  process.exit(1);
}

function createStubReporter(tempDir) {
  const capturePath = join(tempDir, 'capture.json');
  const stubPath = join(tempDir, 'gsc-report-stub.mjs');
  writeFileSync(stubPath, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(capturePath)}, JSON.stringify({
  argv: process.argv.slice(2),
  cwd: process.cwd()
}, null, 2));
`);
  chmodSync(stubPath, 0o755);
  return { capturePath, stubPath };
}

function createNetworkFailureReporter(tempDir) {
  const stubPath = join(tempDir, 'gsc-report-network-failure-stub.mjs');
  writeFileSync(stubPath, `#!/usr/bin/env node
console.error('TypeError: fetch failed');
console.error('getaddrinfo ENOTFOUND oauth2.googleapis.com');
process.exit(1);
`);
  chmodSync(stubPath, 0o755);
  return stubPath;
}

function createOAuthFailureReporter(tempDir) {
  const stubPath = join(tempDir, 'gsc-report-oauth-failure-stub.mjs');
  writeFileSync(stubPath, `#!/usr/bin/env node
console.error('Error: invalid_grant');
console.error('Token has been expired or revoked.');
process.exit(1);
`);
  chmodSync(stubPath, 0o755);
  return stubPath;
}

function runWrapper({ args, capturePath, stubPath }) {
  const result = spawnSync(process.execPath, [WRAPPER_PATH, ...args], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SHEETCANVAS_GSC_REPORT_BIN: stubPath,
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    fail(`wrapper exited with ${result.status} for args ${args.join(' ')}.\n${result.stderr || result.stdout}`);
  }

  return JSON.parse(readFileSync(capturePath, 'utf8'));
}

function runFailingWrapper({ args, env = {}, stubPath }) {
  return spawnSync(process.execPath, [WRAPPER_PATH, ...args], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      SHEETCANVAS_GSC_REPORT_BIN: stubPath,
      SHEETCANVAS_GSC_VERBOSE: '',
      ...env,
    },
    encoding: 'utf8',
  });
}

function optionValue(args, optionName) {
  const exactIndex = args.indexOf(optionName);
  if (exactIndex !== -1) {
    return args[exactIndex + 1] ?? '';
  }

  const inline = args.find((arg) => arg.startsWith(`${optionName}=`));
  return inline?.slice(optionName.length + 1) ?? '';
}

function assertDefaultSite(args, scenario) {
  if (optionValue(args, '--site-url') !== DEFAULT_SITE_URL) {
    fail(`${scenario} did not add the default SheetCanvas Search Console property.`);
  }
}

function assertNoOption(args, optionName, scenario) {
  if (args.some((arg) => arg === optionName || arg.startsWith(`${optionName}=`))) {
    fail(`${scenario} unexpectedly included ${optionName}.`);
  }
}

const tempDir = mkdtempSync(join(tmpdir(), 'sheetcanvas-gsc-smoke-'));

try {
  const { capturePath, stubPath } = createStubReporter(tempDir);
  const networkFailureStubPath = createNetworkFailureReporter(tempDir);
  const oauthFailureStubPath = createOAuthFailureReporter(tempDir);

  const stdoutOnlyRun = runWrapper({
    args: ['--stdout-only', '--days', '7'],
    capturePath,
    stubPath,
  });
  assertDefaultSite(stdoutOnlyRun.argv, '--stdout-only run');
  assertNoOption(stdoutOnlyRun.argv, '--output-dir', '--stdout-only run');
  if (optionValue(stdoutOnlyRun.argv, '--days') !== '7') {
    fail('--stdout-only run did not preserve user-supplied --days.');
  }

  const customSiteRun = runWrapper({
    args: ['--site-url=sc-domain:example.com', '--stdout-only'],
    capturePath,
    stubPath,
  });
  if (optionValue(customSiteRun.argv, '--site-url') !== 'sc-domain:example.com') {
    fail('custom site run did not preserve user-supplied --site-url.');
  }

  const customOutputDir = join(tempDir, 'custom-output');
  const customOutputRun = runWrapper({
    args: ['--output-dir', customOutputDir],
    capturePath,
    stubPath,
  });
  assertDefaultSite(customOutputRun.argv, 'custom output-dir run');
  if (optionValue(customOutputRun.argv, '--output-dir') !== customOutputDir) {
    fail('custom output-dir run did not preserve the user-supplied output directory.');
  }

  const defaultOutputRun = runWrapper({
    args: [],
    capturePath,
    stubPath,
  });
  assertDefaultSite(defaultOutputRun.argv, 'default output run');
  const defaultOutputDir = optionValue(defaultOutputRun.argv, '--output-dir');
  if (!defaultOutputDir.endsWith('/reports/seo/search-console')) {
    fail(`default output run used the wrong report directory: ${defaultOutputDir || 'nothing'}.`);
  }

  const networkFailureRun = runFailingWrapper({
    args: ['--stdout-only'],
    stubPath: networkFailureStubPath,
  });
  if (networkFailureRun.status !== 1) {
    fail(`network failure run exited with ${networkFailureRun.status}, expected 1.`);
  }
  if (
    !networkFailureRun.stderr.includes('Search Console report failed: cannot resolve oauth2.googleapis.com.')
    || !networkFailureRun.stderr.includes('Retry `npm run seo:gsc` from a network-enabled shell')
  ) {
    fail(`network failure run did not print the actionable diagnostic.\n${networkFailureRun.stderr}`);
  }
  if (networkFailureRun.stderr.includes('TypeError: fetch failed')) {
    fail('network failure run leaked the raw stack-style output without verbose mode.');
  }

  const networkFailureVerboseRun = runFailingWrapper({
    args: ['--stdout-only'],
    env: { SHEETCANVAS_GSC_VERBOSE: '1' },
    stubPath: networkFailureStubPath,
  });
  if (
    networkFailureVerboseRun.status !== 1
    || !networkFailureVerboseRun.stderr.includes('TypeError: fetch failed')
    || !networkFailureVerboseRun.stderr.includes('getaddrinfo ENOTFOUND oauth2.googleapis.com')
  ) {
    fail(`verbose network failure run did not preserve raw reporter output.\n${networkFailureVerboseRun.stderr}`);
  }

  const oauthFailureRun = runFailingWrapper({
    args: ['--stdout-only'],
    stubPath: oauthFailureStubPath,
  });
  if (oauthFailureRun.status !== 1) {
    fail(`OAuth failure run exited with ${oauthFailureRun.status}, expected 1.`);
  }
  if (
    !oauthFailureRun.stderr.includes('Search Console report failed: Google OAuth refresh was rejected.')
    || !oauthFailureRun.stderr.includes('Reconnect or refresh the Search Console OAuth credentials')
  ) {
    fail(`OAuth failure run did not print the actionable diagnostic.\n${oauthFailureRun.stderr}`);
  }
  if (oauthFailureRun.stderr.includes('Token has been expired or revoked.')) {
    fail('OAuth failure run leaked raw reporter output without verbose mode.');
  }

  console.log('Search Console report smoke passed.');
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
