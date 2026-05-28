
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SheetData, CellData, CellFormat, CellCoordinate, FilterCondition, SparklineConfig, SelectionContext } from '../types';
import { getCellId, parseCellId, computeSheet } from '../utils/formulas';
import { formatValue } from '../utils/formatting';
import { parseClipboardData } from '../utils/clipboard';
import { getFilteredRows } from '../utils/dataAnalysis';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT, MIN_COL_WIDTH, MAX_RENDER_ROWS } from '../constants';
import { GripHorizontal, Trash2, BarChart3, ChevronDown, MoreVertical, Table, Settings2, X, Image as ImageIcon, Loader2, AlertCircle, Filter, TrendingUp, Link, RefreshCcw, Code2 } from 'lucide-react';
import { PivotConfigPanel } from './PivotConfigPanel';
import { SparklineConfigPanel } from './SparklineConfigPanel';
import { FilterPanel } from './FilterPanel';
import { SheetColumnMenu } from './SheetColumnMenu';
import { SheetRowMenu } from './SheetRowMenu';
import { SheetCell } from './SheetCell';
import html2canvas from 'html2canvas';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../store';
import { clickhouseResultToMatrix, queryClickhouse } from '../utils/clickhouseBackend';
import { googleAnalyticsResultToMatrix, queryGoogleAnalytics, type GoogleAnalyticsReport } from '../utils/googleAnalyticsBackend';
import { INITIAL_COLS, INITIAL_ROWS, MAX_IMPORT_COLS, MAX_IMPORT_ROWS } from '../constants';

