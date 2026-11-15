/**
 * Every number for the time of day and the weather. A day is a ring of keys, each a complete look.
 * The night key is the game's original look, kept exactly, because that is the game's identity.
 */

export type WeatherKind = 'clear' | 'monsoon' | 'fog';
export type EnvKind = 'night' | 'dusk' | 'day' | 'storm';
export type TimeLock = 'auto' | 'dawn' | 'day' | 'dusk' | 'night';
export type WeatherLock = 'auto' | 'clear' | 'monsoon' | 'fog' | 'blackout';

export interface TimeKey {
  /** Share of the day: 0 is midnight, 0.5 is noon. */
  t: number;
  skyTop: number;
  skyMid: number;
  skyHorizon: number;
  fog: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemi: number;
  light: number;
  lightIntensity: number;
  env: number;
  envKind: EnvKind;
  /** Lit windows, street lamps, painted boards and hand-painted self-lit signs. */
  windows: number;
  lamps: number;
  boards: number;
  selfLit: number;
  /** Tubes and small lamps built into models. */
  baked: number;
  bloom: number;
  bloomThreshold: number;
  tint: readonly [number, number, number];
  saturation: number;
  contrast: number;
  stars: number;
  /** 0 is night and 1 is broad daylight. */
  daylight: number;
  /** Shimmer over a hot road. */
  haze: number;
}

const NIGHT: Omit<TimeKey, 't'> = {
  skyTop: 0x0b1420,
  skyMid: 0x2a2530,
  skyHorizon: 0x9a5426,
  fog: 0x3a2a26,
  fogDensity: 0.00125,
  hemiSky: 0x4a5f7a,
  hemiGround: 0x3a2518,
  hemi: 1.75,
  light: 0xaec4e0,
  lightIntensity: 1.5,
  env: 0.95,
  envKind: 'night',
  windows: 1.5,
  lamps: 1,
  boards: 1,
  selfLit: 1,
  baked: 1,
  bloom: 0.85,
  bloomThreshold: 0.72,
  tint: [1, 1, 1],
  saturation: 1,
  contrast: 1,
  stars: 1,
  daylight: 0,
  haze: 0,
};

