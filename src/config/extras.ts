/**
 * Phase 7 tuning that lives on the player's machine: ghosts, tilt and slider steering,
 * gamepad rumble, and the colours that stay readable for every kind of colour vision.
 * Online numbers (leaderboards, the relay, the banter proxy) live in `online.ts`.
 */

import type { RaceMode } from './race-events';

export const GHOST = {
  /** Samples per second. Catmull-Rom between them keeps the line smooth at speed. */
  hz: 12,
  /** The longest run a ghost may hold. Longer runs keep no ghost. */
  maxSeconds: 420,
  /** Points and takedowns are not a line to follow, so these keep no ghost. */
  skipModes: ['drift', 'takedown'] as readonly RaceMode[],
  colour: '#8fe9ff',
  opacity: 0.34,
  /** Close up a ghost fades further, so it never hides the road. */
  nearOpacity: 0.1,
  fadeNear: 5,
  fadeFar: 16,
  /** How far away its name plate still shows. */
  tagReach: 160,
  /** A friend's car is drawn this far behind its latest message, so it moves smoothly. */
  remoteDelaySeconds: 0.12,
} as const;

export const TILT = {
  /** Degrees of tilt for a full turn of the wheel. */
  fullLockDegrees: 26,
  deadzoneDegrees: 2.5,
  /** How quickly the steering follows the phone, per second. */
  follow: 14,
} as const;

export const TOUCH_SLIDER = {
  /** Share of the slider's half-width needed for a full turn. */
  fullLockShare: 0.85,
  /** Steering returns to the middle at this rate when the thumb lifts. */
  returnRate: 6,
} as const;

export interface RumbleShape {
  /** 0 to 1. The heavy motor. */
  strong: number;
  /** 0 to 1. The light motor. */
  weak: number;
  ms: number;
}

export const RUMBLE: Record<'impact' | 'police' | 'nitro' | 'pothole' | 'trap' | 'finish' | 'countdown', RumbleShape> = {
  impact: { strong: 0.9, weak: 0.5, ms: 220 },
  police: { strong: 0.6, weak: 0.4, ms: 160 },
  nitro: { strong: 0.15, weak: 0.55, ms: 380 },
  pothole: { strong: 0.75, weak: 0.2, ms: 140 },
  trap: { strong: 0.5, weak: 0.7, ms: 260 },
  finish: { strong: 0.3, weak: 0.3, ms: 500 },
  countdown: { strong: 0, weak: 0.35, ms: 90 },
};

export type ColourVision = 'normal' | 'protan' | 'deutan' | 'tritan';

/** Colours that carry meaning on the minimap and HUD. Each set was checked for its kind of colour vision. */
export interface MarkerColours {
  route: string;
  destination: string;
  racer: string;
  friend: string;
  policeA: string;
  policeB: string;
  ghost: string;
  good: string;
  bad: string;
}

export const MARKER_COLOURS: Record<ColourVision, MarkerColours> = {
  normal: { route: '#d8402b', destination: '#6fe0c8', racer: '#f2a20c', friend: '#c58cff', policeA: '#d8402b', policeB: '#3f6fe0', ghost: '#8fe9ff', good: '#3fbf6f', bad: '#e0503a' },
  // Red and green fall together: lean on blue against orange, with lightness apart.
  protan: { route: '#f2a20c', destination: '#6fd2ff', racer: '#ffe08a', friend: '#b6a6ff', policeA: '#ffffff', policeB: '#2f5fe0', ghost: '#9ad8ff', good: '#3f8fe0', bad: '#f2a20c' },
  deutan: { route: '#f29a0c', destination: '#6fd2ff', racer: '#ffe08a', friend: '#b6a6ff', policeA: '#ffffff', policeB: '#2f5fe0', ghost: '#9ad8ff', good: '#3f8fe0', bad: '#f29a0c' },
  // Blue and yellow fall together: lean on red against teal.
  tritan: { route: '#e0303a', destination: '#3fd0c0', racer: '#ff8fb0', friend: '#ffffff', policeA: '#e0303a', policeB: '#ffffff', ghost: '#7fe0e0', good: '#2fb8a8', bad: '#e0303a' },
};

export type SubtitleSize = 'small' | 'normal' | 'large' | 'huge';

export const SUBTITLE_SCALE: Record<SubtitleSize, number> = { small: 0.85, normal: 1, large: 1.25, huge: 1.55 };
