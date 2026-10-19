import { NoteData } from '../types';

// A "page" is a note: the same NoteData record, with title/tags/timestamps so the
// Library can organize it. No parallel entity, so canvas edits and Library edits
// can never drift apart, and embedded charts stay referenced by the note content.

export const UNTITLED_PAGE_TITLE = 'Untitled';
const MAX_DERIVED_TITLE_LENGTH = 80;
const EMBEDDED_CHART_PATTERN = /<CanvasChart\b[^>]*\bid=["']([^"']+)["']/g;

const NAMED_HTML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const HTML_ENTITY_PATTERN = /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi;

/** Decode one HTML entity match; unknown names are left as written. */
const decodeHtmlEntity = (entity: string, body: string): string => {
  if (body[0] === '#') {
    const codePoint = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return Number.isFinite(codePoint) && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
  }
  return NAMED_HTML_ENTITIES[body.toLowerCase()] ?? entity;
};

/** Fill page fields missing from a legacy note. Returns the same object when nothing was missing. */
export const normalizeNotePage = (note: NoteData, nowMs: number = Date.now()): NoteData => {
  const hasAllFields =
    typeof note.title === 'string' &&
    Array.isArray(note.tags) &&
    typeof note.createdAt === 'number' &&
    typeof note.updatedAt === 'number';
  if (hasAllFields) {
    const tags = normalizeTagList(note.tags as string[]);
    const tagsUnchanged = tags.length === note.tags!.length && tags.every((tag, index) => tag === note.tags![index]);
    return tagsUnchanged ? note : { ...note, tags };
  }
  const createdAt = typeof note.createdAt === 'number' ? note.createdAt : nowMs;
  return {
    ...note,
    title: typeof note.title === 'string' ? note.title : '',
    tags: Array.isArray(note.tags) ? normalizeTagList(note.tags) : [],
    createdAt,
    updatedAt: typeof note.updatedAt === 'number' ? note.updatedAt : createdAt,
  };
};

/** Note content as plain text: markdown/HTML/MDX markup stripped, whitespace collapsed. */
export const notePlainText = (note: Pick<NoteData, 'content'>): string =>
  (note.content ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/(?<!&)[#*_`>~[\]()!|-]+/g, ' ') // `&#39;` keeps its # for entity decoding
    .replace(HTML_ENTITY_PATTERN, decodeHtmlEntity)
    .replace(/\s+/g, ' ')
    .trim();

/** Explicit title, else the note's first non-empty line, else "Untitled". */
export const pageDisplayTitle = (note: Pick<NoteData, 'title' | 'content'>): string => {
  const explicitTitle = note.title?.trim();
  if (explicitTitle) return explicitTitle;
  // HTML notes break lines with <br>/<div>/<p>/<li>/headings, markdown notes with \n.
  const firstLine = (note.content ?? '')
    .replace(/<br\s*\/?>|<\/?(div|p|li|h[1-6])\b[^>]*>/gi, '\n')
    .split('\n')
    .map(line => notePlainText({ content: line }))
    .find(line => line.length > 0);
  if (!firstLine) return UNTITLED_PAGE_TITLE;
  return firstLine.length > MAX_DERIVED_TITLE_LENGTH ? `${firstLine.slice(0, MAX_DERIVED_TITLE_LENGTH)}…` : firstLine;
};

/** URL-safe slug for future publishing: "Q2 Đơn hàng!" -> "q2-don-hang". */
export const slugifyTitle = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Tags are trimmed, lowercased, de-duplicated; empty tags dropped. */
export const normalizeTag = (rawTag: string): string => rawTag.trim().replace(/^#/, '').toLowerCase();

export const normalizeTagList = (rawTags: string[]): string[] => {
  const uniqueTags: string[] = [];
  for (const rawTag of rawTags) {
    const tag = normalizeTag(rawTag);
    if (tag && !uniqueTags.includes(tag)) uniqueTags.push(tag);
  }
  return uniqueTags;
};

export const addTagToList = (tags: string[] | undefined, rawTag: string): string[] =>
  normalizeTagList([...(tags ?? []), rawTag]);

export const removeTagFromList = (tags: string[] | undefined, tagToRemove: string): string[] =>
  (tags ?? []).filter(tag => tag !== normalizeTag(tagToRemove));

/** Every tag used across notes, sorted. */
export const collectAllTags = (notes: NoteData[]): string[] =>
  Array.from(new Set(notes.flatMap(note => note.tags ?? []))).sort();

/** Chart ids embedded in a note via `<CanvasChart id="..." />`. */
export const extractEmbeddedChartIds = (content: string): string[] =>
  Array.from(new Set(Array.from(content.matchAll(EMBEDDED_CHART_PATTERN), match => match[1])));

/** Updates that change what a page says or how it is organized bump `updatedAt`; moves/resizes do not. */
export const PAGE_CONTENT_FIELDS: ReadonlyArray<keyof NoteData> = ['content', 'title', 'tags', 'format'];

export const touchesPageContent = (updates: Partial<NoteData>): boolean =>
  PAGE_CONTENT_FIELDS.some(field => field in updates);
