import { spawn } from 'node:child_process';
import process from 'node:process';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function spawnProcess(command, args, env) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    env,
  });
  child.on('exit', (code, signal) => {
    if (signal) return;
    if (code && code !== 0) process.exitCode = code;
  });
  return child;
}

const children = [];
function shutdown(signal) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

children.push(spawnProcess(npmCmd, ['run', 'dev'], process.env));

children.push(
  spawnProcess(
    npmCmd,
    ['--prefix', 'backend', 'run', 'dev', '--', '--config', 'wrangler.toml', '--local', '--port', '8787'],
    {
      ...process.env,
      HOME: `${process.cwd()}/backend/.home`,
      WRANGLER_LOG_PATH: `${process.cwd()}/backend/.wrangler-logs`,
      WRANGLER_LOG: 'info',
    }
  )
);
