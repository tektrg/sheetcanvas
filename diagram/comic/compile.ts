// Comic kind -> freeform shapes, with auto-layout. Panels sit left to right
// (or in a grid). Item coordinates are optional and panel-relative; the
// layout fills gaps (floor line, scale, snapping, speech stacking) and fixes
// collisions/overflow, reporting every change to given coordinates as a warning.
import type { ComicFacing, ComicItem, ComicPanel, ComicPropKind, ComicSpec } from '../types';
import type { SceneShape } from '../freeform';
import { stickFigure } from './figures';
import { prop } from './props';
import { blockBox, planTail, speechBlock, speechShapes, type SpeakerTarget } from './speech';
import { clamp, inflate, overlaps, segmentHitsBox, type Box } from './geometry';
import type { Pt } from './draw';

const PANEL = { width: 400, height: 300 };
const GUTTER = 20;
const CAPTION_TOP = 10;
const CAPTION_SPACE = 30;
const FLOOR = 0.85;
/** A standing figure (~100 units tall) fills this share of the panel height. */
const FIGURE_SHARE = 0.45;
const FIGURE_HEIGHT = 100;
const PAD = 10;
const STACK_GAP = 8;
const SNAP_RANGE = 90;
const MOVED = 2;

/** Surface heights (unscaled) that monitor/laptop sit on. */
const SURFACE: Partial<Record<ComicPropKind, { height: number; halfWidth: number }>> = {
  desk: { height: 70, halfWidth: 60 },
  table: { height: 55, halfWidth: 45 },
};
const ON_SURFACE: ComicPropKind[] = ['monitor', 'laptop'];
const DEFAULT_PROP_X: Partial<Record<ComicPropKind, number>> = { desk: 0.62, table: 0.62, bed: 0.5, door: 0.15 };
const CHAIR_TO_DESK = 100;
const OFF_PANEL_X = { left: -0.1, right: 1.1, top: 0.5 } as const;
const HEADROOM_STEP = 40;
const GRID_STEP = 10;
const OFF_PANEL_TAIL = 30;
const MAX_HEADROOM = 400;

type CharacterItem = Extract<ComicItem, { type: 'character' }>;
type PropItem = Extract<ComicItem, { type: 'prop' }>;
type SpeechItem = Extract<ComicItem, { type: 'speech' }>;
type Placed<T> = T & { x: number; y: number; scale: number; facing: ComicFacing };

function panelBoxes(panels: ComicPanel[], layout: ComicSpec['layout']): Box[] {
  const sizes = panels.map((p) => ({ width: p.width ?? PANEL.width, height: p.height ?? PANEL.height }));
  if (layout === 'grid') {
    const cols = Math.ceil(Math.sqrt(panels.length));
    const cell = { width: Math.max(...sizes.map((s) => s.width)), height: Math.max(...sizes.map((s) => s.height)) };
    return sizes.map((s, i) => ({ x: (i % cols) * (cell.width + GUTTER), y: Math.floor(i / cols) * (cell.height + GUTTER), ...s }));
  }
  let x = 0;
  return sizes.map((s) => {
    const placed = { x, y: 0, ...s };
    x += s.width + GUTTER;
    return placed;
  });
}

class PanelLayout {
  readonly scale: number;
  readonly floor: number;
  readonly props = new Map<string, Placed<PropItem>>();
  readonly heads = new Map<string, SpeakerTarget>();
  readonly shapes: SceneShape[] = [];
  /** Panel top in scene coordinates: -headroom (extra space added above for speech). */
  readonly top: number;
  /** Set when speech could not sit above its speaker, clear of drawings, with a clean tail. */
  crowded = false;

  constructor(readonly panel: ComicPanel, readonly box: Box, readonly warnings: string[], headroom = 0) {
    this.scale = (box.height * FIGURE_SHARE) / FIGURE_HEIGHT;
    this.floor = box.height * FLOOR;
    this.top = -headroom;
  }

  private note(id: string, what: string) {
    this.warnings.push(`panel ${this.panel.id}: ${id} ${what}`);
  }

  private nearest(kinds: ComicPropKind[], x: number | undefined, range: number) {
    const candidates = [...this.props.values()].filter((p) => kinds.includes(p.kind));
    if (x === undefined) return candidates[0];
    return candidates
      .filter((p) => Math.abs(p.x - x) <= range)
      .sort((a, b) => Math.abs(a.x - x) - Math.abs(b.x - x))[0];
  }

