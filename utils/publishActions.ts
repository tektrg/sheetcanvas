import { useStore } from '../store';
import type { NotePublishSettings, PublishRefreshSchedule } from '../types';
import { readStoredChartColorSettings } from './chartColorSchemes';
import {
  buildPublishSnapshot,
  createPublishedPage,
  deletePublishedPage,
  hashSnapshot,
  isPublished,
  updatePublishedPage,
} from './publish';
import { deleteEditKey, readEditKey, saveEditKey } from './publishKeys';
import { extractEmbeddedChartIds } from './pages';
import { readConnectorQuery, refreshConnectedSheetFromQuery } from './connectedSheetQueries';
import { ApiError } from './backendApi';
import { getSession, saveSession } from './accountSession';
import type { PublishSnapshot } from '../shared/publishSnapshot';
import { requestAnswerBoxDraft, type SavedAnswerBox } from './answerBox';

// Store-coupled publish actions used by the Publish menu and the auto-republish
// hook. Writing `publish` on a note never bumps `updatedAt` (not a content field).

const patchPublish = (noteId: string, patch: Partial<NotePublishSettings>) => {
  const note = useStore.getState().notes[noteId];
  if (!note) return;
  useStore.getState().updateNote(noteId, { publish: { ...note.publish, ...patch } });
};

const currentSnapshot = async (noteId: string) => {
  const state = useStore.getState();
  const note = state.notes[noteId];
  if (!note) return null;
  const snapshot = buildPublishSnapshot(note, state, readStoredChartColorSettings());
  return { note, snapshot, hash: await hashSnapshot(snapshot) };
};

/** Publish owned by the signed-in account; an expired session signs out and publishes anonymously. */
const createPublishedPageAsCurrentUser = async (snapshot: PublishSnapshot) => {
  const token = getSession()?.token;
  try {
    return await createPublishedPage(snapshot, token);
  } catch (err) {
    if (!token || !(err instanceof ApiError) || err.code !== 'invalid_session') throw err;
    await saveSession(null);
    return createPublishedPage(snapshot);
  }
};

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : 'Publish failed');

export const publishNote = async (noteId: string) => {
  const current = await currentSnapshot(noteId);
  if (!current) return;
  try {
    const created = await createPublishedPageAsCurrentUser(current.snapshot);
    await saveEditKey(created.id, created.editKey);
    const now = Date.now();
    patchPublish(noteId, {
      id: created.id,
      slug: created.slug,
      url: created.url,
      publishedAt: now,
      lastPublishedAt: now,
      lastPublishedHash: current.hash,
      paused: false,
      lastError: undefined,
    });
  } catch (err) {
    patchPublish(noteId, { lastError: errorMessage(err) });
    throw err;
  }
};

/** PUT the current snapshot. Skips when unchanged unless `force`. Returns whether a request was sent. */
export const republishNote = async (noteId: string, opts: { force?: boolean } = {}): Promise<boolean> => {
  const current = await currentSnapshot(noteId);
  const settings = current?.note.publish;
  if (!current || !isPublished(settings)) return false;
  if (!opts.force && current.hash === settings.lastPublishedHash) return false;
  const editKey = await readEditKey(settings.id);
  if (!editKey) {
    patchPublish(noteId, { lastError: 'Edit key missing in this browser — this page can no longer be updated here.' });
    return false;
  }
  try {
    const updated = await updatePublishedPage(settings.id, editKey, current.snapshot);
    patchPublish(noteId, { slug: updated.slug, url: updated.url, lastPublishedAt: Date.now(), lastPublishedHash: current.hash, lastError: undefined });
    return true;
  } catch (err) {
    patchPublish(noteId, { lastError: errorMessage(err) });
    return false;
  }
};

export const unpublishNote = async (noteId: string) => {
  const settings = useStore.getState().notes[noteId]?.publish;
  if (!isPublished(settings)) return;
  const editKey = await readEditKey(settings.id);
  if (editKey) await deletePublishedPage(settings.id, editKey);
  await deleteEditKey(settings.id);
  // Keep author preferences (hideData, schedule) for a later re-publish.
  patchPublish(noteId, {
    id: undefined, slug: undefined, url: undefined, publishedAt: undefined,
    lastPublishedAt: undefined, lastPublishedHash: undefined, paused: false, lastError: undefined,
  });
};

export const setPublishPaused = (noteId: string, paused: boolean) => patchPublish(noteId, { paused });

export const setChartHideData = (noteId: string, chartId: string, hide: boolean) => {
  const hideData = { ...(useStore.getState().notes[noteId]?.publish?.hideData ?? {}), [chartId]: hide };
  patchPublish(noteId, { hideData });
};

export const setRefreshSchedule = (noteId: string, refreshSchedule: PublishRefreshSchedule) => patchPublish(noteId, { refreshSchedule });

/**
 * Re-run the live connector query behind every chart embedded in the note.
 * Sheet updates then flow through the normal auto-republish path.
 */
export const refreshNoteConnectorSources = async (noteId: string) => {
  const state = useStore.getState();
  const note = state.notes[noteId];
  if (!note) return;
  const sheetIds = new Set(
    extractEmbeddedChartIds(note.content ?? '')
      .map(id => state.charts[id]?.sourceSheetId)
      .filter((id): id is string => !!id && !!state.sheets[id]?.connectorConfig)
  );
  for (const sheetId of sheetIds) {
    const sheet = useStore.getState().sheets[sheetId];
    const query = sheet?.connectorConfig ? readConnectorQuery(sheet.connectorConfig) : null;
    if (!sheet?.connectorConfig || !query) continue;
    try {
      const next = await refreshConnectedSheetFromQuery(sheet.connectorConfig, query);
      useStore.getState().updateSheet(sheetId, { size: next.size, cells: next.cells, connectorConfig: next.connectorConfig });
    } catch (err) {
      console.warn('[publish] scheduled refresh failed', sheetId, errorMessage(err));
    }
  }
};

/** AI draft from the note as it would publish now (minus any saved answer box). Never saves. */
export const draftAnswerBoxForNote = async (noteId: string) => {
  const current = await currentSnapshot(noteId);
  if (!current) throw new Error('Page not found');
  const { summary: _summary, faq: _faq, ...withoutAnswerBox } = current.snapshot;
  return requestAnswerBoxDraft(withoutAnswerBox);
};

/** Save the author-reviewed answer box; a live page republishes right away. */
export const saveAnswerBox = async (noteId: string, answerBox: SavedAnswerBox | undefined) => {
  patchPublish(noteId, { answerBox });
  if (!useStore.getState().notes[noteId]?.publish?.paused) await republishNote(noteId);
};
