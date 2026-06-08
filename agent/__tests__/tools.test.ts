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

describe('aggregation chart workflow guidance', () => {
  it('steers temporary aggregate previews toward persistent pivots before charting', () => {
    expect(toolDefs.querySheet.description).toContain('temporary');
    expect(toolDefs.querySheet.description).toContain('cannot be charted directly');
    expect(toolDefs.querySheet.description).toContain('createPivot');

    expect(toolDefs.createPivot.description).toContain('data-analysis best practice');
    expect(toolDefs.createPivot.description).toContain('chartable aggregation');
    expect(toolDefs.createPivot.description).toContain('call createChart on the pivot');

    expect(toolDefs.createChart.description).toContain('persistent source sheet');
    expect(toolDefs.createChart.description).toContain('prefer creating a persistent aggregation sheet');
  });

  it('documents conditional COUNT metrics as chartable pivot values', () => {
    expect(toolDefs.createPivot.description).toContain('row-count semantics for COUNT');
    expect(toolDefs.createPivot.description).toContain('conditions');

    const result = toolDefs.createPivot.inputSchema.safeParse({
      sheetId: 'hr-base',
      rowLabelCol: 'A',
      values: [
        {
          operation: 'COUNT',
          countRows: true,
          label: 'Trung tuyen',
          conditions: [{ columnId: 'BB', type: 'text', operator: 'equals', value: '[1] Trúng tuyển' }],
        },
        {
          operation: 'COUNT',
          countRows: true,
          label: 'Da hen phong van',
          conditions: [{ columnId: 'AU', type: 'text', operator: 'equals', value: '[1] Đã hẹn phỏng vấn' }],
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
