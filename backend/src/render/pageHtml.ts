import type { PublishedChart, PublishSnapshot } from '../../../shared/publishSnapshot';
import { renderChartSvg } from './chartSvg';
import { renderDataTable } from './dataTable';
import { escapeHtml, jsonForScript } from './escape';
import { CHART_PLACEHOLDER_PREFIX, plainExcerpt, renderNoteHtml } from './noteHtml';

// Full public page for /p/<slug>-<id>. Pieces (figure, styles, document shell)
// are exported separately so the embed renderer (embedHtml.ts) reuses them.

export const SITE_ORIGIN = 'https://sheetcanvas.com';
export const NOINDEX_WORD_THRESHOLD = 150;

export interface PageMeta {
  id: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  wordCount: number;
}

export const canonicalPageUrl = (slug: string, id: string) => `${SITE_ORIGIN}/p/${slug}-${id}`;
export const oembedDiscoveryUrl = (pageUrl: string) => `${SITE_ORIGIN}/oembed?url=${encodeURIComponent(pageUrl)}&format=json`;
export const ogImageUrl = (id: string, updatedAt: number) => `${SITE_ORIGIN}/og/${id}.png?v=${updatedAt}`;

export const LIGHT_THEME_VARS = '--bg:#fff;--fg:#111827;--muted:#6b7280;--line:#e5e7eb;--accent:#4f46e5;--code:#f9fafb;--chart-bg:#fff;--chart-text:#4b5563;--chart-grid:#e5e7eb;--chart-axis:#9ca3af';
export const DARK_THEME_VARS = '--bg:#111318;--fg:#e5e7eb;--muted:#9ca3af;--line:#2d3139;--accent:#a5b4fc;--code:#1b1e25;--chart-bg:#16191f;--chart-text:#c4c9d2;--chart-grid:#2d3139;--chart-axis:#6b7280';

export const PAGE_STYLES = `
:root{color-scheme:light dark;${LIGHT_THEME_VARS}}
@media (prefers-color-scheme:dark){:root{${DARK_THEME_VARS}}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}
main{display:block;width:100%;max-width:760px;margin-left:auto;margin-right:auto;padding:40px 16px 24px}
article{overflow-wrap:anywhere}
article table{display:block;max-width:100%;overflow-x:auto}
h1{font-size:2rem;line-height:1.2;margin:0 0 8px}
.meta{color:var(--muted);font-size:.875rem;margin:0 0 32px}
article img{max-width:100%;height:auto}
article a{color:var(--accent)}
article pre{overflow-x:auto;background:var(--code);padding:12px;border-radius:6px}
article table{border-collapse:collapse}
figure.chart{margin:32px 0}
figure.chart svg{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:8px}
figure.chart svg{background:var(--chart-bg)}
figure.chart .cs-bg{fill:var(--chart-bg)}
figure.chart .cs-text{fill:var(--chart-text)}
figure.chart .cs-grid{stroke:var(--chart-grid)}
figure.chart .cs-axis{stroke:var(--chart-axis)}
figure.chart .cs-sep{stroke:var(--chart-bg)}
@media (max-width:600px){figure.chart svg text{font-size:15px}}
figure.chart figcaption{font-weight:600;margin-top:8px}
.data-table{margin-top:8px;font-size:.875rem}
.data-table summary{cursor:pointer;color:var(--muted)}
.table-scroll{overflow-x:auto}
.data-table table{border-collapse:collapse;width:100%;margin-top:8px}
.data-table th,.data-table td{border-bottom:1px solid var(--line);padding:4px 8px;text-align:right;white-space:nowrap}
.data-table th[scope=row],.data-table thead th:first-child{text-align:left}
.table-note{color:var(--muted);font-size:.8rem}
footer{width:100%;max-width:760px;margin:48px auto 0;padding:24px 16px 40px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:.875rem}
footer a{color:var(--accent)}
.cta{font-weight:600;text-decoration:none}
.cta:hover{text-decoration:underline}
.report{color:var(--muted)}
`;

/** One chart as a <figure>: inline SVG + its capped data table (unless hideData). */
export const renderChartFigure = (chart: PublishedChart): string =>
  `<figure class="chart" id="chart-${escapeHtml(chart.id)}">${renderChartSvg(chart)}<figcaption>${escapeHtml(chart.title)}</figcaption>${renderDataTable(chart)}</figure>`;

