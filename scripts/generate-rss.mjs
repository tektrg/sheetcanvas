#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { ROUTE_ORDER, SITE_ORIGIN } from './seo-route-config.mjs';

const BLOG_DIR = join(process.cwd(), 'public', 'blog');
const RSS_PATH = join(process.cwd(), 'public', 'rss.xml');
const FEED_URL = `${SITE_ORIGIN}/rss.xml`;
const BLOG_URL = `${SITE_ORIGIN}/blog/`;

function normalizedPath(filePath) {
  return filePath.split(sep).join('/');
}

function escapeXml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function discoverBlogIndexFiles(directoryPath) {
  const files = [];

  for (const entryName of readdirSync(directoryPath)) {
    const entryPath = join(directoryPath, entryName);
    const stats = statSync(entryPath);
    if (stats.isDirectory()) {
      files.push(...discoverBlogIndexFiles(entryPath));
      continue;
    }
    if (entryName === 'index.html') {
      files.push(entryPath);
    }
  }

  return files;
}

function routePathForBlogFile(filePath) {
  const relativePath = normalizedPath(relative(BLOG_DIR, filePath));
  const directory = dirname(relativePath);
  return `/blog/${directory === '.' ? '' : `${directory}/`}`;
}

function getTitle(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
}

function getMetaDescription(html) {
  return html.match(/<meta\b(?=[^>]*\bname=["']description["'])[^>]*\bcontent=["']([^"']+)["'][^>]*>/i)?.[1]?.trim() ?? '';
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

function parseSchemas(html, routePath) {
  return getJsonLdBlocks(html).map((block, index) => {
    try {
      return JSON.parse(block);
    } catch (error) {
      throw new Error(`${routePath} JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  });
}

function buildFeedItem(filePath) {
  const html = readFileSync(filePath, 'utf8');
  const routePath = routePathForBlogFile(filePath);
  const schemas = parseSchemas(html, routePath);
  const blogPost = schemas.map((schema) => findSchemaByType(schema, 'BlogPosting')).find(Boolean);
  const webPage = schemas.map((schema) => findSchemaByType(schema, 'WebPage')).find(Boolean);
  const isBlogRoot = routePath === '/blog/';
  const title = blogPost?.headline ?? webPage?.name ?? getTitle(html);
  const description = blogPost?.description ?? webPage?.description ?? getMetaDescription(html);
  const publishedDate = blogPost?.datePublished ?? webPage?.dateModified;
  const modifiedDate = blogPost?.dateModified ?? webPage?.dateModified ?? publishedDate;

  if (!title || !description || !publishedDate || !modifiedDate) {
    throw new Error(`${routePath} needs title, description, published date, and modified date for RSS.`);
  }

  return {
    description,
    isBlogRoot,
    link: `${SITE_ORIGIN}${routePath}`,
    modifiedDate,
    publishedDate,
    routePath,
    title,
  };
}

function routeOrder(routePath) {
  const index = ROUTE_ORDER.indexOf(routePath);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function sortFeedItems(left, right) {
  const dateComparison = right.publishedDate.localeCompare(left.publishedDate);
  if (dateComparison !== 0) {
    return dateComparison;
  }
  return routeOrder(left.routePath) - routeOrder(right.routePath);
}

function toRssDate(dateValue) {
  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid RSS date: ${dateValue}`);
  }
  return parsed.toUTCString();
}

function buildRss(items) {
  const latestModifiedDate = items
    .map((item) => item.modifiedDate)
    .sort()
    .at(-1);

  const itemXml = items.map((item) => [
    '    <item>',
    `      <title>${escapeXml(item.title)}</title>`,
    `      <link>${escapeXml(item.link)}</link>`,
    `      <guid isPermaLink="true">${escapeXml(item.link)}</guid>`,
    `      <pubDate>${toRssDate(item.publishedDate)}</pubDate>`,
    `      <description>${escapeXml(item.description)}</description>`,
    '    </item>',
  ].join('\n'));

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '  <channel>',
    '    <title>SheetCanvas Blog</title>',
    `    <link>${BLOG_URL}</link>`,
    `    <atom:link href="${FEED_URL}" rel="self" type="application/rss+xml"/>`,
    '    <description>Product-specific SheetCanvas tutorials for spreadsheet canvas workflows, local files, and shipped connectors.</description>',
    '    <language>en-us</language>',
    `    <lastBuildDate>${toRssDate(latestModifiedDate)}</lastBuildDate>`,
    ...itemXml,
    '  </channel>',
    '</rss>',
    '',
  ].join('\n');
}

if (!existsSync(BLOG_DIR)) {
  throw new Error('Missing public/blog directory for RSS generation.');
}

const items = discoverBlogIndexFiles(BLOG_DIR)
  .map(buildFeedItem)
  .filter((item) => !item.isBlogRoot)
  .sort(sortFeedItems);
const rss = buildRss(items);
const previousRss = existsSync(RSS_PATH) ? readFileSync(RSS_PATH, 'utf8') : '';

if (previousRss !== rss) {
  writeFileSync(RSS_PATH, rss);
  console.log(`Generated public/rss.xml with ${items.length} items.`);
} else {
  console.log(`public/rss.xml is current with ${items.length} items.`);
}
