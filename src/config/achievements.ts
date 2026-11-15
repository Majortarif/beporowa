/**
 * Achievements and side jobs. Titles are old Bangla proverbs, in the language files under ach.
 * Each one watches a running count kept in the career.
 */

import type { RivalPortrait } from './rivals';

export type StatKey =
  | 'raceWins'
  | 'golds'
  | 'rivalsBeaten'
  | 'nearMisses'
  | 'squeezes'
  | 'hornTaps'
  | 'escapes'
  | 'fiveStarEscapes'
  | 'busts'
  | 'traps'
  | 'perfectLaunches'
  | 'perfectShifts'
  | 'takedowns'
  | 'deliveries'
  | 'teas'
  | 'kilometres'
  | 'cashEarned'
  | 'driftPoints'
  | 'domSeconds'
  | 'carsBought'
  | 'partsBought'
  | 'rumours'
  | 'jobsDone'
  | 'dailyStreak'
  | 'photos'
  | 'rainKilometres'
  | 'potholes';

export interface AchievementDef {
  id: string;
  stat: StatKey;
  target: number;
  cash: number;
  rep: number;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  { id: 'firstWin', stat: 'raceWins', target: 1, cash: 500, rep: 30 },
  { id: 'tenWins', stat: 'raceWins', target: 10, cash: 3000, rep: 120 },
  { id: 'fiveGolds', stat: 'golds', target: 5, cash: 2500, rep: 100 },
  { id: 'threeRivals', stat: 'rivalsBeaten', target: 3, cash: 3000, rep: 120 },
  { id: 'allRivals', stat: 'rivalsBeaten', target: 10, cash: 15000, rep: 600 },
  { id: 'nearFifty', stat: 'nearMisses', target: 50, cash: 1200, rep: 60 },
  { id: 'squeezeTen', stat: 'squeezes', target: 10, cash: 1500, rep: 70 },
  { id: 'hornHundred', stat: 'hornTaps', target: 100, cash: 600, rep: 40 },
  { id: 'firstEscape', stat: 'escapes', target: 1, cash: 800, rep: 50 },
  { id: 'fiveStar', stat: 'fiveStarEscapes', target: 1, cash: 5000, rep: 250 },
  { id: 'fiveBusts', stat: 'busts', target: 5, cash: 500, rep: 30 },
  { id: 'trapTen', stat: 'traps', target: 10, cash: 1500, rep: 80 },
  { id: 'launchTen', stat: 'perfectLaunches', target: 10, cash: 1200, rep: 60 },
  { id: 'shiftTwenty', stat: 'perfectShifts', target: 20, cash: 1200, rep: 60 },
  { id: 'takedownTen', stat: 'takedowns', target: 10, cash: 2000, rep: 90 },
  { id: 'deliveryFive', stat: 'deliveries', target: 5, cash: 1600, rep: 70 },
  { id: 'teaTen', stat: 'teas', target: 10, cash: 700, rep: 50 },
  { id: 'hundredKm', stat: 'kilometres', target: 100, cash: 3000, rep: 150 },
  { id: 'lakhEarned', stat: 'cashEarned', target: 100000, cash: 5000, rep: 200 },
  { id: 'driftTwenty', stat: 'driftPoints', target: 20000, cash: 2000, rep: 100 },
  { id: 'domMinute', stat: 'domSeconds', target: 60, cash: 800, rep: 50 },
  { id: 'firstCar', stat: 'carsBought', target: 1, cash: 500, rep: 30 },
  { id: 'tenParts', stat: 'partsBought', target: 10, cash: 1500, rep: 60 },
  { id: 'rumourFive', stat: 'rumours', target: 5, cash: 800, rep: 50 },
  { id: 'jobsFive', stat: 'jobsDone', target: 5, cash: 2000, rep: 100 },
  { id: 'weekStreak', stat: 'dailyStreak', target: 7, cash: 3000, rep: 150 },
  { id: 'firstPhoto', stat: 'photos', target: 1, cash: 300, rep: 20 },
  { id: 'rainTen', stat: 'rainKilometres', target: 10, cash: 1500, rep: 70 },
  { id: 'potholeFive', stat: 'potholes', target: 5, cash: 500, rep: 30 },
];

