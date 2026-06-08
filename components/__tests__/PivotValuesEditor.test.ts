import { describe, expect, it } from 'vitest';
import { getPivotValuesValidationError } from '../PivotValuesEditor';

describe('getPivotValuesValidationError', () => {
  it('rejects empty scalar condition values', () => {
    expect(getPivotValuesValidationError([
      {
        column: 'C',
        operation: 'SUM',
        conditions: [{ columnId: 'B', type: 'text', operator: 'equals', value: '' }],
      },
    ])).toBe('Enter a condition value.');
  });

  it('rejects incomplete range condition values', () => {
    expect(getPivotValuesValidationError([
      {
        operation: 'COUNT',
        countRows: true,
        conditions: [{ columnId: 'C', type: 'number', operator: 'range', value: ['10', ''] }],
      },
    ])).toBe('Enter both range values.');
  });

  it('allows row-count conditional metrics with complete criteria', () => {
    expect(getPivotValuesValidationError([
      {
        operation: 'COUNT',
        countRows: true,
        conditions: [{ columnId: 'B', type: 'text', operator: 'equals', value: 'paid' }],
      },
    ])).toBeNull();
  });
});
