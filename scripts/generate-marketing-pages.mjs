#!/usr/bin/env node
// Generates the answer-engine marketing HTML from scripts/marketing/content.mjs:
//   - public/compare/<slug>/index.html (static comparison pages)
//   - public/about/index.html (definition, who/what, FAQ, SoftwareApplication JSON-LD)
// Testimonials come from marketing/testimonials.json and render nothing until real entries exist.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_LINE, COMPARISONS, HOME_FAQS, POSITIONING, PUBLISHED_ON, REVIEWED_ON, WHAT_IT_DOES, WHO_FOR,
} from './marketing/content.mjs';
import {
  SITE_ORIGIN, asOfLabel, escapeHtml, faqSchema, humanDate, renderFaq, renderTestimonials,
} from './marketing/render.mjs';

const ROOT = process.cwd();
const testimonials = JSON.parse(readFileSync(join(ROOT, 'marketing/testimonials.json'), 'utf8')).testimonials;

export const COMPARE_LINKS = COMPARISONS.map((page) => ({
  href: `/compare/${page.slug}/`,
  label: `SheetCanvas vs ${page.competitor}`,
}));

const ORG = {
  '@type': 'Organization',
  name: 'theindie.app',
  url: 'https://theindie.app/',
};

function footerLinks(indent) {
  const links = [
    { href: '/', label: 'Open app' },
    { href: '/about/', label: 'About' },
    { href: '/learn/', label: 'Learn' },
    { href: '/docs/', label: 'Docs' },
    { href: '/connect-agent/', label: 'Connect an agent' },
    ...COMPARE_LINKS,
  ];
  return links.map((link) => `${indent}<a href="${link.href}">${escapeHtml(link.label)}</a>`).join('\n');
}

const PAGE_CSS = `      :root { color-scheme: light; --ink: #121717; --muted: #4b5756; --line: #d8e1df; --paper: #fbfbf8; --panel: #fff; --teal: #0f766e; --teal-dark: #0b4f4a; --warm: #f3efe6; }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      a { color: inherit; }
      .skip-link { position: absolute; left: 16px; top: 12px; transform: translateY(-140%); background: var(--ink); color: #fff; padding: 8px 12px; border-radius: 6px; }
      .skip-link:focus { transform: translateY(0); }
      .site-header, main, .site-footer { width: min(960px, calc(100% - 32px)); margin: 0 auto; }
      .site-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 0; flex-wrap: wrap; }
      .brand { font-weight: 700; text-decoration: none; }
      .nav, .footer-links { display: flex; flex-wrap: wrap; gap: 14px; color: var(--muted); font-size: 14px; }
      .nav a, .footer-links a { text-decoration: none; }
      .nav a:hover, .footer-links a:hover { color: var(--ink); text-decoration: underline; }
      h1 { font-size: clamp(32px, 5vw, 52px); line-height: 1.05; margin: 0 0 16px; }
      h2 { font-size: clamp(24px, 3vw, 32px); line-height: 1.15; margin: 0 0 12px; }
      .hero { padding: 48px 0 32px; border-top: 1px solid var(--line); }
      .lede { font-size: 19px; color: var(--muted); max-width: 720px; }
      .dates { color: var(--muted); font-size: 14px; }
      .section { padding: 40px 0; border-top: 1px solid var(--line); }
      .answer { border: 1px solid var(--line); border-radius: 8px; background: var(--panel); padding: 22px; max-width: 760px; }
      .table-wrap { overflow-x: auto; }
      table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); }
      caption { text-align: left; color: var(--muted); font-size: 14px; padding-bottom: 8px; }
      th, td { border-top: 1px solid var(--line); padding: 12px; text-align: left; vertical-align: top; }
      thead th { background: var(--warm); border-top: 0; }
      tbody th { font-weight: 600; }
      .faq dt { font-weight: 700; margin-top: 18px; }
      .faq dd { margin: 4px 0 0; color: var(--muted); }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 20px; }
      .button { display: inline-flex; min-height: 44px; align-items: center; border: 1px solid var(--line); border-radius: 8px; padding: 10px 16px; text-decoration: none; font-weight: 700; background: #fff; }
      .button-primary { background: var(--teal); border-color: var(--teal); color: #fff; }
      .testimonial { margin: 0 0 16px; padding: 18px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; }
      .testimonial blockquote { margin: 0; }
      .testimonial figcaption { color: var(--muted); font-size: 14px; }
      .site-footer { padding: 28px 0 40px; border-top: 1px solid var(--line); color: var(--muted); }`;

