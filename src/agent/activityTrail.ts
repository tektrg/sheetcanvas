/**
 * Agent activity trail — the visible record of what an AI agent did to the canvas, plus a
 * "rewind to here" control. This is a SEPARATE Zustand store from the main canvas store
 * (store.ts), not a slice of it. Why separation is load-bearing, not a style choice:
 *
 * 1. Loop risk: store.ts's undo snapshot is exactly `{sheets, charts, notes}`, and undo()
 *    restores a previous snapshot by spreading it wholesale over current state (see store.ts
 *    `undo()`). If the trail lived inside that snapshot, undoing an agent step would also
 *    revert the trail's own record of that step — right after the step un-happened, the
 *    trail would go back to claiming it never happened. Two stores makes that structurally
 *    impossible: reverting the canvas can never revert the log of what was reverted.
 * 2. It's session data: undoDepth/depthAfter are markers into store.ts's `history` array,
 *    which is in-memory only and reset on reload — bundling them into a persisted canvas
 *    snapshot would be storing coordinates into a map that gets redrawn every session.
 * 3. It's written from callers with no React context — the tool dispatcher, the ChatGPT/
 *    Claude Desktop bridges, the eval harness — so a plain Zustand store (not a slice reached
 *    through a component-owned hook) is the natural shape.
 *
 * ## The rewind mechanism, and why it says "Undo back to here" and not "undo this step"
 *
 * store.ts's undo/redo is a linear stack of whole-canvas snapshots with no per-step ids and
 * no branching (see `saveSnapshot`, `undo`, `MAX_HISTORY`). Reverting step 3 of 5 in isolation
 * cannot be represented in that structure — the only honest operation is winding the whole
 * stack back to the state right before the chosen step, which also reverts every later step
 * (agent or human). `revertToEntry` implements exactly that: record the main store's absolute
 * history depth before a tool ran, then call `store.undo()` repeatedly until that depth is
 * reached again (undo() is a synchronous `set(...)`, so the depth is immediately observable
 * after each call — but there's still a hard loop guard against a state we didn't foresee).
 *
 * Because a human editing the same canvas at the same time pushes snapshots onto that same
 * stack, "undo back to here" can also revert the user's own interleaved edits. There's no way
 * around that without branching history, so `countForeignSteps` detects it (how many snapshots
 * between now and the target are NOT claimed by any trail entry) so the UI can warn before
 * acting — this is user-initiated, so a confirm here does not reintroduce the agent-action
 * confirmation dialogs this product deliberately avoids.
 */

import { create } from 'zustand';
import { useStore } from '../../store';
import { summarize } from './trailSummaries';
import type { ToolResult } from './clientToolExecutor';
import { setToolObserver, type ToolDoor, type ToolObserver } from './webmcp/toolDispatch';

export type { ToolDoor };

export interface TrailEntry {
  id: string;
  seq: number;
  door: ToolDoor;
  tool: string;
  /** Human-readable, <=90 chars, resolved at finish time. See trailSummaries.ts. */
  summary: string;
  status: 'running' | 'ok' | 'error';
  error?: string;
  startedAt: number;
  durationMs?: number;
  /** Main store's absolute history depth (historyBase + history.length) observed BEFORE the call. */
  undoDepth: number;
  /** ...and after. delta 0 means this call made no canvas change (nothing to undo). */
  depthAfter?: number;
  touchedIds: string[];
  /**
   * 'revertable' | 'reverted' | 'none' are the values this store actually persists.
   * 'stale' is never stored — it's a derived display value (see getRevertState) computed at
   * render time so we're not wiring a subscription that recomputes on every store change.
   */
  revertState: 'revertable' | 'reverted' | 'stale' | 'none';
}

export const MAX_TRAIL = 100;

interface TrailState {
  entries: TrailEntry[];
  addEntry: (entry: TrailEntry) => void;
  updateEntry: (id: string, patch: Partial<TrailEntry>) => void;
  markReverted: (ids: string[]) => void;
}

