// xkcd speech: plain uppercase hand-lettered text plus a thin tail line that
// starts just outside the text and stops short of the speaker's head.
// 'bubble' wraps the text in an ellipse balloon instead.
import type { SceneShape } from '../freeform';
import { wrapLabel, measureText } from '../elementFactory';
import type { Pt } from './draw';

const FONT_SIZE = 16;
const WRAP_AT = 24;
const TEXT_GAP = 6;
const HEAD_GAP = 8;
const MIN_TAIL = 8;

export interface SpeechInput {
  id: string;
  text: string;
  /** Centre of the text block (panel coordinates). */
  x: number;
  y: number;
  tail?: 'line' | 'bubble';
}

/** Where the tail aims: a head (stop short of it) or a panel-edge point. */
export interface SpeakerTarget extends Pt {
  r: number;
}

export function speech(input: SpeechInput, target: SpeakerTarget): SceneShape[] {
  const id = `speech:${input.id}`;
  const text = wrapLabel(input.text.toUpperCase(), WRAP_AT);
  const size = measureText(text, FONT_SIZE);
  const center = { x: input.x, y: input.y };
  const shapes: SceneShape[] = [
    { id, type: 'text', text, x: center.x, y: center.y - size.height / 2, fontSize: FONT_SIZE, textAlign: 'center', wrapAt: WRAP_AT },
  ];
  const bubble = input.tail === 'bubble';
  const radii = bubble
    ? { x: size.width * 0.7 + 14, y: size.height * 0.8 + 12 }
    : { x: size.width / 2, y: size.height / 2 };
  if (bubble) {
    shapes.push({ id: `${id}:bubble`, type: 'ellipse', x: center.x - radii.x, y: center.y - radii.y, width: radii.x * 2, height: radii.y * 2, strokeWidth: 1 });
  }
  const tail = tailPoints(center, radii, bubble, target);
  if (tail) shapes.push({ id: `${id}:tail`, type: 'line', x: tail[0].x, y: tail[0].y, points: [[0, 0], [tail[1].x - tail[0].x, tail[1].y - tail[0].y]], strokeWidth: 1 });
  return shapes;
}

function tailPoints(center: Pt, radii: Pt, ellipse: boolean, target: SpeakerTarget): [Pt, Pt] | null {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return null;
  const ux = dx / dist;
  const uy = dy / dist;
  // Distance from centre to the text box / balloon border along the tail direction.
  const edge = ellipse
    ? 1 / Math.hypot(ux / radii.x, uy / radii.y)
    : Math.min(ux ? radii.x / Math.abs(ux) : Infinity, uy ? radii.y / Math.abs(uy) : Infinity);
  const start = edge + (ellipse ? 0 : TEXT_GAP);
  const end = dist - (target.r ? target.r + HEAD_GAP : 0);
  if (end - start < MIN_TAIL) return null;
  return [
    { x: center.x + ux * start, y: center.y + uy * start },
    { x: center.x + ux * end, y: center.y + uy * end },
  ];
}
