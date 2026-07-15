import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * SettingsPopover
 *
 * A portaled floating panel for node configuration UIs (charts, pivots, sparklines).
 * Rendered to document.body so it escapes the canvas zoom/pan transform and the
 * node's `overflow-hidden`, meaning it is never clamped by the node's on-screen size.
 *
 * Positioning: opens BESIDE the anchored node (to the right by default, flipping to
 * the left when there isn't room) so the node itself stays fully visible for live
 * preview while editing. Only overlaps the node as a last resort when neither side fits.
 *
 * Dismissal: Esc and outside-click close the popover, but ONLY when
 * `dismissOnOutsideClick` is true. Setup flows pass `false` so an accidental outside
 * click can't cancel/destroy a half-configured node — the user must use the panel's
 * own Create/Cancel buttons.
 */
export const SettingsPopover: React.FC<{
  /** Ref to the node's outer element; the popover positions itself beside this. */
  anchorRef: React.RefObject<HTMLElement>;
  isOpen: boolean;
  onClose: () => void;
  /** When false, Esc and outside-clicks are ignored (used for setup flows). */
  dismissOnOutsideClick?: boolean;
  width?: number;
  /**
   * Explicit dark-mode flag. If omitted, the popover infers the theme from its
   * anchor node. This is required because the popover portals to document.body,
   * OUTSIDE the app's `.dark` wrapper, so `dark:` classes wouldn't otherwise apply.
   */
  darkMode?: boolean;
  children: React.ReactNode;
}> = ({ anchorRef, isOpen, onClose, dismissOnOutsideClick = true, width = 300, darkMode, children }) => {
  const [style, setStyle] = useState<React.CSSProperties | null>(null);
  const [isDark, setIsDark] = useState(false);

  const requestClose = useCallback(() => {
    if (dismissOnOutsideClick) onClose();
  }, [dismissOnOutsideClick, onClose]);

  useLayoutEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const pad = 8;
      const gap = 12;

      // Height: comfortable, bounded by viewport so the panel's internal scroll kicks in.
      const height = Math.min(
        Math.max(rect.height, 460),
        window.innerHeight - pad * 2
      );

      // Vertically align to the node's top, clamped into the viewport.
      const top = Math.min(
        Math.max(rect.top, pad),
        Math.max(pad, window.innerHeight - height - pad)
      );

      // Prefer the right side; flip left if it doesn't fit; overlap only if neither fits.
      const spaceRight = window.innerWidth - rect.right - gap;
      const spaceLeft = rect.left - gap;
      let left: number;
      if (spaceRight >= width + pad) {
        left = rect.right + gap;
      } else if (spaceLeft >= width + pad) {
        left = rect.left - gap - width;
      } else if (spaceRight >= spaceLeft) {
        left = Math.max(pad, window.innerWidth - width - pad);
      } else {
        left = pad;
      }

      setStyle({ position: 'fixed', top, left, width, height, zIndex: 1000 });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, anchorRef, width]);

  // Resolve theme: explicit prop wins, otherwise detect from the anchor's ancestry
  // (the anchored node lives inside the app's `.dark` wrapper).
  useLayoutEffect(() => {
    if (!isOpen) return;
    if (typeof darkMode === 'boolean') {
      setIsDark(darkMode);
      return;
    }
    const detected =
      !!anchorRef.current?.closest('.dark') || !!document.querySelector('.dark');
    setIsDark(detected);
  }, [isOpen, darkMode, anchorRef]);

  useEffect(() => {
    if (!isOpen || !dismissOnOutsideClick) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, dismissOnOutsideClick, onClose]);

  if (!isOpen) return null;

  return createPortal(
    // `display: contents` keeps this an inert box while still acting as the `.dark`
    // ancestor the portaled `dark:` classes need (the portal escapes the app wrapper).
    <div className={isDark ? 'dark' : ''} style={{ display: 'contents' }}>
      {/* Backdrop: transparent, only intercepts outside clicks when dismissible. */}
      <div
        className="fixed inset-0 z-[999]"
        style={dismissOnOutsideClick ? undefined : { pointerEvents: 'none' }}
        onMouseDown={requestClose}
      />
      <div
        className="bg-white dark:bg-neutral-850 text-neutral-800 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 rounded-xl shadow-2xl flex flex-col overflow-hidden"
        style={style ?? { position: 'fixed', top: 0, left: 0, width, zIndex: 1000 }}
        onMouseDown={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};
