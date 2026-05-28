import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';
import { SITE_ORIGIN } from './seo-route-config.mjs';

const RSS_FEED_URL = `${SITE_ORIGIN}/rss.xml`;

export function auditLlmsText(rootPath, pages, context) {
  const isDistRoot = rootPath.endsWith(`${sep}dist`);
  const assetRoot = isDistRoot ? rootPath : join(rootPath, 'public');
  const llmsPath = join(assetRoot, 'llms.txt');
  const label = `${isDistRoot ? 'dist' : 'source'}:llms`;

  if (!existsSync(llmsPath)) {
    context.reportError(label, 'missing llms.txt for AI/search assistant discovery.');
    return;
  }

  const llmsText = context.readText(llmsPath);
  const requiredSnippets = [
    '# SheetCanvas',
    'browser-based spreadsheet canvas',
    'The live app stays at https://sheetcanvas.com/.',
    'does not replace mature spreadsheet macros',
    'Connector pages describe shipped connector paths and guardrails',
  ];

  for (const snippet of requiredSnippets) {
    if (!llmsText.includes(snippet)) {
      context.reportError(label, `llms.txt must include "${snippet}".`);
    }
  }

  const expectedUrls = new Set(pages.map((page) => `${SITE_ORIGIN}${page.urlPath}`));
  const allowedUrls = new Set([...expectedUrls, RSS_FEED_URL]);
  const foundUrls = [...llmsText.matchAll(/https:\/\/sheetcanvas\.com\/[^\s)]+/g)]
    .map((match) => match[0].replace(/[.,;:]+$/, ''));
  const seenUrls = new Set();

  for (const page of pages) {
    const expectedUrl = `${SITE_ORIGIN}${page.urlPath}`;
    if (!llmsText.includes(expectedUrl)) {
      context.reportError(label, `llms.txt must include ${expectedUrl}.`);
    }
  }

  if (!llmsText.includes(RSS_FEED_URL)) {
    context.reportError(label, `llms.txt must include ${RSS_FEED_URL}.`);
  }

  for (const foundUrl of foundUrls) {
    if (!allowedUrls.has(foundUrl)) {
      context.reportError(label, `llms.txt includes noncanonical or non-crawlable URL ${foundUrl}.`);
    }
    if (seenUrls.has(foundUrl)) {
      context.reportError(label, `llms.txt includes duplicate URL ${foundUrl}.`);
    }
    seenUrls.add(foundUrl);
  }
}

export function auditLlmsGeneratorScript(context) {
  const scriptPath = join(process.cwd(), 'scripts/generate-llms.mjs');
  const label = 'source:scripts/generate-llms.mjs';

  if (!existsSync(scriptPath)) {
    context.reportError(label, 'missing llms.txt generator script.');
    return;
  }

  const script = context.readText(scriptPath);
  const expectedSnippets = [
    {
      snippet: "const LLMS_PATH = join(PUBLIC_DIR, 'llms.txt');",
      message: 'must write public/llms.txt.',
    },
    {
      snippet: 'ROUTE_GROUPS',
      message: 'must group the current route set into assistant-readable sections.',
    },
    {
      snippet: 'groupedRoutes.has(routePath)',
      message: 'must fail when a discovered route is missing from ROUTE_GROUPS.',
    },
    {
      snippet: 'findSchemaObjectsByType',
      message: 'must read page schema metadata for labels.',
    },
    {
      snippet: 'Generated public/llms.txt',
      message: 'must report when the source llms.txt artifact changes.',
    },
  ];

  for (const { snippet, message } of expectedSnippets) {
    if (!script.includes(snippet)) {
      context.reportError(label, message);
    }
  }
}
