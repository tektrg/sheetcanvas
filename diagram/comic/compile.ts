// Comic kind -> freeform shapes. Panels sit left to right (or in a grid),
// item coordinates are relative to their panel's top-left corner.
import type { ComicItem, ComicPanel, ComicSpec } from '../types';
import type { SceneShape } from '../freeform';
import { stickFigure } from './figures';
import { prop } from './props';
import { speech, type SpeakerTarget } from './speech';

const PANEL = { width: 400, height: 300 };
const GUTTER = 20;
const CAPTION_TOP = 10;

type Box = { x: number; y: number; width: number; height: number };

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

const clampTo = (b: Box, p: { x: number; y: number }) => ({
  x: Math.min(b.x + b.width, Math.max(b.x, p.x)),
  y: Math.min(b.y + b.height, Math.max(b.y, p.y)),
});

function speakerTargets(items: ComicItem[], panel: Box, figures: Map<string, SpeakerTarget>, seen: Set<string>) {
  for (const item of items) {
    if (item.type !== 'character') continue;
    if (seen.has(item.id)) throw new Error(`Duplicate character id "${item.id}" (character ids are unique across panels)`);
    // Off-panel speakers draw nothing: x,y is their head; tails stop at the panel edge.
    seen.add(item.id);
    if (item.offPanel) figures.set(item.id, { ...clampTo(panel, { x: panel.x + item.x, y: panel.y + item.y }), r: 0 });
  }
}

function itemShapes(item: ComicItem, panel: Box, figures: Map<string, SpeakerTarget>, panelId: string): SceneShape[] {
  const at = (p: { x: number; y: number }) => ({ x: panel.x + p.x, y: panel.y + p.y });
  switch (item.type) {
    case 'character': {
      if (item.offPanel) return [];
      const figure = stickFigure({ ...item, ...at(item) });
      figures.set(item.id, figure.head);
      return figure.shapes;
    }
    case 'prop':
      return prop({ ...item, ...at(item) });
    case 'caption':
      return [{ id: `caption:${item.id}`, type: 'text', text: item.text, x: panel.x + panel.width / 2, y: panel.y + CAPTION_TOP, textAlign: 'center', fontSize: 16 }];
    case 'shape': {
      const { type: _item, shape, id, ...rest } = item;
      return [{ ...rest, id: `shape:${id}`, type: shape, ...at(rest) }];
    }
    case 'speech': {
      const target =
        typeof item.speaker === 'string' ? figures.get(item.speaker) : { ...at(item.speaker), r: 0 };
      if (!target) throw new Error(`Speech "${item.id}" in panel "${panelId}": unknown speaker "${item.speaker}" (declare the character in the same panel)`);
      return speech({ ...item, ...at(item) }, target);
    }
  }
}

export function comicToShapes(spec: ComicSpec): SceneShape[] {
  const boxes = panelBoxes(spec.panels, spec.layout);
  const shapes: SceneShape[] = [];
  const characterIds = new Set<string>();
  spec.panels.forEach((panel, i) => {
    const b = boxes[i];
    if (panel.border !== false) shapes.push({ id: `panel:${panel.id}`, type: 'rect', ...b });
    const figures = new Map<string, SpeakerTarget>();
    speakerTargets(panel.items, b, figures, characterIds);
    // Characters first so speech placed earlier in the list can still find its speaker.
    const ordered = [...panel.items.filter((it) => it.type !== 'speech'), ...panel.items.filter((it) => it.type === 'speech')];
    for (const item of ordered) shapes.push(...itemShapes(item, b, figures, panel.id));
  });
  return shapes;
}
