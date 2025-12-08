

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SheetData, CellData, CellFormat, CellCoordinate, FilterCondition, SparklineConfig, SelectionContext } from '../types';
import { getCellId, parseCellId, computeSheet } from '../utils/formulas';
import { formatValue } from '../utils/formatting';
import { shiftFormula } from '../utils/formulaEngine';
import { parseClipboardData } from '../utils/clipboard';
import { getFilteredRows } from '../utils/dataAnalysis';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT, MIN_COL_WIDTH, MAX_IMPORT_ROWS, MAX_RENDER_ROWS } from '../constants';
import { GripHorizontal, Trash2, BarChart3, ChevronDown, MoreVertical, AlignLeft, AlignVerticalJustifyCenter, Hash, DollarSign, Percent, Type, Palette, Table, Settings2, X, Image as ImageIcon, Loader2, AlertCircle, Filter, TrendingUp, ArrowDownAZ, ArrowUpAZ, ArrowDown, ArrowUp, ArrowLeft, ArrowRight, Link, Calendar, ChevronRight, Code, Minimize2, Maximize2 } from 'lucide-react';
import { PivotConfigPanel } from './PivotConfigPanel';
import { SparklineConfigPanel } from './SparklineConfigPanel';
import { FilterPanel } from './FilterPanel';
import html2canvas from 'html2canvas';

interface SheetNodeProps {
  data: SheetData;
  sourceSheet?: SheetData; // Used if this is a pivot or sparkline table
  selected: boolean;
  scale: number;
  onUpdate: (id: string, newData: SheetData) => void;
  onDelete: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onAddChart?: (sheetId: string, defaultColIndex?: number, selectedCols?: number[]) => void;
  onAddPivot?: (sheetId: string, defaultColIndex?: number) => void;
  onAddSparkline?: (sheetId: string) => void;
  onConfigurePivot?: (sheetId: string) => void;
  onSelect?: () => void;
  onToast?: (message: string) => void;
  onHistorySave?: () => void;
  isPendingDelete?: boolean;
  onSelectionContextChange?: (ctx: SelectionContext) => void;
}

const SUPPORTED_FUNCTIONS = ['SUM', 'AVG', 'AV', 'MIN', 'MAX', 'AVERAGE'];

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

