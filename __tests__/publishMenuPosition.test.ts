import { describe, expect, it } from 'vitest';
import { anchorInViewport, publishPanelPosition } from '../components/publish/PublishMenu';

// The publish panel is portaled to <body> (fixed) so embedded charts in the note
// cannot cover it; this pins where it lands relative to its globe button.
describe('publishPanelPosition', () => {
  const rect = { left: 500, right: 520, top: 80, bottom: 100 };
  it('right-aligns under the button', () => {
    expect(publishPanelPosition(rect, 'right', 1200)).toMatchObject({ top: 104, left: 520 - 288 });
  });
  it('left-aligns under the button', () => {
    expect(publishPanelPosition(rect, 'left', 1200)).toMatchObject({ top: 104, left: 500 });
  });
  it('stays inside the viewport horizontally', () => {
    expect(publishPanelPosition({ left: 2, right: 20, top: 0, bottom: 10 }, 'right', 1200).left).toBe(8);
    expect(publishPanelPosition({ left: 1100, right: 1120, top: 0, bottom: 10 }, 'left', 1200).left).toBe(1200 - 288 - 8);
  });
  it('flips above the button near the bottom edge', () => {
    const nearBottom = { left: 500, right: 520, top: 700, bottom: 720 };
    const pos = publishPanelPosition(nearBottom, 'right', 1200, 800, 300);
    expect(pos.top).toBe(700 - 4 - 300);
    expect(pos.top + 300).toBeLessThanOrEqual(800);
  });
  it('caps height (panel scrolls) when neither side fits', () => {
    const pos = publishPanelPosition({ left: 0, right: 20, top: 150, bottom: 170 }, 'left', 375, 400, 600);
    expect(pos.top).toBe(174);
    expect(pos.top + pos.maxHeight).toBeLessThanOrEqual(400 - 8);
  });
});

describe('anchorInViewport', () => {
  it('is false once the canvas pans the button off screen', () => {
    expect(anchorInViewport({ left: 561, right: 583, top: -475, bottom: -453 }, 1280, 800)).toBe(false);
    expect(anchorInViewport({ left: 1300, right: 1322, top: 10, bottom: 32 }, 1280, 800)).toBe(false);
    expect(anchorInViewport({ left: 561, right: 583, top: 125, bottom: 147 }, 1280, 800)).toBe(true);
  });
});
