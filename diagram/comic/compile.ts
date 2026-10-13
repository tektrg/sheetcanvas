// Comic kind -> freeform shapes, with auto-layout. Panels sit left to right
// (or in a grid). Item coordinates are optional and panel-relative; the
// layout fills gaps (floor line, scale, snapping, speech stacking) and fixes
// collisions/overflow, reporting every change to given coordinates as a warning.
import type { ComicFacing, ComicItem, ComicPanel, ComicPropKind, ComicSpec } from '../types';
import type { SceneShape } from '../freeform';
import { stickFigure } from './figures';
import { prop } from './props';
import { blockBox, speechBlock, speechShapes, type SpeakerTarget, type SpeechBlock } from './speech';
import { clamp, inflate, overlaps, type Box } from './geometry';
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

  constructor(readonly panel: ComicPanel, readonly box: Box, readonly warnings: string[]) {
    this.scale = (box.height * FIGURE_SHARE) / FIGURE_HEIGHT;
    this.floor = box.height * FLOOR;
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

  /** `slot` 0..1 spreads characters without coordinates across the panel. */
  placeCharacter(item: CharacterItem, slot: number) {
    const scale = item.scale ?? this.scale;
    if (item.offPanel) {
      const at = { x: item.x ?? this.box.width + 40, y: item.y ?? this.box.height * 0.15 };
      this.heads.set(item.id, { x: clamp(at.x, 0, this.box.width), y: clamp(at.y, 0, this.box.height), r: 0 });
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
    this.shapes.push(...figure.shapes);
  }

  placeSpeech(items: SpeechItem[]) {
    const top = PAD + (this.panel.items.some((it) => it.type === 'caption') ? CAPTION_SPACE : 0);
    let cursor = top;
    const placed: { item: SpeechItem; block: SpeechBlock; target: SpeakerTarget }[] = [];
    for (const item of items) {
      const target = typeof item.speaker === 'string' ? this.heads.get(item.speaker) : { ...item.speaker, r: 0 };
      if (!target) throw new Error(`Speech "${item.id}" in panel "${this.panel.id}": unknown speaker "${item.speaker}" (declare the character in the same panel)`);
      const block = speechBlock(item);
      const want = { x: item.x ?? target.x, y: item.y ?? cursor + block.radii.y };
      block.center = this.fit(block, want, [...this.drawingBoxes(), ...placed.map((p) => blockBox(p.block))]);
      const given = item.x !== undefined || item.y !== undefined;
      if (given && Math.hypot(block.center.x - want.x, block.center.y - want.y) > MOVED) this.note(block.id, 'moved to stay inside the panel and clear of other speech');
      cursor = Math.max(cursor, block.center.y + block.radii.y + STACK_GAP);
      placed.push({ item, block, target });
    }
    for (const { block, target } of placed) {
      const others = placed.filter((p) => p.block !== block).map((p) => blockBox(p.block));
      this.shapes.push(...speechShapes(block, target, others, this.warnings));
    }
  }

  /** Figures and upright props that speech must not cover (desk/table/bed tops are open space). */
  private drawingBoxes(): Box[] {
    const open = /^(panel|prop:[^:]+$|prop:.*:(seat|back)$)/;
    return this.shapes.filter((sh) => !open.test(sh.id)).map((sh) => inflate(shapeBox(sh), STACK_GAP));
  }

  /**
   * Nearest spot to `want` that stays inside the panel and clears `taken`:
   * candidates are `want` itself plus spots beside/below each taken box.
   */
  private fit(block: SpeechBlock, want: Pt, taken: Box[]): Pt {
    const r = block.radii;
    const inside = (p: Pt) => ({
      x: clamp(p.x, PAD + r.x, this.box.width - PAD - r.x),
      y: clamp(p.y, PAD + r.y, this.box.height - PAD - r.y),
    });
    const free = (p: Pt) => !taken.some((t) => overlaps({ x: p.x - r.x, y: p.y - r.y, width: r.x * 2, height: r.y * 2 }, t));
    const candidates = [want, ...taken.flatMap((t) => [
      { x: want.x, y: t.y + t.height + STACK_GAP + r.y },
      { x: t.x + t.width + STACK_GAP + r.x, y: want.y },
      { x: t.x - STACK_GAP - r.x, y: want.y },
      { x: t.x + t.width + STACK_GAP + r.x, y: t.y + r.y },
      { x: t.x - STACK_GAP - r.x, y: t.y + r.y },
    ])].map(inside);
    const dist = (p: Pt) => Math.hypot(p.x - want.x, p.y - want.y);
    const best = candidates.filter(free).sort((a, b) => dist(a) - dist(b))[0];
    if (!best) this.note(block.id, 'has no free spot; it overlaps other content');
    return best ?? inside(want);
  }
}

function shapeBox(sh: SceneShape): Box {
  if (!sh.points) return { x: sh.x, y: sh.y, width: sh.width ?? 0, height: sh.height ?? 0 };
  const xs = sh.points.map((p) => sh.x + p[0]);
  const ys = sh.points.map((p) => sh.y + p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

const shift = (shapes: SceneShape[], by: Box): SceneShape[] => shapes.map((s) => ({ ...s, x: s.x + by.x, y: s.y + by.y }));

export function comicToShapes(spec: ComicSpec, warnings: string[] = []): SceneShape[] {
  const boxes = panelBoxes(spec.panels, spec.layout);
  const shapes: SceneShape[] = [];
  const characterIds = new Set<string>();
  spec.panels.forEach((panel, i) => {
    const box = boxes[i];
    if (panel.border !== false) shapes.push({ id: `panel:${panel.id}`, type: 'rect', ...box });
    const layout = new PanelLayout(panel, box, warnings);
    const of = <T extends ComicItem['type']>(type: T) => panel.items.filter((it): it is Extract<ComicItem, { type: T }> => it.type === type);
    for (const c of of('character')) {
      if (characterIds.has(c.id)) throw new Error(`Duplicate character id "${c.id}" (character ids are unique across panels)`);
      characterIds.add(c.id);
    }
    // Floor props first so surface props and seated characters can snap to them.
    const props = of('prop');
    for (const p of props.filter((p) => !ON_SURFACE.includes(p.kind) && p.kind !== 'chair')) layout.placeProp(p);
    for (const p of props.filter((p) => p.kind === 'chair' || ON_SURFACE.includes(p.kind))) layout.placeProp(p);
    const onPanel = of('character').filter((c) => !c.offPanel);
    for (const c of of('character')) layout.placeCharacter(c, (onPanel.indexOf(c) + 1) / (onPanel.length + 1));
    for (const c of of('caption')) {
      layout.shapes.push({ id: `caption:${c.id}`, type: 'text', text: c.text, x: box.width / 2, y: CAPTION_TOP, textAlign: 'center', fontSize: 16 });
    }
    for (const s of of('shape')) {
      const { type: _item, shape, id, ...rest } = s;
      layout.shapes.push({ ...rest, id: `shape:${id}`, type: shape });
    }
    layout.placeSpeech(of('speech'));
    shapes.push(...shift(layout.shapes, box));
  });
  return shapes;
}
