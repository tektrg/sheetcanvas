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

const BASE_TOOL_NAMES = [
  'listSheets',
  'describeSheet',
  'getSelection',
  'getRange',
  'querySheet',
  'setCells',
  'createSheet',
  'applyFilter',
  'applySort',
  'applyFormat',
  'createChart',
  'createPivot',
  'createSparkline',
  'createNote',
  'listNotes',
  'readNote',
  'updateNote',
  'deleteNote',
  'listConnections',
  'createQuerySheetFromResult',
  'updateQuerySheet',
] as const satisfies readonly ToolName[];

const SCHEMA_TOOL_NAMES = ['listConnectionProperties', 'describeConnection'] as const satisfies readonly ToolName[];
const QUERY_TOOL_NAMES = ['queryConnection', 'createQuerySheet', 'updateQuerySheet'] as const satisfies readonly ToolName[];
const CONNECTOR_FLOW_TOOL_NAMES = [
  'listConnections',
  'listConnectionProperties',
  'describeConnection',
  'queryConnection',
  'createQuerySheet',
  'createQuerySheetFromResult',
  'updateQuerySheet',
] as const satisfies readonly ToolName[];

const SYSTEM_PROMPT = `You are SheetCanvas Copilot, an agent that operates a spreadsheet+canvas app on the user's behalf.

Capabilities:
- Read sheet structure and data via listSheets, describeSheet, getSelection, getRange.
- getSelection returns both active cell/range selection and selectedCanvas summaries for whole selected sheets, charts, and notes.
- Run read-only SQL with querySheet(sheetId, sql). Sheet exposed as table "t" with snake_case column names.
- Mutate via setCells, applyFilter, applySort, applyFormat, createChart, createPivot, createSparkline, createNote, createQuerySheetFromResult, updateQuerySheet.
- createSheet makes a NEW standalone sheet for manual, scratch, or agent-computed data (optionally pre-filled with a data grid; row 1 is the header row). It has no data source and does not auto-refresh — for connector/external data use createQuerySheet instead so lineage and refresh are preserved; never query externally and paste results into a createSheet.
- createNote writes a live report note: Markdown text that may embed <CellValue sheet="ID" cell="B4" format="currency"/>, <CanvasChart id="CHART_ID" height="240"/>, and <Sparkline sheet="ID" range="B2:B12"/>. Use real ids from prior tool results; unknown ids render inert. Use it to deliver a narrative summary with live numbers/charts as one editable object.
- Revise existing notes instead of piling up new ones: listNotes to find note ids, readNote to get a note's current Markdown, updateNote to replace its content/color (full-content replace — read first, edit the whole body, send it back), deleteNote to remove one. Reuse/updateNote a note you already created rather than creating a near-duplicate.
- Query external data connections via progressive connector tools. Start with listConnections; property/schema/query tools become available after earlier connector steps complete.
- If a user asks for external connection data and only listConnections is available, call listConnections. Do not apologize that downstream connector tools are unavailable; the app will expose them after the connector flow starts. listConnections also returns selectedCanvas context so connector workflows can still respect selected sheets/charts.

Connector query workflow:
1. Call listConnections to see available connections.
2. Before querying, state "Using {connector name} because {reason}." If 2+ connectors plausibly match and descriptions do not disambiguate, ASK the user instead of guessing.
3. For Google Analytics, call listConnectionProperties for the selected connection. If the user says "any", pick the first returned property and say which one. If the result is truncated or property names imply different likely websites and the user intent is ambiguous, ASK.
4. Call describeConnection to learn the schema and get schemaToken (CH: tables first, then columns for the database-qualified table you will query; GA: bounded dims/metrics catalog for a propertyId, use search for the task).
5. For exploration, validation, or answer-only analytics, call queryConnection with schemaToken, a one-line plain-English derivation of what the data shows, and a structured brief with logic, scope, sources, and judgmentNotes. Hidden query results are invisible to the user and acceptable for final answer-only responses.
6. If the result should be shown as a table or used as lineage for a visible chart/derived table, call createQuerySheetFromResult on the private result. If you already know the query result must be visible, createQuerySheet is the direct visible shortcut. If using createGaTrendBySource, provide the same structured brief for the raw connected sheet.
7. Optionally call createChart on the resulting visible sheet. Do not create charts or derived tables from hidden query results directly.
- If the user asks to edit/revise the SQL or query of an existing selected/current connector sheet, call getSelection or describeSheet to identify it, then call updateQuerySheet. Do not create a replacement sheet unless the user explicitly asks for a new sheet.

Query rules:
- ClickHouse: use the real database-qualified table name returned by describeConnection, not the in-app sheet alias "t". Compute absolute YYYY-MM-DD dates from dateAnchors in context. Require GROUP BY + LIMIT for chartable results.
- Google Analytics: native relative dates (e.g. 30daysAgo). Only use dims/metrics from describeConnection.
- Always provide derivation and structured brief for queryConnection/createQuerySheet/updateQuerySheet. On queryConnection/createQuerySheet error, surface it and stop.

General rules:
- Never assume cell values or column types. Inspect first.
- When Current app state includes analyticsKnowledge, treat its rules as the active analysis operating instructions. User-context rules and overlays take precedence over built-in platform/general rules when they conflict. Use the analyticsKnowledge audit only for reasoning/debugging; do not expose internal rule IDs unless the user asks for audit details.
- Apply practical data-analysis workflow guidance, not rigid rules. When the user's requested deliverable is a chart that needs grouped, counted, summed, or conditional series from an existing row-level sheet, prefer creating a persistent aggregation sheet with createPivot first, then call createChart on that pivot. querySheet is useful for exploration or validation, but its temporary results cannot be charted directly and should not be the stopping point for an aggregated chart request.
- For conditional count chart series, prefer createPivot values that use operation "COUNT", countRows when counting rows, descriptive labels, and metric-level conditions. For example, a monthly line chart with one series for BB = "[1] Trúng tuyển" and another for AU = "[1] Đã hẹn phỏng vấn" is best served by a month-grouped pivot with two conditional count values, followed by createChart on the pivot sheet.
- Prefer chart source headers and pivot value labels that are human-readable. The renderer compacts noisy source labels, but the first chart view should optimize for immediate insight over raw implementation labels.
- Treat bare spreadsheet references in the user's message as valid app coordinates: A, AU, BB are column letters/column ids; A1 or BB12 are cells; row numbers are 1-based sheet rows. If the user names column letters, pass them to describeSheet as columnIds. A compact columnIdSpan such as A:BB means every column from A through BB exists, including AU and BB. Do not ask what a column letter means when it is inside columnIdSpan or returned in requestedColumns. For querySheet, map the column letter to the returned schema.sqlName.
- If a requested chart needs an X-axis/date column and the user did not specify one, inspect available date-like columns. Ask only for the axis column if it is genuinely ambiguous; do not also ask the user to clarify already valid column letters or the already selected/current sheet.
- Resolve relative dates to absolute using dateAnchors from context for sheet and ClickHouse workflows; use native relative dates for Google Analytics.
- Prefer one well-formed tool call over many probes.
- For selection-based requests ("this data", "selected chart", "current sheet", "what I selected"), call getSelection first if sheetId/chartId is not explicitly provided. If selectedCanvas includes a chart, use its sourceSheetId for data operations unless the user specifically asks to edit the chart itself.
- Never setCells or applyFormat on pivot/sparkline sheets.
- After mutating, briefly tell the user what changed.

Tool results are JSON. If {ok:false,error}, surface the error and stop.`;

