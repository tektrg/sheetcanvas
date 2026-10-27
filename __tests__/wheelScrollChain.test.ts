// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { findWheelScrollTarget, isWheelMarkedForCanvasPan, markWheelForCanvasPan } from '../utils/wheelScrollChain';

const setBox = (el: HTMLElement, box: { scrollTop?: number; scrollHeight: number; clientHeight: number }) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: box.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: box.clientHeight });
  el.scrollTop = box.scrollTop ?? 0;
};

const buildCanvas = (overflowY: string) => {
  const canvas = document.createElement('div');
  const scroller = document.createElement('div');
  scroller.style.overflowY = overflowY;
  const leaf = document.createElement('p');
  scroller.appendChild(leaf);
  canvas.appendChild(scroller);
  document.body.appendChild(canvas);
  return { canvas, scroller, leaf };
};

describe('findWheelScrollTarget', () => {
  it('returns the overflowing ancestor while it can scroll in the wheel direction', () => {
    const { canvas, scroller, leaf } = buildCanvas('auto');
    setBox(scroller, { scrollTop: 100, scrollHeight: 1000, clientHeight: 400 });
    expect(findWheelScrollTarget(leaf, canvas, 0, 120)).toBe(scroller);
    expect(findWheelScrollTarget(leaf, canvas, 0, -120)).toBe(scroller);
  });

  it('chains to the board at the scroll edge in the wheel direction', () => {
    const { canvas, scroller, leaf } = buildCanvas('auto');
    setBox(scroller, { scrollTop: 600, scrollHeight: 1000, clientHeight: 400 });
    expect(findWheelScrollTarget(leaf, canvas, 0, 120)).toBeNull();
    expect(findWheelScrollTarget(leaf, canvas, 0, -120)).toBe(scroller);
    setBox(scroller, { scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
    expect(findWheelScrollTarget(leaf, canvas, 0, -120)).toBeNull();
  });

  it('ignores content that does not overflow or is not a scroll container', () => {
    const fits = buildCanvas('auto');
    setBox(fits.scroller, { scrollHeight: 400, clientHeight: 400 });
    expect(findWheelScrollTarget(fits.leaf, fits.canvas, 0, 120)).toBeNull();

    const clipped = buildCanvas('hidden');
    setBox(clipped.scroller, { scrollHeight: 1000, clientHeight: 400 });
    expect(findWheelScrollTarget(clipped.leaf, clipped.canvas, 0, 120)).toBeNull();
  });

  it('never looks at the boundary itself or beyond it', () => {
    const { canvas, leaf } = buildCanvas('visible');
    canvas.style.overflowY = 'auto';
    setBox(canvas, { scrollHeight: 1000, clientHeight: 400 });
    expect(findWheelScrollTarget(leaf, canvas, 0, 120)).toBeNull();
  });
});

describe('markWheelForCanvasPan', () => {
  it('flags only the marked event', () => {
    const marked = new Event('wheel');
    markWheelForCanvasPan(marked);
    expect(isWheelMarkedForCanvasPan(marked)).toBe(true);
    expect(isWheelMarkedForCanvasPan(new Event('wheel'))).toBe(false);
  });
});
