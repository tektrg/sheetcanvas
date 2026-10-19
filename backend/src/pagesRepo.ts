// Storage for published pages, behind an interface so routes are testable
// without D1 (tests use `createMemoryPagesRepo`).

export type PageStatus = 'published' | 'unpublished';
export type PublishEventKind = 'publish' | 'republish';

export interface PublishedPageRow {
  id: string;
  slug: string;
  edit_key_hash: string;
  title: string;
  description: string;
  snapshot_json: string;
  word_count: number;
  status: PageStatus;
  created_at: number;
  updated_at: number;
}

export type PageListing = Pick<PublishedPageRow, 'id' | 'slug' | 'title' | 'description' | 'word_count' | 'updated_at'>;

export interface PageReportRow {
  id: string;
  page_id: string;
  reason: string;
  details: string;
  contact: string;
  ip_hash: string;
  created_at: number;
}

export interface PagesRepo {
  insertPage(row: PublishedPageRow): Promise<void>;
  getPage(id: string): Promise<PublishedPageRow | null>;
  updatePage(id: string, fields: Partial<Omit<PublishedPageRow, 'id' | 'edit_key_hash' | 'created_at'>>): Promise<void>;
  listPublished(limit: number): Promise<PageListing[]>;
  countEvents(ipHash: string, kind: PublishEventKind, sinceMs: number): Promise<number>;
  recordEvent(ipHash: string, kind: PublishEventKind, atMs: number): Promise<void>;
  insertReport(row: PageReportRow): Promise<void>;
}

export const createD1PagesRepo = (db: D1Database): PagesRepo => ({
  async insertPage(row) {
    await db
      .prepare(
        `INSERT INTO published_pages (id, slug, edit_key_hash, title, description, snapshot_json, word_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(row.id, row.slug, row.edit_key_hash, row.title, row.description, row.snapshot_json, row.word_count, row.status, row.created_at, row.updated_at)
      .run();
  },
  async getPage(id) {
    return (await db.prepare(`SELECT * FROM published_pages WHERE id = ?`).bind(id).first<PublishedPageRow>()) ?? null;
  },
  async updatePage(id, fields) {
    const entries = Object.entries(fields).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return;
    const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
    await db
      .prepare(`UPDATE published_pages SET ${assignments} WHERE id = ?`)
      .bind(...entries.map(([, value]) => value), id)
      .run();
  },
  async listPublished(limit) {
    const result = await db
      .prepare(
        `SELECT id, slug, title, description, word_count, updated_at FROM published_pages
         WHERE status = 'published' ORDER BY updated_at DESC LIMIT ?`
      )
      .bind(limit)
      .all<PageListing>();
    return result.results ?? [];
  },
  async countEvents(ipHash, kind, sinceMs) {
    const row = await db
      .prepare(`SELECT COUNT(*) AS n FROM publish_events WHERE ip_hash = ? AND kind = ? AND created_at >= ?`)
      .bind(ipHash, kind, sinceMs)
      .first<{ n: number }>();
    return row?.n ?? 0;
  },
  async recordEvent(ipHash, kind, atMs) {
    await db.prepare(`INSERT INTO publish_events (ip_hash, kind, created_at) VALUES (?, ?, ?)`).bind(ipHash, kind, atMs).run();
  },
  async insertReport(row) {
    await db
      .prepare(
        `INSERT INTO page_reports (id, page_id, reason, details, contact, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(row.id, row.page_id, row.reason, row.details, row.contact, row.ip_hash, row.created_at)
      .run();
  },
});

export const createMemoryPagesRepo = () => {
  const pages = new Map<string, PublishedPageRow>();
  const events: Array<{ ipHash: string; kind: PublishEventKind; at: number }> = [];
  const reports: PageReportRow[] = [];
  const repo: PagesRepo = {
    async insertPage(row) { pages.set(row.id, { ...row }); },
    async getPage(id) { return pages.has(id) ? { ...pages.get(id)! } : null; },
    async updatePage(id, fields) {
      const current = pages.get(id);
      if (current) pages.set(id, { ...current, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) });
    },
    async listPublished(limit) {
      return [...pages.values()]
        .filter(page => page.status === 'published')
        .sort((a, b) => b.updated_at - a.updated_at)
        .slice(0, limit);
    },
    async countEvents(ipHash, kind, sinceMs) {
      return events.filter(e => e.ipHash === ipHash && e.kind === kind && e.at >= sinceMs).length;
    },
    async recordEvent(ipHash, kind, at) { events.push({ ipHash, kind, at }); },
    async insertReport(row) { reports.push(row); },
  };
  return { repo, pages, reports };
};