function valueHasToolName(value: unknown, toolName: ToolName): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((item) => valueHasToolName(item, toolName));
  const record = value as Record<string, unknown>;
  return Object.entries(record).some(([key, child]) => {
    if ((key === 'toolName' || key === 'tool') && child === toolName) return true;
    if (key === 'type' && child === `tool-${toolName}`) return true;
    return valueHasToolName(child, toolName);
  });
}

function toolHistoryContains(messages: UIMessage[], toolName: ToolName): boolean {
  return messages.some((message) => valueHasToolName(message, toolName));
}

function currentTurnMessages(messages: UIMessage[]): UIMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === 'user') return messages.slice(i);
  }
  return messages;
}

function selectToolNames(messages: UIMessage[]): ToolName[] {
  const selected = new Set<ToolName>(BASE_TOOL_NAMES);
  const activeMessages = currentTurnMessages(messages);
  const connectorFlowActive =
    toolHistoryContains(activeMessages, 'listConnections') ||
    toolHistoryContains(activeMessages, 'listConnectionProperties') ||
    toolHistoryContains(activeMessages, 'describeConnection');

  if (connectorFlowActive) {
    SCHEMA_TOOL_NAMES.forEach((name) => selected.add(name));
    QUERY_TOOL_NAMES.forEach((name) => selected.add(name));
  }
  return [...selected];
}

function shouldLogAgentFlow(env: Env): boolean {
  if (env.AGENT_FLOW_DEBUG?.trim() === '1') return true;
  return env.ENVIRONMENT?.trim() !== 'production';
}

function summarizeAgentFlow(messages: UIMessage[], selectedToolNames: ToolName[]) {
  const activeMessages = currentTurnMessages(messages);
  const detectedConnectorTools = Object.fromEntries(
    CONNECTOR_FLOW_TOOL_NAMES.map((name) => [name, toolHistoryContains(activeMessages, name)]),
  );
  return {
    messageCount: messages.length,
    currentTurnMessageCount: activeMessages.length,
    lastMessageRole: messages.at(-1)?.role ?? null,
    detectedConnectorTools,
    selectedToolNames,
    createQuerySheetAvailable: selectedToolNames.includes('createQuerySheet'),
    updateQuerySheetAvailable: selectedToolNames.includes('updateQuerySheet'),
  };
}

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
  const selectedToolNames = selectToolNames(body.messages);
  if (shouldLogAgentFlow(c.env)) {
    console.log('[agent-flow] selected tools', summarizeAgentFlow(body.messages, selectedToolNames));
  }
  const tools = Object.fromEntries(
    selectedToolNames.map((name) => {
      const def = toolDefs[name];
      return [
      name,
      tool({ description: def.description, inputSchema: def.inputSchema as any }),
      ];
    }),
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
    stopWhen: stepCountIs(12),
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
