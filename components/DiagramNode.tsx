import React from 'react';
import { GripVertical, PencilLine, Trash2, Workflow } from 'lucide-react';
import { useStore } from '../store';
import { DiagramSvg } from '../diagram/renderSvg';

interface DiagramNodeProps {
  id: string;
  darkMode?: boolean;
  isPendingDelete?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

// Canvas card for a diagram: cheap SVG preview; double-click (or the pencil)
// opens the full Excalidraw editor, which is loaded only then.
const DiagramNodeComponent: React.FC<DiagramNodeProps> = ({ id, darkMode, isPendingDelete, onMouseDown }) => {
  const diagram = useStore(state => state.diagrams[id]);
  const selected = useStore(state => state.selectedIds.has(id));
  const deleteDiagram = useStore(state => state.deleteDiagram);
  const setEditingDiagramId = useStore(state => state.setEditingDiagramId);

  if (!diagram) return null;
  const openEditor = () => setEditingDiagramId(id);
  const background = diagram.appState?.viewBackgroundColor;

  return (
    <div
      id={`diagram-${id}`}
      data-testid="diagram-node"
      className={`absolute group select-none pointer-events-auto ${isPendingDelete ? 'animate-delete-pulse' : ''}`}
      style={{ left: diagram.position.x, top: diagram.position.y, width: diagram.size.width, height: diagram.size.height }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => { e.stopPropagation(); openEditor(); }}
    >
      <div
        className={`w-full h-full flex flex-col rounded-xl border overflow-hidden transition-shadow
          ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-lg'}`}
        style={{ backgroundColor: darkMode ? '#1e1e1e' : '#ffffff' }}
      >
        <div
          data-export-exclude
          className="flex items-center gap-1 px-2 py-1 text-xs text-neutral-500 dark:text-neutral-400 border-b border-neutral-100 dark:border-neutral-800"
          style={{ minHeight: '32px' }}
        >
          <div className="p-1 cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 dark:text-neutral-600" onMouseDown={onMouseDown}>
            <GripVertical size={15} />
          </div>
          <Workflow size={13} className="flex-shrink-0" />
          <span className="flex-1 truncate font-medium">{diagram.title ?? 'Diagram'}</span>
          <button
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-opacity"
            title="Edit diagram"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); openEditor(); }}
          >
            <PencilLine size={14} />
          </button>
          <button
            className="p-1 rounded-md opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-opacity"
            title="Delete"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); deleteDiagram(id); }}
          >
            <Trash2 size={14} />
          </button>
        </div>
        {/* Preview keeps a light paper background so default dark strokes stay readable in dark mode. */}
        <div className="flex-1 min-h-0 p-2 cursor-default" style={{ backgroundColor: background ?? '#ffffff' }} onMouseDown={onMouseDown}>
          <DiagramSvg elements={diagram.elements} />
        </div>
      </div>
    </div>
  );
};

export const DiagramNode = React.memo(DiagramNodeComponent);
