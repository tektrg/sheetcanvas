import { describe, expect, it } from 'vitest';
import { TOOL_NAMES, type ToolName } from '../../../agent/tools';
import { SHORT_TOOL_COPY, TOOL_ANNOTATIONS } from '../webmcp/shortToolCopy';
import { buildDescriptorMeta, buildInputSchema } from '../webmcp/webmcpDescriptors';

const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,30}$/;
const MAX_TOOL_DESCRIPTION_LENGTH = 500;
const MAX_TITLE_LENGTH = 64;
const MAX_PARAM_DESCRIPTION_LENGTH = 150;

const READ_ONLY_TOOL_NAMES: ToolName[] = [
  'listSheets',
  'describeSheet',
  'getSelection',
  'getRange',
  'querySheet',
  'listNotes',
  'readNote',
  'listConnections',
  'listConnectionProperties',
];

// z.record(...) nodes: {type:'object', propertyNames, additionalProperties}
// with NO 'properties' key. additionalProperties:false must never land here.
const RECORD_NODE_PATHS: Array<{ tool: ToolName; property: string }> = [
  { tool: 'setCells', property: 'cells' },
  { tool: 'createChart', property: 'seriesTypes' },
  { tool: 'createSparkline', property: 'goodDirections' },
  { tool: 'createQuerySheet', property: 'queryPayload' },
  { tool: 'queryConnection', property: 'queryPayload' },
  { tool: 'updateQuerySheet', property: 'queryPayload' },
];

function collectDescriptions(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((item) => collectDescriptions(item, out));
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  if (typeof obj.description === 'string') out.push(obj.description);
  for (const value of Object.values(obj)) collectDescriptions(value, out);
  return out;
}

function collectKeys(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    node.forEach((item) => collectKeys(item, key, out));
    return out;
  }
  if (node === null || typeof node !== 'object') return out;
  const obj = node as Record<string, unknown>;
  if (key in obj) out.push(obj[key]);
  for (const value of Object.values(obj)) collectKeys(value, key, out);
  return out;
}

