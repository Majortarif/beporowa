/**
 * The free season pass: season points fill tiers, and each tier gives something.
 * Nothing here costs money, and nothing can be bought. Pure rules on the save, so tests can run them.
 */

import { SEASON, type SeasonName, type SeasonReward } from '../config/challenges';
import type { CareerData } from '../save/career';

/** How many tiers some season points reach. */
export function tierFor(xp: number): number {
  return Math.max(0, Math.min(SEASON.tiers, Math.floor(xp / SEASON.xpPerTier)));
}

/** Points still needed for the next tier, or 0 at the top. */
export function xpToNextTier(xp: number): number {
  const tier = tierFor(xp);
  return tier >= SEASON.tiers ? 0 : (tier + 1) * SEASON.xpPerTier - xp;
}

/**
 * Moves the save to the season now running. A new season starts from nothing,
 * but what was unlocked before is kept for good.
 * @returns true if a new season began
 */
export function ensureSeason(career: CareerData, seasonId: string): boolean {
  if (career.season.id === seasonId) return false;
  career.season = { id: seasonId, xp: 0, claimed: [] };
  return true;
}

/** Adds season points. @returns the tiers before and after */
export function addSeasonXp(career: CareerData, amount: number): { before: number; after: number } {
  const before = tierFor(career.season.xp);
  career.season.xp = Math.max(0, career.season.xp + Math.max(0, Math.round(amount)));
  return { before, after: tierFor(career.season.xp) };
}

/** Tiers reached but not yet collected, from the first. */
export function claimableTiers(career: CareerData): number[] {
  const reached = tierFor(career.season.xp);
  const out: number[] = [];
  for (let tier = 1; tier <= reached; tier++) if (!career.season.claimed.includes(tier)) out.push(tier);
  return out;
}

/**
 * Collects a tier's reward into the save.
 * @param tier from 1
 * @returns the reward, or null if it cannot be collected
 */
export function claimTier(career: CareerData, season: SeasonName, tier: number): SeasonReward | null {
  if (!Number.isInteger(tier) || tier < 1 || tier > tierFor(career.season.xp) || career.season.claimed.includes(tier)) return null;
  const reward = SEASON.rewards(season)[tier - 1];
  if (!reward) return null;
  career.season.claimed.push(tier);
  const unlocks = career.unlocks;
  switch (reward.kind) {
    case 'cash':
      career.cash += reward.amount;
      break;
    case 'colour':
      if (!unlocks.colours.includes(reward.value)) unlocks.colours.push(reward.value);
      break;
    case 'glow':
      if (!unlocks.glows.includes(reward.value)) unlocks.glows.push(reward.value);
      break;
    case 'stamp':
      if (!unlocks.stamps.includes(career.season.id)) unlocks.stamps.push(career.season.id);
      break;
  }
  return reward;
}
