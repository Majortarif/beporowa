/**
 * Which চ্যালেঞ্জ is on today and this week, which word of the day goes with it, and which
 * Bangla season it is. Everything comes from the date alone, so every player gets the same
 * challenge without asking a server, and tests can pin any day.
 */

import {
  CHALLENGE_UTC_OFFSET_HOURS,
  DAILY_CHALLENGES,
  SEASONS,
  WEEKLY_CHALLENGES,
  type ChallengeDef,
  type ChallengeGoal,
  type SeasonName,
} from '../config/challenges';
import { toBongabdo } from '../i18n/bongabdo';

const DAY_MS = 86400000;

/** FNV-1a: a small, steady hash, the same in every browser. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The calendar date in Bangladesh, as Y, M, D, at this moment. */
function dhakaParts(now: Date): { year: number; month: number; day: number } {
  const shifted = new Date(now.getTime() + CHALLENGE_UTC_OFFSET_HOURS * 3600000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** Today's key in Bangladesh, such as 2026-11-10. */
export function challengeDay(now: Date): string {
  const { year, month, day } = dhakaParts(now);
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** This week's key, by ISO week, such as 2026-W46. */
export function challengeWeek(now: Date): string {
  const { year, month, day } = dhakaParts(now);
  const date = new Date(Date.UTC(year, month - 1, day));
  // ISO weeks start on Monday, and a week belongs to the year that holds its Thursday.
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / DAY_MS + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad(week)}`;
}

/** The day before a day key. */
export function previousDay(dayKey: string): string {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day) - DAY_MS);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Days since 1 January 1970 for a day key. */
function dayNumber(dayKey: string): number {
  const [year, month, day] = dayKey.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** The order the daily challenges come round in one cycle, shuffled the same way everywhere. */
function cycleOrder(cycle: number): number[] {
  const order = DAILY_CHALLENGES.map((_, index) => index);
  let seed = hashString(`cycle:${cycle}`) || 1;
  for (let i = order.length - 1; i > 0; i--) {
    // xorshift32: small and the same in every browser.
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    const j = (seed >>> 0) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** A cycle's order, with its first day never repeating the last day of the cycle before. */
function fairOrder(cycle: number): number[] {
  const order = cycleOrder(cycle);
  const before = cycleOrder(cycle - 1);
  if (order[0] === before[before.length - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

/**
 * Today's challenge. Each comes round once in every cycle of days, in a shuffled order,
 * and never the same one two days running.
 */
export function dailyChallengeFor(dayKey: string): ChallengeDef {
  const length = DAILY_CHALLENGES.length;
  const day = dayNumber(dayKey);
  const cycle = Math.floor(day / length);
  return DAILY_CHALLENGES[fairOrder(cycle)[day - cycle * length]];
}

export function weeklyChallengeFor(weekKey: string): ChallengeDef {
  return WEEKLY_CHALLENGES[hashString(`weekly:${weekKey}`) % WEEKLY_CHALLENGES.length];
}

/** Which of the words of the day goes with a day. */
export function wordIndexFor(dayKey: string, count: number): number {
  return count > 0 ? hashString(`word:${dayKey}`) % count : 0;
}

export interface SeasonInfo {
  /** Stays the same for the whole season, and changes with the next one: 1433-borsha. */
  id: string;
  name: SeasonName;
  /** 0 is গ্রীষ্ম. */
  index: number;
  bongabdoYear: number;
  /** Whole days left, today included. */
  daysLeft: number;
}

function seasonIndexOf(date: Date): { index: number; year: number } {
  const bongabdo = toBongabdo(date);
  return { index: Math.floor(bongabdo.monthIndex / 2), year: bongabdo.year };
}

/** The Bangla season on a Bangladesh calendar day. */
export function seasonFor(dayKey: string): SeasonInfo {
  const [year, month, day] = dayKey.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  const { index, year: bongabdoYear } = seasonIndexOf(date);
  let daysLeft = 1;
  const probe = new Date(date);
  for (let i = 0; i < 70; i++) {
    probe.setDate(probe.getDate() + 1);
    if (seasonIndexOf(probe).index !== index) break;
    daysLeft++;
  }
  const name = SEASONS[index];
  return { id: `${bongabdoYear}-${name}`, name, index, bongabdoYear, daysLeft };
}

/**
 * Seconds a goal allows on a course, for the goals that are a pace.
 * @param distance metres of the whole race
 * @returns null for goals that are not a pace
 */
export function paceSeconds(goal: ChallengeGoal, distance: number): number | null {
  if (goal.kind !== 'pace' || distance <= 0) return null;
  return Math.round((distance / (goal.kmh / 3.6)) * 10) / 10;
}
