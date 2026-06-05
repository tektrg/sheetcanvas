#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import {
  findSchemaObjectsByType,
  getCanonical,
  getJsonLdBlocks,
  getMetaContent,
  getTitle,
} from './seo-html.mjs';
import { delay, fetchText } from './seo-live-http.mjs';

const DEFAULT_LIVE_URL = 'https://sheetcanvas.com/';
const SOURCE_ROOT_PATH = 'index.html';
const DEFAULT_RETRIES = 0;
const DEFAULT_RETRY_DELAY_MS = 10000;
const DEPLOY_DRIFT_HINT = [
  'Production root SEO metadata differs from the audited source.',
  'Run `npm run deploy:pages` after unrelated app/backend dirty work is split or intentionally included.',
  'If deploy preflight blocks the publish, keep the stale production root as the active SEO issue.',
].join('\n');

function isDeployDriftFailure(message) {
  return /\b(mismatch|missing)\b/i.test(message);
}

function fail(messages) {
  const failureMessages = Array.isArray(messages) ? messages : [messages];
  console.error('Live root SEO check failed:');
  for (const message of failureMessages) {
    console.error(`- ${message}`);
  }
  if (failureMessages.some(isDeployDriftFailure)) {
    console.error(DEPLOY_DRIFT_HINT);
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

function parseArgs(argv) {
  const options = {
    liveUrl: DEFAULT_LIVE_URL,
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

    if (options.liveUrl !== DEFAULT_LIVE_URL) {
      checkError(`unexpected extra URL argument ${arg}.`);
    }

    options.liveUrl = arg;
  }

  return options;
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

function getFirstSchemaByType(html, schemaType, label) {
  const matches = parseJsonLd(html, label)
    .flatMap((schema) => findSchemaObjectsByType(schema, schemaType));

  if (matches.length === 0) {
    checkError(`${label} is missing ${schemaType} JSON-LD.`);
  }

  return matches[0];
}

function getRootSnapshot(html, label) {
  const softwareApplication = getFirstSchemaByType(html, 'SoftwareApplication', label);
  const webSite = getFirstSchemaByType(html, 'WebSite', label);
  const webPage = getFirstSchemaByType(html, 'WebPage', label);

  return {
    title: getTitle(html),
    description: getMetaContent(html, 'name', 'description'),
    canonical: getCanonical(html),
    ogTitle: getMetaContent(html, 'property', 'og:title'),
    ogDescription: getMetaContent(html, 'property', 'og:description'),
    ogUrl: getMetaContent(html, 'property', 'og:url'),
    ogType: getMetaContent(html, 'property', 'og:type'),
    ogImage: getMetaContent(html, 'property', 'og:image'),
    ogImageAlt: getMetaContent(html, 'property', 'og:image:alt'),
    ogImageWidth: getMetaContent(html, 'property', 'og:image:width'),
    ogImageHeight: getMetaContent(html, 'property', 'og:image:height'),
    twitterCard: getMetaContent(html, 'name', 'twitter:card'),
    twitterTitle: getMetaContent(html, 'name', 'twitter:title'),
    twitterDescription: getMetaContent(html, 'name', 'twitter:description'),
    twitterImage: getMetaContent(html, 'name', 'twitter:image'),
    websiteId: webSite['@id'],
    websiteName: webSite.name,
    websiteUrl: webSite.url,
    websiteLanguage: webSite.inLanguage,
    websitePublisherName: webSite.publisher?.name ?? '',
    websitePublisherUrl: webSite.publisher?.url ?? '',
    appUrl: softwareApplication.url,
    applicationCategory: softwareApplication.applicationCategory,
    applicationSubCategory: softwareApplication.applicationSubCategory,
    featureList: softwareApplication.featureList ?? [],
    screenshot: softwareApplication.screenshot,
    publisherName: softwareApplication.publisher?.name ?? '',
    publisherUrl: softwareApplication.publisher?.url ?? '',
    webPageDateModified: webPage.dateModified,
  };
}

function findFieldMismatch(liveSnapshot, sourceSnapshot, fieldName) {
  const liveValue = liveSnapshot[fieldName];
  const sourceValue = sourceSnapshot[fieldName];

  if (Array.isArray(sourceValue)) {
    if (!Array.isArray(liveValue) || liveValue.length !== sourceValue.length) {
      return `${fieldName} mismatch. Live: ${JSON.stringify(liveValue)} Source: ${JSON.stringify(sourceValue)}`;
    }

    for (const [index, expectedValue] of sourceValue.entries()) {
      if (liveValue[index] !== expectedValue) {
        return `${fieldName}[${index}] mismatch. Live: ${JSON.stringify(liveValue)} Source: ${JSON.stringify(sourceValue)}`;
      }
    }
    return null;
  }

  if (liveValue !== sourceValue) {
    return `${fieldName} mismatch. Live: ${JSON.stringify(liveValue)} Source: ${JSON.stringify(sourceValue)}`;
  }

  return null;
}

async function checkLiveRoot(liveUrl) {
  const sourceHtml = readFileSync(SOURCE_ROOT_PATH, 'utf8');
  const liveHtml = await fetchText(liveUrl);

  const sourceSnapshot = getRootSnapshot(sourceHtml, 'source root');
  const liveSnapshot = getRootSnapshot(liveHtml, 'live root');

  const mismatches = [
    'title',
    'description',
    'canonical',
    'ogTitle',
    'ogDescription',
    'ogUrl',
    'ogType',
    'ogImage',
    'ogImageAlt',
    'ogImageWidth',
    'ogImageHeight',
    'twitterCard',
    'twitterTitle',
    'twitterDescription',
    'twitterImage',
    'websiteId',
    'websiteName',
    'websiteUrl',
    'websiteLanguage',
    'websitePublisherName',
    'websitePublisherUrl',
    'appUrl',
    'applicationCategory',
    'applicationSubCategory',
    'featureList',
    'screenshot',
    'publisherName',
    'publisherUrl',
    'webPageDateModified',
  ]
    .map((fieldName) => findFieldMismatch(liveSnapshot, sourceSnapshot, fieldName))
    .filter(Boolean);

  if (mismatches.length > 0) {
    checkError(mismatches);
  }

  console.log(`Live root SEO check passed for ${liveUrl}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  let lastError;

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    try {
      await checkLiveRoot(options.liveUrl);
      return;
    } catch (error) {
      lastError = error;
      if (attempt >= options.retries) {
        break;
      }
      console.error(`Live root SEO check attempt ${attempt + 1} failed: ${error.message}`);
      await delay(options.retryDelayMs);
    }
  }

  fail(lastError.failureMessages ?? lastError.message);
}

main().catch((error) => fail(error.failureMessages ?? error.message));
