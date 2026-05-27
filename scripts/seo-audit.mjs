#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import {
  EXCLUDED_PUBLIC_DIRS,
  ROUTE_ORDER,
  SITE_ORIGIN,
  metadataForRoute,
} from './seo-route-config.mjs';

const REQUIRED_SUPPORT_SCHEMA_TYPES = ['WebPage', 'BreadcrumbList'];
const BLOG_ROOT_PATH = '/blog/';
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

function getAlternateRss(html) {
  const alternateLinks = [...html.matchAll(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*>/gi)]
    .map((match) => match[0]);
  const rssLink = alternateLinks.find((tag) => getAttribute(tag, /^.*$/i, 'type') === 'application/rss+xml');
  return rssLink ? getAttribute(rssLink, /^.*$/i, 'href') : '';
}

function getInternalLinks(html) {
  return [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => normalizeInternalLink(match[1]))
    .filter(Boolean);
}

function normalizeInternalLink(href) {
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return null;
  }

  if (href.startsWith(`${SITE_ORIGIN}/`)) {
    return new URL(href).pathname;
  }

  if (href.startsWith('/') && !href.startsWith('//')) {
    return href.split('#')[0].split('?')[0];
  }

  return null;
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

function isBlogPage(urlPath) {
  return urlPath.startsWith(BLOG_ROOT_PATH);
}

