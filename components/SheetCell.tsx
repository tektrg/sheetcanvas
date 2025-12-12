
import React, { useRef, useState, useMemo, useEffect } from 'react';
import { CellData } from '../types';
import { formatValue } from '../utils/formatting';
import { parseCellId, getCellId } from '../utils/formulas';
import { CELL_HEIGHT } from '../constants';

// Interactive Sparkline Component
const Sparkline = ({ value, width = 100, height = 34 }: { value: string, width?: number, height?: number }) => {
    const [hover, setHover] = useState<{ svgX: number, domX: number, value: number, label: string } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const points = useMemo(() => {
        try {
            const parsed = JSON.parse(value);
            if (!Array.isArray(parsed) || parsed.length === 0) return null;
            // Handle legacy number[] and new {value, label}[]
            return parsed.map((p, i) => {
                if (typeof p === 'number') return { value: p, label: '' };
                return p;
            });
        } catch { return null; }
    }, [value]);

    if (!points || points.length === 0) return null;

    const values = points.map((p: any) => p.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    
    // We add padding to height for stroke
    const padding = 4;
    const effectiveHeight = height - (padding * 2);

    const pathD = points.length > 1 ? points.map((p: any, i: number) => {
        const x = (i / (points.length - 1)) * width;
        const y = height - padding - ((p.value - min) / range) * effectiveHeight; 
        return `${x},${y}`;
    }).join(' L ') : '';

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current || points.length < 2) return;
        
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const domWidth = rect.width;
        
        const totalPoints = points.length - 1;
        // Calculate index based on rendered DOM width, not SVG coordinate width
        const index = Math.min(totalPoints, Math.max(0, Math.round((mouseX / domWidth) * totalPoints)));
        
        const point = points[index];
        
        // svgX is for the circle element inside SVG (uses viewBox coords)
        const svgX = (index / totalPoints) * width;
        // domX is for the tooltip element in HTML (uses pixel coords)
        const domX = (index / totalPoints) * domWidth;

        setHover({
            svgX,
            domX,
            value: point.value,
            label: point.label
        });
    };

    return (
        <div ref={containerRef} className="relative w-full h-full group" onMouseMove={handleMouseMove} onMouseLeave={() => setHover(null)}>
             <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible" preserveAspectRatio="none">
                 <path d={`M ${pathD}`} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" className="text-neutral-500 dark:text-neutral-400" />
                 {hover && (
                     <circle 
                        cx={hover.svgX} 
                        cy={height - padding - ((hover.value - min) / range) * effectiveHeight} 
                        r="3" 
                        className="fill-teal-500 stroke-white dark:stroke-neutral-800" 
                        strokeWidth="1.5" 
                     />
                 )}
             </svg>
             {hover && (
                 <div 
                    className="absolute z-50 bg-neutral-900/90 backdrop-blur text-white text-[10px] rounded px-2 py-1 shadow-xl pointer-events-none flex flex-col items-center whitespace-nowrap border border-white/10"
                    style={{ 
                        left: hover.domX, 
                        bottom: '100%', 
                        marginBottom: '4px',
                        transform: 'translateX(-50%)'
                    }}
                 >
                     <span className="font-semibold">{hover.value.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                     {hover.label && <span className="text-neutral-400 text-[9px] mt-0.5 border-t border-white/10 pt-0.5 w-full text-center">{hover.label}</span>}
                     <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-neutral-900/90"></div>
                 </div>
             )}
        </div>
    );
};

interface SheetCellProps {
  cellId: string;
  cellData: CellData | undefined;
  width: number;
  height: number;
  style: React.CSSProperties;
  isActive: boolean;
  isSelected: boolean;
  isReferenced: boolean;
  isEditing: boolean;
  isReadOnly: boolean;
  isHeaderRow: boolean;
  isGrandTotal: boolean;
  
  // Data Analysis Props (for visuals)
  colMax: number;
  rowMax: number;
  colMin: number;
  rowMin: number;

  // Edit State passed from parent if active
  editingRaw: string | null;
  onEditChange: (val: string) => void;
  onCommit: (nextCellId?: string | null, refocus?: boolean) => void;
  setSuggestions: (s: string[]) => void;
  suggestions: string[];
  selectedSuggestionIndex: number;

  // Events
  onMouseDown: (e: React.MouseEvent, id: string) => void;
  onMouseEnter: (id: string) => void;
  onDoubleClick: (id: string) => void;

