import { useEffect, useRef, type RefObject } from 'react';

// Keyboard contract for small modal dialogs: initial focus, Esc closes, Tab and
// Shift+Tab cycle inside the dialog (aria-modal), focus goes back to the opener.

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Index Tab should move to, or null to let the browser move focus normally. */
export const trappedFocusIndex = (currentIndex: number, count: number, shiftKey: boolean): number | null => {
  if (count === 0) return null;
  if (currentIndex === -1) return shiftKey ? count - 1 : 0;
  if (shiftKey && currentIndex === 0) return count - 1;
  if (!shiftKey && currentIndex === count - 1) return 0;
  return null;
};

export const useModalFocus = (dialogRef: RefObject<HTMLElement | null>, onClose: () => void, initialSelector: string) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(initialSelector)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onCloseRef.current(); return; }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const next = trappedFocusIndex(items.indexOf(document.activeElement as HTMLElement), items.length, event.shiftKey);
      if (next === null) return;
      event.preventDefault();
      items[next].focus();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus();
    };
    // Mount-only: re-running would steal focus back to the initial field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
};
