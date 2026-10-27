import { describe, expect, it } from 'vitest';
import { trappedFocusIndex } from '../hooks/useModalFocus';

// Answer box / embed dialogs are aria-modal: Tab must cycle inside them.
describe('trappedFocusIndex', () => {
  it('wraps Tab from the last item to the first', () => expect(trappedFocusIndex(4, 5, false)).toBe(0));
  it('wraps Shift+Tab from the first item to the last', () => expect(trappedFocusIndex(0, 5, true)).toBe(4));
  it('lets the browser move focus between inner items', () => {
    expect(trappedFocusIndex(2, 5, false)).toBeNull();
    expect(trappedFocusIndex(2, 5, true)).toBeNull();
  });
  it('pulls focus back in when it is outside the dialog', () => {
    expect(trappedFocusIndex(-1, 5, false)).toBe(0);
    expect(trappedFocusIndex(-1, 5, true)).toBe(4);
  });
  it('does nothing for a dialog with no focusable items', () => expect(trappedFocusIndex(-1, 0, false)).toBeNull());
});
