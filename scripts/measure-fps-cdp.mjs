#!/usr/bin/env node
import http from 'node:http';
import process from 'node:process';

const args = new Map(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.split('=');
    return [key, rest.join('=') || 'true'];
  }),
);

const cdpPort = Number(args.get('--cdp-port') || 9228);
const urlIncludes = args.get('--url-includes') || '127.0.0.1:5173';
const outputJson = args.has('--json');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getJson = (path) => new Promise((resolve, reject) => {
  http.get({ hostname: '127.0.0.1', port: cdpPort, path }, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error(body || error.message));
      }
    });
  }).on('error', reject);
});

const connectCdp = async (webSocketDebuggerUrl) => {
  const ws = new WebSocket(webSocketDebuggerUrl);
  const callbacks = new Map();
  let nextId = 1;

  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !callbacks.has(message.id)) return;

    const { resolve, reject } = callbacks.get(message.id);
    callbacks.delete(message.id);

    if (message.error) {
      reject(new Error(JSON.stringify(message.error)));
    } else {
      resolve(message.result);
    }
  });

  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId;
    nextId += 1;
    callbacks.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

  const evaluate = async (expression, awaitPromise = true) => {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(JSON.stringify(result.exceptionDetails));
    }
    return result.result.value;
  };

  return { ws, send, evaluate };
};

const waitForFpsLogger = (evaluate) => evaluate(`
  new Promise((resolve) => {
    const startedAt = performance.now();
    const check = () => {
      if (window.__sheetcanvasFps || performance.now() - startedAt > 8000) {
        resolve(Boolean(window.__sheetcanvasFps));
        return;
      }
      requestAnimationFrame(check);
    };
    check();
  })
`);

const snapshot = async (evaluate, label) => {
  await sleep(2200);
  return evaluate(`
    (() => {
      const metrics = window.__sheetcanvasFps || null;
      const overlay = document.querySelector('[data-sheetcanvas-fps-overlay]')?.textContent || null;
      return {
        label: ${JSON.stringify(label)},
        metrics,
        overlay,
        location: location.href,
      };
    })()
  `);
};

const main = async () => {
  const targets = await getJson('/json/list');
  const page = targets.find((target) => target.type === 'page' && target.url.includes(urlIncludes))
    || targets.find((target) => target.type === 'page');

  if (!page) {
    throw new Error(`No page target found on CDP port ${cdpPort}`);
  }

  const { ws, send, evaluate } = await connectCdp(page.webSocketDebuggerUrl);
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Input.setIgnoreInputEvents', { ignore: false });

  const loggerReady = await waitForFpsLogger(evaluate);
  const samples = [];
  samples.push(await snapshot(evaluate, loggerReady ? 'idle' : 'idle_no_logger'));

  for (let i = 0; i < 18; i += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: 700,
      y: 500,
      deltaX: -36,
      deltaY: 24,
      modifiers: 0,
    });
    await sleep(35);
  }
  samples.push(await snapshot(evaluate, 'wheel_pan'));

  await send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 700,
    y: 500,
    button: 'left',
    buttons: 1,
    clickCount: 1,
  });
  for (let i = 0; i < 24; i += 1) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 700 + i * 10,
      y: 500 + i * 4,
      button: 'left',
      buttons: 1,
    });
    await sleep(25);
  }
  await send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 940,
    y: 596,
    button: 'left',
    buttons: 0,
    clickCount: 1,
  });
  samples.push(await snapshot(evaluate, 'drag_canvas'));

  const pageInfo = await evaluate(`
    (() => {
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        documentReady: document.readyState,
        nodeCounts: {
          sheets: document.querySelectorAll('[id^="sheet-"]').length,
          charts: document.querySelectorAll('[id^="chart-"]').length,
          notes: document.querySelectorAll('[id^="note-"]').length,
          svg: document.querySelectorAll('svg').length,
        },
        navigation: nav ? {
          domContentLoaded: nav.domContentLoadedEventEnd,
          load: nav.loadEventEnd,
          duration: nav.duration,
        } : null,
      };
    })()
  `);

  ws.close();

  const result = {
    page: {
      url: page.url,
      title: page.title,
    },
    pageInfo,
    samples,
  };

  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Measured ${page.title} (${page.url})`);
  for (const sample of samples) {
    const metrics = sample.metrics;
    if (!metrics) {
      console.log(`${sample.label}: FPS logger not available`);
      continue;
    }
    console.log(
      `${sample.label}: current=${metrics.fps.toFixed(1)} avg=${metrics.averageFps.toFixed(1)} ` +
      `min=${metrics.minFps.toFixed(1)} max=${metrics.maxFps.toFixed(1)} ` +
      `worst=${metrics.worstFrameMs.toFixed(1)}ms longFrames=${metrics.longFrameCount} ` +
      `frames=${metrics.frameCount}`,
    );
  }
  console.log(`Nodes: sheets=${pageInfo.nodeCounts.sheets}, charts=${pageInfo.nodeCounts.charts}, notes=${pageInfo.nodeCounts.notes}, svg=${pageInfo.nodeCounts.svg}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
