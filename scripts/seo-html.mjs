export function getTitle(html) {
  return html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
}

export function getAttribute(html, tagPattern, attributeName) {
  const tag = html.match(tagPattern)?.[0] ?? '';
  const attributePattern = new RegExp(`${attributeName}=["']([^"']+)["']`, 'i');
  return tag.match(attributePattern)?.[1]?.trim() ?? '';
}

export function getMetaContent(html, selectorName, selectorValue) {
  const escapedValue = selectorValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return getAttribute(
    html,
    new RegExp(`<meta\\b(?=[^>]*\\b${selectorName}=["']${escapedValue}["'])[^>]*>`, 'i'),
    'content',
  );
}

export function getCanonical(html) {
  return getAttribute(html, /<link\b(?=[^>]*\brel=["']canonical["'])[^>]*>/i, 'href');
}

export function getAlternateRss(html) {
  const alternateLinks = [...html.matchAll(/<link\b(?=[^>]*\brel=["']alternate["'])[^>]*>/gi)]
    .map((match) => match[0]);
  const rssLink = alternateLinks.find((tag) => getAttribute(tag, /^.*$/i, 'type') === 'application/rss+xml');
  return rssLink ? getAttribute(rssLink, /^.*$/i, 'href') : '';
}

export function getInternalLinks(html, siteOrigin) {
  return [...html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => normalizeInternalLink(match[1], siteOrigin))
    .filter(Boolean);
}

function normalizeInternalLink(href, siteOrigin) {
  if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return null;
  }

  if (href.startsWith(`${siteOrigin}/`)) {
    return new URL(href).pathname;
  }

  if (href.startsWith('/') && !href.startsWith('//')) {
    return href.split('#')[0].split('?')[0];
  }

  return null;
}

export function getVisibleReviewedDate(html) {
  return html.match(/Last reviewed:\s+([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1] ?? '';
}

export function getJsonLdBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

export function flattenSchemaTypes(schema) {
  const values = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const typeValue = node['@type'];
    if (Array.isArray(typeValue)) {
      values.push(...typeValue);
    } else if (typeValue) {
      values.push(typeValue);
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return values;
}

export function findSchemaObjectsByType(schema, schemaType) {
  const matches = [];
  const visit = (node) => {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const typeValue = node['@type'];
    const typeValues = Array.isArray(typeValue) ? typeValue : [typeValue];
    if (typeValues.includes(schemaType)) {
      matches.push(node);
    }
    Object.values(node).forEach(visit);
  };
  visit(schema);
  return matches;
}

export function schemaUrlMatches(value, expectedUrl) {
  if (value === expectedUrl) {
    return true;
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  return value['@id'] === expectedUrl || value.url === expectedUrl;
}

export function schemaUrlValue(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return '';
  }
  return value.url ?? value['@id'] ?? '';
}

export function schemaUrlListMatches(values, expectedUrls) {
  if (values.length !== expectedUrls.length) {
    return false;
  }
  return values.every((value, index) => value === expectedUrls[index]);
}
