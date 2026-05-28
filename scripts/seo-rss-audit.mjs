import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { SITE_ORIGIN } from './seo-route-config.mjs';
import { toRssDate } from './seo-date.mjs';

const BLOG_ROOT_PATH = '/blog/';

function isBlogPost(urlPath) {
  return urlPath.startsWith(BLOG_ROOT_PATH) && urlPath !== BLOG_ROOT_PATH;
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

function getRssLastBuildDate(rss) {
  return rss.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/i)?.[1]?.trim() ?? '';
}

function decodeXml(value) {
  return value
    .replaceAll('&apos;', "'")
    .replaceAll('&quot;', '"')
    .replaceAll('&gt;', '>')
    .replaceAll('&lt;', '<')
    .replaceAll('&amp;', '&');
}

function expectedRssItemForPage(page, context) {
  const html = context.readText(page.filePath);
  const schemaObjects = [];

  context.getJsonLdBlocks(html).forEach((block, index) => {
    try {
      schemaObjects.push(JSON.parse(block));
    } catch (error) {
      context.reportError(`${page.label}:${page.urlPath}`, `JSON-LD block ${index + 1} is not valid JSON: ${error.message}`);
    }
  });

  const blogPost = schemaObjects
    .flatMap((schema) => context.findSchemaObjectsByType(schema, 'BlogPosting'))
    .find((schema) => context.schemaUrlMatches(schema.url, `${SITE_ORIGIN}${page.urlPath}`));
  const webPage = schemaObjects
    .flatMap((schema) => context.findSchemaObjectsByType(schema, 'WebPage'))
    .find((schema) => context.schemaUrlMatches(schema.url, `${SITE_ORIGIN}${page.urlPath}`));
  const publishedDate = blogPost?.datePublished ?? webPage?.dateModified ?? '';
  const modifiedDate = blogPost?.dateModified ?? webPage?.dateModified ?? '';

  return {
    description: blogPost?.description ?? webPage?.description ?? context.getMetaContent(html, 'name', 'description'),
    link: `${SITE_ORIGIN}${page.urlPath}`,
    modifiedDate,
    pubDate: toRssDate(publishedDate),
    title: blogPost?.headline ?? webPage?.name ?? context.getTitle(html),
  };
}

export function auditRssFeed(rootPath, pages, context) {
  const isDistRoot = rootPath.endsWith(`${sep}dist`);
  const assetRoot = isDistRoot ? rootPath : join(rootPath, 'public');
  const rssPath = join(assetRoot, 'rss.xml');
  const label = `${isDistRoot ? 'dist' : 'source'}:rss`;

  if (!existsSync(rssPath)) {
    context.reportError(label, 'missing rss.xml for the blog feed.');
    return;
  }

  const rss = context.readText(rssPath);
  const requiredSnippets = [
    '<rss version="2.0"',
    '<title>SheetCanvas Blog</title>',
    '<link>https://sheetcanvas.com/blog/</link>',
    '<atom:link href="https://sheetcanvas.com/rss.xml" rel="self" type="application/rss+xml"/>',
  ];

  for (const snippet of requiredSnippets) {
    if (!rss.includes(snippet)) {
      context.reportError(label, `RSS feed must include ${snippet}.`);
    }
  }

  const expectedFeedUrls = new Set(
    pages
      .map((page) => page.urlPath)
      .filter(isBlogPost)
      .map((urlPath) => `${SITE_ORIGIN}${urlPath}`),
  );
  const expectedFeedItems = pages
    .filter((page) => isBlogPost(page.urlPath))
    .map((page) => expectedRssItemForPage(page, context))
    .sort((left, right) => Date.parse(right.pubDate) - Date.parse(left.pubDate));
  const rssItems = getRssItems(rss);
  const expectedLastBuildDate = expectedFeedItems
    .map((item) => toRssDate(item.modifiedDate))
    .filter(Boolean)
    .sort((left, right) => Date.parse(left) - Date.parse(right))
    .at(-1) ?? '';
  const lastBuildDate = getRssLastBuildDate(rss);

  if (rssItems.length !== expectedFeedItems.length) {
    context.reportError(label, `RSS feed should include ${expectedFeedItems.length} items, found ${rssItems.length}.`);
  }

  if (lastBuildDate !== expectedLastBuildDate) {
    context.reportError(label, `RSS lastBuildDate should be ${expectedLastBuildDate}, found ${lastBuildDate || 'nothing'}.`);
  }

  const expectedFeedOrder = expectedFeedItems.map((item) => item.link);
  const actualFeedOrder = rssItems.map((item) => item.link);
  if (actualFeedOrder.join('\n') !== expectedFeedOrder.join('\n')) {
    context.reportError(
      label,
      `RSS item order should be ${expectedFeedOrder.join(', ')}, found ${actualFeedOrder.join(', ')}.`,
    );
  }

  for (const expectedItem of expectedFeedItems) {
    const matchingItem = rssItems.find((item) => item.link === expectedItem.link);
    if (!matchingItem) {
      context.reportError(label, `RSS feed must include an item link for ${expectedItem.link}.`);
      continue;
    }
    if (matchingItem.guid !== expectedItem.link || !matchingItem.isPermaLink) {
      context.reportError(label, `RSS feed item for ${expectedItem.link} must include a matching permalink guid.`);
    }
    for (const fieldName of ['title', 'description', 'pubDate']) {
      if (matchingItem[fieldName] !== expectedItem[fieldName]) {
        context.reportError(
          label,
          `RSS feed item for ${expectedItem.link} should have ${fieldName} "${expectedItem[fieldName]}", found "${matchingItem[fieldName] || 'nothing'}".`,
        );
      }
    }
  }

  for (const item of rssItems) {
    if (item.link.startsWith(`${SITE_ORIGIN}/blog/`) && !expectedFeedUrls.has(item.link)) {
      context.reportError(label, `RSS feed includes unexpected blog item ${item.link}.`);
    }
  }
}
