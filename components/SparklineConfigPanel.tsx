
import React, { useState, useMemo, useEffect } from 'react';
import { SheetData, SparklineConfig, SparklineMode, SparklineCompareMode, PivotOperation } from '../types';
import { getSheetHeaders } from '../utils/chartHelpers';
import { inferColumnType } from '../utils/dataAnalysis';
import { X, TrendingUp, Plus, Trash2, HelpCircle } from 'lucide-react';

interface SparklineConfigPanelProps {
  sourceSheet?: SheetData;
  initialConfig?: SparklineConfig;
  onConfirm: (config: SparklineConfig) => void;
  onCancel: () => void;
  isSetupMode?: boolean;
}

export const SparklineConfigPanel: React.FC<SparklineConfigPanelProps> = ({ 
  sourceSheet, 
  initialConfig,
  onConfirm, 
  onCancel,
  isSetupMode
}) => {
  const headers = useMemo(() => sourceSheet ? getSheetHeaders(sourceSheet) : [], [sourceSheet]);
  
  const [dateCol, setDateCol] = useState(initialConfig?.dateCol || '');
  const [mode, setMode] = useState<SparklineMode>(initialConfig?.mode || 'metrics');
  const [compareMode, setCompareMode] = useState<SparklineCompareMode>(initialConfig?.compareMode || 'vs_avg');
  
  const [dataCols, setDataCols] = useState<string[]>(initialConfig?.dataCols || []);
  
  const [groupCol, setGroupCol] = useState(initialConfig?.groupCol || '');
  const [valueCol, setValueCol] = useState(initialConfig?.valueCol || '');
  const [operation, setOperation] = useState<PivotOperation>(initialConfig?.operation || 'SUM');

  // Auto-detect Date column
  useEffect(() => {
    if (sourceSheet && !dateCol && headers.length > 0) {
        // Find columns that look like dates
        const dateCandidates = headers.filter(h => inferColumnType(sourceSheet, h.id) === 'date');
        if (dateCandidates.length === 1) {
            setDateCol(dateCandidates[0].id);
        } else if (dateCandidates.length > 0) {
            setDateCol(dateCandidates[0].id);
        } else {
            // Fallback to first column if no dates found, user must change
            setDateCol(headers[0].id);
        }
    }
  }, [sourceSheet, headers, dateCol]);

  // Init defaults for metrics mode
  useEffect(() => {
      if (mode === 'metrics' && dataCols.length === 0 && headers.length > 1) {
          // Default to picking numeric columns? Or just the second column.
          const numericCols = headers.filter(h => inferColumnType(sourceSheet!, h.id) === 'number');
          if (numericCols.length > 0) {
              setDataCols([numericCols[0].id]);
          } else {
              setDataCols([headers[1].id || headers[0].id]);
          }
      }
      if (mode === 'group' && !groupCol && headers.length > 0) {
          setGroupCol(headers[0].id);
      }
      if (mode === 'group' && !valueCol && headers.length > 1) {
           setValueCol(headers[1].id);
      }
  }, [mode, headers, sourceSheet]);

  const handleSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!sourceSheet) return;
    
    if (mode === 'metrics' && dataCols.length === 0) return;
    if (mode === 'group' && (!groupCol || !valueCol)) return;

    onConfirm({
      sourceSheetId: sourceSheet.id,
      dateCol,
      mode,
      compareMode,
      dataCols: mode === 'metrics' ? dataCols : undefined,
      groupCol: mode === 'group' ? groupCol : undefined,
      valueCol: mode === 'group' ? valueCol : undefined,
      operation: mode === 'group' ? operation : undefined
    });
  };

  const addDataCol = () => {
      const unused = headers.find(h => !dataCols.includes(h.id));
      if (unused) {
          setDataCols(prev => [...prev, unused.id]);
      } else {
          setDataCols(prev => [...prev, headers[0].id]);
      }
  };

  const removeDataCol = (index: number) => {
      setDataCols(prev => prev.filter((_, i) => i !== index));
  };

  const updateDataCol = (index: number, val: string) => {
      setDataCols(prev => {
          const next = [...prev];
          next[index] = val;
          return next;
      });
  };

  if (!sourceSheet) {
      return <div className="p-4">Source sheet not found.</div>;
  }

  return (
    <div className={`flex flex-col h-full min-h-[500px] bg-white dark:bg-neutral-850 ${isSetupMode ? 'p-6' : 'p-5'} text-sm`}>
       <div className="flex justify-between items-center mb-6 flex-shrink-0">
          <div className="flex items-center gap-2">
            {!isSetupMode && (
                <div className="p-1.5 bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 rounded-lg">
                    <TrendingUp size={16} />
                </div>
            )}
            <h3 className="font-semibold text-neutral-800 dark:text-neutral-100">
                {isSetupMode ? 'Create Sparklines' : 'Configure Sparklines'}
            </h3>
          </div>
        {(!isSetupMode) && (
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="space-y-6 flex-1 overflow-y-auto min-h-0 px-1 -mx-1">
          
          {/* Date Column */}
          <div>
            <div className="flex items-center gap-2 mb-2">
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Date / Time Column</label>
                <div className="group/tooltip relative">
                    <HelpCircle size={12} className="text-neutral-400 cursor-help" />
                    {/* Tooltip changed to appear below (top-full) to avoid being clipped by parent overflow */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 p-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50 text-center font-normal normal-case tracking-normal">
                        Used for the X-axis of the sparkline.
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 border-4 border-transparent border-b-neutral-900 dark:border-b-neutral-100"></div>
                    </div>
                </div>
            </div>
            <div className="relative">
                <select 
                    value={dateCol}
                    onChange={(e) => setDateCol(e.target.value)}
                    className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                >
                    {headers.map(h => (
                    <option key={h.id} value={h.id}>{h.label}</option>
                    ))}
                </select>
            </div>
          </div>

          <div className="h-px bg-neutral-100 dark:bg-neutral-700" />
          
          {/* Compare Mode */}
          <div>
            <div className="flex items-center gap-2 mb-2">
                <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 uppercase tracking-wide">Comparison Baseline</label>
                <div className="group/tooltip relative">
                    <HelpCircle size={12} className="text-neutral-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs rounded shadow-lg opacity-0 group-hover/tooltip:opacity-100 transition-opacity pointer-events-none z-50 text-center font-normal normal-case tracking-normal">
                        Determines how the change percentage is calculated.
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-900 dark:border-t-neutral-100"></div>
                    </div>
                </div>
            </div>
            <div className="relative">
                <select 
                    value={compareMode}
                    onChange={(e) => setCompareMode(e.target.value as SparklineCompareMode)}
                    className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                >
                    <option value="vs_avg">Average (Current vs Avg)</option>
                    <option value="vs_prev">Previous (Current vs Last)</option>
                    <option value="vs_first">Start Value (Current vs First)</option>
                </select>
            </div>
          </div>

          <div className="h-px bg-neutral-100 dark:bg-neutral-700" />

          {/* Mode Selection */}
          <div>
              <label className="block text-xs font-bold text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wide">Lines Generation</label>
              
              <div className="flex gap-4 mb-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                          type="radio" 
                          checked={mode === 'metrics'} 
                          onChange={() => setMode('metrics')} 
                          className="text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-sm text-neutral-700 dark:text-neutral-300">Select Metrics</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                          type="radio" 
                          checked={mode === 'group'} 
                          onChange={() => setMode('group')} 
                          className="text-teal-600 focus:ring-teal-500"
                      />
                      <span className="text-sm text-neutral-700 dark:text-neutral-300">Group By Column</span>
                  </label>
              </div>

              {mode === 'metrics' ? (
                  <div className="space-y-2 pl-1">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-neutral-500">Metric Columns (Lines)</span>
                        <button 
                            onClick={addDataCol}
                            className="flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 bg-teal-50 dark:bg-teal-900/20 px-2 py-1 rounded transition-colors"
                        >
                            <Plus size={10} /> Add
                        </button>
                      </div>
                      {dataCols.map((colId, idx) => (
                          <div key={idx} className="flex gap-2">
                              <select 
                                    value={colId}
                                    onChange={(e) => updateDataCol(idx, e.target.value)}
                                    className="flex-1 bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-900 dark:text-neutral-100 outline-none focus:ring-1 focus:ring-teal-500/50"
                                >
                                    {headers.map(h => (
                                    <option key={h.id} value={h.id}>{h.label}</option>
                                    ))}
                                </select>
                                <button 
                                    onClick={() => removeDataCol(idx)}
                                    disabled={dataCols.length <= 1}
                                    className={`p-2 rounded-md transition-colors ${dataCols.length <= 1 ? 'opacity-30' : 'text-neutral-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20'}`}
                                >
                                    <Trash2 size={14} />
                                </button>
                          </div>
                      ))}
                  </div>
              ) : (
                  <div className="space-y-4 pl-1">
                      <div>
                          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Group By (Line Name)</label>
                          <select 
                                value={groupCol}
                                onChange={(e) => setGroupCol(e.target.value)}
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            >
                                {headers.map(h => (
                                <option key={h.id} value={h.id}>{h.label}</option>
                                ))}
                            </select>
                      </div>
                      <div>
                          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Value Column</label>
                          <select 
                                value={valueCol}
                                onChange={(e) => setValueCol(e.target.value)}
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            >
                                {headers.map(h => (
                                <option key={h.id} value={h.id}>{h.label}</option>
                                ))}
                            </select>
                      </div>
                      <div>
                          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-1">Aggregation</label>
                          <select 
                                value={operation}
                                onChange={(e) => setOperation(e.target.value as PivotOperation)}
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                            >
                                <option value="SUM">SUM</option>
                                <option value="AVG">AVG</option>
                                <option value="MAX">MAX</option>
                                <option value="MIN">MIN</option>
                                <option value="COUNT">COUNT</option>
                            </select>
                      </div>
                  </div>
              )}
          </div>
      </div>

      {isSetupMode ? (
         <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-700 flex gap-3 flex-shrink-0">
             <button 
                onClick={onCancel}
                className="flex-1 py-2.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-colors"
             >
                 Cancel
             </button>
             <button 
                onClick={handleSubmit}
                className="flex-1 py-2.5 text-xs font-medium text-white bg-teal-500 hover:bg-teal-600 rounded-lg shadow-sm transition-colors"
             >
                 Create
             </button>
         </div>
      ) : (
          <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-700">
             <button 
                onClick={handleSubmit}
                className="w-full py-2.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm transition-colors"
             >
                 Update
             </button>
         </div>
      )}

    </div>
  );
};