  private byId(id: string, kinds: ComicPropKind[], owner: string) {
    const target = this.props.get(id);
    if (!target || !kinds.includes(target.kind)) throw new Error(`panel "${this.panel.id}": ${owner} is on "${id}", which is not a ${kinds.join('/')} in this panel`);
    return target;
  }

  placeProp(item: PropItem) {
    const scale = item.scale ?? this.scale;
    let x = item.x ?? this.box.width * (DEFAULT_PROP_X[item.kind] ?? 0.5);
    let y = item.y ?? this.floor;
    let facing = item.facing ?? 'right';
    if (ON_SURFACE.includes(item.kind)) {
      const kinds = Object.keys(SURFACE) as ComicPropKind[];
      const base = item.on ? this.byId(item.on, kinds, `prop:${item.id}`) : this.nearest(kinds, item.x, SNAP_RANGE * scale);
      if (base) {
        const surface = SURFACE[base.kind]!;
        if (item.x === undefined) x = base.x + surface.halfWidth * base.scale * 0.2;
        y = base.y - surface.height * base.scale;
        if (item.y !== undefined && Math.abs(item.y - y) > MOVED) this.note(`prop:${item.id}`, `snapped onto ${base.id}`);
      }
    }
    if (item.kind === 'chair') {
      const desk = this.nearest(['desk', 'table'], item.x, Infinity);
      if (desk && item.x === undefined) x = desk.x - CHAIR_TO_DESK * desk.scale;
      // A chair faces its desk (the drawing faces right: back on the left).
      if (desk && !item.facing) facing = desk.x >= x ? 'right' : 'left';
    }
    const placed = { ...item, x, y, scale, facing };
    this.props.set(item.id, placed);
    this.shapes.push(...prop(placed));
  }

  /** Explicit side, else behind the first on-panel character (opposite its facing). */
  private offPanelSide(item: CharacterItem): 'left' | 'right' | 'top' {
    if (item.side) return item.side;
    const listener = this.facings.values().next().value;
    return listener === 'left' ? 'right' : 'left';
  }

  private readonly facings = new Map<string, ComicFacing>();
  /** Off-panel speakers without coordinates: which panel edge their voice comes from. */
  private readonly offPanel = new Map<string, 'left' | 'right' | 'top'>();

  /** `slot` 0..1 spreads characters without coordinates across the panel. */
  placeCharacter(item: CharacterItem, slot: number) {
    const scale = item.scale ?? this.scale;
    if (item.offPanel) {
      const at = { x: item.x ?? OFF_PANEL_X[this.offPanelSide(item)] * this.box.width, y: item.y ?? (item.side === 'top' ? this.top - 40 : this.box.height * 0.15) };
      if (item.x === undefined && item.y === undefined) this.offPanel.set(item.id, this.offPanelSide(item));
      else this.heads.set(item.id, { x: clamp(at.x, 0, this.box.width), y: clamp(at.y, this.top, this.box.height), r: 0 });
      return;
    }
    let x = item.x ?? this.box.width * slot;
    let y = item.y ?? this.floor;
    let facing = item.facing ?? 'right';
    if (item.pose === 'sit' || item.pose === 'type') {
      const chair = item.on ? this.byId(item.on, ['chair'], `char:${item.id}`) : this.nearest(['chair'], item.x, SNAP_RANGE * scale);
      if (chair) {
        if ((item.x !== undefined && Math.abs(item.x - chair.x) > MOVED) || (item.y !== undefined && Math.abs(item.y - chair.y) > MOVED)) {
          this.note(`char:${item.id}`, `snapped onto ${chair.id}`);
        }
        x = chair.x;
        y = chair.y;
        const desk = this.nearest(['desk', 'table'], chair.x, Infinity);
        facing = item.facing ?? (desk ? (desk.x >= chair.x ? 'right' : 'left') : chair.facing);
      }
    }
    const figure = stickFigure({ id: item.id, x, y, pose: item.pose, facing, scale });
    this.heads.set(item.id, figure.head);
    this.facings.set(item.id, facing);
    this.shapes.push(...figure.shapes);
  }