function pageShell({ url, title, description, schema, main, footerNote = '' }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <link rel="canonical" href="${url}">
    <link rel="alternate" type="application/rss+xml" title="SheetCanvas Blog RSS" href="${SITE_ORIGIN}/rss.xml">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="SheetCanvas">
    <meta property="og:title" content="${escapeHtml(title)}">
    <meta property="og:description" content="${escapeHtml(description)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${SITE_ORIGIN}/brand/sheetcanvas-og.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="SheetCanvas spreadsheet canvas preview">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${escapeHtml(title)}">
    <meta name="twitter:description" content="${escapeHtml(description)}">
    <meta name="twitter:image" content="${SITE_ORIGIN}/brand/sheetcanvas-og.png">
    <meta name="theme-color" content="#0f766e">
    <link rel="icon" type="image/svg+xml" href="/brand/sheetcanvas-logo.svg">
    <link rel="manifest" href="/manifest.webmanifest">
    <script type="application/ld+json">
${JSON.stringify(schema, null, 2)}
    </script>
    <style>
${PAGE_CSS}
    </style>
    <script src="/seo-support-analytics.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <a class="brand" href="/" aria-label="Open SheetCanvas app">SheetCanvas</a>
      <nav class="nav" aria-label="Main navigation">
        <a href="/about/">About</a>
        <a href="/learn/">Learn</a>
        <a href="/docs/">Docs</a>
        <a href="/connect-agent/">Connect an agent</a>
      </nav>
    </header>

${main}    </main>

    <footer class="site-footer">
      <p>SheetCanvas is built by <a href="https://theindie.app/">theindie.app</a>. ${footerNote}</p>
      <nav class="footer-links" aria-label="Footer links">
${footerLinks('        ')}
      </nav>
    </footer>
  </body>
</html>
`;
}

function renderComparePage(page) {
  const url = `${SITE_ORIGIN}/compare/${page.slug}/`;
  const asOf = asOfLabel(REVIEWED_ON);
  const otherLinks = COMPARE_LINKS.filter((link) => link.href !== `/compare/${page.slug}/`);
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'WebPage',
        name: page.title,
        url,
        description: page.description,
        datePublished: PUBLISHED_ON,
        dateModified: REVIEWED_ON,
        isPartOf: { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, name: 'SheetCanvas', url: `${SITE_ORIGIN}/` },
        about: [
          { '@type': 'SoftwareApplication', name: 'SheetCanvas', applicationCategory: 'BusinessApplication', operatingSystem: 'Web', url: `${SITE_ORIGIN}/` },
          { '@type': 'SoftwareApplication', name: page.competitorFull },
        ],
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'SheetCanvas', item: `${SITE_ORIGIN}/` },
            { '@type': 'ListItem', position: 2, name: `SheetCanvas vs ${page.competitor}`, item: url },
          ],
        },
      },
      faqSchema(page.faqs, url),
    ],
  };
  const rows = page.rows
    .map(([label, ours, theirs]) => `            <tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(ours)}</td><td>${escapeHtml(theirs)}</td></tr>`)
    .join('\n');
  const testimonialsHtml = renderTestimonials(testimonials);

  const main = `    <main id="main">
      <article>
        <header class="hero">
          <h1>SheetCanvas vs ${escapeHtml(page.competitor)}</h1>
          <p class="lede">${escapeHtml(POSITIONING)} ${escapeHtml(page.competitorFull)} is a different kind of tool; this page compares them by use case.</p>
          <p class="dates">Published <time datetime="${PUBLISHED_ON}">${humanDate(PUBLISHED_ON)}</time> · Last reviewed: ${humanDate(REVIEWED_ON)} · Facts as of ${asOf}</p>
        </header>

        <section class="section" aria-labelledby="answer-title">
          <h2 id="answer-title">${escapeHtml(page.question)}</h2>
          <div class="answer">
${page.answer.map((p) => `            <p>${escapeHtml(p)}</p>`).join('\n')}
          </div>
        </section>

        <section class="section" aria-labelledby="table-title">
          <h2 id="table-title">SheetCanvas and ${escapeHtml(page.competitor)} compared (as of ${asOf})</h2>
          <div class="table-wrap">
          <table>
            <caption>Feature comparison by area. Competitor details reflect public product information as of ${asOf}; check the vendor for current plans.</caption>
            <thead><tr><th scope="col">Area</th><th scope="col">SheetCanvas</th><th scope="col">${escapeHtml(page.competitorFull)}</th></tr></thead>
            <tbody>
