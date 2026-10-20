import { describe, expect, it } from 'vitest';
import { publishPanelPosition } from '../components/publish/PublishMenu';

// The publish panel is portaled to <body> (fixed) so embedded charts in the note
// cannot cover it; this pins where it lands relative to its globe button.
describe('publishPanelPosition', () => {
  const rect = { left: 500, right: 520, bottom: 100 };
  it('right-aligns under the button', () => {
    expect(publishPanelPosition(rect, 'right', 1200)).toEqual({ top: 104, left: 520 - 288 });
  });
  it('left-aligns under the button', () => {
    expect(publishPanelPosition(rect, 'left', 1200)).toEqual({ top: 104, left: 500 });
  });
  it('stays inside the viewport', () => {
    expect(publishPanelPosition({ left: 2, right: 20, bottom: 10 }, 'right', 1200).left).toBe(8);
    expect(publishPanelPosition({ left: 1100, right: 1120, bottom: 10 }, 'left', 1200).left).toBe(1200 - 288 - 8);
  });
});
