
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Command } from '../types';
import { Search, Command as CommandIcon, ArrowRight, CornerDownLeft, Calculator, Copy } from 'lucide-react';
import { evaluateFormula } from '../utils/formulas';

interface CommandBarProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
}

export const CommandBar: React.FC<CommandBarProps> = ({ isOpen, onClose, commands }) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      // Blur input when closed to return focus to document body/previous element
      inputRef.current?.blur();
    }
  }, [isOpen]);

  const calculationResult = useMemo(() => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 1) return null;

    // Basic heuristic: check if it looks like math or starts with =
    // Matches if it starts with = OR contains math operators and digits
    const looksLikeMath = trimmed.startsWith('=') || /[\d][+\-*/^%().]/.test(trimmed);
    
    if (looksLikeMath) {
        // Prepare formula for engine (must start with =)
        const formula = trimmed.startsWith('=') ? trimmed : `=${trimmed}`;
        
        // Use a dummy getValue since we are in global context (no cell references valid here)
        const result = evaluateFormula(formula, () => 0);
        
        // Only show if result is a valid number and valid calc
        if (result !== '#ERROR' && result !== null && !isNaN(Number(result))) {
             // Avoid showing result if it's identical to input (e.g. typing "100")
             if (String(result) === trimmed.replace('=', '')) return null;

             return {
                 id: 'quick-calc',
                 label: String(result),
                 subLabel: 'Calculation Result — Press Enter to Copy',
                 category: 'Calculator',
                 icon: <Calculator size={18} />,
                 action: () => {
                     navigator.clipboard.writeText(String(result));
                     // We could show a toast here if passed down, but silence is fine for copy
                 },
                 keywords: ['math', 'calc']
             } as Command;
        }
    }
    return null;
  }, [query]);

  const filteredCommands = useMemo(() => {
    const baseList = commands.filter(cmd => {
      if (!query) return true;
      const lowerQuery = query.toLowerCase();
      return (
        cmd.label.toLowerCase().includes(lowerQuery) || 
        cmd.category.toLowerCase().includes(lowerQuery) ||
        cmd.subLabel?.toLowerCase().includes(lowerQuery) ||
        cmd.keywords?.some(k => k.toLowerCase().includes(lowerQuery))
      );
    });
    
    if (calculationResult) {
        return [calculationResult, ...baseList];
    }
    return baseList;
  }, [commands, query, calculationResult]);

  useEffect(() => {
      setSelectedIndex(0);
  }, [filteredCommands]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev + 1) % filteredCommands.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev - 1 + filteredCommands.length) % filteredCommands.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredCommands[selectedIndex]) {
        filteredCommands[selectedIndex].action();
        onClose();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  useEffect(() => {
     if (listRef.current) {
         const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
         if (selectedEl) {
             selectedEl.scrollIntoView({ block: 'nearest' });
         }
     }
  }, [selectedIndex]);

  return (
    <div className={`fixed inset-0 z-[100] flex flex-col justify-end items-center pointer-events-none transition-all duration-300 ${isOpen ? 'pointer-events-auto' : ''}`}>
      
      {/* Backdrop - Invisible click catcher, no blur */}
      <div 
        className={`absolute inset-0 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`} 
        onClick={onClose}
      />
      
      {/* Container animated from bottom up, positioned lower on screen */}
      <div 
        className={`
            relative w-full max-w-xl px-4 pb-4 flex flex-col-reverse gap-3
            transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]
            ${isOpen ? 'translate-y-[-10vh] opacity-100 scale-100' : 'translate-y-[40px] opacity-0 scale-95'}
        `}
      >
        
        {/* Input Bar */}
        <div className="bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-2xl border border-neutral-200/50 dark:border-neutral-700/50 rounded-2xl overflow-hidden flex items-center p-2 gap-3 h-14 ring-1 ring-neutral-900/5 dark:ring-white/5 relative z-20">
             <div className="pl-2 text-neutral-400">
                <Search size={20} />
             </div>
             <input
                ref={inputRef}
                type="text"
                className="flex-1 bg-transparent text-lg outline-none text-neutral-800 dark:text-neutral-100 placeholder:text-neutral-400 h-full"
                placeholder="Type a command or math (e.g. 50*12)..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
             />
             <div className="pr-2 flex items-center gap-2">
                 <button onClick={onClose} className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-lg text-neutral-400 transition-colors">
                    <span className="text-xs font-medium">Esc</span>
                 </button>
             </div>
        </div>

        {/* Results List */}
        <div 
             className={`
                bg-white/80 dark:bg-neutral-900/80 backdrop-blur-xl shadow-2xl border border-neutral-200/50 dark:border-neutral-700/50 rounded-2xl overflow-hidden flex flex-col
                transition-all duration-300 ease-out origin-bottom
                ${isOpen ? 'opacity-100 translate-y-0 scale-100' : 'opacity-0 translate-y-4 scale-95'}
             `}
             style={{ maxHeight: '40vh' }}
        >
             <div 
                ref={listRef}
                className="overflow-y-auto p-2 scrollbar-thin"
            >
                {filteredCommands.length === 0 ? (
                    <div className="py-8 text-center text-neutral-400 text-sm">
                        No commands found for "{query}"
                    </div>
                ) : (
                    filteredCommands.map((cmd, index) => (
                    <button
                        key={`${cmd.category}-${cmd.id}`}
                        onClick={() => { cmd.action(); onClose(); }}
                        className={`w-full flex items-center justify-between px-3 py-3 rounded-xl text-left group transition-all duration-200
                        ${index === selectedIndex 
                            ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-sm' 
                            : 'text-neutral-700 dark:text-neutral-300'
                        }
                        `}
                        onMouseEnter={() => setSelectedIndex(index)}
                    >
                        <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`p-2 rounded-lg flex-shrink-0 transition-colors 
                                ${cmd.category === 'Calculator' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400' : ''}
                                ${index === selectedIndex && cmd.category !== 'Calculator' ? 'bg-neutral-200 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200' : ''}
                                ${index !== selectedIndex && cmd.category !== 'Calculator' ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-500' : ''}
                            `}>
                                {cmd.icon || <CommandIcon size={18} />}
                            </div>
                            <div className="flex flex-col overflow-hidden">
                                <span className="text-sm font-semibold truncate">{cmd.label}</span>
                                <div className="flex items-center gap-2 text-xs opacity-60">
                                    <span className="font-medium">{cmd.category}</span>
                                    {cmd.subLabel && (
                                        <>
                                            <span>•</span>
                                            <span className="truncate">{cmd.subLabel}</span>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                            {cmd.category === 'Calculator' && index === selectedIndex && (
                                <div className="flex items-center gap-1 text-xs text-teal-600 dark:text-teal-400 font-medium">
                                    <Copy size={12} />
                                    <span>Copy</span>
                                </div>
                            )}
                            
                            {cmd.shortcut && (
                                <div className="flex gap-1">
                                    {cmd.shortcut.map(k => (
                                        <kbd key={k} className={`px-1.5 py-0.5 rounded text-[10px] font-sans border font-medium
                                            ${index === selectedIndex
                                                ? 'bg-white/60 border-neutral-300/50 dark:bg-black/20 dark:border-neutral-500/20'
                                                : 'bg-neutral-100 dark:bg-neutral-800 border-neutral-200 dark:border-neutral-700 text-neutral-500'
                                            }
                                        `}>
                                            {k}
                                        </kbd>
                                    ))}
                                </div>
                            )}
                            {index === selectedIndex && (
                                <CornerDownLeft size={16} className="opacity-50 text-neutral-500 dark:text-neutral-400" />
                            )}
                        </div>
                    </button>
                    ))
                )}
            </div>
            {filteredCommands.length > 0 && (
                <div className="px-4 py-2 bg-neutral-50/50 dark:bg-neutral-900/30 border-t border-neutral-100 dark:border-neutral-800 text-[10px] text-neutral-400 flex justify-between items-center backdrop-blur-md">
                    <span className="flex items-center gap-2">
                        <span className="flex gap-0.5"><kbd className="font-sans bg-neutral-200 dark:bg-neutral-700 px-1 rounded">↑</kbd><kbd className="font-sans bg-neutral-200 dark:bg-neutral-700 px-1 rounded">↓</kbd></span> 
                        <span>to navigate</span>
                    </span>
                    <span className="flex items-center gap-2">
                        <kbd className="font-sans bg-neutral-200 dark:bg-neutral-700 px-1 rounded">↵</kbd>
                        <span>to select</span>
                    </span>
                </div>
            )}
        </div>

      </div>
    </div>
  );
};