export const TIME_KEYS: readonly TimeKey[] = [
  { t: 0, ...NIGHT },
  { t: 0.205, ...NIGHT },
  {
    t: 0.255,
    skyTop: 0x22365a,
    skyMid: 0x7a6a80,
    skyHorizon: 0xf0a070,
    fog: 0x8a6a60,
    fogDensity: 0.00115,
    hemiSky: 0x8aa0c0,
    hemiGround: 0x5a4030,
    hemi: 1.9,
    light: 0xffc090,
    lightIntensity: 1.3,
    env: 0.9,
    envKind: 'dusk',
    windows: 0.8,
    lamps: 0.7,
    boards: 0.72,
    selfLit: 0.6,
    baked: 0.8,
    bloom: 0.7,
    bloomThreshold: 0.8,
    tint: [1.06, 0.97, 0.92],
    saturation: 1.04,
    contrast: 1,
    stars: 0.08,
    daylight: 0.35,
    haze: 0,
  },
  {
    t: 0.33,
    skyTop: 0x3f7fc0,
    skyMid: 0x8fc0e0,
    skyHorizon: 0xe8dcc0,
    fog: 0xc8c4b0,
    fogDensity: 0.00062,
    hemiSky: 0xbfd8f0,
    hemiGround: 0x8a7a60,
    hemi: 2.3,
    light: 0xfff0d8,
    lightIntensity: 3,
    env: 0.85,
    envKind: 'day',
    windows: 0,
    lamps: 0,
    boards: 0.5,
    selfLit: 0.12,
    baked: 0.45,
    bloom: 0.42,
    bloomThreshold: 1,
    tint: [1.01, 1, 0.98],
    saturation: 1.02,
    contrast: 1.02,
    stars: 0,
    daylight: 1,
    haze: 0.2,
  },
  {
    t: 0.5,
    skyTop: 0x2f78c8,
    skyMid: 0x7fbce8,
    skyHorizon: 0xe0e4d8,
    fog: 0xc4ccc8,
    fogDensity: 0.00052,
    hemiSky: 0xcfe0f4,
    hemiGround: 0x94846a,
    hemi: 2.5,
    light: 0xfff6e8,
    lightIntensity: 3.5,
    env: 0.85,
    envKind: 'day',
    windows: 0,
    lamps: 0,
    boards: 0.5,
    selfLit: 0.1,
    baked: 0.4,
    bloom: 0.38,
    bloomThreshold: 1,
    tint: [1, 1, 0.98],
    saturation: 1,
    contrast: 1.03,
    stars: 0,
    daylight: 1,
    haze: 1,
  },
  {
    t: 0.68,
    skyTop: 0x35709f,
    skyMid: 0x9cbcd0,
    skyHorizon: 0xf0d4a0,
    fog: 0xd0bc98,
    fogDensity: 0.00062,
    hemiSky: 0xc4d0dc,
    hemiGround: 0x957a58,
    hemi: 2.3,
    light: 0xffe0b0,
    lightIntensity: 3,
    env: 0.85,
    envKind: 'day',
    windows: 0.05,
    lamps: 0,
    boards: 0.55,
    selfLit: 0.15,
    baked: 0.45,
    bloom: 0.45,
    bloomThreshold: 1,
    tint: [1.04, 1, 0.94],
    saturation: 1.05,
    contrast: 1.02,
    stars: 0,
    daylight: 0.95,
    haze: 0.5,
  },
  {
    t: 0.755,
    skyTop: 0x3a5a90,
    skyMid: 0xc09080,
    skyHorizon: 0xffa050,
    fog: 0xb08060,
    fogDensity: 0.00088,
    hemiSky: 0xa09cb0,
    hemiGround: 0x7a5238,
    hemi: 2,
    light: 0xffb070,
    lightIntensity: 2.3,
    env: 0.9,
    envKind: 'dusk',
    windows: 0.35,
    lamps: 0.25,
    boards: 0.7,
    selfLit: 0.4,
    baked: 0.65,
    bloom: 0.62,
    bloomThreshold: 0.86,
    tint: [1.08, 0.97, 0.88],
    saturation: 1.1,
    contrast: 1.02,
    stars: 0,
    daylight: 0.6,
    haze: 0.2,
  },
  {
    t: 0.81,
    skyTop: 0x1a2448,
    skyMid: 0x6a4060,
    skyHorizon: 0xe06030,
    fog: 0x6a4038,
    fogDensity: 0.00108,
    hemiSky: 0x6a6a90,
    hemiGround: 0x4a2c20,
    hemi: 1.85,
    light: 0xff8050,
    lightIntensity: 1.1,
    env: 0.92,
    envKind: 'dusk',
    windows: 1.15,
    lamps: 1,
    boards: 0.92,
    selfLit: 0.85,
    baked: 0.92,
    bloom: 0.8,
    bloomThreshold: 0.75,
    tint: [1.03, 0.97, 0.98],
    saturation: 1.08,
    contrast: 1,
    stars: 0.25,
    daylight: 0.22,
    haze: 0,
  },
  { t: 0.87, ...NIGHT },
  { t: 1, ...NIGHT },
];

