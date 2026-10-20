// Close requests (Esc, backdrop, Cancel/X) for a dialog that saves to a server.
// While a save is in flight they are ignored, so its result or error is never
// lost behind a dialog that already closed.
export const createDismissGuard = (onClose: () => void) => {
  let busy = false;
  return {
    get busy() { return busy; },
    setBusy(value: boolean) { busy = value; },
    dismiss() { if (!busy) onClose(); },
    onKeyDown(e: Pick<KeyboardEvent, 'key'>) { if (e.key === 'Escape' && !busy) onClose(); },
  };
};
