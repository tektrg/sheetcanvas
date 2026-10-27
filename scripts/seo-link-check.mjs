#!/usr/bin/env node
// Broken-link check for the built site (dist/) and, optionally, a running backend.
//   node scripts/seo-link-check.mjs                      → dist internal links (fail) + external links (warn)
//   node scripts/seo-link-check.mjs --no-external        → skip the network pass
//   node scripts/seo-link-check.mjs --base-url http://127.0.0.1:8792 --sample /p/x-abc,/@ann
//        → fetch those server-rendered pages and every internal link on them (4xx/5xx fail)
// Internal = same origin (relative or https://sheetcanvas.com/...). Paths served by
// the backend Worker (backend/wrangler.toml routes) can't be checked from dist and are
// only verified in the --base-url pass.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const SITE_ORIGIN = 'https://sheetcanvas.com';
export const WORKER_PATH_PREFIXES = ['/api/', '/mcp/', '/p/', '/og/', '/e/', '/oembed', '/sitemap-pages.xml', '/llms-pages.txt', '/@'];
const EXTERNAL_TIMEOUT_MS = 8000;
const EXTERNAL_CONCURRENCY = 8;

const decodeEntities = (value) => value.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

/** Every <a href> in a page, classified relative to the page's own path. */
export function extractLinks(html, pagePath, siteOrigin = SITE_ORIGIN) {
  const internal = new Set();
  const external = new Set();
  for (const match of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["']/gi)) {
    const href = decodeEntities(match[1].trim());
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let url;
    try {
      url = new URL(href, `${siteOrigin}${pagePath}`);
    } catch {
      continue;
    }
    if (url.origin === siteOrigin || url.hostname === 'www.sheetcanvas.com') internal.add(decodeURI(url.pathname));
    else if (/^https?:$/.test(url.protocol)) external.add(url.href.split('#')[0]);
  }
  return { internal: [...internal], external: [...external] };
}

export const isWorkerPath = (path) => WORKER_PATH_PREFIXES.some((prefix) => path === prefix.replace(/\/$/, '') || path.startsWith(prefix));

/** Redirect sources from a Pages _redirects file ("/from /to 301"). */
export function parseRedirectSources(text) {
  return new Set(text.split('\n').map((line) => line.trim().split(/\s+/)[0]).filter((from) => from?.startsWith('/')));
}

/** Would Cloudflare Pages serve this path from dist (file, dir index, .html, or a redirect)? */
export function distServes(distRoot, path, redirectSources = new Set()) {
  if (path === '/' || redirectSources.has(path)) return true;
  const clean = path.replace(/^\/+/, '');
  const candidates = [clean, join(clean, 'index.html'), `${clean.replace(/\/$/, '')}.html`];
  return candidates.some((candidate) => {
    const full = join(distRoot, candidate);
    return existsSync(full) && statSync(full).isFile();
  });
}

const htmlFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return htmlFiles(full);
  return name.endsWith('.html') ? [full] : [];
});

const pagePathForFile = (distRoot, file) => {
  const rel = relative(distRoot, file).split(sep).join('/');
  return `/${rel.replace(/(^|\/)index\.html$/, '$1').replace(/\.html$/, '')}`;
};

/** Broken internal links across dist/: [{ page, link }]. Worker paths are skipped. */
export function findBrokenDistLinks(distRoot) {
  const redirectsPath = join(distRoot, '_redirects');
  const redirectSources = existsSync(redirectsPath) ? parseRedirectSources(readFileSync(redirectsPath, 'utf8')) : new Set();
  const broken = [];
  const external = new Map();
  for (const file of htmlFiles(distRoot)) {
    const page = pagePathForFile(distRoot, file);
    const links = extractLinks(readFileSync(file, 'utf8'), page);
    for (const link of links.internal) {
      if (!isWorkerPath(link) && !distServes(distRoot, link, redirectSources)) broken.push({ page, link });
    }
    for (const link of links.external) external.set(link, page);
  }
  return { broken, external };
}

/** GET with a timeout; returns the status, or 0 on network error / timeout. */
export async function fetchStatus(url, { fetchImpl = fetch, timeoutMs = EXTERNAL_TIMEOUT_MS, method = 'GET' } = {}) {
  try {
    const res = await fetchImpl(url, { method, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'SheetCanvas-link-check/1.0' } });
    await res.body?.cancel?.().catch(() => {});
    return res.status;
  } catch {
    return 0;
  }
}

async function mapLimit(items, limit, task) {
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index]);
    }
  }));
  return results;
}

/** External links: non-2xx/3xx or timeouts become warnings, never failures. */
export async function checkExternalLinks(urls, options = {}) {
  const statuses = await mapLimit(urls, EXTERNAL_CONCURRENCY, (url) => fetchStatus(url, options));
  return urls.map((url, index) => ({ url, status: statuses[index] })).filter(({ status }) => status === 0 || status >= 400);
}

/** Fetch sample server-rendered pages, then every internal link on them. 4xx/5xx = broken. */
export async function checkServerPages(baseUrl, samplePaths, options = {}) {
  const broken = [];
  const seen = new Set();
  for (const page of samplePaths) {
    const pageStatus = await fetchStatus(`${baseUrl}${page}`, options);
    if (pageStatus === 0 || pageStatus >= 400) { broken.push({ page, link: page, status: pageStatus }); continue; }
    const html = await (options.fetchImpl ?? fetch)(`${baseUrl}${page}`).then((res) => res.text());
    // Only routes the backend owns can be checked here; static marketing paths live on Pages (dist pass).
    const links = extractLinks(html, page).internal.filter((link) => isWorkerPath(link) && !seen.has(link));
    for (const link of links) {
      seen.add(link);
      const status = await fetchStatus(`${baseUrl}${link}`, options);
      if (status === 0 || status >= 400) broken.push({ page, link, status });
    }
  }
  return broken;
}

const argValue = (args, name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};

async function main(args) {
  let failed = false;
  const distRoot = join(process.cwd(), 'dist');
  const baseUrl = argValue(args, '--base-url');
  if (!baseUrl) {
    if (!existsSync(distRoot)) {
      console.error('Link check: dist/ missing — run npm run build first.');
      return 1;
    }
    const { broken, external } = findBrokenDistLinks(distRoot);
    broken.forEach(({ page, link }) => console.error(`- broken internal link on ${page}: ${link}`));
    failed ||= broken.length > 0;
    console.log(`Link check: ${broken.length} broken internal link(s) in dist/, ${external.size} external link(s).`);
    if (!args.includes('--no-external')) {
      const bad = await checkExternalLinks([...external.keys()]);
      bad.forEach(({ url, status }) => console.warn(`  warning: external ${url} → ${status || 'timeout/network error'} (on ${external.get(url)})`));
      console.log(`Link check: ${bad.length} external warning(s).`);
    }
  } else {
    const samples = (argValue(args, '--sample') ?? '').split(',').filter(Boolean);
    const broken = await checkServerPages(baseUrl.replace(/\/$/, ''), samples);
    broken.forEach(({ page, link, status }) => console.error(`- ${page}: ${link} → ${status || 'network error'}`));
    failed ||= broken.length > 0;
    console.log(`Link check: ${samples.length} server page(s), ${broken.length} broken.`);
  }
  return failed ? 1 : 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(await main(process.argv.slice(2)));
}