export const useTrailStore = create<TrailState>((set) => ({
  entries: [],
  addEntry: (entry) =>
    set((state) => {
      const next = [entry, ...state.entries]; // newest first
      return { entries: next.length > MAX_TRAIL ? next.slice(0, MAX_TRAIL) : next };
    }),
  updateEntry: (id, patch) =>
    set((state) => ({
      entries: state.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })),
  markReverted: (ids) =>
    set((state) => {
      const idSet = new Set(ids);
      return {
        entries: state.entries.map((e) => (idSet.has(e.id) ? { ...e, revertState: 'reverted' } : e)),
      };
    }),
}));

let seqCounter = 0;
const generateEntryId = () => `trail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

/** Absolute depth into the main store's undo stack — stable across the MAX_HISTORY shift (see store.ts historyBase). */
export function getAbsoluteHistoryDepth(): number {
  const state = useStore.getState();
  return state.historyBase + state.history.length;
}

const ID_FIELDS = ['sheetId', 'chartId', 'noteId', 'resultId', 'connectionId'] as const;

function extractTouchedIds(result: ToolResult): string[] {
  if (!result || typeof result !== 'object') return [];
  const ids: string[] = [];
  for (const key of ID_FIELDS) {
    const value = (result as Record<string, unknown>)[key];
    if (typeof value === 'string') ids.push(value);
  }
  return ids;
}

// onFinish only receives (entryId, result) — it needs the original tool+input to build a
// summary, so onStart stashes it here, keyed by the entry id it just minted. Cleared as soon
// as the matching onFinish runs.
const pendingByEntryId = new Map<string, { tool: string; input: unknown }>();

function safeOnStart(door: ToolDoor, tool: string, input: unknown): string {
  const id = generateEntryId();
  try {
    const entry: TrailEntry = {
      id,
      seq: seqCounter++,
      door,
      tool,
      summary: tool, // provisional; replaced by the real summary in onFinish
      status: 'running',
      startedAt: Date.now(),
      undoDepth: getAbsoluteHistoryDepth(),
      touchedIds: [],
      revertState: 'none',
    };
    pendingByEntryId.set(id, { tool, input });
    useTrailStore.getState().addEntry(entry);
  } catch (err) {
    // The trail must never be the reason a tool call fails. Swallow, log, and still hand back
    // an id so the matching onFinish has something (harmless) to look up.
    console.error('[activityTrail] onStart failed', err);
  }
  return id;
}

function safeOnFinish(entryId: string, result: ToolResult): void {
  try {
    const pending = pendingByEntryId.get(entryId);
    pendingByEntryId.delete(entryId);
    const tool = pending?.tool ?? '';
    const ok = !!(result && typeof result === 'object' && (result as { ok?: boolean }).ok);
    const startedEntry = useTrailStore.getState().entries.find((e) => e.id === entryId);
    const depthAfter = getAbsoluteHistoryDepth();
    const delta = startedEntry ? depthAfter - startedEntry.undoDepth : 0;

    useTrailStore.getState().updateEntry(entryId, {
      status: ok ? 'ok' : 'error',
      error: ok ? undefined : (result as { error?: string })?.error,
      durationMs: startedEntry ? Date.now() - startedEntry.startedAt : undefined,
      depthAfter,
      touchedIds: extractTouchedIds(result),
      summary: summarize(tool, pending?.input, result),
      revertState: delta > 0 ? 'revertable' : 'none',
    });
  } catch (err) {
    console.error('[activityTrail] onFinish failed', err);
  }
}

/** Implements toolDispatch.ts's ToolObserver interface. Exported directly so tests can drive
 * the trail without going through the real dispatcher. */
export const trailToolObserver: ToolObserver = {
  onStart: safeOnStart,
  onFinish: safeOnFinish,
};

/**
 * Registers this store's observer with the tool dispatcher (src/agent/webmcp/toolDispatch.ts)
 * — the seam that fires onStart/onFinish for every tool call from every door (Copilot, ChatGPT
 * via WebMCP, Claude Desktop via the remote MCP bridge, and the eval harness). Call once, e.g.
 * on app init.
 */
export function installTrailObserver(): void {
  setToolObserver(trailToolObserver);
}

/**
 * Display-only revert state: layers 'stale' on top of the persisted 'revertable' value when
 * either (a) the user has since undone past this entry, or (b) this entry's target snapshot
 * has already been evicted by the MAX_HISTORY floor (see store.ts historyBase). Call this from
 * render, not from a store subscription — recomputing on every store change would mean a
 * subscription that fires on every single keystroke elsewhere on the canvas.
 */
export function getRevertState(entry: TrailEntry): TrailEntry['revertState'] {
  if (entry.revertState === 'reverted' || entry.revertState === 'none') return entry.revertState;
  const currentDepth = getAbsoluteHistoryDepth();
  const historyBase = useStore.getState().historyBase;
  if (entry.undoDepth > currentDepth) return 'stale'; // undone past this entry already
  if (entry.undoDepth < historyBase) return 'stale'; // target snapshot evicted by MAX_HISTORY
  return entry.revertState;
}

/** Which of the two 'stale' causes applies, for an accurate tooltip. Null when not stale. */
export function getStaleReason(entry: TrailEntry): 'undone-past' | 'below-floor' | null {
  const currentDepth = getAbsoluteHistoryDepth();
  const historyBase = useStore.getState().historyBase;
  if (entry.undoDepth > currentDepth) return 'undone-past';
  if (entry.undoDepth < historyBase) return 'below-floor';
  return null;
}

/**
 * How many snapshots between now and `id`'s target depth were NOT made by a trail entry
 * (i.e. not by an agent tool call) — interleaved human edits that "Undo back to here" would
 * also revert. 0 means the rewind is agent-only.
 */
export function countForeignSteps(id: string): number {
  const entries = useTrailStore.getState().entries;
  const target = entries.find((e) => e.id === id);
  if (!target) return 0;

  const currentDepth = getAbsoluteHistoryDepth();
  const totalSteps = Math.max(0, currentDepth - target.undoDepth);

  const agentClaimedSteps = entries.reduce((sum, e) => {
    if (e.undoDepth < target.undoDepth) return sum;
    if (e.depthAfter === undefined) return sum; // still running, hasn't claimed anything yet
    return sum + Math.max(0, e.depthAfter - e.undoDepth);
  }, 0);

  return Math.max(0, totalSteps - agentClaimedSteps);
}

const REVERT_LOOP_GUARD = 1000; // MAX_HISTORY is 50; this is generous headroom, not a real limit

/**
 * Winds the main store's undo stack back to the state right before `id`'s tool call ran, and
 * marks that entry plus every later one 'reverted'. See the module header for why this is an
 * all-the-way-back operation rather than a single-step undo.
 */
export function revertToEntry(id: string): { ok: boolean; reason?: string; foreignSteps?: number } {
  const entries = useTrailStore.getState().entries;
  const entry = entries.find((e) => e.id === id);
  if (!entry) return { ok: false, reason: 'This step is no longer in the trail.' };
  if (entry.status === 'running') return { ok: false, reason: 'This step is still running — wait for it to finish.' };

  const displayState = getRevertState(entry);
  if (displayState === 'stale') {
    const reason =
      getStaleReason(entry) === 'below-floor'
        ? 'Too old to undo — earlier history was already discarded to stay within the undo limit.'
        : 'Too old to undo — you already undid past this step.';
    return { ok: false, reason };
  }
  if (displayState === 'reverted') return { ok: false, reason: 'Already undone.' };
  if (displayState === 'none') return { ok: false, reason: 'This step made no canvas change to undo.' };

  const foreignSteps = countForeignSteps(id);
  const target = entry.undoDepth;

  let guard = 0;
  while (getAbsoluteHistoryDepth() > target && useStore.getState().history.length > 0 && guard < REVERT_LOOP_GUARD) {
    useStore.getState().undo();
    guard += 1;
  }

  if (getAbsoluteHistoryDepth() !== target) {
    return { ok: false, reason: 'Could not fully rewind to this step — history ran out first.', foreignSteps };
  }

  const idx = entries.findIndex((e) => e.id === id);
  // Entries are newest-first: index 0..idx are this entry and everything that happened after it.
  const idsToMarkReverted = entries.slice(0, idx + 1).map((e) => e.id);
  useTrailStore.getState().markReverted(idsToMarkReverted);

  return { ok: true, foreignSteps };
}
