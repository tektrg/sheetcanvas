export const SITE_ORIGIN = 'https://sheetcanvas.com';

export const EXCLUDED_PUBLIC_DIRS = new Set(['landing-page-design']);

export const ROUTE_ORDER = [
  '/',
  '/learn/',
  '/docs/',
  '/blog/',
  '/blog/csv-dashboard-from-local-files/',
  '/blog/google-analytics-dashboard-canvas/',
  '/blog/clickhouse-query-dashboard-canvas/',
  '/use-cases/spreadsheet-canvas/',
  '/use-cases/csv-to-dashboard/',
  '/use-cases/local-spreadsheet-app/',
  '/use-cases/data-analysis-canvas/',
  '/connect-agent/',
  '/connectors/clickhouse/',
  '/connectors/google-analytics/',
  '/alternatives/excel/',
  '/alternatives/google-sheets/',
  '/alternatives/airtable/',
  '/privacy/',
  '/terms/',
];

const ROUTE_METADATA = {
  '/': { changefreq: 'weekly', priority: '1.0' },
  '/learn/': { changefreq: 'monthly', priority: '0.7' },
  '/docs/': { changefreq: 'monthly', priority: '0.6' },
  '/blog/': { changefreq: 'weekly', priority: '0.55' },
  '/privacy/': { changefreq: 'yearly', priority: '0.3' },
  '/terms/': { changefreq: 'yearly', priority: '0.3' },
};

const DEFAULT_ROUTE_METADATA = {
  changefreq: 'monthly',
  priority: '0.55',
};

export function metadataForRoute(routePath) {
  if (routePath.startsWith('/use-cases/')) {
    return { changefreq: 'monthly', priority: '0.6' };
  }
  return ROUTE_METADATA[routePath] ?? DEFAULT_ROUTE_METADATA;
}
