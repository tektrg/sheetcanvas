import React, { useState, useMemo, useEffect } from 'react';
import { SheetData, PivotConfig, PivotValue } from '../types';
import { getSheetHeaders } from '../utils/chartHelpers';
import { X, Table } from 'lucide-react';
import { PivotValuesEditor, getPivotValuesValidationError } from './PivotValuesEditor';

interface PivotConfigPanelProps {
  sourceSheet?: SheetData;
  initialConfig?: PivotConfig;
  onConfirm: (config: PivotConfig) => void;
  onCancel: () => void;
  isSetupMode?: boolean;
}

export const PivotConfigPanel: React.FC<PivotConfigPanelProps> = ({ 
  sourceSheet, 
  initialConfig,
  onConfirm, 
  onCancel,
  isSetupMode
}) => {
  const headers = useMemo(() => sourceSheet ? getSheetHeaders(sourceSheet) : [], [sourceSheet]);
  
  const [rowCol, setRowCol] = useState(initialConfig?.rowLabelCol || '');
  const [colCol, setColCol] = useState<string>(initialConfig?.colLabelCol || ''); 
  
  // Initialize values. Handle migration from old single-value pivot configs.
  const [values, setValues] = useState<PivotValue[]>(() => {
      if (initialConfig?.values && initialConfig.values.length > 0) {
          return initialConfig.values;
      }
      if (initialConfig?.valueCol && initialConfig.operation) {
          return [{ column: initialConfig.valueCol, operation: initialConfig.operation }];
      }
      return [];
  });
  
  const [showRowTotals, setShowRowTotals] = useState(initialConfig?.showRowTotals !== false);
  const [showColTotals, setShowColTotals] = useState(initialConfig?.showColTotals !== false);
  const validationError = getPivotValuesValidationError(values);
  const canSubmit = values.length > 0 && !validationError;

  // Initialize defaults if not provided and headers exist
  useEffect(() => {
    if (headers.length > 0) {
        if (!rowCol) setRowCol(headers[0].id);
        
        if (values.length === 0) {
             const defaultValCol = headers.length > 1 ? headers[1].id : headers[0].id;
             setValues([{ column: defaultValCol, operation: 'SUM' }]);
        }
    }
  }, [headers, rowCol]);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!sourceSheet) return;
    
    if (!canSubmit) return;

    onConfirm({
      sourceSheetId: sourceSheet.id,
      rowLabelCol: rowCol,
      colLabelCol: colCol || undefined,
      values,
      showRowTotals,
      showColTotals
    });
  };

  if (!sourceSheet) {
      return (
          <div className="flex items-center justify-center h-full text-neutral-400 p-4 text-center text-sm">
              Source sheet not found.
          </div>
      );
  }

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-neutral-850 ${isSetupMode ? 'p-6' : 'p-5'} text-sm`}>
      <div className="flex justify-between items-center mb-6 flex-shrink-0">
          <div className="flex items-center gap-2">
            {!isSetupMode && (
                <div className="p-1.5 bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-lg">
                    <Table size={16} />
                </div>
            )}
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-100">
                {isSetupMode ? 'Create Pivot Table' : 'Configure Pivot'}
            </h3>
          </div>
        {(!isSetupMode) && (
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="space-y-6 flex-1 overflow-y-auto min-h-0 px-1 -mx-1">
        
        {/* Row Label */}
        <div>
          <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">Rows (Group By)</label>
          <div className="relative">
              <select 
                value={rowCol}
                onChange={(e) => setRowCol(e.target.value)}
                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
              >
                {headers.map(h => (
                  <option key={h.id} value={h.id}>{h.label}</option>
                ))}
              </select>
          </div>
        </div>

        {/* Column Label */}
        <div>
          <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">Columns (Optional)</label>
          <div className="relative">
              <select 
                value={colCol}
                onChange={(e) => setColCol(e.target.value)}
                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
              >
                <option value="">(None - List View)</option>
                {headers.map(h => (
                  <option key={h.id} value={h.id}>{h.label}</option>
                ))}
              </select>
          </div>
        </div>

        <div className="h-px bg-neutral-100 dark:bg-neutral-700" />

        <PivotValuesEditor sourceSheet={sourceSheet} values={values} onChange={setValues} />

        {/* Options */}
        <div>
           <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">Options</label>
           <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer group">
                 <div className={`w-9 h-5 rounded-full relative transition-colors ${showColTotals ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                     <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${showColTotals ? 'left-5' : 'left-1'}`} />
                     <input type="checkbox" className="hidden" checked={showColTotals} onChange={(e) => setShowColTotals(e.target.checked)} />
                 </div>
                 <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">
                    Show Grand Totals (Bottom)
                 </span>
              </label>

              {/* Row totals only make sense in matrix mode (when columns are defined) */}
              {colCol && (
                  <label className="flex items-center gap-3 cursor-pointer group animate-scale-in">
                     <div className={`w-9 h-5 rounded-full relative transition-colors ${showRowTotals ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                         <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${showRowTotals ? 'left-5' : 'left-1'}`} />
                         <input type="checkbox" className="hidden" checked={showRowTotals} onChange={(e) => setShowRowTotals(e.target.checked)} />
                     </div>
                     <span className="text-sm font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">
                        Show Row Totals (Right)
                     </span>
                  </label>
              )}
           </div>
        </div>

      </div>

      {isSetupMode && (
         <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-700 flex gap-3 flex-shrink-0">
             <button 
                onClick={onCancel}
                className="flex-1 py-2.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-colors"
             >
                 Cancel
             </button>
             <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`flex-1 py-2.5 text-xs font-medium text-white rounded-lg shadow-sm transition-colors ${canSubmit ? 'bg-teal-500 hover:bg-teal-600' : 'bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed'}`}
             >
                 Generate Table
             </button>
         </div>
      )}

      {!isSetupMode && (
          <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-700">
             {validationError && (
                <p className="mb-2 text-[11px] font-medium text-red-500">{validationError}</p>
             )}
             <button
                onClick={handleSubmit}
                disabled={!canSubmit}
                className={`w-full py-2.5 text-xs font-medium text-white rounded-lg shadow-sm transition-colors ${canSubmit ? 'bg-teal-600 hover:bg-teal-700' : 'bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed'}`}
             >
                 Update Table
             </button>
          </div>
      )}
    </div>
  );
};