export const SheetNode: React.FC<SheetNodeProps> = ({ data, sourceSheet, selected, scale, onUpdate, onDelete, onMouseDown, onAddChart, onAddPivot, onAddSparkline, onConfigurePivot, onSelect, onToast, onHistorySave, isPendingDelete, onSelectionContextChange }) => {
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: CellCoordinate; end: CellCoordinate } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editingRaw, setEditingRaw] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInputValue, setTitleInputValue] = useState(data.title);

  const [activeStat, setActiveStat] = useState<'sum' | 'avg' | 'count' | 'min' | 'max'>('sum');
  const [showStatsMenu, setShowStatsMenu] = useState(false);

  const [headerMenuOpen, setHeaderMenuOpen] = useState<number | null>(null);
  const [rowMenuOpen, setRowMenuOpen] = useState<number | null>(null);
  
  const [dragRange, setDragRange] = useState<{
    startCell: string;
    currentCell: string;
    startIndex: number;
    endIndex: number;
  } | null>(null);

  const [colResizing, setColResizing] = useState<{ index: number; startX: number; startWidth: number } | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  
  // Config States
  const [showPivotConfig, setShowPivotConfig] = useState(false);
  const [showSparklineConfig, setShowSparklineConfig] = useState(false);
  
  // Filter Panel State
  const showFilterPanel = !!data.showFilterPanel;
  const [preselectedFilterCol, setPreselectedFilterCol] = useState<string | null>(null);
  
  // Export State
  const [isExporting, setIsExporting] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [resizing, setResizing] = useState<{
    type: 'right' | 'bottom' | 'corner';
    startX: number;
    startY: number;
    startCols: number;
    startRows: number;
  } | null>(null);

  const isPivot = !!data.pivotConfig;
  const isSparkline = !!data.sparklineConfig;
  const isSetup = !!data.setupRequired;
  const isConnected = !!data.connectorConfig;
  // Read-only logic: Pivots, Sparklines, and Connected sheets are read-only for data entry
  const isReadOnly = isPivot || isSparkline || isConnected;

  // Clear internal selection when the card is deselected
  useEffect(() => {
    if (!selected) {
        setActiveCell(null);
        setSelectionRange(null);
        setIsEditing(false);
        setEditingRaw(null);
        setSuggestions([]);
        setHeaderMenuOpen(null);
        setRowMenuOpen(null);
        // Notify parent that selection is cleared for this sheet
        onSelectionContextChange?.({ sheetId: null, cellId: null, range: null });
    }
  }, [selected, onSelectionContextChange]);

  // Bubble up selection changes to parent for context-aware commands
  useEffect(() => {
      if (selected && onSelectionContextChange) {
          onSelectionContextChange({
              sheetId: data.id,
              cellId: activeCell,
              range: selectionRange
          });
      }
  }, [selected, activeCell, selectionRange, data.id, onSelectionContextChange]);
  
  const contentDimensions = useMemo(() => {
    let maxCol = -1;
    let maxRow = -1;
    Object.entries(data.cells).forEach(([key, cell]) => {
       const cellData = cell as CellData;
       if (cellData.raw && String(cellData.raw).trim() !== '') {
           const pos = parseCellId(key);
           if (pos) {
               maxCol = Math.max(maxCol, pos.col);
               maxRow = Math.max(maxRow, pos.row);
           }
       }
    });
    return { cols: maxCol + 1, rows: maxRow + 1 };
  }, [data.cells]);

  // Filtering Logic
  const visibleRowIndices = useMemo(() => {
      const filtered = getFilteredRows(data, contentDimensions.rows - 1);
      if (!filtered) return null; // Means show all
      return filtered;
  }, [data.cells, data.filters, data.sort, data.size.height, contentDimensions]);

  const recordCounts = useMemo(() => {
    const totalCount = Math.max(0, contentDimensions.rows - 1);
    let filteredCount = totalCount;
    if (visibleRowIndices) {
        filteredCount = visibleRowIndices.filter(r => r > 0 && r < contentDimensions.rows).length;
    }
    return { totalCount, filteredCount };
  }, [contentDimensions.rows, visibleRowIndices]);


  // UI Dimensions Logic
  const displayRows = data.size.height;
  const totalDataRows = Math.max(data.size.height, contentDimensions.rows);
  const countForTruncation = visibleRowIndices ? visibleRowIndices.length : totalDataRows;
  const effectiveRenderRows = Math.min(totalDataRows, MAX_RENDER_ROWS);
  const isTruncated = countForTruncation > MAX_RENDER_ROWS;

  useEffect(() => {
    if (!isEditingTitle) {
        setTitleInputValue(data.title);
    }
  }, [data.title, isEditingTitle]);

  const commitTitleEdit = () => {
    if (titleInputValue.trim() && titleInputValue !== data.title) {
        if (onHistorySave) onHistorySave();
        onUpdate(data.id, { ...data, title: titleInputValue });
    } else {
        setTitleInputValue(data.title);
    }
    setIsEditingTitle(false);
  };

  const getColWidth = (index: number) => {
    return data.colWidths?.[String(index)] ?? CELL_WIDTH;
  };

  const getColOffset = (index: number) => {
    let offset = 0;
    for(let i=0; i<index; i++) {
        offset += getColWidth(i);
    }
    return offset;
  };
  
  const getSelectedColumns = () => {
    if (!selectionRange) return undefined;
    const minCol = Math.min(selectionRange.start.col, selectionRange.end.col);
    const maxCol = Math.max(selectionRange.start.col, selectionRange.end.col);
    const cols = [];
    for(let c = minCol; c <= maxCol; c++) {
        cols.push(c);
    }
    return cols;
  };

  const totalTableWidth = useMemo(() => {
    const cols = data.size.width;
    let total = 0;
    for (let i = 0; i < cols; i++) {
        total += getColWidth(i);
    }
    return total;
  }, [data.size.width, data.colWidths]);

  const colStats = useMemo(() => {
    const stats: Record<number, { min: number; max: number }> = {};
    Object.entries(data.cells).forEach(([key, cell]) => {
       const cellData = cell as CellData;
       const pos = parseCellId(key);
       if (pos) {
          const val = parseFloat(String(cellData.value)); 
          if (!isNaN(val)) {
             if (!stats[pos.col]) {
                 stats[pos.col] = { min: val, max: val };
             } else {
                 stats[pos.col].min = Math.min(stats[pos.col].min, val);
                 stats[pos.col].max = Math.max(stats[pos.col].max, val);
             }
          }
       }
    });
    return stats;
  }, [data.cells]);

  const rowStats = useMemo(() => {
    const stats: Record<number, { min: number; max: number }> = {};
    Object.entries(data.cells).forEach(([key, cell]) => {
       const cellData = cell as CellData;
       const pos = parseCellId(key);
       if (pos) {
          const val = parseFloat(String(cellData.value)); 
          if (!isNaN(val)) {
             if (!stats[pos.row]) {
                 stats[pos.row] = { min: val, max: val };
             } else {
                 stats[pos.row].min = Math.min(stats[pos.row].min, val);
                 stats[pos.row].max = Math.max(stats[pos.row].max, val);
             }
          }
       }
    });
    return stats;
  }, [data.cells]);

  const referencedCells = useMemo(() => {
     if (!activeCell || !editingRaw || !editingRaw.toString().startsWith('=')) return new Set<string>();
     
     const set = new Set<string>();
     const raw = editingRaw.toString();
     
     const rangeRegex = /([A-Z]+[0-9]+):([A-Z]+[0-9]+)/g;
     let match;
     
     while ((match = rangeRegex.exec(raw)) !== null) {
         const start = parseCellId(match[1]);
         const end = parseCellId(match[2]);
         if (start && end) {
             const minCol = Math.min(start.col, end.col);
             const maxCol = Math.max(start.col, end.col);
             const minRow = Math.min(start.row, end.row);
             const maxRow = Math.max(start.row, end.row);
             
             for(let c = minCol; c <= maxCol; c++) {
                 for(let r = minRow; r <= maxRow; r++) {
                     set.add(getCellId(c, r));
                 }
             }
         }
     }
     
     const cellRegex = /[A-Z]+[0-9]+/g;
     while ((match = cellRegex.exec(raw)) !== null) {
         set.add(match[0]);
     }
     
     return set;
  }, [activeCell, editingRaw]);

  const stats = useMemo(() => {
    if (!selectionRange) return null;

    const minCol = Math.min(selectionRange.start.col, selectionRange.end.col);
    const maxCol = Math.max(selectionRange.start.col, selectionRange.end.col);
    const minRow = Math.min(selectionRange.start.row, selectionRange.end.row);
    const maxRow = Math.max(selectionRange.start.row, selectionRange.end.row);

    const numericValues: number[] = [];
    let nonEmptyCount = 0;
    
    for(let r = minRow; r <= maxRow; r++) {
        if (visibleRowIndices && !visibleRowIndices.includes(r)) continue;

        for(let c = minCol; c <= maxCol; c++) {
             const id = getCellId(c, r);
             const cell = data.cells[id];
             const cellValue = cell?.value;
             
             if (cellValue !== null && cellValue !== undefined && String(cellValue).trim() !== '') {
                 nonEmptyCount++;
                 const val = Number(cellValue);
                 if (!isNaN(val)) {
                     numericValues.push(val);
                 }
             }
        }
    }

    if (nonEmptyCount === 0) return null;

    const sum = numericValues.reduce((acc, val) => acc + val, 0);
    const count = nonEmptyCount;
    
    const hasNumeric = numericValues.length > 0;
    const avg = hasNumeric ? sum / numericValues.length : 0;
    const min = hasNumeric ? Math.min(...numericValues) : 0;
    const max = hasNumeric ? Math.max(...numericValues) : 0;

    return { sum, avg, count, min, max };
  }, [selectionRange, data.cells, visibleRowIndices]);

  const formatStat = (val: number) => {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(val);
  };

  useEffect(() => {
    if (activeCell) {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
        } else if (!isEditing && containerRef.current && !isEditingTitle) {
            containerRef.current.focus();
        }
    }
  }, [activeCell, isEditing, isEditingTitle]);

  useEffect(() => {
      if (headerMenuOpen !== null || rowMenuOpen !== null) {
          const handleClickOutside = () => {
              setHeaderMenuOpen(null);
              setRowMenuOpen(null);
          };
          window.addEventListener('mousedown', handleClickOutside);
          return () => window.removeEventListener('mousedown', handleClickOutside);
      }
  }, [headerMenuOpen, rowMenuOpen]);

  useEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;
      e.stopPropagation();
    };
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      element.removeEventListener('wheel', handleWheel);
    };
  }, []);

  useEffect(() => {
      const handleMouseUp = () => {
          if (dragRange) {
              setDragRange(null);
              if (inputRef.current) inputRef.current.focus();
          }
          if (isSelecting) {
              setIsSelecting(false);
          }
          if (colResizing) {
              setColResizing(null);
          }
      };
      
      const handleMouseMove = (e: MouseEvent) => {
          if (colResizing) {
              const dx = (e.clientX - colResizing.startX) / scale;
              const newWidth = Math.max(MIN_COL_WIDTH, colResizing.startWidth + dx);
              onUpdate(data.id, {
                  ...data,
                  colWidths: { ...data.colWidths, [String(colResizing.index)]: newWidth }
              });
          }
      };
      
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('mousemove', handleMouseMove);
      return () => {
          window.removeEventListener('mouseup', handleMouseUp);
          window.removeEventListener('mousemove', handleMouseMove);
      };
  }, [dragRange, isSelecting, colResizing, scale, data, onUpdate]);

  useEffect(() => {
    if (!resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
        const dx = (e.clientX - resizing.startX) / scale;
        const dy = (e.clientY - resizing.startY) / scale;
        
        let newCols = resizing.startCols;
        let newRows = resizing.startRows;

        if (resizing.type === 'right' || resizing.type === 'corner') {
            const deltaCols = Math.round(dx / CELL_WIDTH);
            newCols = Math.max(1, resizing.startCols + deltaCols);
        }
        
        if (resizing.type === 'bottom' || resizing.type === 'corner') {
            const deltaRows = Math.round(dy / CELL_HEIGHT);
            newRows = Math.max(1, resizing.startRows + deltaRows);
        }

        if (newCols !== data.size.width || newRows !== data.size.height) {
            onUpdate(data.id, {
                ...data,
                size: { width: newCols, height: newRows }
            });
        }
    };

    const handleMouseUp = () => {
        setResizing(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, scale, data, onUpdate]);

  const scrollToCell = (col: number, row: number) => {
    if (!gridRef.current) return;
    
    const container = gridRef.current;
    
    // Calculate cell position
    const left = getColOffset(col) + HEADER_COL_WIDTH; // Include header col in logical calc for scroll
    const width = getColWidth(col);
    const top = row * CELL_HEIGHT + HEADER_ROW_HEIGHT;
    const height = CELL_HEIGHT;
    
    // Determine bounds of the visible data area (excluding sticky headers)
    const viewLeft = container.scrollLeft + HEADER_COL_WIDTH;
    const viewTop = container.scrollTop + HEADER_ROW_HEIGHT;
    // const viewRight = container.scrollLeft + container.clientWidth;
    // const viewBottom = container.scrollTop + container.clientHeight;

    // Adjust Scroll X
    if (left < container.scrollLeft + HEADER_COL_WIDTH) {
        container.scrollLeft = left - HEADER_COL_WIDTH;
    } else if (left + width > container.scrollLeft + container.clientWidth) {
        container.scrollLeft = left + width - container.clientWidth;
    }

    // Adjust Scroll Y
    if (top < container.scrollTop + HEADER_ROW_HEIGHT) {
        container.scrollTop = top - HEADER_ROW_HEIGHT;
    } else if (top + height > container.scrollTop + container.clientHeight) {
        container.scrollTop = top + height - container.clientHeight;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isEditingTitle) return;
    
    // If we are editing, let the input handle it, unless it's a key we want to bubble?
    // Actually, if input is focused, React will fire this handler on the container due to bubbling,
    // but we can check if isEditing is true.
    if (isEditing) return;

    // --- NAVIGATION & INTERACTION IN SELECTION MODE ---

    let currentPos = { col: 0, row: 0 };
    if (selectionRange) {
        if (e.shiftKey) {
            currentPos = selectionRange.end;
        } else {
            if (activeCell) {
                const p = parseCellId(activeCell);
                if (p) currentPos = p;
            } else {
                currentPos = selectionRange.start; 
            }
        }
    } else if (activeCell) {
        const p = parseCellId(activeCell);
        if (p) currentPos = p;
    }

    let { col, row } = currentPos;
    let moved = false;

    if (e.key === 'ArrowUp') { row = Math.max(0, row - 1); moved = true; }
    if (e.key === 'ArrowDown') { row = Math.min(data.size.height - 1, row + 1); moved = true; }
    if (e.key === 'ArrowLeft') { col = Math.max(0, col - 1); moved = true; }
    if (e.key === 'ArrowRight') { col = Math.min(data.size.width - 1, col + 1); moved = true; }
    
    // Enter / Tab navigation
    if (e.key === 'Enter') {
        e.preventDefault();
        
        // Enter Edit Mode on 'Enter' key
        if (!isReadOnly && activeCell) {
            setIsEditing(true);
            setEditingRaw(data.cells[activeCell]?.raw || '');
            return;
        }

        if (e.shiftKey) row = Math.max(0, row - 1); else row = Math.min(data.size.height - 1, row + 1);
        moved = true;
    }
    if (e.key === 'Tab') {
        e.preventDefault();
        if (e.shiftKey) col = Math.max(0, col - 1); else col = Math.min(data.size.width - 1, col + 1);
        moved = true;
    }

    if (moved) {
        e.preventDefault();
        const newPos = { col, row };
        const newCellId = getCellId(col, row);

        if (e.shiftKey && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
            // Range Expansion
            if (selectionRange) {
                setSelectionRange({ start: selectionRange.start, end: newPos });
            } else {
                 setSelectionRange({ start: newPos, end: newPos });
                 setActiveCell(newCellId);
            }
        } else {
            // Simple Move
            setActiveCell(newCellId);
            setSelectionRange({ start: newPos, end: newPos });
            setEditingRaw(data.cells[newCellId]?.raw || '');
        }
        scrollToCell(col, row);
        return;
    }

    // Delete / Backspace to clear cells
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!isReadOnly && (activeCell || selectionRange)) {
            e.preventDefault();
            e.stopPropagation(); // Prevent global delete
            if (onHistorySave) onHistorySave();
            
            const newCells = { ...data.cells };
            let bounds = { minCol: col, maxCol: col, minRow: row, maxRow: row };
            
            if (selectionRange) {
                bounds = {
                    minCol: Math.min(selectionRange.start.col, selectionRange.end.col),
                    maxCol: Math.max(selectionRange.start.col, selectionRange.end.col),
                    minRow: Math.min(selectionRange.start.row, selectionRange.end.row),
                    maxRow: Math.max(selectionRange.start.row, selectionRange.end.row)
                };
            }

            for(let c = bounds.minCol; c <= bounds.maxCol; c++) {
                for(let r = bounds.minRow; r <= bounds.maxRow; r++) {
                    const id = getCellId(c, r);
                    if (newCells[id]) {
                        newCells[id] = { ...newCells[id], raw: '', value: null };
                    }
                }
            }
            
            onUpdate(data.id, computeSheet({ ...data, cells: newCells }));
        }
        return;
    }

    // Start Editing
    if (!isReadOnly && !e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        // Typing starts editing replacing content
        setActiveCell(getCellId(col, row)); 
        setIsEditing(true);
        setEditingRaw(e.key);
        return;
    }

    if (e.key === 'F2' && !isReadOnly) {
        setIsEditing(true);
        // Retain current value
        setEditingRaw(data.cells[getCellId(col, row)]?.raw || '');
        e.preventDefault();
    }
  };

  const handleCopyImage = async () => {
    if (!containerRef.current) return;
    setIsExporting(true);
    
    try {
        await document.fonts.ready;
        const element = containerRef.current;
        const canvas = await html2canvas(element, {
            backgroundColor: null,
            scale: 2,
            useCORS: true,
            logging: false,
            windowWidth: element.scrollWidth,
            windowHeight: element.scrollHeight,
            onclone: (clonedDoc) => {
                const clonedElement = clonedDoc.getElementById(element.id || '');
                if (clonedElement) {
                     clonedElement.style.fontFeatureSettings = '"liga" 0';
                     clonedElement.style.fontVariant = 'normal';
                }
            }
        });
        
        canvas.toBlob(async (blob) => {
            if (blob) {
                const item = new ClipboardItem({ 'image/png': blob });
                await navigator.clipboard.write([item]);
                if (onToast) onToast("Sheet copied to clipboard as image");
            }
        });
    } catch (err) {
        console.error("Copy failed", err);
        if (onToast) onToast("Failed to copy image");
    } finally {
        setIsExporting(false);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
  };

  const handleResizeStart = (e: React.MouseEvent, type: 'right' | 'bottom' | 'corner') => {
    e.preventDefault();
    e.stopPropagation();
    if (onHistorySave) onHistorySave();
    setResizing({
        type,
        startX: e.clientX,
        startY: e.clientY,
        startCols: data.size.width,
        startRows: data.size.height
    });
  };

  const handleColResizeStart = (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      e.stopPropagation();
      if (onHistorySave) onHistorySave();
      setColResizing({
          index,
          startX: e.clientX,
          startWidth: getColWidth(index)
      });
  };

  const insertColumn = (index: number, side: 'left' | 'right') => {
    if (onHistorySave) onHistorySave();
    const targetIndex = side === 'left' ? index : index + 1;
    
    const newCells: Record<string, CellData> = {};
    const newColWidths: Record<string, number> = {};

    // Shift Cells
    Object.keys(data.cells).forEach(key => {
        const pos = parseCellId(key);
        if (!pos) return;
        
        if (pos.col >= targetIndex) {
            const newKey = getCellId(pos.col + 1, pos.row);
            newCells[newKey] = data.cells[key];
        } else {
            newCells[key] = data.cells[key];
        }
    });

    // Shift Column Widths
    if (data.colWidths) {
        Object.keys(data.colWidths).forEach(k => {
            const colIdx = parseInt(k, 10);
            if (colIdx >= targetIndex) {
                newColWidths[String(colIdx + 1)] = data.colWidths[k];
            } else {
                newColWidths[k] = data.colWidths[k];
            }
        });
        // Set default width for new column
        newColWidths[String(targetIndex)] = CELL_WIDTH; 
    }

    const newData = {
        ...data,
        size: { ...data.size, width: data.size.width + 1 },
        cells: newCells,
        colWidths: newColWidths
    };
    
    onUpdate(data.id, computeSheet(newData));
    setHeaderMenuOpen(null);
  };

  const insertRow = (index: number, side: 'above' | 'below') => {
    if (onHistorySave) onHistorySave();
    const targetIndex = side === 'above' ? index : index + 1;
    
    const newCells: Record<string, CellData> = {};

    Object.keys(data.cells).forEach(key => {
        const pos = parseCellId(key);
        if (!pos) return;
        
        if (pos.row >= targetIndex) {
            const newKey = getCellId(pos.col, pos.row + 1);
            newCells[newKey] = data.cells[key];
        } else {
            newCells[key] = data.cells[key];
        }
    });

    const newData = {
        ...data,
        size: { ...data.size, height: data.size.height + 1 },
        cells: newCells
    };
    
    onUpdate(data.id, computeSheet(newData));
    setRowMenuOpen(null);
  };

  const applyColumnFormat = (colIndices: number[], updates: { type?: 'number'|'currency'|'percent'|'text'|'date', dateFormat?: string, d3Format?: string, visual?: 'bar' | 'heatmap' | null, heatmapColor?: 'red' | 'green' | 'yellow' }) => {
    if (onHistorySave) onHistorySave();
    const newCells = { ...data.cells };
    let hasChanges = false;
    
    const indicesSet = new Set(colIndices);

    Object.keys(newCells).forEach(key => {
       const pos = parseCellId(key);
       if (pos && indicesSet.has(pos.col)) {
           const cell = newCells[key];
           const currentFormat = cell.format || { type: 'text' };
           let newFormat: CellFormat = { ...currentFormat };
           
           if (updates.type) {
                newFormat = { ...newFormat, type: updates.type };
                if (updates.type === 'currency') { (newFormat as any).symbol = '$'; (newFormat as any).decimals = 2; }
                else if (updates.type === 'percent') { (newFormat as any).decimals = 1; }
                else if (updates.type === 'number') { (newFormat as any).decimals = 2; }
                else if (updates.type === 'date') {
                     (newFormat as any).dateFormat = updates.dateFormat || 'YYYY-MM-DD';
                     delete (newFormat as any).decimals;
                     delete (newFormat as any).symbol;
                }
                else if (updates.type === 'text') { delete (newFormat as any).decimals; delete (newFormat as any).symbol; delete (newFormat as any).dateFormat; }
           }

           if (updates.d3Format !== undefined) {
               (newFormat as any).d3Format = updates.d3Format;
               if (!updates.d3Format) delete (newFormat as any).d3Format;
               // Ensure d3Format is prioritized by setting type to number if not standard
               if (!['number', 'currency', 'percent'].includes(newFormat.type)) {
                    newFormat = { ...newFormat, type: 'number' };
                    (newFormat as any).d3Format = updates.d3Format;
               }
           }
           
           if (updates.visual !== undefined) {
               if (updates.visual === null) {
                   delete newFormat.visual;
               } else {
                   newFormat.visual = updates.visual;
               }
           }

           if (updates.heatmapColor) {
               newFormat.heatmapColor = updates.heatmapColor;
           }
           
           if (JSON.stringify(cell.format) !== JSON.stringify(newFormat)) {
               newCells[key] = { ...cell, format: newFormat };
               hasChanges = true;
           }
       }
    });

    if (hasChanges) {
        onUpdate(data.id, { ...data, cells: newCells });
    }
  };

  const applyRowFormat = (rowIndex: number, type?: 'number'|'currency'|'percent'|'text'|'date', dateFormat?: string, visualType?: 'bar-row' | 'heatmap-row', d3Format?: string) => {
    if (onHistorySave) onHistorySave();
    const newCells = { ...data.cells };
    let hasChanges = false;
    
    Object.keys(newCells).forEach(key => {
       const pos = parseCellId(key);
       if (pos && pos.row === rowIndex) {
           const cell = newCells[key];
           const currentFormat = cell.format || { type: 'text' };
           let newFormat: CellFormat = { ...currentFormat };
           
           if (type) {
                newFormat = { ...newFormat, type };
                if (type === 'currency') { (newFormat as any).symbol = '$'; (newFormat as any).decimals = 2; }
                else if (type === 'percent') { (newFormat as any).decimals = 1; }
                else if (type === 'number') { (newFormat as any).decimals = 2; }
                else if (type === 'date') {
                    (newFormat as any).dateFormat = dateFormat || 'YYYY-MM-DD';
                     delete (newFormat as any).decimals;
                     delete (newFormat as any).symbol;
                }
                else if (type === 'text') { delete (newFormat as any).decimals; delete (newFormat as any).symbol; delete (newFormat as any).dateFormat; }
           }

           if (d3Format !== undefined) {
                (newFormat as any).d3Format = d3Format;
                if (!d3Format) delete (newFormat as any).d3Format;
                if (!['number', 'currency', 'percent'].includes(newFormat.type)) {
                     newFormat = { ...newFormat, type: 'number' };
                     (newFormat as any).d3Format = d3Format;
                }
           }
           
           if (visualType) {
               newFormat.visual = newFormat.visual === visualType ? undefined : visualType;
           }
           
           if (JSON.stringify(cell.format) !== JSON.stringify(newFormat)) {
               newCells[key] = { ...cell, format: newFormat };
               hasChanges = true;
           }
       }
    });

    if (hasChanges) {
        onUpdate(data.id, { ...data, cells: newCells });
    }
  };

  const handleHeaderMenu = (colIndex: number, action: string, param?: any) => {
    const selectedCols = getSelectedColumns();
    let targetCols = [colIndex];
    if (selectedCols && selectedCols.includes(colIndex)) {
        targetCols = selectedCols;
    }

    const clickedColFirstCellId = getCellId(colIndex, 0); 
    const clickedColFormat = data.cells[clickedColFirstCellId]?.format;
    const colId = getCellId(colIndex, -1).replace(/[0-9]/g, '');

    if (action === 'filter') {
        setPreselectedFilterCol(colId);
        onUpdate(data.id, { ...data, showFilterPanel: true });
    } else if (action === 'sort-asc') {
        if (onHistorySave) onHistorySave();
        onUpdate(data.id, { ...data, sort: { columnId: colId, direction: 'asc' } });
    } else if (action === 'sort-desc') {
        if (onHistorySave) onHistorySave();
        onUpdate(data.id, { ...data, sort: { columnId: colId, direction: 'desc' } });
    } else if (action === 'chart' && onAddChart) {
        let chartSelectedCols = getSelectedColumns();
        if (chartSelectedCols && !chartSelectedCols.includes(colIndex)) {
            chartSelectedCols = undefined;
        }
        onAddChart(data.id, colIndex, chartSelectedCols);
    } else if (action === 'pivot' && onAddPivot) {
        onAddPivot(data.id, colIndex);
    } else if (action === 'sparkline' && onAddSparkline) {
        onAddSparkline(data.id);
    } else if (action === 'bar') {
        const isActive = clickedColFormat?.visual === 'bar';
        applyColumnFormat(targetCols, { visual: isActive ? null : 'bar' });
    } else if (action === 'heatmap') {
        const isActive = clickedColFormat?.visual === 'heatmap';
        if (param) {
            // Set specific color
            applyColumnFormat(targetCols, { visual: 'heatmap', heatmapColor: param });
        } else {
            // Toggle
            applyColumnFormat(targetCols, { visual: isActive ? null : 'heatmap' });
        }
    } else if (action === 'date') {
        applyColumnFormat(targetCols, { type: 'date', dateFormat: param });
    } else if (action === 'number-compact') {
        applyColumnFormat(targetCols, { type: 'number', d3Format: '.2s' });
    } else if (action === 'number-expand') {
        applyColumnFormat(targetCols, { type: 'number', d3Format: '' });
    } else if (action === 'currency-compact') {
        applyColumnFormat(targetCols, { type: 'currency', d3Format: '$.2s' });
    } else if (action === 'currency-expand') {
        applyColumnFormat(targetCols, { type: 'currency', d3Format: '' });
    } else if (['number', 'currency', 'percent', 'text'].includes(action)) {
        applyColumnFormat(targetCols, { type: action as any, d3Format: '' }); // Clear D3 format if standard type selected
    }
    setHeaderMenuOpen(null);
  };

  const handleRowMenu = (rowIndex: number, action: string, param?: any) => {
    if (action === 'bar-row') {
        applyRowFormat(rowIndex, undefined, undefined, 'bar-row');
    } else if (action === 'heatmap-row') {
        applyRowFormat(rowIndex, undefined, undefined, 'heatmap-row');
    } else if (action === 'date') {
        applyRowFormat(rowIndex, 'date', param);
    } else if (action === 'number-compact') {
        applyRowFormat(rowIndex, 'number', undefined, undefined, '.2s');
    } else if (action === 'number-expand') {
        applyRowFormat(rowIndex, 'number', undefined, undefined, '');
    } else if (action === 'currency-compact') {
        applyRowFormat(rowIndex, 'currency', undefined, undefined, '$.2s');
    } else if (action === 'currency-expand') {
        applyRowFormat(rowIndex, 'currency', undefined, undefined, '');
    } else if (['number', 'currency', 'percent', 'text'].includes(action)) {
        applyRowFormat(rowIndex, action as any, undefined, undefined, '');
    }
    setRowMenuOpen(null);
  };

  const handleAutoResize = (colIndex: number) => {
      if (onHistorySave) onHistorySave();
      const ctx = document.createElement('canvas').getContext('2d');
      if (!ctx) return;
      
      let maxW = MIN_COL_WIDTH;
      const colName = getCellId(colIndex, -1).replace(/[0-9]/g, '');
      ctx.font = '500 12px Inter, sans-serif'; 
      maxW = Math.max(maxW, ctx.measureText(colName).width + 24); 

      const maxRows = Math.max(data.size.height, contentDimensions.rows);
      ctx.font = '14px Inter, sans-serif';
      for(let r = 0; r < maxRows; r++) {
          const id = getCellId(colIndex, r);
          const cell = data.cells[id];
          const val = formatValue(cell?.value, cell?.format);
          if (val) {
              const w = ctx.measureText(val).width + 16;
              maxW = Math.max(maxW, w);
          }
      }
      maxW = Math.min(maxW, 600);

      onUpdate(data.id, {
          ...data,
          colWidths: { ...data.colWidths, [String(colIndex)]: maxW }
      });
  };

  const commitEdit = (nextCellId?: string | null) => {
      if (isReadOnly) {
          setIsEditing(false);
          return;
      }
      
      if (activeCell && editingRaw !== null) {
        if (onHistorySave) onHistorySave();
        const newCells = { ...data.cells };
        const currentCell = newCells[activeCell] || { raw: '', value: null };
        
        let newFormat = currentCell.format;
        const trimmed = editingRaw.trim();
        
        if (!trimmed.startsWith('=')) {
            if (trimmed.endsWith('%')) {
                const valStr = trimmed.slice(0, -1);
                if (!isNaN(parseFloat(valStr))) {
                    const parts = valStr.split('.');
                    const dec = parts.length > 1 ? parts[1].length : 0;
                    newFormat = { ...newFormat, type: 'percent', decimals: dec };
                }
            }
        }

        newCells[activeCell] = {
          ...currentCell,
          raw: editingRaw,
          value: null,
          format: newFormat
        };
        
        const tempSheet = { ...data, cells: newCells };
        onUpdate(data.id, computeSheet(tempSheet));
      }
      
      setIsEditing(false);
      setEditingRaw(null);
      setSuggestions([]);
      setDragRange(null);
      
      if (nextCellId) {
          setActiveCell(nextCellId);
          const nextPos = parseCellId(nextCellId);
          if (nextPos) {
              setSelectionRange({ start: nextPos, end: nextPos });
              scrollToCell(nextPos.col, nextPos.row);
          }
      }
  };

  const handleCopy = (e: React.ClipboardEvent) => {
    // If we are editing text, let default copy work
    if (isEditing || isEditingTitle) return;
    if (!selectionRange) return;
    
    e.preventDefault();
    
    const start = selectionRange.start;
    const end = selectionRange.end;
    const minCol = Math.min(start.col, end.col);
    const maxCol = Math.max(start.col, end.col);
    const minRow = Math.min(start.row, end.row);
    const maxRow = Math.max(start.row, end.row);

    const rows = [];
    for(let r = minRow; r <= maxRow; r++) {
      const rowData = [];
      for(let c = minCol; c <= maxCol; c++) {
        const cellId = getCellId(c, r);
        const cell = data.cells[cellId];
        rowData.push(cell?.raw || '');
      }
      rows.push(rowData.join('\t'));
    }
    const text = rows.join('\n');
    e.clipboardData.setData('text/plain', text);
    if (onToast) onToast("Copied cells to clipboard");
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (isEditing || isEditingTitle) return;
    if (!activeCell) return;
    if (isReadOnly) return;
    
    e.preventDefault();
    e.stopPropagation(); // Stop propagation so global app paste listener doesn't fire
    
    const text = e.clipboardData.getData('text/plain');
    if (!text) return;

    const { data: matrix } = parseClipboardData(text);
    if (!matrix || matrix.length === 0) return;

    if (onHistorySave) onHistorySave();
    
    const startPos = parseCellId(activeCell);
    if (!startPos) return;

    const newCells = { ...data.cells };
    let maxR = data.size.height;
    let maxC = data.size.width;

    matrix.forEach((row, rIdx) => {
        row.forEach((val, cIdx) => {
            if (val === undefined) return;
            const targetCol = startPos.col + cIdx;
            const targetRow = startPos.row + rIdx;
            
            // Expand size if needed to accommodate pasted data
            if (targetRow >= maxR) maxR = targetRow + 1;
            if (targetCol >= maxC) maxC = targetCol + 1;

            const cellId = getCellId(targetCol, targetRow);
            const prev = newCells[cellId];
            newCells[cellId] = {
                ...prev,
                raw: val,
                value: null // will trigger compute
            };
        });
    });

    const updatedSheet = {
        ...data,
        size: { width: maxC, height: maxR },
        cells: newCells
    };
    
    onUpdate(data.id, computeSheet(updatedSheet));
    if (onToast) onToast("Pasted cells");
  };

  const handleCellDoubleClick = (cellId: string) => {
      if (isReadOnly) return;
      setHeaderMenuOpen(null);
      setRowMenuOpen(null);
      setActiveCell(cellId);
      const pos = parseCellId(cellId);
      if (pos) setSelectionRange({ start: pos, end: pos });
      setIsEditing(true);
      setEditingRaw(data.cells[cellId]?.raw || '');
      setDragRange(null);
  };
  
  const handleCellMouseEnter = (cellId: string) => {
      if (isSelecting && activeCell) {
          const start = parseCellId(activeCell);
          const end = parseCellId(cellId);
          if (start && end) {
              setSelectionRange({ start, end });
          }
      }
  };

  const handleCellMouseDown = (cellId: string) => {
      if (isEditing) commitEdit();
      setHeaderMenuOpen(null);
      setRowMenuOpen(null);
      const pos = parseCellId(cellId);
      if (pos) {
          setIsSelecting(true);
          setActiveCell(cellId);
          setSelectionRange({ start: pos, end: pos });
          if (!isReadOnly) setEditingRaw(data.cells[cellId]?.raw || '');
          setDragRange(null);
      }
  };

  const renderGrid = () => {
    // ... (same implementation for calculating rowsToRender)
    const rows = [];
    
    // Calculate visible rows based on the viewport height
    const renderCols = Math.max(data.size.width, contentDimensions.cols);
    const buffer = 8;
    
    const visibleRowStartIdx = Math.floor(scrollTop / CELL_HEIGHT);
    const visibleRowCount = displayRows; 
    
    let rowsToRender: number[] = [];
    if (visibleRowIndices) {
        const start = Math.max(0, visibleRowStartIdx - buffer);
        const end = Math.min(visibleRowIndices.length, visibleRowStartIdx + visibleRowCount + buffer);
        rowsToRender = visibleRowIndices.slice(start, end);
    } else {
        const startRow = Math.max(0, visibleRowStartIdx - buffer);
        const endRow = Math.min(effectiveRenderRows, visibleRowStartIdx + visibleRowCount + buffer);
        for(let i=startRow; i<endRow; i++) rowsToRender.push(i);
    }
    
    let paddingTop = 0;
    let paddingBottom = 0;

    if (visibleRowIndices) {
        const start = Math.max(0, visibleRowStartIdx - buffer);
        const end = Math.min(visibleRowIndices.length, visibleRowStartIdx + visibleRowCount + buffer);
        paddingTop = start * CELL_HEIGHT;
        paddingBottom = Math.max(0, (visibleRowIndices.length - end) * CELL_HEIGHT);
    } else {
        const startRow = Math.max(0, visibleRowStartIdx - buffer);
        const endRow = Math.min(effectiveRenderRows, visibleRowStartIdx + visibleRowCount + buffer);
        paddingTop = startRow * CELL_HEIGHT;
        paddingBottom = (effectiveRenderRows - endRow) * CELL_HEIGHT;
    }

    let selBounds = { minCol: -1, maxCol: -1, minRow: -1, maxRow: -1 };
    if (selectionRange) {
        selBounds = {
            minCol: Math.min(selectionRange.start.col, selectionRange.end.col),
            maxCol: Math.max(selectionRange.start.col, selectionRange.end.col),
            minRow: Math.min(selectionRange.start.row, selectionRange.end.row),
            maxRow: Math.max(selectionRange.start.row, selectionRange.end.row)
        };
    }

    // Column Headers
    const headerCols = [
      <div key="corner" className="sticky left-0 top-0 z-30 border-r border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50/95 dark:bg-neutral-800/95 backdrop-blur-sm" 
           style={{ width: HEADER_COL_WIDTH, height: HEADER_ROW_HEIGHT, flexShrink: 0 }} />
    ];
    for (let c = 0; c < renderCols; c++) {
      const colLabel = getCellId(c, -1).replace(/[0-9]/g, '');
      const isActiveCol = activeCell && parseCellId(activeCell)?.col === c;
      const isSelectedCol = selectionRange && c >= selBounds.minCol && c <= selBounds.maxCol;
      const isSortedCol = data.sort && data.sort.columnId === colLabel;
      const sortDir = isSortedCol ? data.sort?.direction : null;
      const colWidth = getColWidth(c);
      
      const clickedColFirstCellId = getCellId(c, 0); 
      const clickedColFormat = data.cells[clickedColFirstCellId]?.format;

      headerCols.push(
        <div key={`h-${c}`} 
             onMouseDown={(e) => { 
                 e.stopPropagation();
                 setHeaderMenuOpen(null);
                 setRowMenuOpen(null);
                 if (isEditing) commitEdit(); 
                 const start = { col: c, row: 0 }; 
                 const end = { col: c, row: data.size.height - 1 }; 
                 setSelectionRange({ start, end }); 
                 setActiveCell(getCellId(c, 0)); 
                 setEditingRaw(data.cells[getCellId(c, 0)]?.raw || ''); 
                 setDragRange(null); 
             }}
             className={`group/col relative flex items-center justify-center text-[10px] font-medium border-b border-neutral-100 dark:border-neutral-800 select-none cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700
                ${isSelectedCol ? 'bg-teal-50/50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400' : 
                  (isActiveCol ? 'bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400' : 'bg-transparent text-neutral-400 dark:text-neutral-500')}
             `}
             style={{ width: colWidth, height: HEADER_ROW_HEIGHT, flexShrink: 0 }}>
          <div className="flex items-center gap-1">
             <span>{colLabel}</span>
             {isSortedCol && (
                 <span className="text-teal-500">
                     {sortDir === 'asc' ? <ArrowDownAZ size={10} /> : <ArrowUpAZ size={10} />}
                 </span>
             )}
          </div>
          
          <button 
              onMouseDown={(e) => {
                  e.stopPropagation();
                  setHeaderMenuOpen(headerMenuOpen === c ? null : c);
                  setRowMenuOpen(null);
              }}
              className={`absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 transition-opacity ${isActiveCol || isSelectedCol ? 'opacity-100' : 'opacity-0 group-hover/col:opacity-100'}`}
          >
              <MoreVertical size={10} />
          </button>
          
          {headerMenuOpen === c && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 z-50 py-1" onMouseDown={(e) => e.stopPropagation()}>
                  
                  {/* Insert Logic */}
                  {!isReadOnly && (
                    <>
                        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                            <button onClick={() => insertColumn(c, 'right')} className="flex-1 text-left">
                                Insert
                            </button>
                            <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                                <button onClick={(e) => { e.stopPropagation(); insertColumn(c, 'left'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Left">
                                    <ArrowLeft size={12} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); insertColumn(c, 'right'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Right">
                                    <ArrowRight size={12} />
                                </button>
                            </div>
                        </div>
                        <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
                    </>
                  )}

                  {/* Sort & Filter Group */}
                  <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Sort & Filter</div>
                  <button onClick={() => handleHeaderMenu(c, 'sort-asc')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <ArrowDownAZ size={12} className="text-neutral-400" /> Sort A to Z
                  </button>
                  <button onClick={() => handleHeaderMenu(c, 'sort-desc')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <ArrowUpAZ size={12} className="text-neutral-400" /> Sort Z to A
                  </button>
                  <button onClick={() => handleHeaderMenu(c, 'filter')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <Filter size={12} className="text-neutral-400" /> Filter
                  </button>
                  
                  <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
                  
                  {/* Column Visuals Group */}
                  <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Column Visuals</div>
                  <button onClick={() => handleHeaderMenu(c, 'bar')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <AlignLeft size={12} className="text-neutral-400" /> Bar
                  </button>
                  
                  {/* Heatmap with Color Selection */}
                  <div className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between group">
                        <button onClick={() => handleHeaderMenu(c, 'heatmap')} className="flex items-center gap-2 flex-1 text-left">
                             <Palette size={12} className="text-neutral-400" /> Heatmap
                        </button>
                        <div className="flex gap-1 ml-2">
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleHeaderMenu(c, 'heatmap', 'red'); }} 
                                className={`w-2.5 h-2.5 rounded-full bg-red-500 hover:scale-125 transition-transform ring-1 ring-neutral-200 dark:ring-neutral-600 ${clickedColFormat?.heatmapColor === 'red' ? 'ring-2 ring-offset-1 ring-neutral-400' : ''}`} 
                                title="Red"
                            />
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleHeaderMenu(c, 'heatmap', 'yellow'); }} 
                                className={`w-2.5 h-2.5 rounded-full bg-yellow-400 hover:scale-125 transition-transform ring-1 ring-neutral-200 dark:ring-neutral-600 ${clickedColFormat?.heatmapColor === 'yellow' ? 'ring-2 ring-offset-1 ring-neutral-400' : ''}`} 
                                title="Yellow"
                            />
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleHeaderMenu(c, 'heatmap', 'green'); }} 
                                className={`w-2.5 h-2.5 rounded-full bg-teal-500 hover:scale-125 transition-transform ring-1 ring-neutral-200 dark:ring-neutral-600 ${clickedColFormat?.heatmapColor === 'green' || (!clickedColFormat?.heatmapColor && clickedColFormat?.visual === 'heatmap') ? 'ring-2 ring-offset-1 ring-neutral-400' : ''}`} 
                                title="Green"
                            />
                        </div>
                  </div>

                  <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>

                  {/* Sheet Visuals Group */}
                  <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Sheet Visuals</div>
                  <button onClick={() => handleHeaderMenu(c, 'chart')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <BarChart3 size={12} className="text-neutral-400" /> Chart
                  </button>
                  <button onClick={() => handleHeaderMenu(c, 'pivot')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <Table size={12} className="text-neutral-400" /> Pivot
                  </button>
                  <button onClick={() => handleHeaderMenu(c, 'sparkline')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <TrendingUp size={12} className="text-neutral-400" /> Sparklines
                  </button>

                  <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
                  
                  {/* Format Group */}
                  <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Format</div>
                  
                  {/* Number with Compact/Expand Options */}
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                      <button onClick={() => handleHeaderMenu(c, 'number-compact')} className="flex-1 text-left flex items-center gap-2">
                          <Hash size={12} className="text-neutral-400" /> Number
                      </button>
                      <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                          <button onClick={(e) => { e.stopPropagation(); handleHeaderMenu(c, 'number-compact'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Compact (.2s)">
                              <Minimize2 size={12} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleHeaderMenu(c, 'number-expand'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Expand (Full)">
                              <Maximize2 size={12} />
                          </button>
                      </div>
                  </div>

                  {/* Currency with Compact/Expand Options */}
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                      <button onClick={() => handleHeaderMenu(c, 'currency-compact')} className="flex-1 text-left flex items-center gap-2">
                          <DollarSign size={12} className="text-neutral-400" /> Currency
                      </button>
                      <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                          <button onClick={(e) => { e.stopPropagation(); handleHeaderMenu(c, 'currency-compact'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Compact ($ .2s)">
                              <Minimize2 size={12} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleHeaderMenu(c, 'currency-expand'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Expand (Full)">
                              <Maximize2 size={12} />
                          </button>
                      </div>
                  </div>

                  <button onClick={() => handleHeaderMenu(c, 'percent')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <Percent size={12} className="text-neutral-400" /> Percent
                  </button>
                  <div className="relative group/date">
                      <button className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                          <div className="flex items-center gap-2"><Calendar size={12} className="text-neutral-400" /> Date</div>
                          <ChevronRight size={10} />
                      </button>
                      <div className="absolute left-full top-0 ml-1 w-32 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 hidden group-hover/date:block py-1">
                          <button onClick={() => handleHeaderMenu(c, 'date', 'YYYY-MM-DD')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">YYYY-MM-DD</button>
                          <button onClick={() => handleHeaderMenu(c, 'date', 'MM/DD/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">MM/DD/YYYY</button>
                          <button onClick={() => handleHeaderMenu(c, 'date', 'DD/MM/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">DD/MM/YYYY</button>
                          <button onClick={() => handleHeaderMenu(c, 'date', 'Full')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">Full Date</button>
                      </div>
                  </div>
                  <button onClick={() => handleHeaderMenu(c, 'text')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                      <Type size={12} className="text-neutral-400" /> Text
                  </button>
                  <div className="relative group/d3">
                        <button className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                            <div className="flex items-center gap-2"><Code size={12} className="text-neutral-400" /> Custom D3</div>
                            <ChevronRight size={10} />
                        </button>
                        <div 
                            className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 hidden group-hover/d3:block p-3 z-50"
                            onMouseDown={(e) => e.stopPropagation()} 
                        >
                            <div className="text-[10px] font-medium text-neutral-500 mb-1.5">D3 Format String</div>
                            <input 
                                type="text" 
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-teal-500 text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400"
                                placeholder="e.g. .2f, $,.2f"
                                defaultValue={(clickedColFormat as any)?.d3Format || ''}
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).focus(); }}
                                onKeyDown={(e) => {
                                    e.stopPropagation(); 
                                    if (e.key === 'Enter') {
                                        const selectedCols = getSelectedColumns();
                                        let targetCols = [c];
                                        if (selectedCols && selectedCols.includes(c)) {
                                            targetCols = selectedCols;
                                        }
                                        applyColumnFormat(targetCols, { type: 'number', d3Format: e.currentTarget.value });
                                        setHeaderMenuOpen(null);
                                    }
                                }}
                            />
                            <div className="text-[10px] text-neutral-400 mt-2">Press Enter to apply</div>
                        </div>
                  </div>
              </div>
          )}
          
          <div 
             className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-teal-400/50 z-40 opacity-0 hover:opacity-100 transition-opacity"
             onMouseDown={(e) => handleColResizeStart(e, c)}
             onDoubleClick={(e) => { e.stopPropagation(); handleAutoResize(c); }}
          />
        </div>
      );
    }
    rows.push(
      <div key="header-row" className="flex sticky top-0 z-40 bg-white/95 dark:bg-neutral-850/95 w-max">
        {headerCols}
      </div>
    );
    
    // Top Spacer
    if (paddingTop > 0) rows.push(<div key="spacer-top" style={{ height: paddingTop }} />);

    // Row Rendering Loop
    for (const r of rowsToRender) {
      const cols = [];
      const isActiveRow = activeCell && parseCellId(activeCell)?.row === r;
      const isSelectedRow = selectionRange && r >= selBounds.minRow && r <= selBounds.maxRow;
      const isHeaderRow = r === 0;

      // Identify Grand Total row for Pivot Tables to highlight it
      const isGrandTotal = isPivot && String(data.cells[getCellId(0, r)]?.value) === 'Grand Total';

      cols.push(
        <div key={`rh-${r}`} 
             onMouseDown={(e) => { 
                 e.stopPropagation(); 
                 setHeaderMenuOpen(null);
                 setRowMenuOpen(null);
                 if (isEditing) commitEdit(); 
                 const start = { col: 0, row: r }; 
                 const end = { col: data.size.width - 1, row: r }; 
                 setSelectionRange({ start, end }); 
                 setActiveCell(getCellId(0, r)); 
                 setEditingRaw(data.cells[getCellId(0, r)]?.raw || ''); 
                 setDragRange(null); 
             }}
             className={`sticky left-0 z-30 group/row flex items-center justify-center text-[10px] font-medium border-r border-b border-neutral-100 dark:border-neutral-800 select-none cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700 backdrop-blur-sm
                ${isSelectedRow ? 'bg-teal-50/90 dark:bg-teal-900/90 text-teal-600 dark:text-teal-400' : 
                  (isActiveRow ? 'bg-neutral-50/90 dark:bg-neutral-800/90 text-neutral-600 dark:text-neutral-400' : 
                    (isHeaderRow || isGrandTotal ? 'bg-neutral-50/90 dark:bg-neutral-800/90 text-teal-600/80 dark:text-teal-400/80' : 
                    'bg-neutral-50/95 dark:bg-neutral-800/95 text-neutral-400 dark:text-neutral-500')
                  )}
             `}
             style={{ width: HEADER_COL_WIDTH, height: CELL_HEIGHT, flexShrink: 0 }}>
          <span>{r + 1}</span>
          <button 
              onMouseDown={(e) => { 
                  e.stopPropagation(); 
                  setRowMenuOpen(rowMenuOpen === r ? null : r); 
                  setHeaderMenuOpen(null);
              }}
              className={`absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 transition-opacity ${isActiveRow || isSelectedRow ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
          >
              <MoreVertical size={10} />
          </button>
          {rowMenuOpen === r && (
              <div className="absolute top-0 left-full ml-1 w-40 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 z-50 py-1" onMouseDown={(e) => e.stopPropagation()}>
                  {isHeaderRow && <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-100 dark:border-neutral-700 mb-1 bg-neutral-50/50 dark:bg-neutral-900/20">Header Row</div>}
                  
                  {/* Insert Logic */}
                  {!isReadOnly && (
                    <>
                        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                            <button onClick={() => insertRow(r, 'below')} className="flex-1 text-left">
                                Insert
                            </button>
                            <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                                <button onClick={(e) => { e.stopPropagation(); insertRow(r, 'above'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Above">
                                    <ArrowUp size={12} />
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); insertRow(r, 'below'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Below">
                                    <ArrowDown size={12} />
                                </button>
                            </div>
                        </div>
                        <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
                    </>
                  )}

                  <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium">Visualize</div>
                  <button onClick={() => handleRowMenu(r, 'bar-row')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><AlignVerticalJustifyCenter size={12} /> Vertical Bar</button>
                  <button onClick={() => handleRowMenu(r, 'heatmap-row')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><Palette size={12} /> Heatmap</button>
                  <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
                  <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium">Format</div>
                  
                  {/* Row Number Options */}
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                      <button onClick={() => handleRowMenu(r, 'number-compact')} className="flex-1 text-left flex items-center gap-2">
                          <Hash size={12} /> Number
                      </button>
                      <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                          <button onClick={(e) => { e.stopPropagation(); handleRowMenu(r, 'number-compact'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Compact (.2s)">
                              <Minimize2 size={12} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleRowMenu(r, 'number-expand'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Expand (Full)">
                              <Maximize2 size={12} />
                          </button>
                      </div>
                  </div>

                  {/* Row Currency Options */}
                  <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                      <button onClick={() => handleRowMenu(r, 'currency-compact')} className="flex-1 text-left flex items-center gap-2">
                          <DollarSign size={12} /> Currency
                      </button>
                      <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                          <button onClick={(e) => { e.stopPropagation(); handleRowMenu(r, 'currency-compact'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Compact ($ .2s)">
                              <Minimize2 size={12} />
                          </button>
                          <button onClick={(e) => { e.stopPropagation(); handleRowMenu(r, 'currency-expand'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Expand (Full)">
                              <Maximize2 size={12} />
                          </button>
                      </div>
                  </div>

                  <button onClick={() => handleRowMenu(r, 'percent')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><Percent size={12} /> Percent</button>
                  <div className="relative group/date-row">
                      <button className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                          <div className="flex items-center gap-2"><Calendar size={12} /> Date</div>
                          <ChevronRight size={10} />
                      </button>
                      <div className="absolute left-full top-0 ml-1 w-32 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 hidden group-hover/date-row:block py-1">
                          <button onClick={() => handleRowMenu(r, 'date', 'YYYY-MM-DD')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">YYYY-MM-DD</button>
                          <button onClick={() => handleRowMenu(r, 'date', 'MM/DD/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">MM/DD/YYYY</button>
                          <button onClick={() => handleRowMenu(r, 'date', 'DD/MM/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">DD/MM/YYYY</button>
                          <button onClick={() => handleRowMenu(r, 'date', 'Full')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">Full Date</button>
                      </div>
                  </div>
                  <button onClick={() => handleRowMenu(r, 'text')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><Type size={12} /> Text</button>
                  <div className="relative group/d3-row">
                        <button className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                            <div className="flex items-center gap-2"><Code size={12} /> Custom D3</div>
                            <ChevronRight size={10} />
                        </button>
                        <div 
                            className="absolute left-full top-0 ml-1 w-48 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 hidden group-hover/d3-row:block p-3 z-50"
                            onMouseDown={(e) => e.stopPropagation()} 
                        >
                            <div className="text-[10px] font-medium text-neutral-500 mb-1.5">D3 Format String</div>
                            <input 
                                type="text" 
                                className="w-full bg-neutral-50 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-teal-500 text-neutral-800 dark:text-neutral-200 placeholder:text-neutral-400"
                                placeholder="e.g. .2f, $,.2f"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).focus(); }}
                                onKeyDown={(e) => {
                                    e.stopPropagation(); 
                                    if (e.key === 'Enter') {
                                        applyRowFormat(r, 'number', undefined, undefined, e.currentTarget.value);
                                        setRowMenuOpen(null);
                                    }
                                }}
                            />
                            <div className="text-[10px] text-neutral-400 mt-2">Press Enter to apply</div>
                        </div>
                  </div>
              </div>
          )}
        </div>
      );

      for (let c = 0; c < renderCols; c++) {
        const cellId = getCellId(c, r);
        const cellData = data.cells[cellId]; 
        const isActive = activeCell === cellId;
        const isReferenced = referencedCells.has(cellId) && !isActive;
        const isSelected = selectionRange && c >= selBounds.minCol && c <= selBounds.maxCol && r >= selBounds.minRow && r <= selBounds.maxRow;
        
        const displayValue = formatValue(cellData?.value, cellData?.format);
        const colWidth = getColWidth(c);
        
        const showBar = cellData?.format?.visual === 'bar';
        const showBarRow = cellData?.format?.visual === 'bar-row';
        const showSparkline = cellData?.format?.visual === 'sparkline';
        let barSize = 0;
        
        if (showBar) {
            const max = colStats[c]?.max || 0;
            const val = parseFloat(String(cellData?.value));
            if (max > 0 && !isNaN(val)) barSize = Math.max(0, Math.min(100, (val / max) * 100));
        } else if (showBarRow) {
            const max = rowStats[r]?.max || 0;
            const val = parseFloat(String(cellData?.value));
            if (max > 0 && !isNaN(val)) barSize = Math.max(0, Math.min(100, (val / max) * 100));
        }

        const showHeatmap = cellData?.format?.visual === 'heatmap';
        const showHeatmapRow = cellData?.format?.visual === 'heatmap-row';
        let heatmapColor = 'transparent';
        
        if (showHeatmap || showHeatmapRow) {
            const stats = showHeatmap ? colStats[c] : rowStats[r];
            const { min = 0, max = 0 } = stats || {};
            const val = parseFloat(String(cellData?.value));
            if (!isNaN(val) && max !== min) {
                const ratio = Math.max(0, Math.min(1, (val - min) / (max - min)));
                const opacity = 0.1 + (ratio * 0.5);
                
                const colorKey = cellData?.format?.heatmapColor || 'green';
                const baseColor = colorKey === 'red' ? '239, 68, 68' : (colorKey === 'yellow' ? '234, 179, 8' : '13, 148, 136');
                heatmapColor = `rgba(${baseColor}, ${opacity})`;
            }
        }

        cols.push(
          <div key={cellId} 
               className={`relative border border-neutral-100 dark:border-neutral-800 text-[13px] flex-shrink-0 flex items-center
                 ${isActive ? 'z-20' : ''} 
                 ${!isActive && isSelected ? 'bg-teal-50/50 dark:bg-teal-900/20' : ''}
                 ${isReferenced ? 'z-10 bg-purple-50 dark:bg-purple-900/20' : ''}
                 ${!isActive && !isReferenced && !isSelected ? 
                    (isHeaderRow || isGrandTotal
                        ? 'bg-neutral-50/30 dark:bg-neutral-800/30 font-semibold text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-800' 
                        : 'hover:bg-neutral-50/50 dark:hover:bg-neutral-800 bg-white dark:bg-neutral-850')
                  : ''}
                 ${isGrandTotal ? 'border-t border-t-neutral-300 dark:border-t-neutral-600' : ''}
                 ${isReadOnly ? 'cursor-default' : 'cursor-text'}
               `}
               style={{ width: colWidth, height: CELL_HEIGHT }}
               onMouseDown={(e) => { 
                   if (isEditing && activeCell && activeCell !== cellId && editingRaw?.startsWith('=')) { e.preventDefault(); e.stopPropagation(); return; } 
                   if (!isEditing) { handleCellMouseDown(cellId); } 
               }}
               onMouseEnter={() => handleCellMouseEnter(cellId)}
               onDoubleClick={() => handleCellDoubleClick(cellId)}
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
                   className="absolute inset-0 w-full h-full px-2 outline-none bg-white dark:bg-neutral-850 text-neutral-900 dark:text-neutral-100 z-30 rounded-sm"
                   value={editingRaw ?? ''}
                   onChange={(e) => { setEditingRaw(e.target.value); setDragRange(null); if (e.target.value.startsWith('=')) { /* ... suggest ... */ } else { setSuggestions([]); } }}
                   onBlur={() => commitEdit()}
                   onMouseDown={(e) => { e.stopPropagation(); setDragRange(null); }}
                   onKeyDown={(e) => {
                       if (e.key === 'Enter') {
                           e.preventDefault();
                           e.stopPropagation();
                           const pos = parseCellId(activeCell!);
                           let nextId = null;
                           if (pos) {
                                // Default behavior: move down on Enter
                                const nextRow = Math.min(data.size.height - 1, pos.row + 1);
                                nextId = getCellId(pos.col, nextRow);
                           }
                           commitEdit(nextId);
                       }
                       if (e.key === 'Tab') {
                            e.preventDefault();
                            e.stopPropagation();
                            const pos = parseCellId(activeCell!);
                            let nextId = null;
                            if (pos) {
                                const nextCol = Math.min(data.size.width - 1, pos.col + 1);
                                nextId = getCellId(nextCol, pos.row);
                            }
                            commitEdit(nextId);
                       }
                       if (e.key === 'Escape') {
                           e.preventDefault();
                           setIsEditing(false);
                           setEditingRaw(null);
                           if (activeCell && containerRef.current) containerRef.current.focus();
                       }
                   }}
                   autoFocus
                 />
                 {suggestions.length > 0 && (
                   <div className="absolute top-full left-0 min-w-[140px] bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 z-50 max-h-32 overflow-y-auto flex flex-col py-1">
                     {suggestions.map((s, i) => (
                       <div key={s} className={`px-3 py-1.5 text-xs cursor-pointer flex items-center justify-between ${i === selectedSuggestionIndex ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-300' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`} onMouseDown={(e) => { e.preventDefault(); }}>
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
                     <Sparkline value={String(cellData.value)} width={colWidth} height={CELL_HEIGHT} />
                 ) : (
                    <span className="leading-none">{isActive ? (isEditing ? (cellData?.raw || '') : displayValue) : displayValue}</span>
                 )}
               </div>
             )}
          </div>
        );
      }
      rows.push(<div key={`row-${r}`} className="flex w-max">{cols}</div>);
    }

    if (paddingBottom > 0) rows.push(<div key="spacer-bottom" style={{ height: paddingBottom }} />);
    
    if (selectionRange && !visibleRowIndices && (selBounds.minCol !== selBounds.maxCol || selBounds.minRow !== selBounds.maxRow)) {
        const top = HEADER_ROW_HEIGHT + (selBounds.minRow * CELL_HEIGHT);
        let leftOffset = 0; for(let c=0; c<selBounds.minCol; c++) leftOffset += getColWidth(c);
        const left = HEADER_COL_WIDTH + leftOffset;
        let width = 0; for(let c=selBounds.minCol; c<=selBounds.maxCol; c++) width += getColWidth(c);
        const height = (Math.min(selBounds.maxRow, effectiveRenderRows - 1) - selBounds.minRow + 1) * CELL_HEIGHT;
        if (selBounds.minRow < effectiveRenderRows) {
            rows.push(
                <div key="selection-border" className="absolute border border-teal-500 bg-teal-500/5 pointer-events-none z-10 rounded-sm" style={{ top, left, width, height }} />
            );
        }
    }

    return rows;
  };

  const windowWidth = totalTableWidth + HEADER_COL_WIDTH;
  
  // CRITICAL FIX: Decouple viewport height from effective row count when filtering/sorting.
  // This allows the sheet resize handle to work correctly even when rows are filtered.
  // We use data.size.height as the viewport height (windowHeight), 
  // and visibleRowIndices determines the scrollable content height inside.
  const windowHeight = (data.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT + (isTruncated ? 32 : 0);

  const handleCreatePivotFromHeader = () => {
      const colIndex = activeCell ? parseCellId(activeCell)?.col : undefined;
      if (onAddPivot) onAddPivot(data.id, colIndex);
  };
  
  const handleFiltersChange = (newFilters: FilterCondition[]) => {
      if (onHistorySave) onHistorySave();
      onUpdate(data.id, { ...data, filters: newFilters });
  };

  return (
    <div 
      id={`sheet-${data.id}`}
      ref={containerRef}
      className={`absolute flex flex-col bg-white dark:bg-neutral-850 rounded-xl transition-shadow transition-colors duration-200 outline-none group border 
        ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-md z-30'}
        ${isPendingDelete ? 'animate-delete-pulse' : ''}
      `}
      style={{ 
        left: data.position.x, 
        top: data.position.y,
        width: windowWidth + 2, 
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onCopy={handleCopy}
      onPaste={handlePaste}
      onMouseDownCapture={() => { onSelect?.(); }}
      onMouseDown={(e) => { 
          e.stopPropagation(); 
          if (containerRef.current) containerRef.current.focus(); 
          // Close menus on click outside of them but inside sheet
          setHeaderMenuOpen(null);
          setRowMenuOpen(null);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* Window Header */}
      <div className="flex flex-col rounded-t-xl overflow-hidden">
      <div 
        className="h-9 flex items-center justify-between px-3 cursor-grab active:cursor-grabbing bg-white dark:bg-neutral-850 border-b border-neutral-100 dark:border-neutral-800"
        onMouseDown={(e) => {
            onMouseDown(e); 
            setActiveCell(null);
            setSelectionRange(null);
            setIsEditing(false);
            setHeaderMenuOpen(null);
            setRowMenuOpen(null);
        }}
      >
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 flex-1 min-w-0">
          <GripHorizontal size={14} className="text-neutral-300 dark:text-neutral-600 flex-shrink-0" />
          
          {isPivot && <div className="p-0.5 rounded text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30 mr-1" title="Pivot Table"><Table size={12} /></div>}
          {isSparkline && <div className="p-0.5 rounded text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30 mr-1" title="Sparkline Table"><TrendingUp size={12} /></div>}
          {isConnected && <div className="p-0.5 rounded text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30 mr-1" title={`Connected Source: ${data.connectorConfig?.type}`}><Link size={12} /></div>}

          {isEditingTitle ? (
             <input
                type="text"
                className="bg-transparent text-neutral-900 dark:text-neutral-100 border-b border-teal-500 px-0 py-0 outline-none w-full h-6"
                value={titleInputValue}
                onChange={(e) => setTitleInputValue(e.target.value)}
                onBlur={commitTitleEdit}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTitleEdit();
                    if (e.key === 'Escape') { setIsEditingTitle(false); setTitleInputValue(data.title); }
                    e.stopPropagation();
                }}
                autoFocus
                onMouseDown={(e) => e.stopPropagation()}
             />
          ) : (
             <span className="truncate cursor-text hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded px-1.5 py-0.5 -ml-1.5 transition-colors" onDoubleClick={(e) => { e.stopPropagation(); setIsEditingTitle(true); setTitleInputValue(data.title); }}>
                {data.title}
             </span>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={() => onUpdate(data.id, { ...data, showFilterPanel: !showFilterPanel })} className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${showFilterPanel || (data.filters && data.filters.length > 0) ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                <Filter size={14} />
                <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">Filter</span>
            </button>
            <button onClick={handleCopyImage} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" disabled={isExporting}>
                {isExporting ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">Copy as Image</span>
            </button>
            {isPivot ? (
                 <button onClick={() => setShowPivotConfig(!showPivotConfig)} className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${showPivotConfig ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                    <Settings2 size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">Configure Pivot</span>
                </button>
            ) : isSparkline ? (
                 <button onClick={() => setShowSparklineConfig(!showSparklineConfig)} className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${showSparklineConfig ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                    <Settings2 size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">Configure Sparklines</span>
                </button>
            ) : (
                <>
                <button onClick={() => { if (onAddSparkline) onAddSparkline(data.id); }} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                    <TrendingUp size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">Create Sparklines</span>
                </button>
                <button onClick={handleCreatePivotFromHeader} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                    <Table size={14} />
                    <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">Create Pivot</span>
                </button>
                </>
            )}
            <button onClick={() => { const colIndex = activeCell ? parseCellId(activeCell)?.col : undefined; const selectedCols = getSelectedColumns(); if (onAddChart) onAddChart(data.id, colIndex, selectedCols); }} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                <BarChart3 size={14} />
                <span className="absolute top-full mt-2 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover/btn:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">Visualize</span>
            </button>
            {isSetup ? (
                <button onClick={() => onDelete(data.id)} className="group/btn relative p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 rounded-md"><X size={14} /></button>
            ) : (
                <button onClick={() => onDelete(data.id)} className="group/btn relative text-neutral-400 hover:text-neutral-600 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"><Trash2 size={14} /></button>
            )}
        </div>
      </div>
      
      {showFilterPanel && (
          <FilterPanel 
              sheet={data} 
              onChange={handleFiltersChange} 
              onClose={() => onUpdate(data.id, { ...data, showFilterPanel: false })} 
              preselectedCol={preselectedFilterCol}
              filteredCount={recordCounts.filteredCount}
              totalCount={recordCounts.totalCount}
          />
      )}
      </div>

      <div 
        ref={gridRef}
        onScroll={handleScroll}
        className="bg-white dark:bg-neutral-850 cursor-text select-none overflow-auto relative rounded-b-xl"
        style={{ height: windowHeight }}
      >
        {(isSetup || showPivotConfig) && isPivot && (
            <div className="absolute inset-0 z-50 bg-white dark:bg-neutral-850 flex flex-col">
                <PivotConfigPanel 
                    sourceSheet={sourceSheet}
                    initialConfig={data.pivotConfig}
                    isSetupMode={isSetup}
                    onConfirm={(newConfig) => {
                         if (onHistorySave) onHistorySave();
                         import('../utils/pivotHelpers').then(({ refreshPivotTable }) => {
                             if (sourceSheet) {
                                 const updatedSheet = refreshPivotTable({ ...data, pivotConfig: newConfig }, sourceSheet);
                                 onUpdate(data.id, { ...updatedSheet, setupRequired: false });
                                 setShowPivotConfig(false);
                             }
                         });
                    }}
                    onCancel={() => { if (isSetup) onDelete(data.id); else setShowPivotConfig(false); }}
                />
            </div>
        )}

        {(isSetup || showSparklineConfig) && isSparkline && (
            <div className="absolute inset-0 z-50 bg-white dark:bg-neutral-850 flex flex-col">
                <SparklineConfigPanel
                    sourceSheet={sourceSheet}
                    initialConfig={data.sparklineConfig}
                    isSetupMode={isSetup}
                    onConfirm={(newConfig) => {
                         if (onHistorySave) onHistorySave();
                         import('../utils/sparklineHelpers').then(({ refreshSparklineTable }) => {
                             if (sourceSheet) {
                                 const updatedSheet = refreshSparklineTable({ ...data, sparklineConfig: newConfig }, sourceSheet);
                                 onUpdate(data.id, { ...updatedSheet, setupRequired: false });
                                 setShowSparklineConfig(false);
                             }
                         });
                    }}
                    onCancel={() => { if (isSetup) onDelete(data.id); else setShowSparklineConfig(false); }}
                />
            </div>
        )}
        
        {(!isSetup) && renderGrid()}
        
        {(!isSetup) && isTruncated && !visibleRowIndices && (
            <div className="absolute bottom-0 left-0 right-0 h-8 bg-neutral-50 dark:bg-neutral-800 border-t border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-[10px] text-neutral-500 italic z-40 sticky">
                <div className="flex items-center gap-1.5">
                    <AlertCircle size={10} />
                    <span>Showing first {MAX_RENDER_ROWS} rows. {totalDataRows - MAX_RENDER_ROWS} hidden rows available.</span>
                </div>
            </div>
        )}
      </div>
      
      {/* Footer Stats / Resize Handles */}
      <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 px-2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
         {stats && (
           <div className="relative">
              {showStatsMenu && <div className="fixed inset-0 z-40" onClick={() => setShowStatsMenu(false)} />}
              <button onClick={() => setShowStatsMenu(!showStatsMenu)} className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-800 px-3 py-1.5 rounded-full shadow-sm border border-neutral-100 dark:border-neutral-700 hover:bg-neutral-50 transition-colors z-50 relative">
                  <span className="uppercase tracking-wider text-[9px]">{activeStat}</span>
                  <span className="text-neutral-700 dark:text-neutral-200">{formatStat(stats[activeStat])}</span>
                  <ChevronDown size={10} className={`transition-transform ${showStatsMenu ? 'rotate-180' : ''}`} />
              </button>
              {showStatsMenu && (
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 p-1 min-w-[140px] z-50 flex flex-col gap-0.5">
                      {(['sum', 'avg', 'min', 'max', 'count'] as const).map(key => (
                          <button key={key} onClick={() => { setActiveStat(key); setShowStatsMenu(false); }} className={`flex justify-between items-center px-3 py-1.5 text-xs rounded-md w-full text-left transition-colors ${activeStat === key ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-300' : 'text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}>
                              <span className="uppercase font-semibold text-[10px] tracking-wider">{key}</span>
                              <span>{formatStat(stats[key])}</span>
                          </button>
                      ))}
                  </div>
              )}
           </div>
        )}
      </div>

      <div className="absolute top-0 -right-1 w-3 h-full cursor-col-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'right')} />
      <div className="absolute -bottom-1 left-0 w-full h-3 cursor-row-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'bottom')} />
      <div className="absolute -bottom-1 -right-1 w-5 h-5 cursor-nwse-resize z-30 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors" onMouseDown={(e) => handleResizeStart(e, 'corner')}>
          <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
      </div>
    </div>
  );
};