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

