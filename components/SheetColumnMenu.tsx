
import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { 
  AlignLeft, ArrowDownAZ, ArrowUpAZ, Filter, 
  BarChart3, Table, TrendingUp, Hash, Minimize2, Maximize2, 
  DollarSign, Percent, Calendar, ChevronRight, Type, Code, 
  ArrowLeft, ArrowRight, Trash2, Eraser
} from 'lucide-react';
import { CellFormat } from '../types';
import { HeatmapMenuRow } from './HeatmapMenuRow';

interface SheetColumnMenuProps {
  colIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string, param?: any) => void;
  currentFormat?: CellFormat;
  isReadOnly: boolean;
}

export const SheetColumnMenu: React.FC<SheetColumnMenuProps> = ({
  colIndex,
  isOpen,
  onClose,
  onAction,
  currentFormat,
  isReadOnly
}) => {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [menuPosition, setMenuPosition] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updateMenuPosition = () => {
      const anchor = anchorRef.current?.parentElement;
      if (!anchor) return;

      const rect = anchor.getBoundingClientRect();
      const menuWidth = 192;
      const viewportPadding = 8;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - menuWidth - viewportPadding);
      const left = Math.min(
        Math.max(rect.left, viewportPadding),
        maxLeft
      );
      const top = Math.min(rect.bottom + 4, window.innerHeight - viewportPadding);

      setMenuPosition({
        position: 'fixed',
        top,
        left,
        width: menuWidth,
        zIndex: 1000,
      });
    };

    updateMenuPosition();
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [isOpen, colIndex]);

  if (!isOpen) return null;

  const menu = (
    <>
    <div className="fixed inset-0 z-[999]" onMouseDown={onClose} />
    <div
        className="bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 py-1 flex flex-col"
        style={menuPosition ?? { position: 'fixed', top: 0, left: 0, width: 192, zIndex: 1000 }}
        onMouseDown={(e) => e.stopPropagation()}
    >
        {/* Insert Logic */}
        {!isReadOnly && (
        <>
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                <button onClick={() => onAction('insert-right')} className="flex-1 text-left">
                    Insert
                </button>
                <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                    <button onClick={(e) => { e.stopPropagation(); onAction('insert-left'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Left">
                        <ArrowLeft size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onAction('insert-right'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Right">
                        <ArrowRight size={12} />
                    </button>
                </div>
            </div>
            <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
        </>
        )}

        {/* Sort & Filter Group */}
        <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Sort & Filter</div>
        
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
            <button onClick={() => onAction('sort-toggle')} className="flex-1 text-left flex items-center gap-2">
                <ArrowDownAZ size={12} className="text-neutral-400" /> Sort
            </button>
            <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                <button onClick={(e) => { e.stopPropagation(); onAction('sort-asc'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Sort A to Z">
                    <ArrowDownAZ size={12} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onAction('sort-desc'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Sort Z to A">
                    <ArrowUpAZ size={12} />
                </button>
            </div>
        </div>

        <button onClick={() => onAction('filter')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
            <Filter size={12} className="text-neutral-400" /> Filter
        </button>
        
        <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
        
        {/* Column Visuals Group */}
        <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Inline Visuals</div>
        <button onClick={() => onAction('bar')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
            <AlignLeft size={12} className="text-neutral-400" /> Bar
        </button>
        
        {/* Heatmap with Color Selection (single-hue + diverging) */}
        <HeatmapMenuRow heatmapVisual="heatmap" actionName="heatmap" currentFormat={currentFormat} onAction={onAction} />

        <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>

        {/* Sheet Visuals Group */}
        <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Create New Visuals</div>
        <button onClick={() => onAction('chart')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
            <BarChart3 size={12} className="text-neutral-400" /> Chart
        </button>
        <button onClick={() => onAction('pivot')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
            <Table size={12} className="text-neutral-400" /> Pivot
        </button>
        <button onClick={() => onAction('sparkline')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
            <TrendingUp size={12} className="text-neutral-400" /> Sparklines
        </button>

        <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
        
        {/* Format Group */}
        <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium tracking-wider">Format</div>
        
        {/* Number with Compact/Expand Options */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
            <button onClick={() => onAction('number')} className="flex-1 text-left flex items-center gap-2">
                <Hash size={12} className="text-neutral-400" /> Number
            </button>
            <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                <button onClick={(e) => { e.stopPropagation(); onAction('number-compact'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Compact (.2s)">
                    <Minimize2 size={12} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onAction('number-expand'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Expand (Full)">
                    <Maximize2 size={12} />
                </button>
            </div>
        </div>

        {/* Currency with Compact/Expand Options */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
            <button onClick={() => onAction('currency')} className="flex-1 text-left flex items-center gap-2">
                <DollarSign size={12} className="text-neutral-400" /> Currency
            </button>
            <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                <button onClick={(e) => { e.stopPropagation(); onAction('currency-compact'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Compact ($ .2s)">
                    <Minimize2 size={12} />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onAction('currency-expand'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Expand (Full)">
                    <Maximize2 size={12} />
                </button>
            </div>
        </div>

        <button onClick={() => onAction('percent')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
            <Percent size={12} className="text-neutral-400" /> Percent
        </button>
        <div className="relative group/date">
            <button className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                <div className="flex items-center gap-2"><Calendar size={12} className="text-neutral-400" /> Date</div>
                <ChevronRight size={10} />
            </button>
            <div className="absolute left-full top-0 ml-1 w-32 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 hidden group-hover/date:block py-1">
                <button onClick={() => onAction('date', 'YYYY-MM-DD')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">YYYY-MM-DD</button>
                <button onClick={() => onAction('date', 'MM/DD/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">MM/DD/YYYY</button>
                <button onClick={() => onAction('date', 'DD/MM/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">DD/MM/YYYY</button>
                <button onClick={() => onAction('date', 'Full')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">Full Date</button>
            </div>
        </div>
        <button onClick={() => onAction('text')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
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
                    defaultValue={(currentFormat as any)?.d3Format || ''}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); (e.target as HTMLInputElement).focus(); }}
                    onKeyDown={(e) => {
                        e.stopPropagation(); 
                        if (e.key === 'Enter') {
                            onAction('d3-custom', e.currentTarget.value);
                            onClose();
                        }
                    }}
                />
                <div className="text-[10px] text-neutral-400 mt-2">Press Enter to apply</div>
            </div>
        </div>

        {/* Delete Options */}
        {!isReadOnly && (
            <>
                <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
                <button onClick={() => onAction('clear-col')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                    <Eraser size={12} className="text-neutral-400" /> Clear Data
                </button>
                <button onClick={() => onAction('delete-col')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center gap-2">
                    <Trash2 size={12} /> Delete Column
                </button>
            </>
        )}
    </div>
    </>
  );

  return (
    <>
      <span ref={anchorRef} className="hidden" />
      {createPortal(menu, document.body)}
    </>
  );
};
