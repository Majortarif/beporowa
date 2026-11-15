/**
 * What the music plays, as plain lists of steps. Original phrases generated from Bengali-inspired
 * scales, with no recorded or copied tunes. No sound here, so all of it can be tested headless.
 */

import { createRng } from '../core/math';

export type ScaleName = 'bhairavi' | 'bhairav' | 'kafi' | 'yaman' | 'baul';

/** Semitones above the tonic. */
export const SCALES: Readonly<Record<ScaleName, readonly number[]>> = {
  bhairavi: [0, 1, 3, 5, 7, 8, 10],
  bhairav: [0, 1, 4, 5, 7, 8, 11],
  kafi: [0, 2, 3, 5, 7, 9, 10],
  yaman: [0, 2, 4, 6, 7, 9, 11],
  baul: [0, 2, 5, 7, 9],
};

export const STEPS_PER_BAR = 16;

export type Mood = 'adda' | 'cruise' | 'rain' | 'blackout' | 'race' | 'pursuit';

/** Everything scheduled across one bar. Values are hit strength from 0 to 1, or a scale degree. */
export interface BarPattern {
  kick: number[];
  snare: number[];
  hat: number[];
  dholLow: number[];
  dholHigh: number[];
  tablaNa: number[];
  tablaGe: number[];
  /** A scale degree for each step, or null for silence. */
  cowbell: Array<number | null>;
  bass: Array<number | null>;
  ektara: Array<number | null>;
  bansuri: Array<number | null>;
  /** Degrees of the chord for the bar. */
  chord: readonly number[];
}

function silentBar(): BarPattern {
  const zero = (): number[] => new Array<number>(STEPS_PER_BAR).fill(0);
  const none = (): Array<number | null> => new Array<number | null>(STEPS_PER_BAR).fill(null);
  return { kick: zero(), snare: zero(), hat: zero(), dholLow: zero(), dholHigh: zero(), tablaNa: zero(), tablaGe: zero(), cowbell: none(), bass: none(), ektara: none(), bansuri: none(), chord: [0, 2, 4] };
}

function fill(target: number[], steps: readonly number[], value: number): void {
  for (const step of steps) target[step] = value;
}

/** A slow walk up and down the scale, with long held notes and breaths between, as a flute would. */
export function bansuriPhrase(random: () => number, bar: BarPattern, density: number, degreeCount: number): void {
  let degree = Math.floor(random() * degreeCount);
  let step = Math.floor(random() * 4);
  while (step < STEPS_PER_BAR) {
    if (random() < density) {
      bar.bansuri[step] = degree;
      const move = random();
      degree += move < 0.42 ? 1 : move < 0.84 ? -1 : random() < 0.5 ? 2 : -2;
      degree = Math.max(0, Math.min(degreeCount + 2, degree));
    }
    step += 2 + Math.floor(random() * 3) * 2;
  }
}

