import React, { useState, useMemo, useEffect } from 'react';
import { SheetData, PivotConfig, PivotValue } from '../types';
import { getSheetHeaders } from '../utils/chartHelpers';
import { X, Table } from 'lucide-react';
import { PivotValuesEditor, getPivotValuesValidationError } from './PivotValuesEditor';

interface PivotCreationDialogProps {
  sheet: SheetData;
  initialConfig?: PivotConfig;
  onConfirm: (config: PivotConfig) => void;
  onCancel: () => void;
}

export const PivotCreationDialog: React.FC<PivotCreationDialogProps> = ({ 
  sheet, 
  initialConfig,
  onConfirm, 
  onCancel,
}) => {
  const headers = useMemo(() => getSheetHeaders(sheet), [sheet]);
  
  const [rowCol, setRowCol] = useState(initialConfig?.rowLabelCol || headers[0]?.id || '');
  const [colCol, setColCol] = useState<string>(initialConfig?.colLabelCol || '');
  
  const [values, setValues] = useState<PivotValue[]>(() => {
      if (initialConfig?.values && initialConfig.values.length > 0) return initialConfig.values;
      if (initialConfig?.valueCol && initialConfig.operation) return [{ column: initialConfig.valueCol, operation: initialConfig.operation }];
      return [];
  });
  
  const [showRowTotals, setShowRowTotals] = useState(initialConfig?.showRowTotals !== false);
  const [showColTotals, setShowColTotals] = useState(initialConfig?.showColTotals !== false);
  const validationError = getPivotValuesValidationError(values);
  const canSubmit = values.length > 0 && !validationError;

  useEffect(() => {
    if (headers.length > 0 && values.length === 0) {
         const defaultValCol = headers.length > 1 ? headers[1].id : headers[0].id;
         setValues([{ column: defaultValCol, operation: 'SUM' }]);
    }
  }, [headers]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    onConfirm({
      sourceSheetId: sheet.id,
      rowLabelCol: rowCol,
      colLabelCol: colCol || undefined,
      values,
      showRowTotals,
      showColTotals
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="bg-white dark:bg-neutral-850 rounded-xl shadow-2xl w-full max-w-md border border-neutral-200 dark:border-neutral-700 relative z-10 flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-lg">
                <Table size={18} />
            </div>
            <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100">
                {initialConfig ? 'Configure Pivot Table' : 'Create Pivot Table'}
            </h3>
          </div>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 overflow-y-auto">
          
          <div className="grid grid-cols-2 gap-4">
            {/* Row Label */}
            <div className="col-span-2">
              <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase tracking-wide">Rows (Group By)</label>
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

            {/* Column Label */}
            <div className="col-span-2">
              <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-1.5 uppercase tracking-wide">Columns (Optional)</label>
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

            <div className="h-px bg-neutral-100 dark:bg-neutral-800 col-span-2 my-1" />

            <div className="col-span-2">
              <PivotValuesEditor sourceSheet={sheet} values={values} onChange={setValues} />
            </div>

            {/* Totals Options */}
            <div className="col-span-2 pt-2">
               <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">Totals</label>
               <div className="flex flex-col gap-2">
                   <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer">
                      <input type="checkbox" checked={showColTotals} onChange={(e) => setShowColTotals(e.target.checked)} className="rounded text-teal-600 focus:ring-teal-500" />
                      Show Grand Totals (Bottom)
                   </label>
                   
                   {colCol && (
                       <label className="flex items-center gap-2 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer animate-scale-in">
                          <input type="checkbox" checked={showRowTotals} onChange={(e) => setShowRowTotals(e.target.checked)} className="rounded text-teal-600 focus:ring-teal-500" />
                          Show Row Totals (Right)
                       </label>
                   )}
               </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-200 dark:border-neutral-700 flex justify-end gap-3 bg-neutral-50 dark:bg-neutral-900/50 rounded-b-xl flex-shrink-0">
           {validationError && (
             <p className="mr-auto self-center text-[11px] font-medium text-red-500">{validationError}</p>
           )}
           <button
             onClick={onCancel}
             className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
           >
             Cancel
           </button>
           <button
             onClick={handleSubmit}
             disabled={!canSubmit}
             className={`px-4 py-2 text-sm font-medium text-white rounded-lg shadow-sm transition-colors ${canSubmit ? 'bg-teal-600 hover:bg-teal-700' : 'bg-neutral-300 dark:bg-neutral-700 cursor-not-allowed'}`}
           >
             {initialConfig ? 'Update Table' : 'Generate Table'}
           </button>
        </div>

      </div>
    </div>
  );
};
