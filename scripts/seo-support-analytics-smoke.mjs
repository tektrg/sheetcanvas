#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';

const ANALYTICS_SCRIPT_PATH = join(process.cwd(), 'public', 'seo-support-analytics.js');
const MEASUREMENT_ID = 'G-FDXZ468S02';
const SUPPORT_CLICK_EVENT = 'support_open_app_click';

function fail(message) {
  console.error(`Support analytics smoke failed: ${message}`);
  process.exit(1);
}

function createMockDocument({ href, pathname, search, title }) {
  const listeners = new Map();
  const appendedScripts = [];

  return {
    appendedScripts,
    listeners,
    title,
    location: { href, pathname, search },
    head: {
      appendChild(element) {
        appendedScripts.push(element);
      },
    },
    createElement(tagName) {
      return { tagName };
    },
    querySelector() {
      return null;
    },
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
  };
}

function createMockSessionStorage() {
  const values = new Map();
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

function createMockAnchor({ ariaLabel = '', baseUrl, href, textContent }) {
  return {
    href: new URL(href, baseUrl).href,
    textContent,
    getAttribute(attributeName) {
      if (attributeName === 'href') {
        return href;
      }
      if (attributeName === 'aria-label') {
        return ariaLabel;
      }
      return null;
    },
  };
}

function gtagCallMatches(call, command, name) {
  const parts = Array.from(call);
  return parts[0] === command && parts[1] === name;
}

function getAnalyticsEventCalls(window, eventName) {
  return window.dataLayer.filter((call) => gtagCallMatches(call, 'event', eventName));
}

function dispatchClick(clickHandler, anchor) {
  clickHandler({
    target: {
      closest(selector) {
        return selector === 'a' ? anchor : null;
      },
    },
  });
}

function runAnalyticsScenario({ expectDebugMode, href, pathname, search, title }) {
  const document = createMockDocument({ href, pathname, search, title });
  const window = {
    dataLayer: [],
    document,
    location: document.location,
    sessionStorage: createMockSessionStorage(),
    URL,
    URLSearchParams,
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    document,
    window,
  });

  vm.runInContext(readFileSync(ANALYTICS_SCRIPT_PATH, 'utf8'), context, {
    filename: ANALYTICS_SCRIPT_PATH,
  });

  const gtagScript = document.appendedScripts.find((script) => (
    script.src === `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  ));
  if (!gtagScript || gtagScript.async !== true) {
    fail('did not append the GA4 gtag script asynchronously.');
  }

  const configCall = window.dataLayer.find((call) => gtagCallMatches(call, 'config', MEASUREMENT_ID));
  if (!configCall) {
    fail('did not send a GA4 config pageview.');
  }

  const configParameters = Array.from(configCall)[2];
  if (
    configParameters.page_path !== pathname
    || configParameters.page_title !== title
    || configParameters.support_page_path !== pathname
    || configParameters.support_page_title !== title
  ) {
    fail('GA4 config did not include the expected support page parameters.');
  }

  const clickHandler = document.listeners.get('click');
  if (typeof clickHandler !== 'function') {
    fail('did not register the support CTA click listener.');
  }

  const anchor = createMockAnchor({ baseUrl: href, href: '/', textContent: 'Open SheetCanvas' });
  dispatchClick(clickHandler, anchor);

  const textCtaClickCall = getAnalyticsEventCalls(window, SUPPORT_CLICK_EVENT)[0];
  if (!textCtaClickCall) {
    fail('did not send a support_open_app_click event for the root app CTA.');
  }

  const supportEntry = JSON.parse(window.sessionStorage.getItem('sheetcanvas:support-entry') || '{}');
  if (
    supportEntry.path !== pathname
    || supportEntry.title !== title
    || typeof supportEntry.timestamp !== 'number'
  ) {
    fail('did not persist support page context for the root app pageview.');
  }

  const clickParameters = Array.from(textCtaClickCall)[2];
  if (
    clickParameters.event_category !== 'SEO support page'
    || clickParameters.link_url !== 'https://sheetcanvas.com/'
    || clickParameters.support_page_path !== pathname
    || clickParameters.support_page_title !== title
    || clickParameters.transport_type !== 'beacon'
  ) {
    fail('CTA event did not include the expected support page parameters.');
  }

  const ariaOnlyAnchor = createMockAnchor({
    ariaLabel: 'Open SheetCanvas app',
    baseUrl: href,
    href: 'https://sheetcanvas.com/',
    textContent: 'SheetCanvas',
  });
  dispatchClick(clickHandler, ariaOnlyAnchor);

  const trackedClickCalls = getAnalyticsEventCalls(window, SUPPORT_CLICK_EVENT);
  if (trackedClickCalls.length !== 2) {
    fail('did not track an accessible root app CTA whose visible text is the product name.');
  }

  if (expectDebugMode) {
    const ariaClickParameters = Array.from(trackedClickCalls[1])[2];
    if (
      configParameters.debug_mode !== true
      || clickParameters.debug_mode !== true
      || ariaClickParameters.debug_mode !== true
    ) {
      fail('debug support page did not include debug_mode for config and CTA event.');
    }
    return;
  }

  if ('debug_mode' in configParameters || 'debug_mode' in clickParameters) {
    fail('normal support page should not include debug_mode in GA4 config or CTA event.');
  }
}

function runIgnoredClickScenario() {
  const href = 'https://sheetcanvas.com/docs/';
  const document = createMockDocument({
    href,
    pathname: '/docs/',
    search: '',
    title: 'Docs | SheetCanvas',
  });
  const window = {
    dataLayer: [],
    document,
    location: document.location,
    sessionStorage: createMockSessionStorage(),
    URL,
    URLSearchParams,
  };
  const context = vm.createContext({
    URL,
    URLSearchParams,
    document,
    window,
  });

  vm.runInContext(readFileSync(ANALYTICS_SCRIPT_PATH, 'utf8'), context, {
    filename: ANALYTICS_SCRIPT_PATH,
  });

  const clickHandler = document.listeners.get('click');
  if (typeof clickHandler !== 'function') {
    fail('did not register the support CTA click listener for ignored-click coverage.');
  }

  const relatedSupportLink = createMockAnchor({
    baseUrl: href,
    href: '/learn/',
    textContent: 'Read the overview',
  });
  dispatchClick(clickHandler, relatedSupportLink);

  const untrackedRootLink = createMockAnchor({
    baseUrl: href,
    href: '/',
    textContent: 'SheetCanvas home',
  });
  dispatchClick(clickHandler, untrackedRootLink);

  if (getAnalyticsEventCalls(window, SUPPORT_CLICK_EVENT).length > 0) {
    fail('sent support_open_app_click for a non-root link or non-CTA root link.');
  }
  if (window.sessionStorage.getItem('sheetcanvas:support-entry')) {
    fail('persisted support page context for an ignored click.');
  }
}

runAnalyticsScenario({
  expectDebugMode: true,
  href: 'https://sheetcanvas.com/docs/?debug_ga=1',
  pathname: '/docs/',
  search: '?debug_ga=1',
  title: 'Docs | SheetCanvas',
});

runAnalyticsScenario({
  expectDebugMode: false,
  href: 'https://sheetcanvas.com/docs/',
  pathname: '/docs/',
  search: '',
  title: 'Docs | SheetCanvas',
});

runIgnoredClickScenario();

console.log('Support analytics smoke passed.');
