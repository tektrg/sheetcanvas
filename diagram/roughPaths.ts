// Strokes for the SVG preview via roughjs, generated exactly the way the
// Excalidraw editor generates them (@excalidraw/excalidraw 0.18 scene/Shape.ts:
// generateRoughOptions + _generateElementShape), so the canvas card and the
// editor draw the same pixels. Every shape goes through roughjs, roughness 0
// included: Excalidraw never draws "clean" SVG primitives.
// Loaded lazily; the preview draws clean geometry until it arrives.
import type { RoughGenerator } from 'roughjs/bin/generator';
import type { Options } from 'roughjs/bin/core';
import type { DiagramElement } from './types';

export type RoughPath = { d: string; stroke: string; strokeWidth: number; fill?: string };
type Point = [number, number];

let generator: RoughGenerator | null = null;
let loading: Promise<RoughGenerator> | null = null;

export const roughGenerator = () => generator;

export function loadRoughGenerator(): Promise<RoughGenerator> {
  loading ??= import('roughjs/bin/generator').then(({ RoughGenerator }) => (generator = new RoughGenerator()));
  return loading;
}

const ARROWHEAD = { length: 15, spread: Math.PI / 7 };
const PROPORTIONAL_RADIUS = 0.25;
const ADAPTIVE_RADIUS = 32;
const ROUNDNESS_ADAPTIVE = 3;
/** Excalidraw's LINE_CONFIRM_THRESHOLD: a line whose ends meet is a closed, fillable loop. */
const LOOP_THRESHOLD = 8;
const CARTOONIST = 2;

const isLinear = (el: DiagramElement) => el.type === 'line' || el.type === 'arrow';
const isTransparent = (color?: string) => !color || color === 'transparent';

/** Excalidraw's adjustRoughness: small shapes are drawn calmer. */
export function adjustRoughness(el: DiagramElement): number {
  const max = Math.max(el.width, el.height);
  const min = Math.min(el.width, el.height);
  const roundable = el.type === 'rectangle' || el.type === 'diamond' || isLinear(el);
  if ((min >= 20 && max >= 50) || (min >= 15 && !!el.roundness && roundable) || (isLinear(el) && max >= 50)) return el.roughness;
  return Math.min(el.roughness / (max < 10 ? 3 : 2), 2.5);
}

export function isLoop(points: Point[] | undefined): boolean {
  if (!points || points.length < 3) return false;
  const [a, b] = [points[0], points[points.length - 1]];
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= LOOP_THRESHOLD;
}

/** Excalidraw's generateRoughOptions. */
function optionsFor(el: DiagramElement, continuousPath = false): Options {
  const solid = el.strokeStyle !== 'dashed' && el.strokeStyle !== 'dotted';
  const options: Options = {
    seed: el.seed,
    strokeLineDash: el.strokeStyle === 'dashed' ? [8, 8 + el.strokeWidth] : el.strokeStyle === 'dotted' ? [1.5, 6 + el.strokeWidth] : undefined,
    disableMultiStroke: !solid,
    strokeWidth: solid ? el.strokeWidth : el.strokeWidth + 0.5,
    fillWeight: el.strokeWidth / 2,
    hachureGap: el.strokeWidth * 4,
    roughness: adjustRoughness(el),
    stroke: el.strokeColor,
    preserveVertices: continuousPath || el.roughness < CARTOONIST,
  };
  const filled = el.type === 'rectangle' || el.type === 'diamond' || el.type === 'ellipse' || (el.type === 'line' && isLoop(el.points as Point[]));
  if (filled) {
    options.fillStyle = el.fillStyle;
    options.fill = isTransparent(el.backgroundColor) ? undefined : el.backgroundColor;
  }
  if (el.type === 'ellipse') options.curveFitting = 1;
  return options;
}

/** Excalidraw's getCornerRadius. */
function cornerRadius(x: number, el: DiagramElement): number {
  const roundness = el.roundness as { type?: number; value?: number } | null | undefined;
  if (!roundness) return 0;
  if (roundness.type !== ROUNDNESS_ADAPTIVE) return x * PROPORTIONAL_RADIUS;
  const fixed = roundness.value ?? ADAPTIVE_RADIUS;
  return x <= fixed / PROPORTIONAL_RADIUS ? x * PROPORTIONAL_RADIUS : fixed;
}

function arrowhead(gen: RoughGenerator, tip: Point, from: Point, options: Options) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (sign: number): Point => [
    tip[0] - ARROWHEAD.length * Math.cos(angle + sign * ARROWHEAD.spread),
    tip[1] - ARROWHEAD.length * Math.sin(angle + sign * ARROWHEAD.spread),
  ];
  return gen.linearPath([wing(1), tip, wing(-1)], { ...options, fill: undefined });
}

/**
 * Rough SVG paths for one shape/line element in element-local coordinates
 * (origin = el.x, el.y — translate when drawing, as Excalidraw does), or null
 * for elements roughjs does not draw (text, freedraw).
 */
export function roughPaths(gen: RoughGenerator, el: DiagramElement): RoughPath[] | null {
  const { width: w, height: h } = el;
  const drawables = [];
  switch (el.type) {
    case 'rectangle': {
      if (el.roundness) {
        const r = cornerRadius(Math.min(w, h), el);
        drawables.push(gen.path(`M ${r} 0 L ${w - r} 0 Q ${w} 0, ${w} ${r} L ${w} ${h - r} Q ${w} ${h}, ${w - r} ${h} L ${r} ${h} Q 0 ${h}, 0 ${h - r} L 0 ${r} Q 0 0, ${r} 0`, optionsFor(el, true)));
      } else {
        drawables.push(gen.rectangle(0, 0, w, h, optionsFor(el)));
      }
      break;
    }
    case 'ellipse':
      drawables.push(gen.ellipse(w / 2, h / 2, w, h, optionsFor(el)));
      break;
    case 'diamond':
      drawables.push(gen.polygon([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], optionsFor(el)));
      break;
    case 'line':
    case 'arrow': {
      const pts = (el.points ?? []) as Point[];
      if (pts.length < 2) return null;
      const options = optionsFor(el);
      if (el.roundness) drawables.push(gen.curve(pts, options));
      else if (options.fill) drawables.push(gen.polygon(pts, options));
      else drawables.push(gen.linearPath(pts, options));
      if (el.type === 'arrow' && el.endArrowhead) drawables.push(arrowhead(gen, pts[pts.length - 1], pts[pts.length - 2], options));
      if (el.type === 'arrow' && el.startArrowhead) drawables.push(arrowhead(gen, pts[0], pts[1], options));
      break;
    }
    default:
      return null;
  }
  return drawables.flatMap((d) => gen.toPaths(d));
}
