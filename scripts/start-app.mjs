#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, '..');
const backendDir = path.join(appDir, 'backend');

const frontend = {
  name: 'frontend',
  session: 'sheetcanvas-dev',
  cwd: appDir,
  port: 5173,
  url: 'http://127.0.0.1:5173/',
  command: 'npm run dev -- --host 127.0.0.1 --port 5173 --strictPort',
};

const backend = {
  name: 'backend',
  session: 'sheetcanvas-backend',
  cwd: backendDir,
  port: 8787,
  url: 'http://127.0.0.1:8787/',
  healthUrl: 'http://127.0.0.1:8787/health',
  command: 'npm run dev -- --config wrangler.toml --local --port 8787',
};

const services = [frontend, backend];
const args = new Set(process.argv.slice(2));
const shouldStop = args.has('--stop');
const shouldStatus = args.has('--status');
const keepExisting = args.has('--keep-existing');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: npm run start:app -- [--keep-existing|--status|--stop]\n\nStarts SheetCanvas deterministically in tmux:\n  frontend: ${frontend.session} on ${frontend.url}\n  backend:  ${backend.session} on ${backend.url}\n\nDefault behavior restarts the two SheetCanvas tmux sessions, waits for ports,\nand checks backend /health.\n\nOptions:\n  --keep-existing  Reuse already-running SheetCanvas tmux sessions when ports are healthy.\n  --status         Print session/port status without changing anything.\n  --stop           Stop the two SheetCanvas tmux sessions.\n`);
  process.exit(0);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
    cwd: options.cwd,
    env: options.env,
  });
}

function mustRun(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) {
    const details = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(`${command} ${args.join(' ')} failed${details ? `:\n${details}` : ''}`);
  }
  return result.stdout.trim();
}

function commandExists(command) {
  return run('which', [command], { stdio: 'ignore' }).status === 0;
}

function hasSession(session) {
  return run('tmux', ['has-session', '-t', session], { stdio: 'ignore' }).status === 0;
}

function killSession(session) {
  if (hasSession(session)) {
    console.log(`Stopping tmux session ${session}...`);
    mustRun('tmux', ['kill-session', '-t', session]);
  }
}

function portPids(port) {
  const result = run('lsof', [`-tiTCP:${port}`, '-sTCP:LISTEN', '-n', '-P']);
  if (result.status !== 0 || !result.stdout.trim()) return [];
  return result.stdout.trim().split('\n').filter(Boolean);
}

function portIsListening(port) {
  return portPids(port).length > 0;
}

function captureLogs(session) {
  if (!hasSession(session)) return '';
  const result = run('tmux', ['capture-pane', '-pt', `${session}:0.0`, '-S', '-120']);
  return result.stdout.trim();
}

function ensureNoUnknownPortOwner(service) {
  const pids = portPids(service.port);
  if (pids.length === 0) return;
  if (hasSession(service.session)) return;

  throw new Error(
    `${service.name} port ${service.port} is already occupied by PID(s) ${pids.join(', ')} ` +
      `but tmux session ${service.session} does not exist. Stop that process first; ` +
      'the startup script will not kill unknown processes.'
  );
}

function waitForPort(service, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (portIsListening(service.port)) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  }
  const logs = captureLogs(service.session);
  throw new Error(
    `${service.name} did not start listening on port ${service.port} within ${timeoutMs}ms.` +
      (logs ? `\n\nRecent ${service.session} logs:\n${logs}` : '')
  );
}

async function checkBackendHealth(timeoutMs = 30_000) {
  const start = Date.now();
  let lastError = '';
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(backend.healthUrl);
      if (response.ok) return;
      lastError = `${response.status} ${response.statusText}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const logs = captureLogs(backend.session);
  throw new Error(
    `Backend health check failed at ${backend.healthUrl}: ${lastError}` +
      (logs ? `\n\nRecent ${backend.session} logs:\n${logs}` : '')
  );
}

function startService(service) {
  console.log(`Starting ${service.name} in tmux session ${service.session}...`);
  mustRun('tmux', [
    'new-session',
    '-d',
    '-s',
    service.session,
    '-c',
    service.cwd,
    service.command,
  ]);
}

function printStatus() {
  for (const service of services) {
    const session = hasSession(service.session) ? 'tmux:running' : 'tmux:missing';
    const port = portIsListening(service.port) ? `port:${service.port}:listening` : `port:${service.port}:closed`;
    console.log(`${service.name.padEnd(8)} ${session.padEnd(14)} ${port} ${service.url}`);
  }
}

async function main() {
  if (!commandExists('tmux')) throw new Error('tmux is required but was not found in PATH.');
  if (!commandExists('lsof')) throw new Error('lsof is required but was not found in PATH.');

  if (shouldStatus) {
    printStatus();
    return;
  }

  if (shouldStop) {
    for (const service of services) killSession(service.session);
    printStatus();
    return;
  }

  for (const service of services) ensureNoUnknownPortOwner(service);

  for (const service of services) {
    if (keepExisting && hasSession(service.session) && portIsListening(service.port)) {
      console.log(`Keeping existing ${service.name} session ${service.session}.`);
      continue;
    }
    killSession(service.session);
    startService(service);
  }

  for (const service of services) waitForPort(service);
  await checkBackendHealth();

  console.log('\nSheetCanvas app is ready:');
  printStatus();
  console.log('\nUseful commands:');
  console.log(`  tmux capture-pane -pt ${frontend.session}:0.0 -S -120`);
  console.log(`  tmux capture-pane -pt ${backend.session}:0.0 -S -120`);
  console.log('  npm run start:app -- --stop');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
