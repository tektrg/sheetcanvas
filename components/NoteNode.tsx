import React, { useState, useEffect, useRef } from 'react';
import { NoteData } from '../types';
import { GripVertical, Trash2, Bold, Italic, Underline, List, ListOrdered } from 'lucide-react';

interface NoteNodeProps {
  data: NoteData;
  scale: number;
  selected: boolean;
  onUpdate: (id: string, newData: NoteData) => void;
  onDelete: (id: string) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  darkMode?: boolean;
  initialEditing?: boolean;
  onHistorySave?: () => void;
  isPendingDelete?: boolean;
}

export const NoteNode: React.FC<NoteNodeProps> = ({ data, scale, selected, onUpdate, onDelete, onMouseDown, darkMode, initialEditing, onHistorySave, isPendingDelete }) => {
  const [isEditing, setIsEditing] = useState(initialEditing || false);
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isEditing && editorRef.current) {
      if (editorRef.current.innerHTML !== data.content) {
         editorRef.current.innerHTML = data.content;
      }
      editorRef.current.focus();
      
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }, [isEditing]);

  useEffect(() => {
    if (!resizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const dx = (e.clientX - resizing.startX) / scale;
      const dy = (e.clientY - resizing.startY) / scale;
      
      onUpdate(data.id, {
        ...data,
        size: {
          width: Math.max(100, resizing.startW + dx),
          height: Math.max(48, resizing.startH + dy)
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
    if (onHistorySave) onHistorySave();
    setResizing({
      startX: e.clientX,
      startY: e.clientY,
      startW: data.size.width,
      startH: data.size.height
    });
  };

  const execCmd = (cmd: string, val?: string) => {
    document.execCommand(cmd, false, val);
    if (editorRef.current) {
        editorRef.current.focus();
    }
  };

  const handleBlur = () => {
      if (editorRef.current) {
          if (editorRef.current.innerHTML !== data.content) {
              if (onHistorySave) onHistorySave();
              onUpdate(data.id, { ...data, content: editorRef.current.innerHTML });
          }
      }
      setIsEditing(false);
  };

  const ToolbarButton = ({ icon: Icon, cmd, arg }: { icon: any, cmd: string, arg?: string }) => (
    <button
        onMouseDown={(e) => {
            e.preventDefault(); 
            execCmd(cmd, arg);
        }}
        className="p-1.5 rounded-md hover:bg-neutral-100 dark:hover:bg-neutral-700 text-neutral-500 dark:text-neutral-400 transition-colors flex items-center justify-center w-full"
    >
        <Icon size={14} />
    </button>
  );

  return (
    <div
      id={`note-${data.id}`}
      className={`absolute flex flex-row group border transition-shadow transition-colors duration-200 rounded-lg
         ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-transparent z-35'}
         ${isPendingDelete ? 'animate-delete-pulse' : ''}
      `}
      style={{
        left: data.position.x,
        top: data.position.y,
        width: data.size.width,
        height: data.size.height,
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className={`w-8 flex flex-col items-center pt-2 transition-opacity duration-200 ${isEditing ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} relative`}>
         
         <div 
            className="p-1.5 cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400 mb-1"
            onMouseDown={onMouseDown}
         >
            <GripVertical size={16} />
         </div>

         {isEditing && (
            <div className="absolute top-10 left-1/2 -translate-x-1/2 flex flex-col bg-white dark:bg-neutral-800 rounded-lg shadow-xl border border-neutral-100 dark:border-neutral-700 overflow-hidden z-[60] w-8 p-0.5">
                <ToolbarButton icon={Bold} cmd="bold" />
                <ToolbarButton icon={Italic} cmd="italic" />
                <ToolbarButton icon={Underline} cmd="underline" />
                <div className="h-px bg-neutral-100 dark:bg-neutral-700 mx-1 my-0.5" />
                <ToolbarButton icon={List} cmd="insertUnorderedList" />
                <ToolbarButton icon={ListOrdered} cmd="insertOrderedList" />
            </div>
         )}

         {!isEditing && (
             <button 
                onClick={() => onDelete(data.id)}
                className="p-1.5 text-neutral-300 hover:text-red-500 transition-colors"
                title="Delete"
             >
                <Trash2 size={14} />
             </button>
         )}
      </div>

      <div className="flex-1 relative h-full">
         <div 
            ref={editorRef}
            className={`w-full h-full p-3 outline-none rich-text-content text-neutral-800 dark:text-neutral-200 leading-relaxed text-[15px] ${isEditing ? 'cursor-text' : 'cursor-default'}`}
            contentEditable={isEditing}
            suppressContentEditableWarning
            onBlur={handleBlur}
            dangerouslySetInnerHTML={{ __html: data.content }}
            onDoubleClick={() => setIsEditing(true)}
            style={{ 
                overflowWrap: 'break-word',
                backgroundColor: 'transparent' // Background handled by parent or canvas usually, or we can add bg here
            }}
         />
         
         {/* Note Background Card effect if desired, usually notes are just text in Notion but sometimes Callouts. 
             For this app, let's keep it clean but add a hover border? */}
         <div className={`absolute inset-0 border border-transparent rounded-lg pointer-events-none -z-10 transition-colors ${!selected ? 'group-hover:border-neutral-200 dark:group-hover:border-neutral-700' : ''}`} />
         
         {(!data.content || data.content === '<br>' || data.content === '') && !isEditing && (
             <div className="absolute top-3 left-3 opacity-40 italic pointer-events-none text-sm text-neutral-500 select-none">
                 Type something...
             </div>
         )}

         <div 
            className={`absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-center justify-center transition-opacity ${isEditing || 'group-hover:opacity-50 opacity-0'}`}
            onMouseDown={handleResizeStart}
         >
            <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
         </div>
      </div>
    </div>
  );
};