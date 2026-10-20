import type { PublicProfile } from '../../../shared/theindieAccounts';
import type { OwnedPageListing } from '../pagesRepo';
import { escapeHtml, jsonForScript } from './escape';
import { canonicalPageUrl, NOINDEX_WORD_THRESHOLD, PAGE_STYLES, SITE_ORIGIN } from './pageHtml';

// Author profile (/@handle) and tag hub (/@handle/tag/:tag): static HTML, no
// script, same styles/CSP as /p/ pages.

/** Site OG card, used when the owner has no avatar. */
export const PROFILE_FALLBACK_IMAGE = `${SITE_ORIGIN}/brand/sheetcanvas-og.png`;

export const profilePath = (handle: string) => `/@${handle}`;
export const tagPath = (handle: string, tag: string) => `/@${handle}/tag/${encodeURIComponent(tag)}`;
export const profileUrl = (handle: string) => `${SITE_ORIGIN}${profilePath(handle)}`;
export const tagUrl = (handle: string, tag: string) => `${SITE_ORIGIN}${tagPath(handle, tag)}`;

export const isIndexablePage = (page: Pick<OwnedPageListing, 'word_count'>) => page.word_count >= NOINDEX_WORD_THRESHOLD;
/** Profile / tag hub gets indexed only with at least one indexable page. */
export const listingRobots = (pages: OwnedPageListing[]) => (pages.some(isIndexablePage) ? 'index, follow' : 'noindex, follow');

/** Tags across pages, most used first (ties alphabetical). */
export const tagCounts = (pages: OwnedPageListing[]): Array<{ tag: string; count: number }> => {
  const counts = new Map<string, number>();
  pages.forEach(page => new Set(page.tags).forEach(tag => counts.set(tag, (counts.get(tag) ?? 0) + 1)));
  return [...counts].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
};

const PROFILE_STYLES = `
.lede{color:var(--muted);margin:0 0 24px}
.tags{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 32px;padding:0;list-style:none}
.tags a{display:inline-block;padding:2px 10px;border:1px solid var(--line);border-radius:999px;color:var(--fg);text-decoration:none;font-size:.875rem}
.tags a:hover,.tags a[aria-current=page]{border-color:var(--accent);color:var(--accent)}
.pages{list-style:none;margin:0;padding:0}
.pages li{padding:16px 0;border-bottom:1px solid var(--line)}
.pages h2{font-size:1.125rem;margin:0 0 4px}
.pages h2 a{color:var(--fg);text-decoration:none}
.pages h2 a:hover{color:var(--accent);text-decoration:underline}
.pages p{margin:0 0 4px}
.pages .meta{margin:0;font-size:.8rem}
.back{font-size:.875rem}
.back a{color:var(--accent)}
`;

interface ListingView {
  profile: PublicProfile;
  pages: OwnedPageListing[];
  allTags: Array<{ tag: string; count: number }>;
  tag?: string;
}

const pageItem = (handle: string, page: OwnedPageListing) => {
  const e = escapeHtml;
  const updated = new Date(page.updated_at).toISOString();
  const chips = page.tags.length
    ? ` · ${page.tags.map(tag => `<a href="${e(tagPath(handle, tag))}">#${e(tag)}</a>`).join(' ')}`
    : '';
  return `<li><h2><a href="/p/${e(page.slug)}-${e(page.id)}">${e(page.title)}</a></h2>${page.description ? `<p>${e(page.description)}</p>` : ''}<p class="meta">Updated <time datetime="${updated}">${updated.slice(0, 10)}</time>${chips}</p></li>`;
};

export const renderProfileHtml = ({ profile, pages, allTags, tag }: ListingView): string => {
  const e = escapeHtml;
  const handle = profile.handle;
  const name = profile.displayName || `@${handle}`;
  const url = tag === undefined ? profileUrl(handle) : tagUrl(handle, tag);
  const title = tag === undefined ? `${name} (@${handle}) — SheetCanvas` : `#${tag} by @${handle} — SheetCanvas`;
  const description = tag === undefined
    ? `${pages.length} data ${pages.length === 1 ? 'page' : 'pages'} published by ${name} on SheetCanvas.`
    : `${pages.length} ${pages.length === 1 ? 'page' : 'pages'} tagged #${tag} by ${name} on SheetCanvas.`;
  const person = { '@type': 'Person', name, alternateName: `@${handle}`, url: profileUrl(handle), ...(profile.avatarUrl ? { image: profile.avatarUrl } : {}) };
  const itemList = {
    '@type': 'ItemList',
    numberOfItems: pages.length,
    itemListElement: pages.map((page, i) => ({ '@type': 'ListItem', position: i + 1, url: canonicalPageUrl(page.slug, page.id), name: page.title })),
  };
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      tag === undefined
        ? { '@type': 'ProfilePage', url, name: title, mainEntity: person }
        : { '@type': 'CollectionPage', url, name: title, description, author: person, isPartOf: { '@type': 'ProfilePage', url: profileUrl(handle) } },
      { ...itemList, url },
    ],
  };
  const chips = allTags.length
    ? `<ul class="tags" aria-label="Tags">${allTags.map(({ tag: t, count }) => `<li><a href="${e(tagPath(handle, t))}"${t === tag ? ' aria-current="page"' : ''}>#${e(t)} <span class="count">${count}</span></a></li>`).join('')}</ul>`
    : '';
  const heading = tag === undefined ? e(name) : `#${e(tag)}`;
  const lede = tag === undefined ? `@${e(handle)}` : `Pages by <a href="${e(profilePath(handle))}">@${e(handle)}</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<meta name="robots" content="${listingRobots(pages)}">
<link rel="canonical" href="${e(url)}">
<meta property="og:type" content="${tag === undefined ? 'profile' : 'website'}">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:site_name" content="SheetCanvas">
<meta property="og:image" content="${e(profile.avatarUrl || PROFILE_FALLBACK_IMAGE)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<script type="application/ld+json">${jsonForScript(jsonLd)}</script>
<style>${PAGE_STYLES}${PROFILE_STYLES}</style>
</head>
<body>
<main>
<h1>${heading}</h1>
<p class="lede">${lede}</p>
${chips}
<ol class="pages">${pages.map(page => pageItem(handle, page)).join('')}</ol>
</main>
<footer>
<a class="cta" href="${SITE_ORIGIN}/?utm_source=profile_page&amp;utm_medium=footer">Made with SheetCanvas — publish your own data pages</a>
</footer>
</body>
</html>`;
};
