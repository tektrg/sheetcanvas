import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  ComposedChart, Line, Bar, Area, PieChart, Pie, Cell, Scatter, Treemap,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts';
import { ChartData, SheetData, ChartType, ChartConfig, CellFormat } from '../types';
import { extractChartData, getSheetHeaders } from '../utils/chartHelpers';
import { formatValue } from '../utils/formatting';
import { getCellId } from '../utils/formulas';
import { ChartColorSettings } from '../types';
import { buildSeriesPalette, getChartPrimaryColor, getEffectiveChartPalette } from '../utils/chartColorSchemes';
import { GitBranch, GripHorizontal, Trash2, Settings2, X, Download, Video, Play, Copy, Image as ImageIcon, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { ChartConfigPanel } from './ChartConfigPanel';
import { useStore } from '../store';
import {
  buildChartSeriesDisplayNames,
  getChartLegendVisibility,
  normalizeChartSeriesLabel,
} from '../utils/chartDisplay';

interface ChartNodeProps {
  id: string;
  darkMode?: boolean;
  isPendingDelete?: boolean;
  recentColors: string[];
  colorSettings: ChartColorSettings;
  onColorSettingsChange: (updates: Partial<ChartColorSettings>) => void;
  onAddCustomColor?: (color: string) => void;
  hasLineage?: boolean;
  lineageVisible?: boolean;
  onToggleLineage?: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

const getFaviconUrl = (label: string) => {
    if (!label || typeof label !== 'string') return null;
    const cleanLabel = label.trim();
    if (cleanLabel.includes(' ')) return null; 
    
    // Check for domain-like structure
    // Must contain a dot, no spaces, and look like a domain/url
    // Exclude simple numbers that might look like 1.2
    if (/^[\d.,-]+$/.test(cleanLabel)) return null;

    const isUrl = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/.*)?$/i.test(cleanLabel);
    
    if (isUrl) {
        let domain = cleanLabel.replace(/^(https?:\/\/)/, '').split('/')[0];
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
    }
    return null;
};

const CustomXAxisTick = ({ x, y, payload, fill, chartId }: any) => {
    const favicon = getFaviconUrl(payload.value);
    const clipId = `clip-axis-${chartId}-${payload.index}`;

    return (
        <g transform={`translate(${x},${y})`}>
            {favicon ? (
                <>
                    <defs>
                        <clipPath id={clipId}>
                            <rect x={-8} y={8} width={16} height={16} rx={3} ry={3} />
                        </clipPath>
                    </defs>
                    <image 
                        x={-8} 
                        y={8} 
                        href={favicon} 
                        width={16} 
                        height={16} 
                        clipPath={`url(#${clipId})`}
                        style={{ pointerEvents: 'none' }}
                    />
                </>
            ) : (
                <text 
                    x={0} 
                    y={0} 
                    dy={10} 
                    textAnchor="middle" 
                    fill={fill} 
                    fontSize={11}
                >
                    {payload.value}
                </text>
            )}
        </g>
    );
};

const makeCompactLegendContent = (textColor: string, visible: boolean) => ({ payload }: any) => {
    if (!visible || !payload?.length) return null;

    return (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 pt-2 text-[11px] font-medium leading-tight" style={{ color: textColor }}>
            {payload.map((entry: any, index: number) => {
                const label = normalizeChartSeriesLabel(String(entry.value || entry.dataKey || 'Series'));
                return (
                    <span key={`${entry.dataKey || entry.value}-${index}`} className="inline-flex min-w-0 max-w-[132px] items-center gap-1.5" title={String(entry.value || '')}>
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                        <span className="truncate">{label}</span>
                    </span>
                );
            })}
        </div>
    );
};

const ChartLegendHint: React.FC<{ count: number; darkMode?: boolean }> = ({ count, darkMode }) => (
    <div className={`pointer-events-none absolute bottom-5 right-5 z-10 rounded-full px-2.5 py-1 text-[10px] font-medium shadow-sm ring-1 ${
        darkMode
            ? 'bg-neutral-900/80 text-neutral-300 ring-white/10'
            : 'bg-white/85 text-neutral-500 ring-black/10'
    }`}>
        {count} series · hover
    </div>
);

export const ChartNode: React.FC<ChartNodeProps> = ({
  id,
  darkMode,
  isPendingDelete,
  recentColors,
  colorSettings,
  onColorSettingsChange,
  onAddCustomColor,
  hasLineage,
  lineageVisible,
  onToggleLineage,
  onMouseDown,
}) => {
  const data = useStore(state => state.charts[id]);
  const selected = useStore(state => state.selectedIds.has(id));
  const scale = useStore(state => state.transform.scale);
  const updateChart = useStore(state => state.updateChart);
  const deleteChart = useStore(state => state.deleteChart);
  const saveSnapshot = useStore(state => state.saveSnapshot);
  
  const sourceSheet = useStore(state => data ? state.sheets[data.sourceSheetId] : undefined);

  const [showConfig, setShowConfig] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overrideData, setOverrideData] = useState<any[] | null>(null);
  
  // Local state for setup mode
  const [tempConfig, setTempConfig] = useState<ChartConfig>(data?.config || {} as any);

  const chartAreaRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const setupPanelRef = useRef<HTMLDivElement>(null);

  const [playbackKey, setPlaybackKey] = useState(0); 
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  if (!data) return null;
  const isSetup = data.setupRequired;

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
    return extractChartData(sourceSheet, data.config);
  }, [sourceSheet, data.config]);

  const dynamicSeriesKeys = useMemo(() => {
      if (data.config.mode === 'group' && data.config.seriesGroupCol && processedData.length > 0) {
          const keys = new Set<string>();
          processedData.forEach((row: any) => {
              Object.keys(row).forEach(k => {
                  if (k !== 'name' && k !== 'x_raw') keys.add(k);
              });
          });
          return Array.from(keys).sort();
      }
      return null;
  }, [processedData, data.config]);

  const headers = useMemo(() => sourceSheet ? getSheetHeaders(sourceSheet) : [], [sourceSheet]);

  const getSeriesRawLabel = (colId: string) => {
    if (data.config.mode === 'group') {
        if (data.config.seriesGroupCol) return colId;
        return `${data.config.operation || 'SUM'} of ${headers.find(h => h.id === data.config.valueCol)?.label || data.config.valueCol}`;
    }
    return headers.find(h => h.id === colId)?.label || `Column ${colId}`;
  };

  const seriesDisplayNames = useMemo(() => {
      const entries = data.config.mode === 'group' && dynamicSeriesKeys
          ? dynamicSeriesKeys.map(key => ({ key, label: key }))
          : data.config.dataColumns.map(colId => ({ key: colId, label: getSeriesRawLabel(colId) }));
      return {
          ...buildChartSeriesDisplayNames(entries),
          ...(data.config.seriesDisplayNames || {})
      };
  }, [data.config, dynamicSeriesKeys, headers]);

  const getSeriesLabel = (colId: string) => {
    return seriesDisplayNames[colId] || normalizeChartSeriesLabel(getSeriesRawLabel(colId));
  };

  const chartLegendLabels = useMemo(() => {
      if (data.config.mode === 'group') {
          return dynamicSeriesKeys
              ? dynamicSeriesKeys.map(getSeriesLabel)
              : [getSeriesLabel(data.config.valueCol || '')];
      }
      return data.config.dataColumns.map(getSeriesLabel);
  }, [data.config, dynamicSeriesKeys, seriesDisplayNames]);

  const getFormatForSeries = (colId: string) => {
      if (!sourceSheet) return undefined;
      const colIdx = headers.find(h => h.id === colId)?.index;
      if (colIdx === undefined) return undefined;
      const cellId = getCellId(colIdx, 1);
      return sourceSheet.cells[cellId]?.format;
  };

  const getAxisFormat = (axisId: 'left' | 'right') => {
      if (data.config.mode === 'group') {
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

  const axisFormatLeft = getAxisFormat('left');
  const axisFormatRight = getAxisFormat('right');

  const tooltipFormatter = (value: number, name: string, item: any) => {
    let format;
    if (data.config.mode === 'group') {
         if (data.config.valueCol) format = getFormatForSeries(data.config.valueCol);
    } else {
         // Try to find the series column based on dataKey which is usually value_Index
         if (typeof item.dataKey === 'string' && item.dataKey.startsWith('value_')) {
             const idx = parseInt(item.dataKey.split('_')[1], 10);
             const colId = data.config.dataColumns[idx];
             format = getFormatForSeries(colId);
         }
    }
    return [formatValue(value, format), name];
  };

  const tooltipLabelFormatter = (label: any, payload: any[]) => {
      if (payload && payload.length > 0 && payload[0].payload && payload[0].payload.name) {
          return payload[0].payload.name;
      }
      return label;
  };

  const handleConfigChange = (newConfig: ChartConfig) => {
      if (isSetup) {
          setTempConfig(newConfig);
      } else {
          saveSnapshot();
          updateChart(data.id, { config: newConfig });
      }
  };

  const handleSetupConfirm = () => {
      saveSnapshot();
      updateChart(data.id, {
          config: tempConfig,
          setupRequired: false
      });
  };

  const maxDataValues = useMemo(() => {
    if (!processedData || processedData.length === 0) return { left: 'auto', right: 'auto' };
    
    let maxLeft = 0;
    let maxRight = 0;

    processedData.forEach((row: any) => {
        let leftStack = 0;
        let rightStack = 0;
        let rowMaxLeft = 0;
        let rowMaxRight = 0;

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
            data.config.dataColumns.forEach((colId, i) => {
                const val = Number(row[`value_${i}`]) || 0;
                const isRight = data.config.rightAxisColumns?.includes(colId);
                const type = data.config.seriesTypes?.[colId] || data.config.type;
                const isStacked = data.config.stacked && (type === 'bar' || type === 'area');

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

    const formatMax = (m: number) => m <= 0 ? 'auto' : (m * 1.1);

    return {
        left: formatMax(maxLeft),
        right: formatMax(maxRight)
    };
  }, [processedData, data.config, dynamicSeriesKeys]);

  const activeData = overrideData || processedData;
  const isAnimationActive = !overrideData && data.config.animation;

  const activePalette = useMemo(
      () => getEffectiveChartPalette(data.config, colorSettings, !!darkMode),
      [data.config, colorSettings, darkMode],
  );
  const primaryColor = useMemo(
      () => getChartPrimaryColor(data.config, activePalette),
      [data.config, activePalette],
  );
  const seriesPalette = useMemo(() => {
      return buildSeriesPalette(primaryColor, activePalette);
  }, [primaryColor, activePalette]);

  useEffect(() => {
    if (!resizing) return;
    let rafId: number | null = null;
    let lastPos: { x: number; y: number } | null = null;

    const commitResize = () => {
      if (!lastPos) return;
      const dx = (lastPos.x - resizing.startX) / scale;
      const dy = (lastPos.y - resizing.startY) / scale;
      updateChart(data.id, {
        size: {
          width: Math.max(200, resizing.startW + dx),
          height: Math.max(200, resizing.startH + dy)
        }
      });
    };

    const scheduleCommit = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        commitResize();
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastPos = { x: e.clientX, y: e.clientY };
      scheduleCommit();
    };

    const handleMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      commitResize();
      setResizing(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [resizing, scale, data.id, updateChart]);

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

  // Custom Content for Treemap to support borderRadius, margin, and gradient
  const CustomTreemapContent = (props: any) => {
    const { x, y, width, height, index, payload, name, depth } = props;
    
    // Ignore root node (depth < 1) to prevent background coloring
    if (depth < 1) return null;

    const color = seriesPalette[index % seriesPalette.length];
    const favicon = getFaviconUrl(name);
    const clipId = `clip-tree-${id}-${index}`;
    
    // Safety check
    if (!width || !height) return null;

    return (
      <g>
        <defs>
          <linearGradient id={`grad-treemap-${id}-${index}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity={1} />
            <stop offset="100%" stopColor={color} stopOpacity={0.65} />
          </linearGradient>
          <clipPath id={clipId}>
             <rect 
                x={x + width / 2 - 12} 
                y={y + height / 2 - 12} 
                width={24} 
                height={24} 
                rx={4} 
                ry={4} 
             />
          </clipPath>
        </defs>
        <rect
          x={x + 2}
          y={y + 2}
          width={Math.max(0, width - 4)}
          height={Math.max(0, height - 4)}
          rx={6}
          ry={6}
          fill={`url(#grad-treemap-${id}-${index})`}
          stroke="none"
          className="transition-all duration-300 hover:brightness-110"
        />
        {favicon ? (
             width > 24 && height > 24 && (
                 <image
                    x={x + width / 2 - 12}
                    y={y + height / 2 - 12}
                    width={24}
                    height={24}
                    href={favicon}
                    clipPath={`url(#${clipId})`}
                    style={{ pointerEvents: 'none' }}
                 />
             )
        ) : (
            width > 40 && height > 24 && (
            <text
                x={x + width / 2}
                y={y + height / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#fff"
                fontSize={Math.min(13, width / 7)}
                fontWeight={600}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)', pointerEvents: 'none' }}
            >
                {name}
            </text>
            )
        )}
        {width > 60 && height > 40 && payload && payload.value && (
          <text
            x={x + width / 2}
            y={y + height / 2 + (favicon ? 20 : 14)}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="rgba(255,255,255,0.9)"
            fontSize={Math.min(10, width / 9)}
            style={{ pointerEvents: 'none' }}
          >
            {axisFormatLeft ? formatValue(payload.value, axisFormatLeft) : payload.value}
          </text>
        )}
      </g>
    );
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
    const hasRightAxis = !isGroupMode && data.config.dataColumns.some(col => data.config.rightAxisColumns?.includes(col));
    const isScatter = data.config.type === 'scatter';
    const showLegend = getChartLegendVisibility({
        labels: chartLegendLabels,
        chartWidth: data.size.width,
        chartHeight: data.size.height,
    }) === 'visible';
    const compactLegendContent = makeCompactLegendContent(textColor, showLegend);
    const effectiveSeriesCount = chartLegendLabels.length;
    const showValueLabels = !!data.config.showLabels && effectiveSeriesCount <= 1;

    if (data.config.type === 'treemap') {
        const dataKey = isGroupMode && dynamicSeriesKeys ? dynamicSeriesKeys[0] : "value_0";
        const format0 = isGroupMode 
            ? (data.config.valueCol ? getFormatForSeries(data.config.valueCol) : undefined)
            : getFormatForSeries(data.config.dataColumns[0]);

        // Pre-process data for Treemap aesthetics: Limit items and Sort
        const sortedData = [...activeData]
            .map(d => ({ ...d, size: Number(d[dataKey]) || 0 })) // Flatten size for Recharts
            .sort((a, b) => b.size - a.size)
            .slice(0, 16); // Limit to top 16 for aesthetics

        return (
            <ResponsiveContainer width="100%" height="100%">
                <Treemap
                    data={sortedData}
                    dataKey="size"
                    nameKey="name"
                    stroke="transparent"
                    fill="transparent"
                    content={<CustomTreemapContent />}
                    {...animProps}
                >
                    <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [formatValue(v, format0), n]} />
                </Treemap>
            </ResponsiveContainer>
        );
    }

    if (data.config.type === 'pie') {
      const format0 = isGroupMode
            ? (data.config.valueCol ? getFormatForSeries(data.config.valueCol) : undefined)
            : getFormatForSeries(data.config.dataColumns[0]);

      const seriesName = isGroupMode
            ? `${data.config.operation || 'SUM'} of ${data.config.valueCol}`
            : getSeriesLabel(data.config.dataColumns[0]);
      const showPieLegend = getChartLegendVisibility({
          labels: activeData.map((item: any) => normalizeChartSeriesLabel(String(item.name || ''))),
          chartWidth: data.size.width,
          chartHeight: data.size.height,
      }) === 'visible';

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
              fill={primaryColor}
              label={showValueLabels}
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
           {showPieLegend && <Legend content={makeCompactLegendContent(textColor, true)} />}
        </PieChart>
      );
    }

    // --- Prepare ComposedChart Children & Defs (To avoid wrapping components in Fragments) ---
    const chartChildren: React.ReactNode[] = [];
    const defs: React.ReactNode[] = [];

    // 1. Grid & Axes
    chartChildren.push(<CartesianGrid strokeDasharray="3 3" stroke={gridColor} vertical={false} key="grid" />);
    
    // X Axis Configuration
    if (isScatter) {
        chartChildren.push(
            <XAxis 
                type="number" 
                dataKey="x_raw" 
                tick={<CustomXAxisTick fill={textColor} chartId={data.id} />} 
                axisLine={false} 
                tickLine={false} 
                dy={10} 
                domain={['auto', 'auto']}
                key="xaxis" 
            />
        );
    } else {
        chartChildren.push(
            <XAxis 
                dataKey="name" 
                tick={<CustomXAxisTick fill={textColor} chartId={data.id} />} 
                axisLine={false} 
                tickLine={false} 
                dy={10} 
                key="xaxis" 
                interval="preserveStartEnd"
            />
        );
    }

    chartChildren.push(
        <YAxis 
            yAxisId="left" 
            tick={{fontSize: 11, fill: textColor}} 
            domain={[0, maxDataValues.left]} 
            axisLine={false} 
            tickLine={false} 
            dx={-10}
            tickFormatter={(val) => formatValue(val, axisFormatLeft)}
            key="yaxis-left"
        />
    );
    if (hasRightAxis) {
        chartChildren.push(
            <YAxis 
                yAxisId="right" 
                orientation="right" 
                tick={{fontSize: 11, fill: textColor}} 
                domain={[0, maxDataValues.right]} 
                axisLine={false} 
                tickLine={false} 
                dx={10} 
                tickFormatter={(val) => formatValue(val, axisFormatRight)}
                key="yaxis-right"
            />
        );
    }
    chartChildren.push(<Tooltip contentStyle={tooltipStyle} cursor={{fill: darkMode ? '#404040' : '#f7f7f5'}} formatter={tooltipFormatter} labelFormatter={tooltipLabelFormatter} key="tooltip" />);
    if (showLegend) {
        chartChildren.push(<Legend content={compactLegendContent} key="legend" />);
    }

    // 2. Series Rendering
    if (isGroupMode) {
        if (dynamicSeriesKeys) {
            dynamicSeriesKeys.forEach((key, index) => {
                const color = seriesPalette[index % seriesPalette.length];
                
                if (data.config.type === 'bar') {
                    chartChildren.push(
                        <Bar 
                            key={key}
                            dataKey={key}
                            name={getSeriesLabel(key)}
                            fill={color}
                            yAxisId="left"
                            radius={data.config.stacked ? [0,0,0,0] : [4, 4, 0, 0]}
                            stackId={data.config.stacked ? 'a' : undefined}
                            {...animProps}
                        >
                            {showValueLabels && (
                                <LabelList 
                                    dataKey={key}
                                    position={data.config.stacked ? "inside" : "top"} 
                                    fill={data.config.stacked ? '#fff' : textColor}
                                    fontSize={10}
                                    fontWeight={500}
                                    formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                />
                            )}
                        </Bar>
                    );
                } else if (data.config.type === 'area') {
                    const gradId = `grad-${data.id}-${String(key).replace(/[^a-zA-Z0-9]/g, '')}`;
                    defs.push(
                        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" key={gradId}>
                            <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                            <stop offset="95%" stopColor="#ffffff" stopOpacity={0.1}/>
                        </linearGradient>
                    );
                    chartChildren.push(
                        <Area
                            key={key}
                            type="monotone"
                            dataKey={key}
                            name={getSeriesLabel(key)}
                            stroke={color}
                            fill={`url(#${gradId})`}
                            yAxisId="left"
                            strokeWidth={2}
                            stackId={data.config.stacked ? 'a' : undefined}
                            {...animProps}
                        >
                            {showValueLabels && (
                                <LabelList 
                                    dataKey={key}
                                    position="top" 
                                    offset={10}
                                    style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                    formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                />
                            )}
                        </Area>
                    );
                } else if (data.config.type === 'scatter') {
                    chartChildren.push(
                        <Scatter
                            key={key}
                            name={getSeriesLabel(key)}
                            dataKey={key}
                            fill={color}
                            yAxisId="left"
                            {...animProps}
                        >
                            {showValueLabels && (
                                <LabelList 
                                    dataKey={key}
                                    position="top" 
                                    offset={10}
                                    style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                    formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                />
                            )}
                        </Scatter>
                    );
                } else {
                    chartChildren.push(
                        <Line
                            key={key}
                            type="monotone"
                            dataKey={key}
                            name={getSeriesLabel(key)}
                            stroke={color}
                            yAxisId="left"
                            strokeWidth={3}
                            dot={{ r: 4, fill: '#fff', stroke: color, strokeWidth: 2 }}
                            activeDot={{ r: 6, strokeWidth: 0 }}
                            {...animProps}
                        >
                            {showValueLabels && (
                                <LabelList 
                                    dataKey={key}
                                    position="top" 
                                    offset={10}
                                    fill={textColor}
                                    fontSize={10}
                                    fontWeight={500}
                                    formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                />
                            )}
                        </Line>
                    );
                }
            });
        } else {
            // Group Mode - Single Series (e.g. Sum of Value)
            const color = primaryColor;
            const key = "value_0";
            const name = getSeriesLabel(data.config.valueCol || '');

            if (data.config.type === 'bar') {
                chartChildren.push(
                    <Bar 
                        key={key}
                        yAxisId="left"
                        dataKey={key}
                        name={name}
                        fill={color}
                        radius={[4, 4, 0, 0]}
                        {...animProps}
                    >
                        {activeData.map((entry: any, i: number) => (
                                <Cell 
                                    key={`cell-${i}`} 
                                    fill={i === data.config.highlightIndex ? '#f2c94c' : seriesPalette[0]} 
                                />
                        ))}
                        {showValueLabels && (
                                <LabelList 
                                    dataKey={key}
                                    position="top" 
                                    fill={textColor}
                                    fontSize={10}
                                    fontWeight={500}
                                    formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                />
                        )}
                    </Bar>
                );
            } else if (data.config.type === 'area') {
                const gradId = `grad-${data.id}-val0`;
                defs.push(
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" key={gradId}>
                        <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#ffffff" stopOpacity={0.1}/>
                    </linearGradient>
                );
                chartChildren.push(
                    <Area
                        key={key}
                        yAxisId="left"
                        type="monotone"
                        dataKey={key}
                        name={name}
                        stroke={color}
                        fill={`url(#${gradId})`}
                        strokeWidth={2}
                        {...animProps}
                    >
                        {showValueLabels && (
                                <LabelList 
                                    dataKey={key}
                                    position="top" 
                                    offset={10}
                                    style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                    formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                />
                        )}
                    </Area>
                );
            } else if (data.config.type === 'scatter') {
                chartChildren.push(
                    <Scatter
                        key={key}
                        name={name}
                        dataKey={key}
                        fill={color}
                        yAxisId="left"
                        {...animProps}
                    >
                        {showValueLabels && (
                            <LabelList 
                                dataKey={key}
                                position="top" 
                                offset={10}
                                style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                formatter={(v: number) => formatValue(v, axisFormatLeft)}
                            />
                        )}
                    </Scatter>
                );
            } else {
                chartChildren.push(
                    <Line
                        key={key}
                        yAxisId="left"
                        type="monotone"
                        dataKey={key}
                        name={name}
                        stroke={color}
                        strokeWidth={3}
                        dot={{ r: 4, fill: '#fff', stroke: color, strokeWidth: 2 }}
                        activeDot={{ r: 6, strokeWidth: 0 }}
                        {...animProps}
                    >
                        {showValueLabels && (
                                <LabelList 
                                    dataKey={key}
                                    position="top" 
                                    offset={10}
                                    fill={textColor}
                                    fontSize={10}
                                    fontWeight={500}
                                    formatter={(v: number) => formatValue(v, axisFormatLeft)}
                                />
                        )}
                    </Line>
                );
            }
        }
    } else {
        // Metrics Mode
        data.config.dataColumns.forEach((colId, index) => {
            const isRight = data.config.rightAxisColumns?.includes(colId);
            const axisId = isRight ? "right" : "left";
            const seriesType = data.config.seriesTypes?.[colId] || data.config.type;
            const stackId = (data.config.stacked && (seriesType === 'bar' || seriesType === 'area')) ? (isRight ? "b" : "a") : undefined;
            const color = seriesPalette[index % seriesPalette.length];
            const seriesFormat = getFormatForSeries(colId);
            const key = `value_${index}`;
            const name = getSeriesLabel(colId);

            if (seriesType === 'bar') {
                chartChildren.push(
                    <Bar 
                        key={key}
                        yAxisId={axisId}
                        dataKey={key}
                        name={name}
                        fill={color}
                        radius={data.config.stacked ? [0,0,0,0] : [4, 4, 0, 0]}
                        stackId={stackId}
                        {...animProps}
                    >
                        {data.config.dataColumns.length === 1 && activeData.map((entry: any, i: number) => (
                            <Cell 
                                key={`cell-${i}`} 
                                fill={i === data.config.highlightIndex ? '#f2c94c' : seriesPalette[0]} 
                            />
                        ))}
                        {showValueLabels && (
                            <LabelList 
                                dataKey={key}
                                position={data.config.stacked ? "inside" : "top"} 
                                fill={data.config.stacked ? '#fff' : textColor}
                                fontSize={10}
                                fontWeight={500}
                                formatter={(v: number) => formatValue(v, seriesFormat)}
                            />
                        )}
                    </Bar>
                );
            } else if (seriesType === 'area') {
                const gradId = `grad-${data.id}-${index}`;
                defs.push(
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" key={gradId}>
                        <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#ffffff" stopOpacity={0.1}/>
                    </linearGradient>
                );
                chartChildren.push(
                    <Area
                        key={key}
                        yAxisId={axisId}
                        type="monotone"
                        dataKey={key}
                        name={name}
                        stroke={color}
                        fill={`url(#${gradId})`}
                        strokeWidth={2}
                        stackId={stackId}
                        {...animProps}
                    >
                        {showValueLabels && (
                            <LabelList 
                                dataKey={key}
                                position="top" 
                                offset={10}
                                style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                formatter={(v: number) => formatValue(v, seriesFormat)}
                            />
                        )}
                    </Area>
                );
            } else if (seriesType === 'scatter') {
                chartChildren.push(
                    <Scatter
                        key={key}
                        name={name}
                        dataKey={key}
                        fill={color}
                        yAxisId={axisId}
                        {...animProps}
                    >
                        {showValueLabels && (
                            <LabelList 
                                dataKey={key}
                                position="top" 
                                offset={10}
                                style={{ fill: textColor, fontSize: 10, fontWeight: 500 }}
                                formatter={(v: number) => formatValue(v, seriesFormat)}
                            />
                        )}
                    </Scatter>
                );
            } else {
                chartChildren.push(
                    <Line 
                        key={key}
                        yAxisId={axisId}
                        type="monotone" 
                        dataKey={key} 
                        name={name}
                        stroke={color} 
                        strokeWidth={3}
                        dot={(props: any) => {
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
                            {showValueLabels && (
                            <LabelList 
                                dataKey={key}
                                position="top" 
                                offset={10}
                                fill={textColor}
                                fontSize={10}
                                fontWeight={500}
                                formatter={(v: number) => formatValue(v, seriesFormat)}
                            />
                        )}
                    </Line>
                );
            }
        });
    }

    return (
        <ComposedChart {...CommonProps}>
            <defs>{defs}</defs>
            {chartChildren}
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
                {hasLineage && (
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleLineage?.(data.id);
                        }}
                        className={`group/btn relative p-1.5 rounded-md transition-colors ${lineageVisible ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500 hover:text-neutral-600'}`}
                    >
                        <GitBranch size={14} />
                        <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                            Lineage
                        </span>
                    </button>
                )}
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
                <button onClick={() => deleteChart(data.id)} className="group/btn relative p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 text-neutral-400 hover:text-red-500 rounded-md">
                    <Trash2 size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                        Delete
                    </span>
                </button>
            </div>
        )}
        {isSetup && (
            <button onClick={() => deleteChart(data.id)} className="group/btn relative p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 rounded-md">
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
	                    onCancel={() => deleteChart(data.id)}
	                    recentColors={recentColors}
	                    colorSettings={colorSettings}
	                    darkMode={!!darkMode}
	                    onColorSettingsChange={onColorSettingsChange}
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

         <div ref={chartAreaRef} className="w-full h-full px-4 pb-4 pt-0">
            <ResponsiveContainer width="100%" height="100%">
                {renderChart() || <div className="flex items-center justify-center h-full text-neutral-400 text-sm">No data selected</div>}
            </ResponsiveContainer>
            {!isSetup && data.config.type !== 'treemap' && !showConfig && chartLegendLabels.length > 1 && getChartLegendVisibility({
                labels: chartLegendLabels,
                chartWidth: data.size.width,
                chartHeight: data.size.height,
            }) === 'hidden' && (
                <ChartLegendHint count={chartLegendLabels.length} darkMode={darkMode} />
            )}
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
	                    recentColors={recentColors}
	                    colorSettings={colorSettings}
	                    darkMode={!!darkMode}
	                    onColorSettingsChange={onColorSettingsChange}
	                    onAddCustomColor={onAddCustomColor}
	                 />
             </div>
         )}
      </div>
      
      <div 
        className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize z-20 flex items-center justify-center"
        onMouseDown={(e) => {
            e.stopPropagation();
            saveSnapshot();
            setResizing({ startX: e.clientX, startY: e.clientY, startW: data.size.width, startH: data.size.height });
        }}
      >
          <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
      </div>
    </div>
  );
};
