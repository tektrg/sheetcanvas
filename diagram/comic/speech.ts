// xkcd speech: plain uppercase hand-lettered text plus a thin tail line that
// starts just outside the text and stops short of the speaker's head.
// 'bubble' wraps the text in an ellipse balloon instead. Tails that would
// cross other speech bend once around the blocking block.
import type { SceneShape } from '../freeform';
import { wrapLabel, measureText } from '../elementFactory';
import type { Pt } from './draw';
import { corners, inflate, segmentHitsBox, type Box } from './geometry';

const FONT_SIZE = 16;
const WRAP_AT = 22;
const TEXT_GAP = 6;
const HEAD_GAP = 8;
const MIN_TAIL = 8;
const DETOUR = 10;

export interface SpeechBlock {
  id: string;
  text: string;
  bubble: boolean;
  center: Pt;
  /** Half extents of the text (or balloon). */
  radii: Pt;
  textHeight: number;
}

/** Where the tail aims: a head (stop short of it) or a panel-edge point (r = 0). */
export interface SpeakerTarget extends Pt {
  r: number;
}

export function speechBlock(input: { id: string; text: string; tail?: 'line' | 'bubble' }): SpeechBlock {
  const text = wrapLabel(input.text.toUpperCase(), WRAP_AT);
  const size = measureText(text, FONT_SIZE);
  const bubble = input.tail === 'bubble';
  const radii = bubble ? { x: size.width * 0.7 + 14, y: size.height * 0.8 + 12 } : { x: size.width / 2, y: size.height / 2 };
  return { id: `speech:${input.id}`, text, bubble, center: { x: 0, y: 0 }, radii, textHeight: size.height };
}

export const blockBox = (b: SpeechBlock): Box => ({ x: b.center.x - b.radii.x, y: b.center.y - b.radii.y, width: b.radii.x * 2, height: b.radii.y * 2 });

export function speechShapes(block: SpeechBlock, target: SpeakerTarget, obstacles: Box[], warnings: string[]): SceneShape[] {
  const { id, center, radii } = block;
  const shapes: SceneShape[] = [
    { id, type: 'text', text: block.text, x: center.x, y: center.y - block.textHeight / 2, fontSize: FONT_SIZE, textAlign: 'center', wrapAt: WRAP_AT },
  ];
  if (block.bubble) {
    shapes.push({ id: `${id}:bubble`, type: 'ellipse', x: center.x - radii.x, y: center.y - radii.y, width: radii.x * 2, height: radii.y * 2, strokeWidth: 1 });
  }
  const tail = tailPoints(block, target);
  if (!tail) return shapes;
  const path = routeAround(tail, obstacles.map((o) => inflate(o, 4)));
  if (!path) warnings.push(`${id}: tail crosses other speech; move the text to untangle it`);
  const pts = path ?? tail;
  shapes.push({ id: `${id}:tail`, type: 'line', x: pts[0].x, y: pts[0].y, points: pts.map((p) => [p.x - pts[0].x, p.y - pts[0].y]), strokeWidth: 1 });
  return shapes;
}

function tailPoints({ center, radii, bubble }: SpeechBlock, target: SpeakerTarget): [Pt, Pt] | null {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  // Distance from centre to the text box / balloon border along the tail direction.
  const edge = bubble
    ? 1 / Math.hypot(ux / radii.x, uy / radii.y)
    : Math.min(ux ? radii.x / Math.abs(ux) : Infinity, uy ? radii.y / Math.abs(uy) : Infinity);
  const start = edge + (bubble ? 0 : TEXT_GAP);
  const end = dist - (target.r ? target.r + HEAD_GAP : 0);
  if (end - start < MIN_TAIL) return null;
  return [
    { x: center.x + ux * start, y: center.y + uy * start },
    { x: center.x + ux * end, y: center.y + uy * end },
  ];
}

const clear = (a: Pt, b: Pt, boxes: Box[]) => boxes.every((box) => !segmentHitsBox(a, b, box));

/** Straight if clear, else the shortest one-bend path via a blocking box's corner; null if none is clear. */
function routeAround([start, end]: [Pt, Pt], boxes: Box[]): Pt[] | null {
  if (clear(start, end, boxes)) return [start, end];
  const len = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const options = boxes
    .filter((box) => segmentHitsBox(start, end, box))
    .flatMap((box) => corners(inflate(box, DETOUR)))
    .filter((via) => clear(start, via, boxes) && clear(via, end, boxes))
    .sort((a, b) => len(start, a) + len(a, end) - (len(start, b) + len(b, end)));
  return options.length ? [start, options[0], end] : null;
}
