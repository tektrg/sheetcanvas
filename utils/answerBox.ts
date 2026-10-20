import type { NotePublishSettings } from '../types';
import { ANSWER_BOX_LIMITS, type AnswerBox, type FaqItem, type PublishSnapshot } from '../shared/publishSnapshot';
import { getBearer, getOrCreateSessionId } from '../src/agent/useAgentSession';
import { ApiError, getBackendBaseUrl } from './backendApi';

// Answer box (TL;DR + Q&A under a published page title): AI draft client and the
// editor's pure helpers. Drafts are suggestions; only the author's "Use this" +
// "Save" put text into note.publish.answerBox.

export type AnswerBoxDraft = Required<AnswerBox>;
export type SavedAnswerBox = NonNullable<NotePublishSettings['answerBox']>;

export const EMPTY_ANSWER_BOX: AnswerBoxDraft = { summary: '', faq: [] };

/** Ask the backend (Gemini via AI SDK) to draft a summary + 3 Q&As from the page snapshot. */
export const requestAnswerBoxDraft = async (snapshot: PublishSnapshot): Promise<AnswerBoxDraft> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'x-session-id': getOrCreateSessionId() };
  const bearer = getBearer();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`${getBackendBaseUrl()}/api/pages/answer-box`, { method: 'POST', headers, body: JSON.stringify(snapshot) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.message || `AI draft failed (${res.status})`, res.status, json?.error?.code);
  return { summary: json?.draft?.summary ?? '', faq: json?.draft?.faq ?? [] };
};

/** Editor state → what gets saved: trimmed, blanks dropped, undefined when nothing is left. */
export const toSavedAnswerBox = (box: AnswerBoxDraft): SavedAnswerBox | undefined => {
  const summary = box.summary.trim();
  const faq: FaqItem[] = box.faq.map(item => ({ q: item.q.trim(), a: item.a.trim() })).filter(item => item.q && item.a);
  return summary || faq.length ? { ...(summary ? { summary } : {}), ...(faq.length ? { faq } : {}) } : undefined;
};

/** Messages for anything the server would reject; empty = savable. */
export const answerBoxProblems = (box: AnswerBoxDraft): string[] => {
  const problems: string[] = [];
  if (box.summary.trim().length > ANSWER_BOX_LIMITS.summaryChars) problems.push(`Summary is over ${ANSWER_BOX_LIMITS.summaryChars} characters.`);
  if (box.faq.length > ANSWER_BOX_LIMITS.faqItems) problems.push(`At most ${ANSWER_BOX_LIMITS.faqItems} questions.`);
  box.faq.forEach((item, index) => {
    const n = index + 1;
    if (item.q.trim().length > ANSWER_BOX_LIMITS.questionChars) problems.push(`Question ${n} is over ${ANSWER_BOX_LIMITS.questionChars} characters.`);
    if (item.a.trim().length > ANSWER_BOX_LIMITS.answerChars) problems.push(`Answer ${n} is over ${ANSWER_BOX_LIMITS.answerChars} characters.`);
    if (!!item.q.trim() !== !!item.a.trim()) problems.push(`Question ${n} needs both a question and an answer.`);
  });
  return problems;
};
