/**
 * দ্য রিং's Top 10. All fictional, and all beatable with the starter car.
 * Traits only change how a rival drives, never the physics they obey.
 */

export interface RivalTraits {
  /** Engine power and top speed, as a share of the player's car. */
  power: number;
  topSpeed: number;
  grip: number;
  /** How hard it takes corners, m/s^2. */
  cornerLateral: number;
  cornerBrake: number;
  /** Chance per second of a small error. */
  mistakeRate: number;
  /** 0 keeps to the middle of the road, 1 uses all of it through corners. */
  lineInset: number;
  /** How strongly rubber-banding applies, from 0 to 1. */
  rubber: number;
  /** How readily it steers into you. */
  aggression: number;
  /** How readily it moves across to stay in front of you. */
  block: number;
  /** Share of the race after which it starts using nitro. */
  nitroStart: number;
  /** 0 brakes for everything, 1 slips through traffic. */
  trafficSkill: number;
  /** Speed in the narrow alleys, as a share of its speed elsewhere. */
  laneScale: number;
  /** Runs without lights, so it is hard to see coming. */
  lightsOff?: boolean;
  /** Throws the car sideways through corners. */
  drifty?: boolean;
  /** Pushes much harder near the end. */
  lastPush?: boolean;
  /** Uses what it remembers of the player. */
  adaptive?: boolean;
  /** Honks traffic out of its way. */
  hornsTraffic?: boolean;
}

export type RivalModel = 'hatch' | 'wedge' | 'saloon' | 'pickup' | 'coupe' | 'grand' | 'muscle' | 'proto';

export interface RivalPortrait {
  skin: string;
  hair: string;
  shirt: string;
  backdrop: string;
  /** 0 short, 1 long, 2 bun, 3 cap, 4 curly, 5 spiky, 6 side part, 7 wavy, 8 tied back. */
  hairStyle: number;
  moustache?: boolean;
  beard?: boolean;
  glasses?: boolean;
  earring?: boolean;
}

export interface RivalDef {
  id: string;
  /** 10 is the first rival, 1 is the last. */
  rank: number;
  model: RivalModel;
  body: number;
  stripe: number;
  /** Colour of the glow under the car. */
  glow: number;
  traits: RivalTraits;
  portrait: RivalPortrait;
}