interface SheetNodeProps {
  id: string;
  onAddChart?: (sheetId: string, defaultColIndex?: number, selectedCols?: number[]) => void;
  onAddPivot?: (sheetId: string, defaultColIndex?: number) => void;
  onAddSparkline?: (sheetId: string) => void;
  onToast?: (message: string) => void;
  isPendingDelete?: boolean;
  onSelectionContextChange?: (ctx: SelectionContext) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

const SUPPORTED_FORMULAS = ['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT'];

export const SheetNode: React.FC<SheetNodeProps> = ({ id, onAddChart, onAddPivot, onAddSparkline, onToast, isPendingDelete, onSelectionContextChange, onMouseDown }) => {
  const data = useStore(state => state.sheets[id]);
  const selected = useStore(state => state.selectedIds.has(id));
  const scale = useStore(state => state.transform.scale);
  const updateSheet = useStore(state => state.updateSheet);
  const deleteSheet = useStore(state => state.deleteSheet);
  const saveSnapshot = useStore(state => state.saveSnapshot);
  const select = useStore(state => state.select);
  
  // Select Source Sheet if needed
  const sourceSheetId = data?.pivotConfig?.sourceSheetId || data?.sparklineConfig?.sourceSheetId;
  const sourceSheet = useStore(state => sourceSheetId ? state.sheets[sourceSheetId] : undefined);

  const [activeCell, setActiveCell] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: CellCoordinate; end: CellCoordinate } | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const [formulaDragStart, setFormulaDragStart] = useState<string | null>(null);
  const [formulaDragPrefix, setFormulaDragPrefix] = useState<string | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editingRaw, setEditingRaw] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleInputValue, setTitleInputValue] = useState(data?.title || '');

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
  
  const [showPivotConfig, setShowPivotConfig] = useState(false);
  const [showSparklineConfig, setShowSparklineConfig] = useState(false);
  const [showClickhouseSql, setShowClickhouseSql] = useState(false);
  const [clickhouseSqlDraft, setClickhouseSqlDraft] = useState<string>('');
  const [isClickhouseRefreshing, setIsClickhouseRefreshing] = useState(false);
  const [isGoogleAnalyticsRefreshing, setIsGoogleAnalyticsRefreshing] = useState(false);
  
  const showFilterPanel = !!data?.showFilterPanel;
  const [preselectedFilterCol, setPreselectedFilterCol] = useState<string | null>(null);
  
  const [isExporting, setIsExporting] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const updateSheetRef = useRef(updateSheet);
  const scaleRef = useRef(scale);
  const colResizingRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);
  const resizingRef = useRef<{
    type: 'right' | 'bottom' | 'corner';
    startX: number;
    startY: number;
    startCols: number;
    startRows: number;
  } | null>(null);
  const resizeRafIdRef = useRef<number | null>(null);
  const queuedColWidthRef = useRef<{ index: number; width: number } | null>(null);
  const queuedSizeRef = useRef<{ width: number; height: number } | null>(null);
  
  const [resizing, setResizing] = useState<{
    type: 'right' | 'bottom' | 'corner';
    startX: number;
    startY: number;
    startCols: number;
    startRows: number;
  } | null>(null);

  // Keep data ref up to date for event handlers
  useEffect(() => {
      dataRef.current = data;
  }, [data]);
  useEffect(() => {
      updateSheetRef.current = updateSheet;
  }, [updateSheet]);
  useEffect(() => {
      scaleRef.current = scale;
  }, [scale]);
  useEffect(() => {
      colResizingRef.current = colResizing;
  }, [colResizing]);
  useEffect(() => {
      resizingRef.current = resizing;
  }, [resizing]);

  if (!data) return null;

  const isPivot = !!data.pivotConfig;
  const isSparkline = !!data.sparklineConfig;
  const isSetup = !!data.setupRequired;
  const isConnected = !!data.connectorConfig;
  const isReadOnly = isPivot || isSparkline || isConnected;
  const isClickhouseConnected = data.connectorConfig?.type === 'clickhouse';
  const isGoogleAnalyticsConnected = data.connectorConfig?.type === 'google-analytics';
  const isGoogleAnalyticsSimulated =
    isGoogleAnalyticsConnected && data.connectorConfig?.params?.simulate !== false;

  const lastRefreshedAt =
    (isClickhouseConnected || isGoogleAnalyticsConnected) &&
    typeof data.connectorConfig?.params?.lastRefreshedAt === 'number'
      ? (data.connectorConfig?.params?.lastRefreshedAt as number)
      : null;

  const applyMatrixToSheet = (matrix: string[][]) => {
    let finalMatrix = matrix;
    let truncated = false;

    if (finalMatrix.length > MAX_IMPORT_ROWS) {
      finalMatrix = finalMatrix.slice(0, MAX_IMPORT_ROWS);
      truncated = true;
    }
    if (finalMatrix.length > 0 && finalMatrix[0].length > MAX_IMPORT_COLS) {
      finalMatrix = finalMatrix.map(row => row.slice(0, MAX_IMPORT_COLS));
      truncated = true;
    }

    const rows = finalMatrix.length;
    const cols = finalMatrix.reduce((max, row) => Math.max(max, row.length), 0);
    const finalCols = Math.max(cols, INITIAL_COLS);
    const finalRows = Math.max(rows, INITIAL_ROWS);
    const maxViewportRows = Math.floor((window.innerHeight - 200) / CELL_HEIGHT);
    const maxViewportCols = Math.floor((window.innerWidth - 200) / CELL_WIDTH);
    const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
    const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));

    const newCells: Record<string, CellData> = {};
    finalMatrix.forEach((rowVals, r) => {
      rowVals.forEach((val, c) => {
        const strVal = String(val);
        if (strVal.trim()) {
          const id = getCellId(c, r);
          newCells[id] = { raw: strVal.trim(), value: null };
        }
      });
    });
    return {
      cells: newCells,
      size: { width: constrainedCols, height: constrainedRows },
      truncated
    };
  };

  const refreshClickhouse = async (opts?: { sqlOverride?: string; showToasts?: boolean }) => {
    if (!isClickhouseConnected) return;
    const connectorId = String(data.connectorConfig?.params?.connectorId || '');
    const sql = (opts?.sqlOverride ?? String(data.connectorConfig?.params?.sql || '')).trim();
    if (!connectorId || !sql) {
      if (onToast) onToast('Missing ClickHouse connector or SQL');
      return;
    }

    setIsClickhouseRefreshing(true);
    saveSnapshot();
    try {
      const result = await queryClickhouse({ connectorId, sql });
      const matrix = clickhouseResultToMatrix(result);
      const next = applyMatrixToSheet(matrix);
      const nextConfig = {
          ...data.connectorConfig!,
          params: {
              ...data.connectorConfig!.params,
              sql,
              lastRefreshedAt: Date.now(),
              truncated: !!result.truncated,
              lastError: ''
          }
      };

      updateSheet(data.id, { size: next.size, cells: next.cells, connectorConfig: nextConfig });
      if (next.truncated && onToast) onToast(`Dataset truncated to ${MAX_IMPORT_ROWS} rows / ${MAX_IMPORT_COLS} cols`);
      if (opts?.showToasts !== false && onToast) onToast('Refreshed');
    } catch (e: any) {
      const msg = e?.message || 'Refresh failed';
      updateSheet(data.id, {
        connectorConfig: {
          ...data.connectorConfig!,
          params: {
            ...data.connectorConfig!.params,
            sql,
            lastError: msg
          }
        }
      });
      if (onToast) onToast(msg);
    } finally {
      setIsClickhouseRefreshing(false);
    }
  };

  const refreshGoogleAnalytics = async (opts?: { showToasts?: boolean }) => {
    if (!isGoogleAnalyticsConnected || isGoogleAnalyticsSimulated) return;
    const connectorId = String(data.connectorConfig?.params?.connectorId || '');
    const propertyId = String(data.connectorConfig?.params?.propertyId || '');
    const report = data.connectorConfig?.params?.report as GoogleAnalyticsReport | undefined;
    if (!connectorId || !propertyId) {
      if (onToast) onToast('Missing Google Analytics connector or property ID');
      return;
    }

    setIsGoogleAnalyticsRefreshing(true);
    saveSnapshot();
    try {
      const result = await queryGoogleAnalytics({ connectorId, propertyId, report });
      const matrix = googleAnalyticsResultToMatrix(result);
      const next = applyMatrixToSheet(matrix);
      const nextConfig = {
        ...data.connectorConfig!,
        params: {
          ...data.connectorConfig!.params,
          lastRefreshedAt: Date.now(),
          truncated: !!result.truncated,
          lastError: ''
        }
      };

      updateSheet(data.id, { size: next.size, cells: next.cells, connectorConfig: nextConfig });
      if (next.truncated && onToast) onToast(`Dataset truncated to ${MAX_IMPORT_ROWS} rows / ${MAX_IMPORT_COLS} cols`);
      if (opts?.showToasts !== false && onToast) onToast('Refreshed');
    } catch (e: any) {
      const msg = e?.message || 'Refresh failed';
      updateSheet(data.id, {
        connectorConfig: {
          ...data.connectorConfig!,
          params: {
            ...data.connectorConfig!.params,
            lastError: msg
          }
        }
      });
      if (onToast) onToast(msg);
    } finally {
      setIsGoogleAnalyticsRefreshing(false);
    }
  };

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
	    const handleWheel = (e: WheelEvent) => {
	        e.stopPropagation();
	    };
	    grid.addEventListener('wheel', handleWheel, { passive: true });
	    return () => grid.removeEventListener('wheel', handleWheel);
	  }, []);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!selected) {
        setActiveCell(null);
        setSelectionRange(null);
        setIsEditing(false);
        setEditingRaw(null);
        setSuggestions([]);
        setHeaderMenuOpen(null);
        setRowMenuOpen(null);
        setFormulaDragStart(null);
        onSelectionContextChange?.({ sheetId: null, cellId: null, range: null });
    }
  }, [selected, onSelectionContextChange]);

  // eslint-disable-next-line react-hooks/rules-of-hooks
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

  const visibleRowIndices = useMemo(() => {
      const filtered = getFilteredRows(data, contentDimensions.rows - 1);
      if (!filtered) return null; 
      return filtered;
  }, [data.cells, data.filters, data.sort, data.size.height, contentDimensions]);

  const displayRowByActualRow = useMemo(() => {
      if (!visibleRowIndices) return null;
      const map = new Map<number, number>();
      visibleRowIndices.forEach((actualRow, displayRow) => {
          map.set(actualRow, displayRow);
      });
      return map;
  }, [visibleRowIndices]);

  const recordCounts = useMemo(() => {
    const totalCount = Math.max(0, contentDimensions.rows - 1);
    let filteredCount = totalCount;
    if (visibleRowIndices) {
        filteredCount = visibleRowIndices.filter(r => r > 0 && r < contentDimensions.rows).length;
    }
    return { totalCount, filteredCount };
  }, [contentDimensions.rows, visibleRowIndices]);

  const effectiveRowCount = visibleRowIndices ? visibleRowIndices.length : Math.max(data.size.height, contentDimensions.rows);
  const effectiveColCount = Math.max(data.size.width, contentDimensions.cols);

  const getColWidth = (index: number) => data.colWidths?.[String(index)] ?? CELL_WIDTH;

  const rowVirtualizer = useVirtualizer({
      count: effectiveRowCount,
      getScrollElement: () => gridRef.current,
      estimateSize: () => CELL_HEIGHT,
      overscan: 5
  });

  const colVirtualizer = useVirtualizer({
      count: effectiveColCount,
      getScrollElement: () => gridRef.current,
      estimateSize: (index) => getColWidth(index),
      horizontal: true,
      overscan: 2
  });

  // Force measure when column widths change to fix resize bug
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
      colVirtualizer.measure();
  }, [data.colWidths, colVirtualizer]);

  const visibleTableWidth = useMemo(() => {
    let w = 0;
    for (let i = 0; i < data.size.width; i++) {
        w += data.colWidths?.[String(i)] ?? CELL_WIDTH;
    }
    return w;
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

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    if (!isEditingTitle) {
        setTitleInputValue(data.title);
    }
  }, [data.title, isEditingTitle]);

  const commitTitleEdit = () => {
    if (titleInputValue.trim() && titleInputValue !== data.title) {
        saveSnapshot();
        updateSheet(data.id, { title: titleInputValue });
    } else {
        setTitleInputValue(data.title);
    }
    setIsEditingTitle(false);
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

  const stats = useMemo(() => {
    if (!selectionRange) return null;
    const minCol = Math.min(selectionRange.start.col, selectionRange.end.col);
    const maxCol = Math.max(selectionRange.start.col, selectionRange.end.col);
    const selectedRows = (() => {
        if (!visibleRowIndices || !displayRowByActualRow) {
            const minRow = Math.min(selectionRange.start.row, selectionRange.end.row);
            const maxRow = Math.max(selectionRange.start.row, selectionRange.end.row);
            return Array.from({ length: maxRow - minRow + 1 }, (_, i) => minRow + i);
        }

        const startDisplay = displayRowByActualRow.get(selectionRange.start.row);
        const endDisplay = displayRowByActualRow.get(selectionRange.end.row);
        const minDisplay = Math.min(startDisplay ?? 0, endDisplay ?? 0);
        const maxDisplay = Math.max(
            startDisplay ?? (visibleRowIndices.length - 1),
            endDisplay ?? (visibleRowIndices.length - 1)
        );
        return visibleRowIndices.slice(minDisplay, maxDisplay + 1);
    })();

    const numericValues: number[] = [];
    let nonEmptyCount = 0;
    
    for (const actualRow of selectedRows) {
        for (let c = minCol; c <= maxCol; c++) {
            const id = getCellId(c, actualRow);
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
  }, [selectionRange, data.cells, visibleRowIndices, displayRowByActualRow]);

  const formatStat = (val: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(val);

  const handleEditChange = (val: string) => {
    setEditingRaw(val);
    if (val.includes(':')) {
        setSuggestions([]);
        return;
    }
    
    if (val.startsWith('=')) {
        if (val === '=') {
            setSuggestions(SUPPORTED_FORMULAS);
            setSelectedSuggestionIndex(0);
            return;
        }

        const match = val.match(/([a-zA-Z]+)$/);
        if (match) {
            const keyword = match[1].toUpperCase();
            const filtered = SUPPORTED_FORMULAS.filter(f => f.startsWith(keyword));
            
            if (filtered.length > 0) {
                 setSuggestions(filtered);
                 setSelectedSuggestionIndex(0);
                 return;
            }
        }
    }
    setSuggestions([]);
  };

  const handleSuggestionSelect = (suggestion: string) => {
      if (editingRaw) {
          let newVal;
          if (editingRaw === '=') {
              newVal = '=' + suggestion + '(';
          } else {
              newVal = editingRaw.replace(/([a-zA-Z]+)$/, suggestion + '(');
          }
          setEditingRaw(newVal);
          setSuggestions([]);
      }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (document.body.dataset.modalOpen === 'true') return;

    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    if (isEditing || isEditingTitle) return;

    if (!activeCell) {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) {
             e.preventDefault();
             const startId = getCellId(0, 0);
             setActiveCell(startId);
             setSelectionRange({ start: { col: 0, row: 0 }, end: { col: 0, row: 0 } });
        }
        return;
    }
    
    const pos = parseCellId(activeCell);
    if (!pos) return;

    const moveSelection = (dRow: number, dCol: number) => {
        const maxCol = Math.max(data.size.width, contentDimensions.cols) - 1;
        const maxRow = visibleRowIndices ? effectiveRowCount - 1 : Math.max(data.size.height, contentDimensions.rows) - 1;

        if (e.shiftKey && selectionRange) {
            const currentHead = selectionRange.end;
            const currentDisplayRow =
                visibleRowIndices && displayRowByActualRow ? (displayRowByActualRow.get(currentHead.row) ?? 0) : currentHead.row;
            const nextDisplayRow = Math.max(0, Math.min(maxRow, currentDisplayRow + dRow));
            const nextRow = visibleRowIndices ? (visibleRowIndices[nextDisplayRow] ?? currentHead.row) : nextDisplayRow;
            const nextCol = Math.max(0, Math.min(maxCol, currentHead.col + dCol));
            
            setSelectionRange({ 
                start: selectionRange.start, 
                end: { col: nextCol, row: nextRow } 
            });
            
            rowVirtualizer.scrollToIndex(nextDisplayRow);
            colVirtualizer.scrollToIndex(nextCol);
        } else {
            const currentDisplayRow =
                visibleRowIndices && displayRowByActualRow ? (displayRowByActualRow.get(pos.row) ?? 0) : pos.row;
            const nextDisplayRow = Math.max(0, Math.min(maxRow, currentDisplayRow + dRow));
            const nextRow = visibleRowIndices ? (visibleRowIndices[nextDisplayRow] ?? pos.row) : nextDisplayRow;
            const nextCol = Math.max(0, Math.min(maxCol, pos.col + dCol));
            
            const nextId = getCellId(nextCol, nextRow);
            
            setActiveCell(nextId);
            setSelectionRange({ start: { col: nextCol, row: nextRow }, end: { col: nextCol, row: nextRow } });
            
            rowVirtualizer.scrollToIndex(nextDisplayRow);
            colVirtualizer.scrollToIndex(nextCol);
        }
    };

    if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveSelection(-1, 0);
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        moveSelection(1, 0);
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        moveSelection(0, -1);
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        moveSelection(0, 1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!isReadOnly) {
            setIsEditing(true);
            const initialRaw = data.cells[activeCell]?.raw || '';
            setEditingRaw(initialRaw);
            if (initialRaw.startsWith('=')) handleEditChange(initialRaw);
        }
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        if (!isReadOnly) {
            saveSnapshot();
            updateSheet(data.id, { 
                cells: { 
                    ...data.cells, 
                    [activeCell]: { ...data.cells[activeCell], raw: '', value: null } 
                } 
            });
        }
    } else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
        if (!isReadOnly) {
            e.preventDefault();
            setIsEditing(true);
            const val = e.key;
            setEditingRaw(val);
            if (val === '=') handleEditChange(val);
        }
    }
  };

  const applyColumnFormat = (colIndices: number[], updates: any) => {
    saveSnapshot();
    const newCells = { ...data.cells };
    let hasChanges = false;
    const indicesSet = new Set(colIndices);

    Object.keys(newCells).forEach(key => {
       const pos = parseCellId(key);
       if (pos && indicesSet.has(pos.col)) {
           const cell = newCells[key];
           const currentFormat = cell.format || { type: 'text' };
           let newFormat: CellFormat = { ...currentFormat, ...updates };
           
           if (updates.type === 'text') { delete (newFormat as any).decimals; delete (newFormat as any).symbol; delete (newFormat as any).dateFormat; }
           
           if (JSON.stringify(cell.format) !== JSON.stringify(newFormat)) {
               newCells[key] = { ...cell, format: newFormat };
               hasChanges = true;
           }
       }
    });

    if (hasChanges) {
        updateSheet(data.id, { cells: newCells });
    }
  };
  
  const applyRowFormat = (rowIndex: number, updates: any) => {
    saveSnapshot();
    const newCells = { ...data.cells };
    let hasChanges = false;
    
    Object.keys(newCells).forEach(key => {
       const pos = parseCellId(key);
       if (pos && pos.row === rowIndex) {
           const cell = newCells[key];
           const currentFormat = cell.format || { type: 'text' };
           let newFormat: CellFormat = { ...currentFormat, ...updates };
           
           if (JSON.stringify(cell.format) !== JSON.stringify(newFormat)) {
               newCells[key] = { ...cell, format: newFormat };
               hasChanges = true;
           }
       }
    });

    if (hasChanges) {
        updateSheet(data.id, { cells: newCells });
    }
  };

  const handleColMenuAction = (colIndex: number, action: string, param?: any) => {
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
        updateSheet(data.id, { showFilterPanel: true });
    } else if (action === 'sort-asc') {
        saveSnapshot();
        updateSheet(data.id, { sort: { columnId: colId, direction: 'asc' } });
    } else if (action === 'sort-desc') {
        saveSnapshot();
        updateSheet(data.id, { sort: { columnId: colId, direction: 'desc' } });
    } else if (action === 'sort-toggle') {
        saveSnapshot();
        const currentSort = data.sort;
        let nextSort;
        if (currentSort?.columnId === colId) {
            if (currentSort.direction === 'asc') {
                nextSort = { columnId: colId, direction: 'desc' };
            } else {
                nextSort = undefined; // toggle to none
            }
        } else {
             nextSort = { columnId: colId, direction: 'asc' };
        }
        updateSheet(data.id, { sort: nextSort as any });
    } else if (action === 'chart' && onAddChart) {
        let chartSelectedCols = getSelectedColumns();
        if (chartSelectedCols && !chartSelectedCols.includes(colIndex)) chartSelectedCols = undefined;
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
        if (param) applyColumnFormat(targetCols, { visual: 'heatmap', heatmapColor: param });
        else applyColumnFormat(targetCols, { visual: isActive ? null : 'heatmap' });
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
    } else if (action === 'd3-custom') {
        applyColumnFormat(targetCols, { type: 'number', d3Format: param });
    } else if (action === 'delete-col') {
        saveSnapshot();
        const newCells: Record<string, CellData> = {};
        const newColWidths: Record<string, number> = {};
        
        Object.keys(data.cells).forEach(key => {
            const pos = parseCellId(key);
            if (!pos) return;
            
            if (pos.col === colIndex) {
                // Skip deleted col
            } else if (pos.col > colIndex) {
                const newKey = getCellId(pos.col - 1, pos.row);
                newCells[newKey] = data.cells[key];
            } else {
                newCells[key] = data.cells[key];
            }
        });

        if (data.colWidths) {
             Object.keys(data.colWidths).forEach(k => {
                const cIdx = parseInt(k, 10);
                if (cIdx === colIndex) {
                    // skip
                } else if (cIdx > colIndex) {
                    newColWidths[String(cIdx - 1)] = data.colWidths[k];
                } else {
                    newColWidths[k] = data.colWidths[k];
                }
             });
        }

        updateSheet(data.id, { 
            size: { ...data.size, width: Math.max(1, data.size.width - 1) }, 
            cells: newCells, 
            colWidths: newColWidths 
        });
    } else if (action === 'clear-col') {
        saveSnapshot();
        const newCells = { ...data.cells };
        Object.keys(newCells).forEach(key => {
            const pos = parseCellId(key);
            if (pos && pos.col === colIndex && pos.row > 0) {
                delete newCells[key];
            }
        });
        updateSheet(data.id, { cells: newCells });
    } else if (['number', 'currency', 'percent', 'text'].includes(action)) {
        applyColumnFormat(targetCols, { 
            type: action as any, 
            d3Format: action === 'percent' ? '.2%' : '' 
        });
    } else if (action === 'insert-left' || action === 'insert-right') {
        saveSnapshot();
        const targetIndex = action === 'insert-left' ? colIndex : colIndex + 1;
        const newCells: Record<string, CellData> = {};
        const newColWidths: Record<string, number> = {};
        
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
        if (data.colWidths) {
            Object.keys(data.colWidths).forEach(k => {
                const cIdx = parseInt(k, 10);
                if (cIdx >= targetIndex) newColWidths[String(cIdx + 1)] = data.colWidths[k];
                else newColWidths[k] = data.colWidths[k];
            });
            newColWidths[String(targetIndex)] = CELL_WIDTH; 
        }
        updateSheet(data.id, { size: { ...data.size, width: data.size.width + 1 }, cells: newCells, colWidths: newColWidths });
    }
    setHeaderMenuOpen(null);
  };

  const handleRowMenuAction = (rowIndex: number, action: string, param?: any) => {
    if (action === 'bar-row') applyRowFormat(rowIndex, { visual: 'bar-row' });
    else if (action === 'heatmap-row') applyRowFormat(rowIndex, { visual: 'heatmap-row' });
    else if (action === 'date') applyRowFormat(rowIndex, { type: 'date', dateFormat: param });
    else if (action === 'number-compact') applyRowFormat(rowIndex, { type: 'number', d3Format: '.2s' });
    else if (action === 'number-expand') applyRowFormat(rowIndex, { type: 'number', d3Format: '' });
    else if (action === 'currency-compact') applyRowFormat(rowIndex, { type: 'currency', d3Format: '$.2s' });
    else if (action === 'currency-expand') applyRowFormat(rowIndex, { type: 'currency', d3Format: '' });
    else if (action === 'd3-custom') applyRowFormat(rowIndex, { type: 'number', d3Format: param });
    else if (['number', 'currency', 'percent', 'text'].includes(action)) applyRowFormat(rowIndex, { 
        type: action as any, 
        d3Format: action === 'percent' ? '.2%' : '' 
    });
    else if (action === 'insert-above' || action === 'insert-below') {
        saveSnapshot();
        const targetIndex = action === 'insert-above' ? rowIndex : rowIndex + 1;
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
        updateSheet(data.id, { size: { ...data.size, height: data.size.height + 1 }, cells: newCells });
    } else if (action === 'delete-row') {
        saveSnapshot();
        const newCells: Record<string, CellData> = {};
        Object.keys(data.cells).forEach(key => {
            const pos = parseCellId(key);
            if (!pos) return;
            if (pos.row === rowIndex) {
                // skip
            } else if (pos.row > rowIndex) {
                const newKey = getCellId(pos.col, pos.row - 1);
                newCells[newKey] = data.cells[key];
            } else {
                newCells[key] = data.cells[key];
            }
        });
        updateSheet(data.id, { size: { ...data.size, height: Math.max(1, data.size.height - 1) }, cells: newCells });
    } else if (action === 'clear-row') {
        saveSnapshot();
        const newCells = { ...data.cells };
        Object.keys(newCells).forEach(key => {
            const pos = parseCellId(key);
            if (pos && pos.row === rowIndex) {
                delete newCells[key];
            }
        });
        updateSheet(data.id, { cells: newCells });
    }

    setRowMenuOpen(null);
  };

  const commitEdit = (nextCellId: string | null = null, refocus: boolean = true) => {
    if (isReadOnly) { setIsEditing(false); return; }
    if (activeCell && editingRaw !== null) {
        saveSnapshot();
        const currentCell = data.cells[activeCell] || { raw: '', value: null };
        let newFormat = currentCell.format;
        const trimmed = editingRaw.trim();
        if (!trimmed.startsWith('=') && trimmed.endsWith('%')) {
             const valStr = trimmed.slice(0, -1);
             if (!isNaN(parseFloat(valStr))) newFormat = { ...newFormat, type: 'percent', d3Format: '.2%' };
        }
        const newCell = { ...currentCell, raw: editingRaw, value: null, format: newFormat };
        updateSheet(data.id, { cells: { ...data.cells, [activeCell]: newCell } });
    }
    setIsEditing(false);
    setEditingRaw(null);
    setSuggestions([]);
    setFormulaDragStart(null);
    
    if (nextCellId) {
        setActiveCell(nextCellId);
        const nextPos = parseCellId(nextCellId);
        if (nextPos) {
            setSelectionRange({ start: nextPos, end: nextPos });
            const nextDisplayRow =
                visibleRowIndices && displayRowByActualRow
                    ? (displayRowByActualRow.get(nextPos.row) ?? 0)
                    : nextPos.row;
            rowVirtualizer.scrollToIndex(nextDisplayRow);
            colVirtualizer.scrollToIndex(nextPos.col);
        }
    }

    if (refocus && containerRef.current) {
        containerRef.current.focus({ preventScroll: true });
    }
  };

  const handleCellMouseDown = (e: React.MouseEvent, cellId: string) => {
     e.stopPropagation();
     
     if (!selected) {
         select([data.id]);
     }

     if (isEditing) {
         const raw = editingRaw || '';
         const triggerRegex = /([=+\-*/,:(])\s*$/;
         const refRegex = /([=+\-*/,:(])\s*([A-Z]+[0-9]+)$/i; 
         const rangeRegex = /([=+\-*/,:(])\s*([A-Z]+[0-9]+:[A-Z]+[0-9]+)$/i;
         
         const isTrigger = triggerRegex.test(raw) || raw === '';
         const refMatch = raw.match(refRegex);
         const rangeMatch = raw.match(rangeRegex);

         if (isTrigger || refMatch || rangeMatch) {
             e.preventDefault(); 
             
             let prefix = raw;
             
             if (rangeMatch) {
                 prefix = raw.substring(0, raw.length - rangeMatch[2].length);
             } else if (refMatch) {
                 prefix = raw.substring(0, raw.length - refMatch[2].length);
             }
             
             setFormulaDragStart(cellId);
             setFormulaDragPrefix(prefix);
             setEditingRaw(prefix + cellId);
             setSuggestions([]);
             return;
         }
         
         commitEdit(null, true);
     }
     
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

  const handleCellMouseEnter = (cellId: string) => {
      if (formulaDragStart && formulaDragPrefix !== null) {
          const start = formulaDragStart;
          const end = cellId;
          const range = start === end ? start : `${start}:${end}`;
          setEditingRaw(formulaDragPrefix + range);
          return;
      }

      if (isSelecting && activeCell) {
          const start = parseCellId(activeCell);
          const end = parseCellId(cellId);
          if (start && end) {
              setSelectionRange({ start, end });
          }
      }
  };

  const handleAutoResize = (colIndex: number) => {
      saveSnapshot();
      const padding = 24; 
      const minWidth = MIN_COL_WIDTH;
      const maxWidth = 600; 
      
      let maxContentWidth = minWidth;

      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      if (context) {
          context.font = '13px Inter, sans-serif'; 
      }

      // Header width check
      const colLabel = getCellId(colIndex, -1).replace(/[0-9]/g, '');
      if (context) {
          context.font = '500 10px Inter, sans-serif'; 
          const headerWidth = context.measureText(colLabel).width + padding;
          maxContentWidth = Math.max(maxContentWidth, headerWidth);
          context.font = '13px Inter, sans-serif'; // Reset
      }

      const rowsToScan = visibleRowIndices || Array.from({ length: data.size.height }, (_, i) => i);

      for (const r of rowsToScan) {
          const cellId = getCellId(colIndex, r);
          const cell = data.cells[cellId];
          
          if (cell) {
              const text = formatValue(cell.value, cell.format);
              if (context) {
                  const width = context.measureText(text).width + padding;
                  maxContentWidth = Math.max(maxContentWidth, width);
              }
          }
      }

      const finalWidth = Math.min(maxWidth, Math.max(minWidth, Math.ceil(maxContentWidth)));

      updateSheet(data.id, { 
          colWidths: { ...data.colWidths, [String(colIndex)]: finalWidth } 
      });
  };

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const commitQueuedResizeUpdates = () => {
      const currentData = dataRef.current;
      if (!currentData) return;

      const patch: Partial<SheetData> = {};

      const colUpdate = queuedColWidthRef.current;
      if (colUpdate) {
        const key = String(colUpdate.index);
        const existingWidth = currentData.colWidths?.[key];
        if (existingWidth !== colUpdate.width) {
          patch.colWidths = { ...currentData.colWidths, [key]: colUpdate.width };
        }
      }

      const sizeUpdate = queuedSizeRef.current;
      if (sizeUpdate) {
        if (sizeUpdate.width !== currentData.size.width || sizeUpdate.height !== currentData.size.height) {
          patch.size = { width: sizeUpdate.width, height: sizeUpdate.height };
        }
      }

      queuedColWidthRef.current = null;
      queuedSizeRef.current = null;

      if (Object.keys(patch).length > 0) {
        updateSheetRef.current(currentData.id, patch);
      }
    };

    const scheduleResizeCommit = () => {
      if (resizeRafIdRef.current !== null) return;
      resizeRafIdRef.current = requestAnimationFrame(() => {
        resizeRafIdRef.current = null;
        commitQueuedResizeUpdates();
      });
    };

    const handleMouseUp = () => {
      if (resizeRafIdRef.current !== null) {
        cancelAnimationFrame(resizeRafIdRef.current);
        resizeRafIdRef.current = null;
      }
      commitQueuedResizeUpdates();

      setIsSelecting(false);
      setColResizing(null);
      setResizing(null);
      setFormulaDragStart(null);
      setFormulaDragPrefix(null);
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      const currentData = dataRef.current;
      if (!currentData) return;

      const currentScale = scaleRef.current || 1;

      const activeColResizing = colResizingRef.current;
      if (activeColResizing) {
        const dx = (e.clientX - activeColResizing.startX) / currentScale;
        const newWidth = Math.max(MIN_COL_WIDTH, activeColResizing.startWidth + dx);
        queuedColWidthRef.current = { index: activeColResizing.index, width: newWidth };
      }

      const activeResizing = resizingRef.current;
      if (activeResizing) {
        const dx = (e.clientX - activeResizing.startX) / currentScale;
        const dy = (e.clientY - activeResizing.startY) / currentScale;
        let newCols = activeResizing.startCols;
        let newRows = activeResizing.startRows;
        if (activeResizing.type === 'right' || activeResizing.type === 'corner') {
          const deltaCols = Math.round(dx / CELL_WIDTH);
          newCols = Math.max(1, activeResizing.startCols + deltaCols);
        }
        if (activeResizing.type === 'bottom' || activeResizing.type === 'corner') {
          const deltaRows = Math.round(dy / CELL_HEIGHT);
          newRows = Math.max(1, activeResizing.startRows + deltaRows);
        }
        if (newCols !== currentData.size.width || newRows !== currentData.size.height) {
          queuedSizeRef.current = { width: newCols, height: newRows };
        }
      }

      if (queuedColWidthRef.current || queuedSizeRef.current) scheduleResizeCommit();
    };
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mousemove', handleMouseMove);
      if (resizeRafIdRef.current !== null) {
        cancelAnimationFrame(resizeRafIdRef.current);
        resizeRafIdRef.current = null;
      }
    };
  }, []);

  const handleCopyImage = async () => {
    if (!containerRef.current) return;
    setIsExporting(true);
    try {
        await document.fonts.ready;
        const canvas = await html2canvas(containerRef.current, { backgroundColor: null, scale: 2, useCORS: true, logging: false });
        canvas.toBlob(async (blob) => {
            if (blob) {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                if (onToast) onToast("Sheet copied to clipboard as image");
            }
        });
    } catch (err) { console.error(err); if (onToast) onToast("Failed to copy"); } 
    finally { setIsExporting(false); }
  };

  const windowHeight = (data.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

  const handleResizeStart = (e: React.MouseEvent, type: 'right' | 'bottom' | 'corner') => {
      e.preventDefault(); e.stopPropagation();
      saveSnapshot();
      setResizing({ type, startX: e.clientX, startY: e.clientY, startCols: data.size.width, startRows: data.size.height });
  };

  const selBounds = useMemo(() => {
      if (!selectionRange) return { minCol: -1, maxCol: -1, minRow: -1, maxRow: -1 };
      if (visibleRowIndices && displayRowByActualRow) {
          const startDisplay = displayRowByActualRow.get(selectionRange.start.row);
          const endDisplay = displayRowByActualRow.get(selectionRange.end.row);
          const minRow = Math.min(startDisplay ?? 0, endDisplay ?? 0);
          const maxRow = Math.max(
              startDisplay ?? (visibleRowIndices.length - 1),
              endDisplay ?? (visibleRowIndices.length - 1)
          );
          return {
              minCol: Math.min(selectionRange.start.col, selectionRange.end.col),
              maxCol: Math.max(selectionRange.start.col, selectionRange.end.col),
              minRow,
              maxRow
          };
      }
      return {
          minCol: Math.min(selectionRange.start.col, selectionRange.end.col),
          maxCol: Math.max(selectionRange.start.col, selectionRange.end.col),
          minRow: Math.min(selectionRange.start.row, selectionRange.end.row),
          maxRow: Math.max(selectionRange.start.row, selectionRange.end.row)
      };
  }, [selectionRange, visibleRowIndices, displayRowByActualRow]);

  return (
    <div 
      id={`sheet-${data.id}`}
      ref={containerRef}
      className={`absolute flex flex-col bg-white dark:bg-neutral-850 rounded-xl transition-shadow transition-colors duration-200 outline-none group border 
        ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-md z-30'}
        ${isPendingDelete ? 'animate-delete-pulse' : ''}
      `}
      style={{ left: data.position.x, top: data.position.y, width: visibleTableWidth + HEADER_COL_WIDTH + 2 }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => { 
          e.stopPropagation(); 
          if ((e.target as HTMLElement).tagName !== 'INPUT') {
              if (containerRef.current) containerRef.current.focus(); 
          }
          setHeaderMenuOpen(null); 
          setRowMenuOpen(null); 
      }}
    >
      <div className="flex flex-col rounded-t-xl overflow-hidden">
        <div 
            className="h-9 flex items-center justify-between px-3 cursor-grab active:cursor-grabbing bg-white dark:bg-neutral-850 border-b border-neutral-100 dark:border-neutral-800"
            onMouseDown={(e) => { onMouseDown(e); setActiveCell(null); setSelectionRange(null); setIsEditing(false); setHeaderMenuOpen(null); setRowMenuOpen(null); }}
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
                        onKeyDown={(e) => { if (e.key === 'Enter') commitTitleEdit(); e.stopPropagation(); }}
                        autoFocus
                        onMouseDown={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span className="truncate cursor-text hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded px-1.5 py-0.5 -ml-1.5 transition-colors" onDoubleClick={(e) => { e.stopPropagation(); setIsEditingTitle(true); }}>
                        {data.title}
                    </span>
                )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => updateSheet(data.id, { showFilterPanel: !showFilterPanel })} className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${showFilterPanel || (data.filters && data.filters.length > 0) ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                    <Filter size={14} />
                </button>
                <button onClick={handleCopyImage} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" disabled={isExporting}>
                    {isExporting ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                </button>
                {isGoogleAnalyticsConnected && !isGoogleAnalyticsSimulated && (
                    <button
                        onClick={() => refreshGoogleAnalytics({ showToasts: true })}
                        disabled={isGoogleAnalyticsRefreshing}
                        className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${
                            isGoogleAnalyticsRefreshing ? 'bg-neutral-100 dark:bg-neutral-800 cursor-not-allowed' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                        title={lastRefreshedAt ? `Refresh (last: ${new Date(lastRefreshedAt).toLocaleString()})` : 'Refresh'}
                    >
                        {isGoogleAnalyticsRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                    </button>
                )}
                {isClickhouseConnected && (
                    <>
                        <button
                            onClick={() => refreshClickhouse({ showToasts: true })}
                            disabled={isClickhouseRefreshing}
                            className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${
                                isClickhouseRefreshing ? 'bg-neutral-100 dark:bg-neutral-800 cursor-not-allowed' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                            title={lastRefreshedAt ? `Refresh (last: ${new Date(lastRefreshedAt).toLocaleString()})` : 'Refresh'}
                        >
                            {isClickhouseRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
                        </button>
                        <button
                            onClick={() => {
                                const next = !showClickhouseSql;
                                setShowClickhouseSql(next);
                                if (next) setClickhouseSqlDraft(String(data.connectorConfig?.params?.sql || ''));
                            }}
                            className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${
                                showClickhouseSql ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
                            }`}
                            title="Edit SQL"
                        >
                            <Code2 size={14} />
                        </button>
                    </>
                )}
                {isPivot && (
                    <button onClick={() => setShowPivotConfig(!showPivotConfig)} className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${showPivotConfig ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                        <Settings2 size={14} />
                    </button>
                )}
                {isSparkline && (
                     <button onClick={() => setShowSparklineConfig(!showSparklineConfig)} className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${showSparklineConfig ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                        <Settings2 size={14} />
                    </button>
                )}
                {!isPivot && !isSparkline && (
                    <>
                        <button onClick={() => { const colIndex = activeCell ? parseCellId(activeCell)?.col : undefined; if(onAddPivot) onAddPivot(data.id, colIndex); }} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" title="Create Pivot Table">
                            <Table size={14} />
                        </button>
                        <button onClick={() => { if(onAddSparkline) onAddSparkline(data.id); }} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" title="Create Sparklines">
                            <TrendingUp size={14} />
                        </button>
                    </>
                )}
                <button onClick={() => { const colIndex = activeCell ? parseCellId(activeCell)?.col : undefined; const selectedCols = getSelectedColumns(); if (onAddChart) onAddChart(data.id, colIndex, selectedCols); }} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors">
                    <BarChart3 size={14} />
                </button>
                <button onClick={() => deleteSheet(data.id)} className="group/btn relative text-neutral-400 hover:text-neutral-600 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors"><Trash2 size={14} /></button>
            </div>
        </div>
        
        {showFilterPanel && (
            <FilterPanel 
                sheet={data} 
                onChange={(newFilters) => { saveSnapshot(); updateSheet(data.id, { filters: newFilters }); }} 
                onClose={() => updateSheet(data.id, { showFilterPanel: false })} 
                preselectedCol={preselectedFilterCol}
                filteredCount={recordCounts.filteredCount}
                totalCount={recordCounts.totalCount}
            />
        )}
        {showClickhouseSql && isClickhouseConnected && (
            <div className="border-t border-neutral-100 dark:border-neutral-800 bg-neutral-50/60 dark:bg-neutral-900/40 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400 mb-2">
                    SQL
                </div>
                <textarea
                    className="w-full min-h-[120px] bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm font-mono text-neutral-900 dark:text-neutral-100 outline-none focus:ring-2 focus:ring-teal-500/50"
                    value={clickhouseSqlDraft}
                    onChange={(e) => setClickhouseSqlDraft(e.target.value)}
                    placeholder="SELECT ..."
                />
                <div className="flex justify-end gap-2 mt-2">
                    <button
                        onClick={() => setShowClickhouseSql(false)}
                        className="px-3 py-1.5 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={() => {
                            const sql = clickhouseSqlDraft.trim();
                            if (!sql) return;
                            saveSnapshot();
                            updateSheet(data.id, {
                                connectorConfig: {
                                    ...data.connectorConfig!,
                                    params: { ...data.connectorConfig!.params, sql }
                                }
                            });
                            setShowClickhouseSql(false);
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-200 bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 rounded-lg transition-colors"
                    >
                        Save
                    </button>
                    <button
                        onClick={async () => {
                            const sql = clickhouseSqlDraft.trim();
                            if (!sql) return;
                            setShowClickhouseSql(false);
                            await refreshClickhouse({ sqlOverride: sql, showToasts: true });
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                    >
                        Save & Refresh
                    </button>
                </div>
            </div>
        )}
      </div>

      <div 
        ref={gridRef}
        className={`bg-white dark:bg-neutral-850 cursor-text select-none overflow-auto relative rounded-b-xl sheet-scroll ${selected ? 'sheet-scroll-active' : ''}`}
        style={{ height: windowHeight }}
      >
        {(isSetup || showPivotConfig) && isPivot && (
            <div className="absolute inset-0 z-50 bg-white dark:bg-neutral-850 flex flex-col">
                <PivotConfigPanel 
                    sourceSheet={sourceSheet}
                    initialConfig={data.pivotConfig}
                    isSetupMode={isSetup}
                    onConfirm={(newConfig) => {
                         saveSnapshot();
                         updateSheet(data.id, { pivotConfig: newConfig, setupRequired: false });
                         setShowPivotConfig(false);
                    }}
                    onCancel={() => { if (isSetup) deleteSheet(data.id); else setShowPivotConfig(false); }}
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
                         saveSnapshot();
                         updateSheet(data.id, { sparklineConfig: newConfig, setupRequired: false });
                         setShowSparklineConfig(false);
                    }}
                    onCancel={() => { if (isSetup) deleteSheet(data.id); else setShowSparklineConfig(false); }}
                />
            </div>
        )}

        {(!isSetup) && (
            <div
                style={{
                    height: `${rowVirtualizer.getTotalSize() + HEADER_ROW_HEIGHT}px`,
                    width: `${colVirtualizer.getTotalSize() + HEADER_COL_WIDTH}px`,
                    position: 'relative',
                }}
            >
                {/* 1. Corner (Sticky Top & Left) */}
                <div
                    className="sticky top-0 left-0 z-50 bg-white dark:bg-neutral-850 border-r border-b border-neutral-100 dark:border-neutral-800"
                    style={{ width: HEADER_COL_WIDTH, height: HEADER_ROW_HEIGHT }}
                />

                {/* 2. Col Headers (Sticky Top) */}
                <div 
                    className="sticky top-0 z-40 bg-white/95 dark:bg-neutral-850/95 border-b border-neutral-100 dark:border-neutral-800 flex"
                    style={{ 
                        width: '100%', 
                        height: HEADER_ROW_HEIGHT, 
                        marginTop: `-${HEADER_ROW_HEIGHT}px`, 
                        paddingLeft: HEADER_COL_WIDTH 
                    }}
                >
                    {colVirtualizer.getVirtualItems().map((virtualCol) => {
                        const c = virtualCol.index;
                        const colLabel = getCellId(c, -1).replace(/[0-9]/g, '');
                        const isActiveCol = activeCell && parseCellId(activeCell)?.col === c;
                        const isSelectedCol = selectionRange && c >= selBounds.minCol && c <= selBounds.maxCol;
                        const colWidth = virtualCol.size;
                        const clickedColFirstCellId = getCellId(c, 0); 
                        const clickedColFormat = data.cells[clickedColFirstCellId]?.format;

                        return (
                            <div 
                                key={virtualCol.key}
                                style={{
                                    position: 'absolute',
                                    left: virtualCol.start + HEADER_COL_WIDTH,
                                    width: virtualCol.size,
                                    height: HEADER_ROW_HEIGHT
                                }}
                                onMouseDown={(e) => { 
                                    e.stopPropagation(); setHeaderMenuOpen(null); setRowMenuOpen(null);
                                    if (isEditing) commitEdit(); 
                                    setSelectionRange({ start: { col: c, row: 0 }, end: { col: c, row: data.size.height - 1 } }); 
                                    setActiveCell(getCellId(c, 0)); 
                                    const initialRaw = data.cells[getCellId(c, 0)]?.raw || '';
                                    setEditingRaw(initialRaw);
                                    if(initialRaw.startsWith('=')) handleEditChange(initialRaw);
                                }}
                                className={`group/col flex items-center justify-center text-[10px] font-medium select-none cursor-pointer border-r border-neutral-100 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-700
                                    ${isSelectedCol ? 'bg-teal-50/50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400' : 
                                    (isActiveCol ? 'bg-neutral-50 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400' : 'bg-transparent text-neutral-400 dark:text-neutral-500')}
                                `}
                            >
                                <span>{colLabel}</span>
                                <button 
                                    onMouseDown={(e) => { e.stopPropagation(); setHeaderMenuOpen(headerMenuOpen === c ? null : c); setRowMenuOpen(null); }}
                                    className={`absolute right-1 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 transition-opacity ${isActiveCol || isSelectedCol ? 'opacity-100' : 'opacity-0 group-hover/col:opacity-100'}`}
                                >
                                    <MoreVertical size={10} />
                                </button>
                                <SheetColumnMenu 
                                    colIndex={c} 
                                    isOpen={headerMenuOpen === c} 
                                    onClose={() => setHeaderMenuOpen(null)}
                                    onAction={(action, param) => handleColMenuAction(c, action, param)}
                                    currentFormat={clickedColFormat}
                                    isReadOnly={isReadOnly}
                                />
                                <div 
                                    className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-teal-400/50 z-40 opacity-0 hover:opacity-100 transition-opacity"
                                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); saveSnapshot(); setColResizing({ index: c, startX: e.clientX, startWidth: colWidth }); }}
                                    onDoubleClick={(e) => { e.preventDefault(); e.stopPropagation(); handleAutoResize(c); }}
                                />
                            </div>
                        );
                    })}
                </div>

                {/* 3. Row Headers (Sticky Left) */}
                <div 
                    className="sticky left-0 z-30 bg-white/95 dark:bg-neutral-850/95 border-r border-neutral-100 dark:border-neutral-800"
                    style={{ 
                        width: HEADER_COL_WIDTH, 
                        height: rowVirtualizer.getTotalSize(),
                    }}
                >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const rIndex = virtualRow.index;
                        const actualRowIdx = visibleRowIndices ? visibleRowIndices[rIndex] : rIndex;
                        const isActiveRow = activeCell && parseCellId(activeCell)?.row === actualRowIdx;
                        const isSelectedRow = selectionRange && rIndex >= selBounds.minRow && rIndex <= selBounds.maxRow;
                        const isHeaderRow = actualRowIdx === 0;
                        const isGrandTotal = isPivot && String(data.cells[getCellId(0, actualRowIdx)]?.value) === 'Grand Total';

                        return (
                            <div
                                key={`row-header-${virtualRow.key}`}
                                style={{
                                    position: 'absolute',
                                    top: virtualRow.start,
                                    left: 0,
                                    width: HEADER_COL_WIDTH,
                                    height: CELL_HEIGHT,
                                    pointerEvents: 'auto'
                                }}
                                onMouseDown={(e) => { 
                                    e.stopPropagation(); setHeaderMenuOpen(null); setRowMenuOpen(null);
                                    if (isEditing) commitEdit(); 
                                    setSelectionRange({ start: { col: 0, row: actualRowIdx }, end: { col: data.size.width - 1, row: actualRowIdx } }); 
                                    setActiveCell(getCellId(0, actualRowIdx)); 
                                    const initialRaw = data.cells[getCellId(0, actualRowIdx)]?.raw || '';
                                    setEditingRaw(initialRaw);
                                    if(initialRaw.startsWith('=')) handleEditChange(initialRaw); 
                                }}
                                className={`group/row flex items-center justify-center text-[10px] font-medium border-b border-neutral-100 dark:border-neutral-800 select-none cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-700
                                    ${isSelectedRow ? 'bg-teal-50/90 dark:bg-teal-900/90 text-teal-600 dark:text-teal-400' : 
                                    (isActiveRow ? 'bg-neutral-50/90 dark:bg-neutral-800/90 text-neutral-600 dark:text-neutral-400' : 
                                        (isHeaderRow || isGrandTotal ? 'bg-neutral-50/90 dark:bg-neutral-800/90 text-teal-600/80 dark:text-teal-400/80' : 
                                        'bg-transparent text-neutral-400 dark:text-neutral-500')
                                    )}
                                `}
                            >
                                <span>{rIndex + 1}</span>
                                <button 
                                    onMouseDown={(e) => { e.stopPropagation(); setRowMenuOpen(rowMenuOpen === actualRowIdx ? null : actualRowIdx); setHeaderMenuOpen(null); }}
                                    className={`absolute right-0.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-400 dark:text-neutral-500 transition-opacity ${isActiveRow || isSelectedRow ? 'opacity-100' : 'opacity-0 group-hover/row:opacity-100'}`}
                                >
                                    <MoreVertical size={10} />
                                </button>
                                <SheetRowMenu 
                                    rowIndex={actualRowIdx}
                                    isOpen={rowMenuOpen === actualRowIdx}
                                    onClose={() => setRowMenuOpen(null)}
                                    onAction={(action, param) => handleRowMenuAction(actualRowIdx, action, param)}
                                    isHeaderRow={isHeaderRow}
                                    isReadOnly={isReadOnly}
                                />
                            </div>
                        );
                    })}
                </div>

                {/* 4. Cells Loop */}
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const rIndex = virtualRow.index;
                    const actualRowIdx = visibleRowIndices ? visibleRowIndices[rIndex] : rIndex;
                    const isHeaderRow = actualRowIdx === 0;
                    const isGrandTotal = isPivot && String(data.cells[getCellId(0, actualRowIdx)]?.value) === 'Grand Total';

                    return (
                        <React.Fragment key={virtualRow.key}>
                            {colVirtualizer.getVirtualItems().map((virtualCol) => {
                                const cIndex = virtualCol.index;
                                const cellId = getCellId(cIndex, actualRowIdx);
                                const cellData = data.cells[cellId];
                                const isActive = activeCell === cellId;
                                const isSelected = selectionRange && cIndex >= selBounds.minCol && cIndex <= selBounds.maxCol && rIndex >= selBounds.minRow && rIndex <= selBounds.maxRow;
                                const isReferenced = referencedCells.has(cellId) && !isActive;

                                return (
                                    <SheetCell
                                        key={virtualCol.key}
                                        cellId={cellId}
                                        cellData={cellData}
                                        width={virtualCol.size}
                                        height={CELL_HEIGHT}
                                        style={{
                                            position: 'absolute',
                                            top: virtualRow.start + HEADER_ROW_HEIGHT,
                                            left: virtualCol.start + HEADER_COL_WIDTH
                                        }}
                                        isActive={isActive}
                                        isSelected={isSelected || false}
                                        isReferenced={isReferenced}
                                        isEditing={isActive && isEditing}
                                        isReadOnly={isReadOnly}
                                        isHeaderRow={isHeaderRow}
                                        isGrandTotal={isGrandTotal}
                                        colMax={colStats[cIndex]?.max || 0}
                                        colMin={colStats[cIndex]?.min || 0}
                                        rowMax={rowStats[actualRowIdx]?.max || 0}
                                        rowMin={rowStats[actualRowIdx]?.min || 0}
                                        editingRaw={editingRaw}
                                        onEditChange={handleEditChange}
                                        onCommit={commitEdit}
                                        setSuggestions={setSuggestions}
                                        suggestions={suggestions}
                                        selectedSuggestionIndex={selectedSuggestionIndex}
                                        onMouseDown={handleCellMouseDown}
                                        onMouseEnter={handleCellMouseEnter}
                                        onDoubleClick={(id) => { if (!isReadOnly) { setActiveCell(id); setIsEditing(true); const raw = data.cells[id]?.raw || ''; setEditingRaw(raw); if(raw.startsWith('=')) handleEditChange(raw); } }}
                                        onSuggestionSelect={handleSuggestionSelect}
                                        setSelectedSuggestionIndex={setSelectedSuggestionIndex}
                                    />
                                );
                            })}
                        </React.Fragment>
                    );
                })}
            </div>
        )}
      </div>

      <div className="absolute top-0 -right-1 w-3 h-full cursor-col-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'right')} />
      <div className="absolute -bottom-1 left-0 w-full h-3 cursor-row-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'bottom')} />
      <div className="absolute -bottom-1 -right-1 w-5 h-5 cursor-nwse-resize z-30 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors" onMouseDown={(e) => handleResizeStart(e, 'corner')}>
          <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
      </div>

      <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 px-2 opacity-0 group-hover:opacity-100 transition-opacity z-50">
         {stats && (
           <div className="relative">
              {showStatsMenu && <div className="fixed inset-0 z-40" onClick={() => setShowStatsMenu(false)} />}
              <button onClick={() => setShowStatsMenu(!showStatsMenu)} className="flex items-center gap-1.5 text-[11px] font-medium text-neutral-500 dark:text-neutral-400 bg-white dark:bg-neutral-800 px-3 py-1.5 rounded-full shadow-sm border border-neutral-100 dark:border-neutral-700 hover:bg-neutral-50 transition-colors z-50 relative">
                  <span className="uppercase tracking-wider text-[9px]">{activeStat}</span>
                  <span key={stats[activeStat]} className="animate-pop-in text-neutral-700 dark:text-neutral-200">{formatStat(stats[activeStat])}</span>
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

    </div>
  );
};
