
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { SheetData, CellData, CellFormat, CellCoordinate, FilterCondition, SparklineConfig, SelectionContext } from '../types';
import { getCellId, parseCellId, computeSheet } from '../utils/formulas';
import { formatValue } from '../utils/formatting';
import { parseClipboardData } from '../utils/clipboard';
import { getFilteredRows } from '../utils/dataAnalysis';
import { serializeSheetSelection } from '../utils/sheetClipboard';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT, MIN_COL_WIDTH, MAX_RENDER_ROWS, SHEET_CANVAS_SCROLL_PASSTHROUGH_SCALE } from '../constants';
import { GitBranch, GripHorizontal, Trash2, BarChart3, ChevronDown, MoreVertical, MoreHorizontal, Table, Settings2, X, Image as ImageIcon, Loader2, AlertCircle, AlertTriangle, Filter, TrendingUp, Link, RefreshCcw, Code2 } from 'lucide-react';
import { PivotConfigPanel } from './PivotConfigPanel';
import { SparklineConfigPanel } from './SparklineConfigPanel';
import { FilterPanel } from './FilterPanel';
import { SheetColumnMenu } from './SheetColumnMenu';
import { SheetRowMenu } from './SheetRowMenu';
import { SheetCell } from './SheetCell';
import { HeaderDropdownMenu } from './HeaderDropdownMenu';
import { SettingsPopover } from './SettingsPopover';
import { copyElementAsImage } from '../utils/elementCapture';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useStore } from '../store';
import { ConnectedSheetBriefPanel } from './ConnectedSheetBriefPanel';
import { ConnectedSheetQueryPanel } from './ConnectedSheetQueryPanel';
import {
  buildConnectorConfigWithQuery,
  getConnectorQuerySummary,
  readConnectorQuery,
  refreshConnectedSheetFromQuery,
  type NormalizedConnectorQuery,
} from '../utils/connectedSheetQueries';
import { isConnectorNeedsReconnectError } from '../utils/backendApi';

interface SheetNodeProps {
  id: string;
  onAddChart?: (sheetId: string, defaultColIndex?: number, selectedCols?: number[]) => void;
  onAddPivot?: (sheetId: string, defaultColIndex?: number) => void;
  onAddSparkline?: (sheetId: string) => void;
  onToast?: (message: string) => void;
  isPendingDelete?: boolean;
  hasLineage?: boolean;
  lineageVisible?: boolean;
  onToggleLineage?: (id: string) => void;
  onSelectionContextChange?: (ctx: SelectionContext) => void;
  onMouseDown: (e: React.MouseEvent) => void;
}

const SUPPORTED_FORMULAS = ['SUM', 'AVG', 'AVERAGE', 'MIN', 'MAX', 'COUNT'];

// Placeholder used only for the one render where the backing sheet was just
// deleted from the store — lets every hook below keep running with a valid
// shape instead of branching, so hook order/count never changes. The actual
// null check (and null render) happens after all hooks have run.
const EMPTY_SHEET_DATA: SheetData = {
  id: '',
  position: { x: 0, y: 0 },
  size: { width: 0, height: 0 },
  title: '',
  cells: {},
};

const ConnectedSheetError = ({ message }: { message: string }) => (
  <div className="border-b border-red-200/70 bg-red-50/90 px-3 py-2 dark:border-red-900/60 dark:bg-red-950/25">
    <div className="flex items-start gap-2 text-xs text-red-700 dark:text-red-300">
      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message}</div>
    </div>
  </div>
);

const areSheetNodePropsEqual = (prev: SheetNodeProps, next: SheetNodeProps) => (
  prev.id === next.id &&
  prev.onAddChart === next.onAddChart &&
  prev.onAddPivot === next.onAddPivot &&
  prev.onAddSparkline === next.onAddSparkline &&
  prev.onToast === next.onToast &&
  prev.isPendingDelete === next.isPendingDelete &&
  prev.hasLineage === next.hasLineage &&
  prev.lineageVisible === next.lineageVisible &&
  prev.onToggleLineage === next.onToggleLineage &&
  prev.onSelectionContextChange === next.onSelectionContextChange &&
  prev.onMouseDown === next.onMouseDown
);

