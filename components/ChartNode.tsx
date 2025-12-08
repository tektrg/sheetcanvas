

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  ComposedChart, Line, Bar, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts';
import { ChartData, SheetData, ChartType, ChartConfig, CellFormat } from '../types';
import { extractChartData, getSheetHeaders } from '../utils/chartHelpers';
import { formatValue } from '../utils/formatting';
import { getCellId } from '../utils/formulas';
import { CHART_COLORS } from '../constants';
import { GripHorizontal, Trash2, Settings2, X, Download, Video, Play, Copy, Image as ImageIcon, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { ChartConfigPanel } from './ChartConfigPanel';

interface ChartNodeProps {
  data: ChartData;
  sourceSheet?: SheetData;
  scale: number;
  selected: boolean;
  onUpdate: (id: string, newData: ChartData) => void;
  onDelete: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  darkMode?: boolean;
  onHistorySave?: () => void;
  isPendingDelete?: boolean;
  palette?: string[];
  onAddCustomColor?: (color: string) => void;
}

export const ChartNode: React.FC<ChartNodeProps> = ({ data, sourceSheet, scale, selected, onUpdate, onDelete, onMouseDown, darkMode, onHistorySave, isPendingDelete, palette, onAddCustomColor }) => {
  const [showConfig, setShowConfig] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overrideData, setOverrideData] = useState<any[] | null>(null);
  
  const isSetup = data.setupRequired;
  // Local state for setup mode
  const [tempConfig, setTempConfig] = useState<ChartConfig>(data.config);

  const chartAreaRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const setupPanelRef = useRef<HTMLDivElement>(null);

  const [playbackKey, setPlaybackKey] = useState(0); 
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  // Hook to stop scroll propagation natively
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
        e.stopPropagation();
    };

    const setupPanel = setupPanelRef.current;
    if (setupPanel) {
        setupPanel.addEventListener('wheel', handleWheel, { passive: false });
    }

    const settingsPanel = settingsPanelRef.current;
    if (settingsPanel) {
        settingsPanel.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
        if (setupPanel) setupPanel.removeEventListener('wheel', handleWheel);
        if (settingsPanel) settingsPanel.removeEventListener('wheel', handleWheel);
    };
  }, [showConfig, isSetup]);

  const processedData = useMemo(() => {
    if (!sourceSheet) return [];
    // Pass the full config to extractChartData, so it can handle grouping vs metrics mode
    return extractChartData(sourceSheet, data.config);
  }, [sourceSheet, data.config]);

  // Derived Series for Split By Mode
  const dynamicSeriesKeys = useMemo(() => {
      if (data.config.mode === 'group' && data.config.seriesGroupCol && processedData.length > 0) {
          const keys = new Set<string>();
          processedData.forEach((row: any) => {
              Object.keys(row).forEach(k => {
                  if (k !== 'name') keys.add(k);
              });
          });
          return Array.from(keys).sort();
      }
      return null;
  }, [processedData, data.config]);

  const headers = useMemo(() => sourceSheet ? getSheetHeaders(sourceSheet) : [], [sourceSheet]);

  const getSeriesLabel = (colId: string) => {
    // In group mode with split, the key itself is the label
    if (data.config.mode === 'group') {
        if (data.config.seriesGroupCol) return colId; // dynamic key IS the label
        return `${data.config.operation || 'SUM'} of ${headers.find(h => h.id === data.config.valueCol)?.label || data.config.valueCol}`;
    }
    return headers.find(h => h.id === colId)?.label || `Column ${colId}`;
  };

  const getFormatForSeries = (colId: string) => {
      if (!sourceSheet) return undefined;
      const colIdx = headers.find(h => h.id === colId)?.index;
      if (colIdx === undefined) return undefined;
      // Get format from first data row (row 1)
      const cellId = getCellId(colIdx, 1);
      return sourceSheet.cells[cellId]?.format;
  };

  const getAxisFormat = (axisId: 'left' | 'right') => {
      if (data.config.mode === 'group') {
          // In group mode, use the format of the value column for the left axis
          if (axisId === 'left' && data.config.valueCol) {
               return getFormatForSeries(data.config.valueCol);
          }
          return undefined;
      }

      const axisCols = data.config.dataColumns.filter(col => {
          const isRight = data.config.rightAxisColumns?.includes(col);
          return isRight ? axisId === 'right' : axisId === 'left';
      });

      if (axisCols.length === 0) return undefined;
      return getFormatForSeries(axisCols[0]);
  };

  const axisFormatLeft = useMemo(() => getAxisFormat('left'), [data.config, sourceSheet]);
  const axisFormatRight = useMemo(() => getAxisFormat('right'), [data.config, sourceSheet]);

  const tooltipFormatter = (value: number, name: string, item: any) => {
    // Recharts passes dataKey in item.dataKey (e.g., "value_0" or "North")
    let format;
    if (data.config.mode === 'group') {
         // In group mode, all values come from the same value column
         if (data.config.valueCol) format = getFormatForSeries(data.config.valueCol);
    } else {
         if (typeof item.dataKey === 'string' && item.dataKey.startsWith('value_')) {
             const idx = parseInt(item.dataKey.split('_')[1], 10);
             const colId = data.config.dataColumns[idx];
             format = getFormatForSeries(colId);
         }
    }
    return [formatValue(value, format), name];
  };

  const handleConfigChange = (newConfig: ChartConfig) => {
      if (isSetup) {
          setTempConfig(newConfig);
      } else {
          if (onHistorySave) onHistorySave();
          onUpdate(data.id, { ...data, config: newConfig });
      }
  };

  const handleSetupConfirm = () => {
      if (onHistorySave) onHistorySave();
      onUpdate(data.id, {
          ...data,
          config: tempConfig,
          setupRequired: false
      });
  };

  const maxDataValues = useMemo(() => {
    if (!processedData || processedData.length === 0) return { left: 'auto', right: 'auto' };
    
    // Calculate max values considering stacking logic
    let maxLeft = 0;
    let maxRight = 0;

    processedData.forEach((row: any) => {
        let leftStack = 0;
        let rightStack = 0;
        let rowMaxLeft = 0;
        let rowMaxRight = 0;

        // If in Group Mode
        if (data.config.mode === 'group') {
             if (dynamicSeriesKeys) {
                 dynamicSeriesKeys.forEach(k => {
                     const val = Number(row[k]) || 0;
                     if (data.config.stacked) leftStack += val;
                     else rowMaxLeft = Math.max(rowMaxLeft, val);
                 });
             } else {
                 const val = Number(row['value_0']) || 0;
                 rowMaxLeft = Math.max(rowMaxLeft, val);
             }
        } else {
            // Metrics Mode
            data.config.dataColumns.forEach((colId, i) => {
                const val = Number(row[`value_${i}`]) || 0;
                const isRight = data.config.rightAxisColumns?.includes(colId);
                const type = data.config.seriesTypes?.[colId] || data.config.type;
                const isStacked = data.config.stacked && type === 'bar';

                if (isRight) {
                    if (isStacked) {
                        rightStack += val;
                    } else {
                        rowMaxRight = Math.max(rowMaxRight, val);
                    }
                } else {
                    if (isStacked) {
                        leftStack += val;
                    } else {
                        rowMaxLeft = Math.max(rowMaxLeft, val);
                    }
                }
            });
        }

        maxLeft = Math.max(maxLeft, leftStack, rowMaxLeft);
        maxRight = Math.max(maxRight, rightStack, rowMaxRight);
    });

    const formatMax = (m: number) => m <= 0 ? 'auto' : Math.ceil(m * 1.1);

    return {
        left: formatMax(maxLeft),
        right: formatMax(maxRight)
    };
  }, [processedData, data.config, dynamicSeriesKeys]);

  const activeData = overrideData || processedData;
  const isAnimationActive = !overrideData && data.config.animation;

  // Generate color palette: Primary color first, then palette colors excluding primary
  const seriesPalette = useMemo(() => {
      const basePool = palette || CHART_COLORS;
      return [data.config.color, ...basePool.filter(c => c !== data.config.color)];
  }, [data.config.color, palette]);

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - resizing.startX) / scale;
      const dy = (e.clientY - resizing.startY) / scale;
      onUpdate(data.id, {
        ...data,
        size: { 
          width: Math.max(200, resizing.startW + dx),
          height: Math.max(200, resizing.startH + dy)
        }
      });
    };
    const handleMouseUp = () => setResizing(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, scale, data, onUpdate]);

  const handleCopyImage = async () => {
    if (!chartAreaRef.current) return;
    setExporting(true);
    try {
        const canvas = await html2canvas(chartAreaRef.current, { backgroundColor: darkMode ? '#262626' : '#ffffff', scale: 2 });
        canvas.toBlob(async (blob) => {
            if (blob) {
                await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob })
                ]);
            }
        });
    } catch (err) {
        console.error("Copy failed", err);
    }
    setExporting(false);
    setShowDownloadMenu(false);
  };

  const handleDownloadImage = async () => {
    if (!chartAreaRef.current) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(chartAreaRef.current, { backgroundColor: darkMode ? '#262626' : '#ffffff', scale: 2 });
      const link = document.createElement('a');
      link.download = `${data.title}.png`;
      link.href = canvas.toDataURL();
      link.click();
    } catch (err) {
      console.error("Export failed", err);
    }
    setExporting(false);
    setShowDownloadMenu(false);
  };

  const handleDownloadVideo = async () => {
     if (!chartAreaRef.current) return;
     setExporting(true);
     setShowDownloadMenu(false);
     setProgress(0);

     const FPS = 60;
     const DURATION_SEC = 2; 
     const TOTAL_FRAMES = FPS * DURATION_SEC;
     const frames: HTMLCanvasElement[] = [];
     const element = chartAreaRef.current;

     try {
         const finalData = processedData;
         const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

         for (let i = 0; i <= TOTAL_FRAMES; i++) {
             const progressPct = i / TOTAL_FRAMES;
             const eased = easeOut(progressPct);
             const frameData = finalData.map((item: any) => {
                 const newItem: any = { ...item };
                 Object.keys(newItem).forEach(k => {
                     // Check if value key (works for both value_X and dynamic keys if numeric)
                     if (typeof newItem[k] === 'number') {
                         newItem[k] = newItem[k] * eased;
                     }
                 });
                 return newItem;
             });

             setOverrideData(frameData);
             await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

             const frame = await html2canvas(element, {
                 backgroundColor: darkMode ? '#262626' : '#ffffff',
                 scale: 2,
                 logging: false,
                 useCORS: true
             });
             frames.push(frame);
             setProgress(Math.round((i / TOTAL_FRAMES) * 50));
         }

         const holdFrames = 30;
         const lastFrame = frames[frames.length - 1];
         for(let j=0; j<holdFrames; j++) {
             frames.push(lastFrame);
         }

         const recordCanvas = document.createElement('canvas');
         recordCanvas.width = frames[0].width;
         recordCanvas.height = frames[0].height;
         const ctx = recordCanvas.getContext('2d');
         
         if (!ctx) throw new Error("No canvas context");

         const stream = recordCanvas.captureStream(FPS);
         const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp9") ? "video/webm; codecs=vp9" : "video/webm";

         const mediaRecorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8000000 });
         const chunks: Blob[] = [];
         mediaRecorder.ondataavailable = (e) => {
             if (e.data.size > 0) chunks.push(e.data);
         };

         mediaRecorder.start();

         for (let i = 0; i < frames.length; i++) {
             ctx.drawImage(frames[i], 0, 0);
             await new Promise(r => setTimeout(r, 1000/FPS));
             setProgress(50 + Math.round((i / frames.length) * 50));
         }

         mediaRecorder.stop();
         await new Promise<void>((resolve) => {
             mediaRecorder.onstop = () => {
                 const blob = new Blob(chunks, { type: mimeType });
                 const url = URL.createObjectURL(blob);
                 const link = document.createElement('a');
                 link.href = url;
                 link.download = `${data.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.webm`;
                 link.click();
                 URL.revokeObjectURL(url);
                 resolve();
             };
         });

     } catch (e) {
         console.error("Video export failed", e);
     } finally {
         setExporting(false);
         setOverrideData(null);
         setProgress(0);
     }
  };

  const renderChart = () => {
    const CommonProps = {
      data: activeData,
      key: playbackKey,
      margin: { top: 20, right: 20, left: 20, bottom: 20 }
    };
    const animProps = {
        isAnimationActive: isAnimationActive,
        animationDuration: 1500,
        animationEasing: 'ease-out' as const
    };

    const textColor = darkMode ? '#a3a3a3' : '#787774';
    const gridColor = darkMode ? '#404040' : '#f0f0f0';
    const tooltipStyle = {
        backgroundColor: darkMode ? '#1f1f1f' : '#fff',
        border: `1px solid ${darkMode ? '#404040' : '#e5e5e5'}`,
        color: darkMode ? '#fff' : '#37352f',
        borderRadius: '8px',
        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)'
    };

    const isGroupMode = data.config.mode === 'group';

    // Determine if we need the right Y axis
    const hasRightAxis = !isGroupMode && data.config.dataColumns.some(col => data.config.rightAxisColumns?.includes(col));

    if (data.config.type === 'pie') {
      const format0 = isGroupMode 
            ? (data.config.valueCol ? getFormatForSeries(data.config.valueCol) : undefined)
            : getFormatForSeries(data.config.dataColumns[0]);

      const seriesName = isGroupMode 
            ? `${data.config.operation || 'SUM'} of ${data.config.valueCol}` 
            : getSeriesLabel(data.config.dataColumns[0]);

      // Note: Pie chart ignores Split By seriesGroupCol because Pie expects 1 value per category.
      // If Split By is active, we might have multiple values per category. Recharts Pie handles objects with {name, value}.
      // Our data structure for Split By is { name: "Jan", "North": 100, "South": 200 }.
      // This structure doesn't map well to Pie unless we pick ONE series or FLATTEN it.
      // For now, Group Mode Pie falls back to default single series behavior (value_0) logic in `extractChartData`, 
      // or we just take the first series if dynamic. 
      // Current `extractChartData` produces simple list if no split col. If split col, it produces keys.
      // Pie chart is not suitable for split series.

      return (
        <PieChart {...CommonProps}>
           <Pie
              data={activeData}
              dataKey={isGroupMode && dynamicSeriesKeys ? dynamicSeriesKeys[0] : "value_0"}
              nameKey="name"
              name={seriesName}
              cx="50%"
              cy="50%"
              outerRadius={data.size.height / 3}
              fill={data.config.color}
              label={data.config.showLabels}
              {...animProps}
           >
             {activeData.map((entry: any, index: number) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={index === data.config.highlightIndex ? '#f2c94c' : seriesPalette[index % seriesPalette.length]} 
                  stroke={index === data.config.highlightIndex ? '#fff' : 'none'}
                  strokeWidth={index === data.config.highlightIndex ? 2 : 0}
                />
             ))}
           </Pie>
           <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [formatValue(v, format0), n]} />
           <Legend wrapperStyle={{ color: textColor }} />
        </PieChart>
      );
    }

    // Composed Chart for Bar and Line (allows mixing)
    return (
        <ComposedChart {...CommonProps}>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} />
            <XAxis dataKey="name" tick={{fontSize: 11, fill: textColor}} axisLine={false} tickLine={false} dy={10} />
            
            <YAxis 
                yAxisId="left" 
                tick={{fontSize: 11, fill: textColor}} 
                domain={[0, maxDataValues.left]} 
                axisLine={false} 
                tickLine={false} 
                dx={-10}
                tickFormatter={(val) => formatValue(val, axisFormatLeft)}
            />
            {hasRightAxis && (
                <YAxis 
                    yAxisId="right" 
                    orientation="right" 
                    tick={{fontSize: 11, fill: textColor}} 
                    domain={[0, maxDataValues.right]} 
                    axisLine={false} 
                    tickLine={false} 
                    dx={10} 
                    tickFormatter={(val) => formatValue(val, axisFormatRight)}
                />
            )}
            
            <Tooltip contentStyle={tooltipStyle} cursor={{fill: darkMode ? '#404040' : '#f7f7f5'}} formatter={tooltipFormatter} />
            <Legend wrapperStyle={{ color: textColor }} />
            
            {/* GROUP MODE SERIES */}
            {isGroupMode && (
                dynamicSeriesKeys ? (
                    // Multiple Split Series
                    dynamicSeriesKeys.map((key, index) => {
                        const color = seriesPalette[index % seriesPalette.length];
                        if (data.config.type === 'bar') {
                            return (
                                <Bar 
                                    key={key}
                                    dataKey={key}
                                    name={key}
                                    fill={color}
                                    yAxisId="left"
                                    radius={data.config.stacked ? [0,0,0,0] : [4, 4, 0, 0]}
                                    stackId={data.config.stacked ? 'a' : undefined}
                                    {...animProps}
                                >
                                    {data.config.showLabels && (
                                        <LabelList 
                                            dataKey={key}
                                            position={data.config.stacked ? "inside" : "top"} 
                                            style={{ fill: data.config.stacked ? '#fff' : textColor, fontSize: 10, fontWeight: 500 }} 
                                            formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                        />
                                    )}
                                </Bar>
                            );
                        } else {
                            return (
                                <Line
                                    key={key}
                                    type="monotone"
                                    dataKey={key}
                                    name={key}
                                    stroke={color}
                                    yAxisId="left"
                                    strokeWidth={3}
                                    dot={{ r: 4, fill: '#fff', stroke: color, strokeWidth: 2 }}
                                    activeDot={{ r: 6, strokeWidth: 0 }}
                                    {...animProps}
                                >
                                    {data.config.showLabels && (
                                        <LabelList 
                                            dataKey={key}
                                            position="top" 
                                            offset={10}
                                            style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                            formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                        />
                                    )}
                                </Line>
                            );
                        }
                    })
                ) : (
                    // Single Aggregate Series
                    data.config.type === 'bar' ? (
                        <Bar 
                            yAxisId="left"
                            dataKey="value_0"
                            name={getSeriesLabel(data.config.valueCol || '')}
                            fill={data.config.color}
                            radius={[4, 4, 0, 0]}
                            {...animProps}
                        >
                            {activeData.map((entry: any, i: number) => (
                                    <Cell 
                                        key={`cell-${i}`} 
                                        fill={i === data.config.highlightIndex ? '#f2c94c' : seriesPalette[0]} 
                                    />
                            ))}
                            {data.config.showLabels && (
                                    <LabelList 
                                        dataKey="value_0"
                                        position="top" 
                                        style={{ fill: textColor, fontSize: 10, fontWeight: 500 }} 
                                        formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                    />
                            )}
                        </Bar>
                    ) : (
                        <Line
                            yAxisId="left"
                            type="monotone"
                            dataKey="value_0"
                            name={getSeriesLabel(data.config.valueCol || '')}
                            stroke={data.config.color}
                            strokeWidth={3}
                            dot={{ r: 4, fill: '#fff', stroke: data.config.color, strokeWidth: 2 }}
                            activeDot={{ r: 6, strokeWidth: 0 }}
                            {...animProps}
                        >
                            {data.config.showLabels && (
                                    <LabelList 
                                        dataKey="value_0"
                                        position="top" 
                                        offset={10}
                                        style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                        formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                    />
                            )}
                        </Line>
                    )
                )
            )}

            {/* METRICS MODE SERIES (Multiple Series) */}
            {!isGroupMode && data.config.dataColumns.map((colId, index) => {
                const isRight = data.config.rightAxisColumns?.includes(colId);
                const axisId = isRight ? "right" : "left";
                const seriesType = data.config.seriesTypes?.[colId] || data.config.type;
                const stackId = (data.config.stacked && seriesType === 'bar') ? (isRight ? "b" : "a") : undefined;
                const color = seriesPalette[index % seriesPalette.length];
                const seriesFormat = getFormatForSeries(colId);

                if (seriesType === 'bar') {
                    return (
                        <Bar 
                            key={`${colId}-${index}`}
                            yAxisId={axisId}
                            dataKey={`value_${index}`} 
                            name={getSeriesLabel(colId)} 
                            fill={color} 
                            radius={data.config.stacked ? [0,0,0,0] : [4, 4, 0, 0]}
                            stackId={stackId}
                            {...animProps}
                        >
                            {/* Individual cell highlighting only for single-series charts usually, but kept for consistency */}
                            {data.config.dataColumns.length === 1 && activeData.map((entry: any, i: number) => (
                                <Cell 
                                    key={`cell-${i}`} 
                                    fill={i === data.config.highlightIndex ? '#f2c94c' : seriesPalette[0]} 
                                />
                            ))}
                            {data.config.showLabels && (
                                <LabelList 
                                    dataKey={`value_${index}`} 
                                    position={data.config.stacked ? "inside" : "top"} 
                                    style={{ fill: data.config.stacked ? '#fff' : textColor, fontSize: 10, fontWeight: 500 }} 
                                    formatter={(v: number) => formatValue(v, seriesFormat)}
                                />
                            )}
                        </Bar>
                    );
                } else {
                    return (
                        <Line 
                            key={`${colId}-${index}`}
                            yAxisId={axisId}
                            type="monotone" 
                            dataKey={`value_${index}`} 
                            name={getSeriesLabel(colId)}
                            stroke={color} 
                            strokeWidth={3}
                            dot={(props: any) => {
                                // Simple dot unless highlight
                                if (data.config.dataColumns.length === 1) {
                                    const isHighlighted = props.index === data.config.highlightIndex;
                                    return (
                                        <circle 
                                            cx={props.cx} cy={props.cy} r={isHighlighted ? 6 : 4} 
                                            fill={isHighlighted ? '#f2c94c' : '#fff'} 
                                            stroke={color}
                                            strokeWidth={2}
                                        />
                                    );
                                }
                                return <circle cx={props.cx} cy={props.cy} r={4} fill="#fff" stroke={color} strokeWidth={2} />;
                            }}
                            activeDot={{ r: 6, strokeWidth: 0 }}
                            {...animProps}
                        >
                             {data.config.showLabels && (
                                <LabelList 
                                    dataKey={`value_${index}`} 
                                    position="top" 
                                    offset={10}
                                    style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                    formatter={(v: number) => formatValue(v, seriesFormat)}
                                />
                            )}
                        </Line>
                    );
                }
            })}
        </ComposedChart>
    );
  };

  return (
    <div 
      id={`chart-${data.id}`}
      className={`absolute flex flex-col bg-white dark:bg-neutral-850 rounded-xl transition-shadow duration-200 overflow-hidden group border animate-scale-in
        ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-lg z-40'}
        ${isPendingDelete ? 'animate-delete-pulse' : ''}
      `}
      style={{ 
        left: data.position.x, 
        top: data.position.y,
        width: data.size.width,
        height: data.size.height,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
       <div 
        className="h-10 bg-transparent flex items-center justify-between px-3 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200">
          <GripHorizontal size={14} className="text-neutral-300 dark:text-neutral-600" />
          <span className="truncate max-w-[140px]">{data.title}</span>
        </div>
        {!isSetup && (
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button 
                    onClick={handleCopyImage} 
                    className="group/btn relative p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md text-neutral-400 dark:text-neutral-500 hover:text-neutral-600" 
                >
                    <Copy size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                        Copy to Clipboard
                    </span>
                </button>

                <div className="relative">
                    <button 
                        onClick={() => setShowDownloadMenu(!showDownloadMenu)} 
                        className={`group/btn relative p-1.5 rounded-md transition-colors flex items-center gap-0.5 ${showDownloadMenu ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}
                    >
                        <Download size={14} />
                        <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                            Download
                        </span>
                    </button>
                    {showDownloadMenu && (
                        <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowDownloadMenu(false)} />
                        <div className="absolute top-full right-0 mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl z-50 w-36 flex flex-col py-1">
                            <button 
                                onClick={handleDownloadImage} 
                                className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full"
                            >
                                <ImageIcon size={14} /> PNG Image
                            </button>
                            <button 
                                onClick={handleDownloadVideo} 
                                className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full"
                            >
                                <Video size={14} /> WebM Video
                            </button>
                        </div>
                        </>
                    )}
                </div>

                <button onClick={() => setPlaybackKey(k => k + 1)} className="group/btn relative p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md text-neutral-400 dark:text-neutral-500 hover:text-neutral-600">
                    <Play size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                        Replay
                    </span>
                </button>
                <button onClick={() => setShowConfig(!showConfig)} className={`group/btn relative p-1.5 rounded-md transition-colors ${showConfig ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}>
                    <Settings2 size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                        Settings
                    </span>
                </button>
                <button onClick={() => onDelete(data.id)} className="group/btn relative p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-neutral-400 hover:text-red-500 rounded-md">
                    <Trash2 size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                        Delete
                    </span>
                </button>
            </div>
        )}
        {isSetup && (
            <button onClick={() => onDelete(data.id)} className="group/btn relative p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 rounded-md">
                <X size={14} />
                <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                    Close
                </span>
            </button>
        )}
      </div>

      <div className="flex-1 relative bg-white dark:bg-neutral-850">
         
         {isSetup && (
             <div ref={setupPanelRef} className="absolute inset-0 z-50 overflow-hidden">
                <ChartConfigPanel 
                    config={tempConfig}
                    headers={headers}
                    onChange={handleConfigChange}
                    isSetupMode={true}
                    onConfirm={handleSetupConfirm}
                    onCancel={() => onDelete(data.id)}
                    palette={palette}
                    onAddCustomColor={onAddCustomColor}
                />
             </div>
         )}

         {exporting && (
            <div className="absolute inset-0 z-50 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm flex flex-col items-center justify-center text-teal-600 dark:text-teal-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-xs font-semibold tracking-wide">RENDERING VIDEO... {progress}%</span>
                <div className="w-48 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full mt-3 overflow-hidden">
                    <div className="h-full bg-teal-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                </div>
            </div>
         )}

         <div ref={chartAreaRef} className="w-full h-full bg-white dark:bg-neutral-850 px-4 pb-4 pt-0">
            <ResponsiveContainer width="100%" height="100%">
                {renderChart() || <div className="flex items-center justify-center h-full text-neutral-400 text-sm">No data selected</div>}
            </ResponsiveContainer>
         </div>

         {showConfig && !isSetup && (
             <div 
                ref={settingsPanelRef}
                className="absolute top-0 right-0 bottom-0 w-72 z-20 shadow-2xl border-l border-neutral-200 dark:border-neutral-700"
             >
                 <ChartConfigPanel 
                    config={data.config}
                    headers={headers}
                    onChange={handleConfigChange}
                    onClose={() => setShowConfig(false)}
                    isSetupMode={false}
                    palette={palette}
                    onAddCustomColor={onAddCustomColor}
                 />
             </div>
         )}
      </div>
      
      <div 
        className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-20 flex items-center justify-center"
        onMouseDown={(e) => {
            e.stopPropagation();
            if (onHistorySave) onHistorySave();
            setResizing({ startX: e.clientX, startY: e.clientY, startW: data.size.width, startH: data.size.height });
        }}
      >
          <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
      </div>
    </div>
  );
};