  /** Where a speaker's tail aims when the text sits at `center`. */
  private targetFor(item: SpeechItem): (center: Pt) => SpeakerTarget {
    if (typeof item.speaker !== 'string') {
      const point = { ...item.speaker, r: 0 };
      return () => point;
    }
    const side = this.offPanel.get(item.speaker);
    // Off-panel voices: the tail runs to the nearest point of their panel edge.
    if (side === 'top') return (c) => ({ x: c.x, y: this.top, r: 0 });
    if (side) return (c) => ({ x: side === 'left' ? 0 : this.box.width, y: c.y, r: 0 });
    const head = this.heads.get(item.speaker);
    if (!head) throw new Error(`Speech "${item.id}" in panel "${this.panel.id}": unknown speaker "${item.speaker}" (declare the character in the same panel)`);
    return () => head;
  }

  /**
   * Places speech in reading order. Each block takes the spot nearest its
   * preferred one where it stays inside the panel, sits above its speaker,
   * covers no drawing, speech or earlier tail, and gets a tail that crosses
   * nothing. If no spot exists the panel is marked crowded (it then grows).
   */
  placeSpeech(items: SpeechItem[]) {
    let cursor = this.top + PAD + (this.panel.items.some((it) => it.type === 'caption') ? CAPTION_SPACE : 0);
    const boxes: Box[] = [];
    const tails: Pt[][] = [];
    const drawings = this.drawingBoxes();
    for (const item of items) {
      const targetAt = this.targetFor(item);
      const block = speechBlock(item);
      const r = block.radii;
      const preferred = targetAt({ x: this.box.width / 2, y: cursor });
      // Off-panel voices keep a visible tail to their edge, so start a little way in.
      const offEdge = typeof item.speaker === 'string' && this.offPanel.has(item.speaker);
      const inset = r.x + PAD + OFF_PANEL_TAIL;
      const edgeX = preferred.x <= 0 ? inset : preferred.x >= this.box.width ? this.box.width - inset : preferred.x;
      const want = { x: item.x ?? (offEdge ? edgeX : preferred.x), y: item.y ?? cursor + r.y };
      const own = typeof item.speaker === 'string' ? `char:${item.speaker}:` : '\0';
      const tailObstacles = [...boxes, ...this.drawingBoxes((id) => !id.startsWith(own))];
      const boxAt = (c: Pt): Box => ({ x: c.x - r.x, y: c.y - r.y, width: r.x * 2, height: r.y * 2 });
      const crossesTail = (b: Box) => tails.some((t) => t.some((p, i) => i > 0 && segmentHitsBox(t[i - 1], p, b)));
      let chosen: { center: Pt; tail: Pt[] | null } | undefined;
      for (const center of this.candidates(r, want)) {
        const target = targetAt(center);
        const b = boxAt(center);
        if (target.r && b.y + b.height > target.y - target.r - STACK_GAP) continue;
        if ([...drawings, ...boxes].some((t) => overlaps(b, t)) || crossesTail(b)) continue;
        block.center = center;
        const plan = planTail(block, target, tailObstacles);
        if (!plan.clean || (offEdge && !plan.pts)) continue;
        chosen = { center, tail: plan.pts };
        break;
      }
      if (!chosen) {
        this.crowded = true;
        block.center = this.inside(r, want);
        chosen = { center: block.center, tail: planTail(block, targetAt(block.center), []).pts };
      }
      block.center = chosen.center;
      const given = item.x !== undefined || item.y !== undefined;
      if (given && Math.hypot(block.center.x - want.x, block.center.y - want.y) > MOVED) this.note(block.id, 'moved to stay inside the panel and clear of other speech');
      cursor = Math.max(cursor, block.center.y + r.y + STACK_GAP);
      boxes.push(blockBox(block));
      if (chosen.tail) tails.push(chosen.tail);
      this.shapes.push(...speechShapes(block, chosen.tail));
    }
  }

  private inside(r: Pt, p: Pt): Pt {
    return {
      x: clamp(p.x, PAD + r.x, this.box.width - PAD - r.x),
      y: clamp(p.y, this.top + PAD + r.y, this.box.height - PAD - r.y),
    };
  }

  /** `want` first, then a grid over the panel, nearest first. */
  private candidates(r: Pt, want: Pt): Pt[] {
    const grid: Pt[] = [];
    for (let y = this.top + PAD + r.y; y <= this.box.height - PAD - r.y; y += GRID_STEP) {
      for (let x = PAD + r.x; x <= this.box.width - PAD - r.x; x += GRID_STEP) grid.push({ x, y });
    }
    const dist = (p: Pt) => Math.hypot(p.x - want.x, p.y - want.y);
    return [this.inside(r, want), ...grid.sort((a, b) => dist(a) - dist(b))];
  }