function isBlogPost(urlPath) {
  return isBlogPage(urlPath) && urlPath !== BLOG_ROOT_PATH;
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

function auditBlogArticle(page, html, pageLabel, schemaObjects, schemaTypes, openGraphType) {
  if (getAlternateRss(html) !== `${SITE_ORIGIN}/rss.xml`) {
    reportError(pageLabel, 'blog pages must link to the RSS feed with rel="alternate".');
  }

  if (!isBlogPost(page.urlPath)) {
    return;
  }

  if (openGraphType !== 'article') {
    reportError(pageLabel, `blog posts must use og:type article, found ${openGraphType || 'nothing'}.`);
  }

  if (!schemaTypes.includes('BlogPosting')) {
    reportError(pageLabel, 'blog posts must include BlogPosting JSON-LD.');
    return;
  }

  const expectedCanonical = `${SITE_ORIGIN}${page.urlPath}`;
  const blogPostSchemas = schemaObjects.flatMap((schema) => findSchemaObjectsByType(schema, 'BlogPosting'));
  const hasValidBlogPost = blogPostSchemas.some((schema) => (
    schemaUrlMatches(schema.url, expectedCanonical)
    && schemaUrlMatches(schema.mainEntityOfPage, expectedCanonical)
    && /^\d{4}-\d{2}-\d{2}$/.test(schema.datePublished ?? '')
    && /^\d{4}-\d{2}-\d{2}$/.test(schema.dateModified ?? '')
  ));

  if (!hasValidBlogPost) {
    reportError(pageLabel, 'BlogPosting JSON-LD must include url, mainEntityOfPage, datePublished, and dateModified for this route.');
  }
}

function auditPage(page, supportPagePaths) {
  const html = readText(page.filePath);
  const pageLabel = `${page.label}:${page.urlPath}`;
  const expectedCanonical = `${SITE_ORIGIN}${page.urlPath}`;
  const internalLinks = getInternalLinks(html);

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
    if (!internalLinks.includes('/')) {
      reportError(pageLabel, 'support page must link back to the root app.');
    }
    const relatedSupportLinks = internalLinks.filter(
      (href) => href !== page.urlPath && supportPagePaths.has(href),
    );
    if (relatedSupportLinks.length === 0) {
      reportError(pageLabel, 'support page must link to at least one related support page.');
    }
    for (const requiredType of REQUIRED_SUPPORT_SCHEMA_TYPES) {
      if (!schemaTypes.includes(requiredType)) {
        reportError(pageLabel, `support page must include ${requiredType} JSON-LD.`);
      }
    }
    if (!/Last reviewed:\s+[A-Z][a-z]+ \d{1,2}, \d{4}/.test(html)) {
      reportError(pageLabel, 'support page must include a visible Last reviewed date.');
    }
    const webPageSchemas = schemaObjects.flatMap((schema) => findSchemaObjectsByType(schema, 'WebPage'));
    const routeWebPageSchema = webPageSchemas.find((schema) => (
      schemaUrlMatches(schema.url, expectedCanonical)
    ));
    if (!routeWebPageSchema || !/^\d{4}-\d{2}-\d{2}$/.test(routeWebPageSchema.dateModified ?? '')) {
      reportError(pageLabel, 'support page must include route-matched WebPage JSON-LD with dateModified as YYYY-MM-DD.');
    }
    if (isBlogPage(page.urlPath)) {
      auditBlogArticle(page, html, pageLabel, schemaObjects, schemaTypes, openGraphType);
    }
  }

  return { title, internalLinks };
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
  const sitemapEntries = parseSitemapEntries(sitemap, label);
  const sitemapEntriesByPath = new Map();
  const expectedPaths = new Set(pages.map((page) => page.urlPath));
  const expectedOrder = pages.map((page) => page.urlPath);
  const actualOrder = sitemapEntries
    .map((entry) => sitemapPathForLoc(entry.loc))
    .filter(Boolean);

  if (actualOrder.join('\n') !== expectedOrder.join('\n')) {
    reportError(label, `sitemap route order should be ${expectedOrder.join(', ')}, found ${actualOrder.join(', ')}.`);
  }

  for (const entry of sitemapEntries) {
    const urlPath = sitemapPathForLoc(entry.loc);
    if (!urlPath) {
      reportError(label, `sitemap loc must be an absolute ${SITE_ORIGIN} URL, found ${entry.loc || 'nothing'}.`);
      continue;
    }
    if (sitemapEntriesByPath.has(urlPath)) {
      reportError(label, `duplicate sitemap entry for ${urlPath}.`);
    }
    sitemapEntriesByPath.set(urlPath, entry);
    if (!expectedPaths.has(urlPath)) {
      reportError(label, `unexpected sitemap entry for ${urlPath}.`);
    }
  }

  for (const page of pages) {
    const loc = `<loc>${SITE_ORIGIN}${page.urlPath}</loc>`;
    const entry = sitemapEntriesByPath.get(page.urlPath);
    if (!entry) {
      reportError(label, `missing sitemap entry for ${page.urlPath}.`);
      continue;
    }
    const metadata = metadataForRoute(page.urlPath);
    if (entry.changefreq !== metadata.changefreq) {
      reportError(
        label,
        `sitemap changefreq for ${page.urlPath} should be ${metadata.changefreq}, found ${entry.changefreq || 'nothing'}.`,
      );
    }
    if (entry.priority !== metadata.priority) {
      reportError(
        label,
        `sitemap priority for ${page.urlPath} should be ${metadata.priority}, found ${entry.priority || 'nothing'}.`,
      );
    }
    if (!sitemap.includes(loc)) {
      reportError(label, `missing exact sitemap loc for ${page.urlPath}.`);
    }
    const expectedLastmod = expectedSitemapLastmodForPage(page);
    if (expectedLastmod && entry.lastmod !== expectedLastmod) {
      reportError(
        label,
        `sitemap lastmod for ${page.urlPath} should be ${expectedLastmod}, found ${entry.lastmod || 'nothing'}.`,
      );
    }
  }

  if (!robots.includes(`Sitemap: ${SITE_ORIGIN}/sitemap-index.xml`)) {
    reportError(label, 'robots.txt must point at the sitemap index.');
  }

  if (!sitemapIndex.includes(`<loc>${SITE_ORIGIN}/sitemap.xml</loc>`)) {
    reportError(label, 'sitemap-index.xml must include sitemap.xml.');
  }
}

function auditAppAliasRedirect(rootPath) {
  const isDistRoot = rootPath.endsWith(`${sep}dist`);
  const assetRoot = isDistRoot ? rootPath : join(rootPath, 'public');
  const redirectsPath = join(assetRoot, '_redirects');
  const label = `${isDistRoot ? 'dist' : 'source'}:redirects`;

  if (!existsSync(redirectsPath)) {
    reportError(label, 'missing _redirects file for the /app canonical alias.');
    return;
  }

  const redirectRules = readText(redirectsPath)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  const expectedRules = new Set(['/app / 301', '/app/ / 301']);

  for (const expectedRule of expectedRules) {
    if (!redirectRules.includes(expectedRule)) {
      reportError(label, `missing redirect rule "${expectedRule}".`);
    }
  }
}

function auditExcludedPublicHeaders(rootPath) {
  const isDistRoot = rootPath.endsWith(`${sep}dist`);
  const assetRoot = isDistRoot ? rootPath : join(rootPath, 'public');
  const headersPath = join(assetRoot, '_headers');
  const label = `${isDistRoot ? 'dist' : 'source'}:headers`;

  if (!existsSync(headersPath)) {
    reportError(label, 'missing _headers file for excluded public app-support assets.');
    return;
  }

  const headers = readText(headersPath);
  const requiredSnippets = [
    '/landing-page-design/*',
    'X-Robots-Tag: noindex, nofollow',
  ];

  for (const snippet of requiredSnippets) {
    if (!headers.includes(snippet)) {
      reportError(label, `missing _headers rule snippet "${snippet}".`);
    }
  }
}

