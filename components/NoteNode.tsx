
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { NoteData } from '../types';
import { GripVertical, Trash2, Bold, Italic, Underline, List, ListOrdered, StickyNote, MoreHorizontal, Copy, Download } from 'lucide-react';
import { useStore } from '../store';
import { MarkdownNote } from './mdx/MarkdownNote';
import { captureElementCanvas } from '../utils/elementCapture';

interface NoteNodeProps {
  id: string;
  darkMode?: boolean;
  initialEditing?: boolean;
  isPendingDelete?: boolean;
  onMouseDown: (e: React.MouseEvent) => void;
}

// Placeholder used only for the one render where the backing note was just
// deleted from the store — lets every hook below keep running with a valid
// shape instead of branching, so hook order/count never changes. The actual
// null check (and null render) happens after all hooks have run.
const EMPTY_NOTE_DATA: NoteData = {
  id: '',
  position: { x: 0, y: 0 },
  size: { width: 0, height: 0 },
  content: '',
  color: 'yellow',
};

const areNoteNodePropsEqual = (prev: NoteNodeProps, next: NoteNodeProps) => (
  prev.id === next.id &&
  prev.darkMode === next.darkMode &&
  prev.initialEditing === next.initialEditing &&
  prev.isPendingDelete === next.isPendingDelete &&
  prev.onMouseDown === next.onMouseDown
);

