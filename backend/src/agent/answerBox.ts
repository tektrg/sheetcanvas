import type { Context } from 'hono';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { ANSWER_BOX_LIMITS, answerBoxSchema, publishSnapshotSchema, type AnswerBox, type PublishSnapshot } from '../../../shared/publishSnapshot';
import { plainExcerpt, renderNoteHtml } from '../render/noteHtml';
import { checkAndIncrementQuota } from './quota';

// "Answer box" drafting for the Publish panel: Gemini (Vercel AI SDK) reads the
// page snapshot and proposes a TL;DR + 3 Q&As. The draft goes back to the author
// for editing; nothing here publishes. Counts against the Copilot daily quota.

const DEFAULT_MODEL = 'gemini-2.5-flash';
const DRAFT_FAQ_COUNT = 3;
const NOTE_TEXT_CHARS = 12_000;
const CHART_ROWS_IN_PROMPT = 40;

/** Model output: exactly 3 Q&As, same per-field limits as the publish schema. */
const draftSchema = z.object({
  summary: z.string().describe(`Direct answer to the page's main question, plain text, at most ${ANSWER_BOX_LIMITS.summaryChars} characters.`),
  faq: z.array(z.object({
    q: z.string().describe(`A question a reader would ask a search engine, at most ${ANSWER_BOX_LIMITS.questionChars} characters.`),
    a: z.string().describe(`Self-contained answer with concrete numbers from the data, at most ${ANSWER_BOX_LIMITS.answerChars} characters.`),
  })).length(DRAFT_FAQ_COUNT),
});
type Draft = z.infer<typeof draftSchema>;

export type AnswerBoxGenerator = (prompt: string, env: Env) => Promise<Draft>;

const geminiGenerator: AnswerBoxGenerator = async (prompt, env) => {
  const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) throw new HttpError(503, 'missing_api_key', 'AI drafting is not configured on this server');
  const google = createGoogleGenerativeAI({ apiKey });
  const { object } = await generateObject({
    model: google(env.AGENT_MODEL?.trim() || DEFAULT_MODEL),
    schema: draftSchema,
    system: 'You write the answer box for a published data page. Use only facts and numbers present in the page text and chart data. No marketing tone, no markdown, no invented figures. The first question must be the main question the page answers; the summary must answer it directly.',
    prompt,
  });
  return object;
};

/** Local-dev stand-in (ANSWER_BOX_FAKE=1 + ENVIRONMENT=development): echoes the prompt's title. */
const localFakeGenerator: AnswerBoxGenerator = async prompt => {
  const title = prompt.match(/^Title: (.*)$/m)?.[1] ?? 'this page';
  return {
    summary: `Draft summary of "${title}" (local fake generator, not AI).`,
    faq: [1, 2, 3].map(n => ({ q: `Draft question ${n} about ${title}?`, a: `Draft answer ${n} (local fake generator).` })),
  };
};

const pickGenerator = (env: Env, fallback: AnswerBoxGenerator): AnswerBoxGenerator =>
  env.ANSWER_BOX_FAKE === '1' && (env.ENVIRONMENT ?? '').toLowerCase() === 'development' ? localFakeGenerator : fallback;

const chartDigest = (chart: PublishSnapshot['charts'][number]) => {
  const header = `Chart "${chart.title}" (${chart.type}); columns: label, ${chart.series.map(s => s.label).join(', ')}`;
  const rows = chart.rows.slice(0, CHART_ROWS_IN_PROMPT).map(row => `${row.label}: ${row.values.map(v => v ?? '').join(', ')}`);
  const more = chart.rows.length > CHART_ROWS_IN_PROMPT ? [`… ${chart.rows.length - CHART_ROWS_IN_PROMPT} more rows`] : [];
  return [header, ...rows, ...more].join('\n');
};

export const answerBoxPrompt = (snapshot: PublishSnapshot): string => {
  const text = plainExcerpt(renderNoteHtml(snapshot.content, snapshot.format), NOTE_TEXT_CHARS);
  return [`Title: ${snapshot.title}`, `Page text:\n${text || '(none)'}`, ...snapshot.charts.filter(c => !c.hideData).map(chartDigest)].join('\n\n');
};

/** Clamp a model draft to the publish limits so the editor never starts invalid. */
export const clampDraft = (draft: Draft): AnswerBox => answerBoxSchema.parse({
  summary: draft.summary.trim().slice(0, ANSWER_BOX_LIMITS.summaryChars),
  faq: draft.faq
    .map(item => ({ q: item.q.trim().slice(0, ANSWER_BOX_LIMITS.questionChars), a: item.a.trim().slice(0, ANSWER_BOX_LIMITS.answerChars) }))
    .filter(item => item.q && item.a)
    .slice(0, ANSWER_BOX_LIMITS.faqItems),
});

/** POST /api/pages/answer-box — body: a publish snapshot; returns { draft: {summary, faq} }. */
export const createAnswerBoxHandler = (generate: AnswerBoxGenerator = geminiGenerator) => async (c: Context<{ Bindings: Env }>) => {
  const sessionId = c.req.header('x-session-id')?.trim() ?? '';
  if (sessionId.length < 8 || sessionId.length > 80) throw new HttpError(400, 'missing_session', 'x-session-id header is required');
  const parsed = publishSnapshotSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) throw new HttpError(400, 'invalid_snapshot', 'Body must be a page snapshot');
  const quota = await checkAndIncrementQuota(c.env, sessionId);
  if (quota.remaining < 0 || quota.used > quota.limit) throw new HttpError(429, 'quota_exceeded', `Daily AI limit reached (${quota.limit}).`);
  const draft = clampDraft(await pickGenerator(c.env, generate)(answerBoxPrompt(parsed.data), c.env));
  return c.json({ draft });
};