export type JobKind = 'stat' | 'goto';

export interface JobDef {
  id: string;
  /** Who gives it. */
  npc: string;
  kind: JobKind;
  /** A count to raise. */
  stat?: StatKey;
  amount?: number;
  /** A place to reach, and how long there is. */
  place?: string;
  seconds?: number;
  cash: number;
  rep: number;
}

export const JOBS: readonly JobDef[] = [
  { id: 'milkRun', npc: 'mokbul', kind: 'goto', place: 'teaLane', seconds: 75, cash: 900, rep: 60 },
  { id: 'medicine', npc: 'latif', kind: 'goto', place: 'centre', seconds: 85, cash: 1200, rep: 70 },
  { id: 'nephew', npc: 'khokon', kind: 'goto', place: 'dock', seconds: 110, cash: 1500, rep: 80 },
  { id: 'clearJam', npc: 'khokon', kind: 'stat', stat: 'nearMisses', amount: 8, cash: 1000, rep: 60 },
  { id: 'smokeShow', npc: 'dalim', kind: 'stat', stat: 'driftPoints', amount: 3000, cash: 1300, rep: 70 },
  { id: 'squeezeThree', npc: 'dalim', kind: 'stat', stat: 'squeezes', amount: 3, cash: 1600, rep: 80 },
  { id: 'dareEscape', npc: 'rumki', kind: 'stat', stat: 'escapes', amount: 1, cash: 2000, rep: 100 },
  { id: 'trapPolice', npc: 'rumki', kind: 'stat', stat: 'traps', amount: 2, cash: 1400, rep: 70 },
];

export const JOB_BY_ID: ReadonlyMap<string, JobDef> = new Map(JOBS.map((job) => [job.id, job]));

export type NpcId = 'mokbul' | 'khokon' | 'rumki' | 'latif' | 'dalim';

export const NPC_IDS: readonly NpcId[] = ['mokbul', 'khokon', 'rumki', 'latif', 'dalim'];

/** The people at the tea stalls, as invented as the rivals. */
export const NPC_PORTRAITS: Readonly<Record<NpcId, RivalPortrait>> = {
  mokbul: { skin: '#b9835c', hair: '#3a3a3a', shirt: '#efe3c8', backdrop: '#0f7f7a', hairStyle: 0, moustache: true },
  khokon: { skin: '#94633f', hair: '#222222', shirt: '#2d5f8a', backdrop: '#d8402b', hairStyle: 6, moustache: true },
  rumki: { skin: '#b07a52', hair: '#17110d', shirt: '#c2185b', backdrop: '#f2a20c', hairStyle: 8, earring: true },
  latif: { skin: '#a8754e', hair: '#d8d4cc', shirt: '#f5f1e6', backdrop: '#1d2a5b', hairStyle: 0, beard: true, glasses: true },
  dalim: { skin: '#a06c46', hair: '#1b1410', shirt: '#5fa52f', backdrop: '#8a3a7a', hairStyle: 5 },
};

/** A short talk: each node is a line under adda.npc.<id>.talk, with replies leading on. */
export interface TalkNode {
  id: string;
  replies: ReadonlyArray<{ id: string; next: string | null }>;
}

/** Every NPC's little conversation has the same shape, with their own words. */
export const TALK_SHAPE: readonly TalkNode[] = [
  { id: 'open', replies: [{ id: 'a', next: 'left' }, { id: 'b', next: 'right' }] },
  { id: 'left', replies: [{ id: 'a', next: 'close' }] },
  { id: 'right', replies: [{ id: 'a', next: 'close' }] },
  { id: 'close', replies: [{ id: 'a', next: null }] },
];

/** How many rumours each rival has, under adda.rumour.<rivalId>. */
export const RUMOURS_PER_RIVAL = 2;
