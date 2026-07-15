
import { useMemo } from 'react';
import { 
  Grid3X3, StickyNote, Upload, Database, Sun, Moon, Undo2, Redo2, Maximize2,
  Trash2, Image as ImageIcon, ArrowLeft, ArrowRight, Eraser, ArrowDownAZ,
  ArrowUpAZ, Filter, AlignLeft, Palette, BarChart3, LineChart, PieChart, AreaChart, Table, TrendingUp,
  Minimize2, DollarSign, Percent, Calendar, Type, ScatterChart, LayoutGrid, Plug
} from 'lucide-react';
import { useStore } from '../store';
import { Command, SelectionContext, CellData, CellFormat, ChartType, SheetData, ChartData, NoteData } from '../types';
import { parseCellId, getCellId } from '../utils/formulas';
import { CELL_WIDTH, CELL_HEIGHT, HEADER_COL_WIDTH, HEADER_ROW_HEIGHT } from '../constants';

interface UseCommandServiceProps {
  darkMode: boolean;
  setDarkMode: (val: boolean) => void;
  activeSelection: SelectionContext;
  onAddTable: () => void;
  onAddNote: () => void;
  onImport: () => void;
  onConnectData: () => void;
  onConnectAgent: () => void;
  onCopyImage: () => void;
  onInitChart: (sheetId: string, colIndex?: number, selectedCols?: number[], initialType?: ChartType) => void;
  onInitPivot: (sheetId: string, colIndex?: number) => void;
  onInitSparkline: (sheetId: string) => void;
}

