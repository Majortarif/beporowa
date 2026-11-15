/**
 * Watches what happens in the game and keeps the career's running counts, achievements and
 * side jobs up to date. It knows nothing of the screen: it reports through callbacks.
 */

import { ACHIEVEMENTS, JOB_BY_ID, type AchievementDef, type JobDef } from '../config/achievements';
import type { EventBus } from '../core/events';
import type { CareerData } from '../save/career';
import { bumpStat, earn } from './economy';

export class ProgressTracker {
  /** An achievement was just earned. */
  onAchievement: ((achievement: AchievementDef) => void) | null = null;
  /** A job was finished, or failed. */
  onJobDone: ((job: JobDef) => void) | null = null;
  onJobFailed: ((job: JobDef) => void) | null = null;
  /** Reaching a level. */
  onLevelUp: ((level: number) => void) | null = null;
  private metres = 0;

  constructor(
    bus: EventBus,
    private readonly career: () => CareerData,
    /** Whether to count anything: test drives and menus do not. */
    private readonly saveSoon: () => void,
  ) {
    bus.on('nearMiss', ({ squeeze }) => {
      this.count('nearMisses');
      if (squeeze) this.count('squeezes');
    });
    bus.on('driftEnd', ({ points }) => this.count('driftPoints', points));
    bus.on('trapSprung', () => this.count('traps'));
    bus.on('pursuitEscaped', ({ stars }) => {
      this.count('escapes');
      if (stars >= 5) this.count('fiveStarEscapes');
    });
    bus.on('pursuitBusted', () => this.count('busts'));
    bus.on('raceLaunch', ({ perfect }) => {
      if (perfect) this.count('perfectLaunches');
    });
    bus.on('raceShift', ({ perfect }) => {
      if (perfect) this.count('perfectShifts');
    });
    bus.on('targetDown', () => this.count('takedowns'));
  }

  /** Raises a count, and sees whether it earned anything. */
  count(key: Parameters<typeof bumpStat>[1], amount = 1): void {
    bumpStat(this.career(), key, amount);
    this.check();
  }

  /** Called each frame: distance and held দম add up slowly, so they are counted in bulk. */
  frame(dt: number, speed: number, domActive: boolean, runClock = true): void {
    this.metres += speed * dt;
    if (this.metres >= 500) {
      this.count('kilometres', this.metres / 1000);
      this.metres = 0;
    }
    if (domActive) {
      bumpStat(this.career(), 'domSeconds', dt);
      // Checked now and then only, since this runs every frame.
      if ((this.career().stats.domSeconds ?? 0) % 1 < dt) this.check();
    }
    if (runClock) this.updateJobClock(dt);
  }

  /** Checks every achievement, and the job in hand. */
  check(): void {
    const career = this.career();
    for (const achievement of ACHIEVEMENTS) {
      if (career.achievements[achievement.id]) continue;
      if ((career.stats[achievement.stat] ?? 0) < achievement.target) continue;
      career.achievements[achievement.id] = true;
      this.pay(achievement.cash, achievement.rep);
      this.onAchievement?.(achievement);
      this.saveSoon();
    }
    this.checkJob();
  }

  private pay(cash: number, rep: number): void {
    const result = earn(this.career(), cash, rep);
    if (result.levelUp !== null) this.onLevelUp?.(result.levelUp);
  }

  // ---------- Side jobs ----------

  /** Takes on a job. @returns false if one is already in hand */
  acceptJob(id: string): boolean {
    const career = this.career();
    const job = JOB_BY_ID.get(id);
    if (!job || career.job) return false;
    career.job = {
      id,
      startValue: job.stat ? career.stats[job.stat] ?? 0 : 0,
      secondsLeft: job.seconds ?? 0,
    };
    this.saveSoon();
    return true;
  }

  /** How far along the job in hand is, from 0 to 1. */
  jobShare(): number {
    const career = this.career();
    const active = career.job;
    if (!active) return 0;
    const job = JOB_BY_ID.get(active.id);
    if (!job?.stat || !job.amount) return 0;
    return Math.min(1, ((career.stats[job.stat] ?? 0) - active.startValue) / job.amount);
  }

  private checkJob(): void {
    const career = this.career();
    const active = career.job;
    if (!active) return;
    const job = JOB_BY_ID.get(active.id);
    if (!job?.stat || !job.amount) return;
    if ((career.stats[job.stat] ?? 0) - active.startValue >= job.amount) this.finishJob(job);
  }

  /** The car reached the place a job was asking for. */
  arrivedAtJobPlace(): void {
    const active = this.career().job;
    const job = active ? JOB_BY_ID.get(active.id) : undefined;
    if (job?.kind === 'goto') this.finishJob(job);
  }

  private finishJob(job: JobDef): void {
    const career = this.career();
    career.job = null;
    if (!career.jobsDone.includes(job.id)) career.jobsDone.push(job.id);
    this.pay(job.cash, job.rep);
    bumpStat(career, 'jobsDone');
    this.onJobDone?.(job);
    this.saveSoon();
    this.check();
  }

  private updateJobClock(dt: number): void {
    const career = this.career();
    const active = career.job;
    if (!active) return;
    const job = JOB_BY_ID.get(active.id);
    if (job?.kind !== 'goto') return;
    active.secondsLeft -= dt;
    if (active.secondsLeft <= 0) {
      career.job = null;
      this.onJobFailed?.(job);
      this.saveSoon();
    }
  }

  /** Gives up on the job in hand. */
  dropJob(): void {
    this.career().job = null;
    this.saveSoon();
  }
}
