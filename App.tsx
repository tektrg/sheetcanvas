import React, { useState, useCallback, useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { SheetNode } from './components/SheetNode';
import { ChartNode } from './components/ChartNode';
import { Toolbar } from './components/Toolbar';
import { SheetData, ChartData, CanvasTransform, Position, CellData } from './types';
import { INITIAL_COLS, INITIAL_ROWS, CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT, DEFAULT_CHART_SIZE, CHART_COLORS } from './constants';
import { parseClipboardData } from './utils/clipboard';
import { getCellId, computeSheet } from './utils/formulas';
import { saveAppState, loadAppState } from './utils/persistence';

const generateId = () => Math.random().toString(36).substr(2, 9);

const App: React.FC = () => {
  const [darkMode, setDarkMode] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error' | 'idle'>('idle');

  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 1,
    offset: { x: 0, y: 0 },
  });

  const [sheets, setSheets] = useState<SheetData[]>(() => {
    // Default initial state, will be overwritten if DB has data
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
  
  const [selectedId, setSelectedId] = useState<string | null>(null); // ID of sheet or chart
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [draggingType, setDraggingType] = useState<'sheet' | 'chart' | null>(null);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });

  // Load state on mount
  useEffect(() => {
    const init = async () => {
      const loaded = await loadAppState();
      if (loaded.sheets.length > 0 || loaded.charts.length > 0) {
        setSheets(loaded.sheets);
        setCharts(loaded.charts);
        if (loaded.transform) {
          setTransform(loaded.transform);
        }
      }
      setIsReady(true);
      setSaveStatus('saved');
    };
    init();
  }, []);

  // Auto-save effect
  useEffect(() => {
    if (!isReady) return;

    setSaveStatus('saving');
    const timer = setTimeout(async () => {
      try {
        await saveAppState(sheets, charts, transform);
        setSaveStatus('saved');
      } catch (e) {
        console.error(e);
        setSaveStatus('error');
      }
    }, 1000); // Debounce 1s

    return () => clearTimeout(timer);
  }, [sheets, charts, transform, isReady]);

  const addTable = () => {
    const centerX = (-transform.offset.x + (window.innerWidth / 2)) / transform.scale;
    const centerY = (-transform.offset.y + (window.innerHeight / 2)) / transform.scale;

    const newSheet: SheetData = {
      id: generateId(),
      title: `Sheet ${sheets.length + 1}`,
      position: { x: centerX - 100, y: centerY - 100 },
      size: { width: INITIAL_COLS, height: INITIAL_ROWS },
      cells: {}
    };
    // Compute even empty sheet to set defaults if any
    setSheets(prev => [...prev, computeSheet(newSheet)]);
  };

  const handleAddChart = (sheetId: string) => {
      const sheet = sheets.find(s => s.id === sheetId);
      if (!sheet) return;

      // Smart default: Try to find a label column (string) and value column (number)
      // Default to A and B
      const newChart: ChartData = {
          id: generateId(),
          sourceSheetId: sheetId,
          position: { x: sheet.position.x + (sheet.size.width * CELL_WIDTH) + 50, y: sheet.position.y },
          size: DEFAULT_CHART_SIZE,
          title: `${sheet.title} Chart`,
          config: {
              type: 'bar',
              labelColumn: 'A',
              dataColumns: ['B'],
              color: CHART_COLORS[0],
              highlightIndex: -1,
              animation: true
          }
      };
      setCharts(prev => [...prev, newChart]);
  };

  const updateSheet = (id: string, newData: SheetData) => {
    setSheets(prev => prev.map(s => s.id === id ? newData : s));
  };
  
  const updateChart = (id: string, newData: ChartData) => {
    setCharts(prev => prev.map(c => c.id === id ? newData : c));
  };

  const deleteSheet = (id: string) => {
    setSheets(prev => prev.filter(s => s.id !== id));
    setCharts(prev => prev.filter(c => c.sourceSheetId !== id));
  };

  const deleteChart = (id: string) => {
      setCharts(prev => prev.filter(c => c.id !== id));
  };

  // Unified Dragging Logic
  const handleMouseDown = (e: React.MouseEvent, id: string, type: 'sheet' | 'chart') => {
    e.stopPropagation();
    
    setSelectedId(id);
    setDraggingId(id);
    setDraggingType(type);
    
    setDragOffset({
      x: e.clientX,
      y: e.clientY
    });
  };

  const handleGlobalMouseMove = useCallback((e: MouseEvent) => {
    if (draggingId && draggingType) {
      const dx = (e.clientX - dragOffset.x) / transform.scale;
      const dy = (e.clientY - dragOffset.y) / transform.scale;

      if (draggingType === 'sheet') {
          setSheets(prev => prev.map(s => {
            if (s.id === draggingId) {
              return { ...s, position: { x: s.position.x + dx, y: s.position.y + dy } };
            }
            return s;
          }));
      } else if (draggingType === 'chart') {
          setCharts(prev => prev.map(c => {
              if (c.id === draggingId) {
                  return { ...c, position: { x: c.position.x + dx, y: c.position.y + dy } };
              }
              return c;
          }));
      }

      setDragOffset({ x: e.clientX, y: e.clientY });
    }
  }, [draggingId, draggingType, dragOffset, transform.scale]);

  const handleGlobalMouseUp = useCallback(() => {
    setDraggingId(null);
    setDraggingType(null);
  }, []);

  useEffect(() => {
    if (draggingId) {
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
  }, [draggingId, handleGlobalMouseMove, handleGlobalMouseUp]);

  // Global Paste Listener
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        
        const text = e.clipboardData?.getData('text');
        if (!text) return;

        const matrix = parseClipboardData(text);
        if (!matrix || matrix.length === 0) return;

        e.preventDefault();

        const rows = matrix.length;
        const cols = matrix.reduce((max, row) => Math.max(max, row.length), 0);

        const centerX = (-transform.offset.x + (window.innerWidth / 2)) / transform.scale;
        const centerY = (-transform.offset.y + (window.innerHeight / 2)) / transform.scale;

        const PADDING = 100;
        const availableWidth = (window.innerWidth / transform.scale) - PADDING;
        const availableHeight = (window.innerHeight / transform.scale) - PADDING;
        
        const maxFitCols = Math.max(1, Math.floor((availableWidth - HEADER_COL_WIDTH) / CELL_WIDTH));
        const maxFitRows = Math.max(1, Math.floor((availableHeight - HEADER_ROW_HEIGHT) / CELL_HEIGHT));
        
        const finalCols = Math.min(Math.max(cols, INITIAL_COLS), maxFitCols);
        const finalRows = Math.min(Math.max(rows, INITIAL_ROWS), maxFitRows);

        const tableWidth = (finalCols * CELL_WIDTH) + HEADER_COL_WIDTH;
        const tableHeight = (finalRows * CELL_HEIGHT) + HEADER_ROW_HEIGHT;

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
            position: { 
                x: centerX - (tableWidth / 2), 
                y: centerY - (tableHeight / 2) 
            },
            size: { 
                width: finalCols, 
                height: finalRows 
            },
            cells
        };

        setSheets(prev => [...prev, computeSheet(newSheet)]);
        setSelectedId(newSheet.id);
    };

    window.addEventListener('paste', handleGlobalPaste);
    return () => window.removeEventListener('paste', handleGlobalPaste);
  }, [sheets.length, transform]);

  return (
    <div className={`w-full h-screen overflow-hidden font-sans transition-colors duration-300 ${darkMode ? 'dark' : ''}`}>
      <div className="w-full h-full bg-neutral-100 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100">
        <Canvas transform={transform} setTransform={setTransform} darkMode={darkMode}>
          {sheets.map(sheet => (
            <SheetNode
              key={sheet.id}
              data={sheet}
              selected={selectedId === sheet.id}
              scale={transform.scale}
              onUpdate={updateSheet}
              onDelete={deleteSheet}
              onMouseDown={(e) => handleMouseDown(e, sheet.id, 'sheet')}
              onAddChart={handleAddChart}
            />
          ))}
          {charts.map(chart => (
              <ChartNode 
                  key={chart.id}
                  data={chart}
                  sourceSheet={sheets.find(s => s.id === chart.sourceSheetId)}
                  scale={transform.scale}
                  onUpdate={updateChart}
                  onDelete={deleteChart}
                  onMouseDown={(e) => handleMouseDown(e, chart.id, 'chart')}
                  darkMode={darkMode}
              />
          ))}
        </Canvas>
        
        <Toolbar 
            onAddTable={addTable}
            darkMode={darkMode}
            toggleDarkMode={() => setDarkMode(!darkMode)}
            saveStatus={saveStatus}
        />
      </div>
    </div>
  );
};

export default App;