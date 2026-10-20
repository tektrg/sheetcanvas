import { marked } from 'marked';
import { escapeHtml } from './escape';

// Note content → safe HTML for public pages. Markdown goes through `marked`,
// then everything (markdown output or legacy HTML) passes one allowlist
// sanitizer. Same tag policy as the in-app renderer (components/mdx/MarkdownNote.tsx).

const ALLOWED_TAGS = new Set([
  'p', 'br', 'hr', 'span', 'div', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark',
  'small', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'pre', 'code', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th',
  'td', 'figure', 'figcaption',
]);
const VOID_TAGS = new Set(['br', 'hr', 'img']);
// Content of these is dropped entirely, not just the tag.
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math']);
const SAFE_URL = /^(https?:|mailto:|\/|#)/i;

export const CHART_PLACEHOLDER_PREFIX = 'SCCHART';
const CHART_TAG = /<CanvasChart\b[^>]*?\bid=["']([^"']+)["'][^>]*?\/?>(?:\s*<\/CanvasChart>)?/g;
const OTHER_COMPONENT_TAG = /<(CellValue|Sparkline)\b[^>]*?\/?>(?:\s*<\/\1>)?/g;
const TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>|<!--[\s\S]*?-->/g;
const ATTR_PATTERN = /([a-zA-Z-:]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

const decodeAttr = (value: string) =>
  value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const safeAttributes = (tag: string, rawAttrs: string): string => {
  const kept: string[] = [];
  for (const match of rawAttrs.matchAll(ATTR_PATTERN)) {
    const name = match[1].toLowerCase();
    const value = decodeAttr(match[3] ?? match[4] ?? match[5] ?? '').trim();
    const allowedUrl = SAFE_URL.test(value);
    if (tag === 'a' && name === 'href' && allowedUrl) kept.push(`href="${escapeHtml(value)}" rel="nofollow ugc noopener"`);
    else if (tag === 'img' && name === 'src' && /^https:/i.test(value)) kept.push(`src="${escapeHtml(value)}" loading="lazy"`);
    else if (tag === 'img' && name === 'alt') kept.push(`alt="${escapeHtml(value)}"`);
    else if ((tag === 'th' || tag === 'td') && (name === 'colspan' || name === 'rowspan') && /^\d{1,2}$/.test(value)) kept.push(`${name}="${value}"`);
  }
  return kept.length ? ` ${kept.join(' ')}` : '';
};

/** Allowlist sanitizer: unknown tags stripped (text kept), all attributes dropped except safe links/images. */
export const sanitizeHtml = (html: string): string => {
  let output = '';
  let cursor = 0;
  let dropDepth = 0;
  let dropTag = '';
  for (const match of html.matchAll(TAG_PATTERN)) {
    const text = html.slice(cursor, match.index);
    cursor = match.index! + match[0].length;
    if (!dropDepth) output += text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (!match[1]) continue; // comment
    const tag = match[1].toLowerCase();
    const closing = match[0].startsWith('</');
    if (DROP_WITH_CONTENT.has(tag)) {
      if (!closing && !match[0].endsWith('/>')) {
        if (!dropDepth) dropTag = tag;
        if (tag === dropTag) dropDepth++;
      } else if (closing && tag === dropTag && dropDepth) dropDepth--;
      continue;
    }
    if (dropDepth || !ALLOWED_TAGS.has(tag)) continue;
    if (closing) output += VOID_TAGS.has(tag) ? '' : `</${tag}>`;
    else output += `<${tag}${safeAttributes(tag, match[2])}>`;
  }
  if (!dropDepth) output += html.slice(cursor).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return output;
};

/**
 * Note content → sanitized HTML. Each <CanvasChart id="x"/> becomes a
 * standalone placeholder `SCCHART:x` (own paragraph) for pageHtml to swap
 * for a figure; other live components (CellValue, Sparkline) are dropped.
 */
export const renderNoteHtml = (content: string, format: 'html' | 'markdown'): string => {
  const withPlaceholders = content
    .replace(CHART_TAG, (_, id: string) => `\n\n${CHART_PLACEHOLDER_PREFIX}:${id.replace(/[^\w-]/g, '')}\n\n`)
    .replace(OTHER_COMPONENT_TAG, '');
  const html = format === 'markdown' ? (marked.parse(withPlaceholders, { async: false, gfm: true }) as string) : withPlaceholders;
  return sanitizeHtml(html);
};

/** Visible words of rendered HTML (tags/placeholders excluded) — drives the noindex threshold. */
export const countWords = (html: string): number => {
  const text = html
    .replace(new RegExp(`${CHART_PLACEHOLDER_PREFIX}:[\\w-]+`, 'g'), ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ');
  return text.split(/\s+/).filter(word => /[\p{L}\p{N}]/u.test(word)).length;
};

/** First ~160 chars of visible text, for meta description fallback. */
export const plainExcerpt = (html: string, max = 160): string => {
  const text = html
    .replace(new RegExp(`${CHART_PLACEHOLDER_PREFIX}:[\\w-]+`, 'g'), ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
};
