/**
 * Daily and weekly চ্যালেঞ্জ, and the free season that follows the six Bangla ঋতু.
 * Every challenge is run alone on the road under the same sky for everyone, so times can be
 * compared on a leaderboard. Names and briefs live in the language files under challenge.def.
 */

import type { TimeLock, WeatherKind } from './atmosphere';

/** The sky a run insists on. */
export interface SkyConditions {
  time?: TimeLock;
  weather?: WeatherKind | 'blackout';
}

/** The bonus modes the challenges are drawn from. */
export type ChallengeMode = 'timeAttack' | 'rainRush' | 'nightDelivery' | 'fogRun' | 'blackoutRun' | 'driftRain' | 'jamEscape' | 'photoHunt';

export type ChallengeGoal =
  /** Finish at this average speed or better. The time is worked out from the course's length. */
  | { kind: 'pace'; kmh: number }
  /** Earn at least this medal: 1 bronze, 2 silver, 3 gold. */
  | { kind: 'medal'; medal: 1 | 2 | 3 }
  /** Drift points. */
  | { kind: 'score'; points: number }
  /** Shake off the police from this many stars inside the time. */
  | { kind: 'escape'; stars: number; seconds: number }
  /** A photo with the car near a place. */
  | { kind: 'photo'; poi: string; radius: number };

export interface ChallengeDef {
  id: string;
  mode: ChallengeMode;
  /** The Ring event it runs on. Roam challenges have none. */
  eventId?: string;
  sky?: SkyConditions;
  /** Share of normal traffic, instead of the event's own. */
  traffic?: number;
  goal: ChallengeGoal;
  /** How the leaderboard ranks runs: by time, by points, or not at all. */
  rank: 'time' | 'score' | 'none';
  /** Season points for completing it. */
  xp: number;
  cash: number;
}

export const DAILY_CHALLENGES: readonly ChallengeDef[] = [
  { id: 'dawnAvenue', mode: 'timeAttack', eventId: 'avenueTrial', sky: { time: 'dawn', weather: 'clear' }, goal: { kind: 'medal', medal: 2 }, rank: 'time', xp: 350, cash: 1200 },
  { id: 'borshaDash', mode: 'rainRush', eventId: 'borshaRush', sky: { time: 'day', weather: 'monsoon' }, goal: { kind: 'pace', kmh: 78 }, rank: 'time', xp: 350, cash: 1400 },
  { id: 'jolpothDaily', mode: 'rainRush', eventId: 'jolpothRush', sky: { time: 'dusk', weather: 'monsoon' }, goal: { kind: 'medal', medal: 2 }, rank: 'time', xp: 350, cash: 1400 },
  { id: 'nightSweets', mode: 'nightDelivery', eventId: 'nightDelivery', sky: { time: 'night', weather: 'clear' }, goal: { kind: 'medal', medal: 2 }, rank: 'time', xp: 350, cash: 1500 },
  { id: 'kuashaDaily', mode: 'fogRun', eventId: 'kuashaSprint', sky: { time: 'dawn', weather: 'fog' }, goal: { kind: 'pace', kmh: 72 }, rank: 'time', xp: 350, cash: 1300 },
  { id: 'wetDrift', mode: 'driftRain', eventId: 'driftBlock', sky: { time: 'night', weather: 'monsoon' }, goal: { kind: 'score', points: 5500 }, rank: 'score', xp: 350, cash: 1300 },
  { id: 'jamDaily', mode: 'jamEscape', sky: { time: 'day' }, traffic: 1.8, goal: { kind: 'escape', stars: 2, seconds: 150 }, rank: 'time', xp: 350, cash: 1500 },
  { id: 'duskPhoto', mode: 'photoHunt', sky: { time: 'dusk', weather: 'clear' }, goal: { kind: 'photo', poi: 'monument', radius: 70 }, rank: 'none', xp: 300, cash: 900 },
  { id: 'goliNight', mode: 'timeAttack', eventId: 'goliCircuit', sky: { time: 'night', weather: 'clear' }, goal: { kind: 'pace', kmh: 66 }, rank: 'time', xp: 350, cash: 1200 },
  { id: 'loadshedLoop', mode: 'blackoutRun', eventId: 'flyoverLoop', sky: { time: 'night', weather: 'blackout' }, goal: { kind: 'pace', kmh: 82 }, rank: 'time', xp: 350, cash: 1500 },
  { id: 'foggyRush', mode: 'fogRun', eventId: 'cityRush', sky: { time: 'day', weather: 'fog' }, goal: { kind: 'medal', medal: 2 }, rank: 'time', xp: 350, cash: 1300 },
  { id: 'dockPhoto', mode: 'photoHunt', sky: { time: 'night', weather: 'monsoon' }, goal: { kind: 'photo', poi: 'dock', radius: 80 }, rank: 'none', xp: 300, cash: 900 },
];

