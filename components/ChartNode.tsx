import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  ComposedChart, Line, Bar, Area, PieChart, Pie, Cell, Scatter, Treemap,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList
} from 'recharts';
import { ChartData, SheetData, ChartType, ChartConfig, CellFormat } from '../types';
import { extractChartData, getSheetHeaders } from '../utils/chartHelpers';
import { computeChartAdvisories } from '../utils/chartDefaults';
import { formatValue } from '../utils/formatting';
import { getCellId } from '../utils/formulas';
import { ChartColorSettings } from '../types';
import { buildMonoRamp, buildSeriesPalette, getChartPrimaryColor, getEffectiveChartPalette, getEffectiveChartScheme } from '../utils/chartColorSchemes';
import { GitBranch, GripHorizontal, Trash2, Settings2, X, Download, Video, Play, Copy, Image as ImageIcon, Loader2, MoreHorizontal, BarChart3, AlertTriangle } from 'lucide-react';
import html2canvas from 'html2canvas'; // video export only; image copy/download use snapDOM below
import { copyElementAsImage, downloadElementAsImage } from '../utils/elementCapture';
import { ChartConfigPanel } from './ChartConfigPanel';
import { HeaderDropdownMenu } from './HeaderDropdownMenu';
import { SettingsPopover } from './SettingsPopover';
import { useStore } from '../store';
import {
  buildChartSeriesDisplayNames,
  getChartLabelIconDomain,
  getChartLabelIconUrl,
  getChartLegendVisibility,
  normalizeChartSeriesLabel,
} from '../utils/chartDisplay';
import { getBackendBaseUrl } from '../utils/backendApi';
import {
  buildGradientId,
  getAreaGradientStops,
  getChartVisualTheme,
} from '../utils/chartVisualTheme';

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
  onToast?: (message: string) => void;
  // When true, the chart renders inline inside a document (a markdown note):
  // it fills its parent, drops all canvas chrome (drag grip, toolbar, resize,
  // selection ring) and is non-interactive. Used by the MDX-lite <CanvasChart>.
  embedded?: boolean;
}

// Placeholder used only for the one render where the backing chart was just
// deleted from the store — lets every hook below keep running with a valid
// shape instead of branching, so hook order/count never changes. The actual
// null check (and null render) happens after all hooks have run.
const EMPTY_CHART_DATA: ChartData = {
  id: '',
  sourceSheetId: '',
  position: { x: 0, y: 0 },
  size: { width: 0, height: 0 },
  title: '',
  config: {
    labelColumn: '',
    dataColumns: [],
    color: '#000000',
    highlightIndex: -1,
    animation: false,
    type: 'bar',
  },
};

const readBlobAsDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
});

const loadFaviconDataUrl = async (domain: string) => {
    const res = await fetch(`${getBackendBaseUrl()}/api/favicon?domain=${encodeURIComponent(domain)}`);
    if (!res.ok) throw new Error(`Favicon fetch failed (${res.status})`);
    return readBlobAsDataUrl(await res.blob());
};

const getResolvedChartIconUrl = (rawLabel: string, faviconDataUrls: Record<string, string>) => {
    const domain = getChartLabelIconDomain(rawLabel);
    if (!domain) return null;
    return faviconDataUrls[domain] || getChartLabelIconUrl(rawLabel);
};

const CustomXAxisTick = ({ x, y, payload, fill, chartId, faviconDataUrls }: any) => {
    const rawLabel = String(payload.value || '');
    const displayLabel = normalizeChartSeriesLabel(rawLabel);
    const favicon = getResolvedChartIconUrl(rawLabel, faviconDataUrls || {});
    const clipId = `clip-axis-${chartId}-${payload.index}`;

    return (
        <g transform={`translate(${x},${y})`}>
            {favicon ? (
                <>
                    <defs>
                        <clipPath id={clipId}>
                            <rect x={-22} y={8} width={16} height={16} rx={3} ry={3} />
                        </clipPath>
                    </defs>
                    <image
                        x={-22}
                        y={8}
                        href={favicon}
                        width={16}
                        height={16}
                        clipPath={`url(#${clipId})`}
                        style={{ pointerEvents: 'none' }}
                    />
                    <text
                        x={-2}
                        y={0}
                        dy={21}
                        textAnchor="start"
                        fill={fill}
                        fontSize={11}
                    >
                        {displayLabel}
                    </text>
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
                    {displayLabel}
                </text>
            )}
        </g>
    );
};

