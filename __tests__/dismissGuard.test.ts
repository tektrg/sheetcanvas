import { describe, expect, it, vi } from 'vitest';
import { createDismissGuard } from '../components/account/dismissGuard';

describe('handle picker dismiss guard', () => {
  it('Esc and dismiss close the dialog when idle', () => {
    const onClose = vi.fn();
    const guard = createDismissGuard(onClose);
    guard.onKeyDown({ key: 'Escape' });
    guard.dismiss();
    guard.onKeyDown({ key: 'Enter' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('ignores Esc and dismiss while a save is in flight, then allows them again', () => {
    const onClose = vi.fn();
    const guard = createDismissGuard(onClose);
    guard.setBusy(true);
    guard.onKeyDown({ key: 'Escape' });
    guard.dismiss();
    expect(onClose).not.toHaveBeenCalled();
    guard.setBusy(false);
    guard.onKeyDown({ key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
