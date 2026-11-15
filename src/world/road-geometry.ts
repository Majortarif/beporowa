/** Road and shoulder vertex data from the track path. No DOM here, so tests can drive on the real road. */

import { TUNING } from '../config/tuning';
import type { TrackPath } from './track-path';

/** Lane-paint texture repeats every this many metres of road. */
export const ROAD_TILE_LENGTH = 24;
const DIRT_TILE_LENGTH = 8;

export interface RoadGeometryData {
  roadPositions: Float32Array;
  roadUvs: Float32Array;
  roadIndices: Uint32Array;
  shoulderPositions: Float32Array;
  shoulderUvs: Float32Array;
  shoulderIndices: Uint32Array;
}

export function computeRoadGeometry(track: TrackPath): RoadGeometryData {
  const world = TUNING.world;
  const halfWidth = world.roadHalfWidth;
  const n = track.count;

  // One extra ring of vertices closes the loop with continuous UVs.
  const roadPositions = new Float32Array((n + 1) * 2 * 3);
  const roadUvs = new Float32Array((n + 1) * 2 * 2);
  const shoulderPositions = new Float32Array((n + 1) * 4 * 3);
  const shoulderUvs = new Float32Array((n + 1) * 4 * 2);

  for (let ring = 0; ring <= n; ring++) {
    const i = ring % n;
    const x = track.x(i);
    const y = track.y(i);
    const z = track.z(i);
    const sx = track.sides[i * 3];
    const sz = track.sides[i * 3 + 2];
    const distance = ring * track.spacing;
    const v = distance / ROAD_TILE_LENGTH;

    roadPositions.set([x + sx * halfWidth, y, z + sz * halfWidth, x - sx * halfWidth, y, z - sz * halfWidth], ring * 6);
    roadUvs.set([0, v, 1, v], ring * 4);

    const drop = y - world.groundY;
    const shoulder = world.shoulderBaseWidth + drop * world.shoulderPerHeight;
    const outer = halfWidth + shoulder;
    shoulderPositions.set(
      [
        x + sx * outer, world.groundY, z + sz * outer,
        x + sx * halfWidth, y, z + sz * halfWidth,
        x - sx * halfWidth, y, z - sz * halfWidth,
        x - sx * outer, world.groundY, z - sz * outer,
      ],
      ring * 12,
    );
    const dirtV = distance / DIRT_TILE_LENGTH;
    shoulderUvs.set([0, dirtV, shoulder / DIRT_TILE_LENGTH, dirtV, 0, dirtV, shoulder / DIRT_TILE_LENGTH, dirtV], ring * 8);
  }

  const roadIndices = new Uint32Array(n * 6);
  const shoulderIndices = new Uint32Array(n * 12);
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = a + 1;
    const a2 = a + 2;
    const b2 = a + 3;
    roadIndices.set([a, b, a2, b, b2, a2], i * 6);
    const s = i * 4;
    shoulderIndices.set(
      [
        s, s + 1, s + 4, s + 1, s + 5, s + 4,
        s + 2, s + 3, s + 6, s + 3, s + 7, s + 6,
      ],
      i * 12,
    );
  }

  return { roadPositions, roadUvs, roadIndices, shoulderPositions, shoulderUvs, shoulderIndices };
}
