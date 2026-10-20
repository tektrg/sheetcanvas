import type { ChartColorSettings, ChartData, NoteData, NotePublishSettings, SheetData } from '../types';
import {
  MAX_PUBLISHED_CHARTS,
  type PublishCreatedResponse,
  type PublishedChart,
  type PublishedSeries,
  type PublishSnapshot,
  type PublishUpdatedResponse,
} from '../shared/publishSnapshot';
import { extractChartData, getSheetHeaders } from './chartHelpers';
import { buildChartSeriesDisplayNames, normalizeChartSeriesLabel } from './chartDisplay';
import { buildSeriesPalette, getChartPrimaryColor, getEffectiveChartPalette, normalizeHexColor } from './chartColorSchemes';
import { FORMAT_ALIASES, formatValue } from './formatting';
import { extractEmbeddedChartIds, notePlainText, pageDisplayTitle } from './pages';
import { ApiError, getBackendBaseUrl } from './backendApi';

// Anonymous publish, browser side: freeze a note + its embedded charts (configs
// resolved to plain rows) into the wire snapshot, hash it, and talk to
// /api/pages. The backend never sees connectors or live sheets.

export const AUTO_REPUBLISH_DEBOUNCE_MS = 30_000;
export const REFRESH_SCHEDULE_MS = { hourly: 60 * 60 * 1000, daily: 24 * 60 * 60 * 1000 } as const;
const FALLBACK_SERIES_COLOR = '#6366f1';
const CELL_VALUE_TAG = /<CellValue\b([^>]*?)\/?>(?:\s*<\/CellValue>)?/g;
const ATTR = (attrs: string, name: string) => attrs.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1];

export interface PublishSource {
  charts: Record<string, ChartData>;
  sheets: Record<string, SheetData>;
}

const toHexColor = (color: string | undefined) => normalizeHexColor(color ?? '') ?? FALLBACK_SERIES_COLOR;

/** Series keys + labels the way ChartNode derives them (metrics columns or group series). */
const chartSeriesEntries = (chart: ChartData, sheet: SheetData, rows: Array<Record<string, unknown>>) => {
  const headers = getSheetHeaders(sheet);
  const headerLabel = (colId: string) => headers.find(h => h.id === colId)?.label || `Column ${colId}`;
  const config = chart.config;
  if (config.mode === 'group') {
    if (config.seriesGroupCol) {
      const keys = new Set<string>();
      rows.forEach(row => Object.keys(row).forEach(k => { if (k !== 'name' && k !== 'x_raw') keys.add(k); }));
      return Array.from(keys).sort().map(key => ({ key, dataKey: key, label: key }));
    }
    const label = `${config.operation || 'SUM'} of ${headerLabel(config.valueCol || '')}`;
    return [{ key: config.valueCol || 'value', dataKey: 'value_0', label }];
  }
  return config.dataColumns.map((colId, index) => ({ key: colId, dataKey: `value_${index}`, label: headerLabel(colId) }));
};

/** One canvas chart → frozen rows + labelled, colored series. */
export const resolveChartForPublish = (
  chart: ChartData,
  sheet: SheetData,
  colorSettings: ChartColorSettings,
  hideData: boolean,
): PublishedChart => {
  const rows = extractChartData(sheet, chart.config) as Array<Record<string, unknown>>;
  const entries = chartSeriesEntries(chart, sheet, rows);
  const displayNames = { ...buildChartSeriesDisplayNames(entries), ...(chart.config.seriesDisplayNames ?? {}) };
  const palette = getEffectiveChartPalette(chart.config, colorSettings, false);
  const colors = buildSeriesPalette(getChartPrimaryColor(chart.config, palette), palette);
  const series: PublishedSeries[] = entries.map((entry, index) => ({
    key: entry.key,
    label: displayNames[entry.key] || normalizeChartSeriesLabel(entry.label),
    color: toHexColor(colors[index % colors.length]),
    ...(chart.config.seriesTypes?.[entry.key] ? { type: chart.config.seriesTypes[entry.key] } : {}),
  }));
  return {
    id: chart.id,
    title: chart.title || 'Chart',
    type: chart.config.type,
    ...(chart.config.stacked ? { stacked: true } : {}),
    ...(hideData ? { hideData: true } : {}),
    series,
    rows: rows.map(row => ({
      label: String(row.name ?? ''),
      values: entries.map(entry => {
        const value = Number(row[entry.dataKey]);
        return Number.isFinite(value) ? value : null;
      }),
    })),
  };
};

/** <CellValue sheet cell format/> → its current formatted value (pages are frozen, not live). */
const inlineCellValues = (content: string, sheets: Record<string, SheetData>) =>
  content.replace(CELL_VALUE_TAG, (_, attrs: string) => {
    const sheet = sheets[ATTR(attrs, 'sheet') ?? ''];
    const cell = sheet?.cells[ATTR(attrs, 'cell') ?? ''];
    const format = ATTR(attrs, 'format');
    return cell ? formatValue(cell.value ?? null, (format && FORMAT_ALIASES[format]) || cell.format) : '';
  });

