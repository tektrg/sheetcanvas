import { graphlib, layout } from '@dagrejs/dagre';

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_SEP = 40;
const RANK_SEP = 70;

/** Layered graph layout (dagre). Returns top-left boxes keyed by node id. */
export function layoutGraph(
  nodes: LayoutNode[],
  edges: { from: string; to: string }[],
  direction: 'TB' | 'LR' = 'TB',
): Record<string, Box> {
  const graph = new graphlib.Graph();
  graph.setGraph({ rankdir: direction, nodesep: NODE_SEP, ranksep: RANK_SEP, marginx: 0, marginy: 0 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: node.width, height: node.height });
  for (const edge of edges) graph.setEdge(edge.from, edge.to);
  layout(graph);

  const boxes: Record<string, Box> = {};
  for (const node of nodes) {
    const placed = graph.node(node.id) as { x: number; y: number };
    boxes[node.id] = {
      x: Math.round(placed.x - node.width / 2),
      y: Math.round(placed.y - node.height / 2),
      width: node.width,
      height: node.height,
    };
  }
  return boxes;
}

export const CURVE_PLOT = { width: 560, height: 280 };

/** Maps data-space points into a plot box (y grows up in data, down on screen). */
export function createCurveScale(points: { x: number; y: number }[], plot = CURVE_PLOT) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return {
    toScreen: (p: { x: number; y: number }) => ({
      x: Math.round(((p.x - minX) / spanX) * plot.width),
      y: Math.round(plot.height - ((p.y - minY) / spanY) * plot.height),
    }),
    /** Linear interpolation of the curve's y at data x. */
    yAt: (x: number) => {
      const sorted = [...points].sort((a, b) => a.x - b.x);
      if (x <= sorted[0].x) return sorted[0].y;
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        if (x <= b.x) return a.y + ((x - a.x) / (b.x - a.x || 1)) * (b.y - a.y);
      }
      return sorted[sorted.length - 1].y;
    },
    plot,
  };
}