  /** Figures and upright props that speech must not cover (desk/table/bed tops are open space). */
  private drawingBoxes(keep: (id: string) => boolean = () => true): Box[] {
    const open = /^(panel|speech:|caption:|prop:[^:]+$|prop:.*:(seat|back)$)/;
    return this.shapes.filter((sh) => !open.test(sh.id) && keep(sh.id)).map((sh) => inflate(shapeBox(sh), STACK_GAP));
  }

}

function shapeBox(sh: SceneShape): Box {
  if (!sh.points) return { x: sh.x, y: sh.y, width: sh.width ?? 0, height: sh.height ?? 0 };
  const xs = sh.points.map((p) => sh.x + p[0]);
  const ys = sh.points.map((p) => sh.y + p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

const shift = (shapes: SceneShape[], by: Box): SceneShape[] => shapes.map((s) => ({ ...s, x: s.x + by.x, y: s.y + by.y }));

function layoutPanel(panel: ComicPanel, size: { width: number; height: number }, headroom: number, warnings: string[]): PanelLayout {
  const box = { x: 0, y: 0, ...size };
  const layout = new PanelLayout(panel, box, warnings, headroom);
  const of = <T extends ComicItem['type']>(type: T) => panel.items.filter((it): it is Extract<ComicItem, { type: T }> => it.type === type);
  // Floor props first so surface props and seated characters can snap to them.
  const props = of('prop');
  for (const p of props.filter((p) => !ON_SURFACE.includes(p.kind) && p.kind !== 'chair')) layout.placeProp(p);
  for (const p of props.filter((p) => p.kind === 'chair' || ON_SURFACE.includes(p.kind))) layout.placeProp(p);
  // On-panel characters first: off-panel speakers default to the side behind them.
  const onPanel = of('character').filter((c) => !c.offPanel);
  for (const c of onPanel) layout.placeCharacter(c, (onPanel.indexOf(c) + 1) / (onPanel.length + 1));
  for (const c of of('character').filter((c) => c.offPanel)) layout.placeCharacter(c, 0);
  for (const c of of('caption')) {
    layout.shapes.push({ id: `caption:${c.id}`, type: 'text', text: c.text, x: box.width / 2, y: layout.top + CAPTION_TOP, textAlign: 'center', fontSize: 16 });
  }
  for (const s of of('shape')) {
    const { type: _item, shape, id, ...rest } = s;
    layout.shapes.push({ ...rest, id: `shape:${id}`, type: shape });
  }
  layout.placeSpeech(of('speech'));
  return layout;
}

/** Lays a panel out, adding headroom on top until its speech fits cleanly. */
function growPanel(panel: ComicPanel, size: { width: number; height: number }, warnings: string[]) {
  for (let headroom = 0; ; headroom += HEADROOM_STEP) {
    const attempt: string[] = [];
    const layout = layoutPanel(panel, size, headroom, attempt);
    if (!layout.crowded || headroom >= MAX_HEADROOM) {
      if (headroom > 0) attempt.push(`panel ${panel.id}: grew ${headroom}px taller to fit speech above the speakers`);
      if (layout.crowded) attempt.push(`panel ${panel.id}: speech still crowded; shorten the text or widen the panel`);
      warnings.push(...attempt);
      return { layout, headroom };
    }
  }
}

export function comicToShapes(spec: ComicSpec, warnings: string[] = []): SceneShape[] {
  const characterIds = new Set<string>();
  for (const c of spec.panels.flatMap((p) => p.items)) {
    if (c.type !== 'character') continue;
    if (characterIds.has(c.id)) throw new Error(`Duplicate character id "${c.id}" (character ids are unique across panels)`);
    characterIds.add(c.id);
  }
  const grown = spec.panels.map((panel) => growPanel(panel, { width: panel.width ?? PANEL.width, height: panel.height ?? PANEL.height }, warnings));
  const sized = spec.panels.map((panel, i) => ({ ...panel, height: (panel.height ?? PANEL.height) + grown[i].headroom }));
  const boxes = panelBoxes(sized, spec.layout);
  const shapes: SceneShape[] = [];
  spec.panels.forEach((panel, i) => {
    const box = boxes[i];
    if (panel.border !== false) shapes.push({ id: `panel:${panel.id}`, type: 'rect', ...box });
    shapes.push(...shift(grown[i].layout.shapes, { ...box, y: box.y + grown[i].headroom }));
  });
  return shapes;
}
