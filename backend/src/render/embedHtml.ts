import type { PublishedChart, PublishSnapshot } from '../../../shared/publishSnapshot';
import type { EmbedTheme } from '../../../shared/embed';
import { escapeHtml } from './escape';
import { DARK_THEME_VARS, LIGHT_THEME_VARS, PAGE_STYLES, renderArticleBody, renderChartFigure } from './pageHtml';

// Minimal, script-free documents for /e/p (whole page) and /e/c (one chart):
// no site header, compact footer backlink to the canonical /p/ page.

const EMBED_STYLES = `
main{max-width:none;padding:16px}
h1{font-size:1.4rem}
figure.chart{margin:0 0 8px}
footer.embed-footer{max-width:none;margin:0;padding:8px 16px 12px;border-top:1px solid var(--line);font-size:.8rem;justify-content:flex-end}
`;

/** Later rules beat PAGE_STYLES' media query, so a forced theme wins over the OS setting. */
const themeOverride = (theme: EmbedTheme) =>
  theme === 'light' ? `:root{color-scheme:light;${LIGHT_THEME_VARS}}` : theme === 'dark' ? `:root{color-scheme:dark;${DARK_THEME_VARS}}` : '';

interface EmbedDocument {
  title: string;
  canonicalUrl: string;
  theme: EmbedTheme;
  body: string;
}

const renderEmbedDocument = ({ title, canonicalUrl, theme, body }: EmbedDocument): string => {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${e(title)}</title>
<link rel="canonical" href="${e(canonicalUrl)}">
<style>${PAGE_STYLES}${EMBED_STYLES}${themeOverride(theme)}</style>
</head>
<body>
${body}
<footer class="embed-footer"><a class="cta" href="${e(canonicalUrl)}" target="_blank" rel="noopener">View on SheetCanvas ↗</a></footer>
</body>
</html>`;
};

const withDataHidden = (chart: PublishedChart, hideData: boolean): PublishedChart => (hideData ? { ...chart, hideData: true } : chart);

export const renderPageEmbedHtml = (snapshot: PublishSnapshot, canonicalUrl: string, theme: EmbedTheme, hideData: boolean): string =>
  renderEmbedDocument({
    title: snapshot.title,
    canonicalUrl,
    theme,
    body: `<main><h1>${escapeHtml(snapshot.title)}</h1><article>${renderArticleBody({ ...snapshot, charts: snapshot.charts.map(chart => withDataHidden(chart, hideData)) })}</article></main>`,
  });

export const renderChartEmbedHtml = (chart: PublishedChart, canonicalUrl: string, theme: EmbedTheme, hideData: boolean): string =>
  renderEmbedDocument({
    title: chart.title,
    canonicalUrl,
    theme,
    body: `<main>${renderChartFigure(withDataHidden(chart, hideData))}</main>`,
  });
