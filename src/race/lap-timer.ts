/** Lap timing along the track path, with sector checks so short cuts do not count. */

import type { EventBus } from '../core/events';
import type { TrackPath } from '../world/track-path';

const SECTORS = 4;
const SEARCH_WINDOW = 14;

export class LapTimer {
  /** Laps finished so far; the current lap number is this plus one. */
  completed = 0;
  currentMs = 0;
  bestMs: number | null;
  lastMs: number | null = null;
  /** False after a reset, until the car crosses the line again. */
  valid = true;
  /** True when moving against the track direction. */
  wrongWay = false;

  private running = false;
  private index: number;
  private sectorsSeen = 0;
  private wrongWayTime = 0;

  constructor(
    private readonly track: TrackPath,
    private readonly bus: EventBus,
    startIndex: number,
    savedBestMs: number | null,
  ) {
    this.index = startIndex;
    this.bestMs = savedBestMs;
  }

  get currentLap(): number {
    return this.completed + 1;
  }

  get hasStarted(): boolean {
    return this.running;
  }

  update(dt: number, x: number, z: number, velocityX: number, velocityZ: number, speed: number): void {
    const track = this.track;
    const previous = this.index;
    let next = track.nearestIndex(x, z, previous, SEARCH_WINDOW);
    // Far from the local window, for example after crossing the infield.
    if (track.distanceToSample(next, x, z) > 45) next = track.nearestIndexGlobal(x, z);
    this.index = next;

    if (this.running) this.currentMs += dt * 1000;

    const sector = Math.floor((next / track.count) * SECTORS);
    this.sectorsSeen |= 1 << sector;

    const nearStart = next < track.count * 0.08;
    const nearEnd = previous > track.count * 0.92;
    if (nearStart && nearEnd) this.crossLine();

    const dot = velocityX * track.tangents[next * 3] + velocityZ * track.tangents[next * 3 + 2];
    if (speed > 8 && dot < -speed * 0.5) this.wrongWayTime += dt;
    else this.wrongWayTime = 0;
    this.wrongWay = this.wrongWayTime > 1;
  }

  /** A reset teleports the car, so this lap stops counting until the next crossing. */
  invalidate(x: number, z: number): void {
    this.valid = false;
    this.index = this.track.nearestIndexGlobal(x, z);
  }

  /** Full restart: forgets the lap in progress but keeps the best time. */
  restart(startIndex: number): void {
    this.running = false;
    this.valid = true;
    this.completed = 0;
    this.currentMs = 0;
    this.lastMs = null;
    this.sectorsSeen = 0;
    this.index = startIndex;
  }

  private crossLine(): void {
    const allSectors = this.sectorsSeen === (1 << SECTORS) - 1;
    if (this.running && this.valid && allSectors) {
      const time = this.currentMs;
      const isBest = this.bestMs === null || time < this.bestMs;
      if (isBest) this.bestMs = time;
      this.lastMs = time;
      this.completed++;
      this.bus.emit('lapComplete', { timeMs: time, isBest, lap: this.completed });
    }
    this.running = true;
    this.valid = true;
    this.currentMs = 0;
    this.sectorsSeen = 0;
  }
}