const makeCompactLegendContent = (
    textColor: string,
    visible: boolean,
    rawLabelsByDataKey: Record<string, string> = {},
    faviconDataUrls: Record<string, string> = {},
) => ({ payload }: any) => {
    if (!visible || !payload?.length) return null;

    return (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 px-2 pt-2 text-[11px] font-medium leading-tight" style={{ color: textColor }}>
            {payload.map((entry: any, index: number) => {
                const dataKey = String(entry.dataKey || '');
                const rawLabel = rawLabelsByDataKey[dataKey] || String(entry.value || entry.dataKey || 'Series');
                const label = normalizeChartSeriesLabel(String(entry.value || rawLabel));
                const favicon = getResolvedChartIconUrl(rawLabel, faviconDataUrls);
                return (
                    <span key={`${entry.dataKey || entry.value}-${index}`} className="inline-flex min-w-0 max-w-[164px] items-center gap-1.5" title={String(entry.value || rawLabel)}>
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
                        {favicon && (
                            <img
                                src={favicon}
                                alt=""
                                className="h-3.5 w-3.5 flex-shrink-0 rounded-[3px]"
                                loading="lazy"
                                referrerPolicy="no-referrer"
                            />
                        )}
                        <span className="truncate">{label}</span>
                    </span>
                );
            })}
        </div>
    );
};