const chartDatasetJsonLd = (chart: PublishedChart, pageUrl: string) => ({
  '@type': 'Dataset',
  name: chart.title || 'Chart data',
  description: `Data behind the chart "${chart.title}" (${chart.rows.length} rows; ${chart.series.map(s => s.label).join(', ')}).`,
  url: `${pageUrl}#chart-${chart.id}`,
  variableMeasured: chart.series.map(s => s.label),
  isAccessibleForFree: true,
});

/** Body HTML: note content with chart placeholders replaced by figures; unreferenced charts appended. */
export const renderArticleBody = (snapshot: PublishSnapshot): string => {
  const chartsById = new Map(snapshot.charts.map(chart => [chart.id, chart]));
  const used = new Set<string>();
  const placeholder = new RegExp(`(?:<p>)?\\s*${CHART_PLACEHOLDER_PREFIX}:([\\w-]+)\\s*(?:</p>)?`, 'g');
  // The page title is the only <h1>; headings inside the note drop one level.
  const noteHtml = renderNoteHtml(snapshot.content, snapshot.format).replace(/<(\/?)h1\b/g, '<$1h2');
  const body = noteHtml.replace(placeholder, (_, id: string) => {
    const chart = chartsById.get(id);
    if (!chart) return '';
    used.add(id);
    return renderChartFigure(chart);
  });
  const extra = snapshot.charts.filter(chart => !used.has(chart.id)).map(renderChartFigure).join('');
  return body + extra;
};

export const pageDescription = (snapshot: PublishSnapshot): string =>
  snapshot.description?.trim() || plainExcerpt(renderNoteHtml(snapshot.content, snapshot.format)) || `${snapshot.title} — made with SheetCanvas`;

/** Complete HTML document for a published page. */
export const renderPageHtml = (snapshot: PublishSnapshot, meta: PageMeta): string => {
  const url = canonicalPageUrl(meta.slug, meta.id);
  const description = pageDescription(snapshot);
  const title = snapshot.title;
  const image = ogImageUrl(meta.id, meta.updatedAt);
  const robots = meta.wordCount < NOINDEX_WORD_THRESHOLD ? 'noindex, follow' : 'index, follow, max-image-preview:large';
  const created = new Date(meta.createdAt).toISOString();
  const updated = new Date(meta.updatedAt).toISOString();
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Article',
        headline: title.slice(0, 110),
        description,
        url,
        mainEntityOfPage: url,
        image,
        datePublished: created,
        dateModified: updated,
        keywords: snapshot.tags.join(', ') || undefined,
        publisher: { '@type': 'Organization', name: 'SheetCanvas', url: SITE_ORIGIN },
      },
      ...snapshot.charts.filter(chart => !chart.hideData).map(chart => chartDatasetJsonLd(chart, url)),
    ],
  };
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<meta name="robots" content="${robots}">
<link rel="canonical" href="${e(url)}">
<link rel="alternate" type="application/json+oembed" href="${e(oembedDiscoveryUrl(url))}" title="${e(title)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:site_name" content="SheetCanvas">
<meta property="og:image" content="${e(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${e(title)}">
<meta name="twitter:description" content="${e(description)}">
<meta name="twitter:image" content="${e(image)}">
<script type="application/ld+json">${jsonForScript(jsonLd)}</script>
<style>${PAGE_STYLES}</style>
</head>
<body>
<main>
<h1>${e(title)}</h1>
<p class="meta">Updated <time datetime="${updated}">${updated.slice(0, 10)}</time></p>
<article>${renderArticleBody(snapshot)}</article>
</main>
<footer>
<a class="cta" href="${SITE_ORIGIN}/?utm_source=published_page&amp;utm_medium=footer">Made with SheetCanvas — turn your spreadsheets into pages like this</a>
<a class="report" href="${SITE_ORIGIN}/api/pages/${e(meta.id)}/report" rel="nofollow">Report / request removal</a>
</footer>
</body>
</html>`;
};

/** Minimal page for 410 Gone / 404. */
/** `inFrame`: shown inside a host iframe, so the home link opens a new tab instead of navigating the frame. */
export const renderGoneHtml = (heading: string, message: string, inFrame = false): string =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(heading)}</title><style>${PAGE_STYLES}</style></head><body><main><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><p><a href="${SITE_ORIGIN}/"${inFrame ? ' target="_blank" rel="noopener"' : ''}>Go to SheetCanvas</a></p></main></body></html>`;