  // Autocomplete Callbacks
  onSuggestionSelect?: (suggestion: string) => void;
  setSelectedSuggestionIndex?: React.Dispatch<React.SetStateAction<number>>;
}

const SheetCellInternal: React.FC<SheetCellProps> = ({
  cellId,
  cellData,
  width,
  height,
  style,
  isActive,
  isSelected,
  isReferenced,
  isEditing,
  isReadOnly,
  isHeaderRow,
  isGrandTotal,
  colMax,
  rowMax,
  colMin,
  rowMin,
  editingRaw,
  onEditChange,
  onCommit,
  setSuggestions,
  suggestions,
  selectedSuggestionIndex,
  onMouseDown,
  onMouseEnter,
  onDoubleClick,
  onSuggestionSelect,
  setSelectedSuggestionIndex
}) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const prevValueRef = useRef(cellData?.value);
    const [shouldFlash, setShouldFlash] = useState(false);

    useEffect(() => {
        // Trigger flash if value changes (and isn't the first render)
        if (cellData?.value !== prevValueRef.current) {
            prevValueRef.current = cellData?.value;
            // Don't flash if user is currently editing this cell, avoiding distraction
            if (!isActive) {
                setShouldFlash(true);
                const timer = setTimeout(() => setShouldFlash(false), 600);
                return () => clearTimeout(timer);
            }
        }
    }, [cellData?.value, isActive]);

    // Visuals Logic
    const displayValue = formatValue(cellData?.value, cellData?.format);
    
    const showBar = cellData?.format?.visual === 'bar';
    const showBarRow = cellData?.format?.visual === 'bar-row';
    const showSparkline = cellData?.format?.visual === 'sparkline';
    let barSize = 0;
    
    if (showBar) {
        const val = parseFloat(String(cellData?.value));
        if (colMax > 0 && !isNaN(val)) barSize = Math.max(0, Math.min(100, (val / colMax) * 100));
    } else if (showBarRow) {
        const val = parseFloat(String(cellData?.value));
        if (rowMax > 0 && !isNaN(val)) barSize = Math.max(0, Math.min(100, (val / rowMax) * 100));
    }

    const showHeatmap = cellData?.format?.visual === 'heatmap';
    const showHeatmapRow = cellData?.format?.visual === 'heatmap-row';
    let heatmapColor = 'transparent';
    
    if (showHeatmap || showHeatmapRow) {
        const min = showHeatmap ? colMin : rowMin;
        const max = showHeatmap ? colMax : rowMax;
        const val = parseFloat(String(cellData?.value));
        if (!isNaN(val) && max !== min) {
            const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
            const opacity = 0.1 + (ratio * 0.5);
            
            const colorKey = cellData?.format?.heatmapColor || 'green';
            const baseColor = colorKey === 'red' ? '239, 68, 68' : (colorKey === 'yellow' ? '234, 179, 8' : '13, 148, 136');
            heatmapColor = `rgba(${baseColor}, ${opacity})`;
        }
    }

    return (
        <div 
           className={`absolute border-r border-b border-neutral-100 dark:border-neutral-800 text-[13px] flex items-center
             ${isActive ? 'z-20' : 'z-auto'} 
             ${!isActive && isSelected ? 'bg-teal-50/50 dark:bg-teal-900/20' : ''}
             ${isReferenced ? 'z-10 bg-purple-50 dark:bg-purple-900/20' : ''}
             ${!isActive && !isReferenced && !isSelected ? 
                (isHeaderRow || isGrandTotal
                    ? 'bg-neutral-50/30 dark:bg-neutral-800/30 font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800' 
                    : 'hover:bg-neutral-50/50 dark:hover:bg-neutral-800 bg-white dark:bg-neutral-850')
              : ''}
             ${isGrandTotal ? 'border-t border-t-neutral-300 dark:border-t-neutral-600' : ''}
             ${isReadOnly ? 'cursor-default' : 'cursor-text'}
             ${shouldFlash ? 'animate-cell-flash' : ''}
           `}
           style={{ ...style, width, height }}
           onMouseDown={(e) => { 
               if (isEditing && !isActive) return; // Should not happen if parent handles click
               onMouseDown(e, cellId);
           }}
           onMouseEnter={() => onMouseEnter(cellId)}
           onDoubleClick={(e) => {
               e.stopPropagation();
               onDoubleClick(cellId);
           }}
           >
         
         {isActive && <div className="absolute inset-0 border-2 border-teal-500 rounded-sm pointer-events-none z-30 shadow-sm" />}
         {(showHeatmap || showHeatmapRow) && !isActive && <div className="absolute inset-0 z-0 transition-colors duration-300 pointer-events-none" style={{ backgroundColor: heatmapColor }} />}
         {showBar && !isActive && <div className="absolute inset-y-0 left-0 bg-neutral-200 dark:bg-neutral-700 z-0 transition-all duration-300 pointer-events-none origin-left animate-scale-in-x" style={{ width: `${barSize}%` }} />}
         {showBarRow && !isActive && <div className="absolute bottom-0 left-0 right-0 bg-neutral-200 dark:bg-neutral-700 z-0 transition-all duration-300 pointer-events-none rounded-t-sm" style={{ height: `${barSize}%` }} />}
         {isReferenced && <div className="absolute inset-0 z-10 border-2 border-dashed border-purple-400 dark:border-purple-400/70 pointer-events-none rounded-sm" />}

         {isActive && isEditing && !isReadOnly ? (
           <>
             <input
               ref={inputRef}
               className="absolute inset-0 w-full h-full px-2 outline-none bg-white dark:bg-neutral-850 text-neutral-900 dark:text-neutral-100 z-30 rounded-sm !select-text cursor-text"
               value={editingRaw ?? ''}
               onChange={(e) => { 
                   onEditChange(e.target.value); 
               }}
               onBlur={() => onCommit(undefined, false)}
               onMouseDown={(e) => e.stopPropagation()}
               onDoubleClick={(e) => e.stopPropagation()}
               onKeyDown={(e) => {
                   // Suggestion Navigation
                   if (suggestions.length > 0) {
                       if (e.key === 'ArrowUp') {
                           e.preventDefault();
                           setSelectedSuggestionIndex?.(prev => (prev - 1 + suggestions.length) % suggestions.length);
                           return;
                       }
                       if (e.key === 'ArrowDown') {
                           e.preventDefault();
                           setSelectedSuggestionIndex?.(prev => (prev + 1) % suggestions.length);
                           return;
                       }
                       if (e.key === 'Enter' || e.key === 'Tab') {
                           e.preventDefault();
                           e.stopPropagation();
                           onSuggestionSelect?.(suggestions[selectedSuggestionIndex]);
                           return;
                       }
                   }

                   if (e.key === 'Enter') {
                       e.preventDefault();
                       e.stopPropagation();
                       const pos = parseCellId(cellId);
                       let nextId = null;
                       if (pos) {
                            const nextRow = pos.row + 1; // Default move down
                            nextId = getCellId(pos.col, nextRow);
                       }
                       onCommit(nextId, true);
                   }
                   if (e.key === 'Escape') {
                       e.preventDefault();
                       onCommit(null, true); 
                   }

                   // Navigation Keys Logic (Point Mode & Range Selection)
                   const isNavKey = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.key);
                   if (isNavKey) {
                        const raw = editingRaw || '';
                        const cursorAtEnd = (e.currentTarget.selectionStart || 0) === raw.length;

                        // Only activate if cursor is at the end
                        if (cursorAtEnd) {
                            // Check for Shift+Arrow to extend range
                            if (e.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                                 // Case 1: Extending existing range (ends in :B2)
                                 const rangeMatch = raw.match(/:([A-Z]+[0-9]+)$/i);
                                 // Case 2: Starting new range from cell (ends in A1)
                                 const cellMatch = raw.match(/([=+\-*/,(])([A-Z]+[0-9]+)$/i) || (raw.match(/^([A-Z]+[0-9]+)$/i) ? { 1: '', 2: raw } : null);

                                 if (rangeMatch || cellMatch) {
                                     e.preventDefault();
                                     e.stopPropagation();

                                     let baseId = '';
                                     let prefix = '';
                                     let isRange = false;

                                     if (rangeMatch) {
                                         baseId = rangeMatch[1].toUpperCase();
                                         prefix = raw.substring(0, raw.length - baseId.length);
                                         isRange = true;
                                     } else if (cellMatch) {
                                         // cellMatch[2] is the cell ID
                                         baseId = cellMatch[2]!.toUpperCase();
                                         prefix = raw; // We append, don't replace
                                         isRange = false;
                                     }

                                     const pos = parseCellId(baseId);
                                     if (pos) {
                                         let dRow = 0; 
                                         let dCol = 0;
                                         
                                         if (e.key === 'ArrowUp') dRow = -1;
                                         if (e.key === 'ArrowDown') dRow = 1;
                                         if (e.key === 'ArrowLeft') dCol = -1;
                                         if (e.key === 'ArrowRight') dCol = 1;
                                         
                                         const nextCol = Math.max(0, pos.col + dCol);
                                         const nextRow = Math.max(0, pos.row + dRow);
                                         const nextId = getCellId(nextCol, nextRow);
                                         
                                         if (isRange) {
                                             onEditChange(prefix + nextId);
                                         } else {
                                             onEditChange(prefix + ':' + nextId);
                                         }
                                     }
                                     return;
                                 }
                            }

                            // Standard Point Mode (Non-Shift)
                            const triggerRegex = /([=+\-*/,:(])\s*$/;
                            const refRegex = /([=+\-*/,:(])\s*([A-Z]+[0-9]+)$/i;
                            
                            const isTrigger = triggerRegex.test(raw);
                            const refMatch = raw.match(refRegex);
                            
                            if (isTrigger || refMatch) {
                                 e.preventDefault();
                                 e.stopPropagation();
                                 
                                 let baseId = cellId; 
                                 let prefix = raw; 
                                 
                                 if (refMatch) {
                                     // If we already have a ref, base is that ref
                                     baseId = refMatch[2].toUpperCase();
                                     prefix = raw.substring(0, raw.length - refMatch[2].length);
                                 } else if (isTrigger) {
                                     const rangeMatch = raw.match(/([A-Z]+[0-9]+)\s*:\s*$/i);
                                     if (rangeMatch) {
                                         baseId = rangeMatch[1].toUpperCase();
                                     }
                                 }
                                 
                                 const pos = parseCellId(baseId);
                                 if (pos) {
                                     let dRow = 0; 
                                     let dCol = 0;
                                     
                                     if (e.key === 'ArrowUp') dRow = -1;
                                     if (e.key === 'ArrowDown') dRow = 1;
                                     if (e.key === 'ArrowLeft') dCol = -1;
                                     if (e.key === 'ArrowRight') dCol = 1;
                                     if (e.key === 'Tab') dCol = e.shiftKey ? -1 : 1;
                                     
                                     const nextCol = Math.max(0, pos.col + dCol);
                                     const nextRow = Math.max(0, pos.row + dRow);
                                     const nextId = getCellId(nextCol, nextRow);
                                     
                                     onEditChange(prefix + nextId);
                                 }
                                 return; 
                            }
                        }
                   }

                   // Standard Tab (if not consumed by Point Mode)
                   if (e.key === 'Tab') {
                        e.preventDefault();
                        e.stopPropagation();
                        const pos = parseCellId(cellId);
                        let nextId = null;
                        if (pos) {
                            const nextCol = pos.col + 1;
                            nextId = getCellId(nextCol, pos.row);
                        }
                        onCommit(nextId, true);
                   }
               }}
               autoFocus
             />
             {suggestions.length > 0 && (
               <div className="absolute top-full left-0 min-w-[140px] bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 z-50 max-h-32 overflow-y-auto flex flex-col py-1">
                 {suggestions.map((s, i) => (
                   <div 
                      key={s} 
                      className={`px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between ${i === selectedSuggestionIndex ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-300' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`} 
                      onMouseDown={(e) => { 
                          e.preventDefault(); // Prevent blur
                          e.stopPropagation(); // Prevent propagation to cell
                          onSuggestionSelect?.(s);
                      }}
                   >
                     <span className="font-medium">{s}</span>
                     <span className="text-[10px] text-neutral-400 uppercase">Func</span>
                   </div>
                 ))}
               </div>
             )}
           </>
         ) : (
           <div 
                className={`relative z-10 px-2 w-full whitespace-nowrap text-inherit text-neutral-700 dark:text-neutral-300 flex items-center h-full
                    ${showSparkline && !isActive ? 'overflow-visible' : 'overflow-hidden pointer-events-none'}
                `}
            >
             {showSparkline && !isActive && cellData?.value ? (
                 <Sparkline value={String(cellData.value)} width={width} height={height} />
             ) : (
                <span className="leading-none">{isActive ? (isEditing ? (cellData?.raw || '') : displayValue) : displayValue}</span>
             )}
           </div>
         )}
      </div>
    );
};

export const SheetCell = React.memo(SheetCellInternal);