describe('SHORT_TOOL_COPY', () => {
  it('covers every tool name in TOOL_NAMES exactly once', () => {
    expect(Object.keys(SHORT_TOOL_COPY).sort()).toEqual([...TOOL_NAMES].sort());
  });

  it.each(TOOL_NAMES)('keeps %s description within the 500-char OpenAI budget', (name) => {
    expect(SHORT_TOOL_COPY[name].description.length).toBeLessThanOrEqual(MAX_TOOL_DESCRIPTION_LENGTH);
  });

  it.each(TOOL_NAMES)('keeps %s title within the 64-char budget', (name) => {
    expect(SHORT_TOOL_COPY[name].title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
  });

  it.each(TOOL_NAMES)('keeps every param override for %s within the 150-char budget', (name) => {
    const params = SHORT_TOOL_COPY[name].params ?? {};
    for (const [key, value] of Object.entries(params)) {
      expect(value.length, `${name}.params.${key}`).toBeLessThanOrEqual(MAX_PARAM_DESCRIPTION_LENGTH);
    }
  });

  it.each(TOOL_NAMES)('gives %s an effective tool name matching the WebMCP name pattern', (name) => {
    const effectiveName = SHORT_TOOL_COPY[name].name ?? name;
    expect(effectiveName).toMatch(TOOL_NAME_PATTERN);
  });
});

describe('buildInputSchema', () => {
  it.each(TOOL_NAMES)('converts %s without throwing', (name) => {
    expect(() => buildInputSchema(name)).not.toThrow();
  });

  it.each(TOOL_NAMES)('strips $schema everywhere in %s', (name) => {
    const schema = buildInputSchema(name);
    expect(collectKeys(schema, '$schema')).toEqual([]);
  });

  it.each(TOOL_NAMES)('keeps every nested description in %s within 150 chars', (name) => {
    const schema = buildInputSchema(name);
    for (const description of collectDescriptions(schema)) {
      expect(description.length).toBeLessThanOrEqual(MAX_PARAM_DESCRIPTION_LENGTH);
    }
  });

  it.each(RECORD_NODE_PATHS)(
    'leaves the z.record node $tool.$property without additionalProperties:false',
    ({ tool, property }) => {
      const schema = buildInputSchema(tool);
      const properties = schema.properties as Record<string, unknown>;
      const recordNode = properties[property] as Record<string, unknown>;
      expect(recordNode).toBeDefined();
      expect(recordNode.properties).toBeUndefined();
      expect(recordNode.additionalProperties).not.toBe(false);
    },
  );

  it("still permits arbitrary keys under setCells's cells map", () => {
    const schema = buildInputSchema('setCells');
    const properties = schema.properties as Record<string, unknown>;
    const cellsNode = properties.cells as Record<string, unknown>;
    // A z.record(...) node: no whitelist of specific keys, and
    // additionalProperties describes the value schema rather than being
    // `false` (which would forbid every key).
    expect(cellsNode.properties).toBeUndefined();
    expect(cellsNode.additionalProperties).toBeTruthy();
  });

  it('sets additionalProperties:false on ordinary object nodes with a properties key', () => {
    // getRange has no z.record fields, so its top-level schema should be
    // locked down against extra properties.
    const schema = buildInputSchema('getRange');
    expect(schema.properties).toBeDefined();
    expect(schema.additionalProperties).toBe(false);
  });
});

describe('buildDescriptorMeta', () => {
  it.each(TOOL_NAMES)('builds a complete descriptor for %s', (name) => {
    const meta = buildDescriptorMeta(name);
    expect(meta.name).toMatch(TOOL_NAME_PATTERN);
    expect(meta.title.length).toBeLessThanOrEqual(MAX_TITLE_LENGTH);
    expect(meta.description.length).toBeLessThanOrEqual(MAX_TOOL_DESCRIPTION_LENGTH);
    expect(meta.inputSchema).toBeDefined();
  });
});

describe('TOOL_ANNOTATIONS readOnlyHint', () => {
  it('is set on exactly the 9 tools with no observable canvas side effect', () => {
    const actualReadOnly = TOOL_NAMES.filter((name) => TOOL_ANNOTATIONS[name].readOnlyHint === true);
    expect(actualReadOnly.sort()).toEqual([...READ_ONLY_TOOL_NAMES].sort());
  });

  it('is NOT set on describeConnection or queryConnection despite them looking read-only', () => {
    // describeConnection mutates connectionSchemaTokens/gaMetadata; queryConnection
    // mutates privateQueryResults. See the comment in shortToolCopy.ts.
    expect(TOOL_ANNOTATIONS.describeConnection.readOnlyHint).not.toBe(true);
    expect(TOOL_ANNOTATIONS.queryConnection.readOnlyHint).not.toBe(true);
  });
});

describe('TOOL_ANNOTATIONS untrustedContentHint', () => {
  const UNTRUSTED_TOOL_NAMES: ToolName[] = [
    ...READ_ONLY_TOOL_NAMES,
    'describeConnection',
    'queryConnection',
    'createQuerySheet',
    'createQuerySheetFromResult',
    'updateQuerySheet',
    'createGaTrendBySource',
  ];

  it('is set on exactly the 15 tools whose results can carry third-party or user-authored text', () => {
    const actualUntrusted = TOOL_NAMES.filter((name) => TOOL_ANNOTATIONS[name].untrustedContentHint === true);
    expect(actualUntrusted.sort()).toEqual([...UNTRUSTED_TOOL_NAMES].sort());
  });

  it('never sets destructiveHint (not part of the WebMCP annotation spec)', () => {
    for (const name of TOOL_NAMES) {
      expect((TOOL_ANNOTATIONS[name] as Record<string, unknown>).destructiveHint).toBeUndefined();
    }
  });
});
