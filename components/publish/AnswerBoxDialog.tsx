import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useStore } from '../../store';
import { ANSWER_BOX_LIMITS } from '../../shared/publishSnapshot';
import { answerBoxErrorMessage, answerBoxProblems, EMPTY_ANSWER_BOX, toSavedAnswerBox, type AnswerBoxDraft } from '../../utils/answerBox';
import { draftAnswerBoxForNote, saveAnswerBox } from '../../utils/publishActions';
import { PortalThemeScope } from '../PortalThemeScope';

// "Answer box" editor for a published page: a TL;DR + up to 5 Q&As shown under
// the title (and as FAQPage JSON-LD). "Generate with AI" only fills a review
// card; the author must click "Use this" and then Save — AI text never goes
// live unreviewed.

const field = 'w-full rounded border border-neutral-200 dark:border-neutral-600 bg-transparent px-2 py-1 text-sm';
const button = 'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-50';
const secondaryButton = `${button} border border-neutral-200 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700`;

const Counter: React.FC<{ value: string; max: number }> = ({ value, max }) => (
  <span className={`text-[11px] ${value.trim().length > max ? 'text-red-600' : 'text-neutral-400'}`}>{value.trim().length}/{max}</span>
);

const DraftPreview: React.FC<{ draft: AnswerBoxDraft; onUse: () => void; onDiscard: () => void }> = ({ draft, onUse, onDiscard }) => (
  <div data-testid="answer-box-draft" className="rounded-md border border-violet-200 bg-violet-50 p-3 text-sm dark:border-violet-800 dark:bg-violet-950/40">
    <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300">AI draft — review before using</div>
    <p className="mb-2 text-xs text-violet-800 dark:text-violet-200">AI can get facts and numbers wrong. Check every figure against your data before saving.</p>
    {draft.summary && <p className="mb-2">{draft.summary}</p>}
    <ul className="mb-3 space-y-1">
      {draft.faq.map((item, index) => <li key={index}><strong>{item.q}</strong> {item.a}</li>)}
    </ul>
    <div className="flex gap-2">
      <button type="button" data-testid="answer-box-use-draft" onClick={onUse} className={`${button} bg-violet-600 text-white hover:bg-violet-700`}>Use this</button>
      <button type="button" onClick={onDiscard} className={secondaryButton}>Discard</button>
    </div>
  </div>
);

export const AnswerBoxDialog: React.FC<{ noteId: string; onClose: () => void }> = ({ noteId, onClose }) => {
  const saved = useStore(state => state.notes[noteId]?.publish?.answerBox);
  const [box, setBox] = useState<AnswerBoxDraft>(() => ({ summary: saved?.summary ?? '', faq: saved?.faq ?? [] }));
  const [draft, setDraft] = useState<AnswerBoxDraft | null>(null);
  const [busy, setBusy] = useState<'generate' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('textarea')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [onClose]);

  const problems = answerBoxProblems(box);
  const setFaq = (index: number, patch: Partial<{ q: string; a: string }>) =>
    setBox(current => ({ ...current, faq: current.faq.map((item, i) => (i === index ? { ...item, ...patch } : item)) }));

  const generate = async () => {
    setBusy('generate');
    setError(null);
    try { setDraft(await draftAnswerBoxForNote(noteId)); } catch (err) { setError(answerBoxErrorMessage(err, 'AI draft failed')); } finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save');
    setError(null);
    try { await saveAnswerBox(noteId, toSavedAnswerBox(box)); onClose(); } catch (err) { setError(answerBoxErrorMessage(err, 'Save failed')); setBusy(null); }
  };

  return createPortal(
    <PortalThemeScope>
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label="Answer box"
          data-testid="answer-box-dialog"
          onMouseDown={e => e.stopPropagation()}
          className="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-auto rounded-lg bg-white p-4 text-left text-neutral-800 shadow-2xl dark:bg-neutral-800 dark:text-neutral-100"
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Answer box</h2>
            <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-700"><X size={16} /></button>
          </div>
          <p className="text-xs text-neutral-500">
            A short answer and a few Q&amp;As shown under the page title. Search and AI answer engines quote these directly. Optional.
          </p>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="answer-box-generate" disabled={!!busy} onClick={generate} className={secondaryButton}>
              <Sparkles size={14} className={busy === 'generate' ? 'animate-pulse' : ''} /> {busy === 'generate' ? 'Drafting…' : 'Generate with AI'}
            </button>
            <span className="text-xs text-neutral-500">Drafts from the page text and chart data. You review and edit before anything is saved.</span>
          </div>

          {draft && (
            <DraftPreview
              draft={draft}
              onUse={() => { setBox(draft); setDraft(null); }}
              onDiscard={() => setDraft(null)}
            />
          )}

          <label className="flex flex-col gap-1 text-sm font-medium">
            <span className="flex items-center justify-between">Summary (TL;DR) <Counter value={box.summary} max={ANSWER_BOX_LIMITS.summaryChars} /></span>
            <textarea
              data-testid="answer-box-summary"
              rows={3}
              value={box.summary}
              onChange={e => setBox(current => ({ ...current, summary: e.target.value }))}
              placeholder="One or two sentences that directly answer the page's main question."
              className={`${field} font-normal`}
            />
          </label>

          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium">Questions &amp; answers <span className="font-normal text-neutral-400">(first question = the page's main question)</span></div>
            {box.faq.map((item, index) => (
              <div key={index} data-testid="answer-box-faq-item" className="flex flex-col gap-1 rounded-md border border-neutral-100 p-2 dark:border-neutral-700">
                <div className="flex items-center gap-2">
                  <input aria-label={`Question ${index + 1}`} value={item.q} onChange={e => setFaq(index, { q: e.target.value })} placeholder="Question" className={field} />
                  <button type="button" aria-label={`Delete question ${index + 1}`} onClick={() => setBox(current => ({ ...current, faq: current.faq.filter((_, i) => i !== index) }))} className="p-1 text-neutral-400 hover:text-red-600"><Trash2 size={14} /></button>
                </div>
                <textarea aria-label={`Answer ${index + 1}`} rows={2} value={item.a} onChange={e => setFaq(index, { a: e.target.value })} placeholder="Answer" className={field} />
                <div className="flex justify-end gap-2"><Counter value={item.q} max={ANSWER_BOX_LIMITS.questionChars} /><Counter value={item.a} max={ANSWER_BOX_LIMITS.answerChars} /></div>
              </div>
            ))}
            {box.faq.length < ANSWER_BOX_LIMITS.faqItems && (
              <button type="button" onClick={() => setBox(current => ({ ...current, faq: [...current.faq, { q: '', a: '' }] }))} className={`${secondaryButton} self-start`}>
                <Plus size={14} /> Add question
              </button>
            )}
          </div>

          {(problems.length > 0 || error) && (
            <ul className="text-xs text-red-600" role="alert">{[...problems, ...(error ? [error] : [])].map(message => <li key={message}>{message}</li>)}</ul>
          )}

          <div className="flex flex-wrap justify-between gap-2 border-t border-neutral-100 pt-3 dark:border-neutral-700">
            <button type="button" onClick={() => setBox(EMPTY_ANSWER_BOX)} className={secondaryButton}>Clear all</button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className={secondaryButton}>Cancel</button>
              <button type="button" data-testid="answer-box-save" disabled={!!busy || problems.length > 0 || !!draft} title={draft ? 'Use or discard the AI draft first' : undefined} onClick={save} className={`${button} bg-teal-600 text-white hover:bg-teal-700`}>
                {busy === 'save' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </PortalThemeScope>,
    document.body
  );
};
