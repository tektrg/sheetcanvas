#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

const OVERRIDE_ENV = 'SHEETCANVAS_ALLOW_APP_DIRTY_DEPLOY';

const BLOCKED_PATH_PREFIXES = [
  'agent/',
  'backend/',
  'components/',
  'hooks/',
  'public/landing-page-design/',
  'src/',
  'utils/',
  'workers/',
];

const BLOCKED_PATHS = new Set([
  'App.tsx',
  'constants.ts',
  'index.html',
  'index.tsx',
  'metadata.json',
  'store.ts',
  'theme.ts',
  'tsconfig.json',
  'types.ts',
  'vite.config.ts',
]);

function parseStatusPaths(statusLine) {
  const rawPath = statusLine.slice(3).trim();
  return rawPath
    .split(' -> ')
    .map((filePath) => filePath.replace(/^"|"$/g, ''));
}

function isBlockedRuntimePath(filePath) {
  return BLOCKED_PATHS.has(filePath)
    || BLOCKED_PATH_PREFIXES.some((prefix) => filePath.startsWith(prefix));
}

if (process.env[OVERRIDE_ENV] === '1') {
  console.warn(`${OVERRIDE_ENV}=1 set; skipping app/backend dirty deploy preflight.`);
  process.exit(0);
}

const status = spawnSync('git', ['status', '--porcelain'], {
  cwd: process.cwd(),
  encoding: 'utf8',
});

if (status.error) {
  console.error(`Deploy preflight failed to run git status: ${status.error.message}`);
  process.exit(1);
}

if (status.status !== 0) {
  process.stderr.write(status.stderr);
  process.exit(status.status ?? 1);
}

const dirtyRuntimePaths = status.stdout
  .split('\n')
  .filter(Boolean)
  .flatMap(parseStatusPaths)
  .filter(isBlockedRuntimePath);

if (dirtyRuntimePaths.length > 0) {
  console.error([
    'Deploy preflight failed: app/backend runtime files are dirty.',
    'Split or finish unrelated app work before publishing SEO-only changes, or set SHEETCANVAS_ALLOW_APP_DIRTY_DEPLOY=1 when the deploy intentionally includes those changes.',
    '',
    ...dirtyRuntimePaths.map((filePath) => `- ${filePath}`),
  ].join('\n'));
  process.exit(1);
}

console.log('Deploy preflight passed: no dirty app/backend runtime files detected.');