/** The bars of a song section. The same seed always gives the same music. */
export function buildSection(mood: Mood, seed: number, bars: number, degreeCount: number): BarPattern[] {
  const random = createRng(seed);
  const section: BarPattern[] = [];
  // A chord cycle per section: tonic, then a neighbour or two.
  const cycles: ReadonlyArray<readonly (readonly number[])[]> = [
    [[0, 2, 4], [3, 5, 0], [4, 6, 1], [0, 2, 4]],
    [[0, 2, 4], [5, 0, 2], [3, 5, 0], [4, 6, 1]],
    [[0, 3, 4], [1, 3, 5], [0, 3, 4], [4, 6, 1]],
  ];
  const cycle = cycles[Math.floor(random() * cycles.length)];
  // A cowbell riff stays the same through a section, which is what makes it stick.
  const riff: Array<number | null> = new Array<number | null>(STEPS_PER_BAR).fill(null);
  for (const step of [0, 3, 6, 8, 11, 14]) riff[step] = Math.floor(random() * Math.min(5, degreeCount));
  riff[0] = 0;

  for (let index = 0; index < bars; index++) {
    const bar = silentBar();
    const chord = cycle[index % cycle.length];
    bar.chord = chord;
    const isTurn = index % 4 === 3;
    switch (mood) {
      case 'adda':
        // Tea-stall music: an ektara, a soft tabla and an occasional flute.
        fill(bar.ektara as number[], [0, 6, 8, 14], 0);
        bar.ektara[6] = 4 % degreeCount;
        bar.ektara[14] = 4 % degreeCount;
        fill(bar.tablaGe, [0, 10], 0.55);
        fill(bar.tablaNa, [4, 7, 12], 0.42);
        if (isTurn) fill(bar.tablaNa, [14, 15], 0.5);
        if (random() < 0.7) bansuriPhrase(random, bar, 0.75, degreeCount);
        break;
      case 'cruise':
        // Lo-fi: a lazy backbeat, tabla fills, a bass that walks.
        fill(bar.kick, [0, 7, 10], 0.72);
        fill(bar.snare, [4, 12], 0.5);
        fill(bar.hat, [0, 2, 4, 6, 8, 10, 12, 14], 0.26);
        fill(bar.tablaNa, [3, 11], 0.3);
        bar.bass[0] = chord[0];
        bar.bass[7] = chord[0];
        bar.bass[10] = chord[1];
        if (isTurn) fill(bar.tablaNa, [13, 14, 15], 0.46);
        if (random() < 0.55) bansuriPhrase(random, bar, 0.66, degreeCount);
        break;
      case 'rain':
        // The same road, slower, with the drums pushed away and more space.
        fill(bar.kick, [0, 10], 0.5);
        fill(bar.snare, [12], 0.3);
        fill(bar.hat, [2, 6, 10, 14], 0.16);
        fill(bar.tablaGe, [8], 0.34);
        bar.bass[0] = chord[0];
        bar.ektara[0] = chord[0];
        if (random() < 0.65) bansuriPhrase(random, bar, 0.55, degreeCount);
        break;
      case 'blackout':
        // No power: one string, a drum far away.
        bar.ektara[0] = 0;
        bar.ektara[8] = 4 % degreeCount;
        if (index % 2 === 1) bar.ektara[12] = 0;
        fill(bar.dholLow, [0], 0.3);
        if (isTurn) fill(bar.dholLow, [10, 13], 0.24);
        if (random() < 0.4) bansuriPhrase(random, bar, 0.45, degreeCount);
        break;
      case 'race':
        // A driving dhol with heavy bass under it.
        fill(bar.kick, [0, 6, 8, 11, 14], 0.86);
        fill(bar.snare, [4, 12], 0.72);
        fill(bar.hat, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], 0.22);
        fill(bar.dholLow, [0, 3, 8, 11], 0.72);
        fill(bar.dholHigh, [2, 6, 7, 10, 14, 15], 0.56);
        bar.bass[0] = chord[0];
        bar.bass[6] = chord[0];
        bar.bass[11] = chord[1];
        bar.bass[14] = chord[2];
        if (isTurn) fill(bar.dholHigh, [12, 13, 14, 15], 0.72);
        if (index % 8 >= 4) bansuriPhrase(random, bar, 0.9, degreeCount);
        break;
      case 'pursuit':
        // Half-time trap, a dark cowbell riff, and rolling hats.
        fill(bar.kick, [0, 3, 10], 1);
        fill(bar.snare, [8], 0.88);
        fill(bar.hat, [0, 2, 4, 6, 8, 10, 12, 14], 0.3);
        if (index % 2 === 1) fill(bar.hat, [13, 15], 0.28);
        bar.cowbell = [...riff];
        bar.bass[0] = 0;
        bar.bass[3] = 0;
        bar.bass[10] = chord[1];
        if (isTurn) {
          bar.bass[14] = chord[2];
          fill(bar.dholHigh, [12, 13, 14, 15], 0.8);
        }
        fill(bar.dholLow, [6], 0.5);
        break;
    }
    section.push(bar);
  }
  return section;
}

