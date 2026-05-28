import type { Context } from 'hono';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import {
  streamText,
  stepCountIs,
  tool,
  convertToModelMessages,
  type UIMessage,
} from 'ai';
import type { Env } from '../env';
import { HttpError } from '../errors';
import { toolDefs, type ToolName } from '../../../agent/tools';
import { checkAndIncrementQuota, readQuota } from './quota';

const DEFAULT_MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are SheetCanvas Copilot, an agent that operates a spreadsheet+canvas app on the user's behalf.

Capabilities:
- Read sheet structure and data via listSheets, describeSheet, getSelection, getRange.
- Run read-only SQL with querySheet(sheetId, sql). The sheet is exposed as a table named "t" with columns named after their headers (sanitized to snake_case lowercase). Use this to inspect, aggregate, or filter data before mutating.
- Mutate via setCells, applyFilter, applySort, applyFormat, createChart, createPivot, createSparkline.

Rules:
- Never assume cell values or column types. Inspect with describeSheet or querySheet first.
- Resolve relative dates (e.g. "last quarter") to absolute date ranges in your tool arguments.
- Prefer one well-formed tool call over many probes.
- For filter/sort/format requests against the user's current selection, call getSelection first if no sheetId is implied.
- If a request requires a data connector that does not exist, say so plainly — do not attempt connector creation in this version.
- Pivot and sparkline sheets are *derived* from a source sheet and recompute automatically. Never call setCells or applyFormat on a derived sheet — operate on the source. For inline mini-charts on a column, use applyFormat with visual="sparkline" instead of creating a sparkline sheet.
- After mutating, briefly tell the user what changed.

Tool results are returned as JSON. If a tool returns { ok: false, error }, surface the error to the user and stop.`;

function getSessionId(c: Context<{ Bindings: Env }>): string {
  const raw = c.req.header('x-session-id')?.trim();
  if (!raw || raw.length < 8 || raw.length > 80) {
    throw new HttpError(400, 'missing_session', 'x-session-id header is required');
  }
  return raw;
}

export async function handleAgentRequest(c: Context<{ Bindings: Env }>) {
  const apiKey = c.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim();
  if (!apiKey) {
    return c.json(
      { error: { code: 'missing_api_key', message: 'GOOGLE_GENERATIVE_AI_API_KEY is not configured' } },
      503,
    );
  }
  const sessionId = getSessionId(c);

  const body = await c.req.json().catch(() => null) as { messages?: UIMessage[]; context?: string } | null;
  if (!body?.messages || !Array.isArray(body.messages)) {
    throw new HttpError(400, 'bad_request', 'messages[] is required');
  }
  const appContext = typeof body.context === 'string' && body.context.length < 16_000 ? body.context : '';

  const quota = await checkAndIncrementQuota(c.env, sessionId);
  if (quota.remaining < 0 || (quota.used > quota.limit)) {
    return c.json(
      { error: { code: 'quota_exceeded', message: `Daily agent limit reached (${quota.limit} turns).` }, quota },
      429,
    );
  }

  const google = createGoogleGenerativeAI({ apiKey });
  const modelId = c.env.AGENT_MODEL?.trim() || DEFAULT_MODEL;

  // Build client tools: schemas only, no execute. Cast schemas to any to bridge
  // zod-version drift between root and backend installs (runtime is unaffected).
  const tools = Object.fromEntries(
    (Object.entries(toolDefs) as [ToolName, (typeof toolDefs)[ToolName]][]).map(([name, def]) => [
      name,
      tool({ description: def.description, inputSchema: def.inputSchema as any }),
    ]),
  );

  const modelMessages = await convertToModelMessages(body.messages);

  const systemPrompt = appContext
    ? `${SYSTEM_PROMPT}\n\nCurrent app state (JSON):\n${appContext}`
    : SYSTEM_PROMPT;

  const result = streamText({
    model: google(modelId),
    system: systemPrompt,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse({
    headers: {
      'x-agent-quota-used': String(quota.used),
      'x-agent-quota-limit': String(quota.limit),
    },
  });
}

export async function handleQuotaRead(c: Context<{ Bindings: Env }>) {
  const sessionId = getSessionId(c);
  const quota = await readQuota(c.env, sessionId);
  return c.json({ quota });
}
