/**
 * The replay's film director: a sequence of shots that cuts around the car, and how fast to run.
 * It only needs to know where the car was, so it works from the buffer and can be tested headless.
 */

import { createRng } from '../core/math';
import type { ReplayEvent } from './replay-buffer';

export type ShotKind = 'chase' | 'low' | 'side' | 'trackside' | 'orbit' | 'heli' | 'hood';
export type CameraChoice = 'auto' | ShotKind;

export const SHOT_KINDS: readonly ShotKind[] = ['chase', 'low', 'side', 'trackside', 'orbit', 'heli', 'hood'];

export interface Shot {
  kind: ShotKind;
  from: number;
  to: number;
  /** Which side of the car, and a little variety in distance. */
  side: number;
  variety: number;
}

export interface ShotPose {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
}

/** Cuts the whole replay into shots, never the same kind twice running. */
export function planShots(start: number, end: number, seed = 5): Shot[] {
  const random = createRng(seed);
  const shots: Shot[] = [];
  let time = start;
  let last: ShotKind | null = null;
  // Most of the film is spent close to the action. The hood camera is only a seasoning.
  const weights: Array<[ShotKind, number]> = [
    ['chase', 3],
    ['trackside', 4],
    ['side', 3],
    ['low', 3],
    ['orbit', 2],
    ['heli', 2],
    ['hood', 1],
  ];
  while (time < end) {
    const length = 2.8 + random() * 3.4;
    const open = weights.filter(([kind]) => kind !== last);
    const total = open.reduce((sum, [, weight]) => sum + weight, 0);
    let pick = random() * total;
    let kind = open[0][0];
    for (const [candidate, weight] of open) {
      pick -= weight;
      if (pick <= 0) {
        kind = candidate;
        break;
      }
    }
    const to = Math.min(end, time + length);
    shots.push({ kind, from: time, to, side: random() < 0.5 ? -1 : 1, variety: random() });
    last = kind;
    time = to;
  }
  return shots;
}

export function shotAt(shots: readonly Shot[], time: number): Shot | null {
  for (const shot of shots) {
    if (time >= shot.from && time <= shot.to) return shot;
  }
  return shots.length > 0 ? shots[shots.length - 1] : null;
}

/** How fast the film runs at this moment: it slows for a crash or a close shave. */
export function pace(events: readonly ReplayEvent[], time: number): number {
  let slow = 1;
  for (const event of events) {
    if (event.kind === 'nitro' || event.kind === 'splash') continue;
    const away = Math.abs(event.time - time);
    if (away < 1.1) {
      const amount = 1 - away / 1.1;
      slow = Math.min(slow, 1 - amount * (event.kind === 'nearMiss' ? 0.5 : 0.68));
    }
  }
  return slow;
}

export interface CarView {
  x: number;
  y: number;
  z: number;
  /** Forward, on the ground. */
  fx: number;
  fz: number;
}

/**
 * Where the camera stands for this shot.
 * @param anchor for a fixed trackside camera, where the car will be halfway through the shot
 */
export function poseFor(kind: ShotKind, car: CarView, anchor: CarView, time: number, shot: Shot, out: ShotPose): ShotPose {
  const { fx, fz } = car;
  // Left of travel is (fz, -fx).
  const leftX = fz * shot.side;
  const leftZ = -fx * shot.side;
  out.lookX = car.x;
  out.lookY = car.y + 0.25;
  out.lookZ = car.z;
  switch (kind) {
    case 'chase':
      out.x = car.x - fx * 6.6;
      out.y = car.y + 2.1;
      out.z = car.z - fz * 6.6;
      out.lookX = car.x + fx * 3;
      out.lookZ = car.z + fz * 3;
      out.fov = 60;
      break;
    case 'low':
      out.x = car.x + fx * 3.2 + leftX * 1.8;
      out.y = car.y - 0.28;
      out.z = car.z + fz * 3.2 + leftZ * 1.8;
      out.fov = 54;
      break;
    case 'side':
      out.x = car.x + leftX * (5.2 + shot.variety * 2) - fx * 0.8;
      out.y = car.y + 0.5;
      out.z = car.z + leftZ * (5.2 + shot.variety * 2) - fz * 0.8;
      out.fov = 46;
      break;
    case 'trackside': {
      // A long lens on a tripod beside the road, panning to follow the car past.
      const sideX = anchor.fz * shot.side;
      const sideZ = -anchor.fx * shot.side;
      out.x = anchor.x + sideX * (7 + shot.variety * 3);
      out.y = anchor.y + 0.9 + shot.variety * 0.8;
      out.z = anchor.z + sideZ * (7 + shot.variety * 3);
      const distance = Math.hypot(car.x - out.x, car.z - out.z);
      out.fov = Math.max(24, Math.min(62, 1700 / Math.max(distance, 26)));
      break;
    }
    case 'orbit': {
      const angle = (time - shot.from) * 0.55 * shot.side + shot.variety * 6.28;
      out.x = car.x + Math.sin(angle) * 7.4;
      out.y = car.y + 1.5;
      out.z = car.z + Math.cos(angle) * 7.4;
      out.fov = 50;
      break;
    }
    case 'heli':
      out.x = car.x - fx * 15 + leftX * 6;
      out.y = car.y + 13;
      out.z = car.z - fz * 15 + leftZ * 6;
      out.fov = 44;
      break;
    case 'hood':
      out.x = car.x + fx * 0.7;
      out.y = car.y + 0.5;
      out.z = car.z + fz * 0.7;
      out.lookX = car.x + fx * 30;
      out.lookY = car.y + 0.3;
      out.lookZ = car.z + fz * 30;
      out.fov = 72;
      break;
  }
  return out;
}
