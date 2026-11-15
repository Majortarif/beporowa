/**
 * The rules of a pursuit, with no driving or drawing in them: heat score and stars,
 * being seen, the cooldown out of sight, and the arrest meter.
 */

import { POLICE, starsForScore } from '../config/police-tuning';
import type { EventBus } from '../core/events';
import { clamp } from '../core/math';

export type PursuitPhase = 'calm' | 'pursuit' | 'evading';

export interface HeatInput {
  /** Some unit can see the player right now. */
  seen: boolean;
  /** How fast the cooldown fills. 1 is normal, more inside a hiding spot. */
  hideFactor: number;
  /** Units close enough to arrest. */
  unitsClose: number;
  /** Player speed, m/s. */
  speed: number;
}

export class HeatSystem {
  phase: PursuitPhase = 'calm';
  score = 0;
  stars = 0;
  /** 0 to 1: how close the pursuit is to ending. */
  cooldown = 0;
  /** 0 to 1: how close the player is to arrest. */
  bust = 0;
  pursuitSeconds = 0;
  /** Above 1 an arrest takes longer. Set from the adaptive difficulty. */
  bustTimeScale = 1;
  private unseenSeconds = 0;

  constructor(private readonly bus: EventBus) {}

  get isActive(): boolean {
    return this.phase !== 'calm';
  }

  /** A patrol saw something. Starts a pursuit if none is running. */
  startPursuit(): void {
    if (this.isActive) return;
    this.phase = 'pursuit';
    this.score = 0;
    this.stars = 1;
    this.cooldown = 0;
    this.bust = 0;
    this.pursuitSeconds = 0;
    this.unseenSeconds = 0;
    this.bus.emit('pursuitPhase', { phase: 'pursuit', previous: 'calm' });
    this.bus.emit('heatLevel', { stars: 1, previous: 0 });
  }

  addHeat(amount: number): void {
    if (!this.isActive) return;
    this.score += amount;
    this.refreshStars();
  }

  private refreshStars(): void {
    const next = starsForScore(this.score);
    if (next > this.stars) {
      const previous = this.stars;
      this.stars = next;
      this.bus.emit('heatLevel', { stars: next, previous });
    }
  }

  update(dt: number, input: HeatInput): void {
    if (!this.isActive) return;
    const heat = POLICE.heat;
    const bust = POLICE.bust;
    this.pursuitSeconds += dt;

    this.score += heat.perSecond * dt;
    if (input.speed * 3.6 > heat.fastSpeedKmh) this.score += heat.perFastSecond * dt;
    this.refreshStars();

    if (input.seen) {
      this.unseenSeconds = 0;
      if (this.phase === 'evading') {
        this.setPhase('pursuit');
      }
      this.cooldown = Math.max(0, this.cooldown - heat.cooldownDecayWhenSeen * dt);
    } else {
      this.unseenSeconds += dt;
      if (this.phase === 'pursuit' && this.unseenSeconds > heat.lostSightDelay) this.setPhase('evading');
    }

    if (this.phase === 'evading') {
      const seconds = POLICE.levels[this.stars - 1].cooldownSeconds;
      this.cooldown = clamp(this.cooldown + (dt / seconds) * input.hideFactor, 0, 1);
      if (this.cooldown >= 1) {
        this.finish('escaped');
        return;
      }
    }

    if (input.unitsClose > 0 && input.speed < bust.speed) {
      const rate = (1 + (input.unitsClose - 1) * bust.extraUnitScale) / (bust.seconds * this.bustTimeScale);
      this.bust = clamp(this.bust + rate * dt, 0, 1);
      if (this.bust >= 1) this.finish('busted');
    } else {
      this.bust = clamp(this.bust - dt / bust.drainSeconds, 0, 1);
    }
  }

  private setPhase(next: PursuitPhase): void {
    const previous = this.phase;
    this.phase = next;
    this.bus.emit('pursuitPhase', { phase: next, previous });
  }

  private finish(result: 'escaped' | 'busted'): void {
    const heat = POLICE.heat;
    const stars = this.stars;
    const seconds = this.pursuitSeconds;
    if (result === 'escaped') {
      const points = Math.round(stars * heat.escapePointsPerStar + seconds * heat.escapePointsPerSecond);
      this.reset();
      this.bus.emit('pursuitEscaped', { stars, seconds, points });
    } else {
      const fine = stars * heat.bustFinePerStar;
      this.reset();
      this.bus.emit('pursuitBusted', { stars, seconds, fine });
    }
  }

  /** Ends everything without a result, for a restart. */
  reset(): void {
    const previous = this.phase;
    this.phase = 'calm';
    this.score = 0;
    this.stars = 0;
    this.cooldown = 0;
    this.bust = 0;
    this.pursuitSeconds = 0;
    this.unseenSeconds = 0;
    if (previous !== 'calm') this.bus.emit('pursuitPhase', { phase: 'calm', previous });
  }
}

/**
 * Keeps pursuits fair over a session: a player who keeps getting caught faces a little less,
 * and one who escapes easily faces a little more.
 */
export class AdaptiveDifficulty {
  value: number;

  constructor(start: number = POLICE.adaptive.start) {
    this.value = clamp(start, POLICE.adaptive.min, POLICE.adaptive.max);
  }

  onBusted(): void {
    this.nudge(POLICE.adaptive.afterBust);
  }

  onEscaped(seconds: number): void {
    const config = POLICE.adaptive;
    // A long fight that still ended in escape counts for less than an easy getaway.
    this.nudge(seconds > config.longPursuitSeconds ? config.afterLongPursuit : config.afterEscape);
  }

  private nudge(amount: number): void {
    this.value = clamp(this.value + amount, POLICE.adaptive.min, POLICE.adaptive.max);
  }

  /** Scale for police speed and power. */
  get speedScale(): number {
    return 1 + (this.value - 1) * POLICE.adaptive.speedInfluence;
  }

  /** Scale for how long an arrest takes: a struggling player gets more time to get moving. */
  get bustTimeScale(): number {
    return 1 + (1 - this.value) * POLICE.adaptive.bustInfluence;
  }

  /** Units in play at a star level, within the machine's limit. */
  unitsFor(stars: number, limit: number): number {
    const base = POLICE.levels[clamp(stars, 1, POLICE.levels.length) - 1].units;
    return clamp(Math.round(base * this.value), 1, limit);
  }
}