function auditDeployScript() {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const label = 'source:package.json';

  if (!existsSync(packageJsonPath)) {
    reportError(label, 'missing package.json.');
    return;
  }

  const packageJson = JSON.parse(readText(packageJsonPath));
  const deployScript = packageJson.scripts?.['deploy:pages'] ?? '';
  const gscScript = packageJson.scripts?.['seo:gsc'] ?? '';
  const rssScript = packageJson.scripts?.['seo:rss'] ?? '';
  const seoAuditScript = packageJson.scripts?.['seo:audit'] ?? '';
  const expectedDeployScript = 'npm run seo:audit && wrangler pages deploy dist --project-name sheetcanvas --branch main';
  const expectedGscScript = 'node scripts/search-console-report.mjs';
  const expectedRssScript = 'node scripts/generate-rss.mjs';
  const expectedSeoAuditScript = 'npm run seo:sitemap && npm run seo:rss && npm run build && node scripts/seo-audit.mjs';

  if (deployScript !== expectedDeployScript) {
    reportError(label, `deploy:pages should be "${expectedDeployScript}", found "${deployScript || 'nothing'}".`);
  }

  if (gscScript !== expectedGscScript) {
    reportError(label, `seo:gsc should be "${expectedGscScript}", found "${gscScript || 'nothing'}".`);
  }

  if (rssScript !== expectedRssScript) {
    reportError(label, `seo:rss should be "${expectedRssScript}", found "${rssScript || 'nothing'}".`);
  }

  if (seoAuditScript !== expectedSeoAuditScript) {
    reportError(label, `seo:audit should be "${expectedSeoAuditScript}", found "${seoAuditScript || 'nothing'}".`);
  }
}