const makeCustomPieLabel = (
    chartId: string,
    fill: string,
    faviconDataUrls: Record<string, string>,
) => (props: any) => {
    const rawLabel = String(props.name || props.payload?.name || '');
    const label = normalizeChartSeriesLabel(rawLabel);
    const favicon = getResolvedChartIconUrl(rawLabel, faviconDataUrls);
    const textAnchor = favicon ? 'start' : props.textAnchor || 'start';
    const labelStartX = props.textAnchor === 'end' ? props.x - 26 : props.x - 10;
    const iconX = labelStartX;
    const textX = favicon ? labelStartX + 20 : props.x;
    const clipId = `clip-pie-label-${chartId}-${props.index}`;

    return (
        <g>
            {favicon && (
                <>
                    <defs>
                        <clipPath id={clipId}>
                            <rect x={iconX} y={props.y - 8} width={16} height={16} rx={3} ry={3} />
                        </clipPath>
                    </defs>
                    <image
                        x={iconX}
                        y={props.y - 8}
                        href={favicon}
                        width={16}
                        height={16}
                        clipPath={`url(#${clipId})`}
                        style={{ pointerEvents: 'none' }}
                    />
                </>
            )}
            <text
                x={textX}
                y={props.y}
                fill={fill}
                fontSize={10}
                fontWeight={500}
                textAnchor={textAnchor}
                dominantBaseline="central"
            >
                {label}
            </text>
        </g>
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

const areChartNodePropsEqual = (prev: ChartNodeProps, next: ChartNodeProps) => (
  prev.id === next.id &&
  prev.darkMode === next.darkMode &&
  prev.isPendingDelete === next.isPendingDelete &&
  prev.recentColors === next.recentColors &&
  prev.colorSettings === next.colorSettings &&
  prev.onColorSettingsChange === next.onColorSettingsChange &&
  prev.onAddCustomColor === next.onAddCustomColor &&
  prev.hasLineage === next.hasLineage &&
  prev.lineageVisible === next.lineageVisible &&
  prev.onToggleLineage === next.onToggleLineage &&
  prev.onMouseDown === next.onMouseDown &&
  prev.onToast === next.onToast &&
  prev.embedded === next.embedded
);

const ChartNodeComponent: React.FC<ChartNodeProps> = ({
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
  onToast,
  embedded = false,
}) => {
  // Kept separate from `data` below: reading this directly from the store
  // means the value can flip to undefined (e.g. the chart was just deleted)
  // on a render where every hook after the old early-return still has to
  // run — bailing out here would call fewer hooks than the previous render
  // and crash the whole app ("Rendered fewer hooks than expected").
  const rawData = useStore(state => state.charts[id]);
  const data = rawData ?? EMPTY_CHART_DATA;
  const selected = useStore(state => state.selectedIds.has(id));
  const updateChart = useStore(state => state.updateChart);
  const deleteChart = useStore(state => state.deleteChart);
  const saveSnapshot = useStore(state => state.saveSnapshot);
  
  const scaleRef = useRef(useStore.getState().transform.scale);
  useEffect(() => {
    return useStore.subscribe((state) => {
      scaleRef.current = state.transform.scale;
    });
  }, []);
  
  const isLowZoom = useStore(state => state.transform.scale < 0.35);
  
  const sourceSheet = useStore(state => data ? state.sheets[data.sourceSheetId] : undefined);
  const isSourceRefreshing = useStore(state => state.refreshingIds.has(id));

  const [showConfig, setShowConfig] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const downloadBtnRef = useRef<HTMLButtonElement>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overrideData, setOverrideData] = useState<any[] | null>(null);
  const [faviconDataUrls, setFaviconDataUrls] = useState<Record<string, string>>({});
  const faviconDataUrlsRef = useRef<Record<string, string>>({});
  
  // Local state for setup mode
  const [tempConfig, setTempConfig] = useState<ChartConfig>(data?.config || {} as any);

  const chartAreaRef = useRef<HTMLDivElement>(null);
  const nodeRef = useRef<HTMLDivElement>(null);

  const [playbackKey, setPlaybackKey] = useState(0); 
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const isSetup = data.setupRequired;

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

  // F4/F7/A6 advisories for the settings panel (non-blocking). Computed here
  // because this component holds the source sheet.
  const editAdvisories = useMemo(
    () => (sourceSheet ? computeChartAdvisories(sourceSheet, data.config) : []),
    [sourceSheet, data.config]
  );
  const setupAdvisories = useMemo(
    () => (sourceSheet && tempConfig?.labelColumn ? computeChartAdvisories(sourceSheet, tempConfig) : []),
    [sourceSheet, tempConfig]
  );

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

  const legendRawLabelsByDataKey = useMemo<Record<string, string>>(() => {
      if (data.config.mode === 'group') {
          if (dynamicSeriesKeys) {
              return dynamicSeriesKeys.reduce<Record<string, string>>((labels, key) => {
                  labels[key] = key;
                  return labels;
              }, {});
          }
          return {
              value_0: getSeriesRawLabel(data.config.valueCol || ''),
          };
      }

      return data.config.dataColumns.reduce<Record<string, string>>((labels, colId, index) => {
          labels[`value_${index}`] = getSeriesRawLabel(colId);
          return labels;
      }, {});
  }, [data.config, dynamicSeriesKeys, headers]);

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

  const chartFaviconDomains = useMemo(() => {
      const domains = new Set<string>();
      Object.keys(legendRawLabelsByDataKey).forEach(dataKey => {
          const label = legendRawLabelsByDataKey[dataKey];
          const domain = getChartLabelIconDomain(label);
          if (domain) domains.add(domain);
      });
      activeData.forEach((row: any) => {
          const domain = getChartLabelIconDomain(String(row?.name || ''));
          if (domain) domains.add(domain);
      });
      return Array.from(domains).sort();
  }, [activeData, legendRawLabelsByDataKey]);

  useEffect(() => {
      faviconDataUrlsRef.current = faviconDataUrls;
  }, [faviconDataUrls]);

  const ensureFaviconDataUrls = async () => {
      const missingDomains = chartFaviconDomains.filter(domain => !faviconDataUrlsRef.current[domain]);
      if (missingDomains.length === 0) return;

      const loadedEntries = await Promise.all(
          missingDomains.map(async (domain) => {
              try {
                  return [domain, await loadFaviconDataUrl(domain)] as const;
              } catch (err) {
                  console.warn('Favicon proxy failed', domain, err);
                  return null;
              }
          }),
      );
      const nextEntries = loadedEntries.filter((entry): entry is readonly [string, string] => !!entry);
      if (nextEntries.length === 0) return;

      const nextUrls = nextEntries.reduce<Record<string, string>>((urls, [domain, dataUrl]) => {
          urls[domain] = dataUrl;
          return urls;
      }, {});
      faviconDataUrlsRef.current = { ...faviconDataUrlsRef.current, ...nextUrls };
      setFaviconDataUrls(faviconDataUrlsRef.current);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  };

  useEffect(() => {
      void ensureFaviconDataUrls();
  }, [chartFaviconDomains.join('|')]);

  const activePalette = useMemo(
      () => getEffectiveChartPalette(data.config, colorSettings, !!darkMode),
      [data.config, colorSettings, darkMode],
  );
  const primaryColor = useMemo(
      () => getChartPrimaryColor(data.config, activePalette),
      [data.config, activePalette],
  );
  const activeScheme = useMemo(
      () => getEffectiveChartScheme(data.config, colorSettings),
      [data.config, colorSettings],
  );
  // How many colored segments this chart draws — the mono ramp is fit to this count
  // so it spans the full dark→light range regardless of series count.
  const monoRampCount = useMemo(() => {
      const type = data.config.type;
      if (type === 'treemap') return Math.min(16, Math.max(1, activeData.length));
      if (type === 'pie') return Math.max(1, activeData.length);
      if (data.config.mode === 'group') return dynamicSeriesKeys ? Math.max(1, dynamicSeriesKeys.length) : 1;
      return Math.max(1, data.config.dataColumns.length);
  }, [data.config.type, data.config.mode, data.config.dataColumns, dynamicSeriesKeys, activeData]);
  const seriesPalette = useMemo(() => {
      // Mono renders as a smooth dark→light ramp for fill-by-index charts (bar, area,
      // pie, treemap). Lines/scatter keep the high-contrast alternating order so
      // adjacent series stay distinguishable (no separators to help there).
      const rampEligible = data.config.type !== 'line' && data.config.type !== 'scatter';
      if (activeScheme === 'mono' && rampEligible) {
          return buildMonoRamp(primaryColor, !!darkMode, monoRampCount);
      }
      return buildSeriesPalette(primaryColor, activePalette);
  }, [activeScheme, data.config.type, primaryColor, activePalette, darkMode, monoRampCount]);
  const chartTheme = useMemo(() => getChartVisualTheme(!!darkMode, selected), [darkMode, selected]);

  useEffect(() => {
    if (!resizing) return;
    let rafId: number | null = null;
    let lastPos: { x: number; y: number } | null = null;

    const commitResize = () => {
      if (!lastPos) return;
      const dx = (lastPos.x - resizing.startX) / scaleRef.current;
      const dy = (lastPos.y - resizing.startY) / scaleRef.current;
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
  }, [resizing, data.id, updateChart]);

  const handleCopyChartId = async () => {
    try {
        await navigator.clipboard.writeText(data.id);
        onToast?.('Chart ID copied to clipboard');
    } catch (err) {
        console.error('Copy chart ID failed', err);
        onToast?.('Failed to copy chart ID');
    }
    setShowMoreMenu(false);
  };

  const chartCaptureBackground = darkMode ? '#262626' : '#ffffff';

  const handleCopyImage = async () => {
    if (!chartAreaRef.current) return;
    setExporting(true);
    try {
        await ensureFaviconDataUrls();
        await copyElementAsImage(chartAreaRef.current, { backgroundColor: chartCaptureBackground });
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
      await ensureFaviconDataUrls();
      await downloadElementAsImage(chartAreaRef.current, data.title, { backgroundColor: chartCaptureBackground });
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
         await ensureFaviconDataUrls();
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
    const displayName = normalizeChartSeriesLabel(String(name || ''));
    const favicon = getResolvedChartIconUrl(String(name || ''), faviconDataUrls);
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
                y={y + height / 2 - 19}
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
        {favicon && width > 72 && height > 44 && (
                 <image
                    x={x + width / 2 - 12}
                    y={y + height / 2 - 19}
                    width={24}
                    height={24}
                    href={favicon}
                    clipPath={`url(#${clipId})`}
                    style={{ pointerEvents: 'none' }}
                 />
        )}
        {width > 40 && height > 24 && (
            <text
                x={x + width / 2}
                y={y + height / 2 + (favicon && width > 72 && height > 44 ? 14 : 0)}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#fff"
                fontSize={Math.min(13, width / 7)}
                fontWeight={600}
                style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)', pointerEvents: 'none' }}
            >
                {displayName}
            </text>
        )}
        {width > 60 && height > 40 && payload && payload.value && (
          <text
            x={x + width / 2}
            y={y + height / 2 + (favicon && width > 72 && height > 44 ? 28 : 14)}
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

    const textColor = chartTheme.textColor;
    const tooltipStyle = chartTheme.tooltipStyle;

    const isGroupMode = data.config.mode === 'group';
    // Hairline dividers between mono stacked segments so touching shades stay separable.
    const monoStackSeparator = !!data.config.stacked && activeScheme === 'mono';
    const stackSeparatorColor = darkMode ? '#262626' : '#ffffff';
    const hasRightAxis = !isGroupMode && data.config.dataColumns.some(col => data.config.rightAxisColumns?.includes(col));
    const isScatter = data.config.type === 'scatter';
    const showLegend = getChartLegendVisibility({
        labels: chartLegendLabels,
        chartWidth: data.size.width,
        chartHeight: data.size.height,
    }) === 'visible';
    const compactLegendContent = makeCompactLegendContent(textColor, showLegend, legendRawLabelsByDataKey, faviconDataUrls);
    const showValueLabels = !!data.config.showLabels;

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
      const showPieLegend = activeData.length > 1;
      const pieOuterRadius = Math.max(32, Math.min(data.size.width, data.size.height - 88) / 3);

      return (
        <PieChart {...CommonProps} margin={{ top: 16, right: 20, left: 20, bottom: showPieLegend ? 56 : 20 }}>
           <Pie
              data={activeData}
              dataKey={isGroupMode && dynamicSeriesKeys ? dynamicSeriesKeys[0] : "value_0"}
              nameKey="name"
              name={seriesName}
              cx="50%"
              cy={showPieLegend ? "44%" : "50%"}
              outerRadius={pieOuterRadius}
              fill={primaryColor}
              label={showValueLabels && !showPieLegend ? makeCustomPieLabel(data.id, textColor, faviconDataUrls) : false}
              {...animProps}
           >
             {activeData.map((entry: any, index: number) => (
                <Cell
                  key={`cell-${index}`}
                  fill={index === data.config.highlightIndex ? '#f2c94c' : seriesPalette[index % seriesPalette.length]}
                  stroke={index === data.config.highlightIndex ? '#fff' : chartTheme.pieStroke}
                  strokeWidth={index === data.config.highlightIndex ? 2 : chartTheme.pieStrokeWidth}
                />
             ))}
           </Pie>
           <Tooltip contentStyle={tooltipStyle} formatter={(v: number, n: string) => [formatValue(v, format0), n]} />
           {showPieLegend && (
             <Legend
               verticalAlign="bottom"
               align="center"
               content={makeCompactLegendContent(textColor, true, {}, faviconDataUrls)}
             />
           )}
        </PieChart>
      );
    }

    // --- Prepare ComposedChart Children & Defs (To avoid wrapping components in Fragments) ---
    const chartChildren: React.ReactNode[] = [];
    const defs: React.ReactNode[] = [];

    // 1. Grid & Axes
    chartChildren.push(
        <CartesianGrid
            strokeDasharray="4 6"
            stroke={chartTheme.gridColor}
            vertical={false}
            key="grid"
        />
    );
    
    // X Axis Configuration
    if (isScatter) {
        chartChildren.push(
            <XAxis 
                type="number" 
                dataKey="x_raw" 
                tick={<CustomXAxisTick fill={textColor} chartId={data.id} faviconDataUrls={faviconDataUrls} />}
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
                tick={<CustomXAxisTick fill={textColor} chartId={data.id} faviconDataUrls={faviconDataUrls} />}
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
    chartChildren.push(<Tooltip contentStyle={tooltipStyle} cursor={{fill: chartTheme.cursorFill}} formatter={tooltipFormatter} labelFormatter={tooltipLabelFormatter} key="tooltip" />);
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
                            radius={data.config.stacked ? chartTheme.stackedBarRadius : chartTheme.barRadius}
                            stackId={data.config.stacked ? 'a' : undefined}
                            stroke={monoStackSeparator ? stackSeparatorColor : undefined}
                            strokeWidth={monoStackSeparator ? 1 : 0}
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
                    const gradId = buildGradientId(data.id, 'area-grad', key);
                    const areaGradient = getAreaGradientStops(color, !!darkMode);
                    defs.push(
                        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" key={gradId}>
                            <stop offset="5%" stopColor={areaGradient.startColor} stopOpacity={areaGradient.startOpacity}/>
                            <stop offset="95%" stopColor={areaGradient.endColor} stopOpacity={areaGradient.endOpacity}/>
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
                            strokeWidth={chartTheme.lineStrokeWidth}
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
                            strokeWidth={chartTheme.lineStrokeWidth}
                            dot={{ ...chartTheme.dotStyle, stroke: color }}
                            activeDot={chartTheme.activeDotStyle}
                            {...animProps}
                            isAnimationActive={showValueLabels ? false : animProps.isAnimationActive}
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
                        radius={chartTheme.barRadius}
                        {...animProps}
                    >
                        {activeData.map((entry: any, i: number) => (
                                <Cell
                                    key={`cell-${i}`}
                                    fill={i === data.config.highlightIndex ? '#f2c94c' : color}
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
                const gradId = buildGradientId(data.id, 'area-grad', key);
                const areaGradient = getAreaGradientStops(color, !!darkMode);
                defs.push(
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" key={gradId}>
                        <stop offset="5%" stopColor={areaGradient.startColor} stopOpacity={areaGradient.startOpacity}/>
                        <stop offset="95%" stopColor={areaGradient.endColor} stopOpacity={areaGradient.endOpacity}/>
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
                        strokeWidth={chartTheme.lineStrokeWidth}
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
                        strokeWidth={chartTheme.lineStrokeWidth}
                        dot={{ ...chartTheme.dotStyle, stroke: color }}
                        activeDot={chartTheme.activeDotStyle}
                        {...animProps}
                        isAnimationActive={showValueLabels ? false : animProps.isAnimationActive}
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
                        radius={data.config.stacked ? chartTheme.stackedBarRadius : chartTheme.barRadius}
                        stackId={stackId}
                        stroke={monoStackSeparator && stackId ? stackSeparatorColor : undefined}
                        strokeWidth={monoStackSeparator && stackId ? 1 : 0}
                        {...animProps}
                    >
                        {data.config.dataColumns.length === 1 && activeData.map((entry: any, i: number) => (
                            <Cell
                                key={`cell-${i}`}
                                fill={i === data.config.highlightIndex ? '#f2c94c' : color}
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
                const gradId = buildGradientId(data.id, 'area-grad', key);
                const areaGradient = getAreaGradientStops(color, !!darkMode);
                defs.push(
                    <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" key={gradId}>
                        <stop offset="5%" stopColor={areaGradient.startColor} stopOpacity={areaGradient.startOpacity}/>
                        <stop offset="95%" stopColor={areaGradient.endColor} stopOpacity={areaGradient.endOpacity}/>
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
                        strokeWidth={chartTheme.lineStrokeWidth}
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
                        strokeWidth={chartTheme.lineStrokeWidth}
                        dot={(props: any) => {
                            if (data.config.dataColumns.length === 1) {
                                const isHighlighted = props.index === data.config.highlightIndex;
                                return (
                                    <circle 
                                        cx={props.cx} cy={props.cy} r={isHighlighted ? 6 : 4} 
                                        fill={isHighlighted ? '#f2c94c' : chartTheme.dotStyle.fill}
                                        stroke={color}
                                        strokeWidth={chartTheme.dotStyle.strokeWidth}
                                    />
                                );
                            }
                            return <circle cx={props.cx} cy={props.cy} r={chartTheme.dotStyle.r} fill={chartTheme.dotStyle.fill} stroke={color} strokeWidth={chartTheme.dotStyle.strokeWidth} />;
                        }}
                        activeDot={chartTheme.activeDotStyle}
                        {...animProps}
                        isAnimationActive={showValueLabels ? false : animProps.isAnimationActive}
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

  // Safe to bail now: every hook above has already run this render, so
  // returning null here (e.g. right after the chart was deleted) can't
  // desync the hook count on the next render.
  if (!rawData) return null;

  if (isLowZoom && !embedded) {
    return (
      <div
        id={`chart-${data.id}`}
        className={`absolute flex flex-col rounded-xl transition-shadow duration-200 overflow-hidden group border select-none pointer-events-auto ${chartTheme.chartFrameClassName}
          ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-lg z-40'}
          ${isPendingDelete ? 'animate-delete-pulse' : ''}
        `}
        style={{
          left: data.position.x,
          top: data.position.y,
          width: data.size.width,
          height: data.size.height,
          ...(selected ? chartTheme.selectedFrameStyle : chartTheme.frameStyle),
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onMouseDown(e);
        }}
      >
        <div className={`relative h-10 flex items-center px-3 select-none ${chartTheme.headerClassName}`}>
          <GripHorizontal size={14} className="text-neutral-300 dark:text-neutral-600 mr-2 flex-shrink-0" />
          <span className="text-sm font-semibold text-neutral-600 dark:text-neutral-350 truncate">{data.title}</span>
        </div>
        <div className="flex-1 p-4 flex flex-col justify-center items-center bg-white dark:bg-neutral-850 gap-1 opacity-50">
          <BarChart3 className="text-neutral-400 dark:text-neutral-500" size={36} />
          <span className="text-xs text-neutral-400 dark:text-neutral-500 font-medium uppercase tracking-wider">
            {data.config.type} Chart
          </span>
        </div>
        {!embedded && (
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
        )}
      </div>
    );
  }

  return (
    <div
      ref={nodeRef}
      id={`chart-${data.id}`}
      className={embedded
        ? `relative flex flex-col rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-700 w-full h-full ${chartTheme.chartFrameClassName}`
        : `absolute flex flex-col rounded-xl transition-shadow duration-200 overflow-hidden group border animate-scale-in ${chartTheme.chartFrameClassName}
        ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-lg z-40'}
        ${isPendingDelete ? 'animate-delete-pulse' : ''}
      `}
      style={embedded ? chartTheme.frameStyle : {
        left: data.position.x,
        top: data.position.y,
        width: data.size.width,
        height: data.size.height,
        ...(selected ? chartTheme.selectedFrameStyle : chartTheme.frameStyle),
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
       <div
        className={`relative flex items-center select-none ${embedded ? 'px-4 pt-3 pb-1' : 'h-10 px-3 cursor-grab active:cursor-grabbing'} ${chartTheme.headerClassName}`}
        onMouseDown={embedded ? undefined : onMouseDown}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 text-sm font-medium text-neutral-700 dark:text-neutral-200">
          {!embedded && <GripHorizontal size={14} className="text-neutral-300 dark:text-neutral-600 shrink-0" />}
          <span className="truncate min-w-0" title={data.title}>{data.title}</span>
          {data.refreshWarnings && data.refreshWarnings.length > 0 && (
            <AlertTriangle
              size={14}
              className="shrink-0 text-rose-500 dark:text-rose-400"
              aria-label="Source data changed on last refresh"
              title={`Source data changed on last refresh:\n${data.refreshWarnings.join('\n')}`}
            />
          )}
          {isSourceRefreshing && (
            <Loader2 size={13} className="shrink-0 animate-spin text-teal-500 dark:text-teal-400" aria-label="Refreshing from source" />
          )}
        </div>
        {!embedded && !isSetup && (
            <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 p-1 rounded-lg bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto ${(showDownloadMenu || showMoreMenu) ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
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
                        ref={downloadBtnRef}
                        onClick={() => setShowDownloadMenu(!showDownloadMenu)}
                        className={`group/btn relative p-1.5 rounded-md transition-colors flex items-center gap-0.5 ${showDownloadMenu ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}
                    >
                        <Download size={14} />
                        <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                            Download
                        </span>
                    </button>
                    <HeaderDropdownMenu anchorRef={downloadBtnRef} isOpen={showDownloadMenu} onClose={() => setShowDownloadMenu(false)} width={144}>
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
                    </HeaderDropdownMenu>
                </div>

                <button
                    onClick={() => setShowConfig(!showConfig)}
                    className={`group/btn relative p-1.5 rounded-md transition-colors ${showConfig ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}
                >
                    <Settings2 size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                        Settings
                    </span>
                </button>

                <div className="relative">
                    <button
                        ref={moreBtnRef}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                        className={`group/btn relative p-1.5 rounded-md transition-colors ${showMoreMenu ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}
                    >
                        <MoreHorizontal size={14} />
                        <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
                            More
                        </span>
                    </button>
                    <HeaderDropdownMenu anchorRef={moreBtnRef} isOpen={showMoreMenu} onClose={() => setShowMoreMenu(false)} width={160}>
                        {hasLineage && (
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowMoreMenu(false);
                                    onToggleLineage?.(data.id);
                                }}
                                className={`px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-2 w-full ${lineageVisible ? 'text-teal-600 dark:text-teal-400' : 'text-neutral-700 dark:text-neutral-200'}`}
                            >
                                <GitBranch size={14} /> Lineage
                            </button>
                        )}
                        <button
                            onClick={() => { setShowMoreMenu(false); setPlaybackKey(k => k + 1); }}
                            className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full"
                        >
                            <Play size={14} /> Replay
                        </button>
                        <button
                            onClick={() => { setShowMoreMenu(false); deleteChart(data.id); }}
                            className="px-3 py-2 text-xs text-left hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 flex items-center gap-2 w-full"
                        >
                            <Trash2 size={14} /> Delete
                        </button>
                        <button
                            onClick={handleCopyChartId}
                            title={`Copy chart ID: ${data.id}`}
                            className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full border-t border-neutral-100 dark:border-neutral-700"
                        >
                            <Copy size={14} className="shrink-0" />
                            <span className="truncate">ID: {data.id}</span>
                        </button>
                    </HeaderDropdownMenu>
                </div>
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

      <div className={`flex-1 relative ${chartTheme.bodyClassName}`}>

         {exporting && (
            <div className="absolute inset-0 z-50 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-sm flex flex-col items-center justify-center text-teal-600 dark:text-teal-400">
                <Loader2 size={32} className="animate-spin mb-3" />
                <span className="text-xs font-semibold tracking-wide">RENDERING VIDEO... {progress}%</span>
                <div className="w-48 h-1.5 bg-neutral-100 dark:bg-neutral-800 rounded-full mt-3 overflow-hidden">
                    <div className="h-full bg-teal-500 transition-all duration-300 ease-out" style={{ width: `${progress}%` }} />
                </div>
            </div>
         )}

         <div ref={chartAreaRef} className={`w-full h-full px-4 pb-4 pt-0 ${chartTheme.chartAreaClassName}`}>
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

      </div>

      {/* Setup config: popover beside node, guarded from accidental outside-click dismissal. */}
      {isSetup && !embedded && (
          <SettingsPopover anchorRef={nodeRef} isOpen={true} onClose={() => {}} dismissOnOutsideClick={false} width={300} darkMode={!!darkMode}>
              <ChartConfigPanel
                  config={tempConfig}
                  headers={headers}
                  advisories={setupAdvisories}
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
          </SettingsPopover>
      )}

      {/* Edit config: popover beside node, live-apply, closes on outside-click / Esc. */}
      {showConfig && !isSetup && !embedded && (
          <SettingsPopover anchorRef={nodeRef} isOpen={true} onClose={() => setShowConfig(false)} width={300} darkMode={!!darkMode}>
              <ChartConfigPanel
                  config={data.config}
                  headers={headers}
                  advisories={editAdvisories}
                  onChange={handleConfigChange}
                  onClose={() => setShowConfig(false)}
                  isSetupMode={false}
                  recentColors={recentColors}
                  colorSettings={colorSettings}
                  darkMode={!!darkMode}
                  onColorSettingsChange={onColorSettingsChange}
                  onAddCustomColor={onAddCustomColor}
              />
          </SettingsPopover>
      )}

      {!embedded && (
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
      )}
    </div>
  );
};

export const ChartNode = React.memo(ChartNodeComponent, areChartNodePropsEqual);
