
import React, { useState, useEffect, useRef } from 'react';
import { BookOpen, Grid3X3, Moon, Sun, StickyNote, Undo2, Redo2, Upload, MousePointer2, Hand, MoreHorizontal, Keyboard, Info, Search, Database } from 'lucide-react';
import { ToolMode } from '../types';
import { useStore } from '../store';

interface ToolbarProps {
  onAddTable: () => void;
  onAddNote: () => void;
  onImport: () => void;
  onConnectData: () => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  onOpenCommandBar: () => void;
  onOpenLearn: () => void;
  hidden?: boolean;
}

const ToolbarButton: React.FC<{
  onClick?: () => void;
  icon: React.ElementType;
  tooltip: string;
  disabled?: boolean;
  active?: boolean;
  buttonRef?: React.RefObject<HTMLButtonElement>;
}> = ({ onClick, icon: Icon, tooltip, disabled, active, buttonRef }) => (
  <button 
    ref={buttonRef}
    onClick={onClick}
    disabled={disabled}
    className={`group relative p-2.5 rounded-full transition-all flex items-center justify-center
      ${disabled 
        ? 'text-neutral-300 dark:text-neutral-600 cursor-not-allowed' 
        : active
          ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-500 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
      }`}
  >
    <Icon size={20} strokeWidth={1.5} />
    {!disabled && (
      <span className="absolute bottom-full mb-2.5 left-1/2 -translate-x-1/2 px-2 py-1 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-[10px] font-medium rounded-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-sm z-50">
        {tooltip}
      </span>
    )}
  </button>
);

