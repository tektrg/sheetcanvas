import { afterEach, describe, expect, it } from 'vitest';
import type { SheetData } from '../../../types';
import { useStore } from '../../../store';
import { summarize } from '../trailSummaries';

// Regression coverage for: four summarizers (describeSheet, getRange,
// describeConnection, listConnectionProperties) used to build their summary
// string without checking `isOk(result)` first, unlike every other
// summarizer in trailSummaries.ts. A failed getRange/describeConnection call
// (reachable via clientToolExecutor.ts's "Unknown sheetId" / "Invalid range"
// / "Connection not found" error paths) would then render a success-looking
// headline — e.g. "Read range Z99:Z100 from a sheet" — directly above the
// accurate error text, which reads as sloppy on a recorded demo even though
// the row still gets the correct error icon/colour.

function makeSheet(id: string, title: string): SheetData {
  return {
    id,
    title,
    position: { x: 0, y: 0 },
    size: { width: 4, height: 4 },
    cells: {},
  };
}

const initialAppState = useStore.getState();

afterEach(() => {
  useStore.setState({
    sheets: initialAppState.sheets,
    sheetIds: initialAppState.sheetIds,
  });
});

describe('trailSummaries: getRange branches on isOk', () => {
  it('renders a failure headline (not "Read range ...") when getRange fails', () => {
    const message = summarize(
      'getRange',
      { sheetId: 'missing-sheet', range: 'Z99:Z100' },
      { ok: false, error: 'Unknown sheetId: missing-sheet' },
    );
    expect(message).not.toMatch(/^Read range/);
    expect(message).toContain('Failed to read range');
    expect(message).toContain('Z99:Z100');
  });

  it('still renders "Read range ..." on success', () => {
    useStore.setState({ sheets: { s1: makeSheet('s1', 'Sales') }, sheetIds: ['s1'] });
    const message = summarize(
      'getRange',
      { sheetId: 's1', range: 'A1:B2' },
      { ok: true, sheetId: 's1', range: 'A1:B2', cells: {} },
    );
    expect(message).toBe('Read range A1:B2 from Sales');
  });
});

describe('trailSummaries: describeConnection branches on isOk', () => {
  it('renders a failure headline (not "Inspected connection ...") when the connection is not found', () => {
    const message = summarize(
      'describeConnection',
      { connectionId: 'conn-x' },
      { ok: false, error: 'Connection not found: conn-x' },
    );
    expect(message).not.toMatch(/^Inspected connection/);
    expect(message).toContain('Failed to inspect connection');
    expect(message).toContain('conn-x');
  });

  it('still renders "Inspected connection ..." on success', () => {
    const message = summarize(
      'describeConnection',
      { connectionId: 'conn-x' },
      { ok: true, connectionId: 'conn-x', type: 'clickhouse' },
    );
    expect(message).toBe('Inspected connection conn-x');
  });
});

describe('trailSummaries: describeSheet branches on isOk', () => {
  it('renders a failure headline when describeSheet fails', () => {
    const message = summarize(
      'describeSheet',
      { sheetId: 'missing-sheet' },
      { ok: false, error: 'Unknown sheetId: missing-sheet' },
    );
    expect(message).not.toMatch(/^Inspected/);
    expect(message).toContain('Failed to inspect');
  });

  it('still renders "Inspected ..." on success', () => {
    useStore.setState({ sheets: { s1: makeSheet('s1', 'Sales') }, sheetIds: ['s1'] });
    const message = summarize('describeSheet', { sheetId: 's1' }, { ok: true, sheetId: 's1' });
    expect(message).toBe('Inspected Sales');
  });
});

describe('trailSummaries: listConnectionProperties branches on isOk', () => {
  it('renders a failure headline when listConnectionProperties fails', () => {
    const message = summarize(
      'listConnectionProperties',
      { connectionId: 'conn-x' },
      { ok: false, error: 'Connection not found: conn-x' },
    );
    expect(message).not.toBe('Listed connection properties');
    expect(message).toContain('Failed to list connection properties');
  });

  it('still renders "Listed connection properties" on success', () => {
    const message = summarize(
      'listConnectionProperties',
      { connectionId: 'conn-x' },
      { ok: true, connectionId: 'conn-x', type: 'google-analytics', properties: [], nextPageToken: null, truncated: false },
    );
    expect(message).toBe('Listed connection properties');
  });
});
