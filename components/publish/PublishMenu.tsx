import React, { useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy, ExternalLink, Globe, Pause, Play, RefreshCw } from 'lucide-react';
import { useStore } from '../../store';
import type { PublishRefreshSchedule } from '../../types';
import { extractEmbeddedChartIds } from '../../utils/pages';
import { isPublished, publicPageHref } from '../../utils/publish';
import {
  publishNote,
  republishNote,
  setChartHideData,
  setPublishPaused,
  setRefreshSchedule,
  unpublishNote,
} from '../../utils/publishActions';
import { EmbedDialog } from './EmbedDialog';

// Publish control for one note/page: a globe button (with a "Live" badge when
// published) that opens a small panel. Used on the canvas note bar and in Library rows.

const SCHEDULE_LABELS: Record<PublishRefreshSchedule, string> = { off: 'Off', hourly: 'Hourly', daily: 'Daily' };

export const LiveBadge: React.FC<{ paused?: boolean }> = ({ paused }) => (
  <span
    data-testid="publish-live-badge"
    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide
      ${paused ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'}`}
  >
    <span className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
    {paused ? 'Paused' : 'Live'}
  </span>
);

const rowButton = 'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700 disabled:opacity-50';

export const PublishMenu: React.FC<{ noteId: string; align?: 'left' | 'right' }> = ({ noteId, align = 'right' }) => {
  const note = useStore(state => state.notes[noteId]);
  const charts = useStore(state => state.charts);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [embedOpen, setEmbedOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (!note) return null;
  const settings = note.publish ?? {};
  const live = isPublished(settings);
  const chartIds = extractEmbeddedChartIds(note.content ?? '').filter(id => charts[id]);
  const href = live ? publicPageHref(settings) : '';

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await action(); } catch (err) { setError(err instanceof Error ? err.message : 'Something went wrong'); } finally { setBusy(false); }
  };

  const copyLink = async () => {
    await navigator.clipboard?.writeText(settings.url ?? '').catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="relative" ref={rootRef} onMouseDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}>
      <button
        type="button"
        data-testid="publish-menu-button"
        aria-label={live ? 'Published page settings' : 'Publish to web'}
        title={live ? 'Published page' : 'Publish to web'}
        onClick={e => { e.stopPropagation(); setOpen(v => !v); }}
        className="inline-flex items-center gap-1 p-1 rounded-md text-neutral-400 hover:text-teal-600 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
      >
        <Globe size={14} />
        {live && <LiveBadge paused={settings.paused} />}
      </button>

      {open && (
        <div
          data-testid="publish-panel"
          className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 w-72 bg-white dark:bg-neutral-800 rounded-lg shadow-xl border border-neutral-100 dark:border-neutral-700 z-[120] py-2 text-left`}
        >
          <div className="px-3 pb-2 text-xs text-neutral-500">
            {live ? 'Anyone with the link can view this page.' : 'Publish a frozen, public copy of this page and its charts. No sign-in needed.'}
          </div>

          {live ? (
            <>
              <div className="mx-3 mb-2 flex items-center gap-1 rounded-md border border-neutral-200 dark:border-neutral-700 px-2 py-1">
                <a data-testid="publish-url" href={href} target="_blank" rel="noopener" className="min-w-0 flex-1 truncate text-xs text-teal-700 dark:text-teal-300 hover:underline" title={settings.url}>
                  {settings.url}
                </a>
                <button type="button" aria-label="Copy link" onClick={copyLink} className="p-0.5 text-neutral-400 hover:text-teal-600">
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                </button>
                <a href={href} target="_blank" rel="noopener" aria-label="Open public page" className="p-0.5 text-neutral-400 hover:text-teal-600"><ExternalLink size={13} /></a>
              </div>
              <button type="button" className={rowButton} data-testid="publish-embed" onClick={() => { setEmbedOpen(true); setOpen(false); }}>
                <Code2 size={13} /> Embed…
              </button>
              <button type="button" className={rowButton} disabled={busy} onClick={() => setPublishPaused(noteId, !settings.paused)} data-testid="publish-pause-toggle">
                {settings.paused ? <Play size={13} /> : <Pause size={13} />}
                {settings.paused ? 'Resume auto-update' : 'Pause auto-update'}
              </button>
              <button type="button" className={rowButton} disabled={busy} onClick={() => run(() => republishNote(noteId, { force: true }))}>
                <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Republish now
              </button>
            </>
          ) : (
            <div className="px-3">
              <button
                type="button"
                data-testid="publish-submit"
                disabled={busy}
                onClick={() => run(() => publishNote(noteId))}
                className="w-full rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
              >
                {busy ? 'Publishing…' : 'Publish to web'}
              </button>
              <button type="button" className={`${rowButton} mt-1 px-0`} disabled title="Publish first to get an embed code" data-testid="publish-embed">
                <Code2 size={13} /> Embed… <span className="text-[11px] text-neutral-400">(publish first)</span>
              </button>
            </div>
          )}

          {chartIds.length > 0 && (
            <div className="mt-2 border-t border-neutral-100 dark:border-neutral-700 px-3 pt-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-neutral-400">Charts</div>
              {chartIds.map(chartId => (
                <label key={chartId} className="flex items-center justify-between gap-2 py-0.5 text-xs text-neutral-600 dark:text-neutral-300">
                  <span className="truncate">{charts[chartId].title || 'Chart'}</span>
                  <span className="flex items-center gap-1 shrink-0">
                    Hide data
                    <input
                      type="checkbox"
                      data-testid="publish-hide-data"
                      checked={!!settings.hideData?.[chartId]}
                      onChange={e => setChartHideData(noteId, chartId, e.target.checked)}
                    />
                  </span>
                </label>
              ))}
            </div>
          )}

          <label className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-100 dark:border-neutral-700 px-3 pt-2 text-xs text-neutral-600 dark:text-neutral-300">
            <span title="Re-run live connector queries on this cadence while SheetCanvas is open, then republish">Refresh live data</span>
            <select
              data-testid="publish-schedule"
              value={settings.refreshSchedule ?? 'off'}
              onChange={e => setRefreshSchedule(noteId, e.target.value as PublishRefreshSchedule)}
              className="rounded border border-neutral-200 dark:border-neutral-600 bg-transparent px-1 py-0.5"
            >
              {(Object.keys(SCHEDULE_LABELS) as PublishRefreshSchedule[]).map(value => (
                <option key={value} value={value}>{SCHEDULE_LABELS[value]}</option>
              ))}
            </select>
          </label>

          {live && (
            <button
              type="button"
              data-testid="publish-unpublish"
              disabled={busy}
              onClick={() => { if (window.confirm('Unpublish this page? The public link will stop working.')) void run(() => unpublishNote(noteId)); }}
              className="mt-2 w-full border-t border-neutral-100 dark:border-neutral-700 px-3 pt-2 text-left text-sm text-red-600 hover:text-red-700"
            >
              Unpublish
            </button>
          )}

          {(error || settings.lastError) && (
            <p className="mt-2 px-3 text-xs text-red-600" role="alert">{error || settings.lastError}</p>
          )}
        </div>
      )}
      {embedOpen && live && <EmbedDialog noteId={noteId} pageId={settings.id} onClose={() => setEmbedOpen(false)} />}
    </div>
  );
};
