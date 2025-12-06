
import React, { useState, useEffect } from 'react';
import { SheetData, FilterCondition, FilterType, FilterOperator } from '../types';
import { inferColumnType } from '../utils/dataAnalysis';
import { getSheetHeaders } from '../utils/chartHelpers';
import { Plus, X, Filter, Trash2, Calendar, Type, Hash } from 'lucide-react';

interface FilterPanelProps {
  sheet: SheetData;
  onChange: (filters: FilterCondition[]) => void;
  onClose: () => void;
  preselectedCol?: string | null;
  filteredCount?: number;
  totalCount?: number;
}

export const FilterPanel: React.FC<FilterPanelProps> = ({ sheet, onChange, onClose, preselectedCol, filteredCount, totalCount }) => {
  const headers = getSheetHeaders(sheet);
  const [activeFilters, setActiveFilters] = useState<FilterCondition[]>(sheet.filters || []);
  
  // New Filter State
  const [newColId, setNewColId] = useState(preselectedCol || headers[0]?.id || '');
  const [newType, setNewType] = useState<FilterType>('text');
  const [newOp, setNewOp] = useState<FilterOperator>('contains');
  const [newVal, setNewVal] = useState<any>('');
  const [newVal2, setNewVal2] = useState<any>(''); // For ranges

  // Update inferred type when column changes
  useEffect(() => {
    if (newColId) {
        const inferred = inferColumnType(sheet, newColId);
        setNewType(inferred);
        
        // Reset operator based on type
        if (inferred === 'text') setNewOp('contains');
        else if (inferred === 'number') setNewOp('gt');
        else if (inferred === 'date') setNewOp('on');
        
        setNewVal('');
        setNewVal2('');
    }
  }, [newColId, sheet]);

  // Sync if prop changes (e.g. user clicks another column menu)
  useEffect(() => {
    if (preselectedCol && preselectedCol !== newColId) {
        setNewColId(preselectedCol);
    }
  }, [preselectedCol]);

  const addFilter = () => {
    if (!newColId) return;
    
    let finalVal = newVal;
    if (newOp === 'range') {
        finalVal = [newVal, newVal2];
    }

    const newFilter: FilterCondition = {
        id: Math.random().toString(36).substr(2, 9),
        columnId: newColId,
        type: newType,
        operator: newOp,
        value: finalVal
    };

    const updated = [...activeFilters, newFilter];
    setActiveFilters(updated);
    onChange(updated);
    
    // Reset inputs
    setNewVal('');
    setNewVal2('');
  };

  const removeFilter = (id: string) => {
      const updated = activeFilters.filter(f => f.id !== id);
      setActiveFilters(updated);
      onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
          addFilter();
      }
  };

  return (
    <div className="flex flex-col border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50/50 dark:bg-neutral-900/50 backdrop-blur-sm p-3 gap-3 animate-scale-in origin-top">
      
      {/* Active Filters List */}
      {activeFilters.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
              {activeFilters.map(f => {
                  const colName = headers.find(h => h.id === f.columnId)?.label || f.columnId;
                  let valDisplay = String(f.value);
                  if (Array.isArray(f.value)) valDisplay = `${f.value[0]} - ${f.value[1]}`;
                  
                  return (
                      <div key={f.id} className="flex items-center gap-1.5 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-md px-2 py-1 shadow-sm text-xs">
                          <span className="font-semibold text-neutral-600 dark:text-neutral-300">{colName}</span>
                          <span className="text-neutral-400 italic">{f.operator}</span>
                          <span className="font-medium text-teal-600 dark:text-teal-400 max-w-[120px] truncate" title={String(f.value)}>{valDisplay}</span>
                          <button onClick={() => removeFilter(f.id)} className="ml-1 text-neutral-400 hover:text-red-500">
                              <X size={12} />
                          </button>
                      </div>
                  );
              })}
          </div>
      )}

      {/* Add Filter Controls */}
      <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 text-xs font-medium text-neutral-500">
              <Filter size={14} />
              <span>Filter by:</span>
          </div>

          {/* Column Select */}
          <select 
            value={newColId} 
            onChange={e => setNewColId(e.target.value)}
            className="h-7 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
          >
              {headers.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>

          {/* Type Icon Indicator */}
          <div className="text-neutral-400" title={`Detected Type: ${newType}`}>
              {newType === 'text' && <Type size={14} />}
              {newType === 'number' && <Hash size={14} />}
              {newType === 'date' && <Calendar size={14} />}
          </div>

          {/* Operator Select */}
          <select 
            value={newOp} 
            onChange={e => setNewOp(e.target.value as FilterOperator)}
            className="h-7 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
          >
              {newType === 'text' && (
                  <>
                    <option value="contains">contains</option>
                    <option value="equals">equals</option>
                    <option value="startsWith">starts with</option>
                    <option value="endsWith">ends with</option>
                  </>
              )}
              {newType === 'number' && (
                  <>
                    <option value="gt">greater than</option>
                    <option value="lt">less than</option>
                    <option value="eq">equals</option>
                    <option value="neq">not equals</option>
                    <option value="range">range</option>
                  </>
              )}
              {newType === 'date' && (
                  <>
                    <option value="on">on</option>
                    <option value="before">before</option>
                    <option value="after">after</option>
                    <option value="range">range</option>
                  </>
              )}
          </select>

          {/* Value Input(s) */}
          <div className="flex items-center gap-1">
              {(newType === 'text' || newType === 'number') && (
                  <input 
                    type={newType === 'number' ? "number" : "text"} 
                    value={newVal}
                    onChange={e => setNewVal(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Value"
                    className="h-7 w-24 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                  />
              )}
              
              {newType === 'date' && (
                  <input 
                    type="date"
                    value={newVal}
                    onChange={e => setNewVal(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-7 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                  />
              )}

              {newOp === 'range' && (
                  <>
                    <span className="text-neutral-400 text-xs">-</span>
                    <input 
                        type={newType === 'date' ? "date" : "number"}
                        value={newVal2}
                        onChange={e => setNewVal2(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="End"
                        className="h-7 w-24 text-xs border border-neutral-200 dark:border-neutral-700 rounded-md bg-white dark:bg-neutral-800 px-2 outline-none focus:border-teal-500"
                    />
                  </>
              )}
          </div>

          <button 
            onClick={addFilter}
            className="h-7 px-3 bg-teal-600 hover:bg-teal-700 text-white rounded-md text-xs font-medium flex items-center gap-1 transition-colors"
          >
              <Plus size={12} /> Add
          </button>
      </div>

      {/* Record Counter */}
      {(filteredCount !== undefined && totalCount !== undefined) && (
          <div className="flex justify-end pt-2 border-t border-neutral-200 dark:border-neutral-700">
              <span className="text-[10px] font-medium text-neutral-400">
                  Showing <span className="text-neutral-600 dark:text-neutral-300">{filteredCount}</span> of <span className="text-neutral-600 dark:text-neutral-300">{totalCount}</span> records
              </span>
          </div>
      )}

    </div>
  );
};