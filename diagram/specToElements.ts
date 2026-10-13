// Converts a semantic spec (org chart / flow / curve) into Excalidraw elements
// with semantic ids in customData. Text sits inside its shape via
// containerId <-> boundElements; arrows bind to the nodes they connect.
import type { CurveSpec, DiagramElement, DiagramSpec, FlowShape, FlowSpec, OrgchartSpec } from './types';
import { addBoundElement, centerOf, createLinear, createShape, createText, measureText, wrapLabel } from './elementFactory';
import { createCurveScale, layoutGraph, type Box } from './layout';
import { resolveColor } from './colors';
import { freeformToElements, shapesToElements } from './freeform';
import { comicToShapes } from './comic/compile';

export const nodeId = (id: string) => `node:${id}`;
export const edgeId = (from: string, to: string) => `edge:${from}->${to}`;
export const labelId = (ownerId: string) => `${ownerId}:label`;

const NODE_MIN = { width: 140, height: 60 };
const NODE_PADDING = { x: 28, y: 20 };

function nodeSize(label: string) {
  const text = measureText(wrapLabel(label));
  return {
    width: Math.max(NODE_MIN.width, text.width + NODE_PADDING.x * 2),
    height: Math.max(NODE_MIN.height, text.height + NODE_PADDING.y * 2),
  };
}

const SHAPE_TYPE: Record<FlowShape, 'rectangle' | 'diamond' | 'ellipse'> = {
  rect: 'rectangle',
  diamond: 'diamond',
  ellipse: 'ellipse',
};

interface GraphNode {
  id: string;
  label: string;
  shape: FlowShape;
  color?: string;
}

/** Border point of `box` facing `toward`, along the layout direction. */
function anchor(box: Box, toward: Box, direction: 'TB' | 'LR') {
  const c = centerOf(box);
  const t = centerOf(toward);
  if (direction === 'TB') return { x: c.x, y: t.y >= c.y ? box.y + box.height : box.y };
  return { x: t.x >= c.x ? box.x + box.width : box.x, y: c.y };
}

const BACK_EDGE_OFFSET = 40;

/**
 * Forward edges go straight between facing borders. Back edges (pointing
 * against the layout direction or within a rank) loop around the side so they
 * never overlap a forward edge between the same nodes.
 */
function edgePoints(from: Box, to: Box, direction: 'TB' | 'LR') {
  const f = centerOf(from);
  const t = centerOf(to);
  const isBack = direction === 'TB' ? t.y <= f.y : t.x <= f.x;
  if (!isBack) return { points: [anchor(from, to, direction), anchor(to, from, direction)], curved: false };
  if (direction === 'TB') {
    const sideX = Math.max(from.x + from.width, to.x + to.width) + BACK_EDGE_OFFSET;
    return {
      points: [{ x: from.x + from.width, y: f.y }, { x: sideX, y: (f.y + t.y) / 2 }, { x: to.x + to.width, y: t.y }],
      curved: true,
    };
  }
  const sideY = Math.max(from.y + from.height, to.y + to.height) + BACK_EDGE_OFFSET;
  return {
    points: [{ x: f.x, y: from.y + from.height }, { x: (f.x + t.x) / 2, y: sideY }, { x: t.x, y: to.y + to.height }],
    curved: true,
  };
}

function buildGraph(
  nodes: GraphNode[],
  edges: { from: string; to: string; label?: string }[],
  direction: 'TB' | 'LR',
): DiagramElement[] {
  const boxes = layoutGraph(
    nodes.map((n) => ({ id: n.id, ...nodeSize(n.label) })),
    edges,
    direction,
  );
  const shapes = new Map<string, DiagramElement>();
  const elements: DiagramElement[] = [];

  for (const node of nodes) {
    const shape = createShape(nodeId(node.id), SHAPE_TYPE[node.shape], boxes[node.id], node.color ? resolveColor(node.color) : 'transparent');
    const text = createText(labelId(shape.id), node.label, centerOf(shape), shape.id);
    addBoundElement(shape, text);
    shapes.set(node.id, shape);
    elements.push(shape, text);
  }

  for (const edge of edges) {
    const from = shapes.get(edge.from);
    const to = shapes.get(edge.to);
    if (!from || !to) continue;
    const route = edgePoints(from, to, direction);
    const arrow = createLinear(edgeId(edge.from, edge.to), 'arrow', route.points, {
      fromId: from.id,
      toId: to.id,
      curved: route.curved,
    });
    addBoundElement(from, arrow);
    addBoundElement(to, arrow);
    elements.push(arrow);
    if (edge.label) {
      const labelAt = route.points[Math.floor(route.points.length / 2)];
      const middle = route.points.length === 2
        ? { x: (route.points[0].x + route.points[1].x) / 2, y: (route.points[0].y + route.points[1].y) / 2 }
        : labelAt;
      const text = createText(labelId(arrow.id), edge.label, middle, arrow.id);
      addBoundElement(arrow, text);
      elements.push(text);
    }
  }
  return elements;
}

function assertUniqueIds(ids: string[], what: string) {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`Duplicate ${what} id: ${id}`);
    seen.add(id);
  }
}

function assertKnown(ids: Set<string>, id: string, field: string) {
  if (!ids.has(id)) throw new Error(`${field} refers to unknown node id: ${id}`);
}

