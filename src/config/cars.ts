/**
 * The garage's cars and parts. Every car is an original design with an invented name.
 * Stats are shares of the starter car, so 1 means the same as a stock বুলবুলি.
 */

import type { RivalModel } from './rivals';

export type CarClass = 'goli' | 'sarak' | 'ural' | 'secret';
export type CarModel = 'bulbuli' | 'rocket' | RivalModel;

export interface CarStats {
  power: number;
  topSpeed: number;
  grip: number;
  brake: number;
  /** How hard nitro pushes. */
  nitro: number;
  /** How quickly the nose answers the wheel. */
  steer: number;
}

export interface LiveryDef {
  base: string;
  /** The stripe along the sill. */
  accent: string;
  rocker: string;
  roof: string;
  rim: string;
  glow: string;
  /** The patterned band along the doors. */
  band: LiveryBand;
  /** The picture on the door. */
  art: LiveryArt;
  /** The words on the tail. Empty keeps the classic blessing. */
  slogan: string;
}

export type LiveryBand = 'flowers' | 'chain' | 'waves' | 'none';
export type LiveryArt = 'none' | 'flowers' | 'boat' | 'cinema' | 'tiger' | 'bird';

export const LIVERY_BANDS: readonly LiveryBand[] = ['flowers', 'chain', 'waves', 'none'];
export const LIVERY_ARTS: readonly LiveryArt[] = ['none', 'flowers', 'boat', 'cinema', 'tiger', 'bird'];
export const LIVERY_COLOURS: readonly string[] = ['#d8402b', '#f2a20c', '#0f7f7a', '#5fa52f', '#c2185b', '#1d2a5b', '#efe3c8', '#1b1410', '#8a3a7a', '#3f6fe0', '#c8ccd0', '#e0701c'];
export const LIVERY_GLOWS: readonly string[] = ['#ff7a2a', '#ff3060', '#30e0a0', '#40a0ff', '#f0d040', '#b060ff', '#000000'];

export interface CarDef {
  id: string;
  class: CarClass;
  model: CarModel;
  price: number;
  /** The lowest rank the player must have reached. 11 means from the start. */
  needsRank: number;
  stats: CarStats;
  livery: LiveryDef;
}

function paint(base: string, accent: string, rocker: string, roof: string, rim: string, glow: string, band: LiveryBand, art: LiveryArt): LiveryDef {
  return { base, accent, rocker, roof, rim, glow, band, art, slogan: '' };
}

