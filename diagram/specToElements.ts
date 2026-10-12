// Converts a semantic spec (org chart / flow / curve) into Excalidraw elements
// with semantic ids in customData. Text sits inside its shape via
// containerId <-> boundElements; arrows bind to the nodes they connect.
import type { CurveSpec, DiagramElement, DiagramSpec, FlowShape, FlowSpec, OrgchartSpec } from './types';
import { addBoundElement, centerOf, createLinear, createShape, createText, measureText } from './elementFactory';
import { createCurveScale, layoutGraph, type Box } from './layout';
import { resolveColor } from './colors';

export const nodeId = (id: string) => `node:${id}`;
export const edgeId = (from: string, to: string) => `edge:${from}->${to}`;
export const labelId = (ownerId: string) => `${ownerId}:label`;

const NODE_MIN = { width: 140, height: 60 };
const NODE_PADDING = { x: 28, y: 20 };

function nodeSize(label: string) {
  const text = measureText(label);
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
    const arrow = createLinear(
      edgeId(edge.from, edge.to),
      'arrow',
      [anchor(from, to, direction), anchor(to, from, direction)],
      { fromId: from.id, toId: to.id },
    );
    addBoundElement(from, arrow);
    addBoundElement(to, arrow);
    elements.push(arrow);
    if (edge.label) {
      const text = createText(labelId(arrow.id), edge.label, centerOf(arrow), arrow.id);
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

function orgchartToElements(spec: OrgchartSpec): DiagramElement[] {
  assertUniqueIds(spec.nodes.map((n) => n.id), 'node');
  const ids = new Set(spec.nodes.map((n) => n.id));
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

function curveToElements(spec: CurveSpec): DiagramElement[] {
  if (spec.points.length < 2) throw new Error('curve needs at least 2 points');
  assertUniqueIds(spec.annotations.map((a) => a.id), 'annotation');
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

  for (const note of spec.annotations) {
    const at = scale.toScreen({ x: note.at, y: scale.yAt(note.at) });
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

/** Throws on invalid specs (duplicate ids, edges to unknown nodes). */
export function specToElements(input: DiagramSpec): DiagramElement[] {
  switch (input.kind) {
    case 'orgchart':
      return orgchartToElements(input.spec);
    case 'flow':
      return flowToElements(input.spec);
    case 'curve':
      return curveToElements(input.spec);
  }
}