export const RIVALS: readonly RivalDef[] = [
  {
    id: 'mithu',
    rank: 10,
    model: 'hatch',
    body: 0x2f8a56,
    stripe: 0xf2a20c,
    glow: 0x4fe08a,
    traits: { power: 0.92, topSpeed: 0.9, grip: 1, cornerLateral: 9.4, cornerBrake: 9, mistakeRate: 0.09, lineInset: 0.6, rubber: 1, aggression: 0.06, block: 0, nitroStart: 0.5, trafficSkill: 0.6, laneScale: 1.12 },
    portrait: { skin: '#b5835a', hair: '#1a1210', shirt: '#2f8a56', backdrop: '#f2a20c', hairStyle: 5, moustache: true },
  },
  {
    id: 'sadia',
    rank: 9,
    model: 'wedge',
    body: 0xd9d4c5,
    stripe: 0x1d6f9c,
    glow: 0x6fc4f0,
    traits: { power: 0.94, topSpeed: 0.92, grip: 1, cornerLateral: 10, cornerBrake: 10, mistakeRate: 0.01, lineInset: 0.85, rubber: 0.9, aggression: 0, block: 0, nitroStart: 0.6, trafficSkill: 0.62, laneScale: 1 },
    portrait: { skin: '#c49468', hair: '#16100e', shirt: '#1d6f9c', backdrop: '#efe3c8', hairStyle: 2, earring: true },
  },
  {
    id: 'badal',
    rank: 8,
    model: 'saloon',
    body: 0x4a6f8c,
    stripe: 0xc9d8e0,
    glow: 0x8ab8d8,
    traits: { power: 0.95, topSpeed: 0.93, grip: 1.07, cornerLateral: 10.4, cornerBrake: 10, mistakeRate: 0.05, lineInset: 0.7, rubber: 0.9, aggression: 0.1, block: 0.1, nitroStart: 0.55, trafficSkill: 0.6, laneScale: 1 },
    portrait: { skin: '#9c6a48', hair: '#20181a', shirt: '#4a6f8c', backdrop: '#0f7f7a', hairStyle: 7, beard: true },
  },
  {
    id: 'jisan',
    rank: 7,
    model: 'pickup',
    body: 0xb5472a,
    stripe: 0xefe3c8,
    glow: 0xff8a50,
    traits: { power: 0.97, topSpeed: 0.94, grip: 1, cornerLateral: 10.3, cornerBrake: 10, mistakeRate: 0.06, lineInset: 0.6, rubber: 0.85, aggression: 0.7, block: 0.15, nitroStart: 0.5, trafficSkill: 0.5, laneScale: 0.95 },
    portrait: { skin: '#a97850', hair: '#14100e', shirt: '#efe3c8', backdrop: '#d8402b', hairStyle: 6, glasses: true },
  },
  {
    id: 'papri',
    rank: 6,
    model: 'coupe',
    body: 0xc2185b,
    stripe: 0xf2a20c,
    glow: 0xff5fa8,
    traits: { power: 0.96, topSpeed: 0.93, grip: 1.1, cornerLateral: 11.8, cornerBrake: 11, mistakeRate: 0.05, lineInset: 0.92, rubber: 0.8, aggression: 0.05, block: 0.05, nitroStart: 0.6, trafficSkill: 0.6, laneScale: 1.05, drifty: true },
    portrait: { skin: '#c08a60', hair: '#2a1410', shirt: '#c2185b', backdrop: '#f2a20c', hairStyle: 1, earring: true },
  },
  {
    id: 'tanvir',
    rank: 5,
    model: 'grand',
    body: 0x20262c,
    stripe: 0xc8ccd0,
    glow: 0xc8e0ff,
    traits: { power: 1.07, topSpeed: 1.04, grip: 0.98, cornerLateral: 9.5, cornerBrake: 9, mistakeRate: 0.05, lineInset: 0.7, rubber: 0.7, aggression: 0.1, block: 0.1, nitroStart: 0.3, trafficSkill: 0.55, laneScale: 0.8 },
    portrait: { skin: '#c49468', hair: '#100c0a', shirt: '#20262c', backdrop: '#8a97a3', hairStyle: 0, glasses: true },
  },
  {
    id: 'rubel',
    rank: 4,
    model: 'muscle',
    body: 0xd9a312,
    stripe: 0x1b1410,
    glow: 0xffc830,
    traits: { power: 1, topSpeed: 0.97, grip: 1.02, cornerLateral: 10.6, cornerBrake: 10, mistakeRate: 0.04, lineInset: 0.7, rubber: 0.7, aggression: 0.3, block: 0.9, nitroStart: 0.6, trafficSkill: 0.6, laneScale: 0.95 },
    portrait: { skin: '#8a5e3e', hair: '#16100e', shirt: '#d9a312', backdrop: '#1d2a5b', hairStyle: 3, moustache: true, beard: true },
  },
  {
    id: 'nila',
    rank: 3,
    model: 'coupe',
    body: 0x1d2a5b,
    stripe: 0x6f7fb0,
    glow: 0x2a3a78,
    traits: { power: 1, topSpeed: 0.98, grip: 1.03, cornerLateral: 11, cornerBrake: 10.5, mistakeRate: 0.03, lineInset: 0.8, rubber: 0.6, aggression: 0.1, block: 0.3, nitroStart: 0.5, trafficSkill: 0.95, laneScale: 1.05, lightsOff: true, hornsTraffic: true },
    portrait: { skin: '#b08458', hair: '#0c0a10', shirt: '#2a3a78', backdrop: '#3a4466', hairStyle: 8, earring: true },
  },
  {
    id: 'shaon',
    rank: 2,
    model: 'muscle',
    body: 0x7a1d1d,
    stripe: 0xf2a20c,
    glow: 0xff4830,
    traits: { power: 1, topSpeed: 0.99, grip: 1.04, cornerLateral: 11.2, cornerBrake: 11, mistakeRate: 0.02, lineInset: 0.85, rubber: 0.55, aggression: 0.2, block: 0.5, nitroStart: 0.8, trafficSkill: 0.72, laneScale: 1, lastPush: true },
    portrait: { skin: '#a97850', hair: '#120e0c', shirt: '#7a1d1d', backdrop: '#f2a20c', hairStyle: 4, moustache: true },
  },
  {
    id: 'jahan',
    rank: 1,
    model: 'proto',
    body: 0x14161c,
    stripe: 0xd8402b,
    glow: 0xff3a20,
    traits: { power: 1.03, topSpeed: 1.01, grip: 1.06, cornerLateral: 11.8, cornerBrake: 11, mistakeRate: 0.01, lineInset: 0.95, rubber: 0.45, aggression: 0.25, block: 0.55, nitroStart: 0.65, trafficSkill: 0.85, laneScale: 1.05, adaptive: true, lastPush: true },
    portrait: { skin: '#c08a60', hair: '#0e0a0a', shirt: '#14161c', backdrop: '#d8402b', hairStyle: 8, earring: true },
  },
];

export const RIVAL_BY_ID: ReadonlyMap<string, RivalDef> = new Map(RIVALS.map((rival) => [rival.id, rival]));

/** The crew who fill out a race. Skill runs from 0 for the first events to 1 for the last. */
export function crewTraits(skill: number): RivalTraits {
  return {
    power: 0.88 + skill * 0.1,
    topSpeed: 0.86 + skill * 0.1,
    grip: 1,
    cornerLateral: 8.8 + skill * 1.8,
    cornerBrake: 8.5 + skill * 1.5,
    mistakeRate: 0.12 - skill * 0.07,
    lineInset: 0.45 + skill * 0.3,
    rubber: 1,
    aggression: 0.05 + skill * 0.1,
    block: skill * 0.15,
    nitroStart: 0.6,
    trafficSkill: 0.4 + skill * 0.3,
    laneScale: 1,
  };
}

/** Colours and body shapes for the crew. Names come from the list at race.crew in the language files. */
export const CREW_LOOKS: ReadonlyArray<{ model: RivalModel; body: number; stripe: number; glow: number }> = [
  { model: 'hatch', body: 0x8a3a7a, stripe: 0xefe3c8, glow: 0xd86fc0 },
  { model: 'saloon', body: 0x2f5f8a, stripe: 0xf2a20c, glow: 0x6fa8e0 },
  { model: 'wedge', body: 0x6a7a2f, stripe: 0x1b1410, glow: 0xb0d050 },
  { model: 'pickup', body: 0x8a6a3a, stripe: 0xefe3c8, glow: 0xe0b060 },
  { model: 'coupe', body: 0x3a8a8a, stripe: 0x1b1410, glow: 0x60e0d8 },
  { model: 'hatch', body: 0xa83a3a, stripe: 0xf2a20c, glow: 0xff7050 },
];
