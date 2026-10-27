import type { Context, Hono } from 'hono';
import type { Env } from './env';
import type { PagesRepo } from './pagesRepo';
import { publishSnapshotSchema, type PublishSnapshot } from '../../shared/publishSnapshot';
import {
  EMBED_DEFAULT_HEIGHT,
  EMBED_DEFAULT_WIDTH,
  embedIframeHtml,
  embedPath,
  parseEmbedTheme,
  type EmbedOptions,
  type EmbedTarget,
} from '../../shared/embed';
import { canonicalPageUrl, renderGoneHtml, withChartDataAsOf, SITE_ORIGIN } from './render/pageHtml';
import { renderChartEmbedHtml, renderPageEmbedHtml } from './render/embedHtml';
import { EMBED_CSP, htmlResponse } from './htmlResponse';

// Embeds: /e/p/:id (whole page) and /e/c/:id/:chartIdx (one chart), framable by
// any site, never indexed; /oembed turns a SheetCanvas URL into an iframe card.

type PublishEnv = { Bindings: Env };
type AppContext = Context<PublishEnv>;

// Embeds are NOT put in the Worker edge cache (unlike /p/, which republish/unpublish purge):
// every request reads D1, so changes show as soon as the 60s browser/proxy max-age lapses.
const EMBED_CACHE_SECONDS = 60;
const EMBED_HEADERS = { 'content-security-policy': EMBED_CSP, 'x-robots-tag': 'noindex' };
const ALLOWED_HOSTS = new Set(['sheetcanvas.com', 'www.sheetcanvas.com']);
const PAGE_ID = '[a-z0-9]+';

interface LivePage {
  snapshot: PublishSnapshot;
  canonicalUrl: string;
}

type PageLookup = { ok: true; page: LivePage } | { ok: false; status: 404 | 410 };

const loadLivePage = async (repo: PagesRepo, id: string): Promise<PageLookup> => {
  const row = await repo.getPage(id);
  if (!row) return { ok: false, status: 404 };
  if (row.status !== 'published') return { ok: false, status: 410 };
  return { ok: true, page: { snapshot: withChartDataAsOf(publishSnapshotSchema.parse(JSON.parse(row.snapshot_json)), row.updated_at), canonicalUrl: canonicalPageUrl(row.slug, row.id) } };
};

const embedHtml = (html: string, status = 200) => htmlResponse(html, status, EMBED_CACHE_SECONDS, EMBED_HEADERS);

const embedErrorHtml = (status: 404 | 410) =>
  embedHtml(status === 410 ? renderGoneHtml('Page removed', 'The author unpublished this page.', true) : renderGoneHtml('Not found', 'This embed does not exist.', true), status);

const embedOptionsFromQuery = (c: AppContext): Required<EmbedOptions> => ({
  theme: parseEmbedTheme(c.req.query('theme')),
  hideData: c.req.query('data') === '0',
});

/** https://sheetcanvas.com/p/<slug>-<id> or /e/... → embed target (+ options kept from an /e/ URL). */
export const parseEmbeddableUrl = (raw: string): { target: EmbedTarget; options: EmbedOptions } | null => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname) || url.port) return null;
  const options: EmbedOptions = { theme: parseEmbedTheme(url.searchParams.get('theme')), hideData: url.searchParams.get('data') === '0' };
  const pageMatch = url.pathname.match(new RegExp(`^/p/(?:[\\w-]*-)?(${PAGE_ID})$`));
  if (pageMatch) return { target: { kind: 'page', pageId: pageMatch[1] }, options: {} };
  const pageEmbed = url.pathname.match(new RegExp(`^/e/p/(${PAGE_ID})$`));
  if (pageEmbed) return { target: { kind: 'page', pageId: pageEmbed[1] }, options };
  const chartEmbed = url.pathname.match(new RegExp(`^/e/c/(${PAGE_ID})/(\\d{1,3})$`));
  if (chartEmbed) return { target: { kind: 'chart', pageId: chartEmbed[1], chartIndex: Number(chartEmbed[2]) }, options };
  return null;
};

const clampToMax = (preferred: number, max: string | undefined) => {
  const limit = Number(max);
  return Number.isFinite(limit) && limit > 0 ? Math.min(preferred, Math.floor(limit)) : preferred;
};

export const registerEmbedRoutes = (app: Hono<PublishEnv>, getRepo: (env: Env) => PagesRepo) => {
  app.get('/e/p/:id', async c => {
    const lookup = await loadLivePage(getRepo(c.env), c.req.param('id'));
    if (!lookup.ok) return embedErrorHtml(lookup.status);
    const { theme, hideData } = embedOptionsFromQuery(c);
    return embedHtml(renderPageEmbedHtml(lookup.page.snapshot, lookup.page.canonicalUrl, theme, hideData));
  });

  app.get('/e/c/:id/:chartIdx', async c => {
    const lookup = await loadLivePage(getRepo(c.env), c.req.param('id'));
    if (!lookup.ok) return embedErrorHtml(lookup.status);
    const index = c.req.param('chartIdx');
    const chart = /^\d+$/.test(index) ? lookup.page.snapshot.charts[Number(index)] : undefined;
    if (!chart) return embedErrorHtml(404);
    const { theme, hideData } = embedOptionsFromQuery(c);
    return embedHtml(renderChartEmbedHtml(chart, `${lookup.page.canonicalUrl}#chart-${chart.id}`, theme, hideData));
  });

  app.get('/oembed', async c => {
    const format = c.req.query('format') ?? 'json';
    if (format !== 'json') return c.json({ error: { code: 'not_implemented', message: 'Only format=json is supported' } }, 501);
    const parsed = parseEmbeddableUrl(c.req.query('url') ?? '');
    if (!parsed) return c.json({ error: { code: 'not_found', message: 'Not a SheetCanvas page URL' } }, 404);
    const lookup = await loadLivePage(getRepo(c.env), parsed.target.pageId);
    if (!lookup.ok) return c.json({ error: { code: 'not_found', message: 'Page not found' } }, 404);
    const { snapshot } = lookup.page;
    const { target } = parsed;
    const chart = target.kind === 'chart' ? snapshot.charts[target.chartIndex] : undefined;
    if (target.kind === 'chart' && !chart) return c.json({ error: { code: 'not_found', message: 'Chart not found' } }, 404);
    const title = chart?.title ?? snapshot.title;
    const width = clampToMax(EMBED_DEFAULT_WIDTH, c.req.query('maxwidth'));
    const height = clampToMax(EMBED_DEFAULT_HEIGHT[target.kind], c.req.query('maxheight'));
    const src = `${SITE_ORIGIN}${embedPath(target, parsed.options)}`;
    return c.json(
      {
        version: '1.0',
        type: 'rich',
        title,
        provider_name: 'SheetCanvas',
        provider_url: `${SITE_ORIGIN}/`,
        html: embedIframeHtml(src, title, height),
        width,
        height,
        thumbnail_url: `${SITE_ORIGIN}/og/${target.pageId}.png`,
        thumbnail_width: 1200,
        thumbnail_height: 630,
        cache_age: EMBED_CACHE_SECONDS,
      },
      200,
      { 'cache-control': `public, max-age=${EMBED_CACHE_SECONDS}` }
    );
  });
};
