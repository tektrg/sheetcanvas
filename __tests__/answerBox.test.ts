import { describe, expect, it } from 'vitest';
import { answerBoxErrorMessage, answerBoxProblems, toSavedAnswerBox } from '../utils/answerBox';

describe('answer box editor helpers', () => {
  it('saves trimmed content and drops blank Q&As; nothing left → undefined', () => {
    expect(toSavedAnswerBox({ summary: '  Hi ', faq: [{ q: ' Q? ', a: ' A ' }, { q: '', a: '' }] })).toEqual({ summary: 'Hi', faq: [{ q: 'Q?', a: 'A' }] });
    expect(toSavedAnswerBox({ summary: ' ', faq: [] })).toBeUndefined();
  });

  it('flags limits and half-filled questions', () => {
    expect(answerBoxProblems({ summary: 'ok', faq: [{ q: 'Q?', a: 'A' }] })).toEqual([]);
    expect(answerBoxProblems({ summary: 'x'.repeat(301), faq: [{ q: 'Q?', a: '' }, { q: 'q', a: 'a'.repeat(601) }] })).toEqual([
      'Summary is over 300 characters.',
      'Question 1 needs both a question and an answer.',
      'Answer 2 is over 600 characters.',
    ]);
  });

  it('turns browser network failures into a friendly message', () => {
    expect(answerBoxErrorMessage(new TypeError('Failed to fetch'), 'AI draft failed')).toBe("AI draft failed: can't reach the server. Check your connection and try again.");
    expect(answerBoxErrorMessage(new Error('Load failed'), 'Save failed')).toMatch(/^Save failed: can't reach/);
    expect(answerBoxErrorMessage(new Error('Rate limited'), 'AI draft failed')).toBe('Rate limited');
    expect(answerBoxErrorMessage('x', 'Save failed')).toBe('Save failed');
  });
});