export const CARS: readonly CarDef[] = [
  {
    id: 'bulbuli',
    class: 'goli',
    model: 'bulbuli',
    price: 0,
    needsRank: 11,
    stats: { power: 1, topSpeed: 1, grip: 1, brake: 1, nitro: 1, steer: 1 },
    livery: paint('#d8402b', '#0f7f7a', '#1b1410', '#efe3c8', '#f2a20c', '#ff7a2a', 'flowers', 'none'),
  },
  {
    id: 'shalik',
    class: 'goli',
    model: 'hatch',
    price: 9000,
    needsRank: 11,
    stats: { power: 1.06, topSpeed: 0.98, grip: 1.07, brake: 1.05, nitro: 1, steer: 1.1 },
    livery: paint('#5fa52f', '#f2a20c', '#1b1410', '#efe3c8', '#efe3c8', '#30e0a0', 'chain', 'bird'),
  },
  {
    id: 'phoring',
    class: 'goli',
    model: 'wedge',
    price: 16000,
    needsRank: 10,
    stats: { power: 1.12, topSpeed: 1.04, grip: 1.04, brake: 1.08, nitro: 1.04, steer: 1.05 },
    livery: paint('#efe3c8', '#3f6fe0', '#1b1410', '#1d2a5b', '#3f6fe0', '#40a0ff', 'none', 'none'),
  },
  {
    id: 'ilish',
    class: 'sarak',
    model: 'saloon',
    price: 32000,
    needsRank: 8,
    stats: { power: 1.2, topSpeed: 1.1, grip: 1.05, brake: 1.1, nitro: 1.05, steer: 1 },
    livery: paint('#c8ccd0', '#0f7f7a', '#1d2a5b', '#c8ccd0', '#c8ccd0', '#40a0ff', 'waves', 'boat'),
  },
  {
    id: 'machranga',
    class: 'sarak',
    model: 'coupe',
    price: 44000,
    needsRank: 7,
    stats: { power: 1.24, topSpeed: 1.1, grip: 1.15, brake: 1.14, nitro: 1.08, steer: 1.1 },
    livery: paint('#0f7f7a', '#f2a20c', '#1b1410', '#0f7f7a', '#f2a20c', '#30e0a0', 'flowers', 'bird'),
  },
  {
    id: 'chitol',
    class: 'sarak',
    model: 'pickup',
    price: 40000,
    needsRank: 7,
    stats: { power: 1.34, topSpeed: 1.05, grip: 1.02, brake: 1.1, nitro: 1.12, steer: 0.94 },
    livery: paint('#b5472a', '#efe3c8', '#1b1410', '#efe3c8', '#efe3c8', '#ff7a2a', 'chain', 'tiger'),
  },
  {
    id: 'bajpakhi',
    class: 'ural',
    model: 'muscle',
    price: 78000,
    needsRank: 5,
    stats: { power: 1.48, topSpeed: 1.18, grip: 1.09, brake: 1.16, nitro: 1.14, steer: 1 },
    livery: paint('#3f6fe0', '#efe3c8', '#1b1410', '#efe3c8', '#efe3c8', '#40a0ff', 'none', 'bird'),
  },
  {
    id: 'shonkhochil',
    class: 'ural',
    model: 'grand',
    price: 96000,
    needsRank: 4,
    stats: { power: 1.54, topSpeed: 1.27, grip: 1.07, brake: 1.18, nitro: 1.12, steer: 0.96 },
    livery: paint('#1d2a5b', '#c8ccd0', '#1b1410', '#c8ccd0', '#c8ccd0', '#40a0ff', 'waves', 'none'),
  },
  {
    id: 'bagha',
    class: 'ural',
    model: 'proto',
    price: 150000,
    needsRank: 2,
    stats: { power: 1.66, topSpeed: 1.31, grip: 1.16, brake: 1.24, nitro: 1.2, steer: 1.08 },
    livery: paint('#e0701c', '#1b1410', '#1b1410', '#efe3c8', '#efe3c8', '#ff3060', 'chain', 'tiger'),
  },
  {
    // Unlocked by finishing the whole Ring, and sold for one taka by ওস্তাদ.
    id: 'rocket',
    class: 'secret',
    model: 'rocket',
    price: 1,
    needsRank: 1,
    stats: { power: 1.42, topSpeed: 1.42, grip: 0.94, brake: 0.92, nitro: 1.6, steer: 1.12 },
    livery: paint('#c2185b', '#f2a20c', '#1d2a5b', '#0f7f7a', '#efe3c8', '#ff3060', 'flowers', 'cinema'),
  },
];

export const CAR_BY_ID: ReadonlyMap<string, CarDef> = new Map(CARS.map((car) => [car.id, car]));

export type PartKind = 'engine' | 'turbo' | 'tyres' | 'suspension' | 'brakes' | 'nitro';

export const PART_KINDS: readonly PartKind[] = ['engine', 'turbo', 'tyres', 'suspension', 'brakes', 'nitro'];

export interface PartDef {
  kind: PartKind;
  /** What each of the three levels adds, as a share. */
  effects: Readonly<Partial<Record<keyof CarStats, readonly [number, number, number]>>>;
  /** What each level costs on a car of the cheapest class. */
  costs: readonly [number, number, number];
}

export const PARTS: Readonly<Record<PartKind, PartDef>> = {
  engine: { kind: 'engine', effects: { power: [0.05, 0.11, 0.18] }, costs: [1800, 4800, 11000] },
  turbo: { kind: 'turbo', effects: { power: [0.02, 0.05, 0.08], topSpeed: [0.03, 0.06, 0.1] }, costs: [2200, 5600, 12500] },
  tyres: { kind: 'tyres', effects: { grip: [0.03, 0.07, 0.12] }, costs: [1400, 3600, 8000] },
  suspension: { kind: 'suspension', effects: { steer: [0.03, 0.06, 0.1], grip: [0.01, 0.02, 0.04] }, costs: [1200, 3200, 7000] },
  brakes: { kind: 'brakes', effects: { brake: [0.08, 0.18, 0.3] }, costs: [900, 2400, 5400] },
  nitro: { kind: 'nitro', effects: { nitro: [0.1, 0.22, 0.38] }, costs: [1600, 4200, 9500] },
};

/** Parts cost more on a bigger car. */
export const CLASS_COST_SCALE: Readonly<Record<CarClass, number>> = { goli: 1, sarak: 1.6, ural: 2.4, secret: 2 };

/** The player level needed for each part level. */
export const PART_LEVEL_NEEDS: readonly [number, number, number] = [1, 3, 7];

/** Ready-made words for the tail, for anyone without a Bangla keyboard. Keys under garage.sloganChoices. */
export const SLOGAN_CHOICES = 6;
export const SLOGAN_MAX_LENGTH = 26;
