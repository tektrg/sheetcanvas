import React, { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const HeaderDropdownMenu: React.FC<{
  anchorRef: React.RefObject<HTMLElement>;
  isOpen: boolean;
  onClose: () => void;
  width?: number;
  children: React.ReactNode;
}> = ({ anchorRef, isOpen, onClose, width = 160, children }) => {
  const [position, setPosition] = useState<React.CSSProperties | null>(null);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const viewportPadding = 8;
      const maxLeft = Math.max(viewportPadding, window.innerWidth - width - viewportPadding);
      const left = Math.min(Math.max(rect.right - width, viewportPadding), maxLeft);
      const top = Math.min(rect.bottom + 4, window.innerHeight - viewportPadding);
      setPosition({ position: 'fixed', top, left, width, zIndex: 1000 });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, anchorRef, width]);

  if (!isOpen) return null;

  return createPortal(
    <>
      <div className="fixed inset-0 z-[999]" onMouseDown={onClose} />
      <div
        className="bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-lg shadow-xl flex flex-col py-1"
        style={position ?? { position: 'fixed', top: 0, left: 0, width, zIndex: 1000 }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </>,
    document.body
  );
};
