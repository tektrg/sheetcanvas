import React, { useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, FileText, Plus, Search, Tag, X } from 'lucide-react';
import { useStore } from '../../store';
import { addTagToList, collectAllTags, extractEmbeddedChartIds, notePlainText, pageDisplayTitle, removeTagFromList } from '../../utils/pages';
import { DEFAULT_LIBRARY_VIEW, LibrarySortField, LibraryViewState, queryLibraryPageIds } from '../../utils/libraryQuery';

interface LibraryViewProps {
  onOpenPage: (noteId: string) => void;
}

const formatUpdatedDate = (epochMs: number | undefined): string =>
  epochMs ? new Date(epochMs).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

const TagChip: React.FC<{ tag: string; active?: boolean; onClick?: () => void; onRemove?: () => void }> = ({ tag, active, onClick, onRemove }) => (
  React.createElement(onClick ? 'button' : 'span', {
    ...(onClick ? { type: 'button', onClick, 'aria-pressed': !!active } : {}),
    className: `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border transition-colors
      ${onClick ? 'cursor-pointer' : ''}
      ${active
        ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-200 dark:border-teal-800 text-teal-700 dark:text-teal-300'
        : 'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'}`,
  },
    <span className="max-w-[16rem] truncate">#{tag}</span>,
    onRemove && (
      <button
        type="button"
        aria-label={`Remove tag ${tag}`}
        onClick={(event) => { event.stopPropagation(); onRemove(); }}
        className="rounded-full hover:text-red-500"
      >
        <X size={10} />
      </button>
    ),
  )
);

const AddTagInput: React.FC<{ onAdd: (tag: string) => void }> = ({ onAdd }) => {
  const [draftTag, setDraftTag] = useState('');
  const commit = () => {
    if (draftTag.trim()) onAdd(draftTag);
    setDraftTag('');
  };
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-dashed border-neutral-300 dark:border-neutral-600 px-2 py-0.5 text-[11px] text-neutral-500">
      <Plus size={10} />
      <input
        value={draftTag}
        onChange={(event) => setDraftTag(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
        onBlur={commit}
        onClick={(event) => event.stopPropagation()}
        placeholder="tag"
        aria-label="Add tag"
        className="w-14 bg-transparent outline-none placeholder:text-neutral-400"
      />
    </span>
  );
};

export const LibraryView: React.FC<LibraryViewProps> = ({ onOpenPage }) => {
  const notesById = useStore(state => state.notes);
  const updateNote = useStore(state => state.updateNote);
  const saveSnapshot = useStore(state => state.saveSnapshot);
  const [view, setView] = useState<LibraryViewState>(DEFAULT_LIBRARY_VIEW);

  const notes = useMemo(() => Object.values(notesById), [notesById]);
  const allTags = useMemo(() => collectAllTags(notes), [notes]);
  const visiblePageIds = useMemo(() => queryLibraryPageIds(notes, view), [notes, view]);

  // Tag edits are user edits like note text edits: snapshot first so Cmd+Z restores them.
  const setTags = (noteId: string, tags: string[]) => {
    saveSnapshot();
    updateNote(noteId, { tags });
  };

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-neutral-100 dark:bg-neutral-900">
      <div className="mx-auto max-w-4xl px-4 sm:px-6 pt-20 pb-32">
        <div className="mb-6 flex items-baseline justify-between">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">Library</h1>
          <span className="text-xs text-neutral-500 tabular-nums">{visiblePageIds.length} of {notes.length} pages</span>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <label className="flex flex-1 min-w-[220px] items-center gap-2 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2">
            <Search size={14} className="text-neutral-400" />
            <input
              value={view.searchText}
              onChange={(event) => setView(prev => ({ ...prev, searchText: event.target.value }))}
              placeholder="Search title or text"
              aria-label="Search pages"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-400"
            />
          </label>
          <select
            value={view.sortField}
            onChange={(event) => setView(prev => ({ ...prev, sortField: event.target.value as LibrarySortField }))}
            aria-label="Sort pages"
            className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 px-3 py-2 text-sm"
          >
            <option value="updatedAt">Recently updated</option>
            <option value="title">Title A–Z</option>
          </select>
        </div>

        {allTags.length > 0 && (
          <div className="mb-5 flex flex-wrap items-center gap-1.5">
            <Tag size={12} className="text-neutral-400" />
            <TagChip tag="all" active={view.tag === null} onClick={() => setView(prev => ({ ...prev, tag: null }))} />
            {allTags.map(tag => (
              <TagChip
                key={tag}
                tag={tag}
                active={view.tag === tag}
                onClick={() => setView(prev => ({ ...prev, tag: prev.tag === tag ? null : tag }))}
              />
            ))}
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {visiblePageIds.map(noteId => {
            const note = notesById[noteId];
            const chartCount = extractEmbeddedChartIds(note.content ?? '').length;
            return (
              <li
                key={noteId}
                data-testid="library-page-row"
                className="group rounded-2xl border border-neutral-200/70 dark:border-neutral-700/70 bg-white dark:bg-neutral-800/80 px-4 py-3 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => onOpenPage(noteId)} className="flex min-w-0 flex-1 items-start gap-2 text-left">
                    <FileText size={16} className="mt-0.5 shrink-0 text-neutral-400" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-neutral-900 dark:text-neutral-100" title={pageDisplayTitle(note)}>{pageDisplayTitle(note)}</span>
                      <span className="block truncate text-xs text-neutral-500">{notePlainText(note) || 'Empty page'}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-3 text-[11px] text-neutral-400">
                    {chartCount > 0 && (
                      <span className="inline-flex items-center gap-1" title="Embedded charts"><BarChart3 size={12} />{chartCount}</span>
                    )}
                    <span className="hidden sm:inline tabular-nums">{formatUpdatedDate(note.updatedAt)}</span>
                    <button
                      type="button"
                      onClick={() => onOpenPage(noteId)}
                      aria-label="Open on canvas"
                      className="rounded-full p-1 hover:bg-neutral-100 dark:hover:bg-neutral-700 hover:text-teal-600"
                    >
                      <ArrowUpRight size={14} />
                    </button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-6">
                  {(note.tags ?? []).map(tag => (
                    <TagChip key={tag} tag={tag} onRemove={() => setTags(noteId, removeTagFromList(note.tags, tag))} />
                  ))}
                  <AddTagInput onAdd={(tag) => setTags(noteId, addTagToList(note.tags, tag))} />
                </div>
              </li>
            );
          })}
        </ul>

        {visiblePageIds.length === 0 && (
          <p className="mt-10 text-center text-sm text-neutral-500">
            {notes.length === 0 ? 'No pages yet. Add a note on the canvas to start.' : 'No pages match this search or tag.'}
          </p>
        )}
      </div>
    </div>
  );
};