export const useCommandService = ({
  darkMode,
  setDarkMode,
  activeSelection,
  onAddTable,
  onAddNote,
  onImport,
  onConnectData,
  onConnectAgent,
  onCopyImage,
  onInitChart,
  onInitPivot,
  onInitSparkline
}: UseCommandServiceProps): Command[] => {
  
  // Store selectors
  const selectedIds = useStore(state => state.selectedIds);
  const deleteSelected = useStore(state => state.deleteSelected);
  const undo = useStore(state => state.undo);
  const redo = useStore(state => state.redo);
  const setTransform = useStore(state => state.setTransform);
  const sheets = useStore(state => state.sheets);
  const charts = useStore(state => state.charts);
  const notes = useStore(state => state.notes);
  const updateSheet = useStore(state => state.updateSheet);
  const saveSnapshot = useStore(state => state.saveSnapshot);

  return useMemo<Command[]>(() => {
    // 1. Base System Commands
    const baseCommands: Command[] = [
      {
        id: 'add-table',
        label: 'Add Table',
        category: 'Canvas',
        icon: <Grid3X3 size={18} />,
        action: onAddTable,
        shortcut: ['T']
      },
      {
        id: 'add-note',
        label: 'Add Note',
        category: 'Canvas',
        icon: <StickyNote size={18} />,
        action: onAddNote,
        shortcut: ['N']
      },
      {
        id: 'import',
        label: 'Import File',
        subLabel: 'CSV, Excel',
        category: 'Data',
        icon: <Upload size={18} />,
        action: onImport,
        shortcut: ['Ctrl', 'I']
      },
      {
        id: 'connect-data',
        label: 'Connect External Data',
        subLabel: 'Google Sheets, Analytics',
        category: 'Data',
        icon: <Database size={18} />,
        action: onConnectData
      },
      {
        id: 'connect-agent',
        label: 'Connect Claude or Codex',
        subLabel: 'Create durable analytics artifacts with MCP',
        category: 'Agent',
        icon: <Plug size={18} />,
        action: onConnectAgent,
        keywords: ['mcp', 'agent', 'claude', 'codex', 'copilot']
      },
      {
        id: 'theme',
        label: `Switch to ${darkMode ? 'Light' : 'Dark'} Mode`,
        category: 'Canvas',
        icon: darkMode ? <Sun size={18} /> : <Moon size={18} />,
        action: () => setDarkMode(!darkMode),
        shortcut: ['Ctrl', 'D']
      },
      {
        id: 'undo',
        label: 'Undo',
        category: 'Navigation',
        icon: <Undo2 size={18} />,
        action: undo,
        shortcut: ['Ctrl', 'Z']
      },
      {
        id: 'redo',
        label: 'Redo',
        category: 'Navigation',
        icon: <Redo2 size={18} />,
        action: redo,
        shortcut: ['Ctrl', 'Shift', 'Z']
      },
      {
        id: 'reset-view',
        label: 'Reset View',
        category: 'Navigation',
        icon: <Maximize2 size={18} />,
        action: () => setTransform({ scale: 1, offset: { x: 0, y: 0 } }),
        keywords: ['zoom', 'pan', 'center']
      }
    ];

    // 2. Navigation Commands (Search & Jump)
    const centerOnItem = (id: string, x: number, y: number, w: number, h: number) => {
        const state = useStore.getState();
        const currentScale = state.transform.scale;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;

        const newOffsetX = (viewportW / 2) - ((x + w/2) * currentScale);
        const newOffsetY = (viewportH / 2) - ((y + h/2) * currentScale);

        state.setTransform({ scale: currentScale, offset: { x: newOffsetX, y: newOffsetY } });
        state.select([id]);
    };

    const navCommands: Command[] = [];

    // Map Sheets
    Object.values(sheets).forEach((s: SheetData) => {
        const w = (s.size.width * CELL_WIDTH) + HEADER_COL_WIDTH;
        const h = (s.size.height * CELL_HEIGHT) + HEADER_ROW_HEIGHT;
        navCommands.push({
            id: `goto-sheet-${s.id}`,
            label: s.title,
            subLabel: 'Sheet',
            category: 'Go to',
            icon: <Grid3X3 size={18} />,
            action: () => centerOnItem(s.id, s.position.x, s.position.y, w, h)
        });
    });

    // Map Charts
    Object.values(charts).forEach((c: ChartData) => {
        navCommands.push({
            id: `goto-chart-${c.id}`,
            label: c.title,
            subLabel: 'Chart',
            category: 'Go to',
            icon: <BarChart3 size={18} />,
            action: () => centerOnItem(c.id, c.position.x, c.position.y, c.size.width, c.size.height)
        });
    });

    // Map Notes
    Object.values(notes).forEach((n: NoteData) => {
        const text = n.content.replace(/<[^>]*>/g, ' ').trim();
        const label = text.length > 0 ? (text.length > 40 ? text.substring(0, 40) + '...' : text) : 'Untitled Note';
        navCommands.push({
            id: `goto-note-${n.id}`,
            label: label,
            subLabel: 'Note',
            category: 'Go to',
            icon: <StickyNote size={18} />,
            action: () => centerOnItem(n.id, n.position.x, n.position.y, n.size.width, n.size.height)
        });
    });

    // 3. Selection Context Commands
    if (selectedIds.size > 0) {
      baseCommands.unshift({
        id: 'delete',
        label: 'Delete Selected',
        category: 'Canvas',
        icon: <Trash2 size={18} />,
        action: deleteSelected,
        shortcut: ['Del']
      });

      baseCommands.push({
        id: 'copy-image',
        label: 'Copy Selection as Image',
        category: 'Canvas',
        icon: <ImageIcon size={18} />,
        action: onCopyImage,
        keywords: ['export', 'png', 'clipboard']
      });
    }

    // Add Column Context Commands if a sheet cell is selected
    if (activeSelection.sheetId && activeSelection.cellId) {
      const sheet = sheets[activeSelection.sheetId];

      if (sheet) {
        const isPivot = !!sheet.pivotConfig;
        const isSparkline = !!sheet.sparklineConfig;
        const isComputed = isPivot || isSparkline || !!sheet.connectorConfig;

        // Helpers for Column Ops (Internal to hook logic)
        const getTargetCols = () => {
          if (!activeSelection.range) {
            const pos = parseCellId(activeSelection.cellId || '');
            return pos ? [pos.col] : [];
          }
          const start = Math.min(activeSelection.range.start.col, activeSelection.range.end.col);
          const end = Math.max(activeSelection.range.start.col, activeSelection.range.end.col);
          const cols = [];
          for (let i = start; i <= end; i++) cols.push(i);
          return cols;
        };

        const applyFormat = (formatUpdate: Partial<CellFormat>) => {
          saveSnapshot();
          const cols = getTargetCols();
          const newCells = { ...sheet.cells };
          let hasChanges = false;

          Object.keys(newCells).forEach(key => {
            const pos = parseCellId(key);
            if (pos && cols.includes(pos.col)) {
              const cell = newCells[key];
              const currentFormat = cell.format || { type: 'text' };
              // Clear conflicting props if type changes
              let newFormat: CellFormat = { ...currentFormat, ...formatUpdate };
              if (formatUpdate.type === 'text') {
                delete (newFormat as any).decimals;
                delete (newFormat as any).symbol;
                delete (newFormat as any).dateFormat;
                delete (newFormat as any).d3Format;
              }

              if (JSON.stringify(cell.format) !== JSON.stringify(newFormat)) {
                newCells[key] = { ...cell, format: newFormat };
                hasChanges = true;
              }
            }
          });

          if (hasChanges) {
            updateSheet(sheet.id, { cells: newCells });
          }
        };

        if (!isComputed) {
          // Edit Commands (Insert, Delete, Clear) - Only for editable sheets
          baseCommands.push(
            {
              id: 'col-insert-left',
              label: 'Insert Column Left',
              category: 'Cell',
              icon: <ArrowLeft size={18} />,
              action: () => {
                saveSnapshot();
                const colIndex = parseCellId(activeSelection.cellId || '')?.col || 0;
                const newCells: Record<string, CellData> = {};
                const newColWidths: Record<string, number> = {};

                Object.keys(sheet.cells).forEach(key => {
                  const pos = parseCellId(key);
                  if (!pos) return;
                  if (pos.col >= colIndex) {
                    newCells[getCellId(pos.col + 1, pos.row)] = sheet.cells[key];
                  } else {
                    newCells[key] = sheet.cells[key];
                  }
                });
                if (sheet.colWidths) {
                  Object.keys(sheet.colWidths).forEach(k => {
                    const cIdx = parseInt(k, 10);
                    if (cIdx >= colIndex) newColWidths[String(cIdx + 1)] = sheet.colWidths[k];
                    else newColWidths[k] = sheet.colWidths[k];
                  });
                  newColWidths[String(colIndex)] = CELL_WIDTH;
                }
                updateSheet(sheet.id, { size: { ...sheet.size, width: sheet.size.width + 1 }, cells: newCells, colWidths: newColWidths });
              }
            },
            {
              id: 'col-insert-right',
              label: 'Insert Column Right',
              category: 'Cell',
              icon: <ArrowRight size={18} />,
              action: () => {
                saveSnapshot();
                const colIndex = (parseCellId(activeSelection.cellId || '')?.col || 0) + 1;
                const newCells: Record<string, CellData> = {};
                const newColWidths: Record<string, number> = {};

                Object.keys(sheet.cells).forEach(key => {
                  const pos = parseCellId(key);
                  if (!pos) return;
                  if (pos.col >= colIndex) {
                    newCells[getCellId(pos.col + 1, pos.row)] = sheet.cells[key];
                  } else {
                    newCells[key] = sheet.cells[key];
                  }
                });
                if (sheet.colWidths) {
                  Object.keys(sheet.colWidths).forEach(k => {
                    const cIdx = parseInt(k, 10);
                    if (cIdx >= colIndex) newColWidths[String(cIdx + 1)] = sheet.colWidths[k];
                    else newColWidths[k] = sheet.colWidths[k];
                  });
                  newColWidths[String(colIndex)] = CELL_WIDTH;
                }
                updateSheet(sheet.id, { size: { ...sheet.size, width: sheet.size.width + 1 }, cells: newCells, colWidths: newColWidths });
              }
            },
            {
              id: 'col-delete',
              label: 'Delete Column',
              category: 'Cell',
              icon: <Trash2 size={18} />,
              action: () => {
                saveSnapshot();
                const cols = getTargetCols();
                const colIndex = cols[0];
                const newCells: Record<string, CellData> = {};
                const newColWidths: Record<string, number> = {};

                Object.keys(sheet.cells).forEach(key => {
                  const pos = parseCellId(key);
                  if (!pos) return;
                  if (pos.col > colIndex) {
                    newCells[getCellId(pos.col - 1, pos.row)] = sheet.cells[key];
                  } else if (pos.col < colIndex) {
                    newCells[key] = sheet.cells[key];
                  }
                });
                if (sheet.colWidths) {
                  Object.keys(sheet.colWidths).forEach(k => {
                    const cIdx = parseInt(k, 10);
                    if (cIdx > colIndex) newColWidths[String(cIdx - 1)] = sheet.colWidths[k];
                    else if (cIdx < colIndex) newColWidths[k] = sheet.colWidths[k];
                  });
                }
                updateSheet(sheet.id, {
                  size: { ...sheet.size, width: Math.max(1, sheet.size.width - 1) },
                  cells: newCells,
                  colWidths: newColWidths
                });
              }
            },
            {
              id: 'col-clear',
              label: 'Clear Column Data',
              category: 'Cell',
              icon: <Eraser size={18} />,
              action: () => {
                saveSnapshot();
                const cols = getTargetCols();
                const newCells = { ...sheet.cells };
                Object.keys(newCells).forEach(key => {
                  const pos = parseCellId(key);
                  if (pos && cols.includes(pos.col) && pos.row > 0) {
                    delete newCells[key];
                  }
                });
                updateSheet(sheet.id, { cells: newCells });
              }
            }
          );
        }

        // Sort & Filter
        baseCommands.push(
          {
            id: 'col-sort-asc',
            label: 'Sort A to Z',
            category: 'Cell',
            icon: <ArrowDownAZ size={18} />,
            action: () => {
              saveSnapshot();
              const colId = getCellId(parseCellId(activeSelection.cellId || '')?.col || 0, -1).replace(/[0-9]/g, '');
              updateSheet(sheet.id, { sort: { columnId: colId, direction: 'asc' } });
            }
          },
          {
            id: 'col-sort-desc',
            label: 'Sort Z to A',
            category: 'Cell',
            icon: <ArrowUpAZ size={18} />,
            action: () => {
              saveSnapshot();
              const colId = getCellId(parseCellId(activeSelection.cellId || '')?.col || 0, -1).replace(/[0-9]/g, '');
              updateSheet(sheet.id, { sort: { columnId: colId, direction: 'desc' } });
            }
          },
          {
            id: 'col-filter',
            label: 'Filter Column',
            category: 'Cell',
            icon: <Filter size={18} />,
            action: () => {
              updateSheet(sheet.id, { showFilterPanel: true });
            }
          }
        );

        // Visuals
        baseCommands.push(
          {
            id: 'vis-bar',
            label: 'Visual: Bar',
            category: 'Cell',
            icon: <AlignLeft size={18} />,
            action: () => applyFormat({ visual: 'bar' })
          },
          {
            id: 'vis-heat-green',
            label: 'Visual: Heatmap (Green)',
            category: 'Cell',
            icon: <Palette size={18} />,
            action: () => applyFormat({ visual: 'heatmap', heatmapColor: 'green' })
          },
          {
            id: 'vis-heat-red',
            label: 'Visual: Heatmap (Red)',
            category: 'Cell',
            icon: <Palette size={18} />,
            action: () => applyFormat({ visual: 'heatmap', heatmapColor: 'red' })
          },
          {
            id: 'vis-heat-yellow',
            label: 'Visual: Heatmap (Yellow)',
            category: 'Cell',
            icon: <Palette size={18} />,
            action: () => applyFormat({ visual: 'heatmap', heatmapColor: 'yellow' })
          },
          {
            id: 'vis-heat-diverging',
            label: 'Visual: Heatmap (Diverging red/green)',
            category: 'Cell',
            icon: <Palette size={18} />,
            action: () => applyFormat({ visual: 'heatmap', heatmapColor: 'diverging', heatmapFlip: false }),
            keywords: ['positive', 'negative', 'diverging', 'sign']
          },
          {
            id: 'vis-heat-diverging-flip',
            label: 'Visual: Heatmap (Diverging flipped green/red)',
            category: 'Cell',
            icon: <Palette size={18} />,
            action: () => applyFormat({ visual: 'heatmap', heatmapColor: 'diverging', heatmapFlip: true }),
            keywords: ['positive', 'negative', 'diverging', 'sign', 'flip', 'invert']
          },
          {
            id: 'create-chart-bar',
            label: 'Create Bar Chart',
            category: 'Chart',
            icon: <BarChart3 size={18} />,
            action: () => onInitChart(sheet.id, parseCellId(activeSelection.cellId || '')?.col, getTargetCols(), 'bar'),
            keywords: ['graph', 'bar']
          },
          {
            id: 'create-chart-line',
            label: 'Create Line Chart',
            category: 'Chart',
            icon: <LineChart size={18} />,
            action: () => onInitChart(sheet.id, parseCellId(activeSelection.cellId || '')?.col, getTargetCols(), 'line'),
            keywords: ['graph', 'line', 'trend']
          },
          {
            id: 'create-chart-area',
            label: 'Create Area Chart',
            category: 'Chart',
            icon: <AreaChart size={18} />,
            action: () => onInitChart(sheet.id, parseCellId(activeSelection.cellId || '')?.col, getTargetCols(), 'area'),
            keywords: ['graph', 'area', 'stack']
          },
          {
            id: 'create-chart-pie',
            label: 'Create Pie Chart',
            category: 'Chart',
            icon: <PieChart size={18} />,
            action: () => onInitChart(sheet.id, parseCellId(activeSelection.cellId || '')?.col, getTargetCols(), 'pie'),
            keywords: ['graph', 'pie', 'circle']
          },
          {
            id: 'create-chart-scatter',
            label: 'Create Scatter Chart',
            category: 'Chart',
            icon: <ScatterChart size={18} />,
            action: () => onInitChart(sheet.id, parseCellId(activeSelection.cellId || '')?.col, getTargetCols(), 'scatter'),
            keywords: ['graph', 'scatter', 'dot', 'xy']
          },
          {
            id: 'create-chart-treemap',
            label: 'Create Treemap Chart',
            category: 'Chart',
            icon: <LayoutGrid size={18} />,
            action: () => onInitChart(sheet.id, parseCellId(activeSelection.cellId || '')?.col, getTargetCols(), 'treemap'),
            keywords: ['graph', 'treemap', 'hierarchy']
          }
        );

        if (!isPivot && !isSparkline) {
          baseCommands.push(
            {
              id: 'create-pivot',
              label: 'Create Pivot Table',
              category: 'Data',
              icon: <Table size={18} />,
              action: () => onInitPivot(sheet.id, parseCellId(activeSelection.cellId || '')?.col)
            },
            {
              id: 'create-spark',
              label: 'Create Sparklines',
              category: 'Data',
              icon: <TrendingUp size={18} />,
              action: () => onInitSparkline(sheet.id)
            }
          );
        }

        // Formatting
        baseCommands.push(
          {
            id: 'fmt-num-compact',
            label: 'Format: Number (Compact)',
            subLabel: 'e.g. 1.2k',
            category: 'Cell',
            icon: <Minimize2 size={18} />,
            action: () => applyFormat({ type: 'number', d3Format: '.2s' })
          },
          {
            id: 'fmt-num-full',
            label: 'Format: Number (Full)',
            subLabel: 'e.g. 1,200',
            category: 'Cell',
            icon: <Maximize2 size={18} />,
            action: () => applyFormat({ type: 'number', d3Format: '' })
          },
          {
            id: 'fmt-cur-compact',
            label: 'Format: Currency (Compact)',
            subLabel: 'e.g. $1.2k',
            category: 'Cell',
            icon: <DollarSign size={18} />,
            action: () => applyFormat({ type: 'currency', d3Format: '$.2s' })
          },
          {
            id: 'fmt-cur-full',
            label: 'Format: Currency (Full)',
            subLabel: 'e.g. $1,200.00',
            category: 'Cell',
            icon: <DollarSign size={18} />,
            action: () => applyFormat({ type: 'currency', d3Format: '' })
          },
          {
            id: 'fmt-percent',
            label: 'Format: Percent',
            category: 'Cell',
            icon: <Percent size={18} />,
            action: () => applyFormat({ type: 'percent', d3Format: '.1%' })
          },
          {
            id: 'fmt-date-iso',
            label: 'Format: Date (YYYY-MM-DD)',
            category: 'Cell',
            icon: <Calendar size={18} />,
            action: () => applyFormat({ type: 'date', dateFormat: 'YYYY-MM-DD' })
          },
          {
            id: 'fmt-date-us',
            label: 'Format: Date (MM/DD/YYYY)',
            category: 'Cell',
            icon: <Calendar size={18} />,
            action: () => applyFormat({ type: 'date', dateFormat: 'MM/DD/YYYY' })
          },
          {
            id: 'fmt-date-uk',
            label: 'Format: Date (DD/MM/YYYY)',
            category: 'Cell',
            icon: <Calendar size={18} />,
            action: () => applyFormat({ type: 'date', dateFormat: 'DD/MM/YYYY' })
          },
          {
            id: 'fmt-date-full',
            label: 'Format: Date (Full)',
            category: 'Cell',
            icon: <Calendar size={18} />,
            action: () => applyFormat({ type: 'date', dateFormat: 'Full' })
          },
          {
            id: 'fmt-text',
            label: 'Format: Text',
            category: 'Cell',
            icon: <Type size={18} />,
            action: () => applyFormat({ type: 'text' })
          }
        );
      }
    }

    // Return combined list: Base Commands + Dynamic Navigation Commands
    return [...baseCommands, ...navCommands];
  }, [
    darkMode, setDarkMode, selectedIds.size, activeSelection,
    onAddTable, onAddNote, onImport, onConnectData, onConnectAgent, onCopyImage,
    onInitChart, onInitPivot, onInitSparkline,
    deleteSelected, undo, redo, setTransform, 
    sheets, charts, notes, // Dependencies for search update
    updateSheet, saveSnapshot
  ]);
};
