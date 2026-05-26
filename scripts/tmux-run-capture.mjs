#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const DEFAULT_CAPTURE_LINES = 5000;
const DEFAULT_RETAIN_SECONDS = 60;
const DEFAULT_TIMEOUT_SECONDS = 3600;

function printUsage() {
  console.error(`Usage:
  node scripts/tmux-run-capture.mjs <name> [--keep] [--lines <n>] [--retain-seconds <n>] [--timeout-seconds <n>] -- <command...>

Examples:
  npm run tmux:capture -- build -- npm run build
  npm run tmux:capture -- status -- git status --short
  npm run tmux:capture -- logs --keep -- tmux capture-pane -pt sheetcanvas_bottom_sheet_dev -S -200
`);
}

function runTmux(args, options = {}) {
  return spawnSync('tmux', args, {
    encoding: 'utf8',
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function parsePositiveInteger(value, optionName) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`${optionName} must be a positive integer.`);
  }
  return parsed;
}

function parseArgs(argv) {
  const separatorIndex = argv.indexOf('--');
  if (separatorIndex < 1 || separatorIndex === argv.length - 1) {
    printUsage();
    process.exit(2);
  }

  const [rawName, ...optionArgs] = argv.slice(0, separatorIndex);
  const commandArgs = argv.slice(separatorIndex + 1);
  const options = {
    captureLines: DEFAULT_CAPTURE_LINES,
    keep: false,
    retainSeconds: DEFAULT_RETAIN_SECONDS,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
  };

  for (let index = 0; index < optionArgs.length; index += 1) {
    const option = optionArgs[index];
    if (option === '--keep') {
      options.keep = true;
      continue;
    }
    if (option === '--lines') {
      index += 1;
      options.captureLines = parsePositiveInteger(optionArgs[index], '--lines');
      continue;
    }
    if (option === '--retain-seconds') {
      index += 1;
      options.retainSeconds = parsePositiveInteger(optionArgs[index], '--retain-seconds');
      continue;
    }
    if (option === '--timeout-seconds') {
      index += 1;
      options.timeoutSeconds = parsePositiveInteger(optionArgs[index], '--timeout-seconds');
      continue;
    }
    throw new Error(`Unknown option: ${option}`);
  }

  return { commandArgs, rawName, options };
}

function sessionNameFor(rawName) {
  const safeName = rawName.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40) || 'task';
  return `${safeName}_${Date.now()}`;
}

function readExitStatus(capturedOutput) {
  const match = capturedOutput.match(/__EXIT_STATUS__=(\d+)/);
  return match ? Number.parseInt(match[1], 10) : 1;
}

function fail(message, exitCode = 1) {
  console.error(message);
  process.exit(exitCode);
}

function removeFileIfPresent(filePath) {
  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch {
    // Best effort cleanup only.
  }
}

let parsed;
try {
  parsed = parseArgs(process.argv.slice(2));
} catch (error) {
  fail(error.message, 2);
}

const { commandArgs, rawName, options } = parsed;
const sessionName = sessionNameFor(rawName);
const statusFilePath = join(tmpdir(), `${sessionName}.status`);
const scriptFilePath = join(tmpdir(), `${sessionName}.sh`);
const command = commandArgs.map(shellQuote).join(' ');

writeFileSync(
  scriptFilePath,
  `#!/usr/bin/env sh
${command}
status=$?
echo
echo "__EXIT_STATUS__=$status"
printf '%s' "$status" > ${shellQuote(statusFilePath)}
sleep ${options.retainSeconds}
exit "$status"
`,
);
chmodSync(scriptFilePath, 0o700);

const createResult = runTmux(['new-session', '-d', '-s', sessionName, `sh ${shellQuote(scriptFilePath)}`]);
if (createResult.status !== 0) {
  removeFileIfPresent(scriptFilePath);
  fail(createResult.stderr || createResult.stdout || 'Failed to create tmux session.');
}

const waitStartedAtMs = Date.now();
while (!existsSync(statusFilePath)) {
  const sessionCheck = runTmux(['has-session', '-t', sessionName]);
  if (sessionCheck.status !== 0) {
    removeFileIfPresent(scriptFilePath);
    fail(`tmux session ${sessionName} exited before writing its status file.`);
  }
  if (Date.now() - waitStartedAtMs > options.timeoutSeconds * 1000) {
    runTmux(['kill-session', '-t', sessionName]);
    removeFileIfPresent(scriptFilePath);
    removeFileIfPresent(statusFilePath);
    fail(`Timed out waiting for tmux session ${sessionName} to finish.`);
  }
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}

const captureResult = runTmux(['capture-pane', '-pt', sessionName, '-S', `-${options.captureLines}`]);
const capturedOutput = captureResult.stdout ?? '';
process.stdout.write(capturedOutput);

let exitStatus = readExitStatus(capturedOutput);
try {
  exitStatus = Number.parseInt(readFileSync(statusFilePath, 'utf8'), 10);
} catch {
  // Fall back to the printed marker in the captured pane.
}
removeFileIfPresent(statusFilePath);
removeFileIfPresent(scriptFilePath);

if (!options.keep) {
  const killResult = runTmux(['kill-session', '-t', sessionName]);
  if (killResult.status !== 0) {
    console.error(killResult.stderr || killResult.stdout || `Failed to kill tmux session ${sessionName}.`);
  }
} else {
  console.error(`Kept tmux session: ${sessionName}`);
}

process.exit(exitStatus);
