// Hand-drawn strokes for the SVG preview via roughjs (the library Excalidraw
// draws with). Seeded by element.seed so a scene never jitters between renders.
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

/** Options mirroring Excalidraw's own (generateRoughOptions): seeded, dashed = single stroke. */
function optionsFor(el: DiagramElement): Options {
  const dashed = el.strokeStyle === 'dashed' || el.strokeStyle === 'dotted';
  const fill = el.backgroundColor && el.backgroundColor !== 'transparent' ? el.backgroundColor : undefined;
  return {
    seed: el.seed,
    roughness: el.roughness,
    strokeWidth: el.strokeWidth,
    stroke: el.strokeColor,
    fill,
    fillStyle: el.fillStyle === 'hachure' || el.fillStyle === 'cross-hatch' ? el.fillStyle : 'solid',
    fillWeight: el.strokeWidth / 2,
    hachureGap: el.strokeWidth * 4,
    disableMultiStroke: dashed,
    strokeLineDash: el.strokeStyle === 'dashed' ? [8, 8 + el.strokeWidth] : el.strokeStyle === 'dotted' ? [1.5, 6 + el.strokeWidth] : undefined,
    preserveVertices: el.roughness < 2,
    bowing: 1,
  };
}

function arrowhead(gen: RoughGenerator, tip: Point, from: Point, options: Options) {
  const angle = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const wing = (sign: number): Point => [
    tip[0] - ARROWHEAD.length * Math.cos(angle + sign * ARROWHEAD.spread),
    tip[1] - ARROWHEAD.length * Math.sin(angle + sign * ARROWHEAD.spread),
  ];
  return gen.linearPath([wing(1), tip, wing(-1)], { ...options, fill: undefined });
}

/** Rough SVG paths for one shape/line element, or null to draw it the clean way (text, freedraw, roughness 0). */
export function roughPaths(gen: RoughGenerator, el: DiagramElement): RoughPath[] | null {
  if (!el.roughness) return null;
  const options = optionsFor(el);
  const drawables = [];
  switch (el.type) {
    case 'rectangle':
      drawables.push(gen.rectangle(el.x, el.y, el.width, el.height, options));
      break;
    case 'ellipse':
      drawables.push(gen.ellipse(el.x + el.width / 2, el.y + el.height / 2, el.width, el.height, { ...options, curveFitting: 1 }));
      break;
    case 'diamond': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      drawables.push(gen.polygon([[cx, el.y], [el.x + el.width, cy], [cx, el.y + el.height], [el.x, cy]], options));
      break;
    }
    case 'line':
    case 'arrow': {
      const pts = (el.points ?? []).map(([px, py]): Point => [el.x + px, el.y + py]);
      if (pts.length < 2) return null;
      const lineOptions = { ...options, fill: undefined };
      drawables.push(el.roundness && pts.length > 2 ? gen.curve(pts, lineOptions) : gen.linearPath(pts, lineOptions));
      if (el.endArrowhead) drawables.push(arrowhead(gen, pts[pts.length - 1], pts[pts.length - 2], options));
      if (el.startArrowhead) drawables.push(arrowhead(gen, pts[0], pts[1], options));
      break;
    }
    default:
      return null;
  }
  return drawables.flatMap((d) => gen.toPaths(d));
}
