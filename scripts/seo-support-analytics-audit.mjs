import { existsSync } from 'node:fs';
import { join, sep } from 'node:path';

export const SUPPORT_ANALYTICS_PATH = '/seo-support-analytics.js';
export const SUPPORT_ANALYTICS_EVENT_NAME = 'support_open_app_click';

export function hasSupportAnalyticsScript(html) {
  return new RegExp(`<script\\b(?=[^>]*\\bsrc=["']${SUPPORT_ANALYTICS_PATH}["'])(?=[^>]*\\bdefer\\b)[^>]*>\\s*</script>`, 'i')
    .test(html);
}

export function auditSupportAnalyticsScriptInPage(html, pageLabel, reportError) {
  if (!hasSupportAnalyticsScript(html)) {
    reportError(pageLabel, `support page must load ${SUPPORT_ANALYTICS_PATH} with defer for pageview and app CTA tracking.`);
  }
}

function getAnchorAttribute(anchorHtml, attributeName) {
  const attributePattern = new RegExp(`${attributeName}=["']([^"']+)["']`, 'i');
  return anchorHtml.match(attributePattern)?.[1]?.trim() ?? '';
}

function stripHtml(value) {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isRootAppHref(href) {
  if (href === '/') {
    return true;
  }

  try {
    const url = new URL(href, 'https://sheetcanvas.com/');
    return url.origin === 'https://sheetcanvas.com' && url.pathname === '/';
  } catch (error) {
    return false;
  }
}

function isTrackableAppCtaLabel(label) {
  return /open (sheetcanvas|app)/i.test(label.trim());
}

export function auditSupportAnalyticsCtaInPage(html, pageLabel, reportError) {
  const hasTrackableAppCta = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)]
    .some((match) => {
      const anchorHtml = match[0];
      const href = getAnchorAttribute(anchorHtml, 'href');
      if (!isRootAppHref(href)) {
        return false;
      }

      const ariaLabel = getAnchorAttribute(anchorHtml, 'aria-label');
      const textLabel = stripHtml(anchorHtml.replace(/<a\b[^>]*>/i, '').replace(/<\/a>$/i, ''));
      return isTrackableAppCtaLabel(textLabel) || isTrackableAppCtaLabel(ariaLabel);
    });

  if (!hasTrackableAppCta) {
    reportError(pageLabel, 'support page must include at least one root app CTA trackable by support_open_app_click.');
  }
}

export function auditSupportAnalyticsAsset(rootPath, readText, reportError) {
  const isDistRoot = rootPath.endsWith(`${sep}dist`);
  const assetRoot = isDistRoot ? rootPath : join(rootPath, 'public');
  const analyticsPath = join(assetRoot, SUPPORT_ANALYTICS_PATH.slice(1));
  const label = `${isDistRoot ? 'dist' : 'source'}:support-analytics`;

  if (!existsSync(analyticsPath)) {
    reportError(label, `missing ${SUPPORT_ANALYTICS_PATH}.`);
    return;
  }

  const script = readText(analyticsPath);
  const requiredSnippets = [
    'G-FDXZ468S02',
    SUPPORT_ANALYTICS_EVENT_NAME,
    'transport_type',
    'beacon',
    'SEO support page',
    'page_title',
    'link_url',
    'support_page_path',
    'support_page_title',
    'debug_ga',
    'debug_mode',
    'withDebugMode',
  ];

  for (const snippet of requiredSnippets) {
    if (!script.includes(snippet)) {
      reportError(label, `${SUPPORT_ANALYTICS_PATH} must include "${snippet}".`);
    }
  }

  const pageviewConfigMatch = script.match(/window\.gtag\('config',\s*measurementId,\s*(?:withDebugMode\()?{\s*(?<config>[\s\S]*?)\n\s*}\)?\);/);
  const pageviewConfig = pageviewConfigMatch?.groups?.config ?? '';
  for (const pageviewParameter of ['support_page_path', 'support_page_title']) {
    if (!pageviewConfig.includes(pageviewParameter)) {
      reportError(label, `${SUPPORT_ANALYTICS_PATH} must attach "${pageviewParameter}" to the GA4 pageview config.`);
    }
  }
}
