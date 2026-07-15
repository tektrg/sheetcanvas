import React, { useLayoutEffect, useState } from 'react';

/**
 * PortalThemeScope
 *
 * Content rendered through `createPortal(..., document.body)` lands OUTSIDE the app's
 * root `.dark` wrapper (App.tsx toggles `dark` on the top-level div). As a result,
 * Tailwind `dark:` utility classes inside portaled menus/popovers never activate, so
 * they render in light mode even when the app is dark.
 *
 * Wrap portaled content in this component to re-establish the theme: it detects the
 * app's current theme and renders a `display: contents` box carrying the `.dark`
 * class, which becomes the `dark:` ancestor the portaled subtree needs. `display:
 * contents` keeps the wrapper visually inert (no extra box in the layout).
 */
export const PortalThemeScope: React.FC<{
  /** Optional anchor element; if inside a scoped `.dark` subtree, that wins over the document. */
  anchor?: HTMLElement | null;
  /** Explicit override; when provided, detection is skipped. */
  darkMode?: boolean;
  children: React.ReactNode;
}> = ({ anchor, darkMode, children }) => {
  const [isDark, setIsDark] = useState(false);

  useLayoutEffect(() => {
    if (typeof darkMode === 'boolean') {
      setIsDark(darkMode);
      return;
    }
    setIsDark(!!anchor?.closest('.dark') || !!document.querySelector('.dark'));
  }, [anchor, darkMode]);

  return (
    <div className={isDark ? 'dark' : ''} style={{ display: 'contents' }}>
      {children}
    </div>
  );
};