export const WEEKLY_CHALLENGES: readonly ChallengeDef[] = [
  { id: 'cityRushGold', mode: 'timeAttack', eventId: 'allCityRush', sky: { time: 'day', weather: 'clear' }, goal: { kind: 'medal', medal: 3 }, rank: 'time', xp: 1000, cash: 5000 },
  { id: 'meterStorm', mode: 'rainRush', eventId: 'meterCircuit', sky: { time: 'dusk', weather: 'monsoon' }, goal: { kind: 'pace', kmh: 80 }, rank: 'time', xp: 1000, cash: 5000 },
  { id: 'jamWeekly', mode: 'jamEscape', sky: { time: 'night' }, traffic: 2.1, goal: { kind: 'escape', stars: 3, seconds: 200 }, rank: 'time', xp: 1000, cash: 5500 },
  { id: 'ghatNight', mode: 'blackoutRun', eventId: 'ghatRun', sky: { time: 'night', weather: 'blackout' }, goal: { kind: 'pace', kmh: 78 }, rank: 'time', xp: 1000, cash: 5000 },
  { id: 'slipRain', mode: 'driftRain', eventId: 'slipBattle', sky: { time: 'dawn', weather: 'monsoon' }, goal: { kind: 'score', points: 8000 }, rank: 'score', xp: 1000, cash: 4500 },
];

export const CHALLENGE_BY_ID: ReadonlyMap<string, ChallengeDef> = new Map([...DAILY_CHALLENGES, ...WEEKLY_CHALLENGES].map((def) => [def.id, def]));

/** Bangladesh time, so the whole country gets the same চ্যালেঞ্জ on the same day. */
export const CHALLENGE_UTC_OFFSET_HOURS = 6;

/** The six seasons, in order from বৈশাখ. Each covers two Bangla months. */
export const SEASONS = ['grishmo', 'borsha', 'shorot', 'hemonto', 'sheet', 'boshonto'] as const;
export type SeasonName = (typeof SEASONS)[number];

export type SeasonReward =
  | { kind: 'cash'; amount: number }
  /** A paint colour for the garage. */
  | { kind: 'colour'; value: string }
  /** A glow colour for the garage. */
  | { kind: 'glow'; value: string }
  /** The season's stamp, kept forever on the challenge board. */
  | { kind: 'stamp' };

export const SEASON = {
  tiers: 15,
  xpPerTier: 600,
  /** Season points for things done outside the challenges. */
  xp: { attempt: 40, raceFinish: 60, perMedal: 30, ghostWin: 80, photo: 15, escape: 120 },
  /** What each tier gives, from the first. */
  rewards(season: SeasonName): SeasonReward[] {
    const colour = SEASON_COLOURS[season];
    return [
      { kind: 'cash', amount: 800 },
      { kind: 'cash', amount: 1000 },
      { kind: 'cash', amount: 1200 },
      { kind: 'cash', amount: 1400 },
      { kind: 'colour', value: colour.paint },
      { kind: 'cash', amount: 1600 },
      { kind: 'cash', amount: 1800 },
      { kind: 'cash', amount: 2000 },
      { kind: 'cash', amount: 2200 },
      { kind: 'stamp' },
      { kind: 'cash', amount: 2500 },
      { kind: 'cash', amount: 2800 },
      { kind: 'cash', amount: 3100 },
      { kind: 'cash', amount: 3500 },
      { kind: 'glow', value: colour.glow },
    ];
  },
} as const;

/** Each season's paint and glow, taken from what the season looks like: mango, kadam, kash, paddy, mist, palash. */
export const SEASON_COLOURS: Record<SeasonName, { paint: string; glow: string }> = {
  grishmo: { paint: '#f39a2c', glow: '#ffb000' },
  borsha: { paint: '#2b7f96', glow: '#4fe0ff' },
  shorot: { paint: '#f1ece0', glow: '#e8f4ff' },
  hemonto: { paint: '#c9962c', glow: '#ffd060' },
  sheet: { paint: '#94adbd', glow: '#a8d8ff' },
  boshonto: { paint: '#e0405a', glow: '#ff4f8a' },
};
