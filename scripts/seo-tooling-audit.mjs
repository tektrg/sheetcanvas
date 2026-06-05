import { existsSync } from 'node:fs';
import { join } from 'node:path';

function auditExpectedSnippets({ label, readText, reportError, scriptPath, missingMessage, expectedSnippets }) {
  if (!existsSync(scriptPath)) {
    reportError(label, missingMessage);
    return;
  }

  const script = readText(scriptPath);
  for (const { snippet, message } of expectedSnippets) {
    if (!script.includes(snippet)) {
      reportError(label, message);
    }
  }
}

export function auditDeployScript({ readText, reportError }) {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const label = 'source:package.json';

  if (!existsSync(packageJsonPath)) {
    reportError(label, 'missing package.json.');
    return;
  }

  const packageJson = JSON.parse(readText(packageJsonPath));
  const expectedScripts = new Map([
    [
      'deploy:pages',
      'npm run seo:audit && node scripts/seo-deploy-preflight.mjs && wrangler pages deploy dist --project-name sheetcanvas --branch main && npm run seo:live:root -- --retries 6 --retry-delay-ms 10000 && npm run seo:live:support -- --retries 6 --retry-delay-ms 10000',
    ],
    ['seo:deploy:smoke', 'node scripts/seo-deploy-preflight-smoke.mjs'],
    ['seo:analytics:smoke', 'node scripts/seo-support-analytics-smoke.mjs'],
    ['seo:gsc', 'node scripts/search-console-report.mjs'],
    ['seo:gsc:smoke', 'node scripts/search-console-report-smoke.mjs'],
    ['seo:root:analytics:smoke', 'node scripts/seo-root-analytics-smoke.mjs'],
    ['seo:llms', 'node scripts/generate-llms.mjs'],
    ['seo:live:root', 'node scripts/seo-live-root-check.mjs'],
    ['seo:live:support', 'node scripts/seo-live-support-check.mjs'],
    ['seo:rss', 'node scripts/generate-rss.mjs'],
    [
      'seo:audit',
      'npm run seo:sitemap && npm run seo:rss && npm run seo:llms && npm run seo:gsc:smoke && npm run seo:root:analytics:smoke && npm run seo:analytics:smoke && npm run seo:deploy:smoke && npm run build && node scripts/seo-audit.mjs',
    ],
  ]);

  for (const [scriptName, expectedScript] of expectedScripts) {
    const actualScript = packageJson.scripts?.[scriptName] ?? '';
    if (actualScript !== expectedScript) {
      reportError(label, `${scriptName} should be "${expectedScript}", found "${actualScript || 'nothing'}".`);
    }
  }
}

export function auditDeployPreflightScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/seo-deploy-preflight.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/seo-deploy-preflight.mjs'),
    missingMessage: 'missing deploy preflight script.',
    expectedSnippets: [
      {
        snippet: "const OVERRIDE_ENV = 'SHEETCANVAS_ALLOW_APP_DIRTY_DEPLOY';",
        message: 'must expose an explicit override for intentional app/backend deploys.',
      },
      {
        snippet: "'backend/'",
        message: 'must block dirty backend runtime paths by default.',
      },
      {
        snippet: "'components/'",
        message: 'must block dirty frontend component paths by default.',
      },
      {
        snippet: "'index.html'",
        message: 'must block dirty root app shell metadata changes by default.',
      },
      {
        snippet: "'public/landing-page-design/'",
        message: 'must block dirty app-owned public onboarding assets by default.',
      },
      {
        snippet: "spawnSync('git', ['status', '--porcelain']",
        message: 'must inspect the current git working tree before deploy.',
      },
      {
        snippet: '.flatMap(parseStatusPaths)',
        message: 'must inspect both sides of renamed or copied status paths.',
      },
      {
        snippet: 'Deploy preflight failed: app/backend runtime files are dirty.',
        message: 'must print an actionable dirty-runtime deploy failure.',
      },
    ],
  });
}

export function auditDeployPreflightSmokeScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/seo-deploy-preflight-smoke.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/seo-deploy-preflight-smoke.mjs'),
    missingMessage: 'missing deploy preflight smoke test.',
    expectedSnippets: [
      {
        snippet: 'public-only dirty page should pass',
        message: 'must verify SEO support page edits can still deploy.',
      },
      {
        snippet: 'runtime-to-public rename should fail',
        message: 'must verify runtime-to-public renames cannot bypass the guard.',
      },
      {
        snippet: 'dirty root app shell should fail',
        message: 'must verify root app shell changes are blocked.',
      },
      {
        snippet: 'dirty app-owned public onboarding asset should fail',
        message: 'must verify app-owned public onboarding assets are blocked.',
      },
      {
        snippet: 'SHEETCANVAS_ALLOW_APP_DIRTY_DEPLOY',
        message: 'must verify the intentional dirty app deploy override.',
      },
    ],
  });
}