function getRssItems(rss) {
  return [...rss.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .map((match) => {
      const itemXml = match[1];
      const guidTag = itemXml.match(/<guid\b[^>]*>[^<]+<\/guid>/i)?.[0] ?? '';
      return {
        description: decodeXml(itemXml.match(/<description>([^<]+)<\/description>/i)?.[1]?.trim() ?? ''),
        link: itemXml.match(/<link>([^<]+)<\/link>/i)?.[1]?.trim() ?? '',
        guid: guidTag.match(/<guid\b[^>]*>([^<]+)<\/guid>/i)?.[1]?.trim() ?? '',
        isPermaLink: /\bisPermaLink=["']true["']/i.test(guidTag),
        pubDate: itemXml.match(/<pubDate>([^<]+)<\/pubDate>/i)?.[1]?.trim() ?? '',
        title: decodeXml(itemXml.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? ''),
      };
    });
}

function decodeXml(value) {
  return value
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function toRssDate(dateValue) {
  const parsed = new Date(`${dateValue}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toUTCString();
}

function expectedRssItemForPage(page) {
  const html = readText(page.filePath);
  const jsonLdBlocks = getJsonLdBlocks(html);
  const schemaObjects = [];

  jsonLdBlocks.forEach((block, index) => {
    try {
      schemaObjects.push(JSON.parse(block));
    } catch (error) {
      reportError(`${page.label}:${page.urlPath}`, `JSON-LD block ${index + 1} is not valid JSON: ${error.message}`);
    }
  });

  const blogPost = schemaObjects
    .flatMap((schema) => findSchemaObjectsByType(schema, 'BlogPosting'))
    .find((schema) => schemaUrlMatches(schema.url, `${SITE_ORIGIN}${page.urlPath}`));
  const webPage = schemaObjects
    .flatMap((schema) => findSchemaObjectsByType(schema, 'WebPage'))
    .find((schema) => schemaUrlMatches(schema.url, `${SITE_ORIGIN}${page.urlPath}`));
  const publishedDate = blogPost?.datePublished ?? webPage?.dateModified ?? '';

  return {
    description: blogPost?.description ?? webPage?.description ?? getMetaContent(html, 'name', 'description'),
    link: `${SITE_ORIGIN}${page.urlPath}`,
    pubDate: toRssDate(publishedDate),
    title: blogPost?.headline ?? webPage?.name ?? getTitle(html),
  };
}

function auditRssFeed(rootPath, pages) {
  const isDistRoot = rootPath.endsWith(`${sep}dist`);
  const assetRoot = isDistRoot ? rootPath : join(rootPath, 'public');
  const rssPath = join(assetRoot, 'rss.xml');
  const label = `${isDistRoot ? 'dist' : 'source'}:rss`;

  if (!existsSync(rssPath)) {
    reportError(label, 'missing rss.xml for the blog feed.');
    return;
  }

  const rss = readText(rssPath);
  const requiredSnippets = [
    '<rss version="2.0"',
    '<title>SheetCanvas Blog</title>',
    '<link>https://sheetcanvas.com/blog/</link>',
    '<atom:link href="https://sheetcanvas.com/rss.xml" rel="self" type="application/rss+xml"/>',
  ];

  for (const snippet of requiredSnippets) {
    if (!rss.includes(snippet)) {
      reportError(label, `RSS feed must include ${snippet}.`);
    }
  }

  const expectedFeedPaths = pages
    .map((page) => page.urlPath)
    .filter(isBlogPost);
  const expectedFeedUrls = new Set(expectedFeedPaths.map((urlPath) => `${SITE_ORIGIN}${urlPath}`));
  const expectedFeedItems = pages
    .filter((page) => isBlogPost(page.urlPath))
    .map(expectedRssItemForPage);
  const rssItems = getRssItems(rss);

  if (rssItems.length !== expectedFeedItems.length) {
    reportError(label, `RSS feed should include ${expectedFeedItems.length} items, found ${rssItems.length}.`);
  }

  for (const expectedItem of expectedFeedItems) {
    const matchingItem = rssItems.find((item) => item.link === expectedItem.link);
    if (!matchingItem) {
      reportError(label, `RSS feed must include an item link for ${expectedItem.link}.`);
      continue;
    }
    if (matchingItem.guid !== expectedItem.link || !matchingItem.isPermaLink) {
      reportError(label, `RSS feed item for ${expectedItem.link} must include a matching permalink guid.`);
    }
    for (const fieldName of ['title', 'description', 'pubDate']) {
      if (matchingItem[fieldName] !== expectedItem[fieldName]) {
        reportError(
          label,
          `RSS feed item for ${expectedItem.link} should have ${fieldName} "${expectedItem[fieldName]}", found "${matchingItem[fieldName] || 'nothing'}".`,
        );
      }
    }
  }

  for (const item of rssItems) {
    if (item.link.startsWith(`${SITE_ORIGIN}/blog/`) && !expectedFeedUrls.has(item.link)) {
      reportError(label, `RSS feed includes unexpected blog item ${item.link}.`);
    }
  }
}

function auditSearchConsoleScript() {
  const scriptPath = join(process.cwd(), 'scripts/search-console-report.mjs');
  const label = 'source:scripts/search-console-report.mjs';

  if (!existsSync(scriptPath)) {
    reportError(label, 'missing Search Console reporting wrapper.');
    return;
  }

  const script = readText(scriptPath);
  const expectedSnippets = [
    {
      snippet: "const DEFAULT_GSC_REPORT_BIN = '/Users/trungluong/clawd/bin/gsc-report';",
      message: 'must default to the global Search Console reporting wrapper.',
    },
    {
      snippet: 'process.env.SHEETCANVAS_GSC_REPORT_BIN',
      message: 'must allow overriding the Search Console reporting binary.',
    },
    {
      snippet: "const DEFAULT_SITE_URL = 'sc-domain:sheetcanvas.com';",
      message: 'must default to the SheetCanvas domain property.',
    },
    {
      snippet: "const DEFAULT_OUTPUT_DIR = 'reports/seo/search-console';",
      message: 'must default report output to the gitignored Search Console report folder.',
    },
    {
      snippet: "hasOption(finalArgs, '--stdout-only')",
      message: 'must honor --stdout-only without adding the default output directory.',
    },
    {
      snippet: "hasOption(finalArgs, '--output-dir')",
      message: 'must honor a custom --output-dir without adding the default output directory.',
    },
  ];

  for (const { snippet, message } of expectedSnippets) {
    if (!script.includes(snippet)) {
      reportError(label, message);
    }
  }
}

function auditRssGeneratorScript() {
  const scriptPath = join(process.cwd(), 'scripts/generate-rss.mjs');
  const label = 'source:scripts/generate-rss.mjs';

  if (!existsSync(scriptPath)) {
    reportError(label, 'missing RSS generator script.');
    return;
  }

  const script = readText(scriptPath);
  const expectedSnippets = [
    {
      snippet: "const BLOG_DIR = join(process.cwd(), 'public', 'blog');",
      message: 'must discover the public blog directory.',
    },
    {
      snippet: "findSchemaByType(schema, 'BlogPosting')",
      message: 'must read BlogPosting JSON-LD for feed entries.',
    },
    {
      snippet: ".filter((item) => !item.isBlogRoot)",
      message: 'must exclude the blog hub from RSS item output.',
    },
    {
      snippet: "Generated public/rss.xml",
      message: 'must write the source RSS feed when blog metadata changes.',
    },
  ];

  for (const { snippet, message } of expectedSnippets) {
    if (!script.includes(snippet)) {
      reportError(label, message);
    }
  }
}

function parseSitemapEntries(sitemap, label) {
  const entries = [];
  const urlBlocks = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/gi)];
  if (urlBlocks.length === 0) {
    reportError(label, 'sitemap.xml must include at least one url entry.');
  }

  for (const block of urlBlocks) {
    entries.push({
      loc: block[1].match(/<loc>([^<]+)<\/loc>/i)?.[1]?.trim() ?? '',
      lastmod: block[1].match(/<lastmod>([^<]+)<\/lastmod>/i)?.[1]?.trim() ?? '',
      changefreq: block[1].match(/<changefreq>([^<]+)<\/changefreq>/i)?.[1]?.trim() ?? '',
      priority: block[1].match(/<priority>([^<]+)<\/priority>/i)?.[1]?.trim() ?? '',
    });
  }

  return entries;
}

function expectedSitemapLastmodForPage(page) {
  const html = readText(page.filePath);
  const schemaObjects = [];

  getJsonLdBlocks(html).forEach((block, index) => {
    try {
      schemaObjects.push(JSON.parse(block));
    } catch (error) {
      reportError(`${page.label}:${page.urlPath}`, `JSON-LD block ${index + 1} is not valid JSON: ${error.message}`);
    }
  });

  const webPage = schemaObjects
    .flatMap((schema) => findSchemaObjectsByType(schema, 'WebPage'))
    .find((schema) => schemaUrlMatches(schema.url, `${SITE_ORIGIN}${page.urlPath}`));

  const dateModified = webPage?.dateModified ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateModified)) {
      reportError(`${page.label}:${page.urlPath}`, 'sitemap lastmod requires route-matched WebPage JSON-LD dateModified as YYYY-MM-DD.');
    }
  return dateModified;
}

function sitemapPathForLoc(loc) {
  if (!loc.startsWith(`${SITE_ORIGIN}/`) && loc !== `${SITE_ORIGIN}/`) {
    return null;
  }
  return new URL(loc).pathname;
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

function auditInboundLinks(results, label) {
  const supportPages = results.filter((result) => result.urlPath !== '/');
  for (const page of supportPages) {
    const hasInboundLink = results.some((result) => {
      if (result.urlPath === page.urlPath) {
        return false;
      }
      return result.internalLinks?.includes(page.urlPath);
    });
    if (!hasInboundLink) {
      reportError(label, `support page ${page.urlPath} has no inbound internal links.`);
    }
  }
}

function sortPagesForSitemap(left, right) {
  const leftOrder = ROUTE_ORDER.indexOf(left.urlPath);
  const rightOrder = ROUTE_ORDER.indexOf(right.urlPath);
  if (leftOrder !== -1 || rightOrder !== -1) {
    return (leftOrder === -1 ? Number.MAX_SAFE_INTEGER : leftOrder)
      - (rightOrder === -1 ? Number.MAX_SAFE_INTEGER : rightOrder);
  }
  return left.urlPath.localeCompare(right.urlPath);
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
    .filter((page) => !page.urlPath.includes('/landing-page-design/'))
    .sort(sortPagesForSitemap);
  const supportPagePaths = new Set(
    pages
      .map((page) => page.urlPath)
      .filter((urlPath) => urlPath !== '/'),
  );

  const results = pages.map((page) => ({
    ...page,
    ...auditPage(page, supportPagePaths),
  }));
  auditTitleUniqueness(results, pageRoot.label);
  auditInboundLinks(results, pageRoot.label);
  auditSitemap(pageRoot.rootPath, pages);
  auditAppAliasRedirect(pageRoot.rootPath);
  auditExcludedPublicHeaders(pageRoot.rootPath);
  auditRssFeed(pageRoot.rootPath, pages);
}

auditDeployScript();
auditSearchConsoleScript();
auditRssGeneratorScript();

if (errors.length > 0) {
  console.error('SEO audit failed:');
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log('SEO audit passed.');
