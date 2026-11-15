/**
 * Money, reputation, levels, buying things and daily rewards. Pure rules over the career:
 * no screens or storage here, so all of it can be tested directly.
 */

import type { StatKey } from '../config/achievements';
import { CARS, CAR_BY_ID, CLASS_COST_SCALE, PARTS, PART_LEVEL_NEEDS, type CarDef, type CarStats, type PartKind, PART_KINDS } from '../config/cars';
import { PROGRESS } from '../config/progression';
import type { CareerData, OwnedCar } from '../save/career';
import { newOwnedCar } from '../save/career';

// ---------- Reputation and levels ----------

export function repForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(PROGRESS.levelBase * Math.pow(level - 1, PROGRESS.levelPower));
}

export function levelFor(rep: number): number {
  let level = 1;
  while (level < PROGRESS.levelCap && rep >= repForLevel(level + 1)) level++;
  return level;
}

/** How far through the current level, from 0 to 1. */
export function levelShare(rep: number): number {
  const level = levelFor(rep);
  if (level >= PROGRESS.levelCap) return 1;
  const from = repForLevel(level);
  const to = repForLevel(level + 1);
  return (rep - from) / (to - from);
}

export function bumpStat(career: CareerData, key: StatKey, amount = 1): number {
  const value = (career.stats[key] ?? 0) + amount;
  career.stats[key] = value;
  return value;
}

/** Sets a count to at least this, for streaks and best-evers. */
export function raiseStat(career: CareerData, key: StatKey, value: number): void {
  career.stats[key] = Math.max(career.stats[key] ?? 0, value);
}

export interface EarnResult {
  /** The new level, if this raised it. */
  levelUp: number | null;
}

/** Adds cash and reputation. A new level pays a small bonus of its own. */
export function earn(career: CareerData, cash: number, rep: number): EarnResult {
  const before = levelFor(career.ringPoints);
  career.ringPoints += rep;
  const after = levelFor(career.ringPoints);
  const bonus = (after - before) * PROGRESS.levelUpCash;
  const total = cash + bonus;
  career.cash = Math.max(0, career.cash + total);
  if (total > 0) bumpStat(career, 'cashEarned', total);
  return { levelUp: after > before ? after : null };
}

/** Takes money away, never below nothing. */
export function spend(career: CareerData, amount: number): void {
  career.cash = Math.max(0, career.cash - amount);
}

// ---------- Cars ----------

export type CarLock = 'none' | 'rank' | 'cash';

export function isOwned(career: CareerData, carId: string): boolean {
  return career.cars[carId] !== undefined;
}

/** Why a car cannot be bought right now. */
export function carLock(career: CareerData, car: CarDef): CarLock {
  if (career.freePlay) return 'none';
  if (car.id === 'rocket' && !career.champion) return 'rank';
  if (car.needsRank < career.rank) return 'rank';
  if (career.cash < car.price) return 'cash';
  return 'none';
}

export function buyCar(career: CareerData, carId: string): boolean {
  const car = CAR_BY_ID.get(carId);
  if (!car || isOwned(career, carId) || carLock(career, car) !== 'none') return false;
  if (!career.freePlay) career.cash -= car.price;
  career.cars[carId] = newOwnedCar(carId);
  career.selectedCar = carId;
  bumpStat(career, 'carsBought');
  return true;
}

export function selectCar(career: CareerData, carId: string): boolean {
  if (!isOwned(career, carId)) return false;
  career.selectedCar = carId;
  return true;
}

export function selectedOwned(career: CareerData): OwnedCar {
  return career.cars[career.selectedCar];
}

// ---------- Parts ----------

export function partCost(car: CarDef, kind: PartKind, level: number): number {
  return Math.round(PARTS[kind].costs[level - 1] * CLASS_COST_SCALE[car.class]);
}

export type PartLock = 'none' | 'max' | 'level' | 'cash';

/** Why the next level of a part cannot be bought. */
export function partLock(career: CareerData, car: CarDef, owned: OwnedCar, kind: PartKind): PartLock {
  const next = owned.parts[kind] + 1;
  if (next > 3) return 'max';
  if (career.freePlay) return 'none';
  if (levelFor(career.ringPoints) < PART_LEVEL_NEEDS[next - 1]) return 'level';
  if (career.cash < partCost(car, kind, next)) return 'cash';
  return 'none';
}

