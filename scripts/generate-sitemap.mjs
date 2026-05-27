#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  EXCLUDED_PUBLIC_DIRS,
  ROUTE_ORDER,
  SITE_ORIGIN,
  metadataForRoute,
} from './seo-route-config.mjs';

const PUBLIC_DIR = join(process.cwd(), 'public');
const SITEMAP_PATH = join(PUBLIC_DIR, 'sitemap.xml');

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

function getJsonLdBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function findSchemaByType(schema, schemaType) {
  if (!schema || typeof schema !== 'object') {
    return null;
  }
  if (Array.isArray(schema)) {
    for (const item of schema) {
      const match = findSchemaByType(item, schemaType);
      if (match) {
        return match;
      }
    }
    return null;
  }
  const typeValue = schema['@type'];
  const typeValues = Array.isArray(typeValue) ? typeValue : [typeValue];
  if (typeValues.includes(schemaType)) {
    return schema;
  }
  for (const value of Object.values(schema)) {
    const match = findSchemaByType(value, schemaType);
    if (match) {
      return match;
    }
  }
  return null;
}

function schemaUrlMatches(value, expectedUrl) {
  if (value === expectedUrl) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return value['@id'] === expectedUrl || value.url === expectedUrl;
}

function getPageLastmod(filePath, routePath) {
  const html = readFileSync(filePath, 'utf8');
  const schemas = getJsonLdBlocks(html).map((block, index) => {
    try {
      return JSON.parse(block);
    } catch (error) {
      throw new Error(`${routePath} JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  });
  const expectedUrl = `${SITE_ORIGIN}${routePath}`;
  const webPage = schemas
    .map((schema) => findSchemaByType(schema, 'WebPage'))
    .find((schema) => schemaUrlMatches(schema?.url, expectedUrl));
  const dateModified = webPage?.dateModified ?? '';
  if (!dateModified || !/^\d{4}-\d{2}-\d{2}$/.test(dateModified)) {
    throw new Error(`${routePath} WebPage dateModified must be YYYY-MM-DD for sitemap lastmod.`);
  }
  return dateModified;
}

function discoverRoutes() {
  const routesByPath = new Map();
  if (existsSync(join(process.cwd(), 'index.html'))) {
    routesByPath.set('/', { filePath: join(process.cwd(), 'index.html'), routePath: '/' });
  }
  if (existsSync(PUBLIC_DIR)) {
    discoverPublicIndexFiles(PUBLIC_DIR).forEach((filePath) => {
      const routePath = routePathForPublicFile(filePath);
      routesByPath.set(routePath, { filePath, routePath });
    });
  }
  return [...routesByPath.values()].sort((left, right) => {
    const leftOrder = ROUTE_ORDER.indexOf(left.routePath);
    const rightOrder = ROUTE_ORDER.indexOf(right.routePath);
    if (leftOrder !== -1 || rightOrder !== -1) {
      return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder)
        - (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
    }
    return left.routePath.localeCompare(right.routePath);
  });
}

function buildSitemap(routes) {
  const urlEntries = routes.map(({ filePath, routePath }) => {
    const metadata = metadataForRoute(routePath);
    const lastmod = getPageLastmod(filePath, routePath);
    const entry = [
      '  <url>',
      `    <loc>${SITE_ORIGIN}${routePath}</loc>`,
    ];
    if (lastmod) {
      entry.push(`    <lastmod>${lastmod}</lastmod>`);
    }
    entry.push(
      `    <changefreq>${metadata.changefreq}</changefreq>`,
      `    <priority>${metadata.priority}</priority>`,
      '  </url>',
    );
    return entry.join('\n');
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urlEntries,
    '</urlset>',
    '',
  ].join('\n');
}

const routes = discoverRoutes();
const sitemap = buildSitemap(routes);
const previousSitemap = existsSync(SITEMAP_PATH) ? readFileSync(SITEMAP_PATH, 'utf8') : '';

if (previousSitemap !== sitemap) {
  writeFileSync(SITEMAP_PATH, sitemap);
  console.log(`Generated public/sitemap.xml with ${routes.length} routes.`);
} else {
  console.log(`public/sitemap.xml is current with ${routes.length} routes.`);
}