/** Throws naming the first parentId cycle, e.g. "a -> b -> a". */
function assertNoParentCycle(nodes: OrgchartSpec['nodes']) {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  for (const node of nodes) {
    const path = [node.id];
    let current = parentOf.get(node.id);
    while (current !== undefined) {
      const at = path.indexOf(current);
      if (at !== -1) throw new Error(`parentId cycle: ${[...path.slice(at), current].join(' -> ')}`);
      path.push(current);
      current = parentOf.get(current);
    }
  }
}

function orgchartToElements(spec: OrgchartSpec): DiagramElement[] {
  assertUniqueIds(spec.nodes.map((n) => n.id), 'node');
  const ids = new Set(spec.nodes.map((n) => n.id));
  for (const n of spec.nodes) if (n.parentId !== undefined) assertKnown(ids, n.parentId, 'parentId');
  assertNoParentCycle(spec.nodes);
  const edges = spec.nodes
    .filter((n) => n.parentId !== undefined)
    .map((n) => {
      assertKnown(ids, n.parentId as string, 'parentId');
      return { from: n.parentId as string, to: n.id };
    });
  return buildGraph(
    spec.nodes.map((n) => ({ id: n.id, label: n.label, shape: 'rect', color: n.color })),
    edges,
    'TB',
  );
}

function flowToElements(spec: FlowSpec): DiagramElement[] {
  assertUniqueIds(spec.nodes.map((n) => n.id), 'node');
  const ids = new Set(spec.nodes.map((n) => n.id));
  for (const edge of spec.edges) {
    if (edge.from === edge.to) throw new Error(`Self-loops are not supported: edge ${edge.from} -> ${edge.to}`);
    assertKnown(ids, edge.from, 'edge.from');
    assertKnown(ids, edge.to, 'edge.to');
  }
  assertUniqueIds(spec.edges.map((e) => edgeId(e.from, e.to)), 'edge');
  return buildGraph(
    spec.nodes.map((n) => ({ id: n.id, label: n.label, shape: n.shape ?? 'rect' })),
    spec.edges,
    spec.direction ?? 'TB',
  );
}

const ANNOTATION_DOT = 10;
const DEFAULT_DOT_FILL = '#1e1e1e';
const ANNOTATION_LABEL_OFFSET = 14;

function curveToElements(spec: CurveSpec, warnings: string[]): DiagramElement[] {
  if (spec.points.length < 2) throw new Error('curve needs at least 2 points');
  const annotations = spec.annotations ?? [];
  assertUniqueIds(annotations.map((a) => a.id), 'annotation');
  const scale = createCurveScale(spec.points);
  const { width, height } = scale.plot;
  const elements: DiagramElement[] = [
    createLinear('axis:x', 'arrow', [{ x: 0, y: height }, { x: width + 20, y: height }]),
    createLinear('axis:y', 'arrow', [{ x: 0, y: height }, { x: 0, y: -20 }]),
  ];
  if (spec.axes?.x) elements.push(createText(labelId('axis:x'), spec.axes.x, { x: width - 60, y: height + 10 }));
  if (spec.axes?.y) elements.push(createText(labelId('axis:y'), spec.axes.y, { x: 8, y: -24 }));

  const sorted = [...spec.points].sort((a, b) => a.x - b.x);
  elements.push(createLinear('curve:main', 'line', sorted.map(scale.toScreen), { curved: true }));

  const minX = sorted[0].x;
  const maxX = sorted[sorted.length - 1].x;
  for (const note of annotations) {
    const x = Math.min(maxX, Math.max(minX, note.at));
    if (x !== note.at) warnings.push(`annotation ${note.id}: at=${note.at} is outside the curve's x range [${minX}, ${maxX}]; clamped to ${x}`);
    const at = scale.toScreen({ x, y: scale.yAt(x) });
    const dot = createShape(`pt:${note.id}`, 'ellipse', {
      x: at.x - ANNOTATION_DOT / 2,
      y: at.y - ANNOTATION_DOT / 2,
      width: ANNOTATION_DOT,
      height: ANNOTATION_DOT,
    }, DEFAULT_DOT_FILL);
    const label = createText(labelId(dot.id), note.label, { x: at.x + ANNOTATION_LABEL_OFFSET, y: at.y - ANNOTATION_LABEL_OFFSET * 2 });
    elements.push(dot, label);
  }
  return elements;
}

/**
 * Throws on invalid specs (duplicate ids, unknown/self edges, parent cycles).
 * Recoverable oddities (e.g. a clamped annotation) come back as warnings.
 */
export function specToScene(input: DiagramSpec): { elements: DiagramElement[]; warnings: string[] } {
  const warnings: string[] = [];
  switch (input.kind) {
    case 'orgchart':
      return { elements: orgchartToElements(input.spec), warnings };
    case 'flow':
      return { elements: flowToElements(input.spec), warnings };
    case 'curve':
      return { elements: curveToElements(input.spec, warnings), warnings };
    case 'freeform':
      return { elements: freeformToElements(input.spec, warnings), warnings };
    case 'comic':
      return { elements: shapesToElements(comicToShapes(input.spec, warnings)), warnings };
  }
}

export { applyStyle, defaultStyle } from './style';
export { addItems } from './extras';

export const specToElements = (input: DiagramSpec): DiagramElement[] => specToScene(input).elements;
