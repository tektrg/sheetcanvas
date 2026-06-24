import { z } from "zod";

export const clickhouseConnectorDraftSchema = z.object({
  name: z.string().trim().min(1).optional(),
  url: z.string().trim().url(),
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

export const clickhouseTestSchema = clickhouseConnectorDraftSchema.pick({
  url: true,
  username: true,
  password: true
});

export const clickhouseCreateSchema = clickhouseConnectorDraftSchema;

export const clickhouseQuerySchema = z.object({
  connectorId: z.string().trim().min(1),
  sql: z.string().trim().min(1),
  limit: z.number().int().positive().max(100_000).optional(),
  timeoutMs: z.number().int().positive().max(120_000).optional()
});

export const googleAnalyticsAuthExchangeSchema = z.object({
  code: z.string().trim().min(1),
  codeVerifier: z.string().trim().min(1),
  redirectUri: z.string().trim().url(),
  connectorId: z.string().trim().min(1).optional()
});

export const googleSheetsAuthExchangeSchema = googleAnalyticsAuthExchangeSchema;

const gaNameSchema = z.object({ name: z.string().trim().min(1) });
const gaDateRangeSchema = z.object({
  startDate: z.string().trim().min(1),
  endDate: z.string().trim().min(1)
});

export const googleAnalyticsReportSchema = z.object({
  dateRanges: z.array(gaDateRangeSchema).optional(),
  dimensions: z.array(gaNameSchema).optional(),
  metrics: z.array(gaNameSchema).optional(),
  dimensionFilter: z.unknown().optional(),
  metricFilter: z.unknown().optional(),
  orderBys: z.array(z.unknown()).optional(),
  limit: z.number().int().positive().max(100_000).optional()
});

export const googleAnalyticsQuerySchema = z.object({
  connectorId: z.string().trim().min(1),
  propertyId: z.string().trim().min(1),
  report: googleAnalyticsReportSchema.optional()
});

export const googleSheetsQuerySchema = z.object({
  connectorId: z.string().trim().min(1),
  spreadsheetIdOrUrl: z.string().trim().min(1),
  range: z.string().trim().min(1).optional()
});

export const googleAnalyticsPropertiesSchema = z.object({
  connectorId: z.string().trim().min(1),
  pageSize: z.number().int().min(1).max(200).optional(),
  pageToken: z.string().trim().min(1).optional(),
});

export const clickhouseSchemaSchema = z.object({
  connectorId: z.string().trim().min(1),
  database: z.string().trim().min(1).optional(),
});

export const clickhouseDescribeSchema = z.object({
  connectorId: z.string().trim().min(1),
  table: z.string().trim().min(1),
});

export const googleAnalyticsMetadataSchema = z.object({
  connectorId: z.string().trim().min(1),
  propertyId: z.string().trim().min(1),
});
