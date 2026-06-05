#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_GSC_REPORT_BIN = '/Users/trungluong/clawd/bin/gsc-report';
const GSC_REPORT_BIN = process.env.SHEETCANVAS_GSC_REPORT_BIN ?? DEFAULT_GSC_REPORT_BIN;
const DEFAULT_SITE_URL = 'sc-domain:sheetcanvas.com';
const DEFAULT_OUTPUT_DIR = 'reports/seo/search-console';

function hasOption(args, optionName) {
  return args.some((arg) => arg === optionName || arg.startsWith(`${optionName}=`));
}

function printOutput(output) {
  if (output.stdout) {
    process.stdout.write(output.stdout);
  }
  if (output.stderr) {
    process.stderr.write(output.stderr);
  }
}

function printKnownFailure(output) {
  const combinedOutput = `${output.stderr ?? ''}\n${output.stdout ?? ''}`;

  if (combinedOutput.includes('ENOTFOUND oauth2.googleapis.com')) {
    console.error([
      'Search Console report failed: cannot resolve oauth2.googleapis.com.',
      'Network or DNS access is required to refresh Google OAuth and pull SheetCanvas query/page evidence.',
      'Retry `npm run seo:gsc` from a network-enabled shell, or set SHEETCANVAS_GSC_VERBOSE=1 for the raw stack trace.',
    ].join('\n'));
    return true;
  }

  if (combinedOutput.includes('invalid_grant')) {
    console.error([
      'Search Console report failed: Google OAuth refresh was rejected.',
      'Reconnect or refresh the Search Console OAuth credentials in /Users/trungluong/clawd before using query/page evidence.',
      'Set SHEETCANVAS_GSC_VERBOSE=1 for the raw tool output.',
    ].join('\n'));
    return true;
  }

  return false;
}

const userArgs = process.argv.slice(2);

if (!existsSync(GSC_REPORT_BIN)) {
  console.error(`Search Console wrapper is missing: ${GSC_REPORT_BIN}`);
  process.exit(1);
}

const finalArgs = [...userArgs];

if (!hasOption(finalArgs, '--site-url')) {
  finalArgs.unshift('--site-url', DEFAULT_SITE_URL);
}

if (!hasOption(finalArgs, '--stdout-only') && !hasOption(finalArgs, '--output-dir')) {
  const outputDir = resolve(process.cwd(), DEFAULT_OUTPUT_DIR);
  mkdirSync(outputDir, { recursive: true });
  finalArgs.push('--output-dir', outputDir);
}

const result = spawnSync(GSC_REPORT_BIN, finalArgs, {
  cwd: process.cwd(),
  env: process.env,
  encoding: 'utf8',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

if ((result.status ?? 1) !== 0) {
  if (process.env.SHEETCANVAS_GSC_VERBOSE === '1' || !printKnownFailure(result)) {
    printOutput(result);
  }
  process.exit(result.status ?? 1);
}

printOutput(result);
process.exit(result.status ?? 1);
