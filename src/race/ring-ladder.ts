/**
 * দ্য রিং's rules for moving up: which events are open, and what a result is worth.
 * Pure logic with no storage or screens of its own.
 */

import { RACE_EVENTS, type RaceEventDef } from '../config/race-events';
import { PROGRESS } from '../config/progression';
import { RACE } from '../config/race-tuning';
import { bumpStat, earn } from '../progression/economy';
import type { CareerData, EventRecord } from '../save/career';
import type { RaceOutcome } from './race-session';

/** The rival the player is working on now. */
export function currentTier(career: CareerData): number {
  return Math.max(1, career.rank - 1);
}

/** The warm-ups of a tier, which come before its rival. */
export function warmupsOf(tier: number): RaceEventDef[] {
  return RACE_EVENTS.filter((event) => event.tier === tier && !event.rivalRace);
}

export function rivalRaceOf(tier: number): RaceEventDef | undefined {
  return RACE_EVENTS.find((event) => event.tier === tier && event.rivalRace);
}

export function eventsOfTier(tier: number): RaceEventDef[] {
  return RACE_EVENTS.filter((event) => event.tier === tier);
}

/** A rival's tier is open once the rival above in the ladder's order has been beaten. */
export function isTierOpen(tier: number, career: CareerData): boolean {
  return career.freePlay || tier >= currentTier(career);
}

export function isCompleted(eventId: string, career: CareerData): boolean {
  return career.events[eventId]?.completed === true;
}

export type LockReason = 'none' | 'tier' | 'warmups';

/** Why an event cannot be raced yet. */
export function lockReason(event: RaceEventDef, career: CareerData): LockReason {
  if (career.freePlay) return 'none';
  if (!isTierOpen(event.tier, career)) return 'tier';
  // A rival already beaten can always be raced again.
  if (event.rivalRace && event.tier === currentTier(career) && career.rank > event.tier) {
    const done = warmupsOf(event.tier).some((warmup) => isCompleted(warmup.id, career));
    if (!done) return 'warmups';
  }
  return 'none';
}

export function isUnlocked(event: RaceEventDef, career: CareerData): boolean {
  return lockReason(event, career) === 'none';
}

export interface ResultChange {
  pointsGained: number;
  cashGained: number;
  /** The level reached, if this raised it. */
  levelUp: number | null;
  newMedal: boolean;
  newBest: boolean;
  rivalBeaten: boolean;
  /** The rank the player has climbed to, if it changed. */
  newRank: number | null;
  /** The whole ladder is done. */
  champion: boolean;
}

/** Writes a finished race into the career. */
export function applyResult(career: CareerData, outcome: RaceOutcome): ResultChange {
  const event = outcome.event;
  const before: EventRecord = career.events[event.id] ?? { medal: 0, bestMs: null, bestScore: null, completed: false };
  const record: EventRecord = { ...before };
  const change: ResultChange = { pointsGained: 0, cashGained: 0, levelUp: null, newMedal: false, newBest: false, rivalBeaten: false, newRank: null, champion: false };

  if (outcome.completed) {
    record.completed = true;
    if (outcome.medal > record.medal) {
      record.medal = outcome.medal;
      change.newMedal = true;
    }
    if (record.bestMs === null || outcome.timeMs < record.bestMs) {
      if (record.bestMs !== null) change.newBest = true;
      record.bestMs = outcome.timeMs;
    }
    if (outcome.score > (record.bestScore ?? 0)) {
      if (record.bestScore !== null) change.newBest = true;
      record.bestScore = outcome.score;
    }
    // A better medal pays in full, and a repeat pays a little.
    const rewards = RACE.rewards;
    const share = rewards.medalShare[3 - Math.max(1, outcome.medal)];
    const earned = Math.round(event.points * share * (change.newMedal ? 1 : rewards.replayShare));
    change.pointsGained = earned;
    if (outcome.rivalBeaten && event.tier < career.rank) {
      change.rivalBeaten = true;
      change.newRank = event.tier;
      change.pointsGained += rewards.rivalBeatenBonus;
      career.rank = event.tier;
      if (event.tier === 1) {
        career.champion = true;
        change.champion = true;
      }
    }
    change.cashGained = Math.round(earned * PROGRESS.raceCashPerPoint) + (change.rivalBeaten ? PROGRESS.rivalBeatenCash : 0);
    change.levelUp = earn(career, change.cashGained, change.pointsGained).levelUp;
    if (outcome.position === 1 && outcome.racers > 1) bumpStat(career, 'raceWins');
    if (outcome.medal === 3 && change.newMedal) bumpStat(career, 'golds');
    if (change.rivalBeaten) bumpStat(career, 'rivalsBeaten');
    if (event.mode === 'delivery') bumpStat(career, 'deliveries');
  }
  career.events[event.id] = record;
  return change;
}
