
import React, { useState } from 'react';
import { ChartConfig, ChartType } from '../types';
import { CHART_COLORS } from '../constants';
import { Trash2, ChevronDown, Plus, X, BarChart3, LineChart, PieChart, ArrowLeftRight } from 'lucide-react';

interface Header {
  id: string;
  label: string;
  index: number;
}

interface ChartConfigPanelProps {
  config: ChartConfig;
  headers: Header[];
  onChange: (newConfig: ChartConfig) => void;
  onClose?: () => void;
  isSetupMode?: boolean;
  onConfirm?: () => void;
  onCancel?: () => void;
  palette?: string[];
  onAddCustomColor?: (color: string) => void;
}

export const ChartConfigPanel: React.FC<ChartConfigPanelProps> = ({
  config,
  headers,
  onChange,
  onClose,
  isSetupMode = false,
  onConfirm,
  onCancel,
  palette,
  onAddCustomColor
}) => {
  const activePalette = palette || CHART_COLORS;

  const updateConfig = (updates: Partial<ChartConfig>) => {
    onChange({ ...config, ...updates });
  };

  const addSeries = () => {
    // Basic heuristic to find next column
    const used = new Set(config.dataColumns);
    const next = headers.find(h => !used.has(h.id))?.id || headers[0]?.id;
    if (next) {
      updateConfig({ dataColumns: [...config.dataColumns, next] });
    }
  };

  const removeSeries = (index: number) => {
    const newCols = [...config.dataColumns];
    const removedCol = newCols[index];
    newCols.splice(index, 1);
    
    // Also remove from right axis list if present
    const newRightAxis = (config.rightAxisColumns || []).filter(c => c !== removedCol);
    // Remove specific type override
    const newSeriesTypes = { ...(config.seriesTypes || {}) };
    delete newSeriesTypes[removedCol];

    updateConfig({ 
        dataColumns: newCols, 
        rightAxisColumns: newRightAxis,
        seriesTypes: newSeriesTypes
    });
  };

  const updateSeries = (index: number, colId: string) => {
    const oldCol = config.dataColumns[index];
    const newCols = [...config.dataColumns];
    newCols[index] = colId;
    
    // Update axis mapping if needed
    let newRightAxis = config.rightAxisColumns || [];
    if (newRightAxis.includes(oldCol)) {
        newRightAxis = newRightAxis.filter(c => c !== oldCol);
        newRightAxis.push(colId);
    }

    // Update type mapping if needed
    const newSeriesTypes = { ...(config.seriesTypes || {}) };
    if (newSeriesTypes[oldCol]) {
        newSeriesTypes[colId] = newSeriesTypes[oldCol];
        delete newSeriesTypes[oldCol];
    }

    updateConfig({ 
        dataColumns: newCols, 
        rightAxisColumns: newRightAxis,
        seriesTypes: newSeriesTypes 
    });
  };

  const toggleSeriesAxis = (colId: string) => {
      const currentRight = config.rightAxisColumns || [];
      let newRight;
      if (currentRight.includes(colId)) {
          newRight = currentRight.filter(c => c !== colId);
      } else {
          newRight = [...currentRight, colId];
      }
      updateConfig({ rightAxisColumns: newRight });
  };

  const toggleSeriesType = (colId: string) => {
      const currentType = config.seriesTypes?.[colId] || config.type;
      const nextType: ChartType = currentType === 'bar' ? 'line' : 'bar';
      
      const newSeriesTypes = { ...(config.seriesTypes || {}) };
      newSeriesTypes[colId] = nextType;
      
      updateConfig({ seriesTypes: newSeriesTypes });
  };

  return (
    <div className={`flex flex-col h-full bg-white dark:bg-neutral-850 ${isSetupMode ? 'p-6' : 'p-5'} text-sm`}>
      <div className="flex justify-between items-center mb-6 flex-shrink-0">
        <h3 className="font-semibold text-neutral-800 dark:text-neutral-200">
          {isSetupMode ? 'Configure Chart' : 'Settings'}
        </h3>
        {!isSetupMode && onClose && (
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="space-y-6 flex-1 overflow-y-auto min-h-0 pr-1 -mr-1">
        {/* Chart Type */}
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-2 uppercase tracking-wide">Chart Type</label>
          <div className="flex gap-2">
            {(['bar', 'line', 'pie'] as const).map(t => (
              <button 
                key={t}
                onClick={() => updateConfig({ type: t, seriesTypes: {} })} // Reset overrides when changing main type
                className={`flex-1 py-2 text-xs font-medium rounded-lg capitalize border transition-all flex flex-col items-center gap-1.5
                  ${config.type === t 
                    ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-400 text-teal-700 dark:text-teal-300 ring-1 ring-teal-400' 
                    : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                  }`}
              >
                {t === 'bar' && <BarChart3 size={18} />}
                {t === 'line' && <LineChart size={18} />}
                {t === 'pie' && <PieChart size={18} />}
                <span>{t}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Data Source */}
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wide">Data Source</label>
          <div className="space-y-4">
            <div>
              <span className="text-[10px] text-neutral-400 font-medium mb-1.5 block">X-Axis (Labels)</span>
              <div className="relative">
                <select
                  className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400" 
                  value={config.labelColumn}
                  onChange={(e) => updateConfig({ labelColumn: e.target.value })}
                >
                  {headers.map(h => (
                    <option key={h.id} value={h.id}>{h.label}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
              </div>
            </div>

            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[10px] text-neutral-400 font-medium block">Y-Axis (Values)</span>
                {config.type !== 'pie' && (
                  <button 
                    onClick={addSeries}
                    className="flex items-center gap-1 text-[10px] font-medium text-teal-600 dark:text-teal-400 hover:text-teal-700 dark:hover:text-teal-300 bg-teal-50 dark:bg-teal-900/20 px-2 py-1 rounded transition-colors"
                  >
                    <Plus size={10} /> Add Series
                  </button>
                )}
              </div>
              <div className="space-y-2">
                {config.dataColumns.map((colId, index) => {
                  const isRightAxis = config.rightAxisColumns?.includes(colId);
                  const effectiveType = config.seriesTypes?.[colId] || config.type;

                  return (
                    <div key={index} className="flex gap-2 items-center group">
                      <div className="relative flex-1">
                        <select
                          className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400" 
                          value={colId}
                          onChange={(e) => updateSeries(index, e.target.value)}
                        >
                          {headers.map(h => (
                            <option key={h.id} value={h.id}>{h.label}</option>
                          ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
                      </div>
                      
                      {config.type !== 'pie' && (
                          <>
                           <button
                            onClick={() => toggleSeriesType(colId)}
                            className="p-1.5 h-full rounded-md border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-700 w-8 flex justify-center items-center"
                            title={effectiveType === 'bar' ? "Bar Chart" : "Line Chart"}
                           >
                              {effectiveType === 'bar' ? <BarChart3 size={14} /> : <LineChart size={14} />}
                           </button>

                           <button
                            onClick={() => toggleSeriesAxis(colId)}
                            className={`p-1.5 h-full rounded-md border text-[10px] font-medium flex items-center gap-1 w-8 justify-center transition-colors
                                ${isRightAxis 
                                    ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-200 dark:border-teal-800 text-teal-600 dark:text-teal-400' 
                                    : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-500'}`}
                            title={isRightAxis ? "Right Axis" : "Left Axis"}
                          >
                              {isRightAxis ? "R" : "L"}
                          </button>
                          </>
                      )}

                      {(config.dataColumns.length > 1 || config.type !== 'pie') && (
                        <button 
                          onClick={() => removeSeries(index)}
                          disabled={config.dataColumns.length <= 1}
                          className={`p-1.5 rounded-md border transition-colors ${config.dataColumns.length <= 1 ? 'opacity-30 cursor-not-allowed border-transparent' : 'border-neutral-200 dark:border-neutral-700 hover:border-red-300 dark:hover:border-red-800 hover:bg-red-50 dark:hover:bg-red-900/20 text-neutral-400 hover:text-red-500'}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Appearance */}
        <div>
          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wide">Appearance</label>
          <div className="space-y-4">
             <div>
                <span className="text-[10px] text-neutral-400 font-medium mb-2 block">Primary Color</span>
                <div className="flex flex-wrap gap-2 items-center">
                    {activePalette.map(c => (
                        <button
                           key={c}
                           className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-105 ${config.color === c ? 'border-neutral-400 dark:border-neutral-200 ring-2 ring-offset-1 ring-teal-100 dark:ring-teal-900' : 'border-transparent'}`}
                           style={{ backgroundColor: c }}
                           onClick={() => updateConfig({ color: c })}
                           title={c}
                        />
                    ))}
                    {/* Custom Color Picker */}
                    <label 
                        className={`relative w-6 h-6 rounded-full border-2 transition-transform hover:scale-105 cursor-pointer flex items-center justify-center overflow-hidden
                            ${!activePalette.includes(config.color) 
                                ? 'border-neutral-400 dark:border-neutral-200 ring-2 ring-offset-1 ring-teal-100 dark:ring-teal-900' 
                                : 'border-transparent'
                            }`}
                        style={{ 
                             background: !activePalette.includes(config.color) 
                                ? config.color 
                                : 'conic-gradient(from 180deg at 50% 50%, #ef4444 0deg, #f97316 60deg, #eab308 120deg, #22c55e 180deg, #3b82f6 240deg, #a855f7 300deg, #ef4444 360deg)'
                        }}
                        title="Custom Color"
                    >
                        <input 
                            type="color"
                            value={config.color}
                            onChange={(e) => updateConfig({ color: e.target.value })}
                            onBlur={(e) => onAddCustomColor && onAddCustomColor(e.target.value)}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
                        />
                    </label>
                </div>
             </div>

             <div className="space-y-3 pt-2">
                 {config.type === 'bar' && (
                     <label className="flex items-center gap-3 cursor-pointer group">
                         <div className={`w-9 h-5 rounded-full relative transition-colors ${config.stacked ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                             <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${config.stacked ? 'left-5' : 'left-1'}`} />
                             <input type="checkbox" className="hidden" checked={!!config.stacked} onChange={(e) => updateConfig({ stacked: e.target.checked })} />
                         </div>
                         <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">Stacked Bars</span>
                     </label>
                 )}

                 <label className="flex items-center gap-3 cursor-pointer group">
                     <div className={`w-9 h-5 rounded-full relative transition-colors ${config.showLabels ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                         <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${config.showLabels ? 'left-5' : 'left-1'}`} />
                         <input type="checkbox" className="hidden" checked={!!config.showLabels} onChange={(e) => updateConfig({ showLabels: e.target.checked })} />
                     </div>
                     <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">Show Values</span>
                 </label>

                 <label className="flex items-center gap-3 cursor-pointer group">
                     <div className={`w-9 h-5 rounded-full relative transition-colors ${config.animation ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                         <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${config.animation ? 'left-5' : 'left-1'}`} />
                         <input type="checkbox" className="hidden" checked={config.animation} onChange={(e) => updateConfig({ animation: e.target.checked })} />
                     </div>
                     <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">Animation</span>
                 </label>
             </div>
          </div>
        </div>

      </div>

      {isSetupMode && onConfirm && onCancel && (
         <div className="mt-6 pt-4 border-t border-neutral-100 dark:border-neutral-700 flex gap-3 flex-shrink-0">
             <button 
                onClick={onCancel}
                className="flex-1 py-2.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg border border-neutral-200 dark:border-neutral-700 transition-colors"
             >
                 Cancel
             </button>
             <button 
                onClick={onConfirm}
                className="flex-1 py-2.5 text-xs font-medium text-white bg-teal-500 hover:bg-teal-600 rounded-lg shadow-sm transition-colors"
             >
                 Create Chart
             </button>
         </div>
      )}
    </div>
  );
};
