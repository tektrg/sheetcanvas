import { snapdom } from '@zumer/snapdom';

/**
 * Shared "copy/download as image" capture for on-canvas nodes (sheets, charts, notes).
 *
 * Uses snapDOM instead of html2canvas. snapDOM serializes the target subtree into an
 * SVG <foreignObject> and lets the browser render it, so text layout is done by the real
 * layout engine. html2canvas reimplements text layout itself, which mis-positioned glyphs
 * (overlapping / out-of-order letters) whenever a node was captured while nested inside the
 * zoomable canvas wrapper's `transform: scale(...)`. snapDOM renders the cloned subtree at
 * its natural size, independent of any ancestor zoom, so exports are correct at every zoom
 * level. `embedFonts` inlines the app's web font (Inter) into the capture.
 */

export interface CaptureImageOptions {
  /** Background fill for the exported image. Omit for a transparent background. */
  backgroundColor?: string;
  /** Output resolution multiplier (retina crispness). Defaults to 2. */
  scale?: number;
  /**
   * Device-pixel-ratio override. Defaults to 1 so output is exactly
   * `naturalSize × scale` — matches the old html2canvas `scale: 2` output size,
   * keeps compositing math 1:1, and avoids scale×displayDPR blowing past browser
   * canvas limits on large sheets/retina displays.
   */
  dpr?: number;
}

const DEFAULT_CAPTURE_SCALE = 2;
const DEFAULT_CAPTURE_DPR = 1;
const TRANSPARENT_BACKGROUND = 'transparent';

/**
 * Elements tagged with this attribute are dropped from every export (`excludeMode: 'remove'`,
 * so they leave no gap). Use it for on-canvas chrome that should never appear in a copied/
 * downloaded image — hover toolbars, action menus, drag handles. Tag the outermost wrapper of
 * the chrome; children go with it.
 */
const EXPORT_EXCLUDE_SELECTOR = '[data-export-exclude]';

/**
 * Applied to the capture root for the duration of the capture. The global CSS rule in index.html
 * hides every scrollbar within so the exported image never bakes in scrollbar chrome, while the
 * content and its scroll position are preserved.
 */
const SCROLLBAR_HIDE_CLASS = 'exporting-hide-scrollbars';

/**
 * Neutralises the teal "selected" ring/border on the given root so a copied image never bakes
 * in the selection highlight — the sheet looks the same as when it isn't selected. Returns a
 * restore fn to undo the change; on the clone path the clone is discarded so the restore is
 * ignored, but on the live-capture path we call it in `finally` so the on-screen node is left
 * exactly as it was. Both light and dark neutral border classes are added (the `dark:` variant
 * only activates in dark mode, so adding both is safe regardless of theme).
 */
function stripSelectionRing(element: HTMLElement): () => void {
  const ringClasses = ['ring-1', 'ring-teal-400', 'shadow-md', 'z-50'];
  const removedRingClasses = ringClasses.filter((cls) => element.classList.contains(cls));
  removedRingClasses.forEach((cls) => element.classList.remove(cls));
  const hadTealBorder = element.classList.contains('border-teal-400');
  if (hadTealBorder) {
    element.classList.remove('border-teal-400');
    element.classList.add('border-neutral-200', 'dark:border-neutral-700');
  }
  return () => {
    removedRingClasses.forEach((cls) => element.classList.add(cls));
    if (hadTealBorder) {
      element.classList.add('border-teal-400');
      element.classList.remove('border-neutral-200', 'dark:border-neutral-700');
    }
  };
}

/**
 * A `transform: scale(...)` on the matrix reads as sqrt(a² + b²) for the X axis. We treat
 * anything within this tolerance of 1 as "no zoom" so the capture takes the simple live path.
 */
const SCALE_EPSILON = 0.01;

/** Read the uniform scale factor from a computed `transform` matrix (1 when none/identity). */
function readTransformScale(el: Element): number {
  const transform = getComputedStyle(el).transform;
  if (!transform || transform === 'none') return 1;
  const match = transform.match(/matrix\(([^)]+)\)/);
  if (!match) return 1;
  const [a, b] = match[1].split(',').map((n) => parseFloat(n));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.hypot(a, b);
}

/**
 * The on-canvas nodes live inside a wrapper that the canvas zooms via `transform: scale(...)`.
 * Walk up from the capture target and return the first ancestor whose transform is a non-1
 * scale — i.e. the zoom wrapper when the canvas is zoomed in/out. Returns null at 100% zoom
 * (or when the target isn't under a zoom wrapper at all).
 */
function findZoomedAncestor(element: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = element.parentElement;
  while (node && node !== document.body) {
    if (Math.abs(readTransformScale(node) - 1) > SCALE_EPSILON) return node;
    node = node.parentElement;
  }
  return null;
}

/**
 * cloneNode() does not carry over scroll positions or the live values of form controls, so a
 * cloned scroll container would render from the top instead of the currently-viewed window.
 * The clone is a structural copy of the source, so a document-order walk of both trees lines up
 * node-for-node — copy the runtime state across each matching pair.
 */
