import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SheetData, CellData } from '../types';
import { getCellId, parseCellId, computeSheet } from '../utils/formulas';
import { parseClipboardData } from '../utils/clipboard';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT } from '../constants';
import { GripHorizontal, Trash2, BarChart3 } from 'lucide-react';

interface SheetNodeProps {
  data: SheetData;
  selected: boolean;
  scale: number;
  onUpdate: (id: string, newData: SheetData) => void;
  onDelete: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onAddChart?: (sheetId: string) => void;
}

const SUPPORTED_FUNCTIONS = ['SUM', 'AVG', 'MIN', 'MAX', 'AVERAGE'];

export const SheetNode: React.FC<SheetNodeProps> = ({ data, selected, scale, onUpdate, onDelete, onMouseDown, onAddChart }) => {
  const [activeCell, setActiveCell] = useState<string | null>(null);
  const [editingRaw, setEditingRaw] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  
  const inputRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  
  // Resize State
  const [resizing, setResizing] = useState<{
    type: 'right' | 'bottom' | 'corner';
    startX: number;
    startY: number;
    startCols: number;
    startRows: number;
  } | null>(null);

  // Calculate content dimensions based on occupied cells
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

  // Focus input when entering edit mode
  useEffect(() => {
    if (activeCell && inputRef.current) {
      inputRef.current.focus();
    }
  }, [activeCell]);

  // Prevent canvas panning when scrolling inside the sheet
  useEffect(() => {
    const element = sheetRef.current;
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

  // Resize Handlers
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

  const handleResizeStart = (e: React.MouseEvent, type: 'right' | 'bottom' | 'corner') => {
    e.preventDefault();
    e.stopPropagation();
    setResizing({
        type,
        startX: e.clientX,
        startY: e.clientY,
        startCols: data.size.width,
        startRows: data.size.height
    });
  };

  const handleCellClick = (cellId: string) => {
    setActiveCell(cellId);
    setEditingRaw(data.cells[cellId]?.raw || '');
    setSuggestions([]);
  };

  const handleCellChange = (val: string) => {
    setEditingRaw(val);

    if (val.startsWith('=')) {
      const match = val.match(/^=([a-zA-Z]*)$/);
      if (match) {
        const query = match[1].toUpperCase();
        const matches = SUPPORTED_FUNCTIONS.filter(f => f.startsWith(query));
        if (matches.length > 0) {
          setSuggestions(matches);
          setSelectedSuggestionIndex(0);
          return;
        }
      }
    }
    setSuggestions([]);
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    if (!activeCell) return;

    const clipboardText = e.clipboardData.getData('text/plain');
    if (!clipboardText) return;

    const hasTabs = clipboardText.includes('\t');
    const hasNewlines = clipboardText.includes('\n') || clipboardText.includes('\r');
    const hasCommas = clipboardText.includes(',');

    if (!hasTabs && !hasNewlines && !hasCommas) return;

    e.preventDefault();
    e.stopPropagation();

    const matrix = parseClipboardData(clipboardText);
    if (!matrix || matrix.length === 0) return;

    const start = parseCellId(activeCell);
    if (!start) return;

    const newCells = { ...data.cells };
    
    const PADDING = 100;
    const maxFitCols = Math.max(1, Math.floor(((window.innerWidth / scale) - PADDING - HEADER_COL_WIDTH) / CELL_WIDTH));
    const maxFitRows = Math.max(1, Math.floor(((window.innerHeight / scale) - PADDING - HEADER_ROW_HEIGHT) / CELL_HEIGHT));

    let requiredCols = 0;
    let requiredRows = start.row + matrix.length;

    matrix.forEach(r => {
       requiredCols = Math.max(requiredCols, start.col + r.length);
    });

    const finalCols = Math.max(data.size.width, Math.min(requiredCols, maxFitCols));
    const finalRows = Math.max(data.size.height, Math.min(requiredRows, maxFitRows));

    matrix.forEach((cols, rIdx) => {
      cols.forEach((val, cIdx) => {
        const targetCol = start.col + cIdx;
        const targetRow = start.row + rIdx;
        const cellId = getCellId(targetCol, targetRow);

        newCells[cellId] = {
          raw: val.trim(),
          value: null
        };
      });
    });

    const tempSheet = {
      ...data,
      size: { width: finalCols, height: finalRows },
      cells: newCells
    };
    
    onUpdate(data.id, computeSheet(tempSheet));
    
    const startId = getCellId(start.col, start.row);
    if (newCells[startId]) {
      setEditingRaw(newCells[startId].raw);
    }
  };

  const applySuggestion = (fn: string) => {
    const newValue = `=${fn}(`;
    setEditingRaw(newValue);
    setSuggestions([]);
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const handleCellBlur = () => {
    if (activeCell && editingRaw !== null) {
      const newCells = { ...data.cells };
      newCells[activeCell] = {
        raw: editingRaw,
        value: null 
      };
      
      const tempSheet = { ...data, cells: newCells };
      onUpdate(data.id, computeSheet(tempSheet));
    }
    setActiveCell(null);
    setEditingRaw(null);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(suggestions[selectedSuggestionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSuggestions([]);
        return;
      }
    }

    if (e.key === 'Enter') {
      handleCellBlur();
    }
  };

  // Render Grid
  const renderGrid = () => {
    const rows = [];
    
    const renderCols = Math.max(data.size.width, contentDimensions.cols);
    const renderRows = Math.max(data.size.height, contentDimensions.rows);

    const headerCols = [
      <div key="corner" className="sticky left-0 top-0 z-30 border-r border-b border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800" 
           style={{ width: HEADER_COL_WIDTH, height: HEADER_ROW_HEIGHT, flexShrink: 0 }} />
    ];
    for (let c = 0; c < renderCols; c++) {
      const colLabel = getCellId(c, -1).replace(/[0-9]/g, '');
      headerCols.push(
        <div key={`h-${c}`} className="flex items-center justify-center text-xs font-medium text-neutral-500 dark:text-neutral-400 border-r border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 select-none"
             style={{ width: CELL_WIDTH, height: HEADER_ROW_HEIGHT, flexShrink: 0 }}>
          {colLabel}
        </div>
      );
    }
    rows.push(
      <div key="header-row" className="flex sticky top-0 z-20 bg-neutral-50 dark:bg-neutral-800 w-max">
        {headerCols}
      </div>
    );

    for (let r = 0; r < renderRows; r++) {
      const cols = [];
      cols.push(
        <div key={`rh-${r}`} className="sticky left-0 z-10 flex items-center justify-center text-xs font-medium text-neutral-500 dark:text-neutral-400 border-r border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 select-none"
             style={{ width: HEADER_COL_WIDTH, height: CELL_HEIGHT, flexShrink: 0 }}>
          {r + 1}
        </div>
      );

      for (let c = 0; c < renderCols; c++) {
        const cellId = getCellId(c, r);
        const cellData = data.cells[cellId]; // Use direct data
        const isActive = activeCell === cellId;
        const displayValue = isActive ? (editingRaw ?? '') : (cellData?.value ?? '');
        
        cols.push(
          <div key={cellId} 
               className={`relative border-r border-b border-neutral-200 dark:border-neutral-700 text-sm flex-shrink-0 ${isActive ? 'z-10 ring-2 ring-teal-500' : 'hover:bg-neutral-50 dark:hover:bg-neutral-700'} bg-white dark:bg-neutral-850`}
               style={{ width: CELL_WIDTH, height: CELL_HEIGHT }}
               onClick={() => handleCellClick(cellId)}>
             
             {isActive ? (
               <>
                 <input
                   ref={inputRef}
                   className="absolute inset-0 w-full h-full px-2 outline-none bg-white dark:bg-neutral-850 text-neutral-900 dark:text-neutral-100"
                   value={displayValue}
                   onChange={(e) => handleCellChange(e.target.value)}
                   onPaste={handlePaste}
                   onBlur={handleCellBlur}
                   onKeyDown={handleKeyDown}
                   autoFocus
                 />
                 {suggestions.length > 0 && (
                   <div className="absolute top-full left-0 min-w-[140px] bg-white dark:bg-neutral-800 shadow-xl rounded-md border border-neutral-200 dark:border-neutral-600 z-50 max-h-32 overflow-y-auto flex flex-col py-1">
                     {suggestions.map((s, i) => (
                       <div 
                         key={s}
                         className={`px-3 py-1.5 text-sm cursor-pointer flex items-center justify-between ${i === selectedSuggestionIndex ? 'bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300' : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'}`}
                         onMouseDown={(e) => {
                            e.preventDefault(); 
                            applySuggestion(s);
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
               <div className="px-2 py-1 w-full h-full overflow-hidden whitespace-nowrap text-neutral-700 dark:text-neutral-300 flex items-center">
                 {displayValue}
               </div>
             )}
          </div>
        );
      }
      rows.push(<div key={`row-${r}`} className="flex w-max">{cols}</div>);
    }

    return rows;
  };

  const windowWidth = (data.size.width * CELL_WIDTH) + HEADER_COL_WIDTH + 2;
  const windowHeight = (data.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

  return (
    <div 
      ref={sheetRef}
      className={`absolute flex flex-col bg-white dark:bg-neutral-850 rounded-lg transition-shadow duration-200 group ${selected ? 'ring-2 ring-teal-500 shadow-xl z-50' : 'border border-neutral-300 dark:border-neutral-600 shadow-sm hover:shadow-md z-30'}`}
      style={{ 
        left: data.position.x, 
        top: data.position.y,
        width: windowWidth,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Window Header */}
      <div 
        className="h-8 bg-neutral-100 dark:bg-neutral-800 border-b border-neutral-200 dark:border-neutral-700 flex items-center justify-between px-2 cursor-grab active:cursor-grabbing rounded-t-lg flex-shrink-0"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2 text-xs font-semibold text-neutral-600 dark:text-neutral-300 flex-1">
          <GripHorizontal size={14} className="text-neutral-400" />
          {data.title}
        </div>
        <div className="flex items-center gap-1">
            {onAddChart && (
                <button 
                onClick={() => onAddChart(data.id)}
                className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-teal-100 dark:hover:bg-teal-900/50 text-neutral-400 hover:text-teal-600 dark:hover:text-teal-400 transition-all"
                title="Create Chart from this sheet"
                >
                <BarChart3 size={14} />
                </button>
            )}
            <button 
            onClick={() => onDelete(data.id)}
            className="opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-red-500 transition-opacity p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/30"
            >
            <Trash2 size={14} />
            </button>
        </div>
      </div>

      <div 
        ref={gridRef}
        className="bg-white dark:bg-neutral-850 cursor-text select-none overflow-auto"
        style={{ 
            height: windowHeight, 
        }}
      >
        {renderGrid()}
      </div>
      
      <div className="bg-neutral-50 dark:bg-neutral-800 px-2 py-1 border-t border-neutral-200 dark:border-neutral-700 rounded-b-lg flex justify-between items-center flex-shrink-0">
        <div className="text-[10px] text-neutral-400 flex gap-2">
           <span>{data.size.height} rows</span>
           <span>{data.size.width} cols</span>
        </div>
      </div>

      <div 
        className="absolute top-0 -right-2 w-4 h-full cursor-col-resize z-20"
        onMouseDown={(e) => handleResizeStart(e, 'right')}
      />
      <div 
        className="absolute -bottom-2 left-0 w-full h-4 cursor-row-resize z-20"
        onMouseDown={(e) => handleResizeStart(e, 'bottom')}
      />
      <div 
        className="absolute -bottom-2 -right-2 w-6 h-6 cursor-nwse-resize z-30 flex items-center justify-center"
        onMouseDown={(e) => handleResizeStart(e, 'corner')}
      >
      </div>
      
      <div className="absolute bottom-1 right-1 w-3 h-3 pointer-events-none">
         <div className="w-full h-full border-r-2 border-b-2 border-neutral-200 dark:border-neutral-600" style={{ borderRadius: '0 0 4px 0' }}></div>
      </div>
    </div>
  );
};