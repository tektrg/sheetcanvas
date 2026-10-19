import React from 'react';
import { LayoutGrid, Library } from 'lucide-react';

export type TopLevelView = 'canvas' | 'library';

const TABS: Array<{ id: TopLevelView; label: string; icon: React.ElementType }> = [
  { id: 'canvas', label: 'Canvas', icon: LayoutGrid },
  { id: 'library', label: 'Library', icon: Library },
];

export const ViewTabs: React.FC<{ activeView: TopLevelView; onChange: (view: TopLevelView) => void }> = ({ activeView, onChange }) => (
  <div className="fixed top-4 left-4 z-50 flex items-center gap-1 p-1 bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl shadow-xl border border-neutral-200/50 dark:border-neutral-700/50 rounded-full">
    {TABS.map(({ id, label, icon: Icon }) => (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={activeView === id}
        onClick={() => onChange(id)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
          ${activeView === id
            ? 'bg-teal-50 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
            : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-900 dark:hover:text-neutral-100'}`}
      >
        <Icon size={14} strokeWidth={1.5} />
        {label}
      </button>
    ))}
  </div>
);