export const Toolbar: React.FC<ToolbarProps> = ({ 
  onAddTable, 
  onAddNote, 
  onImport,
  onConnectData,
  darkMode, 
  toggleDarkMode,
  onOpenCommandBar,
  onOpenLearn,
  hidden
}) => {
  const toolMode = useStore(state => state.toolMode);
  const setToolMode = useStore(state => state.setToolMode);
  const undo = useStore(state => state.undo);
  const redo = useStore(state => state.redo);
  const canUndo = useStore(state => state.history.length > 0);
  const canRedo = useStore(state => state.future.length > 0);

  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  const toggleCursorMode = () => {
    setToolMode(toolMode === ToolMode.SELECT ? ToolMode.PAN : ToolMode.SELECT);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        isMoreOpen &&
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        moreButtonRef.current &&
        !moreButtonRef.current.contains(event.target as Node)
      ) {
        setIsMoreOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMoreOpen]);

  return (
    <div 
      className={`fixed bottom-8 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
        ${hidden ? 'opacity-0 translate-y-8 pointer-events-none scale-95' : 'opacity-100 translate-y-0 scale-100'}
      `}
    >
      <div className="flex items-center gap-1 p-1.5 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50 rounded-full transition-all">
        
        {/* Undo/Redo Group */}
        <ToolbarButton onClick={undo} icon={Undo2} tooltip="Undo (Ctrl+Z)" disabled={!canUndo} />
        <ToolbarButton onClick={redo} icon={Redo2} tooltip="Redo (Ctrl+Shift+Z)" disabled={!canRedo} />

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />

        {/* Search / Command Bar */}
        <ToolbarButton onClick={onOpenCommandBar} icon={Search} tooltip="Search Commands (Ctrl+K)" />

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />

        {/* Cursor Toggle */}
        <ToolbarButton 
          onClick={toggleCursorMode} 
          icon={toolMode === ToolMode.SELECT ? MousePointer2 : Hand} 
          tooltip={toolMode === ToolMode.SELECT ? "Switch to Pan Mode (Space)" : "Switch to Select Mode (V)"} 
          active={true}
        />
        
        {/* Creation Tools */}
        <ToolbarButton onClick={onAddTable} icon={Grid3X3} tooltip="Add Table" />
        <ToolbarButton onClick={onConnectData} icon={Database} tooltip="Connect Data (Google Sheets/Analytics)" />
        <ToolbarButton onClick={onImport} icon={Upload} tooltip="Import File" />
        <ToolbarButton onClick={onAddNote} icon={StickyNote} tooltip="Add Note" />

        <div className="h-4 w-px bg-neutral-200 dark:bg-neutral-700 mx-1" />

        {/* More Menu */}
        <div className="relative">
             <ToolbarButton 
                buttonRef={moreButtonRef}
                onClick={() => setIsMoreOpen(!isMoreOpen)} 
                icon={MoreHorizontal} 
                tooltip="More" 
                active={isMoreOpen}
             />
             
             {isMoreOpen && (
                 <div 
                    ref={menuRef}
                    className="absolute bottom-full right-0 mb-4 w-72 bg-white/95 dark:bg-neutral-900/95 backdrop-blur-xl border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl p-4 flex flex-col gap-4 animate-scale-in origin-bottom-right z-50 cursor-default"
                 >
                    
                    {/* Theme */}
                    <div className="flex items-center justify-between">
                         <div className="flex items-center gap-2 text-neutral-600 dark:text-neutral-300">
                             <Sun size={16} />
                             <span className="text-sm font-medium">Appearance</span>
                         </div>
                         <button 
                            onClick={toggleDarkMode}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors text-xs font-medium text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700"
                         >
                            {darkMode ? <Moon size={12} /> : <Sun size={12} />}
                            {darkMode ? 'Dark' : 'Light'}
                         </button>
                    </div>

                    <div className="h-px bg-neutral-100 dark:bg-neutral-800" />

                    <button
                      type="button"
                      onClick={() => {
                        onOpenLearn();
                        setIsMoreOpen(false);
                      }}
                      className="flex w-full items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5 text-left text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-800/60 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      <span className="flex items-center gap-2">
                        <BookOpen size={15} />
                        <span className="text-sm font-medium">Learn SheetCanvas</span>
                      </span>
                      <span className="text-[10px] font-medium uppercase tracking-wide text-neutral-400">Guide</span>
                    </button>

                    <div className="h-px bg-neutral-100 dark:bg-neutral-800" />

                    {/* Shortcuts / Info */}
                    <div>
                        <div className="flex items-center gap-2 mb-3 text-neutral-500 dark:text-neutral-400">
                             <Keyboard size={14} />
                             <span className="text-xs font-semibold uppercase tracking-wide">Shortcuts</span>
                        </div>
                         <ul className="space-y-2 text-xs text-neutral-600 dark:text-neutral-300">
                           <li className="flex justify-between items-center">
                               <span>Command Bar</span> 
                               <div className="flex gap-1">
                                <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 font-sans text-[10px]">Ctrl</kbd>
                                <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 font-sans text-[10px]">K</kbd>
                               </div>
                           </li>
                           <li className="flex justify-between items-center">
                               <span>Pan / Select</span> 
                               <div className="flex gap-1">
                                   <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 font-sans text-[10px] min-w-[20px] text-center">Space</kbd>
                                   <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 font-sans text-[10px] min-w-[20px] text-center">V</kbd>
                               </div>
                           </li>
                           <li className="flex justify-between items-center">
                               <span>Undo</span> 
                               <div className="flex gap-1">
                                <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 font-sans text-[10px]">Ctrl</kbd>
                                <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 font-sans text-[10px]">Z</kbd>
                               </div>
                           </li>
                           <li className="flex justify-between items-center">
                               <span>Delete</span> 
                               <kbd className="px-1.5 py-0.5 bg-neutral-100 dark:bg-neutral-800 rounded border border-neutral-200 dark:border-neutral-700 font-sans text-[10px]">Del</kbd>
                           </li>
                         </ul>
                    </div>

                    {/* Info Footer */}
                    <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-center gap-1.5 text-[10px] text-neutral-400">
                        <Info size={12} />
                        <span>Infinite Calc Canvas v1.0</span>
                    </div>

                 </div>
             )}
        </div>

      </div>
    </div>
  );
};
