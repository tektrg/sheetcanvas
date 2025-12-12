
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { ToolMode, CanvasTransform } from '../types';
import { MIN_SCALE, MAX_SCALE, COLOR_PALETTE } from '../constants';
import { useStore } from '../store';

interface CanvasProps {
  children: React.ReactNode;
  darkMode: boolean;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}

export const Canvas: React.FC<CanvasProps> = ({ children, darkMode, onDoubleClick, onMouseDown }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef({ x: 0, y: 0 });
  
  const transform = useStore(state => state.transform);
  const setTransform = useStore(state => state.setTransform);
  const toolMode = useStore(state => state.toolMode);
  
  // Internal ref to track current visual state (which might be ahead of store during gestures)
  const transformRef = useRef<CanvasTransform>(transform);
  
  // Flag to ignore the next store update if it was triggered by our own interaction
  const ignoreNextUpdate = useRef(false);

  // Sync Store -> DOM (Programmatic Updates)
  useEffect(() => {
      if (ignoreNextUpdate.current) {
          ignoreNextUpdate.current = false;
          // Store caught up to us, just sync the ref to be safe
          transformRef.current = transform;
          return;
      }

      const dist = Math.hypot(transform.offset.x - transformRef.current.offset.x, transform.offset.y - transformRef.current.offset.y);
      const scaleDiff = Math.abs(transform.scale - transformRef.current.scale);
      const isSignificant = dist > 5 || scaleDiff > 0.001;

      if (contentRef.current) {
          if (isSignificant) {
              contentRef.current.style.transition = 'transform 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
          } else {
              contentRef.current.style.transition = 'none';
          }
          contentRef.current.style.transform = `translate(${transform.offset.x}px, ${transform.offset.y}px) scale(${transform.scale})`;
          
          if (gridRef.current) {
              if (isSignificant) {
                  gridRef.current.style.transition = 'background-position 0.5s cubic-bezier(0.16, 1, 0.3, 1), background-size 0.5s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s';
              } else {
                  gridRef.current.style.transition = 'none';
              }
              gridRef.current.style.backgroundPosition = `${transform.offset.x}px ${transform.offset.y}px`;
              gridRef.current.style.backgroundSize = `${24 * transform.scale}px ${24 * transform.scale}px`;
          }
      }
      
      transformRef.current = transform;
  }, [transform]);

  const palette = darkMode ? COLOR_PALETTE.dark : COLOR_PALETTE.light;

  // Debounced state update for wheel zooming/panning
  const debouncedSetTransform = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateStoreTransform = useCallback((newTransform: CanvasTransform) => {
      if (debouncedSetTransform.current) {
          clearTimeout(debouncedSetTransform.current);
      }
      debouncedSetTransform.current = setTimeout(() => {
          setTransform(newTransform);
      }, 100);
  }, [setTransform]);

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    
    // Calculate new state based on current ref
    let newScale = transformRef.current.scale;
    let newOffset = { ...transformRef.current.offset };

    if (e.ctrlKey || e.metaKey) {
      const zoomIntensity = 0.001;
      newScale = Math.min(Math.max(transformRef.current.scale - e.deltaY * zoomIntensity, MIN_SCALE), MAX_SCALE);
      // Zoom towards mouse pointer logic could be added here, currently center zoom-ish
    } else {
        newOffset.x -= e.deltaX;
        newOffset.y -= e.deltaY;
    }

    transformRef.current = { scale: newScale, offset: newOffset };

    // Direct DOM update (No Transition)
    if (contentRef.current) {
        contentRef.current.style.transition = 'none';
        contentRef.current.style.transform = `translate(${newOffset.x}px, ${newOffset.y}px) scale(${newScale})`;
    }
    if (gridRef.current) {
        gridRef.current.style.transition = 'none';
        gridRef.current.style.backgroundPosition = `${newOffset.x}px ${newOffset.y}px`;
        gridRef.current.style.backgroundSize = `${24 * newScale}px ${24 * newScale}px`;
    }

    // Flag to ignore the incoming store update since we are already there
    ignoreNextUpdate.current = true;
    updateStoreTransform(transformRef.current);
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [updateStoreTransform]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 1 || toolMode === ToolMode.PAN) {
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    } else {
      onMouseDown?.(e);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    
    const newOffset = {
        x: transformRef.current.offset.x + dx,
        y: transformRef.current.offset.y + dy
    };

    transformRef.current = { ...transformRef.current, offset: newOffset };

    // Direct DOM update (No Transition)
    if (contentRef.current) {
        contentRef.current.style.transition = 'none';
        contentRef.current.style.transform = `translate(${newOffset.x}px, ${newOffset.y}px) scale(${transformRef.current.scale})`;
    }
    if (gridRef.current) {
        gridRef.current.style.transition = 'none';
        gridRef.current.style.backgroundPosition = `${newOffset.x}px ${newOffset.y}px`;
    }
    
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseUp = () => {
    if (isPanning) {
      setIsPanning(false);
      // Flag ignore, because store update will just confirm where we already are
      ignoreNextUpdate.current = true;
      setTransform(transformRef.current);
    }
  };

  return (
    <div 
      ref={containerRef}
      className={`w-full h-screen overflow-hidden bg-neutral-50/50 dark:bg-neutral-900 relative transition-colors duration-300
        ${toolMode === ToolMode.PAN ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
      `}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDoubleClick={onDoubleClick}
    >
      <div 
        ref={gridRef}
        className="absolute inset-0 pointer-events-none transition-opacity duration-300 will-change-transform"
        style={{
            backgroundImage: `radial-gradient(${palette.grid} 1.5px, transparent 1.5px)`, 
            backgroundSize: `${24 * transform.scale}px ${24 * transform.scale}px`,
            backgroundPosition: `${transform.offset.x}px ${transform.offset.y}px`,
            opacity: 0.8
        }} 
      />

      <div 
        ref={contentRef}
        className="absolute origin-top-left will-change-transform"
        // We explicitly do NOT set style here to avoid React overwriting our direct DOM manipulation
        // style={{ transform: ... }} 
      >
        {children}
      </div>
    </div>
  );
};
