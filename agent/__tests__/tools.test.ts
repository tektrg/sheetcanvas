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
      brief: {
        logic: 'Trends GA sessions by source for the selected host.',
        scope: ['30daysAgo to today', 'Filtered to theindie.app'],
        sources: ['GA property 123456789'],
        judgmentNotes: ['Only includes traffic returned by the GA report dimensions and host filter.'],
      },
    });

    expect(result.success).toBe(true);
  });

  it('exposes an in-place query sheet update tool for existing connector sheets', () => {
    expect(toolDefs.updateQuerySheet.description).toContain('preserving the sheetId');
    expect(toolDefs.updateQuerySheet.description).toContain('selected/current query sheet');
    expect(toolDefs.updateQuerySheet.description).toContain('lastError');

    const result = toolDefs.updateQuerySheet.inputSchema.safeParse({
      sheetId: 'query-sheet-1',
      queryPayload: { sql: 'SELECT month, count() AS transaction_count FROM sales GROUP BY month' },
      derivation: 'Adds transaction frequency to the existing selected sheet.',
      brief: {
        logic: 'Counts transactions by month from the selected connector query.',
        scope: ['Grouped by month', 'Uses the connector query replacement'],
        sources: ['sales'],
        judgmentNotes: ['Results depend on the query filters and connector table scope.'],
      },
    });

    expect(result.success).toBe(true);
  });

  it('separates private connector queries from visible query sheet emission', () => {
    expect(toolDefs.queryConnection.description).toContain('without creating a visible sheet');
    expect(toolDefs.queryConnection.description).toContain('answer-only analytics');
    expect(toolDefs.queryConnection.description).toContain('createQuerySheetFromResult');
    expect(toolDefs.createQuerySheet.description).toContain('visible sheet');
    expect(toolDefs.createQuerySheetFromResult.description).toContain('visible connector sheet');
    expect(toolDefs.createQuerySheetFromResult.description).toContain('Does not re-query');

    const privateResult = toolDefs.queryConnection.inputSchema.safeParse({
      connectionId: 'clickhouse-1',
      schemaToken: 'schema_abc123',
      type: 'clickhouse',
      queryPayload: { sql: 'SELECT month, count() AS rows FROM sales GROUP BY month' },
      derivation: 'Counts sales rows by month for private analysis.',
      brief: {
        logic: 'Counts sales rows by month.',
        scope: ['Grouped by month'],
        sources: ['sales'],
        judgmentNotes: ['Private result is not visible until explicitly emitted.'],
      },
    });
    expect(privateResult.success).toBe(true);

    const visibleResult = toolDefs.createQuerySheetFromResult.inputSchema.safeParse({
      resultId: 'private-result-1',
      title: 'Monthly sales rows',
    });
    expect(visibleResult.success).toBe(true);
  });

  it('lets applyFormat use first-class presets, custom d3, and derived-sheet guidance', () => {
    expect(toolDefs.applyFormat.description).toContain('derived pivot/sparkline');
    expect(toolDefs.applyFormat.description).toContain('compactNumber');
    expect(toolDefs.applyFormat.description).toContain('visual:"bar"');
    expect(toolDefs.applyFormat.description).toContain('heatmapColor:"diverging"');
    expect(toolDefs.applyFormat.description).toContain('formatDecisions');

    const compactResult = toolDefs.applyFormat.inputSchema.safeParse({
      sheetId: 'pivot-1',
      range: 'B2:B10',
      preset: { preset: 'compactNumber', visual: 'bar' },
      reason: 'primary comparison metric',
    });
    expect(compactResult.success).toBe(true);

    const customResult = toolDefs.applyFormat.inputSchema.safeParse({
      sheetId: 'pivot-1',
      range: 'B2:B10',
      preset: { preset: 'customD3', d3Format: '$.2s' },
    });
    expect(customResult.success).toBe(true);
  });

  it('keeps legacy explicit applyFormat inputs valid and exposes d3Format', () => {
    const result = toolDefs.applyFormat.inputSchema.safeParse({
      sheetId: 'source-1',
      range: 'C2:C20',
      format: { type: 'currency', d3Format: '$.2s', visual: 'bar' },
    });

    expect(result.success).toBe(true);
  });

  it('accepts diverging heatmap with an optional polarity flip', () => {
    const diverging = toolDefs.applyFormat.inputSchema.safeParse({
      sheetId: 'source-1',
      range: 'C2:C20',
      format: { type: 'number', visual: 'heatmap', heatmapColor: 'diverging', heatmapFlip: true },
    });
    expect(diverging.success).toBe(true);

    const viaPreset = toolDefs.applyFormat.inputSchema.safeParse({
      sheetId: 'source-1',
      range: 'C2:C20',
      preset: { preset: 'currency', visual: 'heatmap', heatmapColor: 'diverging' },
    });
    expect(viaPreset.success).toBe(true);
  });

  it('rejects unknown heatmap colors', () => {
    const result = toolDefs.applyFormat.inputSchema.safeParse({
      sheetId: 'source-1',
      range: 'C2:C20',
      format: { type: 'number', visual: 'heatmap', heatmapColor: 'purple' },
    });
    expect(result.success).toBe(false);
  });
});

