
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Canvas } from './components/Canvas';
import { SheetNode } from './components/SheetNode';
import { ChartNode } from './components/ChartNode';
import { NoteNode } from './components/NoteNode';
import { Toolbar } from './components/Toolbar';
import { Toast } from './components/Toast';
import { CommandBar } from './components/CommandBar';
import { DataConnectorDialog } from './components/DataConnectorDialog';
import { SheetData, ChartData, NoteData, CanvasTransform, Position, CellData, ChartConfig, PivotConfig, ToolMode, SparklineConfig, Command, SelectionContext, CellFormat, ConnectorConfig, ConnectorType } from './types';
import { INITIAL_COLS, INITIAL_ROWS, CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT, DEFAULT_CHART_SIZE, CHART_COLORS, MAX_IMPORT_ROWS, MAX_IMPORT_COLS, MAX_RENDER_ROWS } from './constants';
import { parseClipboardData } from './utils/clipboard';
import { parseFile } from './utils/fileParser';
import { getCellId, parseCellId, computeSheet } from './utils/formulas';
import { saveAppState, loadAppState, AppState } from './utils/persistence';
import { getSheetHeaders } from './utils/chartHelpers';
import { generatePivotTable, refreshPivotTable } from './utils/pivotHelpers';
import { generateSparklineTable, refreshSparklineTable } from './utils/sparklineHelpers';
import { Upload, Moon, Sun, Table, StickyNote, Undo2, Redo2, Grid3X3, BarChart3, TrendingUp, Palette, AlignLeft, Trash2, ArrowDownAZ, ArrowUpAZ, Filter, MousePointer2, Hand, Hash, Percent, Image as ImageIcon, Database, FileSpreadsheet, BarChart2, Globe, Calendar } from 'lucide-react';

const generateId = () => Math.random().toString(36).substr(2, 9);
const MAX_HISTORY = 50;

interface HistoryState {
  sheets: SheetData[];
  charts: ChartData[];
  notes: NoteData[];
}

