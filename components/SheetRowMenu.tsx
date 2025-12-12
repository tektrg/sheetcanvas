
import React from 'react';
import { 
  ArrowUp, ArrowDown, AlignVerticalJustifyCenter, Palette, 
  Hash, Minimize2, Maximize2, DollarSign, Percent, 
  Calendar, ChevronRight, Type, Code, Trash2, Eraser
} from 'lucide-react';

interface SheetRowMenuProps {
  rowIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onAction: (action: string, param?: any) => void;
  isHeaderRow: boolean;
  isReadOnly: boolean;
}

export const SheetRowMenu: React.FC<SheetRowMenuProps> = ({
  rowIndex,
  isOpen,
  onClose,
  onAction,
  isHeaderRow,
  isReadOnly
}) => {
  if (!isOpen) return null;

  return (
    <div 
        className="absolute top-0 left-full ml-1 w-40 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 z-50 py-1" 
        onMouseDown={(e) => e.stopPropagation()}
    >
        {isHeaderRow && <div className="px-3 py-2 text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-100 dark:border-neutral-700 mb-1 bg-neutral-50/50 dark:bg-neutral-900/20">Header Row</div>}
        
        {/* Insert Logic */}
        {!isReadOnly && (
        <>
            <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
                <button onClick={() => onAction('insert-below')} className="flex-1 text-left">
                    Insert
                </button>
                <div className="flex items-center gap-1 border-l border-neutral-200 dark:border-neutral-700 pl-2">
                    <button onClick={(e) => { e.stopPropagation(); onAction('insert-above'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Above">
                        <ArrowUp size={12} />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); onAction('insert-below'); }} className="p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-600 rounded" title="Insert Below">
                        <ArrowDown size={12} />
                    </button>
                </div>
            </div>
            <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
        </>
        )}

        <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium">Visualize</div>
        <button onClick={() => onAction('bar-row')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><AlignVerticalJustifyCenter size={12} /> Vertical Bar</button>
        <button onClick={() => onAction('heatmap-row')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><Palette size={12} /> Heatmap</button>
        <div className="h-px bg-neutral-100 dark:bg-neutral-700 my-1"></div>
        <div className="px-3 py-1 text-[10px] text-neutral-400 uppercase font-medium">Format</div>
        
        {/* Row Number Options */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
            <button onClick={() => onAction('number')} className="flex-1 text-left flex items-center gap-2">
                <Hash size={12} /> Number
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

        {/* Row Currency Options */}
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs text-neutral-700 dark:text-neutral-200 hover:bg-neutral-50 dark:hover:bg-neutral-700">
            <button onClick={() => onAction('currency')} className="flex-1 text-left flex items-center gap-2">
                <DollarSign size={12} /> Currency
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

        <button onClick={() => onAction('percent')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><Percent size={12} /> Percent</button>
        <div className="relative group/date-row">
            <button className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center justify-between">
                <div className="flex items-center gap-2"><Calendar size={12} /> Date</div>
                <ChevronRight size={10} />
            </button>
            <div className="absolute left-full top-0 ml-1 w-32 bg-white dark:bg-neutral-800 shadow-xl rounded-lg border border-neutral-100 dark:border-neutral-700 hidden group-hover/date-row:block py-1">
                <button onClick={() => onAction('date', 'YYYY-MM-DD')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">YYYY-MM-DD</button>
                <button onClick={() => onAction('date', 'MM/DD/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">MM/DD/YYYY</button>
                <button onClick={() => onAction('date', 'DD/MM/YYYY')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">DD/MM/YYYY</button>
                <button onClick={() => onAction('date', 'Full')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200">Full Date</button>
            </div>
        </div>
        <button onClick={() => onAction('text')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2"><Type size={12} /> Text</button>
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
                <button onClick={() => onAction('clear-row')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-neutral-50 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-200 flex items-center gap-2">
                    <Eraser size={12} className="text-neutral-400" /> Clear Data
                </button>
                <button onClick={() => onAction('delete-row')} className="w-full px-3 py-1.5 text-xs text-left hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400 flex items-center gap-2">
                    <Trash2 size={12} /> Delete Row
                </button>
            </>
        )}
    </div>
  );
};
