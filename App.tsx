
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Canvas } from './components/Canvas';
import { SheetNode } from './components/SheetNode';
import { ChartNode } from './components/ChartNode';
import { NoteNode } from './components/NoteNode';
import { Toolbar } from './components/Toolbar';
import { Toast } from './components/Toast';
import { GlobalCommandBar } from './components/GlobalCommandBar';
import { DataConnectorDialog } from './components/DataConnectorDialog';
import { OnboardingGuide } from './components/OnboardingGuide';
import { SheetData, ChartData, NoteData, CanvasTransform, Position, CellData, ChartConfig, PivotConfig, ToolMode, SparklineConfig, Command, SelectionContext, CellFormat, ConnectorConfig, ConnectorType, TimeGranularity, ChartType } from './types';
import { INITIAL_COLS, INITIAL_ROWS, CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT, DEFAULT_CHART_SIZE, MAX_IMPORT_ROWS, MAX_IMPORT_COLS, MAX_CONNECTED_IMPORT_COLS, MAX_INITIAL_VIEWPORT_COVERAGE } from './constants';
import { parseClipboardData } from './utils/clipboard';
import { parseFile } from './utils/fileParser';
import { getCellId, parseCellId, computeSheet } from './utils/formulas';
import { getSheetHeaders } from './utils/chartHelpers';
import { inferColumnType, getFilteredRows, getValidDataCount, suggestGranularityByCount } from './utils/dataAnalysis';
import { Upload, Moon, Sun, Table, StickyNote, Undo2, Redo2, Grid3X3, BarChart3, TrendingUp, Palette, AlignLeft, Trash2, ArrowDownAZ, ArrowUpAZ, Filter, MousePointer2, Hand, Hash, Percent, Image as ImageIcon, Database, FileSpreadsheet, BarChart2, Globe, Calendar, Minimize2, Maximize2, DollarSign, ArrowLeft, ArrowRight, Eraser, Type } from 'lucide-react';
import { useStore, AppState } from './store';
import { useChartPalette } from './hooks/useChartPalette';
import { getChartPalette } from './utils/chartColorSchemes';
import AgentChatPanel from './src/components/AgentChatPanel';
import { AgentEvalBridge } from './src/agent/AgentEvalBridge';
import { loadGoogleSheetsAuth } from './utils/googleAnalyticsAuth';
import { Sparkles } from 'lucide-react';
import { getVisibleCanvasIds } from './utils/canvasVirtualization';

const generateId = () => Math.random().toString(36).substr(2, 9);
const ONBOARDING_DISMISSED_KEY = 'sheetcanvas:onboarding-dismissed:v4';