const App: React.FC = () => {
  // Initialize based on system preference
  const [darkMode, setDarkMode] = useState(() => 
    typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  
  const [isReady, setIsReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('idle');

  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });

  const [toolMode, setToolMode] = useState<ToolMode>(ToolMode.SELECT);
  const [isCommandBarOpen, setIsCommandBarOpen] = useState(false);
  
  // Data Connector State
  const [dataConnectorState, setDataConnectorState] = useState<{ isOpen: boolean; initialType?: ConnectorType }>({ isOpen: false });

  const [sheets, setSheets] = useState<SheetData[]>(() => {
    const initialSheet = {
      id: 'demo-1',
      title: 'Budget 2024',
      position: { x: 100, y: 100 },
      size: { width: 4, height: 6 },
      cells: {
        'A1': { raw: 'Item', value: null },
        'B1': { raw: 'Cost', value: null },
        'A2': { raw: 'Rent', value: null },
        'B2': { raw: '1200', value: null },
        'A3': { raw: 'Food', value: null },
        'B3': { raw: '400', value: null },
        'A4': { raw: 'Utils', value: null },
        'B4': { raw: '150', value: null },
        'A5': { raw: 'Total', value: null },
        'B5': { raw: '=SUM(B2:B4)', value: null },
      }
    };
    return [computeSheet(initialSheet)];
  });

  const [charts, setCharts] = useState<ChartData[]>([]);
  const [notes, setNotes] = useState<NoteData[]>([]);

  // Chart Colors State
  const [defaultChartColor, setDefaultChartColor] = useState(CHART_COLORS[0]);
  const [customColors, setCustomColors] = useState<string[]>([]);
  
  const chartPalette = useMemo(() => [...CHART_COLORS, ...customColors], [customColors]);

  // Undo/Redo Stacks
  const [history, setHistory] = useState<HistoryState[]>([]);
  const [future, setFuture] = useState<HistoryState[]>([]);
  
  // Track ID of note that should start in edit mode
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  
  // Selection Context (Ref to avoid re-renders on every click)
  const activeSelectionRef = useRef<SelectionContext>({ sheetId: null, cellId: null, range: null });

  // Delete Confirmation State
  const [deleteConfirmPending, setDeleteConfirmPending] = useState(false);
  const deleteTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Dragging State
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingType, setDraggingType] = useState<'sheet' | 'chart' | 'note' | null>(null);
  
  // Selection Box State
  const [selectionBox, setSelectionBox] = useState<{ start: Position, current: Position } | null>(null);

  const lastMousePos = useRef<Position>({ x: 0, y: 0 });
  const dragStartSnapshot = useRef<HistoryState | null>(null);

  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [toast, setToast] = useState<{ message: string; visible: boolean }>({ message: '', visible: false });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Animation Refs
  const animationFrameRef = useRef<number | undefined>(undefined);

  // Load state on mount
  useEffect(() => {
    const init = async () => {
      const loaded: AppState = await loadAppState('default');
      if (loaded && (loaded.sheets.length > 0 || loaded.charts.length > 0 || loaded.notes.length > 0)) {
        setSheets(loaded.sheets);
        setCharts(loaded.charts);
        setNotes(loaded.notes);
        if (loaded.transform) {
          setTransform(loaded.transform);
        }
      }
      if (loaded?.defaultChartColor) setDefaultChartColor(loaded.defaultChartColor);
      if (loaded?.customColors) setCustomColors(loaded.customColors);
      
      setIsReady(true);
      setSaveStatus('saved');
    };
    init();
  }, []);

  // Clean up animation on unmount
  useEffect(() => {
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    }
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => setDarkMode(e.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (!isReady) return;
    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        await saveAppState(sheets, charts, notes, transform, defaultChartColor, customColors);
        setSaveStatus('saved');
      } catch (e) {
        console.error(e);
        setSaveStatus('error');
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [sheets, charts, notes, transform, isReady, defaultChartColor, customColors]);

  const showToast = (message: string) => {
      setToast({ message, visible: true });
  };

  const saveSnapshot = useCallback(() => {
    setHistory(prev => {
      const newHistory = [...prev, { sheets, charts, notes }];
      if (newHistory.length > MAX_HISTORY) return newHistory.slice(newHistory.length - MAX_HISTORY);
      return newHistory;
    });
    setFuture([]);
  }, [sheets, charts, notes]);

  const undo = useCallback(() => {
    setHistory(prev => {
      if (prev.length === 0) return prev;
      const lastState = prev[prev.length - 1];
      const remainingHistory = prev.slice(0, prev.length - 1);
      setFuture(f => [...f, { sheets, charts, notes }]);
      setSheets(lastState.sheets);
      setCharts(lastState.charts);
      setNotes(lastState.notes);
      return remainingHistory;
    });
  }, [sheets, charts, notes]);

  const redo = useCallback(() => {
    setFuture(prev => {
      if (prev.length === 0) return prev;
      const nextState = prev[prev.length - 1];
      const remainingFuture = prev.slice(0, prev.length - 1);
      setHistory(h => {
          const newH = [...h, { sheets, charts, notes }];
          if (newH.length > MAX_HISTORY) return newH.slice(newH.length - MAX_HISTORY);
          return newH;
      });
      setSheets(nextState.sheets);
      setCharts(nextState.charts);
      setNotes(nextState.notes);
      return remainingFuture;
    });
  }, [sheets, charts, notes]);

  const deleteSelectedItems = useCallback(() => {
    saveSnapshot();
    const idsToDelete = new Set(selectedIds);
    const deletedSheetIds = new Set<string>();
    sheets.forEach(s => {
        if (idsToDelete.has(s.id)) deletedSheetIds.add(s.id);
    });

    setSheets(prev => prev.filter(s => {
        if (idsToDelete.has(s.id)) return false;
        if (s.pivotConfig && deletedSheetIds.has(s.pivotConfig.sourceSheetId)) return false;
        if (s.sparklineConfig && deletedSheetIds.has(s.sparklineConfig.sourceSheetId)) return false;
        return true;
    }));

    setCharts(prev => prev.filter(c => {
        if (idsToDelete.has(c.id)) return false;
        if (deletedSheetIds.has(c.sourceSheetId)) return false;
        return true;
    }));

    setNotes(prev => prev.filter(n => !idsToDelete.has(n.id)));
    setSelectedIds(new Set());
  }, [selectedIds, sheets, saveSnapshot]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;

      // Global Shortcuts that work everywhere (even in inputs)
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
  }, [undo, redo, selectedIds, deleteConfirmPending, deleteSelectedItems]);

  // Animation Helper
  const easeInOutCubic = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

  const flyTo = useCallback((targetOffset: Position, targetScale?: number) => {
    const startOffset = transform.offset;
    const startScale = transform.scale;
    const finalScale = targetScale !== undefined ? targetScale : startScale;
    
    const startTime = performance.now();
    const duration = 800;

    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const ease = easeInOutCubic(progress);

      const newOffset = {
        x: startOffset.x + (targetOffset.x - startOffset.x) * ease,
        y: startOffset.y + (targetOffset.y - startOffset.y) * ease
      };
      const newScale = startScale + (finalScale - startScale) * ease;

      setTransform({ offset: newOffset, scale: newScale });

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        animationFrameRef.current = undefined;
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [transform]);

  const addTable = () => {
    saveSnapshot();
    const centerX = (-transform.offset.x + (window.innerWidth / 2)) / transform.scale;
    const centerY = (-transform.offset.y + (window.innerHeight / 2)) / transform.scale;

    const newSheet: SheetData = {
      id: generateId(),
      title: `Sheet ${sheets.length + 1}`,
      position: { x: centerX - 100, y: centerY - 100 },
      size: { width: INITIAL_COLS, height: INITIAL_ROWS },
      cells: {}
    };
    setSheets(prev => [...prev, computeSheet(newSheet)]);
    setSelectedIds(new Set([newSheet.id]));
  };

  const addNote = () => {
    saveSnapshot();
    const centerX = (-transform.offset.x + (window.innerWidth / 2)) / transform.scale;
    const centerY = (-transform.offset.y + (window.innerHeight / 2)) / transform.scale;

    const newNote: NoteData = {
      id: generateId(),
      position: { x: centerX, y: centerY },
      size: { width: 400, height: 300 },
      content: '', 
      color: 'yellow'
    };
    setNotes(prev => [...prev, newNote]);
    setEditingNoteId(newNote.id);
    setSelectedIds(new Set([newNote.id]));
  };

  const handleInitChart = (sheetId: string, defaultColIndex?: number, selectedCols?: number[]) => {
    saveSnapshot();
    const sheet = sheets.find(s => s.id === sheetId);
    if (!sheet) return;

    const headers = getSheetHeaders(sheet);
    let labelCol = headers.length > 0 ? headers[0].id : 'A';
    let dataColumns: string[] = [];

    if (selectedCols && selectedCols.length > 0) {
        const selectedIds = selectedCols.map(idx => headers.find(h => h.index === idx)?.id).filter(id => id !== undefined) as string[];
        if (selectedIds.length > 0) {
            const firstSheetColId = headers.length > 0 ? headers[0].id : null;
            const selectionIncludesFirstCol = firstSheetColId && selectedIds.includes(firstSheetColId);
            if (selectionIncludesFirstCol) {
                labelCol = selectedIds[0];
                dataColumns = selectedIds.slice(1);
            } else {
                dataColumns = selectedIds;
            }
        }
    } 

    if (dataColumns.length === 0) {
        let valueCol = headers.length > 1 ? headers[1].id : (headers.length > 0 ? headers[0].id : 'B');
        if (defaultColIndex !== undefined) {
           const selectedHeader = headers.find(h => h.index === defaultColIndex);
           if (selectedHeader) valueCol = selectedHeader.id;
        }
        dataColumns = [valueCol];
    }

    let rightAxisColumns: string[] | undefined = undefined;
    if (dataColumns.length >= 2) rightAxisColumns = [dataColumns[1]];

    const newChart: ChartData = {
        id: generateId(),
        sourceSheetId: sheetId,
        position: { x: sheet.position.x + (sheet.size.width * CELL_WIDTH) + 50, y: sheet.position.y },
        size: DEFAULT_CHART_SIZE,
        title: `${sheet.title} Chart`,
        config: {
            type: 'line',
            labelColumn: labelCol,
            dataColumns: dataColumns,
            color: defaultChartColor, // Use persisted default color
            highlightIndex: -1,
            animation: true,
            rightAxisColumns: rightAxisColumns,
            showLabels: true
        },
        setupRequired: false
    };

    setCharts(prev => [...prev, newChart]);
    setSelectedIds(new Set([newChart.id]));
  };

  const handleInitPivot = (sheetId: string, defaultColIndex?: number) => {
      saveSnapshot();
      const sourceSheet = sheets.find(s => s.id === sheetId);
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
      
      const newSheet: SheetData = {
          id: generateId(),
          title: `Pivot: ${sourceSheet.title}`,
          position: { 
              x: sourceSheet.position.x + (sourceSheet.size.width * CELL_WIDTH) + 60, 
              y: sourceSheet.position.y 
          },
          size: { width: 4, height: 15 },
          cells: {},
          pivotConfig: initialConfig,
          setupRequired: true
      };

      setSheets(prev => [...prev, newSheet]);
      setSelectedIds(new Set([newSheet.id]));
  };

  const handleInitSparkline = (sheetId: string) => {
      saveSnapshot();
      const sourceSheet = sheets.find(s => s.id === sheetId);
      if (!sourceSheet) return;

      const newSheet: SheetData = {
          id: generateId(),
          title: `Sparklines: ${sourceSheet.title}`,
          position: { 
              x: sourceSheet.position.x + (sourceSheet.size.width * CELL_WIDTH) + 60, 
              y: sourceSheet.position.y + 100
          },
          size: { width: 4, height: 16 },
          cells: {},
          sparklineConfig: {
              sourceSheetId: sheetId,
              dateCol: '',
              mode: 'metrics'
          },
          setupRequired: true
      };
      
      setSheets(prev => [...prev, newSheet]);
      setSelectedIds(new Set([newSheet.id]));
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent) => {
    saveSnapshot();
    const x = (e.clientX - transform.offset.x) / transform.scale;
    const y = (e.clientY - transform.offset.y) / transform.scale;

    const newNote: NoteData = {
      id: generateId(),
      position: { x, y },
      size: { width: 400, height: 100 },
      content: '', 
      color: 'gray'
    };
    setNotes(prev => [...prev, newNote]);
    setEditingNoteId(newNote.id);
    setSelectedIds(new Set([newNote.id]));
  };

  const updateSheet = (id: string, newData: SheetData) => {
    setSheets(prev => {
        const updatedSheets = prev.map(s => s.id === id ? newData : s);
        
        return updatedSheets.map(s => {
            if (s.pivotConfig?.sourceSheetId === id && !s.setupRequired) {
                return refreshPivotTable(s, newData);
            }
            if (s.sparklineConfig?.sourceSheetId === id && !s.setupRequired) {
                return refreshSparklineTable(s, newData);
            }
            return s;
        });
    });
  };
  
  const updateChart = (id: string, newData: ChartData) => {
    setCharts(prev => prev.map(c => c.id === id ? newData : c));
  };

  const handleAddColor = (newColor: string) => {
      setDefaultChartColor(newColor);
      setCustomColors(prevColors => {
            if (!CHART_COLORS.includes(newColor) && !prevColors.includes(newColor)) {
                return [...prevColors, newColor];
            }
            return prevColors;
      });
  };

  const updateNote = (id: string, newData: NoteData) => {
    setNotes(prev => prev.map(n => n.id === id ? newData : n));
  };

  const deleteSheet = (id: string) => {
    saveSnapshot();
    setSheets(prev => prev.filter(s => s.id !== id));
    setCharts(prev => prev.filter(c => c.sourceSheetId !== id));
    setSheets(prev => prev.filter(s => s.pivotConfig?.sourceSheetId !== id));
    setSheets(prev => prev.filter(s => s.sparklineConfig?.sourceSheetId !== id));
    setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
    });
  };

  const deleteChart = (id: string) => {
      saveSnapshot();
      setCharts(prev => prev.filter(c => c.id !== id));
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
    });
  };

  const deleteNote = (id: string) => {
    saveSnapshot();
    setNotes(prev => prev.filter(n => n.id !== id));
    setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
    });
  };

  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (toolMode === ToolMode.SELECT) {
        setSelectionBox({
            start: { x: e.clientX, y: e.clientY },
            current: { x: e.clientX, y: e.clientY }
        });
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
            setSelectedIds(new Set());
            // Clear selection context
            activeSelectionRef.current = { sheetId: null, cellId: null, range: null };
        }
    }
  };

  const handleItemMouseDown = (e: React.MouseEvent, id: string, type: 'sheet' | 'chart' | 'note') => {
    e.stopPropagation();
    dragStartSnapshot.current = { sheets, charts, notes };
    setDraggingId(id);
    setDraggingType(type);
    lastMousePos.current = { x: e.clientX, y: e.clientY };

    const isShift = e.shiftKey || e.ctrlKey || e.metaKey;
    setSelectedIds(prev => {
        const next = new Set(prev);
        if (isShift) {
            if (next.has(id)) next.delete(id);
            else next.add(id);
        } else {
            if (!next.has(id)) {
                next.clear();
                next.add(id);
            }
        }
        return next;
    });
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (selectionBox) {
        setSelectionBox(prev => prev ? ({ ...prev, current: { x: e.clientX, y: e.clientY } }) : null);
        return;
    }

    if (draggingId) {
      const dx = (e.clientX - lastMousePos.current.x) / transform.scale;
      const dy = (e.clientY - lastMousePos.current.y) / transform.scale;
      lastMousePos.current = { x: e.clientX, y: e.clientY };

      if (dx === 0 && dy === 0) return;

      setSheets(prev => prev.map(s => {
        if (selectedIds.has(s.id)) return { ...s, position: { x: s.position.x + dx, y: s.position.y + dy } };
        return s;
      }));

      setCharts(prev => prev.map(c => {
          if (selectedIds.has(c.id)) return { ...c, position: { x: c.position.x + dx, y: c.position.y + dy } };
          return c;
      }));

      setNotes(prev => prev.map(n => {
          if (selectedIds.has(n.id)) return { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } };
          return n;
      }));
    }
  }, [draggingId, selectionBox, transform.scale, selectedIds]);

  const handleGlobalMouseUp = useCallback(() => {
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

        const intersect = (item: { position: Position, size: { width: number, height: number } }, isSheet = false) => {
             let w = item.size.width;
             let h = item.size.height;
             if (isSheet) {
                 const sheetData = item as unknown as SheetData;
                 w = (sheetData.size.width * CELL_WIDTH) + HEADER_COL_WIDTH;
                 h = (sheetData.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT;
             }
             return (
                 item.position.x < box.x + box.width &&
                 item.position.x + w > box.x &&
                 item.position.y < box.y + box.height &&
                 item.position.y + h > box.y
             );
        };

        const newSelection = new Set(selectedIds);
        sheets.forEach(s => { if (intersect(s, true)) newSelection.add(s.id); });
        charts.forEach(c => { if (intersect(c)) newSelection.add(c.id); });
        notes.forEach(n => { if (intersect(n)) newSelection.add(n.id); });

        setSelectedIds(newSelection);
        setSelectionBox(null);
    }

    if (draggingId && dragStartSnapshot.current) {
        const hasChanged = () => {
            const snap = dragStartSnapshot.current;
            if (!snap) return false;
            let moved = false;
            const checkItem = (id: string, list: any[], snapList: any[]) => {
                const startObj = snapList.find((i: any) => i.id === id);
                const currObj = list.find((i: any) => i.id === id);
                return startObj && currObj && (startObj.position.x !== currObj.position.x || startObj.position.y !== currObj.position.y);
            };
            if (draggingType === 'sheet') moved = checkItem(draggingId, sheets, snap.sheets);
            else if (draggingType === 'chart') moved = checkItem(draggingId, charts, snap.charts);
            else if (draggingType === 'note') moved = checkItem(draggingId, notes, snap.notes);
            return moved;
        };

        if (hasChanged()) {
             setHistory(prev => {
                const newHistory = [...prev, dragStartSnapshot.current!];
                if (newHistory.length > MAX_HISTORY) return newHistory.slice(newHistory.length - MAX_HISTORY);
                return newHistory;
             });
             setFuture([]);
        }
    }

    setDraggingId(null);
    setDraggingType(null);
    dragStartSnapshot.current = null;
  }, [draggingId, draggingType, sheets, charts, notes, selectionBox, transform, selectedIds]);

  useEffect(() => {
    if (draggingId || selectionBox) {
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
    } else {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, [draggingId, selectionBox, handleGlobalMouseMove, handleGlobalMouseUp]);

  const processImportedFiles = async (files: File[], targetPos?: { x: number, y: number }) => {
    saveSnapshot();
    let centerX: number, centerY: number;
    if (targetPos) {
        centerX = targetPos.x;
        centerY = targetPos.y;
    } else {
        centerX = (-transform.offset.x + (window.innerWidth / 2)) / transform.scale;
        centerY = (-transform.offset.y + (window.innerHeight / 2)) / transform.scale;
    }
    
    let createdCount = 0;
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
        const maxViewportRows = Math.floor((window.innerHeight - 200) / CELL_HEIGHT);
        const maxViewportCols = Math.floor((window.innerWidth - 200) / CELL_WIDTH);
        const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
        const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));

        const cells: Record<string, CellData> = {};
        matrix.forEach((rowVals, r) => {
            rowVals.forEach((val, c) => {
                if (val && String(val).trim()) {
                    const id = getCellId(c, r);
                    cells[id] = { raw: String(val).trim(), value: null };
                }
            });
        });

        const offsetX = createdCount * 30; 
        const offsetY = createdCount * 30;
        const tableWidth = (constrainedCols * CELL_WIDTH) + HEADER_COL_WIDTH;
        const centeringHeight = (constrainedRows * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

        const newSheet: SheetData = {
            id: generateId(),
            title: file.name.replace(/\.[^/.]+$/, ""),
            position: { 
                x: centerX + offsetX - (tableWidth / 2),
                y: centerY + offsetY - (centeringHeight / 2)
            },
            size: { width: constrainedCols, height: constrainedRows },
            cells
        };

        setSheets(prev => [...prev, computeSheet(newSheet)]);
        setSelectedIds(new Set([newSheet.id]));
        createdCount++;
    }
  };

  const handleDataConnectImport = (title: string, matrix: string[][], config: ConnectorConfig) => {
      saveSnapshot();
      const centerX = (-transform.offset.x + (window.innerWidth / 2)) / transform.scale;
      const centerY = (-transform.offset.y + (window.innerHeight / 2)) / transform.scale;

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
      
      if (truncated) showToast(`Large dataset truncated to ${MAX_IMPORT_ROWS} rows / ${MAX_IMPORT_COLS} cols`);

      const rows = finalMatrix.length;
      const cols = finalMatrix.reduce((max, row) => Math.max(max, row.length), 0);
      const finalCols = Math.max(cols, INITIAL_COLS);
      const finalRows = Math.max(rows, INITIAL_ROWS);
      const maxViewportRows = Math.floor((window.innerHeight - 200) / CELL_HEIGHT);
      const maxViewportCols = Math.floor((window.innerWidth - 200) / CELL_WIDTH);
      const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
      const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));
      const tableWidth = (constrainedCols * CELL_WIDTH) + HEADER_COL_WIDTH;
      const centeringHeight = (constrainedRows * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

      const cells: Record<string, CellData> = {};
      finalMatrix.forEach((rowVals, r) => {
          rowVals.forEach((val, c) => {
              if (val.trim()) {
                  const id = getCellId(c, r);
                  cells[id] = { raw: val.trim(), value: null };
              }
          });
      });

      const newSheet: SheetData = {
          id: generateId(),
          title: title,
          position: { x: centerX - (tableWidth / 2), y: centerY - (centeringHeight / 2) },
          size: { width: constrainedCols, height: constrainedRows },
          cells,
          connectorConfig: config // Store the connection info
      };

      setSheets(prev => [...prev, computeSheet(newSheet)]);
      setSelectedIds(new Set([newSheet.id]));
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

  // Global Paste for App level (creating new sheets from clipboard)
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
        
        const text = e.clipboardData?.getData('text');
        if (!text) return;

        const { data: matrix, truncated } = parseClipboardData(text);
        if (!matrix || matrix.length === 0) return;

        e.preventDefault();
        saveSnapshot();
        if (truncated) showToast(`Large content truncated to ${MAX_IMPORT_ROWS} rows`);

        const rows = matrix.length;
        const cols = matrix.reduce((max, row) => Math.max(max, row.length), 0);
        const centerX = (-transform.offset.x + (window.innerWidth / 2)) / transform.scale;
        const centerY = (-transform.offset.y + (window.innerHeight / 2)) / transform.scale;
        const finalCols = Math.max(cols, INITIAL_COLS);
        const finalRows = Math.max(rows, INITIAL_ROWS);
        const maxViewportRows = Math.floor((window.innerHeight - 200) / CELL_HEIGHT);
        const maxViewportCols = Math.floor((window.innerWidth - 200) / CELL_WIDTH);
        const constrainedRows = Math.min(finalRows, Math.max(INITIAL_ROWS, maxViewportRows));
        const constrainedCols = Math.min(finalCols, Math.max(INITIAL_COLS, maxViewportCols));
        const tableWidth = (constrainedCols * CELL_WIDTH) + HEADER_COL_WIDTH;
        const centeringHeight = (constrainedRows * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

        const cells: Record<string, CellData> = {};
        matrix.forEach((rowVals, r) => {
            rowVals.forEach((val, c) => {
                if (val.trim()) {
                    const id = getCellId(c, r);
                    cells[id] = { raw: val.trim(), value: null };
                }
            });
        });

        const newSheet: SheetData = {
            id: generateId(),
            title: `Pasted Data ${sheets.length + 1}`,
            position: { x: centerX - (tableWidth / 2), y: centerY - (centeringHeight / 2) },
            size: { width: constrainedCols, height: constrainedRows },
            cells
        };

        setSheets(prev => [...prev, computeSheet(newSheet)]);
        setSelectedIds(new Set([newSheet.id]));
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [sheets.length, transform, saveSnapshot]);

  const handleCopyNodeAsImage = async (id: string, type: 'sheet' | 'chart') => {
      const elementId = type === 'sheet' ? `sheet-${id}` : `chart-${id}`;
      const element = document.getElementById(elementId);
      if (!element) return;
      
      try {
          const html2canvas = (await import('html2canvas')).default;
          const canvas = await html2canvas(element, {
              backgroundColor: darkMode ? '#171717' : '#fafafa',
              scale: 2
          });
          
          canvas.toBlob(async (blob) => {
              if (blob) {
                  await navigator.clipboard.write([
                      new ClipboardItem({ 'image/png': blob })
                  ]);
                  showToast("Copied to clipboard");
              }
          });
      } catch (e) {
          console.error(e);
          showToast("Failed to copy image");
      }
  }

  const handleCopySelectionAsImage = async () => {
    const selected = Array.from(selectedIds);
    if (selected.length === 0) return;

    showToast("Preparing image...");

    try {
        const html2canvas = (await import('html2canvas')).default;
        
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const itemsToRender: { id: string, elementId: string, x: number, y: number, el: HTMLElement }[] = [];

        // 1. Calculate Bounds and gather elements
        for (const id of selected) {
            const sheet = sheets.find(s => s.id === id);
            const chart = charts.find(c => c.id === id);
            const note = notes.find(n => n.id === id);
            
            let elementId = '';
            let x = 0, y = 0;
            
            if (sheet) { elementId = `sheet-${id}`; x = sheet.position.x; y = sheet.position.y; }
            else if (chart) { elementId = `chart-${id}`; x = chart.position.x; y = chart.position.y; }
            else if (note) { elementId = `note-${id}`; x = note.position.x; y = note.position.y; }
            else continue;
            
            const el = document.getElementById(elementId);
            if (!el) continue;
            
            const rect = el.getBoundingClientRect();
            // We can't rely on rect for x/y absolute because of canvas transform. 
            // We rely on data x/y.
            // But we DO need width/height from DOM because of dynamic sizing (like auto-resize cols).
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
        
        // Render individually and composite
        for (const item of itemsToRender) {
            const canvas = await html2canvas(item.el, {
                backgroundColor: null,
                scale: scale,
                logging: false,
                useCORS: true,
                onclone: (clonedDoc) => {
                    const clonedEl = clonedDoc.getElementById(item.elementId);
                    if (clonedEl) {
                        // Try to remove selection styles for cleaner output
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

    } catch (e) {
        console.error(e);
        showToast("Failed to copy image");
    }
  };

  // Command Bar Generator
  const getCommands = useCallback((): Command[] => {
      const cmds: Command[] = [];
      const ctx = activeSelectionRef.current;
      const firstId = Array.from(selectedIds)[0];
      const activeSheetId = ctx.sheetId || (selectedIds.size === 1 && firstId ? String(firstId) : null);
      
      // Determine context
      const isSheetSelected = !!activeSheetId && sheets.some(s => s.id === activeSheetId);
      const isChartSelected = selectedIds.size === 1 && charts.some(c => c.id === String(firstId));
      const isNoteSelected = selectedIds.size === 1 && notes.some(n => n.id === String(firstId));
      const isMultiSelect = selectedIds.size > 1;

      if (isMultiSelect) {
        cmds.push({
            id: 'copy-selection-image',
            label: 'Copy Selection as Image',
            category: 'Canvas',
            icon: <ImageIcon size={16} />,
            action: handleCopySelectionAsImage
        });
      }

      // -- CONTEXT ACTIONS --

      if (isSheetSelected) {
          const sheet = sheets.find(s => s.id === activeSheetId);
          if (sheet) {
              const activeCol = ctx.cellId ? parseCellId(ctx.cellId)?.col : undefined;
              
              cmds.push({
                  id: 'ctx-chart',
                  label: 'Visualize Data',
                  subLabel: sheet.title,
                  icon: <BarChart3 size={16} />,
                  category: 'Suggested',
                  action: () => handleInitChart(sheet.id, activeCol),
              });
              
              if (!sheet.pivotConfig && !sheet.sparklineConfig) {
                  cmds.push({
                      id: 'ctx-pivot',
                      label: 'Create Pivot Table',
                      subLabel: sheet.title,
                      icon: <Table size={16} />,
                      category: 'Suggested',
                      action: () => handleInitPivot(sheet.id, activeCol),
                  });
                  cmds.push({
                    id: 'ctx-sparkline',
                    label: 'Create Sparklines',
                    subLabel: sheet.title,
                    icon: <TrendingUp size={16} />,
                    category: 'Suggested',
                    action: () => handleInitSparkline(sheet.id),
                  });
              }

              // Filter Action
              cmds.push({
                id: 'ctx-filter',
                label: sheet.showFilterPanel ? 'Hide Filters' : 'Filter Data',
                subLabel: sheet.title,
                icon: <Filter size={16} />,
                category: 'Sheet',
                action: () => {
                    saveSnapshot();
                    updateSheet(sheet.id, { ...sheet, showFilterPanel: !sheet.showFilterPanel });
                }
              });

              // Cell Formatting Context & Sort
              if (activeCol !== undefined) {
                  const colLetter = getCellId(activeCol, -1).replace(/[0-9]/g, '');

                  // Sort Actions
                  cmds.push({
                    id: 'ctx-sort-asc',
                    label: `Sort A to Z (Column ${colLetter})`,
                    category: 'Sheet',
                    icon: <ArrowDownAZ size={16} />,
                    action: () => {
                        saveSnapshot();
                        updateSheet(sheet.id, { ...sheet, sort: { columnId: colLetter, direction: 'asc' }});
                    }
                  });
                  cmds.push({
                    id: 'ctx-sort-desc',
                    label: `Sort Z to A (Column ${colLetter})`,
                    category: 'Sheet',
                    icon: <ArrowUpAZ size={16} />,
                    action: () => {
                        saveSnapshot();
                        updateSheet(sheet.id, { ...sheet, sort: { columnId: colLetter, direction: 'desc' }});
                    }
                  });

                  // Format Actions
                  const applyFormat = (type: 'number' | 'currency' | 'percent' | 'text' | 'date', visual?: 'bar' | 'heatmap', dateFormat?: string) => {
                      saveSnapshot();
                      const newCells = { ...sheet.cells };
                      let hasChange = false;
                      Object.keys(newCells).forEach(k => {
                          const pos = parseCellId(k);
                          if (pos && pos.col === activeCol) {
                              const cell = newCells[k];
                              const newFormat: CellFormat = { ...(cell.format || { type: 'text' }) };
                              if (type === 'currency') { (newFormat as any).type = 'currency'; (newFormat as any).symbol = '$'; (newFormat as any).decimals = 2; }
                              else if (type === 'percent') { (newFormat as any).type = 'percent'; (newFormat as any).decimals = 1; }
                              else if (type === 'number') { (newFormat as any).type = 'number'; (newFormat as any).decimals = 2; }
                              else if (type === 'date') { 
                                  (newFormat as any).type = 'date'; 
                                  (newFormat as any).dateFormat = dateFormat || 'YYYY-MM-DD'; 
                              }
                              else { (newFormat as any).type = 'text'; }
                              
                              if (visual) newFormat.visual = visual;

                              newCells[k] = { ...cell, format: newFormat };
                              hasChange = true;
                          }
                      });
                      if (hasChange) updateSheet(sheet.id, { ...sheet, cells: newCells });
                  };

                  cmds.push({
                      id: 'ctx-format-number',
                      label: 'Format Column as Number',
                      category: 'Cell',
                      icon: <Hash size={16} />,
                      action: () => applyFormat('number')
                  });
                  cmds.push({
                      id: 'ctx-format-percent',
                      label: 'Format Column as Percent',
                      category: 'Cell',
                      icon: <Percent size={16} />,
                      action: () => applyFormat('percent')
                  });
                  cmds.push({
                      id: 'ctx-format-currency',
                      label: 'Format Column as Currency',
                      category: 'Cell',
                      icon: <AlignLeft size={16} />,
                      action: () => applyFormat('currency')
                  });
                  cmds.push({
                      id: 'ctx-format-date-iso',
                      label: 'Format Column as Date (YYYY-MM-DD)',
                      category: 'Cell',
                      icon: <Calendar size={16} />,
                      action: () => applyFormat('date', undefined, 'YYYY-MM-DD')
                  });
                  cmds.push({
                      id: 'ctx-visual-bar',
                      label: 'Add Data Bar to Column',
                      category: 'Cell',
                      icon: <AlignLeft size={16} />,
                      action: () => applyFormat('number', 'bar')
                  });
                  cmds.push({
                      id: 'ctx-visual-heatmap',
                      label: 'Add Heatmap to Column',
                      category: 'Cell',
                      icon: <Palette size={16} />,
                      action: () => applyFormat('number', 'heatmap')
                  });
              }

              cmds.push({
                  id: 'ctx-copy-image-sheet',
                  label: 'Copy Sheet as Image',
                  subLabel: sheet.title,
                  icon: <ImageIcon size={16} />,
                  category: 'Sheet',
                  action: () => handleCopyNodeAsImage(sheet.id, 'sheet')
              });

              cmds.push({
                  id: 'ctx-delete-sheet',
                  label: 'Delete Sheet',
                  subLabel: sheet.title,
                  icon: <Trash2 size={16} />,
                  category: 'Sheet',
                  action: () => deleteSheet(sheet.id)
              });
          }
      }

      if (isChartSelected) {
          const chartId = String(firstId);
          cmds.push({
              id: 'ctx-copy-image-chart',
              label: 'Copy Chart as Image',
              category: 'Chart',
              icon: <ImageIcon size={16} />,
              action: () => handleCopyNodeAsImage(chartId, 'chart')
          });
          cmds.push({
              id: 'ctx-delete-chart',
              label: 'Delete Chart',
              icon: <Trash2 size={16} />,
              category: 'Chart',
              action: () => deleteChart(chartId)
          });
      }

      if (isNoteSelected) {
          const noteId = String(firstId);
          cmds.push({
              id: 'ctx-delete-note',
              label: 'Delete Note',
              icon: <Trash2 size={16} />,
              category: 'Canvas',
              action: () => deleteNote(noteId)
          });
      }

      // -- NAVIGATION --
      
      sheets.forEach(s => {
          cmds.push({
              id: `nav-sheet-${s.id}`,
              label: s.title,
              category: 'Navigation',
              icon: <Grid3X3 size={16} />,
              action: () => {
                  const viewportW = window.innerWidth;
                  const viewportH = window.innerHeight;
                  const sheetW = (s.size.width * CELL_WIDTH) + HEADER_COL_WIDTH;
                  const sheetH = (s.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT;
                  
                  const targetX = (viewportW / 2) - (s.position.x + sheetW / 2) * transform.scale;
                  const targetY = (viewportH / 2) - (s.position.y + sheetH / 2) * transform.scale;

                  flyTo({ x: targetX, y: targetY });
                  
                  // Reorder to bring to front
                  setSheets(prev => [...prev.filter(item => item.id !== s.id), s]);
                  setSelectedIds(new Set([s.id]));
              }
          });
      });

      charts.forEach(c => {
        cmds.push({
            id: `nav-chart-${c.id}`,
            label: c.title,
            category: 'Navigation',
            icon: <BarChart3 size={16} />,
            action: () => {
                const viewportW = window.innerWidth;
                const viewportH = window.innerHeight;
                
                const targetX = (viewportW / 2) - (c.position.x + c.size.width / 2) * transform.scale;
                const targetY = (viewportH / 2) - (c.position.y + c.size.height / 2) * transform.scale;

                flyTo({ x: targetX, y: targetY });

                // Reorder to bring to front
                setCharts(prev => [...prev.filter(item => item.id !== c.id), c]);
                setSelectedIds(new Set([c.id]));
            }
        });
      });

      notes.forEach(n => {
        const preview = n.content.replace(/<[^>]*>?/gm, '').substring(0, 20) || 'Empty Note';
        cmds.push({
            id: `nav-note-${n.id}`,
            label: `Note: ${preview}`,
            category: 'Navigation',
            icon: <StickyNote size={16} />,
            action: () => {
                const viewportW = window.innerWidth;
                const viewportH = window.innerHeight;

                const targetX = (viewportW / 2) - (n.position.x + n.size.width / 2) * transform.scale;
                const targetY = (viewportH / 2) - (n.position.y + n.size.height / 2) * transform.scale;

                flyTo({ x: targetX, y: targetY });

                // Reorder to bring to front
                setNotes(prev => [...prev.filter(item => item.id !== n.id), n]);
                setSelectedIds(new Set([n.id]));
            }
        });
      });

      // -- GLOBAL ACTIONS --

      cmds.push({
          id: 'add-table',
          label: 'Add New Table',
          category: 'Canvas',
          icon: <Grid3X3 size={16} />,
          action: addTable
      });
      cmds.push({
          id: 'add-note',
          label: 'Add Note',
          category: 'Canvas',
          icon: <StickyNote size={16} />,
          action: addNote
      });
      cmds.push({
        id: 'connect-data',
        label: 'Connect Data Source...',
        category: 'Canvas',
        icon: <Database size={16} />,
        action: () => setDataConnectorState({ isOpen: true })
      });
      cmds.push({
        id: 'connect-data-gsheet',
        label: 'Import from Google Sheets',
        category: 'Data',
        icon: <FileSpreadsheet size={16} />,
        action: () => setDataConnectorState({ isOpen: true, initialType: 'google-sheets' })
      });
      cmds.push({
        id: 'connect-data-analytics',
        label: 'Import from Google Analytics',
        category: 'Data',
        icon: <BarChart2 size={16} />,
        action: () => setDataConnectorState({ isOpen: true, initialType: 'google-analytics' })
      });
      cmds.push({
        id: 'connect-data-csv',
        label: 'Import from CSV URL',
        category: 'Data',
        icon: <Globe size={16} />,
        action: () => setDataConnectorState({ isOpen: true, initialType: 'csv-url' })
      });
      cmds.push({
          id: 'import-file',
          label: 'Import File (CSV/Excel)',
          category: 'Canvas',
          icon: <Upload size={16} />,
          action: () => fileInputRef.current?.click()
      });
      cmds.push({
          id: 'toggle-theme',
          label: `Switch to ${darkMode ? 'Light' : 'Dark'} Mode`,
          category: 'Canvas',
          icon: darkMode ? <Sun size={16} /> : <Moon size={16} />,
          action: () => setDarkMode(!darkMode)
      });
      cmds.push({
          id: 'toggle-mouse-mode',
          label: toolMode === ToolMode.SELECT ? 'Switch to Pan Mode (Space)' : 'Switch to Select Mode (V)',
          category: 'Canvas',
          icon: toolMode === ToolMode.SELECT ? <Hand size={16} /> : <MousePointer2 size={16} />,
          shortcut: toolMode === ToolMode.SELECT ? ['Space'] : ['V'],
          action: () => setToolMode(toolMode === ToolMode.SELECT ? ToolMode.PAN : ToolMode.SELECT)
      });

      if (history.length > 0) {
        cmds.push({
            id: 'undo',
            label: 'Undo',
            shortcut: ['Ctrl', 'Z'],
            category: 'Canvas',
            icon: <Undo2 size={16} />,
            action: undo
        });
      }
      if (future.length > 0) {
        cmds.push({
            id: 'redo',
            label: 'Redo',
            shortcut: ['Ctrl', 'Shift', 'Z'],
            category: 'Canvas',
            icon: <Redo2 size={16} />,
            action: redo
        });
      }

      return cmds;
  }, [sheets, charts, notes, transform, darkMode, history.length, future.length, undo, redo, selectedIds, flyTo, toolMode, defaultChartColor, customColors]);

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

        <CommandBar 
            isOpen={isCommandBarOpen} 
            onClose={() => setIsCommandBarOpen(false)} 
            commands={isCommandBarOpen ? getCommands() : []}
        />
        
        {dataConnectorState.isOpen && (
            <DataConnectorDialog 
                onClose={() => setDataConnectorState({ isOpen: false })}
                onImport={handleDataConnectImport}
                initialType={dataConnectorState.initialType}
            />
        )}

        <Canvas 
            transform={transform} 
            setTransform={setTransform} 
            darkMode={darkMode} 
            toolMode={toolMode}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseDown={handleCanvasMouseDown}
        >
          {sheets.map(sheet => {
            // Find source sheet for pivots or sparklines
            let sourceSheet: SheetData | undefined;
            if (sheet.pivotConfig) sourceSheet = sheets.find(s => s.id === sheet.pivotConfig?.sourceSheetId);
            else if (sheet.sparklineConfig) sourceSheet = sheets.find(s => s.id === sheet.sparklineConfig?.sourceSheetId);

            return (
                <SheetNode
                  key={sheet.id}
                  data={sheet}
                  sourceSheet={sourceSheet}
                  selected={selectedIds.has(sheet.id)}
                  scale={transform.scale}
                  onUpdate={updateSheet}
                  onDelete={deleteSheet}
                  onMouseDown={(e) => handleItemMouseDown(e, sheet.id, 'sheet')}
                  onSelect={() => { if (!selectedIds.has(sheet.id)) setSelectedIds(new Set([sheet.id])); }}
                  onAddChart={handleInitChart}
                  onAddPivot={handleInitPivot}
                  onAddSparkline={handleInitSparkline}
                  onToast={showToast}
                  onHistorySave={saveSnapshot}
                  isPendingDelete={selectedIds.has(sheet.id) && deleteConfirmPending}
                  onSelectionContextChange={(ctx) => activeSelectionRef.current = ctx}
                />
            );
          })}
          {charts.map(chart => (
              <ChartNode 
                  key={chart.id}
                  data={chart}
                  sourceSheet={sheets.find(s => s.id === chart.sourceSheetId)}
                  scale={transform.scale}
                  selected={selectedIds.has(chart.id)}
                  onUpdate={updateChart}
                  onDelete={deleteChart}
                  onMouseDown={(e) => handleItemMouseDown(e, chart.id, 'chart')}
                  darkMode={darkMode}
                  onHistorySave={saveSnapshot}
                  isPendingDelete={selectedIds.has(chart.id) && deleteConfirmPending}
                  palette={chartPalette}
                  onAddCustomColor={handleAddColor}
              />
          ))}
          {notes.map(note => (
              <NoteNode
                  key={note.id}
                  data={note}
                  scale={transform.scale}
                  selected={selectedIds.has(note.id)}
                  onUpdate={updateNote}
                  onDelete={deleteNote}
                  onMouseDown={(e) => handleItemMouseDown(e, note.id, 'note')}
                  darkMode={darkMode}
                  initialEditing={note.id === editingNoteId}
                  onHistorySave={saveSnapshot}
                  isPendingDelete={selectedIds.has(note.id) && deleteConfirmPending}
              />
          ))}
        </Canvas>
        
        <Toolbar 
            onAddTable={addTable}
            onAddNote={addNote}
            onImport={() => fileInputRef.current?.click()}
            onConnectData={() => setDataConnectorState({ isOpen: true })}
            darkMode={darkMode}
            toggleDarkMode={() => setDarkMode(!darkMode)}
            saveStatus={saveStatus}
            onUndo={undo}
            onRedo={redo}
            canUndo={history.length > 0}
            canRedo={future.length > 0}
            toolMode={toolMode}
            setToolMode={setToolMode}
            onOpenCommandBar={() => setIsCommandBarOpen(true)}
            hidden={isCommandBarOpen}
        />
      </div>
    </div>
  );
};

export default App;
