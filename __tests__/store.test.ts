import { describe, expect, it } from 'vitest';
import { hasPersistedWorkspaceState } from '../store';

describe('hasPersistedWorkspaceState', () => {
  it('treats private query results as saved workspace state even without visible sheets', () => {
    expect(
      hasPersistedWorkspaceState({
        sheets: [],
        charts: [],
        notes: [],
        privateQueryResults: [{ id: 'private-result-1' }],
      }),
    ).toBe(true);
  });

  it('returns false when no visible or private workspace data exists', () => {
    expect(
      hasPersistedWorkspaceState({
        sheets: [],
        charts: [],
        notes: [],
        privateQueryResults: [],
      }),
    ).toBe(false);
  });
});
