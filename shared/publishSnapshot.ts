import { z } from 'zod';

// Wire contract for "anonymous publish": the frozen page snapshot the browser
// sends to POST/PUT /api/pages and the backend renders without any DOM or
// connector access. Compiled by both the frontend and backend (like agent/tools.ts).

export const MAX_PUBLISH_BODY_BYTES = 512 * 1024;
export const MAX_PUBLISHED_CHARTS = 20;
export const PUBLISHED_CHART_TYPES = ['line', 'bar', 'pie', 'area', 'scatter', 'treemap'] as const;

export const publishedSeriesSchema = z.object({
  key: z.string().max(200),
  label: z.string().max(200),
  color: z.string().regex(/^#[0-9a-fA-F]{3,8}$/),
  type: z.enum(PUBLISHED_CHART_TYPES).optional(),
});

export const publishedRowSchema = z.object({
  label: z.string().max(500),
  values: z.array(z.number().finite().nullable()).max(50),
});

export const publishedChartSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().max(300),
  type: z.enum(PUBLISHED_CHART_TYPES),
  stacked: z.boolean().optional(),
  hideData: z.boolean().optional(),
  series: z.array(publishedSeriesSchema).min(1).max(50),
  rows: z.array(publishedRowSchema).max(20_000),
});

export const publishSnapshotSchema = z.object({
  version: z.literal(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(500).optional(),
  tags: z.array(z.string().max(60)).max(30).default([]),
  format: z.enum(['html', 'markdown']),
  // Note content with <CanvasChart id="..."/> placeholders referencing `charts`.
  content: z.string().max(200_000),
  charts: z.array(publishedChartSchema).max(MAX_PUBLISHED_CHARTS),
});

export type PublishedSeries = z.infer<typeof publishedSeriesSchema>;
export type PublishedRow = z.infer<typeof publishedRowSchema>;
export type PublishedChart = z.infer<typeof publishedChartSchema>;
export type PublishSnapshot = z.infer<typeof publishSnapshotSchema>;

export interface PublishCreatedResponse {
  id: string;
  slug: string;
  url: string;
  editKey: string;
}

export interface PublishUpdatedResponse {
  id: string;
  slug: string;
  url: string;
}

/** URL slug from a title: lowercase ascii words joined by '-', max 60 chars. */
export const slugifyTitle = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '') || 'page';