describe('createSheet tool schema', () => {
  it('accepts a blank sheet with no data', () => {
    expect(toolDefs.createSheet.inputSchema.safeParse({}).success).toBe(true);
    expect(toolDefs.createSheet.inputSchema.safeParse({ title: 'Scratch' }).success).toBe(true);
  });

  it('accepts a pre-filled data grid including formula cells', () => {
    const result = toolDefs.createSheet.inputSchema.safeParse({
      title: 'Regional summary',
      data: [
        ['Region', 'Q1', 'Total'],
        ['West', '100', '=B2*2'],
        ['East', '200', '=B3*2'],
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects oversized sheets at the schema boundary', () => {
    const tooManyRows = { data: Array.from({ length: 5001 }, () => ['x']) };
    expect(toolDefs.createSheet.inputSchema.safeParse(tooManyRows).success).toBe(false);
    const tooWide = { data: [Array.from({ length: 257 }, () => 'x')] };
    expect(toolDefs.createSheet.inputSchema.safeParse(tooWide).success).toBe(false);
  });

  it('self-documents the no-source guardrail and the createQuerySheet alternative for MCP agents', () => {
    expect(toolDefs.createSheet.description).toContain('does NOT auto-refresh');
    expect(toolDefs.createSheet.description).toContain('createQuerySheet');
    expect(toolDefs.createSheet.description).toContain('header row');
  });
});

describe('createNote tool schema', () => {
  it('accepts a minimal markdown note', () => {
    const result = toolDefs.createNote.inputSchema.safeParse({
      content: 'Revenue is up this quarter.',
    });
    expect(result.success).toBe(true);
  });

  it('accepts title and color options', () => {
    const result = toolDefs.createNote.inputSchema.safeParse({
      content: 'Summary body',
      title: 'Q2 Report',
      color: 'blue',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty content and unknown colors', () => {
    expect(toolDefs.createNote.inputSchema.safeParse({ content: '' }).success).toBe(false);
    expect(
      toolDefs.createNote.inputSchema.safeParse({ content: 'x', color: 'teal' }).success
    ).toBe(false);
  });

  it('self-documents the whitelisted live components and the id-sourcing rule for MCP agents', () => {
    // External MCP agents get no system prompt, so the description must be the manual.
    expect(toolDefs.createNote.description).toContain('<CellValue');
    expect(toolDefs.createNote.description).toContain('<CanvasChart');
    expect(toolDefs.createNote.description).toContain('<Sparkline');
    expect(toolDefs.createNote.description).toContain('Never invent ids');
    expect(toolDefs.createNote.description).toContain('listSheets');
  });
});

describe('note read/update/delete tool schemas', () => {
  it('readNote and deleteNote require a noteId', () => {
    expect(toolDefs.readNote.inputSchema.safeParse({ noteId: 'n1' }).success).toBe(true);
    expect(toolDefs.readNote.inputSchema.safeParse({}).success).toBe(false);
    expect(toolDefs.deleteNote.inputSchema.safeParse({ noteId: 'n1' }).success).toBe(true);
    expect(toolDefs.deleteNote.inputSchema.safeParse({ noteId: '' }).success).toBe(false);
  });

  it('listNotes takes no arguments', () => {
    expect(toolDefs.listNotes.inputSchema.safeParse({}).success).toBe(true);
  });

  it('updateNote requires at least one of content or color', () => {
    expect(
      toolDefs.updateNote.inputSchema.safeParse({ noteId: 'n1', content: 'new body' }).success
    ).toBe(true);
    expect(toolDefs.updateNote.inputSchema.safeParse({ noteId: 'n1', color: 'blue' }).success).toBe(
      true
    );
    // noteId alone is not a valid update.
    expect(toolDefs.updateNote.inputSchema.safeParse({ noteId: 'n1' }).success).toBe(false);
    // Unknown color rejected.
    expect(
      toolDefs.updateNote.inputSchema.safeParse({ noteId: 'n1', color: 'teal' }).success
    ).toBe(false);
  });

  it('updateNote self-documents full-content-replace semantics for MCP agents', () => {
    expect(toolDefs.updateNote.description).toContain('REPLACES');
    expect(toolDefs.updateNote.description).toContain('readNote');
    expect(toolDefs.deleteNote.description).toContain('destructive');
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
