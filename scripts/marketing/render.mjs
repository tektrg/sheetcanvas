// Shared HTML renderers for the static marketing pages (homepage prerender + /compare/*).
// Everything here produces plain HTML strings so answer engines can read the facts without JS.

export const SITE_ORIGIN = 'https://sheetcanvas.com';

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-10-20" -> "October 20, 2026" (UTC, no locale drift). */
export function humanDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** "2026-10-20" -> "Oct 2026" for "as of" stamps. */
export function asOfLabel(isoDate) {
  const [year, month] = isoDate.split('-').map(Number);
  return `${MONTHS[month - 1].slice(0, 3)} ${year}`;
}

export function faqSchema(faqs, pageUrl) {
  return {
    '@type': 'FAQPage',
    url: pageUrl,
    mainEntity: faqs.map((faq) => ({
      '@type': 'Question',
      name: faq.q,
      acceptedAnswer: { '@type': 'Answer', text: faq.a },
    })),
  };
}

export function renderFaq(faqs, headingId = 'faq-title', heading = 'Frequently asked questions') {
  const items = faqs
    .map((faq) => `          <div class="faq-item">
            <dt>${escapeHtml(faq.q)}</dt>
            <dd>${escapeHtml(faq.a)}</dd>
          </div>`)
    .join('\n');
  return `      <section class="section" aria-labelledby="${headingId}">
        <h2 id="${headingId}">${escapeHtml(heading)}</h2>
        <dl class="faq">
${items}
        </dl>
      </section>`;
}

/**
 * Only entries that are real, attributed and consented render. An empty list renders
 * nothing at all (no heading, no placeholder) so the site never shows fake social proof.
 */
export function publishableTestimonials(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.filter((entry) => (
    entry
    && entry.consent === true
    && typeof entry.quote === 'string' && entry.quote.trim()
    && typeof entry.name === 'string' && entry.name.trim()
  ));
}

export function renderTestimonials(entries) {
  const items = publishableTestimonials(entries);
  if (items.length === 0) return '';
  const quotes = items
    .map((entry) => {
      const role = [entry.role, entry.company].filter(Boolean).map(escapeHtml).join(', ');
      const cite = entry.sourceUrl
        ? `<a href="${escapeHtml(entry.sourceUrl)}">${escapeHtml(entry.name)}</a>`
        : escapeHtml(entry.name);
      return `          <figure class="testimonial">
            <blockquote><p>${escapeHtml(entry.quote)}</p></blockquote>
            <figcaption>${cite}${role ? `, ${role}` : ''}</figcaption>
          </figure>`;
    })
    .join('\n');
  return `      <section class="section" aria-labelledby="testimonials-title">
        <h2 id="testimonials-title">What people say about SheetCanvas</h2>
        <div class="testimonials">
${quotes}
        </div>
      </section>`;
}

/** Replace the text between `<!-- name:start -->` and `<!-- name:end -->`. */
export function replaceBetweenMarkers(source, name, replacement) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end);
  if (startIndex === -1 || endIndex === -1 || endIndex < startIndex) {
    throw new Error(`Markers for "${name}" not found.`);
  }
  return `${source.slice(0, startIndex + start.length)}\n${replacement}\n${source.slice(endIndex)}`;
}
