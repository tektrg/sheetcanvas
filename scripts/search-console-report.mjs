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
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
