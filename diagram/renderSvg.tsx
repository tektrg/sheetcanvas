// Lightweight SVG preview of an Excalidraw scene (no Excalidraw runtime).
// Draws clean (non-sketchy) shapes so canvas previews stay cheap.
import React from 'react';
import type { DiagramElement } from './types';

const PADDING = 16;
const PREVIEW_FONT = 'Virgil, "Segoe Print", "Comic Sans MS", system-ui, sans-serif';

type Point = { x: number; y: number };

const absolutePoints = (el: DiagramElement): Point[] =>
  (el.points ?? [[0, 0]]).map(([px, py]) => ({ x: el.x + px, y: el.y + py }));

export function sceneBounds(elements: DiagramElement[]) {
  const live = elements.filter((el) => !el.isDeleted);
  if (live.length === 0) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of live) {
    const pts = el.points ? absolutePoints(el) : [{ x: el.x, y: el.y }, { x: el.x + el.width, y: el.y + el.height }];
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

/** Smooth path through points (Catmull-Rom -> cubic Bezier). */
export function smoothPath(points: Point[]): string {
  if (points.length < 3) return points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
  let d = `M${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
  }
  return d;
}

function textAnchorPoint(el: DiagramElement, byId: Map<string, DiagramElement>): Point & { anchor: 'start' | 'middle' | 'end' } {
  const container = el.containerId ? byId.get(el.containerId) : undefined;
  if (container) {
    if (container.points) {
      const pts = absolutePoints(container);
      const mid = pts[Math.floor((pts.length - 1) / 2)];
      const next = pts[Math.ceil((pts.length - 1) / 2)];
      return { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2, anchor: 'middle' };
    }
    return { x: container.x + container.width / 2, y: container.y + container.height / 2, anchor: 'middle' };
  }
  if (el.textAlign === 'center') return { x: el.x + el.width / 2, y: el.y + el.height / 2, anchor: 'middle' };
  if (el.textAlign === 'right') return { x: el.x + el.width, y: el.y + el.height / 2, anchor: 'end' };
  return { x: el.x, y: el.y + el.height / 2, anchor: 'start' };
}

function renderText(el: DiagramElement, byId: Map<string, DiagramElement>) {
  const fontSize = el.fontSize ?? 16;
  const lineHeight = fontSize * (el.lineHeight ?? 1.25);
  const lines = (el.text ?? '').split('\n');
  const at = textAnchorPoint(el, byId);
  const firstLineY = at.y - ((lines.length - 1) * lineHeight) / 2;
  return (
    <text
      key={el.id}
      x={at.x}
      fontSize={fontSize}
      fontFamily={PREVIEW_FONT}
      fill={el.strokeColor}
      textAnchor={at.anchor}
      dominantBaseline="central"
      opacity={el.opacity / 100}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={at.x} y={firstLineY + i * lineHeight}>{line}</tspan>
      ))}
    </text>
  );
}

function renderElement(el: DiagramElement, byId: Map<string, DiagramElement>) {
  const common = {
    stroke: el.strokeColor,
    strokeWidth: el.strokeWidth,
    strokeDasharray: el.strokeStyle === 'dashed' ? '8 6' : el.strokeStyle === 'dotted' ? '2 4' : undefined,
    opacity: el.opacity / 100,
  };
  const fill = el.backgroundColor === 'transparent' ? 'none' : el.backgroundColor;
  switch (el.type) {
    case 'rectangle': {
      const radius = el.roundness ? Math.min(16, Math.min(el.width, el.height) * 0.25) : 0;
      return <rect key={el.id} x={el.x} y={el.y} width={el.width} height={el.height} rx={radius} fill={fill} {...common} />;
    }
    case 'ellipse':
      return <ellipse key={el.id} cx={el.x + el.width / 2} cy={el.y + el.height / 2} rx={el.width / 2} ry={el.height / 2} fill={fill} {...common} />;
    case 'diamond': {
      const cx = el.x + el.width / 2;
      const cy = el.y + el.height / 2;
      const pts = `${cx},${el.y} ${el.x + el.width},${cy} ${cx},${el.y + el.height} ${el.x},${cy}`;
      return <polygon key={el.id} points={pts} fill={fill} {...common} />;
    }
    case 'line':
    case 'arrow': {
      const pts = absolutePoints(el);
      const d = el.roundness ? smoothPath(pts) : pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
      return (
        <path
          key={el.id}
          d={d}
          fill="none"
          strokeLinecap="round"
          markerEnd={el.endArrowhead ? 'url(#diagram-arrowhead)' : undefined}
          markerStart={el.startArrowhead ? 'url(#diagram-arrowhead-start)' : undefined}
          {...common}
        />
      );
    }
    case 'freedraw':
      return <path key={el.id} d={smoothPath(absolutePoints(el))} fill="none" strokeLinecap="round" strokeLinejoin="round" {...common} />;
    case 'text':
      return renderText(el, byId);
    default:
      return null;
  }
}

interface DiagramSvgProps {
  elements: DiagramElement[];
  background?: string;
  className?: string;
}

export const DiagramSvg: React.FC<DiagramSvgProps> = ({ elements, background, className }) => {
  const live = elements.filter((el) => !el.isDeleted);
  const byId = new Map<string, DiagramElement>(live.map((el) => [el.id, el]));
  const bounds = sceneBounds(live);
  const viewBox = [bounds.x - PADDING, bounds.y - PADDING, bounds.width + PADDING * 2, bounds.height + PADDING * 2].join(' ');
  return (
    <svg className={className} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" role="img">
      <defs>
        {(['diagram-arrowhead', 'diagram-arrowhead-start'] as const).map((id) => (
          <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient={id.endsWith('start') ? 'auto-start-reverse' : 'auto'}>
            <path d="M0 0 L10 5 L0 10" fill="none" stroke="context-stroke" strokeWidth="1.5" />
          </marker>
        ))}
      </defs>
      {background && background !== 'transparent' && (
        <rect x={bounds.x - PADDING} y={bounds.y - PADDING} width={bounds.width + PADDING * 2} height={bounds.height + PADDING * 2} fill={background} />
      )}
      {live.map((el) => renderElement(el, byId))}
    </svg>
  );
};
