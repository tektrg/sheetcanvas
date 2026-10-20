#!/usr/bin/env node
// Local stand-in for theindie-api (accounts) for dev/e2e: serves the in-memory
// fake from shared/theindieFake.ts over HTTP. Never use in production.
//   node scripts/theindie-stub.mjs --port 8791
// Point the app at it: VITE_THEINDIE_API_URL=http://127.0.0.1:8791 (frontend)
// and THEINDIE_API_URL=http://127.0.0.1:8791 (backend/.dev.vars or --var).
// Fake Google id tokens: "google:<sub>:<Display Name>".
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const portArg = process.argv.indexOf('--port');
const port = Number(portArg > -1 ? process.argv[portArg + 1] : 8791);
const entry = fileURLToPath(new URL('../shared/theindieFake.ts', import.meta.url));
const bundle = await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', write: false });
const { createFakeTheIndie } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const fake = createFakeTheIndie();

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { method: req.method, headers: req.headers, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
    const response = await fake.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    console.log(`${req.method} ${req.url} -> ${response.status}`);
  })
  .listen(port, '127.0.0.1', () => console.log(`theindie-api stub on http://127.0.0.1:${port}`));
