import React, { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, X } from 'lucide-react';
import { useStore } from '../../store';
import {
  EMBED_DEFAULT_HEIGHT,
  EMBED_THEMES,
  embedIframeHtml,
  embedPath,
  type EmbedTarget,
  type EmbedTheme,
} from '../../shared/embed';
import { canonicalPublicUrl, publicHref, publishableCharts } from '../../utils/publish';
import { useModalFocus } from '../../hooks/useModalFocus';

// Embed dialog for a published page: pick the whole page or one chart, theme and
// data visibility; live preview + copy an iframe snippet or the plain URL
// (Notion / Medium / Substack expand it via oEmbed).

const THEME_LABELS: Record<EmbedTheme, string> = { auto: 'Match viewer', light: 'Light', dark: 'Dark' };
const PAGE_SCOPE = 'page';

type CopiedKind = 'snippet' | 'url' | null;

export const EmbedDialog: React.FC<{ noteId: string; pageId: string; onClose: () => void }> = ({ noteId, pageId, onClose }) => {
  const note = useStore(state => state.notes[noteId]);
  const charts = useStore(state => state.charts);
  const sheets = useStore(state => state.sheets);
  const [scope, setScope] = useState<string>(PAGE_SCOPE);
  const [theme, setTheme] = useState<EmbedTheme>('auto');
  const [hideData, setHideData] = useState(false);
  const [copied, setCopied] = useState<CopiedKind>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus(dialogRef, onClose, 'select');

  if (!note) return null;

  const embeddableCharts = publishableCharts(note, { charts, sheets });
  const target: EmbedTarget = scope === PAGE_SCOPE ? { kind: 'page', pageId } : { kind: 'chart', pageId, chartIndex: Number(scope) };
  const path = embedPath(target, { theme, hideData });
  const height = EMBED_DEFAULT_HEIGHT[target.kind];
  const title = target.kind === 'chart' ? embeddableCharts[target.chartIndex]?.title || 'Chart' : note.title || 'SheetCanvas page';
  const embedUrl = canonicalPublicUrl(path);
  const snippet = embedIframeHtml(embedUrl, title, height);

  const copy = async (kind: Exclude<CopiedKind, null>, text: string) => {
    await navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(kind);
    setTimeout(() => setCopied(null), 1500);
  };

  const field = 'rounded border border-neutral-200 dark:border-neutral-600 bg-transparent px-2 py-1 text-sm';
  const copyButton = 'inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-sm font-medium';

  return createPortal(
    <div className="fixed inset-0 z-[1001] flex items-center justify-center bg-black/40 p-4" onMouseDown={onClose} data-testid="embed-dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Embed published page"
        data-testid="embed-dialog"
        onMouseDown={e => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-auto rounded-lg bg-white p-4 text-left shadow-2xl dark:bg-neutral-800 dark:text-neutral-100"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Embed</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="p-1 text-neutral-400 hover:text-neutral-700"><X size={16} /></button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-1">What
            <select data-testid="embed-scope" value={scope} onChange={e => setScope(e.target.value)} className={field}>
              <option value={PAGE_SCOPE}>Whole page</option>
              {embeddableCharts.map((chart, index) => <option key={chart.id} value={String(index)}>Chart: {chart.title || `Chart ${index + 1}`}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">Theme
            <select data-testid="embed-theme" value={theme} onChange={e => setTheme(e.target.value as EmbedTheme)} className={field}>
              {EMBED_THEMES.map(value => <option key={value} value={value}>{THEME_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" data-testid="embed-hide-data" checked={hideData} onChange={e => setHideData(e.target.checked)} /> Hide data tables
          </label>
        </div>

        <iframe
          data-testid="embed-preview"
          src={publicHref(path)}
          title={`Preview: ${title}`}
          height={height}
          className="w-full rounded border border-neutral-200 dark:border-neutral-700"
        />

        <textarea data-testid="embed-snippet" readOnly value={snippet} rows={3} className={`${field} font-mono text-xs`} onFocus={e => e.target.select()} />
        <p className="text-xs text-neutral-500">
          Embeds run no scripts, so the frame has a fixed height ({height}px). Change <code>height</code> in the snippet to fit.
          Notion, Medium and Substack: paste the plain URL instead.
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" data-testid="embed-copy-snippet" onClick={() => copy('snippet', snippet)} className={`${copyButton} bg-teal-600 text-white hover:bg-teal-700`}>
            {copied === 'snippet' ? <Check size={14} /> : <Copy size={14} />} Copy embed code
          </button>
          <button type="button" data-testid="embed-copy-url" onClick={() => copy('url', embedUrl)} className={`${copyButton} border border-neutral-200 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-700`}>
            {copied === 'url' ? <Check size={14} /> : <Copy size={14} />} Copy URL
          </button>
          <span role="status" aria-live="polite" className="self-center text-xs text-teal-600">{copied ? 'Copied' : ''}</span>
        </div>
      </div>
    </div>,
    document.body
  );
};
