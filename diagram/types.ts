// Shared diagram model (future L2 component). Self-contained: no app/store
// imports, so the renderer + converters can move to a shared package later.
//
// Storage format = Excalidraw scene elements. Each element carries
// `customData.id`, a semantic id ("node:ceo", "edge:ceo->cto", "pt:peak")
// that agents use to edit by meaning without touching user geometry.

export type DiagramElementType = 'rectangle' | 'ellipse' | 'diamond' | 'arrow' | 'line' | 'text' | 'freedraw';

export interface DiagramElementCustomData {
  /** Semantic id, unique within a diagram. */
  id: string;
  /** Scroll-reveal progress 0..1 at which the element appears (stored only). */
  revealAt?: number;
  /** Progress range [from, to] over which a line/arrow draws itself (stored only). */
  draw?: [number, number];
}

export interface DiagramBinding {
  elementId: string;
  focus: number;
  gap: number;
}

export interface DiagramBoundElement {
  id: string;
  type: 'text' | 'arrow';
}

/**
 * Subset of an Excalidraw element we read/write. Extra Excalidraw fields are
 * kept via the index signature so a round trip through the editor is lossless.
 */
export interface DiagramElement {
  id: string;
  type: DiagramElementType | string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  roundness: { type: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  groupIds: string[];
  frameId: string | null;
  boundElements: DiagramBoundElement[] | null;
  updated: number;
  link: string | null;
  locked: boolean;
  customData?: DiagramElementCustomData;
  // text
  text?: string;
  originalText?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: 'left' | 'center' | 'right';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  containerId?: string | null;
  lineHeight?: number;
  autoResize?: boolean;
  // linear (line / arrow)
  points?: [number, number][];
  startBinding?: DiagramBinding | null;
  endBinding?: DiagramBinding | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  elbowed?: boolean;
  [key: string]: unknown;
}

export type DiagramKind = 'orgchart' | 'flow' | 'curve' | 'freeform' | 'comic';

export interface OrgchartSpec {
  nodes: { id: string; label: string; parentId?: string; color?: string }[];
}

export type FlowShape = 'rect' | 'diamond' | 'ellipse';

export interface FlowSpec {
  nodes: { id: string; label: string; shape?: FlowShape }[];
  edges: { from: string; to: string; label?: string }[];
  direction?: 'TB' | 'LR';
}

export interface CurveSpec {
  points: { x: number; y: number }[];
  annotations?: { id: string; at: number; label: string }[];
  axes?: { x?: string; y?: string };
}

export type FreeformShapeType = 'rect' | 'ellipse' | 'diamond' | 'line' | 'arrow' | 'text' | 'freedraw';

/** One drawing primitive. Line/arrow/freedraw points are relative to x,y. */
export interface FreeformShape {
  id: string;
  type: FreeformShapeType;
  x: number;
  y: number;
  width?: number;
  height?: number;
  points?: [number, number][];
  text?: string;
  fontSize?: number;
  /** Text only: x is the left edge (left), centre (center) or right edge (right). */
  textAlign?: 'left' | 'center' | 'right';
  color?: string;
  fill?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed';
  roughness?: 0 | 1 | 2;
  /** Rounded rect corners / smooth line. */
  roundness?: boolean;
}

export interface FreeformSpec {
  width?: number;
  height?: number;
  shapes: FreeformShape[];
}

export type ComicPose = 'stand' | 'sit' | 'type' | 'wave';
export type ComicFacing = 'left' | 'right';
export type ComicPropKind = 'desk' | 'monitor' | 'chair' | 'laptop' | 'bed' | 'door' | 'table';

export type ComicItem =
  | { type: 'character'; id: string; x?: number; y?: number; pose?: ComicPose; facing?: ComicFacing; scale?: number; offPanel?: boolean; on?: string }
  | { type: 'speech'; id: string; text: string; x?: number; y?: number; speaker: string | { x: number; y: number }; tail?: 'line' | 'bubble' }
  | { type: 'prop'; id: string; kind: ComicPropKind; x?: number; y?: number; scale?: number; facing?: ComicFacing; on?: string }
  | { type: 'caption'; id: string; text: string }
  | ({ type: 'shape'; shape: FreeformShapeType } & Omit<FreeformShape, 'type'>);

export interface ComicPanel {
  id: string;
  width?: number;
  height?: number;
  border?: boolean;
  items: ComicItem[];
}

export interface ComicSpec {
  panels: ComicPanel[];
  layout?: 'row' | 'grid';
}

export type DiagramSpec =
  | { kind: 'orgchart'; spec: OrgchartSpec }
  | { kind: 'flow'; spec: FlowSpec }
  | { kind: 'curve'; spec: CurveSpec }
  | { kind: 'freeform'; spec: FreeformSpec }
  | { kind: 'comic'; spec: ComicSpec };

/** Fields an agent may patch on one element. Geometry is never patched. */
export interface DiagramElementPatch {
  label?: string;
  color?: string;
  revealAt?: number;
  draw?: [number, number];
  remove?: boolean;
}
