import { describe, expect, it } from 'vitest';
import { NoteData } from '../types';
import { migrateLoadedNote, useStore } from '../store';
import {
  addTagToList,
  collectAllTags,
  extractEmbeddedChartIds,
  normalizeNotePage,
  pageDisplayTitle,
  removeTagFromList,
  slugifyTitle,
} from '../utils/pages';
import { DEFAULT_LIBRARY_VIEW, queryLibraryPageIds } from '../utils/libraryQuery';

const NOW_MS = Date.UTC(2026, 9, 19, 12, 0, 0);

const legacyNote = (overrides: Partial<NoteData> = {}): NoteData => ({
  id: 'legacy-1',
  position: { x: 0, y: 0 },
  size: { width: 400, height: 300 },
  content: '# Q2 plan\nShip it',
  color: 'yellow',
  format: 'markdown',
  ...overrides,
});

const page = (id: string, content: string, tags: string[], updatedAt: number, title = ''): NoteData =>
  legacyNote({ id, content, tags, title, createdAt: updatedAt, updatedAt });

describe('page migration', () => {
  it('defaults missing page fields on a legacy note and flags it for re-save', () => {
    const { note, changed } = migrateLoadedNote(legacyNote(), NOW_MS);
    expect(changed).toBe(true);
    expect(note).toMatchObject({ title: '', tags: [], createdAt: NOW_MS, updatedAt: NOW_MS, content: '# Q2 plan\nShip it' });
  });

  it('leaves an already-migrated page untouched', () => {
    const current = page('p1', 'x', ['ideas'], 5, 'Kept');
    const { note, changed } = migrateLoadedNote(current, NOW_MS);
    expect(changed).toBe(false);
    expect(note).toBe(current);
  });

  it('keeps existing fields and normalizes stray tags', () => {
    const note = normalizeNotePage(legacyNote({ createdAt: 10, tags: [' Ideas', 'ideas', ''] }), NOW_MS);
    expect(note).toMatchObject({ createdAt: 10, updatedAt: 10, tags: ['ideas'] });
  });

  it('migrates legacy HTML notes to markdown and adds page fields in one pass', () => {
    const { note } = migrateLoadedNote(legacyNote({ format: undefined, content: '<b>Hello</b>' }), NOW_MS);
    expect(note.format).toBe('markdown');
    expect(note.tags).toEqual([]);
    expect(note.legacyHtml).toBe('<b>Hello</b>');
  });

  it('keeps embedded chart references intact', () => {
    const content = 'Revenue\n<CanvasChart id="chart-a" />\n<CanvasChart id="chart-b" height={200} />';
    const { note } = migrateLoadedNote(legacyNote({ content }), NOW_MS);
    expect(note.content).toBe(content);
    expect(extractEmbeddedChartIds(note.content)).toEqual(['chart-a', 'chart-b']);
  });
});

describe('store page timestamps', () => {
  it('addNote fills page fields; content edits bump updatedAt, moves do not', () => {
    useStore.getState().addNote(legacyNote({ id: 'store-1' }));
    const added = useStore.getState().notes['store-1'];
    expect(added.tags).toEqual([]);
    useStore.getState().updateNote('store-1', { updatedAt: 1 });
    useStore.getState().updateNote('store-1', { position: { x: 5, y: 5 } });
    expect(useStore.getState().notes['store-1'].updatedAt).toBe(1);
    useStore.getState().updateNote('store-1', { tags: ['a'] });
    expect(useStore.getState().notes['store-1'].updatedAt).toBeGreaterThan(1);
  });
});

