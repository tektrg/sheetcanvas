import React, { useMemo } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import {
  FilterOperator,
  FilterType,
  PivotCondition,
  PivotOperation,
  PivotValue,
  SheetData
} from '../types';
import { getSheetHeaders } from '../utils/chartHelpers';
import { inferColumnType } from '../utils/dataAnalysis';

interface PivotValuesEditorProps {
  sourceSheet: SheetData;
  values: PivotValue[];
  onChange: (values: PivotValue[]) => void;
}

const ROW_COUNT_VALUE = '__rows';

const getDefaultOperator = (type: FilterType): FilterOperator => {
  if (type === 'number') return 'gt';
  if (type === 'date') return 'on';
  return 'contains';
};

const getOperatorOptions = (type: FilterType): Array<{ value: FilterOperator; label: string }> => {
  if (type === 'number') {
    return [
      { value: 'gt', label: 'greater than' },
      { value: 'lt', label: 'less than' },
      { value: 'eq', label: 'equals' },
      { value: 'neq', label: 'not equals' },
      { value: 'range', label: 'range' }
    ];
  }

  if (type === 'date') {
    return [
      { value: 'on', label: 'on' },
      { value: 'before', label: 'before' },
      { value: 'after', label: 'after' },
      { value: 'range', label: 'range' }
    ];
  }

  return [
    { value: 'contains', label: 'contains' },
    { value: 'equals', label: 'equals' },
    { value: 'startsWith', label: 'starts with' },
    { value: 'endsWith', label: 'ends with' }
  ];
};

const generateConditionId = () => Math.random().toString(36).slice(2, 11);

const getRangeValue = (condition: PivotCondition, index: number) =>
  Array.isArray(condition.value) ? condition.value[index] ?? '' : '';

const isBlank = (value: any) => value === null || value === undefined || String(value).trim() === '';

export const getPivotConditionValidationError = (condition: PivotCondition) => {
  if (condition.operator === 'range') {
    const start = getRangeValue(condition, 0);
    const end = getRangeValue(condition, 1);
    if (isBlank(start) || isBlank(end)) return 'Enter both range values.';
    return null;
  }

  if (Array.isArray(condition.value)) {
    if (isBlank(condition.value[0])) return 'Enter a condition value.';
    return null;
  }

  if (isBlank(condition.value)) return 'Enter a condition value.';
  return null;
};

export const getPivotValueValidationError = (value: PivotValue) => {
  if (!(value.operation === 'COUNT' && value.countRows) && !value.column) {
    return 'Choose a value column.';
  }

  for (const condition of value.conditions ?? []) {
    const conditionError = getPivotConditionValidationError(condition);
    if (conditionError) return conditionError;
  }

  return null;
};

export const getPivotValuesValidationError = (values: PivotValue[]) => {
  if (values.length === 0) return 'Add at least one metric.';

  for (const value of values) {
    const valueError = getPivotValueValidationError(value);
    if (valueError) return valueError;
  }

  return null;
};

