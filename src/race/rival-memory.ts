/**
 * What the rivals remember about how you drive: which side you pass on, when you use nitro,
 * how often you crash, and by how much you usually win. Saved with your career.
 * Adaptive rivals read this to prepare, and it can only ever change how they choose to drive.
 */

import { PROGRESS } from '../config/progression';
import { RACE } from '../config/race-tuning';
import type { RivalTraits } from '../config/rivals';
import { clamp } from '../core/math';

export interface MemoryData {
  /** Passes made on each side of a rival. */
  passLeft: number;
  passRight: number;
  /** Average share of a race at which you first use nitro. */
  nitroTiming: number;
  /** Crashes per kilometre. */
  crashRate: number;
  /** Average finish margin in seconds: positive when you win. */
  margin: number;
  races: number;
}

export function createMemory(): MemoryData {
  return { passLeft: 0, passRight: 0, nitroTiming: 0.5, crashRate: 0.3, margin: 0, races: 0 };
}

/** Notes habits during one race. */
export class PlayerObserver {
  passLeft = 0;
  passRight = 0;
  firstNitro: number | null = null;
  crashes = 0;

  notePass(onLeft: boolean): void {
    if (onLeft) this.passLeft++;
    else this.passRight++;
  }

  noteNitro(progressShare: number): void {
    if (this.firstNitro === null) this.firstNitro = clamp(progressShare, 0, 1);
  }

  noteCrash(): void {
    this.crashes++;
  }

  reset(): void {
    this.passLeft = 0;
    this.passRight = 0;
    this.firstNitro = null;
    this.crashes = 0;
  }
}

/** Blends one race into what is remembered. Old habits fade, so changing your style is noticed. */
export function absorbRace(memory: MemoryData, observer: PlayerObserver, kilometres: number, margin: number): void {
  const rate = memory.races === 0 ? 1 : RACE.memory.learnRate;
  memory.passLeft = memory.passLeft * 0.8 + observer.passLeft;
  memory.passRight = memory.passRight * 0.8 + observer.passRight;
  if (observer.firstNitro !== null) memory.nitroTiming += (observer.firstNitro - memory.nitroTiming) * rate;
  memory.crashRate += (observer.crashes / Math.max(kilometres, 0.2) - memory.crashRate) * rate;
  memory.margin += (margin - memory.margin) * rate;
  memory.races++;
}

/** The side you tend to pass on: 1 for left, -1 for right, 0 if there is no clear habit. */
export function preferredSide(memory: MemoryData): number {
  const total = memory.passLeft + memory.passRight;
  if (total < RACE.memory.sideMinimum) return 0;
  const share = memory.passLeft / total;
  if (share > 0.6) return 1;
  if (share < 0.4) return -1;
  return 0;
}

/**
 * Scales a rival's car to the player's. Skill is not touched: only the machine,
 * and within the limits set in the config.
 */
export function scaleToCar(traits: RivalTraits, scale: number): RivalTraits {
  const config = PROGRESS.balance;
  return {
    ...traits,
    power: traits.power * scale,
    topSpeed: traits.topSpeed * (1 + (scale - 1) * config.topSpeedShare),
    grip: traits.grip * (1 + (scale - 1) * config.gripShare),
    cornerLateral: traits.cornerLateral * (1 + (scale - 1) * config.cornerShare),
  };
}

/**
 * The traits a rival actually races with. Every rival adjusts a little to your record, within
 * small limits. Adaptive rivals also change their plan to fit your habits.
 */
export function adaptTraits(traits: RivalTraits, memory: MemoryData): RivalTraits {
  const config = RACE.memory;
  const adapted: RivalTraits = { ...traits };
  if (memory.races === 0) return adapted;
  // Win by a lot and they sharpen up, keep losing and they ease off.
  const skill = clamp(memory.margin / config.marginForFullSkill, -1, 1);
  adapted.power += skill * config.skillPower;
  adapted.cornerLateral += skill * config.skillCorner;
  if (traits.adaptive) {
    // Come out with nitro before you usually do, so that yours has to chase.
    adapted.nitroStart = clamp(memory.nitroTiming - config.nitroEarlierBy, 0.1, 0.85);
    // Someone who crashes a lot can be crowded into it.
    adapted.aggression += clamp(memory.crashRate / config.crashesForFull, 0, 1) * config.crashAggression;
    // A clear passing habit means blocking is worth the effort.
    if (preferredSide(memory) !== 0) adapted.block = Math.min(1, adapted.block + 0.2);
  }
  return adapted;
}
