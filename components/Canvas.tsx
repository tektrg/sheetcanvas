import React, { useRef, useState, useEffect } from 'react';
import { CanvasTransform, Position, ToolMode } from '../types';
import { MIN_SCALE, MAX_SCALE, COLOR_PALETTE } from '../constants';

interface CanvasProps {
  children: React.ReactNode;
  transform: CanvasTransform;
  setTransform: React.Dispatch<React.SetStateAction<CanvasTransform>>;
  darkMode: boolean;
  toolMode: ToolMode;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
}

export const Canvas: React.FC<CanvasProps> = ({ children, transform, setTransform, darkMode, toolMode, onDoubleClick, onMouseDown }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [lastMousePos, setLastMousePos] = useState<Position>({ x: 0, y: 0 });

  const palette = darkMode ? COLOR_PALETTE.dark : COLOR_PALETTE.light;

  const handleWheel = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const zoomIntensity = 0.001;
      const newScale = Math.min(Math.max(transform.scale - e.deltaY * zoomIntensity, MIN_SCALE), MAX_SCALE);
      
      setTransform(prev => ({
        ...prev,
        scale: newScale
      }));
    } else {
        e.preventDefault();
        setTransform(prev => ({
            ...prev,
            offset: {
                x: prev.offset.x - e.deltaX,
                y: prev.offset.y - e.deltaY
            }
        }));
    }
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [transform.scale]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Middle mouse always pans, or if in PAN mode
    if (e.button === 1 || toolMode === ToolMode.PAN) {
      setIsPanning(true);
      setLastMousePos({ x: e.clientX, y: e.clientY });
    } else {
      // Propagate to parent for selection box logic
      onMouseDown?.(e);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return;
    
    const dx = e.clientX - lastMousePos.x;
    const dy = e.clientY - lastMousePos.y;
    
    setTransform(prev => ({
      ...prev,
      offset: {
        x: prev.offset.x + dx,
        y: prev.offset.y + dy
      }
    }));
    
    setLastMousePos({ x: e.clientX, y: e.clientY });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
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
        className="absolute inset-0 pointer-events-none transition-opacity duration-300"
        style={{
            backgroundImage: `radial-gradient(${palette.grid} 1.5px, transparent 1.5px)`, 
            backgroundSize: `${24 * transform.scale}px ${24 * transform.scale}px`,
            backgroundPosition: `${transform.offset.x}px ${transform.offset.y}px`,
            opacity: 0.8
        }} 
      />

      <div 
        className="absolute origin-top-left will-change-transform"
        style={{
          transform: `translate(${transform.offset.x}px, ${transform.offset.y}px) scale(${transform.scale})`,
        }}
      >
        {children}
      </div>
    </div>
  );
};