/** Charts that make it into the snapshot, in snapshot order (= the /e/c/:id/:chartIdx index). */
export const publishableCharts = (note: NoteData, source: PublishSource): ChartData[] =>
  extractEmbeddedChartIds(note.content ?? '')
    .map(id => source.charts[id])
    .filter((chart): chart is ChartData => !!chart && !!source.sheets[chart.sourceSheetId] && !chart.setupRequired)
    .slice(0, MAX_PUBLISHED_CHARTS);

/** Freeze a note into the publish wire format. Charts whose source sheet is gone are skipped. */
export const buildPublishSnapshot = (note: NoteData, source: PublishSource, colorSettings: ChartColorSettings): PublishSnapshot => {
  const hideData = note.publish?.hideData ?? {};
  const charts = publishableCharts(note, source)
    .map(chart => resolveChartForPublish(chart, source.sheets[chart.sourceSheetId], colorSettings, !!hideData[chart.id]));
  const description = notePlainText({ content: inlineCellValues(note.content ?? '', source.sheets) }).slice(0, 300);
  return {
    version: 1,
    title: pageDisplayTitle(note).slice(0, 200),
    ...(description ? { description } : {}),
    tags: note.tags ?? [],
    format: note.format ?? 'html',
    content: inlineCellValues(note.content ?? '', source.sheets),
    charts,
  };
};

/** Stable SHA-256 of the snapshot: equal hash → nothing to republish. */
export const hashSnapshot = async (snapshot: PublishSnapshot): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
};

export const isPublished = (settings: NotePublishSettings | undefined): settings is NotePublishSettings & { id: string } =>
  !!settings?.id;

/** Where to open the page from this app: the canonical URL in prod, the local backend in dev. */
export const publicPageHref = (settings: NotePublishSettings): string =>
  settings.url ? publicHref(new URL(settings.url).pathname) : '';

const CANONICAL_ORIGIN = 'https://sheetcanvas.com';

/** A public path (/p/…, /e/…) opened from this app: canonical in prod, the local backend in dev. */
export const publicHref = (path: string): string => {
  const base = getBackendBaseUrl();
  const isProduction = base.startsWith(CANONICAL_ORIGIN) || base.startsWith('https://www.sheetcanvas.com');
  return `${isProduction ? CANONICAL_ORIGIN : base}${path}`;
};

/** Absolute canonical URL for snippets people paste elsewhere (always sheetcanvas.com). */
export const canonicalPublicUrl = (path: string): string => `${CANONICAL_ORIGIN}${path}`;

/**
 * Per-key debouncer: `schedule(key)` (re)starts a timer; the task runs once the
 * key has been quiet for `delayMs`. One in-flight run per key; a schedule during
 * a run queues exactly one follow-up.
 */
export const createDebouncedRunner = (delayMs: number, run: (key: string) => Promise<void>) => {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Set<string>();
  const rerun = new Set<string>();
  const fire = async (key: string) => {
    timers.delete(key);
    if (running.has(key)) { rerun.add(key); return; }
    running.add(key);
    try {
      await run(key);
    } finally {
      running.delete(key);
      if (rerun.delete(key)) schedule(key);
    }
  };
  const schedule = (key: string) => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => void fire(key), delayMs));
  };
  return {
    schedule,
    cancel: (key: string) => { clearTimeout(timers.get(key)); timers.delete(key); rerun.delete(key); },
    flush: (key: string) => { clearTimeout(timers.get(key)); return fire(key); },
    isPending: (key: string) => timers.has(key),
    dispose: () => { timers.forEach(clearTimeout); timers.clear(); },
  };
};

// --- /api/pages client -------------------------------------------------------

const pagesRequest = async <T>(path: string, init: RequestInit): Promise<T> => {
  const res = await fetch(`${getBackendBaseUrl()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.error?.message || `Request failed (${res.status})`, res.status, json?.error?.code);
  return json as T;
};

const bearer = (token?: string | null): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

/** `sessionToken`: signed-in author → the page is owned by that account from the start. */
export const createPublishedPage = (snapshot: PublishSnapshot, sessionToken?: string | null) =>
  pagesRequest<PublishCreatedResponse>('/api/pages', { method: 'POST', headers: bearer(sessionToken), body: JSON.stringify(snapshot) });

export interface ClaimPagesResponse {
  userId: string;
  claimed: string[];
  skipped: Array<{ id: string; reason: 'not_found' | 'forbidden' | 'owned_by_other' }>;
}

/** Attach anonymously published pages (proved by edit key) to the signed-in account. */
export const claimPublishedPages = (sessionToken: string, pages: Array<{ id: string; editKey: string }>) =>
  pagesRequest<ClaimPagesResponse>('/api/pages/claim', { method: 'POST', headers: bearer(sessionToken), body: JSON.stringify({ pages }) });

export const updatePublishedPage = (id: string, editKey: string, snapshot: PublishSnapshot) =>
  pagesRequest<PublishUpdatedResponse>(`/api/pages/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'X-Edit-Key': editKey },
    body: JSON.stringify(snapshot),
  });

export const deletePublishedPage = (id: string, editKey: string) =>
  pagesRequest<{ id: string }>(`/api/pages/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { 'X-Edit-Key': editKey } });
