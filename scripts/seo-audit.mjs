#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const SITE_ORIGIN = 'https://sheetcanvas.com';
const REQUIRED_SUPPORT_SCHEMA_TYPES = ['WebPage', 'BreadcrumbList'];
const EXCLUDED_PUBLIC_DIRS = new Set(['landing-page-design']);
const PAGE_ROOTS = [
  { label: 'source', rootPath: process.cwd() },
  { label: 'dist', rootPath: join(process.cwd(), 'dist') },
];

const errors = [];

function readText(filePath) {
  return readFileSync(filePath, 'utf8');
}

function normalizedPath(filePath) {
  return filePath.split(sep).join('/');
}

function reportError(pageLabel, message) {
  errors.push(`${pageLabel}: ${message}`);
}

function getTitle(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
}

function getAttribute(html, tagPattern, attributeName) {
  const tag = html.match(tagPattern)?.[0] ?? '';
  const attributePattern = new RegExp(`${attributeName}=["']([^"']+)["']`, 'i');
  return tag.match(attributePattern)?.[1]?.trim() ?? '';
}

function getMetaContent(html, selectorName, selectorValue) {
  const escapedValue = selectorValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return getAttribute(
    html,
    new RegExp(`<meta\\b(?=[^>]*\\b${selectorName}=["']${escapedValue}["'])[^>]*>`, 'i'),
    'content',
  );
}

function getCanonical(html) {
  return getAttribute(html, /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i, 'href');
}

function getJsonLdBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function flattenSchemaTypes(schema) {
  const values = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const typeValue = node['@type'];
    if (Array.isArray(typeValue)) {
      values.push(...typeValue);
    } else if (typeValue) {
      values.push(typeValue);
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return values;
}

function findSchemaObjectsByType(schema, schemaType) {
  const matches = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const typeValue = node['@type'];
    const typeValues = Array.isArray(typeValue) ? typeValue : [typeValue];
    if (typeValues.includes(schemaType)) {
      matches.push(node);
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return matches;
}

function auditRootAppShell(html, pageLabel) {
  if (!/<div\b[^>]*\bid=["']root["'][^>]*>/i.test(html)) {
    reportError(pageLabel, 'root page must keep the Vite app mount element.');
  }

  const hasSourceEntry = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']\/index\.tsx["'])[^>]*>/i.test(html);
  const hasBuiltEntry = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']\/assets\/index-[^"']+\.js["'])[^>]*>/i.test(html);
  if (!hasSourceEntry && !hasBuiltEntry) {
    reportError(pageLabel, 'root page must keep the Vite app module entry.');
  }
}

function discoverHtmlFiles(rootPath) {
  const files = [];

  function walk(directoryPath) {
    for (const entryName of readdirSync(directoryPath)) {
      const entryPath = join(directoryPath, entryName);
      const relativePath = normalizedPath(relative(rootPath, entryPath));
      if (relativePath.startsWith('public/') || relativePath.startsWith('dist/')) {
        const pathParts = relativePath.split('/');
        if (pathParts.some((part) => EXCLUDED_PUBLIC_DIRS.has(part))) {
          continue;
        }
      }
      const stats = statSync(entryPath);
      if (stats.isDirectory()) {
        walk(entryPath);
        continue;
      }
      if (entryName.endsWith('.html')) {
        files.push(entryPath);
      }
    }
  }

  const rootIndexPath = join(rootPath, 'index.html');
  if (existsSync(rootIndexPath)) {
    files.push(rootIndexPath);
  }

  const publicPath = join(rootPath, 'public');
  if (existsSync(publicPath)) {
    walk(publicPath);
  }

  if (rootPath.endsWith(`${sep}dist`)) {
    walk(rootPath);
  }

  return [...new Set(files)].sort();
}

function pagePathFor(rootPath, filePath) {
  const relativePath = normalizedPath(relative(rootPath, filePath));
  if (relativePath === 'index.html') {
    return '/';
  }

  const withoutPublic = relativePath.startsWith('public/')
    ? relativePath.slice('public/'.length)
    : relativePath;
  const directory = dirname(withoutPublic);
  if (withoutPublic.endsWith('/index.html')) {
    return `/${directory === '.' ? '' : `${directory}/`}`;
  }
  return `/${withoutPublic}`;
}

function auditPage(page) {
  const html = readText(page.filePath);
  const pageLabel = `${page.label}:${page.urlPath}`;
  const expectedCanonical = `${SITE_ORIGIN}${page.urlPath}`;

  const title = getTitle(html);
  if (!title) {
    reportError(pageLabel, 'missing <title>.');
  }

  const description = getMetaContent(html, 'name', 'description');
  if (!description) {
    reportError(pageLabel, 'missing meta description.');
  }

  const canonical = getCanonical(html);
  if (canonical !== expectedCanonical) {
    reportError(pageLabel, `canonical should be ${expectedCanonical}, found ${canonical || 'nothing'}.`);
  }

  const openGraphImage = getMetaContent(html, 'property', 'og:image');
  if (!openGraphImage.startsWith(`${SITE_ORIGIN}/`)) {
    reportError(pageLabel, 'og:image must be an absolute SheetCanvas URL.');
  }

  const openGraphUrl = getMetaContent(html, 'property', 'og:url');
  if (openGraphUrl !== expectedCanonical) {
    reportError(pageLabel, `og:url should be ${expectedCanonical}, found ${openGraphUrl || 'nothing'}.`);
  }

  const openGraphType = getMetaContent(html, 'property', 'og:type');
  if (!openGraphType) {
    reportError(pageLabel, 'missing og:type.');
  }

  const twitterImage = getMetaContent(html, 'name', 'twitter:image');
  if (!twitterImage.startsWith(`${SITE_ORIGIN}/`)) {
    reportError(pageLabel, 'twitter:image must be an absolute SheetCanvas URL.');
  }

  const twitterCard = getMetaContent(html, 'name', 'twitter:card');
  if (twitterCard !== 'summary_large_image') {
    reportError(pageLabel, `twitter:card should be summary_large_image, found ${twitterCard || 'nothing'}.`);
  }

  for (const [selectorName, selectorValue] of [
    ['property', 'og:title'],
    ['property', 'og:description'],
    ['name', 'twitter:title'],
    ['name', 'twitter:description'],
  ]) {
    if (!getMetaContent(html, selectorName, selectorValue)) {
      reportError(pageLabel, `missing ${selectorValue}.`);
    }
  }

  const jsonLdBlocks = getJsonLdBlocks(html);
  if (jsonLdBlocks.length === 0) {
    reportError(pageLabel, 'missing JSON-LD.');
    return { title };
  }

  const schemaTypes = [];
  const schemaObjects = [];
  jsonLdBlocks.forEach((block, index) => {
    try {
      const schema = JSON.parse(block);
      schemaTypes.push(...flattenSchemaTypes(schema));
      schemaObjects.push(schema);
    } catch (error) {
      reportError(pageLabel, `JSON-LD block ${index + 1} is not valid JSON: ${error.message}`);
    }
  });

  if (page.urlPath === '/' && !schemaTypes.includes('SoftwareApplication')) {
    reportError(pageLabel, 'root page must include SoftwareApplication JSON-LD.');
  }

  if (page.urlPath === '/') {
    auditRootAppShell(html, pageLabel);
  } else {
    for (const requiredType of REQUIRED_SUPPORT_SCHEMA_TYPES) {
      if (!schemaTypes.includes(requiredType)) {
        reportError(pageLabel, `support page must include ${requiredType} JSON-LD.`);
      }
    }
    if (!/Last reviewed:\s+[A-Z][a-z]+ \d{1,2}, \d{4}/.test(html)) {
      reportError(pageLabel, 'support page must include a visible Last reviewed date.');
    }
    const webPageSchemas = schemaObjects.flatMap((schema) => findSchemaObjectsByType(schema, 'WebPage'));
    if (!webPageSchemas.some((schema) => /^\d{4}-\d{2}-\d{2}$/.test(schema.dateModified ?? ''))) {
      reportError(pageLabel, 'support page WebPage JSON-LD must include dateModified as YYYY-MM-DD.');
    }
  }

  return { title };
}

function auditSitemap(rootPath, pages) {
  const isDistRoot = rootPath.endsWith(`${sep}dist`);
  const assetRoot = isDistRoot ? rootPath : join(rootPath, 'public');
  const sitemapPath = join(assetRoot, 'sitemap.xml');
  const sitemapIndexPath = join(assetRoot, 'sitemap-index.xml');
  const robotsPath = join(assetRoot, 'robots.txt');
  const label = `${isDistRoot ? 'dist' : 'source'}:sitemap`;

  if (!existsSync(sitemapPath) || !existsSync(robotsPath) || !existsSync(sitemapIndexPath)) {
    reportError(label, 'missing sitemap.xml, sitemap-index.xml, or robots.txt.');
    return;
  }

  const sitemap = readText(sitemapPath);
  const sitemapIndex = readText(sitemapIndexPath);
  const robots = readText(robotsPath);

  for (const page of pages) {
    const loc = `<loc>${SITE_ORIGIN}${page.urlPath}</loc>`;
    if (!sitemap.includes(loc)) {
      reportError(label, `missing sitemap entry for ${page.urlPath}.`);
    }
  }

  if (!robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap-index.xml`)) {
    reportError(label, 'robots.txt must point at the sitemap index.');
  }

  if (!sitemapIndex.includes(`<loc>${SITE_ORIGIN}/sitemap.xml</loc>`)) {
    reportError(label, 'sitemap-index.xml must include sitemap.xml.');
  }
}

function auditTitleUniqueness(results, label) {
  const seenTitles = new Map();
  for (const result of results) {
    if (!result.title) {
      continue;
    }
    const previousPath = seenTitles.get(result.title);
    if (previousPath) {
      reportError(label, `duplicate title "${result.title}" on ${previousPath} and ${result.urlPath}.`);
    }
    seenTitles.set(result.title, result.urlPath);
  }
}

for (const pageRoot of PAGE_ROOTS) {
  if (!existsSync(pageRoot.rootPath)) {
    reportError(pageRoot.label, `missing root path ${pageRoot.rootPath}. Run npm run build before auditing.`);
    continue;
  }

  const pageFiles = discoverHtmlFiles(pageRoot.rootPath);
  const pages = pageFiles
    .map((filePath) => ({
      filePath,
      label: pageRoot.label,
      urlPath: pagePathFor(pageRoot.rootPath, filePath),
    }))
    .filter((page) => !page.urlPath.includes('/landing-page-design/'));

  const results = pages.map((page) => ({
    ...page,
    ...auditPage(page),
  }));
  auditTitleUniqueness(results, pageRoot.label);
  auditSitemap(pageRoot.rootPath, pages);
}

if (errors.length > 0) {
  console.error('SEO audit failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('SEO audit passed.');
