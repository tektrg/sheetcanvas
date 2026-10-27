// Shared HTML response for public pages (/p/*) and embeds (/e/*). Both are
// script-free; only embeds may be framed by other sites.

const BASE_CSP = "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'";
/** /p/* (and every non-embed HTML page): never framable, so its report form cannot be clickjacked. */
export const PAGE_CSP = `${BASE_CSP}; frame-ancestors 'none'`;
/** /e/*: same lockdown, but any site may iframe it. */
export const EMBED_CSP = `${BASE_CSP}; frame-ancestors *`;

export const htmlResponse = (html: string, status: number, cacheSeconds: number, extraHeaders: Record<string, string> = {}) =>
  new Response(html, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}`,
      'x-content-type-options': 'nosniff',
      'content-security-policy': PAGE_CSP,
      ...extraHeaders,
    },
  });