${rows}
            </tbody>
          </table>
          </div>
        </section>

${renderFaq(page.faqs)}
${testimonialsHtml}
        <section class="section" aria-labelledby="next-title">
          <h2 id="next-title">Try it or keep reading</h2>
          <div class="actions">
            <a class="button button-primary" href="/">Open SheetCanvas</a>
            <a class="button" href="${page.related}">Related guide</a>
${otherLinks.map((link) => `            <a class="button" href="${link.href}">${escapeHtml(link.label)}</a>`).join('\n')}
          </div>
        </section>
      </article>
`;
  return pageShell({ url, title: page.title, description: page.description, schema, main,
    footerNote: `${escapeHtml(page.competitorFull)} is a trademark of its owner; this page is not affiliated with or endorsed by it.` });
}

function renderAboutPage() {
  const url = `${SITE_ORIGIN}/about/`;
  const title = 'About SheetCanvas: free visual canvas for spreadsheets, charts and notes';
  const description = POSITIONING;
  const schema = {
    '@context': 'https://schema.org',
    '@graph': [
      ORG,
      {
        '@type': 'WebPage',
        name: 'About SheetCanvas',
        url,
        description,
        datePublished: PUBLISHED_ON,
        dateModified: REVIEWED_ON,
        isPartOf: { '@type': 'WebSite', '@id': `${SITE_ORIGIN}/#website`, name: 'SheetCanvas', url: `${SITE_ORIGIN}/` },
        mainEntity: { '@id': `${SITE_ORIGIN}/#app` },
        breadcrumb: {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'SheetCanvas', item: `${SITE_ORIGIN}/` },
            { '@type': 'ListItem', position: 2, name: 'About', item: url },
          ],
        },
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_ORIGIN}/#app`,
        name: 'SheetCanvas',
        description,
        applicationCategory: 'BusinessApplication',
        applicationSubCategory: 'Spreadsheet',
        operatingSystem: 'Web',
        isAccessibleForFree: true,
        url: `${SITE_ORIGIN}/`,
        screenshot: `${SITE_ORIGIN}/brand/sheetcanvas-og.png`,
        featureList: WHAT_IT_DOES,
        publisher: ORG,
      },
      faqSchema(HOME_FAQS, url),
    ],
  };
  const main = `    <main id="main">
      <article>
        <header class="hero">
          <h1>About SheetCanvas</h1>
          <p class="lede">${escapeHtml(POSITIONING)}</p>
          <p>${escapeHtml(AGENT_LINE)}</p>
          <p class="dates">Published <time datetime="${PUBLISHED_ON}">${humanDate(PUBLISHED_ON)}</time> · Last reviewed: ${humanDate(REVIEWED_ON)} · Features as of ${asOfLabel(REVIEWED_ON)}</p>
          <div class="actions"><a class="button button-primary" href="/">Open SheetCanvas</a></div>
        </header>
        <section class="section" aria-labelledby="what-title">
          <h2 id="what-title">What is SheetCanvas and what can it do?</h2>
          <ul>
${WHAT_IT_DOES.map((item) => `            <li>${escapeHtml(item)}</li>`).join('\n')}
          </ul>
        </section>
        <section class="section" aria-labelledby="who-title">
          <h2 id="who-title">Who is SheetCanvas for?</h2>
          <ul>
${WHO_FOR.map((item) => `            <li><strong>${escapeHtml(item.who)}</strong> ${escapeHtml(item.why)}</li>`).join('\n')}
          </ul>
        </section>
        <section class="section" aria-labelledby="compare-title">
          <h2 id="compare-title">How does SheetCanvas compare?</h2>
          <ul>
${COMPARE_LINKS.map((link) => `            <li><a href="${link.href}">${escapeHtml(link.label)}</a></li>`).join('\n')}
          </ul>
        </section>
${renderFaq(HOME_FAQS)}
${renderTestimonials(testimonials)}
      </article>
    </main>
`;
  return pageShell({ url, title, description, schema, main });
}

for (const page of COMPARISONS) {
  const dir = join(ROOT, 'public/compare', page.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), renderComparePage(page));
}

mkdirSync(join(ROOT, 'public/about'), { recursive: true });
writeFileSync(join(ROOT, 'public/about/index.html'), renderAboutPage());

console.log(`Generated ${COMPARISONS.length} comparison pages and /about/.`);