export const PivotValuesEditor: React.FC<PivotValuesEditorProps> = ({
  sourceSheet,
  values,
  onChange
}) => {
  const headers = useMemo(() => getSheetHeaders(sourceSheet), [sourceSheet]);
  const defaultValueColumn = headers.length > 1 ? headers[1].id : headers[0]?.id ?? 'A';
  const defaultConditionColumn = headers[0]?.id ?? 'A';

  const updateValue = (index: number, updates: Partial<PivotValue>) => {
    onChange(values.map((value, valueIndex) => (
      valueIndex === index ? { ...value, ...updates } : value
    )));
  };

  const addValue = () => {
    onChange([...values, { column: defaultValueColumn, operation: 'SUM' }]);
  };

  const removeValue = (index: number) => {
    onChange(values.filter((_, valueIndex) => valueIndex !== index));
  };

  const updateOperation = (index: number, operation: PivotOperation) => {
    const value = values[index];
    if (operation === 'COUNT') {
      updateValue(index, { ...value, operation, countRows: true, column: undefined });
      return;
    }

    updateValue(index, {
      ...value,
      operation,
      countRows: false,
      column: value.column ?? defaultValueColumn
    });
  };

  const updateValueColumn = (index: number, column: string) => {
    if (column === ROW_COUNT_VALUE) {
      updateValue(index, { countRows: true, column: undefined });
      return;
    }

    updateValue(index, { countRows: false, column });
  };

  const addCondition = (valueIndex: number) => {
    const type = inferColumnType(sourceSheet, defaultConditionColumn);
    const condition: PivotCondition = {
      id: generateConditionId(),
      columnId: defaultConditionColumn,
      type,
      operator: getDefaultOperator(type),
      value: ''
    };
    const value = values[valueIndex];
    updateValue(valueIndex, { conditions: [...(value.conditions ?? []), condition] });
  };

  const updateCondition = (
    valueIndex: number,
    conditionIndex: number,
    updates: Partial<PivotCondition>
  ) => {
    const value = values[valueIndex];
    const nextConditions = (value.conditions ?? []).map((condition, index) => (
      index === conditionIndex ? { ...condition, ...updates } : condition
    ));
    updateValue(valueIndex, { conditions: nextConditions });
  };

  const removeCondition = (valueIndex: number, conditionIndex: number) => {
    const value = values[valueIndex];
    updateValue(valueIndex, {
      conditions: (value.conditions ?? []).filter((_, index) => index !== conditionIndex)
    });
  };

  const updateConditionColumn = (valueIndex: number, conditionIndex: number, columnId: string) => {
    const type = inferColumnType(sourceSheet, columnId);
    updateCondition(valueIndex, conditionIndex, {
      columnId,
      type,
      operator: getDefaultOperator(type),
      value: ''
    });
  };

  const updateConditionOperator = (
    valueIndex: number,
    conditionIndex: number,
    operator: FilterOperator
  ) => {
    updateCondition(valueIndex, conditionIndex, {
      operator,
      value: operator === 'range' ? ['', ''] : ''
    });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">
          Values
        </label>
        <button
          type="button"
          onClick={addValue}
          className="flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 bg-teal-50 dark:bg-teal-900/20 px-2 py-1 rounded transition-colors"
        >
          <Plus size={10} /> Add Metric
        </button>
      </div>

      <div className="space-y-3">
        {values.map((value, valueIndex) => (
          <div
            key={valueIndex}
            className="rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900/40 p-3 space-y-3"
          >
            <div className="flex items-start gap-2">
              <input
                value={value.label ?? ''}
                onChange={(event) => updateValue(valueIndex, { label: event.target.value })}
                placeholder="Metric label, e.g. Won revenue"
                className="min-w-0 flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-teal-500/50"
              />
              {values.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeValue(valueIndex)}
                  className="p-2 text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors flex-shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <select
                value={value.operation}
                onChange={(event) => updateOperation(valueIndex, event.target.value as PivotOperation)}
                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-teal-500/50"
              >
                <option value="SUM">SUM</option>
                <option value="COUNT">COUNT</option>
                <option value="AVG">AVG</option>
                <option value="MIN">MIN</option>
                <option value="MAX">MAX</option>
              </select>

              <select
                value={value.operation === 'COUNT' && (value.countRows || !value.column) ? ROW_COUNT_VALUE : value.column ?? defaultValueColumn}
                onChange={(event) => updateValueColumn(valueIndex, event.target.value)}
                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-2 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-teal-500/50"
              >
                {value.operation === 'COUNT' && <option value={ROW_COUNT_VALUE}>Count rows</option>}
                {headers.map(header => (
                  <option key={header.id} value={header.id}>{header.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide text-neutral-400">
                  Where
                </span>
                <button
                  type="button"
                  onClick={() => addCondition(valueIndex)}
                  className="text-[10px] font-medium text-neutral-500 hover:text-teal-600 dark:hover:text-teal-400"
                >
                  Add condition
                </button>
              </div>

              {(value.conditions ?? []).length === 0 && (
                <p className="text-[11px] text-neutral-400">
                  No conditions. This metric uses every visible source row.
                </p>
              )}

              {(value.conditions ?? []).map((condition, conditionIndex) => {
                const conditionError = getPivotConditionValidationError(condition);
                return (
                  <div key={condition.id ?? conditionIndex} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <select
                        value={condition.columnId}
                        onChange={(event) => updateConditionColumn(valueIndex, conditionIndex, event.target.value)}
                        className="h-7 max-w-[120px] text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                      >
                        {headers.map(header => (
                          <option key={header.id} value={header.id}>{header.label}</option>
                        ))}
                      </select>

                      <select
                        value={condition.operator}
                        onChange={(event) => updateConditionOperator(valueIndex, conditionIndex, event.target.value as FilterOperator)}
                        className="h-7 max-w-[120px] text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                      >
                        {getOperatorOptions(condition.type).map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>

                      {condition.operator === 'range' ? (
                        <>
                          <input
                            type={condition.type === 'date' ? 'date' : 'number'}
                            value={getRangeValue(condition, 0)}
                            onChange={(event) => updateCondition(valueIndex, conditionIndex, {
                              value: [event.target.value, getRangeValue(condition, 1)]
                            })}
                            className="h-7 w-24 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                          />
                          <span className="text-neutral-400 text-xs">to</span>
                          <input
                            type={condition.type === 'date' ? 'date' : 'number'}
                            value={getRangeValue(condition, 1)}
                            onChange={(event) => updateCondition(valueIndex, conditionIndex, {
                              value: [getRangeValue(condition, 0), event.target.value]
                            })}
                            className="h-7 w-24 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                          />
                        </>
                      ) : (
                        <input
                          type={condition.type === 'date' ? 'date' : condition.type === 'number' ? 'number' : 'text'}
                          value={Array.isArray(condition.value) ? condition.value[0] ?? '' : condition.value ?? ''}
                          onChange={(event) => updateCondition(valueIndex, conditionIndex, { value: event.target.value })}
                          placeholder="Value"
                          className="h-7 w-28 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                        />
                      )}

                      <button
                        type="button"
                        onClick={() => removeCondition(valueIndex, conditionIndex)}
                        className="h-7 w-7 inline-flex items-center justify-center text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md"
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {conditionError && (
                      <p className="text-[10px] font-medium text-red-500">{conditionError}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