const NoteNodeComponent: React.FC<NoteNodeProps> = ({ id, darkMode, initialEditing, isPendingDelete, onMouseDown }) => {
  const rawData = useStore(state => state.notes[id]);
  const data = rawData ?? EMPTY_NOTE_DATA;
  const selected = useStore(state => state.selectedIds.has(id));
  const updateNote = useStore(state => state.updateNote);
  const deleteNote = useStore(state => state.deleteNote);
  const saveSnapshot = useStore(state => state.saveSnapshot);
  
  const scaleRef = useRef(useStore.getState().transform.scale);
  useEffect(() => {
    return useStore.subscribe((state) => {
      scaleRef.current = state.transform.scale;
    });
  }, []);

  const isLowZoom = useStore(state => state.transform.scale < 0.35);

  const [isEditing, setIsEditing] = useState(initialEditing || false);
  const [resizing, setResizing] = useState<{ startX: number; startY: number; startW: number; startH: number } | null>(null);
  const [displayContent, setDisplayContent] = useState(data?.content || '');
  const [optionsOpen, setOptionsOpen] = useState(false);

  const editorRef = useRef<HTMLDivElement>(null);
  const markdownEditorRef = useRef<HTMLTextAreaElement>(null);
  const markdownDisplayRef = useRef<HTMLDivElement>(null);
  const noteContainerRef = useRef<HTMLDivElement>(null);
  const optionsMenuRef = useRef<HTMLDivElement>(null);

  // MDX-lite note: rendered as Markdown + whitelisted live components; edited as
  // raw Markdown source (WYSIWYG editing lands in Phase 2). Legacy notes stay HTML.
  const isMarkdown = data.format === 'markdown';

  useEffect(() => {
      setDisplayContent(data.content);
  }, [data.content]);

  useEffect(() => {
    if (isMarkdown) return; // HTML-only: markdown notes edit via a textarea below.
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
  }, [isEditing, displayContent, isMarkdown]);

  useEffect(() => {
    if (!resizing) return;
    let rafId: number | null = null;
    let lastPos: { x: number; y: number } | null = null;

    const commitResize = () => {
      if (!lastPos) return;
      const dx = (lastPos.x - resizing.startX) / scaleRef.current;
      const dy = (lastPos.y - resizing.startY) / scaleRef.current;

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
  }, [resizing, data.id, updateNote]);

  // Scrolling inside the note must not reach the canvas's wheel listener (pan/zoom),
  // which is bound natively on an ancestor and fires before React's onWheel delegation.
  useEffect(() => {
    const stopWheelPropagation = (e: WheelEvent) => e.stopPropagation();
    const els = [editorRef.current, markdownEditorRef.current, markdownDisplayRef.current].filter(
      (el): el is HTMLElement => el !== null
    );
    els.forEach(el => el.addEventListener('wheel', stopWheelPropagation, { passive: true }));
    return () => els.forEach(el => el.removeEventListener('wheel', stopWheelPropagation));
  });

  // Close options menu when clicking outside
  useEffect(() => {
    if (!optionsOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (optionsMenuRef.current && !optionsMenuRef.current.contains(e.target as Node)) {
        setOptionsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [optionsOpen]);

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

  const handleMarkdownBlur = () => {
      if (markdownEditorRef.current) {
          const currentMarkdown = markdownEditorRef.current.value;
          if (currentMarkdown !== data.content) {
              saveSnapshot();
              setDisplayContent(currentMarkdown);
              updateNote(data.id, { content: currentMarkdown });
          }
      }
      setIsEditing(false);
  };

  const captureNote = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const el = noteContainerRef.current;
    if (!el) return null;
    try {
      return await captureElementCanvas(el, {
        backgroundColor: darkMode ? '#1e1e1e' : '#ffffff',
      });
    } catch {
      return null;
    }
  }, [darkMode]);

  const handleCopyAsImage = useCallback(async () => {
    setOptionsOpen(false);
    const canvas = await captureNote();
    if (!canvas) return;
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ 'image/png': blob })
        ]);
      } catch {
        // Fallback: open in new tab
        window.open(canvas.toDataURL('image/png'));
      }
    }, 'image/png');
  }, [captureNote]);

  const handleDownloadAsImage = useCallback(async () => {
    setOptionsOpen(false);
    const canvas = await captureNote();
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `note-${data.id}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }, [captureNote, data.id]);

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

  // Safe to bail now: every hook above has already run this render, so
  // returning null here (e.g. right after the note was deleted) can't
  // desync the hook count on the next render.
  if (!rawData) return null;

  if (isLowZoom) {
    return (
      <div
        id={`note-${data.id}`}
        className={`absolute flex flex-col rounded-xl border transition-shadow transition-colors duration-200 overflow-hidden group select-none pointer-events-auto
           ${selected ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50' : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-lg z-35'}
           ${isPendingDelete ? 'animate-delete-pulse' : ''}
        `}
        style={{
          left: data.position.x,
          top: data.position.y,
          width: data.size.width,
          height: data.size.height,
          backgroundColor: darkMode ? '#1e1e1e' : '#fafafa',
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onMouseDown(e);
        }}
      >
        <div className="h-8 flex items-center px-2 border-b border-neutral-100 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-800">
          <GripVertical size={14} className="text-neutral-300 dark:text-neutral-600 mr-2 flex-shrink-0" />
          <span className="text-[10px] font-semibold text-neutral-500 dark:text-neutral-400 uppercase tracking-wider">Note</span>
        </div>
        <div className="flex-1 p-3 flex flex-col justify-center items-center opacity-40">
          <StickyNote className="text-neutral-400 dark:text-neutral-500" size={28} />
          <span className="text-[10px] text-neutral-400 dark:text-neutral-500 font-medium truncate max-w-full px-2">
            {displayContent.trim() ? displayContent.substring(0, 30) + '...' : 'Empty Note'}
          </span>
        </div>
        <div 
           className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-center justify-center"
           onMouseDown={handleResizeStart}
        >
           <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
        </div>
      </div>
    );
  }

  return (
    <div
      id={`note-${data.id}`}
      className={`absolute group select-none pointer-events-auto
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
      {/* ── Note card ── */}
      <div
        ref={noteContainerRef}
        className={`w-full h-full flex flex-col rounded-xl border transition-shadow transition-colors duration-200 overflow-hidden
          ${selected
            ? 'border-teal-400 shadow-md ring-1 ring-teal-400 z-50'
            : 'border-neutral-200 dark:border-neutral-700 shadow-sm hover:shadow-lg'
          }
        `}
        style={{ backgroundColor: darkMode ? '#1e1e1e' : '#ffffff' }}
      >
        {/* ── Top control bar (shown on hover or when editing) ── */}
        <div
          data-export-exclude
          className={`flex items-center justify-between px-2 py-1 border-b border-transparent transition-all duration-150
            ${isEditing
              ? 'opacity-100 border-neutral-100 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-800/60'
              : 'opacity-0 group-hover:opacity-100 group-hover:border-neutral-100 dark:group-hover:border-neutral-800 group-hover:bg-neutral-50/80 dark:group-hover:bg-neutral-800/60'
            }
          `}
          style={{ minHeight: '32px' }}
        >
          {/* Drag handle — left */}
          <div
            className="p-1 cursor-grab active:cursor-grabbing text-neutral-300 hover:text-neutral-500 dark:text-neutral-600 dark:hover:text-neutral-400 transition-colors flex-shrink-0"
            onMouseDown={onMouseDown}
          >
            <GripVertical size={15} />
          </div>

          {/* Formatting toolbar (HTML mode only, when editing) — centre */}
          {isEditing && !isMarkdown && (
            <div className="flex items-center gap-0.5 bg-white dark:bg-neutral-800 rounded-md shadow border border-neutral-100 dark:border-neutral-700 px-0.5">
              <ToolbarButton icon={Bold} cmd="bold" />
              <ToolbarButton icon={Italic} cmd="italic" />
              <ToolbarButton icon={Underline} cmd="underline" />
              <div className="w-px h-4 bg-neutral-200 dark:bg-neutral-700 mx-0.5" />
              <ToolbarButton icon={List} cmd="insertUnorderedList" />
              <ToolbarButton icon={ListOrdered} cmd="insertOrderedList" />
            </div>
          )}

          {/* Right cluster: options menu + delete */}
          <div className="flex items-center gap-0.5 flex-shrink-0">
            {/* Options / more menu */}
            <div className="relative" ref={optionsMenuRef}>
              <button
                className="p-1 rounded-md text-neutral-300 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-700 transition-colors"
                title="More options"
                onClick={(e) => {
                  e.stopPropagation();
                  setOptionsOpen(v => !v);
                }}
                onMouseDown={(e) => e.stopPropagation()}
              >
                <MoreHorizontal size={14} />
              </button>

              {optionsOpen && (
                <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-neutral-800 rounded-lg shadow-xl border border-neutral-100 dark:border-neutral-700 overflow-hidden z-[100] py-1">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                    onClick={handleCopyAsImage}
                  >
                    <Copy size={13} className="flex-shrink-0" />
                    Copy as image
                  </button>
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700 transition-colors"
                    onClick={handleDownloadAsImage}
                  >
                    <Download size={13} className="flex-shrink-0" />
                    Download as image
                  </button>
                </div>
              )}
            </div>

            {/* Delete */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteNote(data.id);
              }}
              onMouseDown={(e) => e.stopPropagation()}
              className="p-1 rounded-md text-neutral-300 hover:text-red-500 dark:text-neutral-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
              title="Delete"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {/* ── Content area ── */}
        <div className="flex-1 relative overflow-hidden">
          {isMarkdown && isEditing && (
            <textarea
              ref={markdownEditorRef}
              className="w-full h-full px-4 py-3 outline-none resize-none bg-transparent font-mono text-[13px] leading-relaxed text-neutral-700 dark:text-neutral-300 cursor-text"
              defaultValue={displayContent}
              onBlur={handleMarkdownBlur}
              autoFocus
            />
          )}
          {isMarkdown && !isEditing && (
            <div
              ref={markdownDisplayRef}
              className="w-full h-full px-4 py-3 rich-text-content text-neutral-700 dark:text-neutral-300 leading-relaxed text-[15px] cursor-default overflow-auto"
              onDoubleClick={() => setIsEditing(true)}
              style={{ overflowWrap: 'break-word' }}
            >
              {displayContent
                ? <MarkdownNote content={displayContent} darkMode={darkMode} />
                : data.legacyHtml
                   ? <div dangerouslySetInnerHTML={{ __html: data.legacyHtml }} />
                   : null}
            </div>
          )}
          {!isMarkdown && (
            <div
              ref={editorRef}
              className={`w-full h-full px-4 py-3 outline-none rich-text-content text-neutral-700 dark:text-neutral-300 leading-relaxed text-[15px] overflow-auto ${isEditing ? 'cursor-text' : 'cursor-default'}`}
              contentEditable={isEditing}
              suppressContentEditableWarning
              onBlur={handleBlur}
              dangerouslySetInnerHTML={!isEditing ? { __html: displayContent } : undefined}
              onDoubleClick={() => setIsEditing(true)}
              style={{ overflowWrap: 'break-word', backgroundColor: 'transparent' }}
            />
          )}

          {/* Placeholder */}
          {(!displayContent || displayContent === '<br>' || displayContent === '') && !isEditing && (
            <div className="absolute top-3 left-4 opacity-40 italic pointer-events-none text-sm text-neutral-500 select-none">
              Type something...
            </div>
          )}

          {/* Resize handle */}
          <div
            className={`absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-center justify-center transition-opacity ${isEditing ? 'opacity-50' : 'opacity-0 group-hover:opacity-50'}`}
            onMouseDown={handleResizeStart}
          >
            <div className="w-1.5 h-1.5 bg-neutral-300 dark:bg-neutral-600 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
};

export const NoteNode = React.memo(NoteNodeComponent, areNoteNodePropsEqual);
