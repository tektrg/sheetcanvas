


import React, { useState, useEffect } from 'react';
import { ChartColorSchemeId, ChartColorSchemeOverride, ChartColorSettings, ChartConfig, ChartType, PivotOperation, ChartMode, TimeGranularity } from '../types';
import {
  CHART_SCHEME_OPTIONS,
  getChartPrimaryColor,
  getChartPalette,
  getEffectiveChartScheme,
  normalizeHexColor,
} from '../utils/chartColorSchemes';
import { Trash2, ChevronDown, Plus, X, BarChart3, LineChart, PieChart, AreaChart, ScatterChart, LayoutGrid } from 'lucide-react';

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
  recentColors: string[];
  colorSettings: ChartColorSettings;
  darkMode: boolean;
  onColorSettingsChange: (updates: Partial<ChartColorSettings>) => void;
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
  recentColors,
  colorSettings,
  darkMode,
  onColorSettingsChange,
  onAddCustomColor
}) => {
  const activeScheme = getEffectiveChartScheme(config, colorSettings);
  const activePalette = getChartPalette(colorSettings, darkMode, activeScheme);
  const workspacePalette = getChartPalette(colorSettings, darkMode);
  const activePrimaryColor = getChartPrimaryColor(config, activePalette);
  const visibleRecentColors = recentColors.filter(color => (
    !activePalette.some(activeColor => activeColor.toLowerCase() === color.toLowerCase())
  ));
  
  // Local state for Group inputs, synced with config
  const [mode, setMode] = useState<ChartMode>(config.mode || 'metrics');
  const [groupCol, setGroupCol] = useState(config.groupCol || '');
  const [seriesGroupCol, setSeriesGroupCol] = useState(config.seriesGroupCol || '');
  const [valueCol, setValueCol] = useState(config.valueCol || '');
  const [operation, setOperation] = useState<PivotOperation>(config.operation || 'SUM');
  const [granularity, setGranularity] = useState<TimeGranularity | undefined>(config.timeGranularity);

  // Initialize Group defaults if switching to group mode
  useEffect(() => {
    if (mode === 'group') {
        if (!groupCol && headers.length > 0) setGroupCol(headers[0].id);
        if (!valueCol && headers.length > 1) setValueCol(headers[1].id);
        
        // Push local state to config immediately so chart updates
        updateConfig({ 
            mode: 'group',
            groupCol: groupCol || headers[0]?.id,
            seriesGroupCol: seriesGroupCol || undefined,
            valueCol: valueCol || (headers.length > 1 ? headers[1].id : headers[0]?.id),
            operation,
            timeGranularity: granularity
        });
    } else {
        updateConfig({ mode: 'metrics' });
    }
  }, [mode]);

  const updateConfig = (updates: Partial<ChartConfig>) => {
    onChange({ ...config, ...updates });
  };

  const updateWorkspaceScheme = (schemeId: ChartColorSchemeId) => {
    const nextPalette = getChartPalette({ ...colorSettings, schemeId }, darkMode, schemeId);
    onColorSettingsChange({ schemeId });
    if (!config.colorScheme || config.colorScheme === 'workspace') {
      updateConfig({ color: nextPalette[0], colorScheme: 'workspace', colorOverride: false });
    }
  };

  const updateMonoBaseColor = (color: string) => {
    const monoBaseColor = normalizeHexColor(color) || color;
    onColorSettingsChange({ monoBaseColor });
    if (activeScheme === 'mono') {
      const nextPalette = getChartPalette({ ...colorSettings, monoBaseColor }, darkMode, 'mono');
      updateConfig({ color: nextPalette[0], colorOverride: false });
    }
  };

  const updateCustomPresetInput = (customPresetInput: string) => {
    onColorSettingsChange({ customPresetInput });
    if (activeScheme === 'custom') {
      const nextPalette = getChartPalette({ ...colorSettings, customPresetInput }, darkMode, 'custom');
      updateConfig({ color: nextPalette[0], colorOverride: false });
    }
  };

  const updateChartScheme = (colorScheme: ChartColorSchemeOverride) => {
    if (colorScheme === 'workspace') {
      updateConfig({ colorScheme: 'workspace', color: workspacePalette[0], colorOverride: false });
      return;
    }

    const nextPalette = getChartPalette(colorSettings, darkMode, colorScheme);
    updateConfig({ colorScheme, color: nextPalette[0], colorOverride: false });
  };

  const renderColorButton = (color: string) => (
    <button
      key={color}
      className={`w-6 h-6 rounded-full border-2 transition-transform hover:scale-105 ${activePrimaryColor.toLowerCase() === color.toLowerCase() ? 'border-neutral-400 dark:border-neutral-200 ring-2 ring-offset-1 ring-teal-100 dark:ring-teal-900' : 'border-transparent'}`}
      style={{ backgroundColor: color }}
      onClick={() => updateConfig({ color, colorOverride: true })}
      title={color}
    />
  );

  const updateGroupConfig = (key: 'groupCol' | 'seriesGroupCol' | 'valueCol' | 'operation' | 'timeGranularity', val: any) => {
      if (key === 'groupCol') setGroupCol(val);
      if (key === 'seriesGroupCol') setSeriesGroupCol(val);
      if (key === 'valueCol') setValueCol(val);
      if (key === 'operation') setOperation(val);
      if (key === 'timeGranularity') setGranularity(val);
      
      const updatePayload: any = { [key]: val };
      if (key === 'seriesGroupCol' && val === '') updatePayload.seriesGroupCol = undefined;
      if (key === 'timeGranularity' && val === '') updatePayload.timeGranularity = undefined;
      
      updateConfig(updatePayload);
  };

  const addSeries = () => {
    const used = new Set(config.dataColumns);
    const next = headers.find(h => !used.has(h.id))?.id || headers[0]?.id;
    if (next) {
      const nextColumns = [...config.dataColumns, next];
      updateConfig({
        dataColumns: nextColumns,
        showLabels: nextColumns.length === 1 ? config.showLabels : false,
      });
    }
  };

  const removeSeries = (index: number) => {
    const newCols = [...config.dataColumns];
    const removedCol = newCols[index];
    newCols.splice(index, 1);
    
    const newRightAxis = (config.rightAxisColumns || []).filter(c => c !== removedCol);
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
    
    let newRightAxis = config.rightAxisColumns || [];
    if (newRightAxis.includes(oldCol)) {
        newRightAxis = newRightAxis.filter(c => c !== oldCol);
        newRightAxis.push(colId);
    }

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
      const nextType: ChartType = currentType === 'bar' ? 'line' : (currentType === 'line' ? 'area' : 'bar');
      // Just cycle bar->line->area for simplicity in mini button, user can set global type for scatter
      
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
          <div className="grid grid-cols-3 gap-2">
            {(['bar', 'line', 'area', 'pie', 'scatter', 'treemap'] as const).map(t => (
              <button 
                key={t}
                onClick={() => updateConfig({ type: t, seriesTypes: {} })} 
                className={`py-2 text-xs font-medium rounded-lg capitalize border transition-all flex flex-col items-center gap-1.5
                  ${config.type === t 
                    ? 'bg-teal-50 dark:bg-teal-900/30 border-teal-400 text-teal-700 dark:text-teal-300 ring-1 ring-teal-400' 
                    : 'bg-white dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
                  }`}
              >
                {t === 'bar' && <BarChart3 size={18} />}
                {t === 'line' && <LineChart size={18} />}
                {t === 'area' && <AreaChart size={18} />}
                {t === 'pie' && <PieChart size={18} />}
                {t === 'scatter' && <ScatterChart size={18} />}
                {t === 'treemap' && <LayoutGrid size={18} />}
                <span>{t}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Mode Selector */}
        <div>
             <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wide">Data Mode</label>
             <div className="flex gap-4 mb-4 bg-neutral-100 dark:bg-neutral-800/50 p-1 rounded-lg">
                  <button
                      onClick={() => setMode('metrics')}
                      className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${mode === 'metrics' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'}`}
                  >
                      Select Metrics
                  </button>
                  <button
                      onClick={() => setMode('group')}
                      className={`flex-1 py-1.5 px-3 rounded-md text-xs font-medium transition-all ${mode === 'group' ? 'bg-white dark:bg-neutral-700 shadow text-neutral-900 dark:text-white' : 'text-neutral-500 dark:text-neutral-400 hover:text-neutral-700'}`}
                  >
                      Group By
                  </button>
             </div>
        </div>

        {/* Data Configuration */}
        <div>
          {mode === 'metrics' ? (
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
                        {config.type !== 'pie' && config.type !== 'treemap' && (
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
                            
                            {config.type !== 'pie' && config.type !== 'scatter' && config.type !== 'treemap' && (
                                <>
                                <button
                                    onClick={() => toggleSeriesType(colId)}
                                    className="p-1.5 h-full rounded-md border border-neutral-200 dark:border-neutral-700 text-neutral-500 hover:bg-neutral-50 dark:hover:bg-neutral-700 w-8 flex justify-center items-center"
                                    title={effectiveType === 'bar' ? "Bar" : (effectiveType === 'line' ? "Line" : "Area")}
                                >
                                    {effectiveType === 'bar' && <BarChart3 size={14} />}
                                    {effectiveType === 'line' && <LineChart size={14} />}
                                    {effectiveType === 'area' && <AreaChart size={14} />}
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

                            {(config.dataColumns.length > 1 || (config.type !== 'pie' && config.type !== 'treemap')) && (
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
          ) : (
            <div className="space-y-4">
                 <div>
                    <label className="block text-[10px] font-medium text-neutral-400 mb-1.5">Group By (X-Axis)</label>
                    <div className="relative">
                        <select
                            className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400" 
                            value={groupCol}
                            onChange={(e) => updateGroupConfig('groupCol', e.target.value)}
                        >
                            {headers.map(h => (
                                <option key={h.id} value={h.id}>{h.label}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
                    </div>
                </div>

                {/* Granularity Option (Only visible if granularity is set or available) */}
                {config.timeGranularity && (
                    <div>
                        <label className="block text-[10px] font-medium text-neutral-400 mb-1.5">Time Bucket</label>
                        <div className="relative">
                            <select
                                className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400" 
                                value={granularity || ''}
                                onChange={(e) => updateGroupConfig('timeGranularity', e.target.value)}
                            >
                                <option value="">(None)</option>
                                <option value="day">Day</option>
                                <option value="week">Week</option>
                                <option value="month">Month</option>
                                <option value="quarter">Quarter</option>
                                <option value="year">Year</option>
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
                        </div>
                    </div>
                )}

                {config.type !== 'treemap' && (
                    <div>
                        <label className="block text-[10px] font-medium text-neutral-400 mb-1.5">Split Series By (Optional)</label>
                        <div className="relative">
                            <select
                                className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400" 
                                value={seriesGroupCol}
                                onChange={(e) => updateGroupConfig('seriesGroupCol', e.target.value)}
                            >
                                <option value="">(None)</option>
                                {headers.map(h => (
                                    <option key={h.id} value={h.id}>{h.label}</option>
                                ))}
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
                        </div>
                    </div>
                )}
                <div>
                    <label className="block text-[10px] font-medium text-neutral-400 mb-1.5">Value Column</label>
                    <div className="relative">
                        <select
                            className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400" 
                            value={valueCol}
                            onChange={(e) => updateGroupConfig('valueCol', e.target.value)}
                        >
                            {headers.map(h => (
                                <option key={h.id} value={h.id}>{h.label}</option>
                            ))}
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
                    </div>
                </div>
                <div>
                    <label className="block text-[10px] font-medium text-neutral-400 mb-1.5">Aggregation</label>
                    <div className="relative">
                        <select
                            className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400" 
                            value={operation}
                            onChange={(e) => updateGroupConfig('operation', e.target.value as PivotOperation)}
                        >
                            <option value="SUM">SUM</option>
                            <option value="AVG">AVG</option>
                            <option value="MAX">MAX</option>
                            <option value="MIN">MIN</option>
                            <option value="COUNT">COUNT</option>
                        </select>
                        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
                    </div>
                </div>
            </div>
          )}
        </div>

	        {/* Appearance */}
	        <div>
	          <label className="block text-xs font-medium text-neutral-500 dark:text-neutral-400 mb-3 uppercase tracking-wide">Appearance</label>
	          <div className="space-y-4">
	             <div>
	                <span className="text-[10px] text-neutral-400 font-medium mb-1.5 block">Workspace Default</span>
	                <div className="relative">
	                  <select
	                    className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400"
	                    value={colorSettings.schemeId}
	                    onChange={(e) => updateWorkspaceScheme(e.target.value as ChartColorSchemeId)}
	                  >
	                    {CHART_SCHEME_OPTIONS.map(option => (
	                      <option key={option.id} value={option.id}>{option.label}</option>
	                    ))}
	                  </select>
	                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
	                </div>
	             </div>

	             <div>
	                <span className="text-[10px] text-neutral-400 font-medium mb-1.5 block">This Chart</span>
	                <div className="relative">
	                  <select
	                    className="w-full appearance-none border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400"
	                    value={config.colorScheme || 'workspace'}
	                    onChange={(e) => updateChartScheme(e.target.value as ChartColorSchemeOverride)}
	                  >
	                    <option value="workspace">Workspace default</option>
	                    {CHART_SCHEME_OPTIONS.map(option => (
	                      <option key={option.id} value={option.id}>{option.label}</option>
	                    ))}
	                  </select>
	                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" size={14} />
	                </div>
	             </div>

	             {(colorSettings.schemeId === 'mono' || activeScheme === 'mono') && (
	                <div>
	                  <span className="text-[10px] text-neutral-400 font-medium mb-1.5 block">Mono Base</span>
	                  <div className="flex items-center gap-2">
	                    <input
	                      type="color"
	                      value={normalizeHexColor(colorSettings.monoBaseColor) || '#000000'}
	                      onChange={(e) => updateMonoBaseColor(e.target.value)}
	                      className="w-8 h-8 rounded-md border border-neutral-200 dark:border-neutral-700 bg-transparent"
	                    />
	                    <input
	                      type="text"
	                      value={colorSettings.monoBaseColor}
	                      onChange={(e) => updateMonoBaseColor(e.target.value)}
	                      className="min-w-0 flex-1 border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400"
	                      placeholder="#000000"
	                    />
	                  </div>
	                </div>
	             )}

	             {(colorSettings.schemeId === 'custom' || activeScheme === 'custom') && (
	                <div>
	                  <span className="text-[10px] text-neutral-400 font-medium mb-1.5 block">Custom Preset</span>
	                  <input
	                    type="text"
	                    value={colorSettings.customPresetInput}
	                    onChange={(e) => updateCustomPresetInput(e.target.value)}
	                    className="w-full border rounded-lg px-3 py-2 text-xs bg-neutral-50 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200 outline-none focus:ring-1 focus:ring-teal-400"
	                    placeholder="#0d9488, #eb5757, #f2c94c"
	                  />
	                </div>
	             )}

	             <div>
	                <span className="text-[10px] text-neutral-400 font-medium mb-2 block">Scheme Colors</span>
	                <div className="flex flex-wrap gap-2 items-center">
	                    {activePalette.map(renderColorButton)}
	                    {/* Custom Color Picker */}
	                    <label
	                        className={`relative w-6 h-6 rounded-full border-2 transition-transform hover:scale-105 cursor-pointer flex items-center justify-center overflow-hidden
	                            ${!activePalette.some(color => color.toLowerCase() === activePrimaryColor.toLowerCase()) && !visibleRecentColors.some(color => color.toLowerCase() === activePrimaryColor.toLowerCase())
	                                ? 'border-neutral-400 dark:border-neutral-200 ring-2 ring-offset-1 ring-teal-100 dark:ring-teal-900'
	                                : 'border-transparent'
	                            }`}
	                        style={{
	                             background: !activePalette.some(color => color.toLowerCase() === activePrimaryColor.toLowerCase()) && !visibleRecentColors.some(color => color.toLowerCase() === activePrimaryColor.toLowerCase())
	                                ? activePrimaryColor
	                                : 'conic-gradient(from 180deg at 50% 50%, #ef4444 0deg, #f97316 60deg, #eab308 120deg, #22c55e 180deg, #3b82f6 240deg, #a855f7 300deg, #ef4444 360deg)'
	                        }}
                        title="Custom Color"
                    >
	                        <input
	                            type="color"
	                            value={normalizeHexColor(activePrimaryColor) || '#000000'}
	                            onChange={(e) => updateConfig({ color: e.target.value, colorOverride: true })}
	                            onBlur={(e) => onAddCustomColor && onAddCustomColor(e.target.value)}
	                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
	                        />
	                    </label>
	                </div>
	             </div>

	             {visibleRecentColors.length > 0 && (
	                <div>
	                  <span className="text-[10px] text-neutral-400 font-medium mb-2 block">Recent Colors</span>
	                  <div className="flex flex-wrap gap-2 items-center">
	                    {visibleRecentColors.map(renderColorButton)}
	                  </div>
	                </div>
	             )}

	             <div className="space-y-3 pt-2">
                 {(config.type === 'bar' || config.type === 'area') && (
                     <label className="flex items-center gap-3 cursor-pointer group">
                         <div className={`w-9 h-5 rounded-full relative transition-colors ${config.stacked ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                             <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${config.stacked ? 'left-5' : 'left-1'}`} />
                             <input type="checkbox" className="hidden" checked={!!config.stacked} onChange={(e) => updateConfig({ stacked: e.target.checked })} />
                         </div>
                         <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">Stacked</span>
                     </label>
                 )}

                 <label className="flex items-center gap-3 cursor-pointer group">
                     <div className={`w-9 h-5 rounded-full relative transition-colors ${config.showLabels ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                         <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${config.showLabels ? 'left-5' : 'left-1'}`} />
                         <input type="checkbox" className="hidden" checked={!!config.showLabels} onChange={(e) => updateConfig({ showLabels: e.target.checked })} />
                     </div>
                     <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">Show Values</span>
                 </label>

                 {config.type !== 'treemap' && (
                     <label className="flex items-center gap-3 cursor-pointer group">
                         <div className={`w-9 h-5 rounded-full relative transition-colors ${config.animation ? 'bg-teal-500' : 'bg-neutral-200 dark:bg-neutral-700'}`}>
                             <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${config.animation ? 'left-5' : 'left-1'}`} />
                             <input type="checkbox" className="hidden" checked={config.animation} onChange={(e) => updateConfig({ animation: e.target.checked })} />
                         </div>
                         <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300 group-hover:text-neutral-900 dark:group-hover:text-neutral-100">Animation</span>
                     </label>
                 )}
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
