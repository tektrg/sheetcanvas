import { useEffect } from 'react';
import { useStore, type AppState } from '../store';
import type { NoteData } from '../types';
import { AUTO_REPUBLISH_DEBOUNCE_MS, createDebouncedRunner, isPublished, REFRESH_SCHEDULE_MS } from '../utils/publish';
import { refreshNoteConnectorSources, republishNote } from '../utils/publishActions';
import { extractEmbeddedChartIds } from '../utils/pages';

// Keeps live published pages in sync while the app is open:
// 1. any change to a published note, its embedded charts, or their source
//    sheets → debounced (30s) republish; skipped when the snapshot hash is unchanged;
// 2. notes with a refresh schedule re-run their charts' connector queries on
//    that cadence, which feeds back into (1).

const SCHEDULE_CHECK_MS = 60_000;

/** The objects a note's snapshot is built from; a new reference = maybe changed. */
const snapshotInputs = (note: NoteData, state: AppState): unknown[] => {
  const charts = extractEmbeddedChartIds(note.content ?? '').map(id => state.charts[id]);
  return [note.content, note.title, note.tags, note.format, note.publish?.hideData, ...charts, ...charts.map(c => c && state.sheets[c.sourceSheetId])];
};

const sameInputs = (a: unknown[] | undefined, b: unknown[]) => !!a && a.length === b.length && a.every((v, i) => v === b[i]);

const isLive = (note: NoteData | undefined) => !!note && isPublished(note.publish) && !note.publish?.paused;

export const usePublishSync = () => {
  useEffect(() => {
    const runner = createDebouncedRunner(AUTO_REPUBLISH_DEBOUNCE_MS, async noteId => {
      if (isLive(useStore.getState().notes[noteId])) await republishNote(noteId);
    });
    const lastInputs = new Map<string, unknown[]>();

    const check = (state: AppState) => {
      for (const noteId of state.noteIds) {
        const note = state.notes[noteId];
        if (!isLive(note)) { lastInputs.delete(noteId); runner.cancel(noteId); continue; }
        const inputs = snapshotInputs(note, state);
        const previous = lastInputs.get(noteId);
        lastInputs.set(noteId, inputs);
        // First sighting (load, publish, resume) also schedules: the hash check makes it free if nothing changed.
        if (!sameInputs(previous, inputs)) runner.schedule(noteId);
      }
    };
    check(useStore.getState());
    const unsubscribe = useStore.subscribe(check);

    const lastRefreshAt = new Map<string, number>();
    const scheduleTimer = setInterval(() => {
      const state = useStore.getState();
      const now = Date.now();
      for (const noteId of state.noteIds) {
        const note = state.notes[noteId];
        const schedule = note?.publish?.refreshSchedule;
        if (!isLive(note) || !schedule || schedule === 'off') continue;
        const last = lastRefreshAt.get(noteId) ?? note.publish?.lastPublishedAt ?? now;
        if (!lastRefreshAt.has(noteId)) lastRefreshAt.set(noteId, last);
        if (now - last < REFRESH_SCHEDULE_MS[schedule]) continue;
        lastRefreshAt.set(noteId, now);
        void refreshNoteConnectorSources(noteId);
      }
    }, SCHEDULE_CHECK_MS);

    return () => {
      unsubscribe();
      runner.dispose();
      clearInterval(scheduleTimer);
    };
  }, []);
};
