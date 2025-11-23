import React from 'react';
import { Plus, Calculator, Info, Moon, Sun, Cloud, CloudOff, CheckCircle2, Loader2 } from 'lucide-react';

interface ToolbarProps {
  onAddTable: () => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  saveStatus: 'saved' | 'saving' | 'error' | 'idle';
}

export const Toolbar: React.FC<ToolbarProps> = ({ onAddTable, darkMode, toggleDarkMode, saveStatus }) => {
  return (
    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-white/80 dark:bg-neutral-850/80 backdrop-blur-md shadow-lg border border-white/20 dark:border-neutral-700 rounded-2xl p-2 flex items-center gap-2 z-50 transition-colors">
      <div className="flex items-center gap-2 px-4 py-2">
         <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center text-white shadow-md">
            <Calculator size={18} />
         </div>
         <div className="flex flex-col">
            <span className="font-semibold text-neutral-700 dark:text-neutral-200 hidden sm:inline leading-none mb-0.5">InfiniCalc</span>
            <div className="flex items-center gap-1 text-[10px] text-neutral-500 dark:text-neutral-400">
               {saveStatus === 'saving' && (
                 <>
                   <Loader2 size={10} className="animate-spin" />
                   <span>Saving...</span>
                 </>
               )}
               {saveStatus === 'saved' && (
                 <>
                   <Cloud size={10} />
                   <span>Saved</span>
                 </>
               )}
               {saveStatus === 'error' && (
                 <>
                   <CloudOff size={10} className="text-red-500" />
                   <span className="text-red-500">Error</span>
                 </>
               )}
            </div>
         </div>
      </div>
      <div className="h-6 w-px bg-neutral-300 dark:bg-neutral-600 mx-1"></div>
      
      <button 
        onClick={onAddTable}
        className="flex items-center gap-2 bg-neutral-900 dark:bg-neutral-100 hover:bg-black dark:hover:bg-white text-white dark:text-neutral-900 px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-md active:scale-95 transform duration-100"
      >
        <Plus size={16} />
        <span className="hidden sm:inline">Table</span>
      </button>

      <div className="h-6 w-px bg-neutral-300 dark:bg-neutral-600 mx-1"></div>

      <button
        onClick={toggleDarkMode}
        className="p-2 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-600 dark:text-neutral-300 transition-colors"
        title="Toggle Dark Mode"
      >
        {darkMode ? <Sun size={18} /> : <Moon size={18} />}
      </button>
      
      <div className="group relative flex items-center justify-center w-8 h-8 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-help">
         <Info size={18} />
         <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-64 bg-neutral-900 dark:bg-neutral-700 text-white text-xs rounded-lg p-3 opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-xl border border-transparent dark:border-neutral-600">
           <p className="font-bold mb-1">Supported Formulas:</p>
           <ul className="space-y-1 list-disc pl-3">
             <li>=SUM(A1:A5)</li>
             <li>=AVG(A1:B2)</li>
             <li>=MIN(A1:A3)</li>
             <li>=MAX(C1:C5)</li>
             <li>=A1 + B2 * 5</li>
           </ul>
         </div>
      </div>
    </div>
  );
};