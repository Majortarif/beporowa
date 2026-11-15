/**
 * Whether a run met a challenge, and what it is worth. Pure rules on plain numbers, so tests can
 * run them and the leaderboard server can use the same ones.
 */

import type { ChallengeDef } from '../config/challenges';
import type { ChallengeRecord, CareerData } from '../save/career';
import { paceSeconds } from './challenge-calendar';

/** What a run did, in the numbers a challenge looks at. */
export interface ChallengeRun {
  completedCleanly: boolean;
  timeMs: number;
  medal: number;
  score: number;
}

export interface ChallengeVerdict {
  met: boolean;
  /** What goes on the leaderboard: ms for time, points for score. Null if the run cannot rank. */
  value: number | null;
}

/**
 * Judges a race run against a challenge.
 * @param distance metres of the whole race, for pace goals
 */
export function judgeRun(def: ChallengeDef, run: ChallengeRun, distance: number): ChallengeVerdict {
  const goal = def.goal;
  let met = false;
  if (run.completedCleanly) {
    switch (goal.kind) {
      case 'pace': {
        const allowed = paceSeconds(goal, distance);
        met = allowed !== null && run.timeMs / 1000 <= allowed;
        break;
      }
      case 'medal':
        met = run.medal >= goal.medal;
        break;
      case 'score':
        met = run.score >= goal.points;
        break;
      default:
        met = false;
    }
  }
  let value: number | null = null;
  if (run.completedCleanly) {
    if (def.rank === 'time') value = Math.round(run.timeMs);
    else if (def.rank === 'score') value = Math.round(run.score);
  }
  return { met, value };
}

/** Whether a new value beats an old one, for this challenge's kind of ranking. */
export function isBetter(def: ChallengeDef, value: number, best: number | null): boolean {
  if (best === null) return true;
  return def.rank === 'score' ? value > best : value < best;
}

export interface ChallengeAward {
  firstClear: boolean;
  newBest: boolean;
  xp: number;
  cash: number;
}

/** The most attempts that still earn season points in one day or week, so the pass cannot be farmed. */
export const PAID_ATTEMPTS = 5;
export const ATTEMPT_XP = 40;

/**
 * Writes a run into the save.
 * @param key day:id or week:id
 */
export function recordChallenge(career: CareerData, def: ChallengeDef, key: string, verdict: ChallengeVerdict): ChallengeAward {
  const record: ChallengeRecord = career.challenges[key] ?? { done: false, best: null, attempts: 0 };
  record.attempts++;
  const award: ChallengeAward = { firstClear: false, newBest: false, xp: record.attempts <= PAID_ATTEMPTS ? ATTEMPT_XP : 0, cash: 0 };
  if (verdict.met && !record.done) {
    record.done = true;
    award.firstClear = true;
    award.xp += def.xp;
    award.cash = def.cash;
    career.cash += def.cash;
  }
  if (verdict.value !== null && isBetter(def, verdict.value, record.best)) {
    record.best = verdict.value;
    award.newBest = true;
  }
  career.challenges[key] = record;
  return award;
}

/** Forgets challenge records older than the ones still worth keeping. */
export function pruneChallenges(career: CareerData, keepKeys: readonly string[]): void {
  const keepPrefixes = new Set(keepKeys.map((key) => key.split(':')[0]));
  for (const key of Object.keys(career.challenges)) {
    if (!keepPrefixes.has(key.split(':')[0])) delete career.challenges[key];
  }
}