const SheetNodeComponent: React.FC<SheetNodeProps> = ({ id, onAddChart, onAddPivot, onAddSparkline, onToast, isPendingDelete, hasLineage, lineageVisible, onToggleLineage, onSelectionContextChange, onMouseDown }) => {
  const rawData = useStore(state => state.sheets[id]);
  const data = rawData ?? EMPTY_SHEET_DATA;
  const selected = useStore(state => state.selectedIds.has(id));
  const updateSheet = useStore(state => state.updateSheet);
  const deleteSheet = useStore(state => state.deleteSheet);
  const saveSnapshot = useStore(state => state.saveSnapshot);
  const beginSourceRefresh = useStore(state => state.beginSourceRefresh);
  const endSourceRefresh = useStore(state => state.endSourceRefresh);
  const select = useStore(state => state.select);
  
  const isLowZoom = useStore(state => state.transform.scale < 0.35);
  
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
  const [showConnectorQueryPanel, setShowConnectorQueryPanel] = useState(false);
  const [isConnectorRefreshing, setIsConnectorRefreshing] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  
  const showFilterPanel = !!data?.showFilterPanel;
  const [preselectedFilterCol, setPreselectedFilterCol] = useState<string | null>(null);
  
  const [isExporting, setIsExporting] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef(data);
  const updateSheetRef = useRef(updateSheet);
  const scaleRef = useRef(useStore.getState().transform.scale);
  const isEditingRef = useRef(isEditing);
  const isEditingTitleRef = useRef(isEditingTitle);
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
    return useStore.subscribe((state) => {
      scaleRef.current = state.transform.scale;
    });
  }, []);
  useEffect(() => {
      isEditingRef.current = isEditing;
  }, [isEditing]);
  useEffect(() => {
      isEditingTitleRef.current = isEditingTitle;
  }, [isEditingTitle]);
  useEffect(() => {
      colResizingRef.current = colResizing;
  }, [colResizing]);
  useEffect(() => {
      resizingRef.current = resizing;
  }, [resizing]);

  const isPivot = !!data.pivotConfig;
  const isSparkline = !!data.sparklineConfig;
  // Derived tables show a "refreshing" hint while their origin is mid-refresh so
  // it's clear new data is arriving (the connected origin has its own spinner).
  const isDerivedRefreshing = useStore(state => (isPivot || isSparkline) && state.refreshingIds.has(data.id));
  const isSetup = !!data.setupRequired;
  const isConnected = !!data.connectorConfig;
  const isReadOnly = isPivot || isSparkline || isConnected;
  const isClickhouseConnected = data.connectorConfig?.type === 'clickhouse';
  const isGoogleAnalyticsConnected = data.connectorConfig?.type === 'google-analytics';
  const isGoogleSheetsConnected = data.connectorConfig?.type === 'google-sheets';
  const isGoogleSheetsSimulated =
    isGoogleSheetsConnected &&
    !data.connectorConfig?.connectionId &&
    data.connectorConfig?.params?.simulate !== false;
  const isGoogleAnalyticsSimulated =
    isGoogleAnalyticsConnected &&
    !data.connectorConfig?.connectionId &&
    data.connectorConfig?.params?.simulate !== false;

  const lastRefreshedAt =
    (isClickhouseConnected || isGoogleAnalyticsConnected || (isGoogleSheetsConnected && !isGoogleSheetsSimulated))
      ? (data.connectorConfig?.lastRefreshedAt ?? null)
      : null;
  const canEditConnectorQuery =
    !!data.connectorConfig?.connectionId &&
    (isClickhouseConnected || isGoogleAnalyticsConnected || isGoogleSheetsConnected);
  const connectorQuerySummary = data.connectorConfig ? getConnectorQuerySummary(data.connectorConfig) : '';
  const connectorNeedsReconnect = data.connectorConfig?.healthStatus === 'needs_reconnect';


  const refreshConnectedSheetQuery = async (opts?: { queryOverride?: NormalizedConnectorQuery; showToasts?: boolean }) => {
    if (!data.connectorConfig || !canEditConnectorQuery) return;
    const query = opts?.queryOverride ?? readConnectorQuery(data.connectorConfig);
    if (!query) return;

    setIsConnectorRefreshing(true);
    beginSourceRefresh(data.id);
    saveSnapshot();
    try {
      const next = await refreshConnectedSheetFromQuery(data.connectorConfig, query);
      updateSheet(data.id, { size: next.size, cells: next.cells, connectorConfig: next.connectorConfig });
      if (next.truncationMessage && onToast) onToast(next.truncationMessage);
      if (opts?.showToasts !== false && onToast) onToast('Refreshed');
    } catch (e: any) {
      const msg = e?.message || 'Refresh failed';
      const needsReconnect = isConnectorNeedsReconnectError(e);
      updateSheet(data.id, {
        connectorConfig: {
          ...buildConnectorConfigWithQuery(data.connectorConfig, query),
          ...(needsReconnect
            ? { healthStatus: 'needs_reconnect' as const, healthErrorCode: 'connector_needs_reconnect' }
            : {}),
          lastError: msg,
        }
      });
      if (onToast) onToast(msg);
    } finally {
      setIsConnectorRefreshing(false);
      endSourceRefresh(data.id);
    }
  };

  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) return;

      const target = e.target as HTMLElement | null;
      const isTextInteraction =
        isEditingRef.current ||
        isEditingTitleRef.current ||
        !!target?.closest('input, textarea, [contenteditable="true"]');
      const hasOpenSheetControl =
        showFilterPanel ||
        showPivotConfig ||
        showSparklineConfig ||
        showConnectorQueryPanel ||
        headerMenuOpen !== null ||
        rowMenuOpen !== null ||
        suggestions.length > 0;
      const shouldKeepSheetScroll =
        isTextInteraction ||
        hasOpenSheetControl ||
        scaleRef.current > SHEET_CANVAS_SCROLL_PASSTHROUGH_SCALE;

      if (shouldKeepSheetScroll) {
        e.stopPropagation();
      }
    };
    node.addEventListener('wheel', handleWheel, { passive: true });
    return () => node.removeEventListener('wheel', handleWheel);
  }, [headerMenuOpen, rowMenuOpen, showConnectorQueryPanel, showFilterPanel, showPivotConfig, showSparklineConfig, suggestions.length]);

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

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (!selectionRange) return;
        e.preventDefault();

        const copiedText = serializeSheetSelection(
            data.cells,
            selectionRange,
            visibleRowIndices,
            displayRowByActualRow
        );

        navigator.clipboard.writeText(copiedText).catch((err) => {
            console.error('Failed to copy sheet selection', err);
            if (onToast) onToast('Failed to copy selection');
        });
        return;
    }

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
        if (param === 'flip') {
            applyColumnFormat(targetCols, { visual: 'heatmap', heatmapColor: 'diverging', heatmapFlip: !clickedColFormat?.heatmapFlip });
        } else if (param) {
            applyColumnFormat(targetCols, { visual: 'heatmap', heatmapColor: param, heatmapFlip: false });
        } else {
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
            d3Format: action === 'percent' ? '.1%' : '' 
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
    const clickedRowFormat = data.cells[getCellId(0, rowIndex)]?.format;
    if (action === 'bar-row') applyRowFormat(rowIndex, { visual: 'bar-row' });
    else if (action === 'heatmap-row') {
        const isActive = clickedRowFormat?.visual === 'heatmap-row';
        if (param === 'flip') {
            applyRowFormat(rowIndex, { visual: 'heatmap-row', heatmapColor: 'diverging', heatmapFlip: !clickedRowFormat?.heatmapFlip });
        } else if (param) {
            applyRowFormat(rowIndex, { visual: 'heatmap-row', heatmapColor: param, heatmapFlip: false });
        } else {
            applyRowFormat(rowIndex, { visual: isActive ? null : 'heatmap-row' });
        }
    }
    else if (action === 'date') applyRowFormat(rowIndex, { type: 'date', dateFormat: param });
    else if (action === 'number-compact') applyRowFormat(rowIndex, { type: 'number', d3Format: '.2s' });
    else if (action === 'number-expand') applyRowFormat(rowIndex, { type: 'number', d3Format: '' });
    else if (action === 'currency-compact') applyRowFormat(rowIndex, { type: 'currency', d3Format: '$.2s' });
    else if (action === 'currency-expand') applyRowFormat(rowIndex, { type: 'currency', d3Format: '' });
    else if (action === 'd3-custom') applyRowFormat(rowIndex, { type: 'number', d3Format: param });
    else if (['number', 'currency', 'percent', 'text'].includes(action)) applyRowFormat(rowIndex, { 
        type: action as any, 
        d3Format: action === 'percent' ? '.1%' : '' 
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
             if (!isNaN(parseFloat(valStr))) newFormat = { ...newFormat, type: 'percent', d3Format: '.1%' };
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

  // Copy the sheet exactly as it appears on screen (the current scrolled window). The shared
  // capture helper strips the teal selection ring and scrollbar chrome from the image.
  const handleCopyImage = async () => {
    if (!containerRef.current || isExporting) return;
    setIsExporting(true);
    try {
      await copyElementAsImage(containerRef.current);
      if (onToast) onToast("Sheet copied to clipboard as image");
    } catch (err) {
      console.error(err);
      if (onToast) onToast("Failed to copy");
    } finally {
      setIsExporting(false);
    }
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

  // Safe to bail now: every hook above has already run this render, so
  // returning null here (e.g. right after the sheet was deleted) can't
  // desync the hook count on the next render.
  if (!rawData) return null;

  if (isLowZoom) {
    return (
      <div 
        id={`sheet-${data.id}`}
        ref={containerRef}
        className={`absolute flex flex-col bg-white dark:bg-neutral-850 rounded-xl transition-shadow transition-colors duration-200 outline-none group border select-none pointer-events-auto
          ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-md z-30'}
          ${isPendingDelete ? 'animate-delete-pulse' : ''}
        `}
        style={{ left: data.position.x, top: data.position.y, width: visibleTableWidth + HEADER_COL_WIDTH + 2, height: (data.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT + 2, overflow: 'hidden' }}
        onMouseDown={(e) => { 
            e.stopPropagation(); 
            onMouseDown(e);
        }}
      >
        <div className="h-9 flex items-center px-3 bg-neutral-50 dark:bg-neutral-800 border-b border-neutral-100 dark:border-neutral-800">
          <GripHorizontal size={14} className="text-neutral-300 dark:text-neutral-600 mr-2 flex-shrink-0" />
          {isPivot && <Table size={12} className="text-teal-600 mr-1.5" />}
          {isSparkline && <TrendingUp size={12} className="text-teal-600 mr-1.5" />}
          <span className="text-sm font-semibold text-neutral-600 dark:text-neutral-300 truncate">{data.title}</span>
        </div>
        <div className="flex-1 p-4 flex flex-col justify-center items-center bg-white dark:bg-neutral-855 gap-1 opacity-50">
          <Table className="text-neutral-400 dark:text-neutral-500" size={32} />
          <span className="text-xs text-neutral-400 dark:text-neutral-500 font-medium">
            {data.size.width} × {data.size.height} Grid
          </span>
        </div>
        <div className="absolute top-0 -right-1 w-3 h-full cursor-col-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'right')} />
        <div className="absolute -bottom-1 left-0 w-full h-3 cursor-row-resize z-20" onMouseDown={(e) => handleResizeStart(e, 'bottom')} />
        <div className="absolute -bottom-1 -right-1 w-5 h-5 cursor-nwse-resize z-30 flex items-center justify-center rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors" onMouseDown={(e) => handleResizeStart(e, 'corner')}>
            <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
        </div>
      </div>
    );
  }

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
            className="relative h-9 flex items-center px-3 cursor-grab active:cursor-grabbing bg-white dark:bg-neutral-850 border-b border-neutral-100 dark:border-neutral-800"
            onMouseDown={(e) => { onMouseDown(e); setActiveCell(null); setSelectionRange(null); setIsEditing(false); setHeaderMenuOpen(null); setRowMenuOpen(null); }}
        >
            <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 dark:text-neutral-200 flex-1 min-w-0">
                <GripHorizontal size={14} className="text-neutral-300 dark:text-neutral-600 flex-shrink-0" />
                {isPivot && <div className="p-0.5 rounded text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30 mr-1" title="Pivot Table"><Table size={12} /></div>}
                {isSparkline && <div className="p-0.5 rounded text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30 mr-1" title="Sparkline Table"><TrendingUp size={12} /></div>}
                {isDerivedRefreshing && (
                  <div className="flex items-center gap-1 text-[11px] text-teal-600 dark:text-teal-400 mr-1" title="Refreshing from source">
                    <Loader2 size={12} className="animate-spin" />
                    <span>Refreshing…</span>
                  </div>
                )}
                {isConnected && <div className={`p-0.5 rounded mr-1 ${connectorNeedsReconnect ? 'text-amber-700 bg-amber-50 dark:text-amber-300 dark:bg-amber-950/40' : 'text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-900/30'}`} title={connectorNeedsReconnect ? 'Connection needs reconnect' : `Connected Source: ${data.connectorConfig?.type}`}><Link size={12} /></div>}
                {isConnected && connectorQuerySummary && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[220px]" title={connectorQuerySummary}>
                    {connectorQuerySummary}
                  </div>
                )}
                {isConnected && data.connectorConfig?.derivation && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[180px]" title={data.connectorConfig.derivation}>
                    {data.connectorConfig.derivation}
                  </div>
                )}
                {isConnected && data.connectorConfig?.lastError && (
                  <div className="text-xs text-red-500 dark:text-red-400 truncate max-w-[180px]" title={data.connectorConfig.lastError}>
                    {connectorNeedsReconnect ? 'Needs reconnect' : data.connectorConfig.lastError}
                  </div>
                )}

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
                    <span className="truncate cursor-text hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded px-1.5 py-0.5 -ml-1.5 transition-colors" title={data.title} onDoubleClick={(e) => { e.stopPropagation(); setIsEditingTitle(true); }}>
                        {data.title}
                    </span>
                )}
            </div>
            <div data-export-exclude className={`absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 p-1 rounded-lg bg-white/95 dark:bg-neutral-900/95 backdrop-blur-sm transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto ${showMoreMenu ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
                {(lastRefreshedAt && ((isGoogleAnalyticsConnected && !isGoogleAnalyticsSimulated) || (isGoogleSheetsConnected && !isGoogleSheetsSimulated) || isClickhouseConnected)) && (() => {
                  const diffMs = Date.now() - lastRefreshedAt;
                  const m = Math.floor(diffMs / 60000);
                  const label = m < 1 ? 'just now' : m < 60 ? `${m}m ago` : Math.floor(m / 60) < 24 ? `${Math.floor(m / 60)}h ago` : `${Math.floor(m / 1440)}d ago`;
                  return <span className="text-xs text-gray-400 dark:text-gray-500 mr-1 select-none">{label}</span>;
                })()}
                <button onClick={() => updateSheet(data.id, { showFilterPanel: !showFilterPanel })} className={`group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md transition-colors ${showFilterPanel || (data.filters && data.filters.length > 0) ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}>
                    <Filter size={14} />
                </button>
                <button onClick={handleCopyImage} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" disabled={isExporting}>
                    {isExporting ? <Loader2 size={14} className="animate-spin" /> : <ImageIcon size={14} />}
                </button>
                <button onClick={() => { const colIndex = activeCell ? parseCellId(activeCell)?.col : undefined; const selectedCols = getSelectedColumns(); if (onAddChart) onAddChart(data.id, colIndex, selectedCols); }} className="group/btn relative text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300 p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors" title="Create Chart">
                    <BarChart3 size={14} />
                </button>

                {isPivot && (
                    <button
                        onClick={() => setShowPivotConfig(!showPivotConfig)}
                        className={`group/btn relative p-1.5 rounded-md transition-colors ${showPivotConfig ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}
                        title="Pivot Settings"
                    >
                        <Settings2 size={14} />
                    </button>
                )}
                {isSparkline && (
                    <button
                        onClick={() => setShowSparklineConfig(!showSparklineConfig)}
                        className={`group/btn relative p-1.5 rounded-md transition-colors ${showSparklineConfig ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}
                        title="Sparkline Settings"
                    >
                        <Settings2 size={14} />
                    </button>
                )}

                <div className="relative">
                    <button
                        ref={moreBtnRef}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => setShowMoreMenu(!showMoreMenu)}
                        className={`group/btn relative p-1.5 rounded-md transition-colors ${showMoreMenu ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300' : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-400 dark:text-neutral-500'}`}
                        title="More"
                    >
                        <MoreHorizontal size={14} />
                    </button>
                    <HeaderDropdownMenu anchorRef={moreBtnRef} isOpen={showMoreMenu} onClose={() => setShowMoreMenu(false)} width={180}>
                        {hasLineage && (
                            <button
                                onClick={(e) => { e.stopPropagation(); setShowMoreMenu(false); onToggleLineage?.(data.id); }}
                                className={`px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-2 w-full ${lineageVisible ? 'text-teal-600 dark:text-teal-400' : 'text-neutral-700 dark:text-neutral-200'}`}
                            >
                                <GitBranch size={14} /> Lineage
                            </button>
                        )}
                        {canEditConnectorQuery && (
                            <>
                                <button
                                    onClick={() => { setShowMoreMenu(false); refreshConnectedSheetQuery({ showToasts: true }); }}
                                    disabled={isConnectorRefreshing}
                                    className={`px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-2 w-full ${connectorNeedsReconnect ? 'text-amber-600 dark:text-amber-400' : 'text-neutral-700 dark:text-neutral-200'}`}
                                    title={connectorNeedsReconnect ? 'Reconnect this source, then refresh again' : lastRefreshedAt ? `Refresh (last: ${new Date(lastRefreshedAt).toLocaleString()})` : 'Refresh'}
                                >
                                    {isConnectorRefreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />} Refresh
                                </button>
                                <button
                                    onClick={() => { setShowMoreMenu(false); setShowConnectorQueryPanel(!showConnectorQueryPanel); }}
                                    className={`px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 flex items-center gap-2 w-full ${showConnectorQueryPanel ? 'text-teal-600 dark:text-teal-400' : 'text-neutral-700 dark:text-neutral-200'}`}
                                >
                                    <Code2 size={14} /> Edit query
                                </button>
                            </>
                        )}
                        {!isPivot && !isSparkline && (
                            <>
                                <button
                                    onClick={() => { setShowMoreMenu(false); const colIndex = activeCell ? parseCellId(activeCell)?.col : undefined; if (onAddPivot) onAddPivot(data.id, colIndex); }}
                                    className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full"
                                >
                                    <Table size={14} /> Create Pivot Table
                                </button>
                                <button
                                    onClick={() => { setShowMoreMenu(false); if (onAddSparkline) onAddSparkline(data.id); }}
                                    className="px-3 py-2 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2 w-full"
                                >
                                    <TrendingUp size={14} /> Create Sparklines
                                </button>
                            </>
                        )}
                        <button
                            onClick={() => { setShowMoreMenu(false); deleteSheet(data.id); }}
                            className="px-3 py-2 text-xs text-left hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 flex items-center gap-2 w-full"
                        >
                            <Trash2 size={14} /> Delete
                        </button>
                    </HeaderDropdownMenu>
                </div>
            </div>
        </div>

        {isConnected && data.connectorConfig?.lastError && (
          <ConnectedSheetError
            message={
              connectorNeedsReconnect
                ? `${data.connectorConfig.lastError}\nLast successful data is still shown. Reconnect the source from Connect Data, then refresh this sheet.`
                : data.connectorConfig.lastError
            }
          />
        )}

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
        {showConnectorQueryPanel && canEditConnectorQuery && data.connectorConfig && (
          <ConnectedSheetQueryPanel
            config={data.connectorConfig}
            isBusy={isConnectorRefreshing}
            onCancel={() => setShowConnectorQueryPanel(false)}
            onSave={(connectorConfig) => {
              saveSnapshot();
              updateSheet(data.id, { connectorConfig });
              setShowConnectorQueryPanel(false);
            }}
            onSaveAndRefresh={async (query) => {
              setShowConnectorQueryPanel(false);
              await refreshConnectedSheetQuery({ queryOverride: query, showToasts: true });
            }}
          />
        )}
        {isConnected && data.connectorConfig?.brief && (
          <ConnectedSheetBriefPanel brief={data.connectorConfig.brief} />
        )}
	        {isPivot && data.pivotWarnings && data.pivotWarnings.length > 0 && (
	            <div className="border-t border-amber-200/70 dark:border-amber-900/60 bg-amber-50/80 dark:bg-amber-950/20 px-3 py-2">
	                <div className="flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300">
	                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
	                    <div className="space-y-1">
	                        {data.pivotWarnings.map((warning, index) => (
	                            <div key={`${warning}-${index}`}>{warning}</div>
	                        ))}
	                    </div>
	                </div>
	            </div>
	        )}
	        {data.refreshWarnings && data.refreshWarnings.length > 0 && (
	            <div className="border-t border-rose-200/70 dark:border-rose-900/60 bg-rose-50/80 dark:bg-rose-950/20 px-3 py-2">
	                <div className="flex items-start gap-2 text-[11px] text-rose-800 dark:text-rose-300">
	                    <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />
	                    <div className="space-y-1">
	                        <div className="font-medium">Source data changed on last refresh:</div>
	                        {data.refreshWarnings.map((warning, index) => (
	                            <div key={`${warning}-${index}`}>{warning}</div>
	                        ))}
	                    </div>
	                </div>
	            </div>
	        )}
	      </div>

      <div
        ref={gridRef}
        className={`bg-white dark:bg-neutral-850 cursor-text select-none overflow-auto relative rounded-b-xl sheet-scroll ${selected ? 'sheet-scroll-active' : ''}`}
        style={{ height: windowHeight }}
      >
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
                    className="sticky top-0 z-40 bg-white dark:bg-neutral-850 border-b border-neutral-100 dark:border-neutral-800 flex"
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
                    className="sticky left-0 z-30 bg-white dark:bg-neutral-850 border-r border-neutral-100 dark:border-neutral-800"
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
                                    currentFormat={data.cells[getCellId(0, actualRowIdx)]?.format}
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

      {/* Pivot config: popover beside node. Setup is guarded from outside-click dismissal
          because Cancel deletes the sheet; edit mode applies live and closes on outside-click/Esc. */}
      {(isSetup || showPivotConfig) && isPivot && (
          <SettingsPopover
              anchorRef={containerRef}
              isOpen={true}
              onClose={() => setShowPivotConfig(false)}
              dismissOnOutsideClick={!isSetup}
              width={300}
          >
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
          </SettingsPopover>
      )}

      {(isSetup || showSparklineConfig) && isSparkline && (
          <SettingsPopover
              anchorRef={containerRef}
              isOpen={true}
              onClose={() => setShowSparklineConfig(false)}
              dismissOnOutsideClick={!isSetup}
              width={300}
          >
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
          </SettingsPopover>
      )}

    </div>
  );
};

export const SheetNode = React.memo(SheetNodeComponent, areSheetNodePropsEqual);
