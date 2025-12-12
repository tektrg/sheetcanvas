


import React, { useState, useMemo } from 'react';
import { SheetData, ChartType, ChartConfig } from '../types';
import { getSheetHeaders } from '../utils/chartHelpers';
import { CHART_COLORS } from '../constants';
import { X, BarChart3, LineChart, PieChart, AreaChart, ScatterChart, LayoutGrid } from 'lucide-react';

interface ChartCreationDialogProps {
  sheet: SheetData;
  initialColIndex?: number;
  onConfirm: (config: ChartConfig) => void;
  onCancel: () => void;
  darkMode: boolean;
}

export const ChartCreationDialog: React.FC<ChartCreationDialogProps> = ({ 
  sheet, 
  initialColIndex, 
  onConfirm, 
  onCancel,
  darkMode
}) => {
  const headers = useMemo(() => getSheetHeaders(sheet), [sheet]);
  
  const [type, setType] = useState<ChartType>('line');
  const [labelCol, setLabelCol] = useState(headers[0]?.id || 'A');
  const [dataCol, setDataCol] = useState(() => {
    // If a column was selected and it's not the first one (usually label), default to it
    if (initialColIndex !== undefined) {
        // Find header by index
        const h = headers.find(h => h.index === initialColIndex);
        if (h && h.index > 0) return h.id;
    }
    // Default to second column if available, else first
    return headers.length > 1 ? headers[1].id : headers[0].id;
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onConfirm({
      type,
      labelColumn: labelCol,
      dataColumns: [dataCol],
      color: CHART_COLORS[0],
      highlightIndex: -1,
      animation: true,
      showLabels: true
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/20 dark:bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div className="bg-white dark:bg-neutral-850 rounded-xl shadow-2xl w-full max-w-md border border-neutral-200 dark:border-neutral-700 relative z-10 flex flex-col">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200 dark:border-neutral-700">
          <h3 className="font-semibold text-lg text-neutral-800 dark:text-neutral-100">Create Chart</h3>
          <button onClick={onCancel} className="text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-6">
          
          {/* Chart Type Selection */}
          <div>
            <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-2">Chart Type</label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { id: 'bar', label: 'Bar', icon: BarChart3 },
                { id: 'line', label: 'Line', icon: LineChart },
                { id: 'area', label: 'Area', icon: AreaChart },
                { id: 'pie', label: 'Pie', icon: PieChart },
                { id: 'scatter', label: 'Scatter', icon: ScatterChart },
                { id: 'treemap', label: 'Treemap', icon: LayoutGrid },
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => setType(item.id as ChartType)}
                  className={`flex flex-col items-center justify-center gap-2 py-3 rounded-lg border transition-all
                    ${type === item.id 
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 ring-1 ring-teal-500' 
                      : 'border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                    }`}
                >
                  <item.icon size={20} />
                  <span className="text-[10px] font-medium">{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Label Column */}
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-2">Label (X-Axis)</label>
              <select 
                value={labelCol}
                onChange={(e) => setLabelCol(e.target.value)}
                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
              >
                {headers.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.label} ({h.id})
                  </option>
                ))}
              </select>
            </div>

            {/* Value Column */}
            <div>
              <label className="block text-sm font-medium text-neutral-600 dark:text-neutral-400 mb-2">Value (Y-Axis)</label>
              <select 
                value={dataCol}
                onChange={(e) => setDataCol(e.target.value)}
                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
              >
                {headers.map(h => (
                  <option key={h.id} value={h.id}>
                    {h.label} ({h.id})
                  </option>
                ))}
              </select>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-neutral-200 dark:border-neutral-700 flex justify-end gap-3 bg-neutral-50 dark:bg-neutral-900/50 rounded-b-xl">
           <button 
             onClick={onCancel}
             className="px-4 py-2 text-sm font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
           >
             Cancel
           </button>
           <button 
             onClick={handleSubmit}
             className="px-4 py-2 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg shadow-sm transition-colors"
           >
             Create Chart
           </button>
        </div>

      </div>
    </div>
  );
};