#!/usr/bin/env node

import {
  findSchemaObjectsByType,
  getCanonical,
  getJsonLdBlocks,
  getMetaContent,
  getTitle,
  schemaUrlMatches,
} from './seo-html.mjs';
import { delay, fetchText } from './seo-live-http.mjs';
import { ROUTE_ORDER, SITE_ORIGIN } from './seo-route-config.mjs';

const DEFAULT_LIVE_ORIGIN = SITE_ORIGIN;
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 10000;
const SUPPORT_ROUTES = ROUTE_ORDER.filter((routePath) => routePath !== '/');

function fail(messages) {
  const failureMessages = Array.isArray(messages) ? messages : [messages];
  console.error('Live support SEO check failed:');
  for (const message of failureMessages) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

function checkError(message) {
  const messages = Array.isArray(message) ? message : [message];
  const error = new Error(messages.join('\n'));
  error.failureMessages = messages;
  throw error;
}

function parseNonNegativeInteger(value, flagName) {
  if (!/^\d+$/.test(value ?? '')) {
    checkError(`${flagName} must be a non-negative integer.`);
  }
  return Number(value);
}

function normalizeOrigin(origin) {
  return origin.replace(/\/+$/, '');
}

function parseArgs(argv) {
  const options = {
    liveOrigin: DEFAULT_LIVE_ORIGIN,
    retries: DEFAULT_RETRIES,
    retryDelayMs: DEFAULT_RETRY_DELAY_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--retries') {
      index += 1;
      options.retries = parseNonNegativeInteger(argv[index], '--retries');
      continue;
    }

    if (arg === '--retry-delay-ms') {
      index += 1;
      options.retryDelayMs = parseNonNegativeInteger(argv[index], '--retry-delay-ms');
      continue;
    }

    if (arg.startsWith('--')) {
      checkError(`unknown option ${arg}.`);
    }

    if (options.liveOrigin !== DEFAULT_LIVE_ORIGIN) {
      checkError(`unexpected extra origin argument ${arg}.`);
    }

    options.liveOrigin = normalizeOrigin(arg);
  }

  return options;
}

function parseSitemapLocs(xml) {
  return Array.from(xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g), (match) => match[1]);
}

function parseJsonLd(html, label) {
  return getJsonLdBlocks(html).map((block, index) => {
    try {
      return JSON.parse(block);
    } catch (error) {
      checkError(`${label} JSON-LD block ${index + 1} is not parseable: ${error.message}`);
    }
  });
}

function hasSchemaType(html, schemaType, label) {
  const matches = parseJsonLd(html, label)
    .flatMap((schema) => findSchemaObjectsByType(schema, schemaType));
  return matches.length > 0;
}

function expectedUrlForRoute(liveOrigin, routePath) {
  return `${liveOrigin}${routePath}`;
}

async function checkLiveDiscoveryFiles(liveOrigin) {
  const robotsUrl = `${liveOrigin}/robots.txt`;
  const sitemapIndexUrl = `${liveOrigin}/sitemap-index.xml`;
  const sitemapUrl = `${liveOrigin}/sitemap.xml`;

  const [robots, sitemapIndex, sitemap] = await Promise.all([
    fetchText(robotsUrl),
    fetchText(sitemapIndexUrl),
    fetchText(sitemapUrl),
  ]);

  const errors = [];
  if (!robots.includes(`Sitemap: ${sitemapIndexUrl}`)) {
    errors.push(`${robotsUrl} must reference ${sitemapIndexUrl}.`);
  }

  const sitemapIndexLocs = parseSitemapLocs(sitemapIndex);
  if (!sitemapIndexLocs.includes(sitemapUrl)) {
    errors.push(`${sitemapIndexUrl} must include ${sitemapUrl}.`);
  }

  const sitemapLocs = parseSitemapLocs(sitemap);
  for (const routePath of ROUTE_ORDER) {
    const expectedUrl = expectedUrlForRoute(liveOrigin, routePath);
    if (!sitemapLocs.includes(expectedUrl)) {
      errors.push(`${sitemapUrl} is missing ${expectedUrl}.`);
    }
  }

  if (errors.length > 0) {
    checkError(errors);
  }
}

async function checkLiveSupportRoute(liveOrigin, routePath) {
  const liveUrl = expectedUrlForRoute(liveOrigin, routePath);
  const html = await fetchText(liveUrl);
  const errors = [];

  if (!getTitle(html)) {
    errors.push(`${liveUrl} is missing a title.`);
  }

  if (!getMetaContent(html, 'name', 'description')) {
    errors.push(`${liveUrl} is missing a meta description.`);
  }

  if (getCanonical(html) !== liveUrl) {
    errors.push(`${liveUrl} canonical should be ${liveUrl}.`);
  }

  if (!hasSchemaType(html, 'WebPage', liveUrl)) {
    errors.push(`${liveUrl} is missing WebPage JSON-LD.`);
  }

  if (!hasSchemaType(html, 'BreadcrumbList', liveUrl)) {
    errors.push(`${liveUrl} is missing BreadcrumbList JSON-LD.`);
  }

  if (routePath.startsWith('/blog/') && routePath !== '/blog/' && !hasSchemaType(html, 'BlogPosting', liveUrl)) {
    errors.push(`${liveUrl} is missing BlogPosting JSON-LD.`);
  }

  const webPageSchemas = parseJsonLd(html, liveUrl)
    .flatMap((schema) => findSchemaObjectsByType(schema, 'WebPage'));
  const hasRouteMatchedWebPage = webPageSchemas.some((schema) => schemaUrlMatches(schema.url, liveUrl));
  if (!hasRouteMatchedWebPage) {
    errors.push(`${liveUrl} WebPage JSON-LD must match the live canonical URL.`);
  }

  if (errors.length > 0) {
    checkError(errors);
  }
}

async function checkLiveSupportSurface(liveOrigin) {
  await checkLiveDiscoveryFiles(liveOrigin);
  for (const routePath of SUPPORT_ROUTES) {
    await checkLiveSupportRoute(liveOrigin, routePath);
  }
  console.log(`Live support SEO check passed for ${liveOrigin} with ${SUPPORT_ROUTES.length} support routes.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let lastError;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      await checkLiveSupportSurface(options.liveOrigin);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) {
        break;
      }
      console.error(`Live support SEO check attempt ${attempt + 1} failed: ${error.message}`);
      await delay(options.retryDelayMs);
    }
  }

  fail(lastError.failureMessages ?? lastError.message);
}

main().catch((error) => fail(error.failureMessages ?? error.message));
