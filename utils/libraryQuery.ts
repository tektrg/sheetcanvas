import { evaluate, FieldDefinition, FilterCondition, FilterNode, SourceRow, ViewSpec } from '@tektrg/table-core';
import { NoteData } from '../types';
import { notePlainText, pageDisplayTitle } from './pages';

// Adapter from notes (pages) to the shared table engine `@tektrg/table-core`:
// the Library view state becomes a ViewSpec and `evaluate` does search/filter/sort.

export type LibrarySortField = 'updatedAt' | 'title';

export interface LibraryViewState {
  searchText: string;
  tag: string | null; // null = all tags
  sortField: LibrarySortField;
}

export const DEFAULT_LIBRARY_VIEW: LibraryViewState = { searchText: '', tag: null, sortField: 'updatedAt' };

export const LIBRARY_FIELDS: FieldDefinition[] = [
  { id: 'title', label: 'Title', type: 'text' },
  { id: 'text', label: 'Text', type: 'text' },
  { id: 'tags', label: 'Tags', type: 'multiSelect' },
  { id: 'updatedAt', label: 'Updated', type: 'date' },
];

export interface LibraryRow extends SourceRow {
  id: string;
  title: string;
  text: string;
  tags: string[];
  updatedAt: string; // ISO-8601, as table-core dates expect
}

export const toLibraryRow = (note: NoteData): LibraryRow => ({
  id: note.id,
  title: pageDisplayTitle(note),
  text: notePlainText(note),
  tags: note.tags ?? [],
  updatedAt: new Date(note.updatedAt ?? note.createdAt ?? 0).toISOString(),
});

export const buildLibraryViewSpec = (view: LibraryViewState): ViewSpec => {
  const conditions: FilterNode[] = [];
  const needle = view.searchText.trim();
  if (needle) {
    const matchField = (fieldId: string): FilterCondition => ({ kind: 'condition', fieldId, operator: 'contains', value: needle });
    conditions.push({ kind: 'group', combinator: 'or', children: [matchField('title'), matchField('text')] });
  }
  if (view.tag) {
    conditions.push({ kind: 'condition', fieldId: 'tags', operator: 'contains', value: view.tag });
  }
  return {
    specVersion: 1,
    viewType: 'list',
    filter: { kind: 'group', combinator: 'and', children: conditions },
    sort: view.sortField === 'title'
      ? [{ fieldId: 'title', direction: 'asc', collation: 'natural' }]
      : [{ fieldId: 'updatedAt', direction: 'desc' }],
  };
};

/** Note ids matching the Library view, in display order. */
export const queryLibraryPageIds = (notes: NoteData[], view: LibraryViewState): string[] => {
  const result = evaluate(buildLibraryViewSpec(view), notes.map(toLibraryRow), LIBRARY_FIELDS);
  if (result.ok === false) {
    console.error('Library view spec rejected by table-core:', result.errors);
    return [];
  }
  return result.rows.map(row => String(row.id));
};
