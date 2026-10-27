import type { Hono } from 'hono';
import type { Env } from './env';
import type { AccountsResolver } from './accounts';
import type { PagesRepo } from './pagesRepo';
import { htmlResponse } from './htmlResponse';
import { renderGoneHtml } from './render/pageHtml';
import { isIndexablePage, profileUrl, renderProfileHtml, tagCounts, tagUrl } from './render/profileHtml';
import { escapeHtml } from './render/escape';
import { isValidHandle } from '../../shared/theindieAccounts';

// Public author pages: /@handle lists an owner's published pages, and
// /@handle/tag/:tag one tag of them. The handle -> user id mapping lives in
// theindie-api; page ownership lives in D1 (owner_user_id).

type PublishEnv = { Bindings: Env };

export const PROFILE_LIMITS = { pagesPerProfile: 500, sitemapOwnedPages: 5000, sitemapOwners: 500, sitemapMinPages: 2, cacheSeconds: 60 } as const;

const notFound = () => htmlResponse(renderGoneHtml('Profile not found', 'No published pages here.'), 404, 60);

export const registerProfileRoutes = (
  app: Hono<PublishEnv>,
  getRepo: (env: Env) => PagesRepo,
  getAccounts: (env: Env) => AccountsResolver,
) => {
  const load = async (env: Env, rawHandle: string) => {
    const handle = rawHandle.toLowerCase();
    if (!isValidHandle(handle)) return null;
    const profile = await getAccounts(env).profileByHandle(handle);
    if (!profile) return null;
    // One extra row tells us whether the listing was cut off.
    const loaded = await getRepo(env).listOwned(PROFILE_LIMITS.pagesPerProfile + 1, profile.id);
    const truncated = loaded.length > PROFILE_LIMITS.pagesPerProfile;
    const pages = loaded.slice(0, PROFILE_LIMITS.pagesPerProfile);
    return pages.length ? { profile, pages, truncated } : null;
  };

  // Hono cannot mix a literal "@" with a :param in one segment, so match the
  // whole segment and strip the "@".
  const handleParam = (value: string | undefined) => (value ?? '').slice(1);
  app.get('/:at{@[^/]+}', async c => {
    const raw = handleParam(c.req.param('at'));
    if (raw !== raw.toLowerCase()) return c.redirect(`/@${raw.toLowerCase()}`, 301);
    const found = await load(c.env, raw);
    if (!found) return notFound();
    const html = renderProfileHtml({ ...found, allTags: tagCounts(found.pages) });
    return htmlResponse(html, 200, PROFILE_LIMITS.cacheSeconds);
  });

  app.get('/:at{@[^/]+}/tag/:tag', async c => {
    const raw = handleParam(c.req.param('at'));
    const tag = c.req.param('tag') ?? '';
    if (raw !== raw.toLowerCase()) return c.redirect(`/@${raw.toLowerCase()}/tag/${encodeURIComponent(tag)}`, 301);
    const found = await load(c.env, raw);
    const tagged = found?.pages.filter(page => page.tags.includes(tag)) ?? [];
    if (!found || !tagged.length) return notFound();
    const html = renderProfileHtml({ profile: found.profile, pages: tagged, allTags: tagCounts(found.pages), tag, truncated: found.truncated });
    return htmlResponse(html, 200, PROFILE_LIMITS.cacheSeconds);
  });
};

/**
 * Sitemap <url> entries for profiles and tag hubs that have at least
 * `sitemapMinPages` indexable pages. Owners without a handle are skipped.
 */
export const profileSitemapEntries = async (repo: PagesRepo, accounts: AccountsResolver): Promise<string> => {
  const owned = (await repo.listOwned(PROFILE_LIMITS.sitemapOwnedPages)).filter(isIndexablePage);
  const byOwner = new Map<string, typeof owned>();
  owned.forEach(page => byOwner.set(page.owner_user_id, [...(byOwner.get(page.owner_user_id) ?? []), page]));
  const entry = (loc: string, updatedAt: number) => `<url><loc>${escapeHtml(loc)}</loc><lastmod>${new Date(updatedAt).toISOString()}</lastmod></url>`;
  const owners = [...byOwner].filter(([, pages]) => pages.length >= PROFILE_LIMITS.sitemapMinPages).slice(0, PROFILE_LIMITS.sitemapOwners);
  const parts = await Promise.all(
    owners.map(async ([ownerId, pages]) => {
      const profile = await accounts.profileById(ownerId).catch(() => null);
      if (!profile) return '';
      const latest = pages[0].updated_at; // listOwned is newest first
      const tags = tagCounts(pages).filter(({ count }) => count >= PROFILE_LIMITS.sitemapMinPages);
      const tagEntries = tags.map(({ tag }) => entry(tagUrl(profile.handle, tag), pages.find(p => p.tags.includes(tag))!.updated_at));
      return entry(profileUrl(profile.handle), latest) + tagEntries.join('');
    })
  );
  return parts.join('');
};
