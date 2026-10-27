import { describe, expect, it } from 'vitest';
import { agentTools } from '@tektrg/diagram-kit';
import { TOOL_NAMES } from '../../../agent/tools';
import { TOOL_ANNOTATIONS } from '../../../agent/toolAnnotations';
import { isPublicCanvasTool } from '../../../agent/publicToolPolicy';
import { executeClientTool } from '../clientToolExecutor';
import { DIAGRAM_KIT_TOOL_NAMES } from '../diagramKitTools';
import { computeDesiredTools, readGatingState } from '../webmcp/webmcpToolGating';

const resolver = { getSelection: () => ({ sheetId: null, cellId: null, range: null }) };

describe('diagram-kit agent tools', () => {
  it('registers every kit tool as a read-only canvas tool', () => {
    expect(agentTools.map((t) => t.name).sort()).toEqual([...DIAGRAM_KIT_TOOL_NAMES].sort());
    for (const name of DIAGRAM_KIT_TOOL_NAMES) {
      expect(TOOL_NAMES).toContain(name);
      expect(TOOL_ANNOTATIONS[name].readOnlyHint).toBe(true);
      expect(isPublicCanvasTool(name)).toBe(true);
    }
  });

  it('is offered over WebMCP on an empty canvas (not behind the diagrams flag)', () => {
    const desired = computeDesiredTools(readGatingState({ sheetIds: [], noteIds: [], diagramIds: [], privateQueryResultIds: [], connectionSchemaTokens: {}, sheets: {} } as any));
    for (const name of DIAGRAM_KIT_TOOL_NAMES) expect(desired.has(name)).toBe(true);
  });

  it('validateDiagram returns valid/hinted errors via the executor', async () => {
    expect(await executeClientTool('validateDiagram', { source: 'flowchart LR\n  A --> B' }, resolver)).toMatchObject({ ok: true, valid: true });
    const bad = await executeClientTool('validateDiagram', { source: 'flowchart LR\n  A -->' }, resolver);
    expect(bad).toMatchObject({ ok: true, valid: false });
    expect((bad as any).errors.length).toBeGreaterThan(0);
  });

  it('listDiagramTypes returns the supported types', async () => {
    const res = (await executeClientTool('listDiagramTypes', {}, resolver)) as any;
    expect(res.ok).toBe(true);
    expect(res.types.length).toBeGreaterThan(10);
  });
});