export const ATMOSPHERE = {
  /** Real minutes for one whole day. */
  dayMinutes: 18,
  /** A new game begins as the evening comes on, which is when this city looks its best. */
  startTime: 0.8,
  /** Where each locked time of day sits. */
  lockedTimes: { dawn: 0.265, day: 0.47, dusk: 0.785, night: 0.95 } as const,
  sunriseAt: 0.235,
  sunsetAt: 0.815,
  sunPeak: 0.9,
  /** Where the moon hangs: the look of the original night. */
  moonDirection: [-0.43, 0.86, -0.28] as const,

  weather: {
    transitionSeconds: 24,
    raceTransitionSeconds: 7,
    /** The first stretch is always fair, so a first drive is not spent in a storm. */
    firstClearSeconds: 70,
    seconds: {
      clear: [130, 260] as const,
      monsoon: [120, 230] as const,
      fog: [90, 170] as const,
    },
    /** Likelihoods by month, from January. Rain in the monsoon months, fog in the cold ones. */
    byMonth: [
      { clear: 0.5, monsoon: 0.05, fog: 0.45 },
      { clear: 0.65, monsoon: 0.1, fog: 0.25 },
      { clear: 0.7, monsoon: 0.25, fog: 0.05 },
      { clear: 0.6, monsoon: 0.4, fog: 0 },
      { clear: 0.5, monsoon: 0.5, fog: 0 },
      { clear: 0.3, monsoon: 0.7, fog: 0 },
      { clear: 0.25, monsoon: 0.75, fog: 0 },
      { clear: 0.3, monsoon: 0.7, fog: 0 },
      { clear: 0.4, monsoon: 0.6, fog: 0 },
      { clear: 0.65, monsoon: 0.3, fog: 0.05 },
      { clear: 0.65, monsoon: 0.1, fog: 0.25 },
      { clear: 0.5, monsoon: 0.05, fog: 0.45 },
    ] as const,
    /** Every kind turns up now and then, whatever the month. */
    minimumShare: 0.08,
  },

  monsoon: {
    skyDay: 0x6c747c,
    skyNight: 0x141820,
    horizonDay: 0x8c9090,
    horizonNight: 0x3a2c2c,
    fogDay: 0x7a8288,
    fogNight: 0x2a2826,
    skyMix: 0.88,
    fogDensityScale: 2.3,
    lightScale: 0.25,
    hemiScale: 0.8,
    windowsAtLeast: 0.9,
    lampsAtLeast: 0.75,
    boardsAtLeast: 0.8,
    selfLitAtLeast: 0.65,
    bloomScale: 1.08,
    tint: [0.95, 0.99, 1.05] as const,
    saturation: 0.86,
    /** Rear-view grip on a soaked road, as a share of dry. */
    gripWhenSoaked: 0.88,
    /** Seconds between lightning, at its most and least frequent. */
    lightningEvery: [11, 32] as const,
    flashDecay: 5,
    /** How much police sight shrinks in a downpour. */
    sightScale: 0.82,
  },

  fog: {
    colourDay: 0xc4c4bc,
    colourNight: 0x4a4440,
    density: 0.0118,
    lightScale: 0.32,
    hemiScale: 0.92,
    windowsAtLeast: 0.5,
    lampsAtLeast: 0.5,
    tint: [1, 0.99, 0.97] as const,
    saturation: 0.72,
    contrast: 0.92,
    sightScale: 0.62,
  },

  wetness: {
    /** How wet the road stays without rain, at night and in the day. */
    drySettledNight: 0.72,
    drySettledDay: 0.08,
    risePerSecond: 0.05,
    fallPerSecond: 0.0075,
  },

  flood: {
    risePerSecond: 0.011,
    fallPerSecond: 0.0042,
    /** It only rises once the rain is heavy. */
    risesFromRain: 0.55,
  },

  blackout: {
    /** Only after dark. Seconds between tries, and the chance each try comes to anything. */
    every: [170, 340] as const,
    chance: 0.6,
    seconds: [55, 110] as const,
    radius: 520,
    /** How fast the dark spreads and how fast the power comes back, metres per second. */
    spreadSpeed: 150,
    returnSpeed: 240,
    /** Police see less far in the dark. */
    sightScale: 0.76,
  },

  /** Words from the DJ when the hour passes these points. */
  dayMarks: { dawn: 0.24, morning: 0.33, dusk: 0.8, night: 0.87 } as const,

  /** Low-lying roads that flood, as pairs of map nodes. */
  floodRoads: [
    ['B1', 'B2'],
    ['A2', 'A3'],
    ['C1', 'C2'],
    ['F1', 'F2'],
    ['B3', 'B4'],
    ['a2', 'a3'],
    ['b1', 'b2'],
    ['G1', 'G2'],
  ] as const,
  floodDepth: 0.27,
  /** Water here is deep enough to count as flood, in metres. */
  floodFromDepth: 0.05,
  /** Water drag per wheel: newtons per (m/s)^2. */
  floodDragPerSpeed2: 0.85,
  /** Tyres start to float at this speed, and float most at the second, m/s. */
  aquaplaneFrom: 20,
  aquaplaneFull: 42,
  aquaplaneGrip: 0.55,
  potholesPerZone: 3,
  potholeRadius: 0.9,
  potholeSpeedLoss: 0.12,
  potholeWear: 0.35,

  rain: { boxSize: 34, fallSpeed: 26, streakLength: 1.25, width: 0.022 },
  mist: { boxSize: 170, size: 62 },
};
