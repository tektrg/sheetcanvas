import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  FlaskConical,
  Loader2,
  MessageSquare,
  Plug,
  Sparkles,
  Undo2,
} from 'lucide-react';
import {
  countForeignSteps,
  getRevertState,
  getStaleReason,
  revertToEntry,
  useTrailStore,
  type TrailEntry,
  type ToolDoor,
} from '../agent/activityTrail';

/**
 * Layout note: this panel is a bottom-LEFT floating stack, deliberately not another
 * right-side drawer. AgentChatPanel (the Copilot drawer) is `fixed; top:0; right:0; bottom:0;
 * width: min(400px, 100vw); z-index: 1000` — a full-height right-side panel — and App.tsx
 * also floats the "Connect Agent" / "Open Copilot" pill at `fixed bottom-8 right: 16 or 396`.
 * Two competing right-side elements is how this kind of layout breaks.
 *
 * The bottom-left corner was verified free before choosing it: Toolbar.tsx floats at
 * `fixed bottom-8 left-1/2 -translate-x-1/2` (bottom-CENTER, not left), Toast.tsx sits at
 * `fixed top-8` (top-center), and the only other fixed-position elements in the app
 * (SettingsPopover, HeaderDropdownMenu, SheetColumnMenu) are JS-positioned popovers anchored
 * to whatever triggered them, not corner-docked. The full-screen `fixed inset-0` modal
 * backdrops (chart/pivot/connector dialogs, CommandBar) cover everything while open, same as
 * they already do to the Toolbar and Copilot pill — not a new conflict this panel introduces.
 *
 * z-[900] is deliberately below the Copilot drawer's z-[1000] so this panel can never cover it.
 */
const PANEL_STYLE: React.CSSProperties = {
  position: 'fixed',
  left: 16,
  bottom: 16,
  width: 340,
  maxHeight: '40vh',
  zIndex: 900,
};

const AUTO_COLLAPSE_IDLE_MS = 6000;