const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState(() => 
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  
  const initStore = useStore((state: AppState) => state.init);
  const sheetIds = useStore((state: AppState) => state.sheetIds);
  const chartIds = useStore((state: AppState) => state.chartIds);
  const noteIds = useStore((state: AppState) => state.noteIds);
  const sheets = useStore((state: AppState) => state.sheets);
  const charts = useStore((state: AppState) => state.charts);
  const notes = useStore((state: AppState) => state.notes);
  
  const selectedIds = useStore((state: AppState) => state.selectedIds);
  const transform = useStore((state: AppState) => state.transform);
  const setTransform = useStore((state: AppState) => state.setTransform);
  const toolMode = useStore((state: AppState) => state.toolMode);
  
  const addSheet = useStore((state: AppState) => state.addSheet);
  const updateSheet = useStore((state: AppState) => state.updateSheet);
  const deleteSheet = useStore((state: AppState) => state.deleteSheet);
  
  const addChart = useStore((state: AppState) => state.addChart);
  const updateChart = useStore((state: AppState) => state.updateChart);
  const deleteChart = useStore((state: AppState) => state.deleteChart);
  
  const addNote = useStore((state: AppState) => state.addNote);
  const updateNote = useStore((state: AppState) => state.updateNote);
  const deleteNote = useStore((state: AppState) => state.deleteNote);
  
  const undo = useStore((state: AppState) => state.undo);
  const redo = useStore((state: AppState) => state.redo);
  const deleteSelected = useStore((state: AppState) => state.deleteSelected);
  const select = useStore((state: AppState) => state.select);
  const setToolMode = useStore((state: AppState) => state.setToolMode);
  const saveSnapshot = useStore((state: AppState) => state.saveSnapshot);
  
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState(() =>
    typeof window !== 'undefined' && window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== 'true'
  );
  const [dataConnectorState, setDataConnectorState] = useState<{ isOpen: boolean; initialType?: ConnectorType }>({ isOpen: false });

  // Chart Colors State with localStorage persistence
  const {
    recentColors: chartRecentColors,
    addColor: addChartColor,
    settings: chartColorSettings,
    updateSettings: updateChartColorSettings,
  } = useChartPalette();

  // Track ID of note that should start in edit mode
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === 'undefined' ? 1280 : window.innerWidth,
    height: typeof window === 'undefined' ? 720 : window.innerHeight,
  }));
  const [viewportTransform, setViewportTransform] = useState<CanvasTransform>(transform);
  
  // Selection Context
  const [activeSelection, setActiveSelection] = useState<SelectionContext>({ sheetId: null, cellId: null, range: null });
  const activeSelectionRef = useRef(activeSelection);
  useEffect(() => { activeSelectionRef.current = activeSelection; }, [activeSelection]);
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const isLocalAgentEvalHost =
    typeof window !== 'undefined' &&
    ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const agentEvalEnabled =
    typeof window !== 'undefined' &&
    isLocalAgentEvalHost &&
    ((import.meta as any).env?.DEV || (import.meta as any).env?.VITE_ENABLE_AGENT_EVAL === 'true') &&
    new URLSearchParams(window.location.search).has('agent_eval');

  // Delete Confirmation State
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Dragging State
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingType, setDraggingType] = useState<'sheet' | 'chart' | 'note' | null>(null);
  const dragInitialPositions = useRef<Record<string, Position>>({});
  
  // Selection Box State
  const [selectionBox, setSelectionBox] = useState<{ start: Position, current: Position } | null>(null);

  const lastMousePos = useRef<Position>({ x: 0, y: 0 });
  const dragStartSnapshot = useRef<any>(null); // Simplified snapshot handling for drag

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initStore();
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('code') || params.get('error')) {
      const callbackState = params.get('state');
      const sheetsAuth = loadGoogleSheetsAuth();
      setDataConnectorState({
        isOpen: true,
        initialType: sheetsAuth?.state === callbackState ? 'google-sheets' : 'google-analytics'
      });
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => setDarkMode(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    setViewportTransform(transform);
  }, [transform]);

  const visibleCanvasIds = useMemo(() => {
    return getVisibleCanvasIds({
      sheetIds,
      chartIds,
      noteIds,
      sheets,
      charts,
      notes,
      transform: viewportTransform,
      viewportSize,
      selectedIds,
      draggingId,
      activeSelection,
      editingNoteId,
    });
  }, [
    activeSelection,
    chartIds,
    charts,
    draggingId,
    editingNoteId,
    noteIds,
    notes,
    selectedIds,
    sheetIds,
    sheets,
    viewportTransform,
    viewportSize,
  ]);

  const showToast = (message: string) => {
      setToast({ message, visible: true });
  };

  const closeOnboarding = () => {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, 'true');
      setIsOnboardingOpen(false);
  };

  const deleteSelectedItems = useCallback(() => {
    deleteSelected();
  }, [deleteSelected]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          setIsCommandBarOpen(prev => !prev);
          return;
      }
      
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      if (e.metaKey || e.ctrlKey) {
        const key = e.key.toLowerCase();
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) redo(); else undo();
        } else if (key === 'y') {
          e.preventDefault();
          redo();
        } 
      } else {
        const key = e.key.toLowerCase();
        if (key === 'v') setToolMode(ToolMode.SELECT);
        if (key === 'h' || key === ' ') setToolMode(ToolMode.PAN);
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
          if (e.defaultPrevented) return;
          if (selectedIds.size > 0) {
              if (deleteConfirmPending) {
                  e.preventDefault();
                  deleteSelectedItems();
                  setDeleteConfirmPending(false);
                  if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
                  setToast({ visible: false, message: '' });
              } else {
                  e.preventDefault();
                  setDeleteConfirmPending(true);
                  showToast("Press delete again to delete selected items");
                  if (deleteTimeoutRef.current) clearTimeout(deleteTimeoutRef.current);
                  deleteTimeoutRef.current = setTimeout(() => {
                      setDeleteConfirmPending(false);
                      setToast({ visible: false, message: '' });
                  }, 3000);
              }
          }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo, selectedIds, deleteConfirmPending, deleteSelectedItems, setToolMode]);

  // Helper to calculate position for new content (Bottom Edge Strategy)
  const getNextPosition = useCallback((width: number, height: number) => {
    const state = useStore.getState();
    const { sheets, charts, notes, transform } = state;
    
    // Viewport Center X in Canvas Space
    const viewportCenterX = (-transform.offset.x + window.innerWidth / 2) / transform.scale;
    
    let maxY = -Infinity;
    
    // Helper to check item bounds
    const checkItem = (y: number, h: number) => {
        const bottom = y + h;
        if (bottom > maxY) maxY = bottom;
    };

    const hasItems = Object.keys(sheets).length > 0 || Object.keys(charts).length > 0 || Object.keys(notes).length > 0;

    if (!hasItems) {
        const viewportCenterY = (-transform.offset.y + window.innerHeight / 2) / transform.scale;
        return {
            x: viewportCenterX - width / 2,
            y: viewportCenterY - height / 2
        };
    }

    // Scan all items
    (Object.values(sheets) as SheetData[]).forEach(s => {
        const h = (s.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT;
        checkItem(s.position.y, h);
    });
    (Object.values(charts) as ChartData[]).forEach(c => checkItem(c.position.y, c.size.height));
    (Object.values(notes) as NoteData[]).forEach(n => checkItem(n.position.y, n.size.height));

    const gap = 100; // Comfortable gap
    return {
        x: viewportCenterX - width / 2,
        y: maxY + gap
    };
  }, []);

  // Helper to animate view to center on a rectangle
  const centerViewOn = useCallback((x: number, y: number, w: number, h: number) => {
    const { scale } = useStore.getState().transform;
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    // Center point of the item
    const itemCx = x + w / 2;
    const itemCy = y + h / 2;

    const newOffsetX = (viewportW / 2) - (itemCx * scale);
    const newOffsetY = (viewportH / 2) - (itemCy * scale);

    setTransform({ scale, offset: { x: newOffsetX, y: newOffsetY } });
  }, [setTransform]);

  // Helper to ensure item is visible in viewport, panning if necessary (Legacy support for charts/pivots)
  const ensureVisible = useCallback((itemRect: { x: number; y: number; width: number; height: number }) => {
    const { scale, offset } = useStore.getState().transform;
    const padding = 60; // Comfortable padding
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    const screenLeft = itemRect.x * scale + offset.x;
    const screenRight = (itemRect.x + itemRect.width) * scale + offset.x;
    const screenTop = itemRect.y * scale + offset.y;
    const screenBottom = (itemRect.y + itemRect.height) * scale + offset.y;

    let newOffsetX = offset.x;
    let newOffsetY = offset.y;
    let needsUpdate = false;

    // Check X
    if (screenLeft < padding) {
        newOffsetX = padding - itemRect.x * scale;
        needsUpdate = true;
    } else if (screenRight > viewportW - padding) {
        const shift = screenRight - (viewportW - padding);
        newOffsetX = offset.x - shift;
        const newScreenLeft = itemRect.x * scale + newOffsetX;
        if (newScreenLeft < padding) {
             newOffsetX = padding - itemRect.x * scale;
        }
        needsUpdate = true;
    }

    // Check Y
    if (screenTop < padding) {
        newOffsetY = padding - itemRect.y * scale;
        needsUpdate = true;
    } else if (screenBottom > viewportH - padding) {
        const shift = screenBottom - (viewportH - padding);
        newOffsetY = offset.y - shift;
        const newScreenTop = itemRect.y * scale + newOffsetY;
        if (newScreenTop < padding) {
            newOffsetY = padding - itemRect.y * scale;
        }
        needsUpdate = true;
    }

    if (needsUpdate) {
        setTransform({ scale, offset: { x: newOffsetX, y: newOffsetY } });
    }
  }, [setTransform]);

  const addTable = useCallback(() => {
    const width = (INITIAL_COLS * CELL_WIDTH) + HEADER_COL_WIDTH;
    const height = (INITIAL_ROWS * CELL_HEIGHT) + HEADER_ROW_HEIGHT;
    const pos = getNextPosition(width, height);

    const newSheet: SheetData = {
      id: generateId(),
      title: 'New Sheet',
      position: pos,
      size: { width: INITIAL_COLS, height: INITIAL_ROWS },
      cells: {}
    };
    addSheet(newSheet);
    centerViewOn(pos.x, pos.y, width, height);
  }, [addSheet, getNextPosition, centerViewOn]);

  const handleAddNote = useCallback(() => {
    const width = 400;
    const height = 300;
    const pos = getNextPosition(width, height);

    const newNote: NoteData = {
      id: generateId(),
      position: pos,
      size: { width, height },
      content: '', 
      color: 'yellow'
    };
    addNote(newNote);
    setEditingNoteId(newNote.id);
    centerViewOn(pos.x, pos.y, width, height);
  }, [addNote, getNextPosition, centerViewOn]);

  const handleInitChart = useCallback((sheetId: string, defaultColIndex?: number, selectedCols?: number[], initialType?: ChartType) => {
    const sheet = (useStore.getState() as AppState).sheets[sheetId];
    if (!sheet) return;

    const headers = getSheetHeaders(sheet);
    
    // 1. Smart X-Axis Selection (Group Column)
    let groupColId = headers.length > 0 ? headers[0].id : 'A';
    const dateCol = headers.find(h => inferColumnType(sheet, h.id) === 'date');
    if (dateCol) {
        groupColId = dateCol.id;
    } else {
        groupColId = headers[0]?.id || 'A';
    }

    // 2. Smart Metric Selection (Value Column)
    let valueColId = '';
    
    if (selectedCols && selectedCols.length > 0) {
        const selectedHeader = headers.find(h => selectedCols.includes(h.index) && h.id !== groupColId);
        if (selectedHeader) {
            valueColId = selectedHeader.id;
        } else {
             const anySelected = headers.find(h => selectedCols.includes(h.index));
             if (anySelected) valueColId = anySelected.id;
        }
    }

    if (!valueColId) {
        const numCol = headers.find(h => h.id !== groupColId && inferColumnType(sheet, h.id) === 'number');
        if (numCol) {
            valueColId = numCol.id;
        } else {
            valueColId = headers.length > 1 ? headers[1].id : (headers[0]?.id || 'B');
            if (valueColId === groupColId && headers.length > 1) {
                 const other = headers.find(h => h.id !== groupColId);
                 if (other) valueColId = other.id;
            }
        }
    }

    // 3. Smart Granularity
    let timeGranularity: TimeGranularity | undefined = undefined;
    const isGroupDate = inferColumnType(sheet, groupColId) === 'date';
    
    if (isGroupDate) {
        const count = getValidDataCount(sheet, groupColId);
        timeGranularity = suggestGranularityByCount(count);
    }

    const initialChartType = initialType || 'bar';

    const defaultPalette = getChartPalette(chartColorSettings, darkMode);

    const newChart: ChartData = {
        id: generateId(),
        sourceSheetId: sheetId,
        position: { x: sheet.position.x + (sheet.size.width * CELL_WIDTH) + 50, y: sheet.position.y },
        size: DEFAULT_CHART_SIZE,
        title: `${sheet.title} Chart`,
        config: {
            type: initialChartType,
            mode: 'group', 
            groupCol: groupColId,
            valueCol: valueColId,
            operation: 'SUM',
            timeGranularity: timeGranularity,
            
            labelColumn: groupColId,
            dataColumns: [valueColId],
            
            color: defaultPalette[0],
            colorScheme: 'workspace',
            colorOverride: false,
            highlightIndex: -1,
            animation: true,
            showLabels: true
        },
        setupRequired: false
    };

    addChart(newChart);
    ensureVisible({
        x: newChart.position.x,
        y: newChart.position.y,
        width: newChart.size.width,
        height: newChart.size.height
    });
  }, [chartColorSettings, darkMode, addChart, ensureVisible]);

  const handleInitPivot = useCallback((sheetId: string, defaultColIndex?: number) => {
      const sourceSheet = (useStore.getState() as AppState).sheets[sheetId];
      if (!sourceSheet) return;

      const headers = getSheetHeaders(sourceSheet);
      let rowLabelCol = headers.length > 0 ? headers[0].id : 'A';
      if (defaultColIndex !== undefined) {
          const h = headers.find(header => header.index === defaultColIndex);
          if (h) rowLabelCol = h.id;
      }
      let valueCol = headers.length > 1 ? headers[1].id : rowLabelCol;
      if (valueCol === rowLabelCol && headers.length > 1) {
          valueCol = headers.find(h => h.id !== rowLabelCol)?.id || valueCol;
      }

      const initialConfig: PivotConfig = {
          sourceSheetId: sheetId,
          rowLabelCol: rowLabelCol,
          values: [{ column: valueCol, operation: 'SUM' }]
      };
      
      const newSheetSize = { width: 4, height: 15 };
      const newSheet: SheetData = {
          id: generateId(),
          title: `Pivot: ${sourceSheet.title}`,
          position: { 
              x: sourceSheet.position.x + (sourceSheet.size.width * CELL_WIDTH) + 60, 
              y: sourceSheet.position.y 
          },
          size: newSheetSize,
          cells: {},
          pivotConfig: initialConfig,
          setupRequired: true
      };

      addSheet(newSheet);
      ensureVisible({
          x: newSheet.position.x,
          y: newSheet.position.y,
          width: (newSheetSize.width * CELL_WIDTH) + HEADER_COL_WIDTH,
          height: (newSheetSize.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT
      });
  }, [addSheet, ensureVisible]);

  const handleInitSparkline = useCallback((sheetId: string) => {
      const sourceSheet = (useStore.getState() as AppState).sheets[sheetId];
      if (!sourceSheet) return;

      const newSheetSize = { width: 4, height: 16 };
      const newSheet: SheetData = {
          id: generateId(),
          title: `Sparklines: ${sourceSheet.title}`,
          position: { 
              x: sourceSheet.position.x + (sourceSheet.size.width * CELL_WIDTH) + 60, 
              y: sourceSheet.position.y + 100
          },
          size: newSheetSize,
          cells: {},
          sparklineConfig: {
              sourceSheetId: sheetId,
              dateCol: '',
              mode: 'metrics'
          },
          setupRequired: true
      };
      
      addSheet(newSheet);
      ensureVisible({
          x: newSheet.position.x,
          y: newSheet.position.y,
          width: (newSheetSize.width * CELL_WIDTH) + HEADER_COL_WIDTH,
          height: (newSheetSize.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT
      });
  }, [addSheet, ensureVisible]);

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    const x = (e.clientX - transform.offset.x) / transform.scale;
    const y = (e.clientY - transform.offset.y) / transform.scale;

    const newNote: NoteData = {
      id: generateId(),
      position: { x, y },
      size: { width: 400, height: 100 },
      content: '', 
      color: 'gray'
    };
    addNote(newNote);
    setEditingNoteId(newNote.id);
  };

  const handleAddColor = useCallback((newColor: string) => {
      addChartColor(newColor);
  }, [addChartColor]);

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (toolMode === ToolMode.SELECT) {
        setSelectionBox({
            start: { x: e.clientX, y: e.clientY },
            current: { x: e.clientX, y: e.clientY }
        });
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            useStore.getState().clearSelection();
            setActiveSelection({ sheetId: null, cellId: null, range: null });
        }
    }
  };

  const handleItemMouseDown = (e: React.MouseEvent, id: string, type: 'sheet' | 'chart' | 'note') => {
    e.stopPropagation();
    dragStartSnapshot.current = true;
    
    setDraggingId(id);
    setDraggingType(type);
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    const state = useStore.getState();
    const isShift = e.shiftKey || e.ctrlKey || e.metaKey;
    
    // Selection logic
    if (isShift) {
        select([id], true);
    } else {
        if (!selectedIds.has(id)) {
            select([id]);
        }
    }

    // IMPORTANT: Capture initial positions for DIRECT DOM MANIPULATION
    // This allows us to move elements without re-rendering React components
    // We check state again because select() might have updated it
    const updatedState = useStore.getState();
    const currentSelected = updatedState.selectedIds;
    const newDragPositions: Record<string, Position> = {};

    currentSelected.forEach(selId => {
        let pos: Position | null = null;
        if (updatedState.sheets[selId]) pos = updatedState.sheets[selId].position;
        else if (updatedState.charts[selId]) pos = updatedState.charts[selId].position;
        else if (updatedState.notes[selId]) pos = updatedState.notes[selId].position;
        
        if (pos) {
            newDragPositions[selId] = { ...pos };
        }
    });
    
    // Ensure the clicked item is tracked even if something went wrong with selection sync
    if (!newDragPositions[id]) {
         let pos: Position | null = null;
         if (type === 'sheet') pos = updatedState.sheets[id].position;
         else if (type === 'chart') pos = updatedState.charts[id].position;
         else if (type === 'note') pos = updatedState.notes[id].position;
         if (pos) newDragPositions[id] = { ...pos };
    }

    dragInitialPositions.current = newDragPositions;

    // OPTIMIZATION: Set will-change once at start of drag
    Object.keys(newDragPositions).forEach(key => {
        const el = document.getElementById(`sheet-${key}`) || document.getElementById(`chart-${key}`) || document.getElementById(`note-${key}`);
        if (el) el.style.willChange = 'left, top';
    });
  };

  // Better Move Handler with Total Delta
  const dragStartMousePos = useRef<Position | null>(null);

  const handleGlobalMouseMoveOptimized = useCallback((e: MouseEvent) => {
      if (selectionBox) {
          setSelectionBox(prev => prev ? ({ ...prev, current: { x: e.clientX, y: e.clientY } }) : null);
          return;
      }

      if (draggingId && dragStartMousePos.current) {
          const startPos = dragStartMousePos.current;
          const deltaX = (e.clientX - startPos.x) / transform.scale;
          const deltaY = (e.clientY - startPos.y) / transform.scale;

          Object.entries(dragInitialPositions.current).forEach(([id, initialPos]) => {
              // Explicit cast to Position to avoid 'unknown' type errors
              const pos = initialPos as Position;
              let el = document.getElementById(`sheet-${id}`);
              if (!el) el = document.getElementById(`chart-${id}`);
              if (!el) el = document.getElementById(`note-${id}`);

              if (el) {
                  el.style.left = `${pos.x + deltaX}px`;
                  el.style.top = `${pos.y + deltaY}px`;
                  // NOTE: will-change is already set in onMouseDown
              }
          });
      }
  }, [draggingId, selectionBox, transform.scale]);

  // Hook up the refined handler
  useEffect(() => {
      if (draggingId) {
          dragStartMousePos.current = { x: lastMousePos.current.x, y: lastMousePos.current.y };
      }
  }, [draggingId]);


  const handleGlobalMouseUp = useCallback((e: MouseEvent) => {
    if (selectionBox) {
        const { start, current } = selectionBox;
        const toCanvas = (x: number, y: number) => ({
            x: (x - transform.offset.x) / transform.scale,
            y: (y - transform.offset.y) / transform.scale
        });
        const startC = toCanvas(start.x, start.y);
        const endC = toCanvas(current.x, current.y);
        
        const box = {
            x: Math.min(startC.x, endC.x),
            y: Math.min(startC.y, endC.y),
            width: Math.abs(endC.x - startC.x),
            height: Math.abs(endC.y - startC.y)
        };

        const state = useStore.getState() as AppState;
        const intersect = (pos: Position, size: { width: number, height: number }, isSheet = false) => {
             let w = size.width;
             let h = size.height;
             if (isSheet) {
                 w = (w * CELL_WIDTH) + HEADER_COL_WIDTH;
                 h = (h * CELL_HEIGHT) + HEADER_ROW_HEIGHT;
             }
             return (
                 pos.x < box.x + box.width &&
                 pos.x + w > box.x &&
                 pos.y < box.y + box.height &&
                 pos.y + h > box.y
             );
        };

        const newSelection: string[] = [];
        (Object.values(state.sheets) as SheetData[]).forEach(s => { if (intersect(s.position, s.size, true)) newSelection.push(s.id); });
        (Object.values(state.charts) as ChartData[]).forEach(c => { if (intersect(c.position, c.size)) newSelection.push(c.id); });
        (Object.values(state.notes) as NoteData[]).forEach(n => { if (intersect(n.position, n.size)) newSelection.push(n.id); });

        select(newSelection, true);
        setSelectionBox(null);
    }

    // Commit Drag Changes
    if (draggingId && dragStartMousePos.current) {
        const deltaX = (e.clientX - dragStartMousePos.current.x) / transform.scale;
        const deltaY = (e.clientY - dragStartMousePos.current.y) / transform.scale;

        // Only save if there was movement
        if (Math.abs(deltaX) > 1 || Math.abs(deltaY) > 1) {
            if (dragStartSnapshot.current) saveSnapshot();

            const s = useStore.getState() as AppState;
            Object.entries(dragInitialPositions.current).forEach(([id, initialPos]) => {
                const pos = initialPos as Position;
                const newPos = { x: pos.x + deltaX, y: pos.y + deltaY };
                
                // Cleanup DOM hints
                let el = document.getElementById(`sheet-${id}`);
                if (!el) el = document.getElementById(`chart-${id}`);
                if (!el) el = document.getElementById(`note-${id}`);
                if (el) el.style.willChange = 'auto';

                if (s.sheets[id]) updateSheet(id, { position: newPos });
                else if (s.charts[id]) updateChart(id, { position: newPos });
                else if (s.notes[id]) updateNote(id, { position: newPos });
            });
        } else {
            // Even if no movement, cleanup will-change
            Object.keys(dragInitialPositions.current).forEach(id => {
                let el = document.getElementById(`sheet-${id}`);
                if (!el) el = document.getElementById(`chart-${id}`);
                if (!el) el = document.getElementById(`note-${id}`);
                if (el) el.style.willChange = 'auto';
            });
        }
    }

    setDraggingId(null);
    setDraggingType(null);
    dragStartSnapshot.current = null;
    dragStartMousePos.current = null;
    dragInitialPositions.current = {};
  }, [draggingId, draggingType, selectionBox, transform, select, saveSnapshot, updateSheet, updateChart, updateNote]);

  useEffect(() => {
    if (draggingId || selectionBox) {
      window.addEventListener('mousemove', handleGlobalMouseMoveOptimized);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    } else {
      window.removeEventListener('mousemove', handleGlobalMouseMoveOptimized);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMoveOptimized);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingId, selectionBox, handleGlobalMouseMoveOptimized, handleGlobalMouseUp]);

  const processImportedFiles = async (files: File[], targetPos?: { x: number, y: number }) => {
    let createdCount = 0;
    
    // Store original target if drag-and-drop
    const originX = targetPos ? targetPos.x : 0;
    const originY = targetPos ? targetPos.y : 0;

    for (const file of files) {
        const result = await parseFile(file);
        if (!result) continue;
        const { data: matrix, truncated } = result;
        if (matrix.length === 0) continue;
        if (truncated) showToast(`Large file truncated to ${MAX_IMPORT_ROWS} rows`);

        const rows = matrix.length;
        const cols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
        const finalCols = Math.max(cols, INITIAL_COLS);
        const finalRows = Math.max(rows, INITIAL_ROWS);
        const maxViewportRows = Math.floor((window.innerHeight * MAX_INITIAL_VIEWPORT_COVERAGE) / CELL_HEIGHT);
        const maxViewportCols = Math.floor((window.innerWidth * MAX_INITIAL_VIEWPORT_COVERAGE) / CELL_WIDTH);
        const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
        const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));

        const cells: Record<string, CellData> = {};
        matrix.forEach((rowVals, r) => {
            rowVals.forEach((val, c) => {
                const strVal = String(val);
                if (strVal && strVal.trim()) {
                    const id = getCellId(c, r);
                    cells[id] = { raw: strVal.trim(), value: null };
                }
            });
        });

        const tableWidth = (constrainedCols * CELL_WIDTH) + HEADER_COL_WIDTH;
        const tableHeight = (constrainedRows * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

        let pos;
        if (targetPos) {
            pos = { 
                x: originX + (createdCount * 30), 
                y: originY + (createdCount * 30) 
            };
        } else {
            // Auto position to the bottom if not dropping
            pos = getNextPosition(tableWidth, tableHeight);
        }

        const newSheet: SheetData = {
            id: generateId(),
            title: String(file.name).replace(/\.[^/.]+$/, ""),
            position: pos,
            size: { width: constrainedCols, height: constrainedRows },
            cells
        };

        addSheet(newSheet);
        
        // Only center view if not using drag and drop (user manually placed it otherwise)
        if (!targetPos) {
            centerViewOn(pos.x, pos.y, tableWidth, tableHeight);
        }
        
        createdCount++;
    }
  };

  const handleDataConnectImport = (title: string, matrix: string[][], config: ConnectorConfig) => {
      let finalMatrix = matrix;
      let truncated = false;
      
      if (finalMatrix.length > MAX_IMPORT_ROWS) {
          finalMatrix = finalMatrix.slice(0, MAX_IMPORT_ROWS);
          truncated = true;
      }
      
      const widestColumnCount = finalMatrix.reduce((max, row) => Math.max(max, row.length), 0);
      if (widestColumnCount > MAX_CONNECTED_IMPORT_COLS) {
          finalMatrix = finalMatrix.map(row => row.slice(0, MAX_CONNECTED_IMPORT_COLS));
          truncated = true;
      }

      const sourceTruncated = !!config.truncated;
      const connectorTruncated = sourceTruncated || truncated;
      if (truncated) {
          showToast(`Large dataset truncated to ${MAX_IMPORT_ROWS} rows / ${MAX_CONNECTED_IMPORT_COLS} cols`);
      } else if (sourceTruncated) {
          showToast('Connector returned truncated data');
      }

      const rows = finalMatrix.length;
      const cols = finalMatrix.reduce((max, row) => Math.max(max, row.length), 0);
      const finalCols = Math.max(cols, INITIAL_COLS);
      const finalRows = Math.max(rows, INITIAL_ROWS);
      const maxViewportRows = Math.floor((window.innerHeight * MAX_INITIAL_VIEWPORT_COVERAGE) / CELL_HEIGHT);
      const maxViewportCols = Math.floor((window.innerWidth * MAX_INITIAL_VIEWPORT_COVERAGE) / CELL_WIDTH);
      const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
      const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));
      const tableWidth = (constrainedCols * CELL_WIDTH) + HEADER_COL_WIDTH;
      const tableHeight = (constrainedRows * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

      const cells: Record<string, CellData> = {};
      finalMatrix.forEach((rowVals, r) => {
          rowVals.forEach((val, c) => {
              const strVal = String(val);
              if (strVal.trim()) {
                  const id = getCellId(c, r);
                  cells[id] = { raw: strVal.trim(), value: null };
              }
          });
      });

      const pos = getNextPosition(tableWidth, tableHeight);

      const newSheet: SheetData = {
          id: generateId(),
          title: title,
          position: pos,
          size: { width: constrainedCols, height: constrainedRows },
          cells,
          connectorConfig: { ...config, truncated: connectorTruncated }
      };

      addSheet(newSheet);
      centerViewOn(pos.x, pos.y, tableWidth, tableHeight);
      showToast(`Imported "${title}"`);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDraggingFile(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); if (!e.relatedTarget || (e.relatedTarget as HTMLElement).nodeName === 'HTML') setIsDraggingFile(false); };
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingFile(false);
    const files: File[] = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;
    const x = (e.clientX - transform.offset.x) / transform.scale;
    const y = (e.clientY - transform.offset.y) / transform.scale;
    await processImportedFiles(files, { x, y });
  };
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          await processImportedFiles(Array.from(e.target.files));
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
  }

  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        
        const text = e.clipboardData?.getData('text');
        if (!text) return;

        const { data: matrix, truncated } = parseClipboardData(text);
        if (!matrix || matrix.length === 0) return;

        e.preventDefault();
        if (truncated) showToast(`Large content truncated to ${MAX_IMPORT_ROWS} rows`);

        const rows = matrix.length;
        const cols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
        
        const finalCols = Math.max(cols, INITIAL_COLS);
        const finalRows = Math.max(rows, INITIAL_ROWS);
        const maxViewportRows = Math.floor((window.innerHeight * MAX_INITIAL_VIEWPORT_COVERAGE) / CELL_HEIGHT);
        const maxViewportCols = Math.floor((window.innerWidth * MAX_INITIAL_VIEWPORT_COVERAGE) / CELL_WIDTH);
        const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
        const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));
        const tableWidth = (constrainedCols * CELL_WIDTH) + HEADER_COL_WIDTH;
        const tableHeight = (constrainedRows * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

        const cells: Record<string, CellData> = {};
        matrix.forEach((rowVals, r) => {
            rowVals.forEach((val, c) => {
                const strVal = String(val);
                if (strVal.trim()) {
                    const id = getCellId(c, r);
                    cells[id] = { raw: strVal.trim(), value: null };
                }
            });
        });

        const pos = getNextPosition(tableWidth, tableHeight);

        const newSheet: SheetData = {
            id: generateId(),
            title: `Pasted Data`,
            position: pos,
            size: { width: constrainedCols, height: constrainedRows },
            cells
        };

        addSheet(newSheet);
        centerViewOn(pos.x, pos.y, tableWidth, tableHeight);
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [getNextPosition, addSheet, centerViewOn]);

  const handleCopySelectionAsImage = async () => {
    const selected = Array.from(selectedIds) as string[];
    if (selected.length === 0) return;

    showToast("Preparing image...");
    const state = useStore.getState() as AppState;

    try {
        const html2canvas = (await import('html2canvas')).default;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const itemsToRender: { id: string, elementId: string, x: number, y: number, el: HTMLElement }[] = [];

        for (const id of selected) {
            const sheet = state.sheets[id];
            const chart = state.charts[id];
            const note = state.notes[id];
            
            let elementId = '';
            let x = 0, y = 0;
            
            if (sheet) { elementId = `sheet-${id}`; x = sheet.position.x; y = sheet.position.y; }
            else if (chart) { elementId = `chart-${id}`; x = chart.position.x; y = chart.position.y; }
            else if (note) { elementId = `note-${id}`; x = note.position.x; y = note.position.y; }
            else continue;
            
            const el = document.getElementById(elementId);
            if (!el) continue;
            
            const w = el.offsetWidth;
            const h = el.offsetHeight;
            
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
            
            itemsToRender.push({ id, elementId, x, y, el });
        }

        if (itemsToRender.length === 0) return;
        
        const padding = 20;
        const totalWidth = (maxX - minX) + (padding * 2);
        const totalHeight = (maxY - minY) + (padding * 2);
        const scale = 2; 

        const masterCanvas = document.createElement('canvas');
        masterCanvas.width = totalWidth * scale;
        masterCanvas.height = totalHeight * scale;
        const ctx = masterCanvas.getContext('2d');
        if (!ctx) return;
        
        for (const item of itemsToRender) {
            const canvas = await html2canvas(item.el, {
                backgroundColor: null,
                scale: scale,
                logging: false,
                useCORS: true,
                onclone: (clonedDoc) => {
                    const clonedEl = clonedDoc.getElementById(item.elementId);
                    if (clonedEl) {
                        clonedEl.classList.remove('ring-1', 'ring-teal-400', 'shadow-md', 'z-50');
                        if (clonedEl.classList.contains('border-teal-400')) {
                            clonedEl.classList.remove('border-teal-400');
                            clonedEl.classList.add('border-neutral-200');
                            if (darkMode) clonedEl.classList.add('dark:border-neutral-700');
                        }
                    }
                }
            });
            
            const drawX = (item.x - minX + padding) * scale;
            const drawY = (item.y - minY + padding) * scale;
            
            ctx.drawImage(canvas, drawX, drawY);
        }

        masterCanvas.toBlob(async (blob) => {
            if (blob) {
                const item = new ClipboardItem({ 'image/png': blob });
                await navigator.clipboard.write([item]);
                showToast("Selection copied to clipboard");
            }
        });

    } catch (e: any) {
        console.error(e);
        showToast("Failed to copy image");
    }
  };

  return (
    <div 
      className={`w-full h-full overflow-hidden font-sans transition-colors duration-300 ${darkMode ? 'dark' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="w-full h-full bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 relative">
        <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileSelect} multiple accept=".csv,.xlsx,.xls"/>
        {isDraggingFile && (
            <div className="absolute inset-0 z-[100] bg-teal-500/10 backdrop-blur-sm m-4 rounded-xl border-4 border-dashed border-teal-500 flex flex-col items-center justify-center text-teal-600 dark:text-teal-400 pointer-events-none">
                <Upload size={48} className="mb-4 animate-bounce" />
                <h2 className="text-2xl font-bold">Drop files to import</h2>
                <p className="text-sm font-medium opacity-80 mt-1">Supports .csv, .xlsx, .xls</p>
            </div>
        )}
        
        {selectionBox && (
            <div 
                className="fixed z-50 border border-teal-500 bg-teal-500/10 pointer-events-none"
                style={{
                    left: Math.min(selectionBox.start.x, selectionBox.current.x),
                    top: Math.min(selectionBox.start.y, selectionBox.current.y),
                    width: Math.abs(selectionBox.current.x - selectionBox.start.x),
                    height: Math.abs(selectionBox.current.y - selectionBox.start.y),
                }}
            />
        )}

        <Toast message={toast.message} isVisible={toast.visible} onClose={() => setToast({ ...toast, visible: false })} />

        {/* AI Copilot bubble — same pill style as the Toolbar nav bar */}
        <div
            className="fixed bottom-8 z-[999] transition-all duration-[120ms] ease-in-out"
            style={{ right: agentPanelOpen ? 396 : 16 }}
        >
            <div className="p-1.5 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50 rounded-full">
                <button
                    onClick={() => setAgentPanelOpen((v) => !v)}
                    title="Open Copilot"
                    aria-label="Open Copilot"
                    className="group relative p-2.5 rounded-full flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100 transition-all cursor-pointer"
                >
                    <Sparkles size={20} strokeWidth={1.5} />
                </button>
            </div>
        </div>

        <AgentChatPanel
            open={agentPanelOpen}
            onClose={() => setAgentPanelOpen(false)}
            getSelection={() => activeSelectionRef.current}
            darkMode={darkMode}
        />
        <AgentEvalBridge
            enabled={agentEvalEnabled}
            getSelection={() => activeSelectionRef.current}
        />

        <GlobalCommandBar
            isOpen={isCommandBarOpen} 
            onClose={() => setIsCommandBarOpen(false)} 
            darkMode={darkMode}
            setDarkMode={setDarkMode}
            activeSelection={activeSelection}
            onAddTable={addTable}
            onAddNote={handleAddNote}
            onImport={() => fileInputRef.current?.click()}
            onConnectData={() => setDataConnectorState({ isOpen: true })}
            onCopyImage={handleCopySelectionAsImage}
            onInitChart={handleInitChart}
            onInitPivot={handleInitPivot}
            onInitSparkline={handleInitSparkline}
        />
        
        {dataConnectorState.isOpen && (
            <DataConnectorDialog
                onClose={() => setDataConnectorState({ isOpen: false })}
                onImport={handleDataConnectImport}
                initialType={dataConnectorState.initialType}
            />
        )}

        <OnboardingGuide
            isOpen={isOnboardingOpen}
            onClose={closeOnboarding}
            darkMode={darkMode}
        />

        <Canvas
            darkMode={darkMode}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseDown={handleCanvasMouseDown}
            onViewportTransformChange={setViewportTransform}
        >
          {visibleCanvasIds.sheetIds.map(id => (
              <SheetNode
                key={id}
                id={id}
                onAddChart={handleInitChart}
                onAddPivot={handleInitPivot}
                onAddSparkline={handleInitSparkline}
                onToast={showToast}
                isPendingDelete={selectedIds.has(id) && deleteConfirmPending}
                onSelectionContextChange={setActiveSelection}
                onMouseDown={(e) => handleItemMouseDown(e, id, 'sheet')}
              />
          ))}
          {visibleCanvasIds.chartIds.map(id => (
              <ChartNode 
                  key={id}
                  id={id}
                  darkMode={darkMode}
                  isPendingDelete={selectedIds.has(id) && deleteConfirmPending}
                  recentColors={chartRecentColors}
                  colorSettings={chartColorSettings}
                  onColorSettingsChange={updateChartColorSettings}
                  onAddCustomColor={handleAddColor}
                  onMouseDown={(e) => handleItemMouseDown(e, id, 'chart')}
              />
          ))}
          {visibleCanvasIds.noteIds.map(id => (
              <NoteNode
                  key={id}
                  id={id}
                  darkMode={darkMode}
                  initialEditing={id === editingNoteId}
                  isPendingDelete={selectedIds.has(id) && deleteConfirmPending}
                  onMouseDown={(e) => handleItemMouseDown(e, id, 'note')}
              />
          ))}
        </Canvas>
        
        <Toolbar 
            onAddTable={addTable}
            onAddNote={handleAddNote}
            onImport={() => fileInputRef.current?.click()}
            onConnectData={() => setDataConnectorState({ isOpen: true })}
            darkMode={darkMode}
            toggleDarkMode={() => setDarkMode(!darkMode)}
            onOpenCommandBar={() => setIsCommandBarOpen(true)}
            onOpenLearn={() => setIsOnboardingOpen(true)}
            hidden={isCommandBarOpen || isOnboardingOpen}
        />
      </div>
    </div>
  );
};

export default App;
