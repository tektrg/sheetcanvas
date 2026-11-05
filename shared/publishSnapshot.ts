import { z } from 'zod';
import { isSafeD3Format, MAX_D3_FORMAT_CHARS, MAX_FORMAT_DECIMALS, VALUE_FORMAT_TYPES } from './valueFormat';

// Wire contract for "anonymous publish": the frozen page snapshot the browser
// sends to POST/PUT /api/pages and the backend renders without any DOM or
// connector access. Compiled by both the frontend and backend (like agent/tools.ts).

export const MAX_PUBLISH_BODY_BYTES = 512 * 1024;
export const MAX_PUBLISHED_CHARTS = 20;
export const PUBLISHED_CHART_TYPES = ['line', 'bar', 'pie', 'area', 'scatter', 'treemap'] as const;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);

/** Axis/label number format: a small enum + bounded numbers/strings, never free-form markup. */
export const publishedFormatSchema = z.object({
  type: z.enum(VALUE_FORMAT_TYPES),
  decimals: z.number().int().min(0).max(MAX_FORMAT_DECIMALS).optional(),
  d3Format: z.string().max(MAX_D3_FORMAT_CHARS).refine(isSafeD3Format, 'invalid d3 format').optional(),
});

export const publishedSeriesSchema = z.object({
  key: z.string().max(200),
  label: z.string().max(200),
  color: hexColorSchema,
  type: z.enum(PUBLISHED_CHART_TYPES).optional(),
  // Dual-axis charts: series plotted against the right-hand Y scale. Absent = left.
  axis: z.literal('right').optional(),
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
  // Epoch ms the data was last fetched (connector refresh). Absent → the page's publish time.
  dataAsOf: z.number().int().positive().optional(),
  series: z.array(publishedSeriesSchema).min(1).max(50),
  rows: z.array(publishedRowSchema).max(20_000),
  // Formats for the left / right value axis (and the data labels drawn against them). Absent = generic compact.
  axisFormats: z.object({ left: publishedFormatSchema.optional(), right: publishedFormatSchema.optional() }).optional(),
  // Draw formatted value labels on the marks.
  showLabels: z.boolean().optional(),
  // Row index drawn in the highlight colour (bar / dot / pie slice).
  highlightIndex: z.number().int().min(0).max(20_000).optional(),
  // Pie/treemap slice colours as the canvas palette resolved them (mono ramp etc.); cycled by row. Absent = derived from series.
  categoryColors: z.array(hexColorSchema).min(1).max(32).optional(),
});

// "Answer box": author-reviewed TL;DR + Q&A shown under the title for AI answer engines.
export const ANSWER_BOX_LIMITS = { summaryChars: 300, faqItems: 5, questionChars: 200, answerChars: 600 } as const;

export const faqItemSchema = z.object({
  q: z.string().trim().min(1).max(ANSWER_BOX_LIMITS.questionChars),
  a: z.string().trim().min(1).max(ANSWER_BOX_LIMITS.answerChars),
});

export const answerBoxSchema = z.object({
  summary: z.string().trim().max(ANSWER_BOX_LIMITS.summaryChars).optional(),
  faq: z.array(faqItemSchema).max(ANSWER_BOX_LIMITS.faqItems).optional(),
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
  ...answerBoxSchema.shape,
});

export type PublishedFormat = z.infer<typeof publishedFormatSchema>;
export type PublishedSeries = z.infer<typeof publishedSeriesSchema>;
export type PublishedRow = z.infer<typeof publishedRowSchema>;
export type PublishedChart = z.infer<typeof publishedChartSchema>;
export type PublishSnapshot = z.infer<typeof publishSnapshotSchema>;
export type FaqItem = z.infer<typeof faqItemSchema>;
export type AnswerBox = z.infer<typeof answerBoxSchema>;

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

/** URL slug from a title: "Q2 Đơn hàng!" → "q2-don-hang"; max 60 chars, "page" when nothing is left. */
export const slugifyTitle = (title: string): string =>
  title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '') || 'page';
