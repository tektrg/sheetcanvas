// Adds comic items (stick figures, speech, props, shapes, captions) and a
// title to ANY existing drawing. Items may sit at scene x/y or relative to an
// existing element ("anchor": semantic id). Speech and tails avoid what is
// already drawn; the drawing grows upward when speech needs room.
import type { ComicItem, DiagramElement, DiagramExtraItem, ItemAnchor } from './types';
import { growPanel, shift, type LayoutOptions } from './comic/compile';
import type { Box } from './comic/geometry';
import { shapesToElements } from './freeform';
import { sketchify } from './sketch';
import { sceneBounds } from './scene';
import { findBySemanticId, semanticIdOf } from './patch';

const MARGIN = 24;
/** Added figures stand ~80px tall regardless of drawing size. */
const EXTRA_SCALE = 0.8;
const GAP = 12;
const TITLE = { fontSize: 24, gap: 16 };

const boxOf = (el: DiagramElement): Box => {
  const b = sceneBounds([el]);
  return el.points ? b : { x: el.x, y: el.y, width: el.width, height: el.height };
};

/** Scene point for an anchored item; characters/props stand on it, speech floats beside it. */
function anchorPoint(item: DiagramExtraItem & ItemAnchor, target: Box): { x: number; y: number } {
  const placement = item.placement ?? (item.type === 'speech' ? 'above' : 'on');
  const standing = item.type === 'character' || item.type === 'prop';
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const reach = item.type === 'speech' ? 40 : GAP;
  const at = {
    above: { x: cx, y: standing ? target.y : target.y - reach },
    on: { x: cx, y: standing ? target.y : cy },
    below: { x: cx, y: target.y + target.height + (standing ? 100 * EXTRA_SCALE : reach) },
    left: { x: target.x - (standing ? 30 : 90), y: standing ? target.y + target.height : cy },
    right: { x: target.x + target.width + (standing ? 30 : 90), y: standing ? target.y + target.height : cy },
  }[placement];
  return { x: at.x + (item.offset?.x ?? 0), y: at.y + (item.offset?.y ?? 0) };
}

/** Comic item in panel coordinates (origin = drawing top-left), anchors resolved. */
function toPanelItem(item: DiagramExtraItem, elements: DiagramElement[], origin: { x: number; y: number }): ComicItem {
  const { anchor, placement: _p, offset: _o, ...rest } = item;
  if (rest.type === 'title') throw new Error('unreachable');
  const local = (p: { x: number; y: number }) => ({ x: p.x - origin.x, y: p.y - origin.y });
  if (anchor) {
    const target = findBySemanticId(elements, anchor);
    if (!target) throw new Error(`Item "${item.id}": anchor "${anchor}" is not an element of this diagram`);
    if (rest.type === 'caption') return rest;
    return { ...rest, ...local(anchorPoint(item, boxOf(target))) } as ComicItem;
  }
  if ('x' in rest && rest.x !== undefined && rest.y !== undefined) return { ...rest, ...local({ x: rest.x, y: rest.y }) } as ComicItem;
  return rest as ComicItem;
}

/** Lines count segment by segment, so a long curve does not block the space under it. */
function obstacleBoxes(el: DiagramElement): Box[] {
  if (!el.points || el.points.length < 2) return [boxOf(el)];
  const pts = el.points.map(([px, py]) => ({ x: el.x + px, y: el.y + py }));
  return pts.slice(1).map((p, i) => {
    const q = pts[i];
    return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) };
  });
}

const itemIds = (el: DiagramElement[]) => new Set(el.map(semanticIdOf).filter(Boolean));

/**
 * Returns `elements` plus the new items drawn as single-stroke sketch lines.
 * Throws on unknown anchors / speakers and on ids that already exist.
 */
export function addItems(elements: DiagramElement[], items: DiagramExtraItem[], warnings: string[]): DiagramElement[] {
  const live = elements.filter((el) => !el.isDeleted);
  const bounds = live.length ? sceneBounds(live) : { x: 0, y: 0, width: 400, height: 300 };
  const origin = { x: bounds.x - MARGIN, y: bounds.y - MARGIN };
  const size = { width: bounds.width + MARGIN * 2, height: bounds.height + MARGIN * 2 };
  const titles = items.filter((it): it is Extract<DiagramExtraItem, { type: 'title' }> => it.type === 'title');
  const panelItems = items.filter((it) => it.type !== 'title').map((it) => toPanelItem(it, live, origin));

  let added: DiagramElement[] = [];
  if (panelItems.length) {
    const obstacles: Box[] = live.flatMap(obstacleBoxes).map((b) => ({ ...b, x: b.x - origin.x, y: b.y - origin.y }));
    const options: LayoutOptions = { scale: EXTRA_SCALE, obstacles };
    const { layout } = growPanel({ id: 'extras', items: panelItems, border: false }, size, warnings, options);
    added = sketchify(shapesToElements(shift(layout.shapes, { ...origin, width: 0, height: 0 })));
  }
  const existing = itemIds(live);
  for (const el of added) {
    const id = semanticIdOf(el);
    if (id && existing.has(id)) throw new Error(`Element id "${id}" already exists in this diagram; pick another item id`);
  }
  const all = [...elements, ...added];
  for (const title of titles) {
    const id = `title:${title.id}`;
    if (itemIds(all).has(id)) throw new Error(`Element id "${id}" already exists in this diagram`);
    const top = sceneBounds(all.filter((el) => !el.isDeleted));
    all.push(
      ...shapesToElements([{ id, type: 'text', text: title.text, x: top.x + top.width / 2, y: top.y - TITLE.gap - TITLE.fontSize * 1.25, fontSize: TITLE.fontSize, textAlign: 'center', wrapAt: 40 }]),
    );
  }
  return all;
}
