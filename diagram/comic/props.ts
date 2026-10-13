// Simple line-art props. (x,y) is the bottom centre: the floor for desk,
// table, chair, bed and door; the desk top (desk y - 70*scale) for monitor
// and laptop. Offsets are drawn facing right and mirrored for facing left.
import type { ComicFacing, ComicPropKind } from '../types';
import type { SceneShape } from '../freeform';
import { box, circle, placer, polyline, type Offset, type Pt } from './draw';

export interface PropInput {
  id: string;
  kind: ComicPropKind;
  x: number;
  y: number;
  scale?: number;
  facing?: ComicFacing;
}

type Place = (o: Offset) => Pt;
type Builder = (base: string, at: Place) => SceneShape[];

const line = (id: string, at: Place, offsets: Offset[]) => polyline(id, offsets.map(at));

const BUILDERS: Record<ComicPropKind, Builder> = {
  desk: (base, at) => [line(base, at, [[-60, 0], [-60, -70], [60, -70], [60, 0]])],
  table: (base, at) => [line(base, at, [[-45, 0], [-45, -55], [45, -55], [45, 0]])],
  // Chair faces right: back on the left, seat at height 45.
  chair: (base, at) => [
    line(`${base}:back`, at, [[-18, -90], [-18, 0]]),
    line(`${base}:seat`, at, [[-18, -45], [18, -45], [18, 0]]),
  ],
  monitor: (base, at) => [
    box(`${base}:screen`, at([-28, -52]), at([28, -14])),
    line(`${base}:stand`, at, [[-12, 0], [0, 0], [0, -14], [0, 0], [12, 0]]),
  ],
  laptop: (base, at) => [line(base, at, [[20, 0], [-20, 0], [-26, -28]])],
  bed: (base, at) => [
    line(base, at, [[-70, 0], [-70, -50], [-70, -30], [70, -30], [70, 0]]),
    { ...circle(`${base}:pillow`, at([-56, -36]), 8), height: 10 },
  ],
  door: (base, at) => [box(base, at([-25, -110]), at([25, 0])), circle(`${base}:knob`, at([16, -55]), 3)],
};

export function prop(input: PropInput): SceneShape[] {
  const at = placer({ x: input.x, y: input.y }, input.scale, input.facing);
  return BUILDERS[input.kind](`prop:${input.id}`, at);
}
