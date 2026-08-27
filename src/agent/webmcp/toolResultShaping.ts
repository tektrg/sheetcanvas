// Result-shaping layer for the WebMCP door only (ChatGPT calling SheetCanvas's
// canvas tools). OpenAI truncates tool output at roughly 1.5K characters, and
// several tools (describeSheet on a wide sheet, getRange over a large A1
// span, querySheet's row limit, GA metadata catalogs) blow far past that
// unshaped — a silent mid-JSON cut breaks the agent in confusing ways.
//
// This module compresses each tool's success/error payload to fit under
// WEBMCP_OUTPUT_BUDGET while keeping the fields the agent actually needs to
// act or to page for more. It is pure (no store, no React, no side effects)
// so it is safe to import from a thin WebMCP wrapper without touching
// `executeClientTool` or degrading the remote MCP door (Claude Code), which
// keeps its full, unshaped results.
//
// Import boundary: only `import type` from clientToolExecutor — that's
// erased at compile time, so this module never actually executes the
// store-importing module it borrows the ToolResult type from. The per-tool
// shaping knowledge lives in shapingShapers.ts (Layer 1); this file adds the
// deterministic generic backstop (Layer 2) and the public entry points.
import type { ToolResult } from '../clientToolExecutor';
import type { ToolName } from '../../../agent/tools';
import { capMessage, ERROR_MESSAGE_MAX_CHARS, jsonLength, omittedNote, WEBMCP_OUTPUT_BUDGET } from './shapingHelpers';
import { SHAPERS } from './shapingShapers';

export { WEBMCP_OUTPUT_BUDGET };

// ── Layer 2: generic backstop ────────────────────────────────────────────
// Deterministic drop → clip → collapse sequence that runs after every
// shaper (including tools with no Layer 1 shaper). Guarantees the result
// fits WEBMCP_OUTPUT_BUDGET no matter how large or malformed the input is.

// Bulk-field drop order, lowest-value-first, spanning every shaper's output
// field names. A field not present in a given result is simply skipped.
const BACKSTOP_DROP_ORDER = [
  'sampleRows',
  'rows',
  'cells',
  'tables',
  'columns',
  'columnsCompact',
  'headerLine',
  'sheets',
  'notes',
  'properties',
  'dimensions',
  'metrics',
  'formatDecisions',
  'firedRules',
  'requestedColumns',
  'connections',
  'guidance',
  'schema',
  'filters',
  'sort',
  'queryShape',
];

function finalizeBackstop(current: Record<string, unknown>, actions: string[]): Record<string, unknown> {
  if (actions.length === 0) return current;
  const priorOmitted = typeof current._omitted === 'string' ? current._omitted : '';
  return {
    ...current,
    _truncated: true,
    _omitted: omittedNote([priorOmitted, `backstop:${actions.join(',')}`]),
  };
}

function applyBackstop(shaped: Record<string, unknown>): Record<string, unknown> {
  if (jsonLength(shaped) <= WEBMCP_OUTPUT_BUDGET) return shaped;

  // Step 1: drop bulk fields in priority order until under budget.
  let current = shaped;
  const dropped: string[] = [];
  for (const field of BACKSTOP_DROP_ORDER) {
    if (jsonLength(current) <= WEBMCP_OUTPUT_BUDGET) break;
    if (!(field in current)) continue;
    const { [field]: _omit, ...next } = current;
    current = next;
    dropped.push(field);
  }
  if (jsonLength(current) <= WEBMCP_OUTPUT_BUDGET) return finalizeBackstop(current, dropped);

  // Step 2: clip remaining string-valued fields.
  const clipped: string[] = [];
  for (const [key, value] of Object.entries(current)) {
    if (jsonLength(current) <= WEBMCP_OUTPUT_BUDGET) break;
    if (typeof value !== 'string' || value.length <= 100) continue;
    current = { ...current, [key]: value.slice(0, 100) };
    clipped.push(key);
  }
  if (jsonLength(current) <= WEBMCP_OUTPUT_BUDGET) return finalizeBackstop(current, [...dropped, ...clipped]);

  // Step 3: collapse to identity fields only (`ok` plus any `*Id` field),
  // each capped short so even a pathological id value can't blow the budget.
  const identity: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(current)) {
    if (key !== 'ok' && !/Id$/.test(key)) continue;
    identity[key] = typeof value === 'string' ? value.slice(0, 200) : value;
  }
  identity._truncated = true;
  identity._omitted = omittedNote(['result too large; reduced to identity fields']);
  if (jsonLength(identity) <= WEBMCP_OUTPUT_BUDGET) return identity;

  // Last-resort guard: even the identity collapse didn't fit (e.g. many huge
  // *Id fields). Always return something under budget.
  return { ok: identity.ok ?? true, _truncated: true, _omitted: 'result too large' };
}

// ── Public API ────────────────────────────────────────────────────────────

/** Shape a successful tool result for the WebMCP door. Pure: never mutates
 * `result`. Always returns an object whose JSON.stringify length is
 * <= WEBMCP_OUTPUT_BUDGET. */
export function shapeSuccess(name: string, result: Record<string, unknown>): Record<string, unknown> {
  const shaper = SHAPERS[name as ToolName]?.success;
  const shaped = shaper ? shaper(result, WEBMCP_OUTPUT_BUDGET) : { ...result };
  return applyBackstop(shaped);
}

function genericErrorMessage(result: Record<string, unknown>): string {
  return String(result.error ?? 'Tool call failed');
}

/** Build the rejection-reason string for a failed WebMCP tool call. WebMCP
 * carries only a string reason (no structured fields), so any diagnostics
 * that are normally separate fields (schema, sqlGuidance, queryDiagnostics,
 * guidance) get folded into this one message, capped at ~600 chars. */
export function buildErrorMessage(name: string, result: Record<string, unknown>): string {
  const shaper = SHAPERS[name as ToolName]?.error;
  const message = shaper ? shaper(result) : genericErrorMessage(result);
  return capMessage(message, ERROR_MESSAGE_MAX_CHARS);
}

// Re-exported only so downstream WebMCP wrapper code can share the exact
// success/failure discriminant this module was written against.
export type { ToolResult };