export function buyPart(career: CareerData, carId: string, kind: PartKind): boolean {
  const car = CAR_BY_ID.get(carId);
  const owned = career.cars[carId];
  if (!car || !owned || partLock(career, car, owned, kind) !== 'none') return false;
  const next = owned.parts[kind] + 1;
  if (!career.freePlay) career.cash -= partCost(car, kind, next);
  owned.parts[kind] = next;
  bumpStat(career, 'partsBought');
  return true;
}

/** A car's numbers with its parts added. */
export function statsWithParts(car: CarDef, parts: Readonly<Record<PartKind, number>>): CarStats {
  const stats: CarStats = { ...car.stats };
  for (const kind of PART_KINDS) {
    const level = parts[kind];
    if (level <= 0) continue;
    const effects = PARTS[kind].effects;
    for (const [stat, values] of Object.entries(effects) as Array<[keyof CarStats, readonly [number, number, number]]>) {
      stats[stat] *= 1 + values[level - 1];
    }
  }
  return stats;
}

/** One number for how strong a car is. 1 is a stock বুলবুলি. */
export function performanceIndex(stats: CarStats): number {
  const weights = PROGRESS.performance;
  return stats.power * weights.power + stats.topSpeed * weights.topSpeed + stats.grip * weights.grip;
}

/** A car's rating as shown on the garage screen, on a scale where stock বুলবুলি is 100. */
export function displayRating(stats: CarStats): number {
  return Math.round(performanceIndex(stats) * 100);
}

/** The strength of what the player is driving now. */
export function playerPerformance(career: CareerData): number {
  const car = CAR_BY_ID.get(career.selectedCar);
  const owned = career.cars[career.selectedCar];
  if (!car || !owned) return 1;
  return performanceIndex(statsWithParts(car, owned.parts));
}

// ---------- Condition ----------

export function repairCost(career: CareerData): number {
  return Math.round((100 - career.condition) * PROGRESS.garage.repairPricePerPoint);
}

/** Wear from a crash. */
export function wearFrom(career: CareerData, strength: number, soft: boolean): void {
  const config = PROGRESS.condition;
  career.condition = Math.max(0, career.condition - (soft ? config.softCrash : config.perCrash * strength));
}

/** What damage costs in power and top speed, as shares. */
export function limpScales(condition: number): { power: number; top: number } {
  const config = PROGRESS.condition;
  if (condition >= config.limpFrom) return { power: 1, top: 1 };
  const t = 1 - condition / config.limpFrom;
  return { power: 1 + (config.limpPower - 1) * t, top: 1 + (config.limpTop - 1) * t };
}

// ---------- Daily reward ----------

/** A date as year-month-day, in local time. */
export function dayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export interface DailyResult {
  cash: number;
  rep: number;
  streak: number;
}

/** The day's reward, if it has not been taken yet. @returns null if it has */
export function claimDaily(career: CareerData, now: Date): DailyResult | null {
  const today = dayKey(now);
  const daily = career.daily;
  if (daily.lastDay === today) return null;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  daily.streak = daily.lastDay === dayKey(yesterday) ? daily.streak + 1 : 1;
  daily.lastDay = today;
  const table = PROGRESS.daily;
  const index = Math.min(daily.streak, table.cash.length) - 1;
  const cash = table.cash[index];
  const rep = table.rep[index];
  earn(career, cash, rep);
  raiseStat(career, 'dailyStreak', daily.streak);
  return { cash, rep, streak: daily.streak };
}

/** How rivals' engines follow the player's car. */
export function rivalScale(rank: number, playerStrength: number): number {
  const config = PROGRESS.balance;
  const expected = 1 + (10 - rank) * config.expectedPerRank;
  const scale = expected * (1 - config.followPlayer) + playerStrength * config.followPlayer;
  return Math.max(config.minScale, Math.min(config.maxScale, scale));
}

/** Every car, cheapest class first, for the garage list. */
export const CAR_ORDER = CARS;