function copyLiveState(source: HTMLElement, clone: HTMLElement): void {
  const sourceNodes = [source, ...source.querySelectorAll<HTMLElement>('*')];
  const cloneNodes = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
  for (let i = 0; i < sourceNodes.length && i < cloneNodes.length; i++) {
    const src = sourceNodes[i];
    if (src.scrollTop) cloneNodes[i].scrollTop = src.scrollTop;
    if (src.scrollLeft) cloneNodes[i].scrollLeft = src.scrollLeft;
    if (src instanceof HTMLInputElement || src instanceof HTMLTextAreaElement) {
      (cloneNodes[i] as HTMLInputElement | HTMLTextAreaElement).value = src.value;
    }
  }
}

function snapdomOptions(options: CaptureImageOptions) {
  return {
    backgroundColor: options.backgroundColor ?? TRANSPARENT_BACKGROUND,
    scale: options.scale ?? DEFAULT_CAPTURE_SCALE,
    dpr: options.dpr ?? DEFAULT_CAPTURE_DPR,
    embedFonts: true,
    exclude: [EXPORT_EXCLUDE_SELECTOR],
    excludeMode: 'remove' as const,
  };
}

/**
 * Render a live DOM node to a canvas via snapDOM, after fonts are ready.
 *
 * snapDOM mis-renders a target that sits inside the canvas's zoom `transform: scale(...)`
 * wrapper: at zoom < 1 the captured content collapses in height and pins to the bottom of the
 * frame, so the image comes out cut off / shifted down — worse the further you zoom out. We
 * sidestep that by capturing a *clone* mounted just outside the zoom wrapper (but still inside
 * the themed app root, so dark-mode + font are inherited) where it lays out at natural 1:1 size
 * with no ancestor scale to trip snapDOM. Because it's a clone, the live canvas is never
 * touched — the fix produces the full image at every zoom level with zero visible UI shift.
 *
 * At 100% zoom there's no scale to correct, so we capture the live node directly (unchanged,
 * long-proven behaviour) and skip the clone entirely.
 */
export async function captureElementCanvas(
  element: HTMLElement,
  options: CaptureImageOptions = {}
): Promise<HTMLCanvasElement> {
  await document.fonts.ready;

  const zoomedAncestor = findZoomedAncestor(element);
  if (!zoomedAncestor || !zoomedAncestor.parentElement) {
    // Not zoomed (or no wrapper to escape): capture the live element in place, stripping the
    // selection ring for the capture and restoring it afterwards so the on-screen node is
    // unchanged.
    element.classList.add(SCROLLBAR_HIDE_CLASS);
    const restoreSelectionRing = stripSelectionRing(element);
    try {
      return await snapdom.toCanvas(element, snapdomOptions(options));
    } finally {
      element.classList.remove(SCROLLBAR_HIDE_CLASS);
      restoreSelectionRing();
    }
  }

  // Zoomed: capture a detached clone rendered at natural size, outside the zoom wrapper.
  const clone = element.cloneNode(true) as HTMLElement;
  clone.removeAttribute('id'); // avoid a transient duplicate id while the clone is mounted
  stripSelectionRing(clone); // clone is discarded, no restore needed
  clone.classList.add(SCROLLBAR_HIDE_CLASS);
  // Pin the clone to the live layout size so it lays out identically regardless of the mount
  // parent's own dimensions (widths defined relative to the zoom wrapper would otherwise shift).
  // `offsetWidth/Height` are border-box measurements, so force border-box sizing on the clone to
  // make the pin exact whatever the source node's own box-sizing is.
  clone.style.boxSizing = 'border-box';
  clone.style.width = `${element.offsetWidth}px`;
  clone.style.height = `${element.offsetHeight}px`;

  const holder = document.createElement('div');
  holder.setAttribute('aria-hidden', 'true');
  holder.style.cssText = 'position:absolute;left:-100000px;top:0;pointer-events:none;';
  holder.appendChild(clone);
  const mountParent = zoomedAncestor.parentElement;
  try {
    // Mount as a sibling of the zoom wrapper: guaranteed unscaled, yet still under the app root
    // that carries the `dark` class and `font-sans`, so theme + typography match the live node.
    mountParent.appendChild(holder);
    // Scroll offsets only "stick" once the clone is laid out in the DOM (setting scrollTop on a
    // detached node is a no-op), so copy live state *after* mounting — this preserves the sheet's
    // currently-viewed window rather than snapping back to the top.
    copyLiveState(element, clone);
    return await snapdom.toCanvas(clone, snapdomOptions(options));
  } finally {
    holder.remove();
  }
}

/** Capture the element and write it to the clipboard as a PNG. Throws on failure. */
export async function copyElementAsImage(
  element: HTMLElement,
  options: CaptureImageOptions = {}
): Promise<void> {
  const canvas = await captureElementCanvas(element, options);
  const blob = await canvasToPngBlob(canvas);
  if (!blob) throw new Error('Failed to encode image as PNG');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** Capture the element and trigger a PNG download. */
export async function downloadElementAsImage(
  element: HTMLElement,
  filename: string,
  options: CaptureImageOptions = {}
): Promise<void> {
  const canvas = await captureElementCanvas(element, options);
  const link = document.createElement('a');
  link.download = filename.toLowerCase().endsWith('.png') ? filename : `${filename}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
