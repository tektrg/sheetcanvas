import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { AccountApiError, HANDLE_MAX, handleProblem } from '../../shared/theindieAccounts';
import { chooseHandle } from '../../utils/accountActions';

// Pick / change the public @handle (theindie-api PUT /v1/me/handle). Inline
// format validation mirrors the server; reserved/taken/too-soon come back from it.

export const HandlePickerDialog: React.FC<{ initial: string | null; onClose: () => void }> = ({ initial, onClose }) => {
  const [value, setValue] = useState(initial ?? '');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); opener?.focus?.(); };
  }, [onClose]);

  const problem = handleProblem(value);
  const unchanged = value === initial;
  const shownError = serverError ?? (touched && value ? problem : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (problem || unchanged) return;
    setSaving(true);
    setServerError(null);
    try {
      await chooseHandle(value);
      onClose();
    } catch (err) {
      setServerError(err instanceof AccountApiError ? err.message : 'Could not save the handle');
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="handle-picker-title"
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-2xl p-5 text-neutral-900 dark:text-neutral-100"
      >
        <div className="flex items-start justify-between mb-3">
          <h2 id="handle-picker-title" className="text-base font-semibold">{initial ? 'Change your handle' : 'Choose your handle'}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"><X size={16} /></button>
        </div>
        <p className="text-sm text-neutral-500 dark:text-neutral-400 mb-4">Your published pages are listed on your public profile.</p>
        <label htmlFor="handle-input" className="block text-xs font-medium text-neutral-600 dark:text-neutral-300 mb-1">Handle</label>
        <div className={`flex items-center rounded-md border px-2 ${shownError ? 'border-red-400' : 'border-neutral-300 dark:border-neutral-600'} focus-within:ring-2 focus-within:ring-teal-500/40`}>
          <span className="text-neutral-400 text-sm">@</span>
          <input
            id="handle-input"
            ref={inputRef}
            value={value}
            maxLength={HANDLE_MAX}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={!!shownError}
            aria-describedby="handle-help"
            onChange={e => { setValue(e.target.value.toLowerCase().trim()); setServerError(null); }}
            onBlur={() => setTouched(true)}
            className="flex-1 bg-transparent py-1.5 pl-0.5 text-sm outline-none"
          />
        </div>
        <p id="handle-help" role={shownError ? 'alert' : undefined} className={`mt-1.5 text-xs ${shownError ? 'text-red-600 dark:text-red-400' : 'text-neutral-500 dark:text-neutral-400'}`}>
          {shownError ?? `sheetcanvas.com/@${value || 'yourname'} · 3–30 characters: a–z, 0–9, - and _`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800">
            {initial ? 'Cancel' : 'Later'}
          </button>
          <button
            type="submit"
            disabled={saving || !!problem || unchanged}
            className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save handle'}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
};
