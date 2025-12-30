
import React, { useState, useEffect, useRef } from 'react';
import { NoteData } from '../types';
import { GripVertical, Trash2, Bold, Italic, Underline, List, ListOrdered } from 'lucide-react';
import { useStore } from '../store';

interface NoteNodeProps {
  id: string;
  darkMode?: boolean;
  initialEditing?: boolean;
  isPendingDelete?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

export const NoteNode: React.FC<NoteNodeProps> = ({ id, darkMode, initialEditing, isPendingDelete, onMouseDown }) => {
  const data = useStore(state => state.notes[id]);
  const selected = useStore(state => state.selectedIds.has(id));
  const scale = useStore(state => state.transform.scale);
  const updateNote = useStore(state => state.updateNote);
  const deleteNote = useStore(state => state.deleteNote);
  const saveSnapshot = useStore(state => state.saveSnapshot);

  const [isEditing, setIsEditing] = useState(initialEditing || false);
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  
  const [displayContent, setDisplayContent] = useState(data?.content || '');

  const editorRef = useRef<HTMLDivElement>(null);

  if (!data) return null;

  useEffect(() => {
      setDisplayContent(data.content);
  }, [data.content]);

  useEffect(() => {
    if (isEditing && editorRef.current) {
      if (editorRef.current.innerHTML !== displayContent) {
         editorRef.current.innerHTML = displayContent;
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
  }, [isEditing, displayContent]);

  useEffect(() => {
    if (!resizing) return;
    let rafId: number | null = null;
    let lastPos: { x: number; y: number } | null = null;

    const commitResize = () => {
      if (!lastPos) return;
      const dx = (lastPos.x - resizing.startX) / scale;
      const dy = (lastPos.y - resizing.startY) / scale;

      updateNote(data.id, {
        size: {
          width: Math.max(100, resizing.startW + dx),
          height: Math.max(48, resizing.startH + dy)
        }
      });
    };

    const scheduleCommit = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        commitResize();
      });
    };

    const handleMouseMove = (e: MouseEvent) => {
      lastPos = { x: e.clientX, y: e.clientY };
      scheduleCommit();
    };

    const handleMouseUp = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      commitResize();
      setResizing(null);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [resizing, scale, data.id, updateNote]);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    saveSnapshot();
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
          const currentHtml = editorRef.current.innerHTML;
          if (currentHtml !== data.content) {
              saveSnapshot();
              setDisplayContent(currentHtml);
              updateNote(data.id, { content: currentHtml });
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
                onClick={() => deleteNote(data.id)}
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
            dangerouslySetInnerHTML={!isEditing ? { __html: displayContent } : undefined}
            onDoubleClick={() => setIsEditing(true)}
            style={{ 
                overflowWrap: 'break-word',
                backgroundColor: 'transparent'
            }}
         />
         
         <div className={`absolute inset-0 border border-transparent rounded-lg pointer-events-none -z-10 transition-colors ${!selected ? 'group-hover:border-neutral-200 dark:group-hover:border-neutral-700' : ''}`} />
         
         {(!displayContent || displayContent === '<br>' || displayContent === '') && !isEditing && (
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
