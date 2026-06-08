import { describe, expect, it } from 'vitest';
import { toolDefs } from '../tools';

describe('createPivot tool schema', () => {
  it('allows COUNT metrics to omit a value column so they default to row counts', () => {
    const result = toolDefs.createPivot.inputSchema.safeParse({
      sheetId: 'demo-1',
      rowLabelCol: 'A',
      values: [{
        operation: 'COUNT',
        label: 'Paid orders',
        conditions: [{ columnId: 'B', type: 'text', operator: 'equals', value: 'paid' }],
      }],
    });

    expect(result.success).toBe(true);
  });
});

describe('sheet inspection tool descriptions', () => {
  it('tell the model that wide column letters are valid column ids', () => {
    expect(toolDefs.listSheets.description).toContain('AU');
    expect(toolDefs.listSheets.description).toContain('BB');
    expect(toolDefs.listSheets.description).toContain('columnIdSpan');
    expect(toolDefs.describeSheet.description).toContain('row-numbering');
    expect(toolDefs.describeSheet.description).toContain('columnIds');
    expect(toolDefs.describeSheet.description).toContain('requestedColumns');
    expect(toolDefs.querySheet.description).toContain('schema.sqlName');
  });

  it('lets describeSheet target user-mentioned column letters directly', () => {
    const result = toolDefs.describeSheet.inputSchema.safeParse({
      sheetId: 'hr-base',
      columnIds: ['BB', 'AU'],
    });

    expect(result.success).toBe(true);
  });
});
