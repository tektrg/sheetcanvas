import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../env';
import { toJsonError } from '../errors';
import { answerBoxPrompt, createAnswerBoxHandler, type AnswerBoxGenerator } from '../agent/answerBox';
import type { PublishSnapshot } from '../../../shared/publishSnapshot';

const snapshot: PublishSnapshot = {
  version: 1, title: 'Churn Q3', tags: [], format: 'markdown', content: 'Churn fell to **2%**.\n\n<CanvasChart id="c1" />',
  charts: [
    { id: 'c1', title: 'Churn', type: 'line', series: [{ key: 'v', label: 'Churn %', color: '#4f46e5' }], rows: [{ label: 'Jul', values: [3] }, { label: 'Sep', values: [2] }] },
    { id: 'c2', title: 'Secret', type: 'bar', hideData: true, series: [{ key: 'v', label: 'Salary', color: '#4f46e5' }], rows: [{ label: 'Ann', values: [9] }] },
  ],
};

const appWith = (generate: AnswerBoxGenerator, env: Partial<Env> = { ENVIRONMENT: 'development' }) => {
  const app = new Hono<{ Bindings: Env }>();
  app.onError((err, c) => { const { status, body } = toJsonError(err); return c.json(body, status); });
  app.post('/draft', createAnswerBoxHandler(generate));
  return (body: unknown, sessionId = 'session-12345') =>
    app.request('/draft', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': sessionId }, body: JSON.stringify(body) }, env as Env);
};

describe('answer box drafting', () => {
  it('builds the prompt from note text and visible chart data only', () => {
    const prompt = answerBoxPrompt(snapshot);
    expect(prompt).toContain('Title: Churn Q3');
    expect(prompt).toMatch(/Churn fell to 2% ?\./);
    expect(prompt).toContain('Jul: 3');
    expect(prompt).not.toContain('Salary');
  });

  it('returns a clamped draft and never publishes', async () => {
    const generate = vi.fn<AnswerBoxGenerator>(async () => ({
      summary: 's'.repeat(400),
      faq: [{ q: 'Did churn fall?', a: 'a'.repeat(700) }, { q: ' ', a: 'x' }, { q: 'Why?', a: 'Pricing.' }],
    }));
    const res = await appWith(generate)(snapshot);
    expect(res.status).toBe(200);
    const { draft } = await res.json() as { draft: { summary: string; faq: Array<{ q: string; a: string }> } };
    expect(draft.summary).toHaveLength(300);
    expect(draft.faq.map(item => item.q)).toEqual(['Did churn fall?', 'Why?']);
    expect(draft.faq[0].a).toHaveLength(600);
  });

  it('rejects bad bodies and missing session ids', async () => {
    const generate = vi.fn<AnswerBoxGenerator>();
    expect((await appWith(generate)({ nope: 1 })).status).toBe(400);
    expect((await appWith(generate)(snapshot, 'x')).status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
  });

  it('uses the local fake only in development with ANSWER_BOX_FAKE=1', async () => {
    const generate = vi.fn<AnswerBoxGenerator>(async () => ({ summary: 'real', faq: [] }));
    const fake = await (await appWith(generate, { ENVIRONMENT: 'development', ANSWER_BOX_FAKE: '1' })(snapshot)).json() as { draft: { summary: string } };
    expect(fake.draft.summary).toContain('local fake generator');
    expect(generate).not.toHaveBeenCalled();
    await appWith(generate, { ENVIRONMENT: 'production', ANSWER_BOX_FAKE: '1', AGENT_QUOTA: { get: async () => null, put: async () => {} } as unknown as KVNamespace })(snapshot);
    expect(generate).toHaveBeenCalledOnce();
  });
});
