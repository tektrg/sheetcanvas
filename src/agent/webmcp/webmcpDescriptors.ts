import { z } from 'zod';
import { toolDefs, type ToolName } from '../../../agent/tools';
import type { WebMcpAnnotations } from './modelContext';
import { SHORT_TOOL_COPY, TOOL_ANNOTATIONS } from './shortToolCopy';

// Converts the 26 `agent/tools.ts` zod schemas into WebMCP-ready JSON Schema.
// Uses the EXACT same conversion call the backend MCP server already ships
// (`backend/src/mcp/route.ts:33-40`), so the remote-MCP door and this
// in-browser WebMCP door read the same shape and cannot drift apart.

const MAX_NESTED_DESCRIPTION_LENGTH = 150;

function truncateAtWordBoundary(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(' ');
  // No space to break on (a single long token) — cut it as-is rather than
  // returning an empty string.
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}

/**
 * Recursively mutates a JSON Schema node in place:
 *  - strips `$schema` (zod emits it at the root; it can also reappear in `$defs`)
 *  - truncates any `description` longer than 150 chars at a word boundary
 *  - sets `additionalProperties: false` — but ONLY on nodes that already have
 *    a `properties` key and no `additionalProperties` of their own.
 *
 * ⚠️ That last predicate is load-bearing. `z.record(...)` emits
 * `{ type: 'object', propertyNames: {...}, additionalProperties: {...} }`
 * with NO `properties` key. Five such nodes exist in `toolDefs`:
 * `setCells.cells` (agent/tools.ts:221-224), `createChart.seriesTypes`
 * (:307), `createSparkline.goodDirections` (:374), and the `queryPayload`
 * record on `createQuerySheet`/`queryConnection`/`updateQuerySheet`
 * (:495,:511,:534). Blanket-setting `additionalProperties: false` on those
 * would make `setCells` and every connector query structurally impossible to
 * call — the predicate below leaves their existing (already-correct)
 * `additionalProperties` schema untouched.
 *
 * We deliberately do NOT inline `$defs`/`$ref` here. `CellFormatSchema`
 * (agent/tools.ts:31) and the filter condition schemas (:97,:112,:127) are
 * `z.discriminatedUnion`s that compile to `anyOf` + `$defs`; agents handle
 * refs fine, and inlining risks recursion for no benefit.
 */
function walkJsonSchemaNode(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(walkJsonSchemaNode);
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const obj = node as Record<string, unknown>;
  delete obj.$schema;

  if ('properties' in obj && !('additionalProperties' in obj)) {
    obj.additionalProperties = false;
  }

  if (typeof obj.description === 'string' && obj.description.length > MAX_NESTED_DESCRIPTION_LENGTH) {
    obj.description = truncateAtWordBoundary(obj.description, MAX_NESTED_DESCRIPTION_LENGTH);
  }

  for (const value of Object.values(obj)) {
    walkJsonSchemaNode(value);
  }
}

/** Applies `SHORT_TOOL_COPY[name].params` overrides to top-level input properties. */
function applyTopLevelParamOverrides(schema: Record<string, unknown>, name: ToolName): void {
  const overrides = SHORT_TOOL_COPY[name].params;
  const properties = schema.properties;
  if (!overrides || !properties || typeof properties !== 'object') return;

  for (const [propertyName, overrideText] of Object.entries(overrides)) {
    const propertySchema = (properties as Record<string, unknown>)[propertyName];
    if (propertySchema && typeof propertySchema === 'object') {
      (propertySchema as Record<string, unknown>).description = overrideText;
    }
  }
}

const inputSchemaCache = new Map<ToolName, Record<string, unknown>>();

export function buildInputSchema(name: ToolName): Record<string, unknown> {
  const cached = inputSchemaCache.get(name);
  if (cached) return cached;

  // Same conversion call as backend/src/mcp/route.ts:33-40 — the three
  // .refine()-wrapped schemas (applyFormat, createSparkline, updateNote) are
  // still ZodObject in zod v4 (refine clones and appends a check), so this
  // does not throw for any of the 26 tools; the backend already converts all
  // 26 at module load in production.
  const schema = z.toJSONSchema(toolDefs[name].inputSchema, {
    io: 'input',
    unrepresentable: 'any',
  }) as Record<string, unknown>;

  // Overrides go in before the generic truncation pass so an explicit
  // SHORT_TOOL_COPY override always wins over word-boundary truncation of
  // the original (verbose, Gemini-tuned) zod .describe() text.
  applyTopLevelParamOverrides(schema, name);
  walkJsonSchemaNode(schema);

  inputSchemaCache.set(name, schema);
  return schema;
}

export interface DescriptorMeta {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: WebMcpAnnotations;
}

export function buildDescriptorMeta(name: ToolName): DescriptorMeta {
  const copy = SHORT_TOOL_COPY[name];
  return {
    name: copy.name ?? name,
    title: copy.title,
    description: copy.description,
    inputSchema: buildInputSchema(name),
    annotations: TOOL_ANNOTATIONS[name],
  };
}
