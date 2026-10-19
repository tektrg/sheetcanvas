import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Env } from './env';
import { HttpError, toJsonError } from './errors';
import { createD1PagesRepo, type PagesRepo, type PublishedPageRow, type PublishEventKind } from './pagesRepo';
import {
  MAX_PUBLISH_BODY_BYTES,
  publishSnapshotSchema,
  slugifyTitle,
  type PublishCreatedResponse,
  type PublishSnapshot,
  type PublishUpdatedResponse,
} from '../../shared/publishSnapshot';
import { canonicalPageUrl, pageDescription, renderGoneHtml, renderPageHtml, SITE_ORIGIN } from './render/pageHtml';
import { countWords, renderNoteHtml } from './render/noteHtml';
import { escapeHtml } from './render/escape';

// Anonymous publish: POST creates a page and returns a one-time edit key; PUT /
// DELETE require it (X-Edit-Key). Public routes render the frozen snapshot as
// static HTML — no DOM, no connector access.

export const PUBLISH_LIMITS = {
  publishesPerHour: 10,
  republishesPerHour: 120,
  reportsPerHour: 20,
  pageCacheSeconds: 60,
  sitemapMaxPages: 5000,
} as const;
const HOUR_MS = 60 * 60 * 1000;
const PAGE_ID_LENGTH = 10;
const PAGE_ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/brand/sheetcanvas-og.png`;

type PublishEnv = { Bindings: Env };
type AppContext = Context<PublishEnv>;

const reportSchema = z.object({
  reason: z.enum(['spam', 'abuse', 'copyright', 'privacy', 'my_content', 'other']),
  details: z.string().max(2000).default(''),
  contact: z.string().max(200).default(''),
});

const toHex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
export const sha256Hex = async (value: string) => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));

const randomBase64Url = (byteLength: number) => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const newPageId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(PAGE_ID_LENGTH));
  return [...bytes].map(b => PAGE_ID_ALPHABET[b % PAGE_ID_ALPHABET.length]).join('');
};

const constantTimeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const clientIpHash = (c: AppContext) =>
  sha256Hex(`sheetcanvas-publish:${c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'unknown'}`);

/** Read + validate the JSON snapshot body: 413 over the size cap, 400 on schema errors. */
const readSnapshot = async (c: AppContext): Promise<PublishSnapshot> => {
  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > MAX_PUBLISH_BODY_BYTES) throw new HttpError(413, 'payload_too_large', `Page exceeds ${MAX_PUBLISH_BODY_BYTES / 1024}KB`);
  const raw = await c.req.arrayBuffer();
  if (raw.byteLength > MAX_PUBLISH_BODY_BYTES) throw new HttpError(413, 'payload_too_large', `Page exceeds ${MAX_PUBLISH_BODY_BYTES / 1024}KB`);
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Body must be JSON');
  }
  const parsed = publishSnapshotSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, 'invalid_snapshot', `${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`);
  }
  return parsed.data;
};

const enforceRateLimit = async (repo: PagesRepo, ipHash: string, kind: PublishEventKind, now: number) => {
  const limit = { publish: PUBLISH_LIMITS.publishesPerHour, republish: PUBLISH_LIMITS.republishesPerHour, report: PUBLISH_LIMITS.reportsPerHour }[kind];
  if ((await repo.countEvents(ipHash, kind, now - HOUR_MS)) >= limit) {
    throw new HttpError(429, 'rate_limited', `Too many ${kind === 'report' ? 'reports' : `${kind}es`} from this network. Try again within the hour.`);
  }
  await repo.recordEvent(ipHash, kind, now);
};

const derivedFields = (snapshot: PublishSnapshot) => ({
  slug: slugifyTitle(snapshot.title),
  title: snapshot.title,
  description: pageDescription(snapshot),
  snapshot_json: JSON.stringify(snapshot),
  word_count: countWords(renderNoteHtml(snapshot.content, snapshot.format)),
});

/** Load a page and check X-Edit-Key: 404 unknown, 403 wrong/missing key. */
const authorizePageEdit = async (c: AppContext, repo: PagesRepo): Promise<PublishedPageRow> => {
  const page = await repo.getPage(c.req.param('id') ?? '');
  if (!page) throw new HttpError(404, 'not_found', 'Page not found');
  const key = c.req.header('x-edit-key') ?? '';
  if (!key || !constantTimeEqual(await sha256Hex(key), page.edit_key_hash)) {
    throw new HttpError(403, 'forbidden', 'Invalid edit key');
  }
  return page;
};

// Cache key is id-based and host-independent so republish can purge it.
const pageCacheKey = (id: string) => new Request(`${SITE_ORIGIN}/__page-cache/${id}`);
const edgeCache = (): Cache | null => (typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null);
const purgePageCache = async (id: string) => {
  try {
    await edgeCache()?.delete(pageCacheKey(id));
  } catch {
    // Purge is best effort; the 60s TTL bounds staleness.
  }
};

/** waitUntil when running in Workers; outside (tests) just let the promise settle. */
const runInBackground = (c: AppContext, task: Promise<unknown>) => {
  const settled = task.catch(() => {});
  try {
    c.executionCtx.waitUntil(settled);
  } catch {
    // No ExecutionContext (unit tests).
  }
};

/** "/p/my-title-abc123" → { id: "abc123", slug: "my-title" }. */
export const parseSlugId = (slugId: string) => {
  const dash = slugId.lastIndexOf('-');
  return dash === -1 ? { id: slugId, slug: '' } : { id: slugId.slice(dash + 1), slug: slugId.slice(0, dash) };
};

const htmlResponse = (html: string, status: number, cacheSeconds: number) =>
  new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
    },
  });

const reportFormHtml = (id: string, done: boolean) =>
  renderGoneHtml(
    done ? 'Report received' : 'Report this page',
    done ? 'Thank you. We review every report.' : ''
  ).replace(
    '<p></p>',
    done
      ? ''
      : `<form method="post" action="/api/pages/${escapeHtml(id)}/report"><p><label>Reason <select name="reason"><option value="spam">Spam</option><option value="abuse">Abusive or illegal</option><option value="copyright">Copyright</option><option value="privacy">Private information</option><option value="my_content">This is my content — remove it</option><option value="other">Other</option></select></label></p><p><label>Details<br><textarea name="details" rows="4" cols="50" maxlength="2000"></textarea></label></p><p><label>Contact (optional)<br><input name="contact" maxlength="200"></label></p><p><button type="submit">Send report</button></p></form>`
  );

export const createPublishApp = (getRepo: (env: Env) => PagesRepo, now: () => number = Date.now) => {
  const app = new Hono<PublishEnv>();
  app.onError((err, c) => {
    const { status, body } = toJsonError(err);
    if (status >= 500) console.error('[publish] error', err instanceof Error ? err.message : err);
    return c.json(body, status);
  });

  app.post('/api/pages', async c => {
    const repo = getRepo(c.env);
    const snapshot = await readSnapshot(c);
    const at = now();
    await enforceRateLimit(repo, await clientIpHash(c), 'publish', at);
    const id = newPageId();
    const editKey = randomBase64Url(32);
    const fields = derivedFields(snapshot);
    await repo.insertPage({ id, edit_key_hash: await sha256Hex(editKey), status: 'published', created_at: at, updated_at: at, ...fields });
    const body: PublishCreatedResponse = { id, slug: fields.slug, url: canonicalPageUrl(fields.slug, id), editKey };
    return c.json(body, 201);
  });

  app.put('/api/pages/:id', async c => {
    const repo = getRepo(c.env);
    const page = await authorizePageEdit(c, repo);
    const snapshot = await readSnapshot(c);
    await enforceRateLimit(repo, await clientIpHash(c), 'republish', now());
    const fields = derivedFields(snapshot);
    await repo.updatePage(page.id, { ...fields, status: 'published', updated_at: now() });
    await purgePageCache(page.id);
    const body: PublishUpdatedResponse = { id: page.id, slug: fields.slug, url: canonicalPageUrl(fields.slug, page.id) };
    return c.json(body);
  });

  app.delete('/api/pages/:id', async c => {
    const repo = getRepo(c.env);
    const page = await authorizePageEdit(c, repo);
    // Drop the content, keep the row so the URL answers 410 Gone.
    await repo.updatePage(page.id, { status: 'unpublished', snapshot_json: '{}', updated_at: now() });
    await purgePageCache(page.id);
    return c.json({ id: page.id, status: 'unpublished' });
  });

  app.get('/api/pages/:id/report', c => htmlResponse(reportFormHtml(c.req.param('id'), false), 200, 0));

  app.post('/api/pages/:id/report', async c => {
    const repo = getRepo(c.env);
    const id = c.req.param('id');
    if (!(await repo.getPage(id))) throw new HttpError(404, 'not_found', 'Page not found');
    const isForm = (c.req.header('content-type') ?? '').includes('form');
    const raw = isForm ? await c.req.parseBody() : await c.req.json().catch(() => ({}));
    const parsed = reportSchema.safeParse(raw);
    if (!parsed.success) throw new HttpError(400, 'invalid_report', 'reason is required');
    const ipHash = await clientIpHash(c);
    await enforceRateLimit(repo, ipHash, 'report', now());
    await repo.insertReport({ id: crypto.randomUUID(), page_id: id, ip_hash: ipHash, created_at: now(), ...parsed.data });
    return isForm ? htmlResponse(reportFormHtml(id, true), 200, 0) : c.json({ ok: true }, 201);
  });

  app.get('/p/:slugid', async c => {
    const { id, slug } = parseSlugId(c.req.param('slugid'));
    const cache = edgeCache();
    const cached = await cache?.match(pageCacheKey(id)).catch(() => undefined);
    let page: PublishedPageRow | null = null;
    if (!cached) page = await getRepo(c.env).getPage(id);
    const pageSlug = cached?.headers.get('x-page-slug') ?? page?.slug;
    if (!cached && (!page || !pageSlug)) return htmlResponse(renderGoneHtml('Page not found', 'This page does not exist.'), 404, 60);
    if (page?.status === 'unpublished') return htmlResponse(renderGoneHtml('Page removed', 'The author unpublished this page.'), 410, 60);
    if (slug !== pageSlug) return c.redirect(`/p/${pageSlug}-${id}`, 301);
    if (cached) return new Response(cached.body, cached);
    const snapshot = publishSnapshotSchema.parse(JSON.parse(page!.snapshot_json));
    const html = renderPageHtml(snapshot, {
      id,
      slug: page!.slug,
      createdAt: page!.created_at,
      updatedAt: page!.updated_at,
      wordCount: page!.word_count,
    });
    const response = htmlResponse(html, 200, PUBLISH_LIMITS.pageCacheSeconds);
    response.headers.set('x-page-slug', page!.slug);
    if (cache) runInBackground(c, cache.put(pageCacheKey(id), response.clone()));
    return response;
  });

  app.get('/sitemap-pages.xml', async c => {
    const pages = await getRepo(c.env).listPublished(PUBLISH_LIMITS.sitemapMaxPages);
    const urls = pages
      .filter(page => page.word_count >= 150)
      .map(page => `<url><loc>${escapeHtml(canonicalPageUrl(page.slug, page.id))}</loc><lastmod>${new Date(page.updated_at).toISOString()}</lastmod></url>`)
      .join('');
    return c.body(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`, 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=300',
    });
  });

  app.get('/llms-pages.txt', async c => {
    const pages = await getRepo(c.env).listPublished(PUBLISH_LIMITS.sitemapMaxPages);
    const lines = pages
      .filter(page => page.word_count >= 150)
      .map(page => `- [${page.title.replace(/[[\]\n]/g, ' ')}](${canonicalPageUrl(page.slug, page.id)}): ${page.description.replace(/\n/g, ' ')}`);
    const text = `# SheetCanvas published pages\n\n> Data stories published by SheetCanvas users. Each page has inline SVG charts with their data tables.\n\n## Pages\n\n${lines.join('\n')}\n`;
    return c.body(text, 200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=300' });
  });

  app.get('/og/:file', async c => {
    const id = c.req.param('file').replace(/\.png$/, '');
    const page = await getRepo(c.env).getPage(id);
    if (!page || page.status !== 'published') return c.redirect(DEFAULT_OG_IMAGE, 302);
    const snapshot = publishSnapshotSchema.safeParse(JSON.parse(page.snapshot_json));
    const chart = snapshot.success ? snapshot.data.charts[0] : undefined;
    if (!chart) return c.redirect(DEFAULT_OG_IMAGE, 302);
    const cache = edgeCache();
    const key = new Request(`${SITE_ORIGIN}/__og-cache/${id}/${page.updated_at}`);
    const cached = await cache?.match(key).catch(() => undefined);
    if (cached) return cached;
    try {
      const { renderOgPng } = await import('./render/ogImage');
      const png = await renderOgPng(chart, page.title);
      const response = new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } });
      if (cache) runInBackground(c, cache.put(key, response.clone()));
      return response;
    } catch (err) {
      console.error('[publish] og render failed', err instanceof Error ? err.message : err);
      return c.redirect(DEFAULT_OG_IMAGE, 302);
    }
  });

  return app;
};

export const publishApp = createPublishApp(env => createD1PagesRepo(env.DB));
