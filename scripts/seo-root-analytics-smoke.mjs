#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ROOT_HTML_PATH = join(process.cwd(), 'index.html');
const MEASUREMENT_ID = 'G-FDXZ468S02';
const SUPPORT_ENTRY_KEY = 'sheetcanvas:support-entry';
const FRESH_NOW_MS = Date.parse('2026-06-01T01:00:00.000Z');

function fail(message) {
  console.error(`Root analytics smoke failed: ${message}`);
  process.exit(1);
}

function getRootAnalyticsScript() {
  const html = readFileSync(ROOT_HTML_PATH, 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1]);
  const script = inlineScripts.find((candidate) => (
    candidate.includes("sessionStorage.getItem('sheetcanvas:support-entry')")
    && candidate.includes("window.gtag('config', 'G-FDXZ468S02'")
  ));

  if (!script) {
    fail('could not find the root GA4 support-entry attribution script.');
  }

  return script;
}

function createMockSessionStorage(initialValues = {}) {
  const values = new Map(Object.entries(initialValues));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

function createFixedDate(nowMs) {
  return class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length > 0 ? args : [nowMs]));
    }

    static now() {
      return nowMs;
    }
  };
}

function runRootAnalyticsScenario({ expectedConfig, nowMs = FRESH_NOW_MS, sessionValues }) {
  const dataLayer = [];
  const sessionStorage = createMockSessionStorage(sessionValues);
  const context = vm.createContext({
    Date: createFixedDate(nowMs),
    JSON,
    Number,
    window: {
      dataLayer,
      sessionStorage,
    },
  });

  vm.runInContext(getRootAnalyticsScript(), context, {
    filename: ROOT_HTML_PATH,
  });

  const configCall = dataLayer.find((call) => (
    Array.from(call)[0] === 'config' && Array.from(call)[1] === MEASUREMENT_ID
  ));
  if (!configCall) {
    fail('root script did not send a GA4 config call.');
  }

  const actualConfig = Array.from(configCall)[2] ?? {};
  if (JSON.stringify(actualConfig) !== JSON.stringify(expectedConfig)) {
    fail(`unexpected GA4 config ${JSON.stringify(actualConfig)}, expected ${JSON.stringify(expectedConfig)}.`);
  }

  if (sessionStorage.getItem(SUPPORT_ENTRY_KEY) !== null) {
    fail('root script did not remove consumed support-entry session storage.');
  }
}

runRootAnalyticsScenario({
  expectedConfig: {
    support_entry_path: '/docs/',
    support_entry_title: 'Docs | SheetCanvas',
  },
  sessionValues: {
    [SUPPORT_ENTRY_KEY]: JSON.stringify({
      path: '/docs/',
      title: 'Docs | SheetCanvas',
      timestamp: FRESH_NOW_MS - 5 * 60 * 1000,
    }),
  },
});

runRootAnalyticsScenario({
  expectedConfig: {},
  sessionValues: {
    [SUPPORT_ENTRY_KEY]: JSON.stringify({
      path: '/learn/',
      title: 'Learn SheetCanvas',
      timestamp: FRESH_NOW_MS - 45 * 60 * 1000,
    }),
  },
});

runRootAnalyticsScenario({
  expectedConfig: {},
  sessionValues: {},
});

console.log('Root analytics smoke passed.');