export function auditSearchConsoleScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/search-console-report.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/search-console-report.mjs'),
    missingMessage: 'missing Search Console reporting wrapper.',
    expectedSnippets: [
      {
        snippet: "const DEFAULT_GSC_REPORT_BIN = '/Users/trungluong/clawd/bin/gsc-report';",
        message: 'must default to the global Search Console reporting wrapper.',
      },
      {
        snippet: 'process.env.SHEETCANVAS_GSC_REPORT_BIN',
        message: 'must allow overriding the Search Console reporting binary.',
      },
      {
        snippet: "const DEFAULT_SITE_URL = 'sc-domain:sheetcanvas.com';",
        message: 'must default to the SheetCanvas domain property.',
      },
      {
        snippet: "const DEFAULT_OUTPUT_DIR = 'reports/seo/search-console';",
        message: 'must default report output to the gitignored Search Console report folder.',
      },
      {
        snippet: "hasOption(finalArgs, '--stdout-only')",
        message: 'must honor --stdout-only without adding the default output directory.',
      },
      {
        snippet: "hasOption(finalArgs, '--output-dir')",
        message: 'must honor a custom --output-dir without adding the default output directory.',
      },
    ],
  });
}

export function auditSearchConsoleSmokeScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/search-console-report-smoke.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/search-console-report-smoke.mjs'),
    missingMessage: 'missing Search Console reporting smoke test.',
    expectedSnippets: [
      {
        snippet: 'SHEETCANVAS_GSC_REPORT_BIN',
        message: 'must smoke-test the wrapper through an override reporter binary.',
      },
      {
        snippet: "DEFAULT_SITE_URL = 'sc-domain:sheetcanvas.com'",
        message: 'must assert the SheetCanvas domain property default.',
      },
      {
        snippet: "'--stdout-only'",
        message: 'must verify stdout-only mode avoids default report writes.',
      },
      {
        snippet: "'--output-dir'",
        message: 'must verify custom and default output-directory behavior.',
      },
    ],
  });
}

export function auditRootAnalyticsSmokeScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/seo-root-analytics-smoke.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/seo-root-analytics-smoke.mjs'),
    missingMessage: 'missing root analytics attribution smoke test.',
    expectedSnippets: [
      {
        snippet: "sessionStorage.getItem('sheetcanvas:support-entry')",
        message: 'must execute the root support-entry attribution script.',
      },
      {
        snippet: 'support_entry_path',
        message: 'must verify support_entry_path is attached to the root GA4 config.',
      },
      {
        snippet: 'support_entry_title',
        message: 'must verify support_entry_title is attached to the root GA4 config.',
      },
      {
        snippet: '45 * 60 * 1000',
        message: 'must verify expired support-entry context is not attributed.',
      },
    ],
  });
}

export function auditLiveRootCheckScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/seo-live-root-check.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/seo-live-root-check.mjs'),
    missingMessage: 'missing live root SEO parity check.',
    expectedSnippets: [
      {
        snippet: "getFirstSchemaByType(html, 'WebSite', label)",
        message: 'must compare live root WebSite schema against audited source.',
      },
      {
        snippet: 'websitePublisherName',
        message: 'must include publisher details in live root WebSite parity checks.',
      },
      {
        snippet: 'websiteLanguage',
        message: 'must include language in live root WebSite parity checks.',
      },
    ],
  });
}

export function auditLiveSupportCheckScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/seo-live-support-check.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/seo-live-support-check.mjs'),
    missingMessage: 'missing live support SEO discovery check.',
    expectedSnippets: [
      {
        snippet: 'ROUTE_ORDER.filter((routePath) => routePath !==',
        message: 'must derive support routes from the shared route order.',
      },
      {
        snippet: 'Sitemap: ${sitemapIndexUrl}',
        message: 'must verify live robots.txt points to the sitemap index.',
      },
      {
        snippet: "hasSchemaType(html, 'WebPage'",
        message: 'must verify live support pages expose WebPage JSON-LD.',
      },
      {
        snippet: "hasSchemaType(html, 'BreadcrumbList'",
        message: 'must verify live support pages expose BreadcrumbList JSON-LD.',
      },
      {
        snippet: "hasSchemaType(html, 'BlogPosting'",
        message: 'must verify live blog posts expose BlogPosting JSON-LD.',
      },
    ],
  });
}

export function auditRssGeneratorScript({ readText, reportError }) {
  auditExpectedSnippets({
    label: 'source:scripts/generate-rss.mjs',
    readText,
    reportError,
    scriptPath: join(process.cwd(), 'scripts/generate-rss.mjs'),
    missingMessage: 'missing RSS generator script.',
    expectedSnippets: [
      {
        snippet: "const BLOG_DIR = join(process.cwd(), 'public', 'blog');",
        message: 'must discover the public blog directory.',
      },
      {
        snippet: "findSchemaByType(schema, 'BlogPosting')",
        message: 'must read BlogPosting JSON-LD for feed entries.',
      },
      {
        snippet: ".filter((item) => !item.isBlogRoot)",
        message: 'must exclude the blog hub from RSS item output.',
      },
      {
        snippet: "Generated public/rss.xml",
        message: 'must write the source RSS feed when blog metadata changes.',
      },
    ],
  });
}
