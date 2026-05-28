#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { EXCLUDED_PUBLIC_DIRS, ROUTE_ORDER, SITE_ORIGIN } from './seo-route-config.mjs';
import {
  findSchemaObjectsByType,
  getJsonLdBlocks,
  getMetaContent,
  getTitle,
  schemaUrlMatches,
} from './seo-html.mjs';

const PUBLIC_DIR = join(process.cwd(), 'public');
const LLMS_PATH = join(PUBLIC_DIR, 'llms.txt');
const RSS_FEED_URL = `${SITE_ORIGIN}/rss.xml`;

const ROUTE_GROUPS = [
  {
    heading: 'Start here',
    routes: ['/', '/learn/', '/docs/', '/blog/'],
    extraLinks: [{ label: 'RSS feed', url: RSS_FEED_URL }],
  },
  {
    heading: 'Product-specific guides',
    routes: [
      '/blog/csv-dashboard-from-local-files/',
      '/blog/google-analytics-dashboard-canvas/',
      '/blog/clickhouse-query-dashboard-canvas/',
      '/use-cases/spreadsheet-canvas/',
      '/use-cases/csv-to-dashboard/',
      '/use-cases/local-spreadsheet-app/',
      '/use-cases/data-analysis-canvas/',
      '/connectors/clickhouse/',
      '/connectors/google-analytics/',
    ],
  },
  {
    heading: 'Comparisons and boundaries',
    routes: [
      '/alternatives/excel/',
      '/alternatives/google-sheets/',
      '/alternatives/airtable/',
      '/privacy/',
      '/terms/',
    ],
  },
];

function normalizedPath(filePath) {
  return filePath.split(sep).join('/');
}

function shouldSkipPublicPath(relativePath) {
  return relativePath.split('/').some((part) => EXCLUDED_PUBLIC_DIRS.has(part));
}

function discoverPublicIndexFiles(directoryPath) {
  const files = [];

  for (const entryName of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, entryName);
    const relativePath = normalizedPath(relative(PUBLIC_DIR, entryPath));
    if (shouldSkipPublicPath(relativePath)) {
      continue;
    }

    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...discoverPublicIndexFiles(entryPath));
      continue;
    }

    if (entryName === 'index.html') {
      files.push(entryPath);
    }
  }

  return files;
}

function routePathForPublicFile(filePath) {
  const relativePath = normalizedPath(relative(PUBLIC_DIR, filePath));
  const directory = dirname(relativePath);
  return `/${directory === '.' ? '' : `${directory}/`}`;
}

function parseSchemas(html, routePath) {
  return getJsonLdBlocks(html).map((block, index) => {
    try {
      return JSON.parse(block);
    } catch (error) {
      throw new Error(`${routePath} JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  });
}

function findSchemaForRoute(schemas, schemaType, routePath) {
  const expectedUrl = `${SITE_ORIGIN}${routePath}`;
  return schemas
    .flatMap((schema) => findSchemaObjectsByType(schema, schemaType))
    .find((schema) => (
      schemaUrlMatches(schema.url, expectedUrl)
      || schemaUrlMatches(schema.mainEntityOfPage, expectedUrl)
    ));
}

function titleForPage(html, routePath) {
  const schemas = parseSchemas(html, routePath);
  const blogPost = findSchemaForRoute(schemas, 'BlogPosting', routePath);
  const webPage = findSchemaForRoute(schemas, 'WebPage', routePath);
  return blogPost?.headline
    || webPage?.name
    || getMetaContent(html, 'property', 'og:title')
    || getTitle(html).replace(/\s*\|\s*SheetCanvas\s*$/i, '')
    || routePath;
}

function discoverPages() {
  const pagesByRoute = new Map();

  if (existsSync(join(process.cwd(), 'index.html'))) {
    const filePath = join(process.cwd(), 'index.html');
    pagesByRoute.set('/', {
      routePath: '/',
      title: titleForPage(readFileSync(filePath, 'utf8'), '/'),
    });
  }

  if (existsSync(PUBLIC_DIR)) {
    for (const filePath of discoverPublicIndexFiles(PUBLIC_DIR)) {
      const routePath = routePathForPublicFile(filePath);
      pagesByRoute.set(routePath, {
        routePath,
        title: titleForPage(readFileSync(filePath, 'utf8'), routePath),
      });
    }
  }

  return pagesByRoute;
}

function renderGroup(group, pagesByRoute) {
  const links = group.routes.map((routePath) => {
    const page = pagesByRoute.get(routePath);
    if (!page) {
      throw new Error(`Missing route ${routePath} while generating llms.txt.`);
    }
    return { label: page.title, url: `${SITE_ORIGIN}${routePath}` };
  });

  return [
    `## ${group.heading}`,
    '',
    ...[...links, ...(group.extraLinks ?? [])].map((link) => `- ${link.label}: ${link.url}`),
    '',
  ].join('\n');
}

function buildLlmsText(pagesByRoute) {
  const expectedRoutes = new Set(ROUTE_ORDER);
  const groupedRoutes = new Set(ROUTE_GROUPS.flatMap((group) => group.routes));

  for (const routePath of pagesByRoute.keys()) {
    if (!expectedRoutes.has(routePath)) {
      throw new Error(`Route ${routePath} needs a ROUTE_ORDER entry before generating llms.txt.`);
    }
    if (!groupedRoutes.has(routePath)) {
      throw new Error(`Route ${routePath} needs a ROUTE_GROUPS placement before generating llms.txt.`);
    }
  }

  for (const routePath of groupedRoutes) {
    if (!pagesByRoute.has(routePath)) {
      throw new Error(`ROUTE_GROUPS includes missing route ${routePath}.`);
    }
  }

  return [
    '# SheetCanvas',
    '',
    '> SheetCanvas is a browser-based spreadsheet canvas for local CSV/XLSX files, canvas objects, and shipped connector-backed sheets. The live app stays at https://sheetcanvas.com/.',
    '',
    ...ROUTE_GROUPS.map((group) => renderGroup(group, pagesByRoute)),
    '## Product boundaries',
    '',
    'SheetCanvas is best for arranging source tables, charts, pivots, sparklines, and notes on one canvas. It does not replace mature spreadsheet macros, full BI governance, collaborative database apps, database administration tools, or source-system permissions. Connector pages describe shipped connector paths and guardrails; they should not be treated as claims for every possible integration.',
    '',
  ].join('\n');
}

const pagesByRoute = discoverPages();
const llmsText = buildLlmsText(pagesByRoute);
const previousText = existsSync(LLMS_PATH) ? readFileSync(LLMS_PATH, 'utf8') : '';

if (previousText !== llmsText) {
  writeFileSync(LLMS_PATH, llmsText);
  console.log(`Generated public/llms.txt with ${pagesByRoute.size} routes.`);
} else {
  console.log(`public/llms.txt is current with ${pagesByRoute.size} routes.`);
}