describe('page helpers', () => {
  it('derives display title from first line when no explicit title', () => {
    expect(pageDisplayTitle({ title: '', content: '\n## **Launch** notes\nbody' })).toBe('Launch notes');
    expect(pageDisplayTitle({ title: ' Explicit ', content: 'x' })).toBe('Explicit');
    expect(pageDisplayTitle({ title: '', content: '' })).toBe('Untitled');
    expect(pageDisplayTitle({ title: '', content: 'Q2 ideas<div>body</div>' })).toBe('Q2 ideas');
    expect(pageDisplayTitle({ title: '', content: '<h3>Welcome</h3><br>more' })).toBe('Welcome');
  });

  it('slugifies titles', () => {
    expect(slugifyTitle('Q2 Đơn hàng!')).toBe('q2-don-hang');
  });

  it('adds and removes tags without duplicates', () => {
    expect(addTagToList(['ideas'], ' #Ideas ')).toEqual(['ideas']);
    expect(addTagToList(['ideas'], 'Q2')).toEqual(['ideas', 'q2']);
    expect(removeTagFromList(['ideas', 'q2'], 'Q2')).toEqual(['ideas']);
    expect(collectAllTags([page('a', '', ['z', 'b'], 1), page('b', '', ['b'], 1)])).toEqual(['b', 'z']);
  });
});

describe('library query (table-core)', () => {
  const pages = [
    page('old', '# Alpha\nrevenue by region', ['finance'], 100),
    page('new', '# beta ideas\nbrainstorm', ['ideas', 'finance'], 300),
    page('mid', 'Gamma Đơn hàng', [], 200, 'Gamma'),
  ];

  it('sorts by updated (newest first) by default', () => {
    expect(queryLibraryPageIds(pages, DEFAULT_LIBRARY_VIEW)).toEqual(['new', 'mid', 'old']);
  });

  it('sorts by title A-Z, case-insensitive', () => {
    expect(queryLibraryPageIds(pages, { ...DEFAULT_LIBRARY_VIEW, sortField: 'title' })).toEqual(['old', 'new', 'mid']);
  });

  it('searches title and body text, ignoring case and accents', () => {
    expect(queryLibraryPageIds(pages, { ...DEFAULT_LIBRARY_VIEW, searchText: 'REVENUE' })).toEqual(['old']);
    expect(queryLibraryPageIds(pages, { ...DEFAULT_LIBRARY_VIEW, searchText: 'don hang' })).toEqual(['mid']);
    expect(queryLibraryPageIds(pages, { ...DEFAULT_LIBRARY_VIEW, searchText: 'beta' })).toEqual(['new']);
  });

  it('filters by tag and combines with search', () => {
    expect(queryLibraryPageIds(pages, { ...DEFAULT_LIBRARY_VIEW, tag: 'finance' })).toEqual(['new', 'old']);
    expect(queryLibraryPageIds(pages, { ...DEFAULT_LIBRARY_VIEW, tag: 'finance', searchText: 'alpha' })).toEqual(['old']);
    expect(queryLibraryPageIds(pages, { ...DEFAULT_LIBRARY_VIEW, tag: 'nope' })).toEqual([]);
  });
});

describe('QA pass 2 fixes', () => {
  it('normalizes tags on load even when every page field is present', () => {
    const note = legacyNote({ title: 't', tags: [' Ideas', 'ideas', '#Q2', ''], createdAt: 1, updatedAt: 2 });
    const { note: loaded, changed } = migrateLoadedNote(note, NOW_MS);
    expect(loaded.tags).toEqual(['ideas', 'q2']);
    expect(changed).toBe(true);
    const clean = legacyNote({ title: 't', tags: ['ideas'], createdAt: 1, updatedAt: 2 });
    expect(normalizeNotePage(clean, NOW_MS)).toBe(clean);
  });

  it('decodes HTML entities in derived titles', () => {
    expect(pageDisplayTitle({ title: '', content: '<p>R&amp;D &lt;Q2&gt; &#39;plan&#x27;</p>' })).toBe("R&D <Q2> 'plan'");
    expect(pageDisplayTitle({ title: '', content: 'Tom &bogus; Jerry' })).toBe('Tom &bogus; Jerry');
  });

  it('tag edits from the Library are undoable via the store snapshot', () => {
    const note = normalizeNotePage(legacyNote({ id: 'undo-1', tags: ['a'] }), NOW_MS);
    useStore.setState({ notes: { [note.id]: note }, noteIds: [note.id], history: [], future: [] });
    useStore.getState().saveSnapshot();
    useStore.getState().updateNote(note.id, { tags: ['a', 'b'] });
    expect(useStore.getState().notes[note.id].tags).toEqual(['a', 'b']);
    useStore.getState().undo();
    expect(useStore.getState().notes[note.id].tags).toEqual(['a']);
  });
});
