// xkcd-style stick figures. (x,y) is the floor point under the hips, so a
// sitting figure placed at a chair's (x,y) lands on its seat.
import type { ComicFacing, ComicPose } from '../types';
import type { SceneShape } from '../freeform';
import { circle, placer, polyline, type Offset, type Pt } from './draw';

const HEAD_R = 12;

interface PoseGeometry {
  head: Offset;
  neck: Offset;
  hip: Offset;
  /** One stroke through both arms (hand -> shoulder -> hand). */
  arms: Offset[];
  /** One stroke through the legs (standing: foot -> hip -> foot). */
  legs: Offset[];
}

const STAND_LEGS: Offset[] = [[-12, 0], [0, -40], [12, 0]];
// Profile view: one visible leg, thigh just above the seat (no doubled line),
// knee past the chair's front leg (x 18), shin straight down in front of it.
const SIT_HIP = -48;
const SIT_LEGS: Offset[] = [[0, SIT_HIP], [32, SIT_HIP], [34, 0]];

// Offsets for a right-facing figure; seat height 45 matches the chair prop,
// typing hands at -70 reach a desk top (desk height 70).
const POSES: Record<ComicPose, PoseGeometry> = {
  stand: { head: [0, -92], neck: [0, -80], hip: [0, -40], arms: [[-14, -48], [0, -72], [14, -48]], legs: STAND_LEGS },
  wave: { head: [0, -92], neck: [0, -80], hip: [0, -40], arms: [[-14, -48], [0, -72], [18, -86], [22, -108]], legs: STAND_LEGS },
  sit: { head: [0, -97], neck: [0, -85], hip: [0, SIT_HIP], arms: [[24, -60], [10, -58], [0, -77], [12, -56], [26, -62]], legs: SIT_LEGS },
  type: { head: [10, -96], neck: [6, -84], hip: [0, SIT_HIP], arms: [[44, -72], [22, -60], [4, -76], [24, -58], [46, -70]], legs: SIT_LEGS },
};

export interface FigureInput {
  id: string;
  x: number;
  y: number;
  pose?: ComicPose;
  facing?: ComicFacing;
  scale?: number;
}

export interface Figure {
  shapes: SceneShape[];
  head: Pt & { r: number };
}

export function stickFigure(input: FigureInput): Figure {
  const scale = input.scale ?? 1;
  const at = placer({ x: input.x, y: input.y }, scale, input.facing);
  const pose = POSES[input.pose ?? 'stand'];
  const base = `char:${input.id}`;
  const group = { group: base };
  const head = { ...at(pose.head), r: HEAD_R * scale };
  return {
    head,
    shapes: [
      circle(`${base}:head`, head, head.r, group),
      polyline(`${base}:body`, [at(pose.neck), at(pose.hip)], group),
      polyline(`${base}:arms`, pose.arms.map(at), group),
      polyline(`${base}:legs`, pose.legs.map(at), group),
    ],
  };
}
