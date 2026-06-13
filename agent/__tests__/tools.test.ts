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
    expect(toolDefs.querySheet.description).toContain('hostname');
    expect(toolDefs.listConnections.description).toContain('health');
    expect(toolDefs.listConnections.description).toContain('property hints');
  });

  it('lets describeSheet target user-mentioned column letters directly', () => {
    const result = toolDefs.describeSheet.inputSchema.safeParse({
      sheetId: 'hr-base',
      columnIds: ['BB', 'AU'],
    });

    expect(result.success).toBe(true);
  });

  it('supports a high-level GA trend-by-source workflow', () => {
    expect(toolDefs.createGaTrendBySource.description).toContain('daily trend-by-source');
    expect(toolDefs.createGaTrendBySource.description).toContain('diagnostics');

    const result = toolDefs.createGaTrendBySource.inputSchema.safeParse({
      connectionId: 'ga-conn-1',
      schemaToken: 'schema_abc123',
      propertyId: '123456789',
      startDate: '30daysAgo',
      endDate: 'today',
      hostName: 'theindie.app',
      metric: 'sessions',
    });

    expect(result.success).toBe(true);
  });
});

describe('aggregation chart workflow guidance', () => {
  it('documents chart-only aggregation for simple visuals and pivots for inspectable trails', () => {
    expect(toolDefs.querySheet.description).toContain('temporary');
    expect(toolDefs.querySheet.description).toContain('cannot be charted directly');
    expect(toolDefs.querySheet.description).toContain('createPivot');

    expect(toolDefs.createPivot.description).toContain('data-analysis best practice');
    expect(toolDefs.createPivot.description).toContain('chartable aggregation');
    expect(toolDefs.createPivot.description).toContain('call createChart on the pivot');

    expect(toolDefs.createChart.description).toContain('persistent source sheet');
    expect(toolDefs.createChart.description).toContain('cleanest visual answer');
    expect(toolDefs.createChart.description).toContain('mode:"group"');
    expect(toolDefs.createChart.description).toContain('inspectable analytical trail');
    expect(toolDefs.createChart.description).toContain('timeRange');
    expect(toolDefs.createChart.description).toContain('timeGranularity');
    expect(toolDefs.createChart.description).toContain('Duplicate labels');
  });

  it('accepts explicit data-analysis intent for chart creation', () => {
    const result = toolDefs.createChart.inputSchema.safeParse({
      sheetId: 'daily-summary',
      type: 'line',
      labelColumn: 'A',
      dataColumns: ['B'],
      timeRange: 'full available range',
      timeGranularity: 'day',
      aggregation: 'SUM',
      sourceGrain: 'pivot_summary',
      analysisNotes: 'Daily total revenue chart from a pivot summary.',
    });

    expect(result.success).toBe(true);
  });

  it('accepts chart-only group aggregation intent', () => {
    const result = toolDefs.createChart.inputSchema.safeParse({
      sheetId: 'ga-daily-source',
      type: 'line',
      mode: 'group',
      labelColumn: 'A',
      dataColumns: ['E'],
      groupCol: 'A',
      seriesGroupCol: 'C',
      valueCol: 'E',
      operation: 'SUM',
      sourceGrain: 'raw_rows',
      analysisNotes: 'Simple daily sessions by source can be aggregated directly in the chart.',
    });

    expect(result.success).toBe(true);
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
