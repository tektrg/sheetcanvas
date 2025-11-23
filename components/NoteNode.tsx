import React, { useState, useEffect, useRef } from 'react';
import Markdown from 'markdown-to-jsx';
import { NoteData, NoteColor } from '../types';
import { NOTE_COLORS, NOTE_COLORS_DARK } from '../constants';
import { GripHorizontal, Trash2, Edit2, Check, Palette } from 'lucide-react';

interface NoteNodeProps {
  data: NoteData;
  scale: number;
  onUpdate: (id: string, newData: NoteData) => void;
  onDelete: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  darkMode?: boolean;
}

export const NoteNode: React.FC<NoteNodeProps> = ({ data, scale, onUpdate, onDelete, onMouseDown, darkMode }) => {
  const [isEditing, setIsEditing] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Get current color palette
  const themeColors = darkMode ? NOTE_COLORS_DARK : NOTE_COLORS;
  const currentColors = themeColors[data.color] || themeColors.yellow;

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [isEditing]);

  // Resize Logic
  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - resizing.startX) / scale;
      const dy = (e.clientY - resizing.startY) / scale;
      
      onUpdate(data.id, {
        ...data,
        size: {
          width: Math.max(150, resizing.startW + dx),
          height: Math.max(100, resizing.startH + dy)
        }
      });
    };
    const handleMouseUp = () => setResizing(null);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizing, scale, data, onUpdate]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing({
      startX: e.clientX,
      startY: e.clientY,
      startW: data.size.width,
      startH: data.size.height
    });
  };

  const handleToggleEdit = () => {
    setIsEditing(!isEditing);
    setShowColorPicker(false);
  };

  const handleColorChange = (color: NoteColor) => {
    onUpdate(data.id, { ...data, color });
    setShowColorPicker(false);
  };

  return (
    <div
      className={`absolute flex flex-col rounded-lg shadow-md hover:shadow-xl transition-shadow duration-200 group overflow-visible`}
      style={{
        left: data.position.x,
        top: data.position.y,
        width: data.size.width,
        height: data.size.height,
        backgroundColor: currentColors.bg,
        border: `1px solid ${currentColors.border}`,
        color: currentColors.text,
        zIndex: isEditing ? 50 : 35
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div 
        className="h-8 flex items-center justify-between px-2 cursor-grab active:cursor-grabbing select-none border-b border-black/5"
        onMouseDown={onMouseDown}
      >
        <div className="flex items-center gap-2 opacity-50 group-hover:opacity-100 transition-opacity">
          <GripHorizontal size={14} />
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {/* Color Picker */}
          <div className="relative">
             <button 
               onClick={() => setShowColorPicker(!showColorPicker)}
               className="p-1 rounded hover:bg-black/5 transition-colors"
               title="Change Color"
             >
                <Palette size={14} />
             </button>
             {showColorPicker && (
               <div className="absolute top-full right-0 mt-1 p-2 bg-white dark:bg-neutral-800 rounded-lg shadow-xl border border-neutral-200 dark:border-neutral-600 flex gap-2 z-50">
                  {(Object.keys(themeColors) as NoteColor[]).map(c => (
                     <button
                       key={c}
                       className={`w-5 h-5 rounded-full border border-neutral-300 dark:border-neutral-600 ${data.color === c ? 'ring-2 ring-offset-1 ring-neutral-400' : ''}`}
                       style={{ backgroundColor: themeColors[c].bg }}
                       onClick={() => handleColorChange(c)}
                     />
                  ))}
               </div>
             )}
          </div>

          <button 
            onClick={handleToggleEdit} 
            className="p-1 rounded hover:bg-black/5 transition-colors"
            title={isEditing ? "Done" : "Edit"}
          >
            {isEditing ? <Check size={14} /> : <Edit2 size={14} />}
          </button>
          
          <button 
            onClick={() => onDelete(data.id)} 
            className="p-1 rounded hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden relative">
        {isEditing ? (
          <textarea
            ref={textareaRef}
            className="w-full h-full p-4 bg-transparent resize-none outline-none font-mono text-sm leading-relaxed"
            value={data.content}
            onChange={(e) => onUpdate(data.id, { ...data, content: e.target.value })}
            placeholder="# Title\nWrite something..."
            onKeyDown={(e) => {
                if (e.key === 'Escape') handleToggleEdit();
            }}
          />
        ) : (
            <div 
              className="w-full h-full p-4 overflow-auto markdown-content cursor-text"
              onClick={() => setIsEditing(true)}
              onWheel={(e) => e.stopPropagation()}
            >
                {data.content ? (
                    <Markdown options={{ forceBlock: true }}>{data.content}</Markdown>
                ) : (
                    <span className="opacity-40 italic">Empty note...</span>
                )}
            </div>
        )}
      </div>

      {/* Resize Handle */}
      <div 
        className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize flex items-center justify-center opacity-0 group-hover:opacity-50 transition-opacity"
        onMouseDown={handleResizeStart}
      >
        <div className="w-2 h-2 border-r-2 border-b-2 border-current rounded-br-[1px]" />
      </div>

    </div>
  );
};