const DOOR_BADGE: Record<ToolDoor, { label: string; icon: React.ElementType; className: string }> = {
  copilot: {
    label: 'Copilot',
    icon: Sparkles,
    className: 'bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  },
  chatgpt: {
    label: 'ChatGPT',
    icon: MessageSquare,
    className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  },
  'remote-mcp': {
    label: 'MCP',
    icon: Plug,
    className: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
  },
  eval: {
    label: 'Eval',
    icon: FlaskConical,
    className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  },
};

function DoorBadge({ door }: { door: ToolDoor }) {
  const badge = DOOR_BADGE[door];
  const Icon = badge.icon;
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium flex-shrink-0 ${badge.className}`}
    >
      <Icon size={10} strokeWidth={2.5} />
      {badge.label}
    </span>
  );
}

function StatusIcon({ status }: { status: TrailEntry['status'] }) {
  if (status === 'running') return <Loader2 size={13} className="animate-spin text-neutral-400 flex-shrink-0" />;
  if (status === 'error') return <AlertCircle size={13} className="text-red-500 flex-shrink-0" />;
  return <CheckCircle2 size={13} className="text-teal-500 flex-shrink-0" />;
}

function formatDuration(ms: number | undefined): string | null {
  if (ms === undefined) return null;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface TrailRowProps {
  entry: TrailEntry;
  confirmingForeignSteps: number | null;
  onUndoClick: (entry: TrailEntry) => void;
}

const TrailRow: React.FC<TrailRowProps> = ({ entry, confirmingForeignSteps, onUndoClick }) => {
  const revertState = getRevertState(entry);
  const staleReason = revertState === 'stale' ? getStaleReason(entry) : null;
  const canUndo = entry.status !== 'running' && revertState === 'revertable';
  const durationLabel = formatDuration(entry.durationMs);

  const tooltip =
    revertState === 'stale'
      ? staleReason === 'below-floor'
        ? 'Too old to undo — this step fell out of the undo window.'
        : 'Too old to undo — you already undid past this step.'
      : revertState === 'reverted'
        ? 'Already undone'
        : revertState === 'none'
          ? 'Nothing to undo for this step'
          : 'Undo back to here';

  return (
    <div className="px-3 py-2 border-b border-neutral-100 dark:border-neutral-800 last:border-b-0">
      <div className="flex items-start gap-2">
        <StatusIcon status={entry.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-0.5">
            <DoorBadge door={entry.door} />
            {durationLabel && (
              <span className="text-[10px] text-neutral-400 dark:text-neutral-500 flex-shrink-0">{durationLabel}</span>
            )}
          </div>
          <p
            className={`text-xs leading-snug break-words ${
              entry.status === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-700 dark:text-neutral-300'
            }`}
          >
            {entry.summary}
          </p>
          {entry.status === 'error' && entry.error && (
            <p className="text-[10px] text-red-500 dark:text-red-400 mt-0.5 break-words">{entry.error}</p>
          )}
        </div>
      </div>

      {revertState !== 'none' && (
        <div className="mt-1.5 pl-[21px]">
          {confirmingForeignSteps !== null ? (
            <div className="flex flex-col gap-1">
              <p className="text-[10px] text-amber-600 dark:text-amber-400">
                This also undoes {confirmingForeignSteps} of your own edit{confirmingForeignSteps === 1 ? '' : 's'}.
              </p>
              <button
                onClick={() => onUndoClick(entry)}
                className="self-start text-[11px] font-medium text-red-600 dark:text-red-400 hover:underline cursor-pointer"
              >
                Undo anyway
              </button>
            </div>
          ) : (
            <button
              onClick={() => onUndoClick(entry)}
              disabled={!canUndo}
              title={tooltip}
              className={`inline-flex items-center gap-1 text-[11px] font-medium cursor-pointer ${
                canUndo
                  ? 'text-neutral-600 dark:text-neutral-300 hover:text-teal-600 dark:hover:text-teal-400'
                  : 'text-neutral-300 dark:text-neutral-600 cursor-not-allowed'
              }`}
            >
              <Undo2 size={11} />
              Undo back to here
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export interface TrailListProps {
  entries: TrailEntry[];
}

/** Presentational, newest-first list of trail entries. Owns its own per-row undo-confirm state. */
export const TrailList: React.FC<TrailListProps> = ({ entries }) => {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [confirmingForeignSteps, setConfirmingForeignSteps] = useState<number | null>(null);

  const handleUndoClick = (entry: TrailEntry) => {
    if (confirmingId !== entry.id) {
      const foreign = countForeignSteps(entry.id);
      if (foreign > 0) {
        setConfirmingId(entry.id);
        setConfirmingForeignSteps(foreign);
        return;
      }
    }
    setConfirmingId(null);
    setConfirmingForeignSteps(null);
    revertToEntry(entry.id);
  };

  if (entries.length === 0) {
    return <div className="px-3 py-6 text-xs text-neutral-400 dark:text-neutral-500 text-center">No agent activity yet</div>;
  }

  return (
    <div className="overflow-y-auto" style={{ maxHeight: 'calc(40vh - 44px)' }}>
      {entries.map((entry) => (
        <TrailRow
          key={entry.id}
          entry={entry}
          confirmingForeignSteps={confirmingId === entry.id ? confirmingForeignSteps : null}
          onUndoClick={handleUndoClick}
        />
      ))}
    </div>
  );
};

/**
 * Bottom-left floating panel: auto-shows the first time the trail gets an entry, auto-collapses
 * to a pill after ~6s of no new trail activity, and re-expands on click. Mounted in App.tsx
 * as `<AgentActivityPanel />` (no props).
 */
export const AgentActivityPanel: React.FC = () => {
  const entries = useTrailStore((state) => state.entries);
  const [expanded, setExpanded] = useState(false);
  const idleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (entries.length === 0) return;
    setExpanded(true);
    if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setExpanded(false), AUTO_COLLAPSE_IDLE_MS);
    return () => {
      if (idleTimerRef.current !== null) window.clearTimeout(idleTimerRef.current);
    };
    // Re-arm on ANY trail change (new entry OR an existing one finishing) — `entries` gets a
    // new array reference on every addEntry/updateEntry, so this both opens the panel for a
    // fresh step and keeps it open through a busy multi-step run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  if (entries.length === 0) return null;

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        style={{ position: 'fixed', left: 16, bottom: 16, zIndex: 900 }}
        className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800 cursor-pointer"
      >
        <Sparkles size={13} className="text-teal-500" />
        {entries.length} agent action{entries.length === 1 ? '' : 's'}
      </button>
    );
  }

  return (
    <div
      style={PANEL_STYLE}
      className="flex flex-col rounded-2xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50 overflow-hidden"
    >
      <button
        onClick={() => setExpanded(false)}
        className="flex items-center justify-between px-3 py-2.5 border-b border-neutral-100 dark:border-neutral-800 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-800/50 flex-shrink-0"
      >
        <span className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
          Agent activity · {entries.length}
        </span>
        <ChevronDown size={14} className="text-neutral-400" />
      </button>
      <TrailList entries={entries} />
    </div>
  );
};
