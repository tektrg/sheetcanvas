#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROJECT_ROOT = process.cwd();
const PREFLIGHT_PATH = join(PROJECT_ROOT, 'scripts', 'seo-deploy-preflight.mjs');

function fail(message) {
  console.error(`Deploy preflight smoke failed: ${message}`);
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed.\n${result.stderr || result.stdout}`);
  }
}

function runPreflight(cwd, env = {}) {
  return spawnSync(process.execPath, [PREFLIGHT_PATH], {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: 'utf8',
  });
}

function writeFixture(repoDir, filePath, contents) {
  const absolutePath = join(repoDir, filePath);
  mkdirSync(join(absolutePath, '..'), { recursive: true });
  writeFileSync(absolutePath, contents);
}

const tempDir = mkdtempSync(join(tmpdir(), 'sheetcanvas-deploy-preflight-'));

try {
  run('git', ['init'], tempDir);
  run('git', ['config', 'user.email', 'seo-smoke@sheetcanvas.local'], tempDir);
  run('git', ['config', 'user.name', 'SheetCanvas SEO Smoke'], tempDir);

  writeFixture(tempDir, 'src/runtime.ts', 'export const runtime = true;\n');
  writeFixture(tempDir, 'index.html', '<!doctype html><title>SheetCanvas</title>\n');
  writeFixture(tempDir, 'public/docs/index.html', '<!doctype html><title>Docs</title>\n');
  writeFixture(tempDir, 'public/landing-page-design/onboarding.jsx', 'export const step = 1;\n');
  run('git', ['add', '.'], tempDir);
  run('git', ['commit', '-m', 'fixture'], tempDir);

  writeFixture(tempDir, 'public/docs/index.html', '<!doctype html><title>Docs updated</title>\n');
  const publicOnlyRun = runPreflight(tempDir);
  if (publicOnlyRun.status !== 0) {
    fail(`public-only dirty page should pass.\n${publicOnlyRun.stderr || publicOnlyRun.stdout}`);
  }

  writeFixture(tempDir, 'src/runtime.ts', 'export const runtime = false;\n');
  const runtimeDirtyRun = runPreflight(tempDir);
  if (runtimeDirtyRun.status !== 1 || !runtimeDirtyRun.stderr.includes('- src/runtime.ts')) {
    fail(`dirty runtime file should fail and list src/runtime.ts.\n${runtimeDirtyRun.stderr || runtimeDirtyRun.stdout}`);
  }

  run('git', ['checkout', '--', 'src/runtime.ts', 'public/docs/index.html'], tempDir);
  writeFixture(tempDir, 'index.html', '<!doctype html><title>Changed root</title>\n');
  const rootShellDirtyRun = runPreflight(tempDir);
  if (rootShellDirtyRun.status !== 1 || !rootShellDirtyRun.stderr.includes('- index.html')) {
    fail(`dirty root app shell should fail and list index.html.\n${rootShellDirtyRun.stderr || rootShellDirtyRun.stdout}`);
  }

  run('git', ['checkout', '--', 'index.html'], tempDir);
  run('git', ['mv', 'src/runtime.ts', 'public/runtime.ts'], tempDir);
  const runtimeRenameRun = runPreflight(tempDir);
  if (runtimeRenameRun.status !== 1 || !runtimeRenameRun.stderr.includes('- src/runtime.ts')) {
    fail(`runtime-to-public rename should fail and list the runtime source path.\n${runtimeRenameRun.stderr || runtimeRenameRun.stdout}`);
  }

  run('git', ['mv', 'public/runtime.ts', 'src/runtime.ts'], tempDir);
  writeFixture(tempDir, 'public/landing-page-design/onboarding.jsx', 'export const step = 2;\n');
  const onboardingDirtyRun = runPreflight(tempDir);
  if (
    onboardingDirtyRun.status !== 1
    || !onboardingDirtyRun.stderr.includes('- public/landing-page-design/onboarding.jsx')
  ) {
    fail(`dirty app-owned public onboarding asset should fail.\n${onboardingDirtyRun.stderr || onboardingDirtyRun.stdout}`);
  }

  const overrideRun = runPreflight(tempDir, { SHEETCANVAS_ALLOW_APP_DIRTY_DEPLOY: '1' });
  if (overrideRun.status !== 0) {
    fail(`override should allow an intentional dirty runtime deploy.\n${overrideRun.stderr || overrideRun.stdout}`);
  }

  console.log('Deploy preflight smoke passed.');
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
