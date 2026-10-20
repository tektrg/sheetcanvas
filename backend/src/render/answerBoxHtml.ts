import type { FaqItem, PublishSnapshot } from '../../../shared/publishSnapshot';
import { escapeHtml } from './escape';

// Author-reviewed "answer box" on /p/: a TL;DR under the title and an FAQ section,
// shaped so AI answer engines can lift a self-contained answer. Escaped text only.

const paragraphs = (text: string) =>
  text.split(/\n{2,}/).map(part => `<p>${escapeHtml(part.trim()).replace(/\n/g, '<br>')}</p>`).join('');

/** Summary block. Its <h2> is the page's main question (first FAQ question) when there is an FAQ. */
export const renderSummaryHtml = (snapshot: Pick<PublishSnapshot, 'summary' | 'faq'>): string => {
  const summary = snapshot.summary?.trim();
  if (!summary) return '';
  const heading = snapshot.faq?.[0]?.q ?? 'Summary';
  return `<section class="answer-summary" aria-label="Summary"><h2>${escapeHtml(heading)}</h2>${paragraphs(summary)}</section>`;
};

export const renderFaqHtml = (faq: FaqItem[] | undefined): string =>
  faq?.length
    ? `<section class="faq" id="faq"><h2>Frequently asked questions</h2>${faq.map(item => `<h3>${escapeHtml(item.q)}</h3>${paragraphs(item.a)}`).join('')}</section>`
    : '';

export const faqJsonLd = (faq: FaqItem[] | undefined, pageUrl: string) =>
  faq?.length
    ? [{
      '@type': 'FAQPage',
      '@id': `${pageUrl}#faq`,
      url: pageUrl,
      mainEntity: faq.map(item => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })),
    }]
    : [];

export const ANSWER_BOX_STYLES = `
.answer-summary{border:1px solid var(--line);border-left:4px solid var(--accent);border-radius:8px;padding:12px 16px;margin:0 0 32px}
.answer-summary h2{font-size:1.1rem;margin:0 0 4px}
.answer-summary p{margin:4px 0}
.faq{margin-top:48px;border-top:1px solid var(--line);padding-top:16px}
.faq h3{font-size:1.05rem;margin:20px 0 4px}
.faq p{margin:4px 0}
`;
