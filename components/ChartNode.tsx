import React, { useState, useRef, useEffect, useMemo } from 'react';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import { ChartData, SheetData } from '../types';
import { extractChartData } from '../utils/chartHelpers';
import { CHART_COLORS } from '../constants';
import { GripHorizontal, Trash2, Settings2, X, Download, Video, Play, Copy, Image as ImageIcon, ChevronDown, Loader2 } from 'lucide-react';
import html2canvas from 'html2canvas';

interface ChartNodeProps {
  data: ChartData;
  sourceSheet?: SheetData;
  scale: number;
  onUpdate: (id: string, newData: ChartData) => void;
  onDelete: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  darkMode?: boolean;
}

export const ChartNode: React.FC<ChartNodeProps> = ({ data, sourceSheet, scale, onUpdate, onDelete, onMouseDown, darkMode }) => {
  const [showConfig, setShowConfig] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [overrideData, setOverrideData] = useState<any[] | null>(null);
  
  // This ref targets ONLY the chart visual area, ensuring overlays like config are not captured
  const chartAreaRef = useRef<HTMLDivElement>(null);
  
  const [playbackKey, setPlaybackKey] = useState(0); // to force re-render for animation

  // Resize Logic
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);

  const processedData = useMemo(() => {
    if (!sourceSheet) return [];
    return extractChartData(sourceSheet, data.config.labelColumn, data.config.dataColumns);
  }, [sourceSheet, data.config]);

  // Calculate max value for stable axis during animation
  const maxDataValue = useMemo(() => {
    if (!processedData || processedData.length === 0) return 'auto';
    const max = Math.max(...processedData.map((d: any) => Number(d.value_0) || 0));
    if (max <= 0) return 'auto';
    return Math.ceil(max * 1.1);
  }, [processedData]);

  // Use overrideData during video export to manually drive animation
  const activeData = overrideData || processedData;
  // Disable internal Recharts animation during export so we can control it via data updates
  const isAnimationActive = !overrideData && data.config.animation;

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
         // Pre-calculate animation frames
         const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

         // 1. GENERATE FRAMES (Buffering)
         for (let i = 0; i <= TOTAL_FRAMES; i++) {
             const progressPct = i / TOTAL_FRAMES;
             const eased = easeOut(progressPct);

             const frameData = finalData.map((item: any) => {
                 const newItem: any = { ...item };
                 Object.keys(newItem).forEach(k => {
                     if (k.startsWith('value_') && typeof newItem[k] === 'number') {
                         newItem[k] = newItem[k] * eased;
                     }
                 });
                 return newItem;
             });

             setOverrideData(frameData);

             // Wait for React to paint
             await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

             const frame = await html2canvas(element, {
                 backgroundColor: darkMode ? '#262626' : '#ffffff',
                 scale: 2, // High DPI capture for quality
                 logging: false,
                 useCORS: true
             });
             
             frames.push(frame);
             setProgress(Math.round((i / TOTAL_FRAMES) * 50)); // First 50%
         }

         // Add hold frames at the end
         const holdFrames = 30; // 0.5s hold
         const lastFrame = frames[frames.length - 1];
         for(let j=0; j<holdFrames; j++) {
             frames.push(lastFrame);
         }

         // 2. RECORD STREAM (Playback)
         const recordCanvas = document.createElement('canvas');
         recordCanvas.width = frames[0].width;
         recordCanvas.height = frames[0].height;
         const ctx = recordCanvas.getContext('2d');
         
         if (!ctx) throw new Error("No canvas context");

         // Capture stream from the recording canvas
         const stream = recordCanvas.captureStream(FPS);
         const mimeType = MediaRecorder.isTypeSupported("video/webm; codecs=vp9") 
            ? "video/webm; codecs=vp9" 
            : "video/webm";

         const mediaRecorder = new MediaRecorder(stream, { 
            mimeType, 
            videoBitsPerSecond: 8000000 // 8 Mbps
         });
         
         const chunks: Blob[] = [];
         mediaRecorder.ondataavailable = (e) => {
             if (e.data.size > 0) chunks.push(e.data);
         };

         mediaRecorder.start();

         for (let i = 0; i < frames.length; i++) {
             ctx.drawImage(frames[i], 0, 0);
             // Wait for 1 frame duration
             await new Promise(r => setTimeout(r, 1000/FPS));
             setProgress(50 + Math.round((i / frames.length) * 50)); // Last 50%
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
      key: playbackKey, // force remount for animation
      margin: { top: 20, right: 20, left: 20, bottom: 20 }
    };

    const animProps = {
        isAnimationActive: isAnimationActive,
        animationDuration: 1500,
        animationEasing: 'ease-out' as const
    };

    const textColor = darkMode ? '#d4d4d4' : '#666';
    const gridColor = darkMode ? '#404040' : '#f0f0f0';
    const tooltipStyle = {
        backgroundColor: darkMode ? '#1f1f1f' : '#fff',
        border: `1px solid ${darkMode ? '#404040' : '#ccc'}`,
        color: darkMode ? '#fff' : '#000'
    };

    if (data.config.type === 'pie') {
      return (
        <PieChart {...CommonProps}>
           <Pie
              data={activeData}
              dataKey="value_0"
              nameKey="name"
              cx="50%"
              cy="50%"
              outerRadius={data.size.height / 3}
              fill={data.config.color}
              label
              {...animProps}
           >
             {activeData.map((entry: any, index: number) => (
                <Cell 
                  key={`cell-${index}`} 
                  fill={index === data.config.highlightIndex ? '#FFD700' : CHART_COLORS[index % CHART_COLORS.length]} 
                  stroke={index === data.config.highlightIndex ? '#000' : 'none'}
                  strokeWidth={index === data.config.highlightIndex ? 2 : 0}
                />
             ))}
           </Pie>
           <Tooltip contentStyle={tooltipStyle} />
           <Legend wrapperStyle={{ color: textColor }} />
        </PieChart>
      );
    }

    if (data.config.type === 'bar') {
        return (
            <BarChart {...CommonProps}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="name" tick={{fontSize: 12, fill: textColor}} />
                <YAxis tick={{fontSize: 12, fill: textColor}} domain={[0, maxDataValue]} />
                <Tooltip contentStyle={tooltipStyle} cursor={{fill: darkMode ? '#404040' : '#f9f9f9'}} />
                <Legend wrapperStyle={{ color: textColor }} />
                <Bar dataKey="value_0" fill={data.config.color} {...animProps}>
                    {activeData.map((entry: any, index: number) => (
                        <Cell 
                            key={`cell-${index}`} 
                            fill={index === data.config.highlightIndex ? '#FFD700' : data.config.color} 
                        />
                    ))}
                </Bar>
            </BarChart>
        );
    }

    if (data.config.type === 'line') {
        return (
            <LineChart {...CommonProps}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                <XAxis dataKey="name" tick={{fontSize: 12, fill: textColor}} />
                <YAxis tick={{fontSize: 12, fill: textColor}} domain={[0, maxDataValue]} />
                <Tooltip contentStyle={tooltipStyle} />
                <Legend wrapperStyle={{ color: textColor }} />
                <Line 
                    type="monotone" 
                    dataKey="value_0" 
                    stroke={data.config.color} 
                    strokeWidth={3}
                    dot={(props: any) => {
                        const isHighlighted = props.index === data.config.highlightIndex;
                        return (
                            <circle 
                                cx={props.cx} cy={props.cy} r={isHighlighted ? 8 : 4} 
                                fill={isHighlighted ? '#FFD700' : data.config.color} 
                                stroke={isHighlighted ? '#000' : 'none'}
                            />
                        );
                    }}
                    activeDot={{ r: 8 }}
                    {...animProps}
                />
            </LineChart>
        );
    }
    
    return null;
  };

  return (
    <div 
      className="absolute flex flex-col bg-white dark:bg-neutral-850 rounded-xl shadow-xl overflow-hidden group ring-1 ring-neutral-200 dark:ring-neutral-700"
      style={{ 
        left: data.position.x, 
        top: data.position.y,
        width: data.size.width,
        height: data.size.height,
        zIndex: 40
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
       {/* Header */}
       <div 
        className="h-8 bg-neutral-50 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between px-2 cursor-grab active:cursor-grabbing select-none"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300">
          <GripHorizontal size={14} />
          <span className="truncate max-w-[120px]">{data.title}</span>
        </div>
        <div className="flex items-center gap-1">
            <button 
                onClick={handleCopyImage} 
                className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded text-neutral-500 dark:text-neutral-400" 
                title="Copy to Clipboard"
            >
                <Copy size={14} />
            </button>

            {/* Download Menu */}
            <div className="relative">
                <button 
                    onClick={() => setShowDownloadMenu(!showDownloadMenu)} 
                    className={`p-1 rounded transition-colors flex items-center gap-0.5 ${showDownloadMenu ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200' : 'hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400'}`}
                    title="Download"
                >
                    <Download size={14} />
                    <ChevronDown size={10} />
                </button>
                {showDownloadMenu && (
                    <>
                    <div className="fixed inset-0 z-40" onClick={() => setShowDownloadMenu(false)} />
                    <div className="absolute top-full right-0 mt-1 bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-600 rounded-md z-50 w-32 flex flex-col py-1">
                        <button 
                            onClick={handleDownloadImage} 
                            className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full"
                        >
                            <ImageIcon size={12} /> Image (PNG)
                        </button>
                        <button 
                            onClick={handleDownloadVideo} 
                            className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full"
                        >
                            <Video size={12} /> Video (WebM)
                        </button>
                    </div>
                    </>
                )}
            </div>

            <button onClick={() => setPlaybackKey(k => k + 1)} className="p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded text-neutral-500 dark:text-neutral-400" title="Replay Animation">
                <Play size={14} />
            </button>
            <button onClick={() => setShowConfig(!showConfig)} className={`p-1 rounded transition-colors ${showConfig ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400'}`}>
                <Settings2 size={14} />
            </button>
            <button onClick={() => onDelete(data.id)} className="p-1 hover:bg-red-100 dark:hover:bg-red-900/30 text-neutral-400 hover:text-red-500 rounded">
                <Trash2 size={14} />
            </button>
        </div>
      </div>

      {/* Content Wrapper */}
      <div className="flex-1 relative bg-white dark:bg-neutral-850">
         {/* Overlay for Video Generation */}
         {exporting && (
            <div className="absolute inset-0 z-50 bg-white/80 dark:bg-neutral-900/80 backdrop-blur-sm flex flex-col items-center justify-center text-teal-600 dark:text-teal-400">
                <Loader2 size={32} className="animate-spin mb-2" />
                <span className="text-xs font-medium">Rendering Video... {progress}%</span>
                <div className="w-32 h-1 bg-neutral-200 dark:bg-neutral-700 rounded-full mt-2 overflow-hidden">
                    <div className="h-full bg-teal-500 transition-all duration-300" style={{ width: `${progress}%` }} />
                </div>
            </div>
         )}

         {/* Chart Capture Area - Isolated from Config Panel */}
         <div ref={chartAreaRef} className="w-full h-full bg-white dark:bg-neutral-850 p-4">
            <ResponsiveContainer width="100%" height="100%">
                {renderChart() || <div/>}
            </ResponsiveContainer>
         </div>

         {/* Config Panel Overlay - Sibling to capture area, will NOT be captured */}
         {showConfig && (
             <div className="absolute top-0 right-0 bottom-0 w-64 bg-white/95 dark:bg-neutral-800/95 backdrop-blur shadow-xl border-l border-neutral-200 dark:border-neutral-700 p-4 overflow-y-auto z-20 text-sm">
                 <div className="flex justify-between items-center mb-4">
                     <h3 className="font-bold text-neutral-800 dark:text-neutral-200">Chart Config</h3>
                     <button onClick={() => setShowConfig(false)} className="text-neutral-500 dark:text-neutral-400"><X size={16} /></button>
                 </div>

                 <div className="space-y-4">
                     <div>
                         <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Chart Type</label>
                         <div className="flex gap-2">
                             {['bar', 'line', 'pie'].map(t => (
                                 <button 
                                    key={t}
                                    onClick={() => onUpdate(data.id, { ...data, config: { ...data.config, type: t as any } })}
                                    className={`flex-1 py-1 text-xs font-medium rounded capitalize border ${data.config.type === t ? 'bg-teal-50 dark:bg-teal-900/50 border-teal-500 text-teal-700 dark:text-teal-300' : 'bg-white dark:bg-neutral-700 border-neutral-200 dark:border-neutral-600 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-600'}`}
                                 >
                                     {t}
                                 </button>
                             ))}
                         </div>
                     </div>

                     <div>
                        <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Data Source (Columns)</label>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <span className="text-[10px] text-neutral-400">Labels (X)</span>
                                <input 
                                    className="w-full border rounded px-2 py-1 text-xs bg-white dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100" 
                                    value={data.config.labelColumn}
                                    onChange={(e) => onUpdate(data.id, { ...data, config: { ...data.config, labelColumn: e.target.value.toUpperCase() } })}
                                />
                            </div>
                            <div>
                                <span className="text-[10px] text-neutral-400">Values (Y)</span>
                                <input 
                                    className="w-full border rounded px-2 py-1 text-xs bg-white dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100" 
                                    value={data.config.dataColumns[0]}
                                    onChange={(e) => onUpdate(data.id, { ...data, config: { ...data.config, dataColumns: [e.target.value.toUpperCase()] } })}
                                />
                            </div>
                        </div>
                     </div>

                     <div>
                         <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Style</label>
                         <div className="flex flex-wrap gap-2 mb-2">
                             {CHART_COLORS.map(c => (
                                 <button
                                    key={c}
                                    className={`w-5 h-5 rounded-full border ${data.config.color === c ? 'ring-2 ring-offset-1 ring-neutral-400 dark:ring-neutral-500' : 'border-transparent'}`}
                                    style={{ backgroundColor: c }}
                                    onClick={() => onUpdate(data.id, { ...data, config: { ...data.config, color: c } })}
                                 />
                             ))}
                         </div>
                     </div>

                     <div>
                         <label className="block text-xs text-neutral-500 dark:text-neutral-400 mb-1">Highlight Index (0-{processedData.length - 1})</label>
                         <input 
                            type="number" 
                            className="w-full border rounded px-2 py-1 text-xs bg-white dark:bg-neutral-700 border-neutral-300 dark:border-neutral-600 text-neutral-900 dark:text-neutral-100"
                            value={data.config.highlightIndex}
                            onChange={(e) => onUpdate(data.id, { ...data, config: { ...data.config, highlightIndex: parseInt(e.target.value) } })}
                         />
                     </div>
                     
                     <div className="flex items-center gap-2">
                         <input 
                            type="checkbox" 
                            id="anim-toggle"
                            checked={data.config.animation}
                            onChange={(e) => onUpdate(data.id, { ...data, config: { ...data.config, animation: e.target.checked } })}
                         />
                         <label htmlFor="anim-toggle" className="text-xs text-neutral-700 dark:text-neutral-300">Enable Animation</label>
                     </div>
                 </div>
             </div>
         )}
      </div>
      
      <div 
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-20"
        onMouseDown={(e) => {
            e.stopPropagation();
            setResizing({ startX: e.clientX, startY: e.clientY, startW: data.size.width, startH: data.size.height });
        }}
      />
    </div>
  );
};