export interface MusicContext {
  scene: 'menu' | 'roam' | 'race' | 'pursuit';
  /** Heat stars, or how close the race is, from 0 to 1. */
  intensity: number;
  rain: number;
  blackout: boolean;
  daylight: number;
  speed: number;
}

export type LayerName = 'drums' | 'dhol' | 'tabla' | 'cowbell' | 'bass' | 'ektara' | 'bansuri' | 'pad' | 'crackle';

export interface MusicMix {
  mood: Mood;
  tempo: number;
  scale: ScaleName;
  /** The tonic, as a MIDI note. */
  tonic: number;
  layers: Record<LayerName, number>;
  /** Everything passes through this filter: rain and darkness close it down. */
  filterHz: number;
}

/** Turns what is happening into what the band should be playing. */
export function chooseMix(context: MusicContext): MusicMix {
  const layers: Record<LayerName, number> = { drums: 0, dhol: 0, tabla: 0, cowbell: 0, bass: 0, ektara: 0, bansuri: 0, pad: 0, crackle: 0 };
  let mood: Mood;
  let tempo: number;
  let scale: ScaleName;
  let tonic: number;
  let filterHz = 12000;
  if (context.scene === 'pursuit') {
    mood = 'pursuit';
    tempo = 70 + Math.round(context.intensity * 8);
    scale = 'bhairavi';
    tonic = 38;
    layers.drums = 0.56;
    layers.bass = 0.6;
    layers.cowbell = 0.3 + context.intensity * 0.36;
    layers.dhol = context.intensity * 0.7;
    layers.pad = 0.14;
  } else if (context.scene === 'race') {
    mood = 'race';
    tempo = 128 + Math.round(context.intensity * 12);
    scale = 'kafi';
    tonic = 40;
    layers.drums = 0.62;
    layers.dhol = 0.72;
    layers.bass = 0.8;
    layers.bansuri = 0.36 + context.intensity * 0.3;
    layers.pad = 0.14;
  } else if (context.blackout) {
    mood = 'blackout';
    tempo = 66;
    scale = 'bhairav';
    tonic = 38;
    layers.ektara = 0.74;
    layers.dhol = 0.5;
    layers.bansuri = 0.4;
    layers.pad = 0.1;
    filterHz = 5200;
  } else if (context.scene === 'menu') {
    mood = 'adda';
    tempo = 76;
    scale = 'baul';
    tonic = 43;
    layers.ektara = 0.62;
    layers.tabla = 0.56;
    layers.bansuri = 0.44;
    layers.pad = 0.22;
    layers.crackle = 0.4;
  } else if (context.rain > 0.5) {
    mood = 'rain';
    tempo = 70;
    scale = 'bhairavi';
    tonic = 41;
    layers.drums = 0.42;
    layers.tabla = 0.42;
    layers.bass = 0.46;
    layers.ektara = 0.4;
    layers.bansuri = 0.5;
    layers.pad = 0.4;
    layers.crackle = 0.25;
    filterHz = 3200;
  } else {
    mood = 'cruise';
    tempo = 82 + Math.round(context.speed * 8);
    scale = context.daylight > 0.5 ? 'yaman' : 'kafi';
    tonic = context.daylight > 0.5 ? 45 : 41;
    layers.drums = 0.46 + context.speed * 0.2;
    layers.tabla = 0.4;
    layers.bass = 0.5;
    layers.bansuri = 0.38;
    layers.pad = 0.36;
    layers.crackle = 0.32;
  }
  return { mood, tempo, scale, tonic, layers, filterHz };
}

/** The note a scale degree stands for, wrapping into higher octaves. */
export function degreeToMidi(scale: readonly number[], tonic: number, degree: number): number {
  const count = scale.length;
  const octave = Math.floor(degree / count);
  const within = ((degree % count) + count) % count;
  return tonic + scale[within] + octave * 12;
}

export function midiToFrequency(note: number): number {
  return 440 * Math.pow(2, (note - 69) / 12);
}
