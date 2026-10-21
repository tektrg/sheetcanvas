const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;
// Sub-pixel layouts can leave scrollTop a fraction short of the true end.
const EDGE_TOLERANCE_PX = 1;

const canScrollAxis = (
  delta: number,
  overflow: string,
  scrollPos: number,
  scrollSize: number,
  clientSize: number
): boolean => {
  if (delta === 0 || !SCROLLABLE_OVERFLOW.test(overflow) || scrollSize <= clientSize) return false;
  return delta > 0
    ? scrollPos + clientSize < scrollSize - EDGE_TOLERANCE_PX
    : scrollPos > EDGE_TOLERANCE_PX;
};

/**
 * Walks from the wheel target up to (not including) `boundary` and returns the first
 * element that can still scroll in the wheel's direction. When one exists the canvas
 * should let the browser scroll it natively; otherwise the wheel pans the board
 * (scroll chaining: a card at its scroll edge, or without overflow, hands off to the board).
 */
export const findWheelScrollTarget = (
  target: EventTarget | null,
  boundary: Element,
  deltaX: number,
  deltaY: number
): Element | null => {
  let el = target instanceof Element ? target : null;
  while (el && el !== boundary) {
    const style = getComputedStyle(el);
    if (
      canScrollAxis(deltaY, style.overflowY, el.scrollTop, el.scrollHeight, el.clientHeight) ||
      canScrollAxis(deltaX, style.overflowX, el.scrollLeft, el.scrollWidth, el.clientWidth)
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
};

// Wheels a card has claimed for the board (e.g. a sheet zoomed out past its scroll
// passthrough scale) pan the canvas even when the target could scroll.
const wheelsForCanvasPan = new WeakSet<Event>();

export const markWheelForCanvasPan = (e: Event) => {
  wheelsForCanvasPan.add(e);
};

export const isWheelMarkedForCanvasPan = (e: Event) => wheelsForCanvasPan.has(e);
