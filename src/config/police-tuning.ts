/**
 * Every number for pursuits (Phase 3): heat, the units at each level, tactics, roadblocks,
 * spikes, air support, hiding, traps and the দম slow motion.
 */

export interface HeatLevel {
  /** Heat score needed to reach this level. */
  score: number;
  /** Cars chasing at this level, before adaptive difficulty and the quality limit. */
  units: number;
  /** Fraction of the normal top speed and engine power. */
  speedScale: number;
  powerScale: number;
  /** Seconds out of sight before the pursuit ends. */
  cooldownSeconds: number;
  /** Tint for the units at this level. */
  tint: number;
}

export const POLICE = {
  /** Index 0 is star one. */
  levels: [
    { score: 0, units: 2, speedScale: 0.9, powerScale: 0.98, cooldownSeconds: 8, tint: 0xf1f0ea },
    { score: 110, units: 3, speedScale: 0.96, powerScale: 1.02, cooldownSeconds: 12, tint: 0xf1f0ea },
    { score: 290, units: 4, speedScale: 1, powerScale: 1.08, cooldownSeconds: 16, tint: 0xdcdcdc },
    { score: 560, units: 6, speedScale: 1.08, powerScale: 1.16, cooldownSeconds: 22, tint: 0x8c97a3 },
    { score: 950, units: 8, speedScale: 1.15, powerScale: 1.24, cooldownSeconds: 30, tint: 0x626c78 },
  ] satisfies HeatLevel[],

  heat: {
    /** Heat score per second during a pursuit. */
    perSecond: 3.2,
    perFastSecond: 2,
    fastSpeedKmh: 150,
    ramPolice: 45,
    trafficCrash: 22,
    trap: 40,
    nearMiss: 5,
    /** Unseen for this long, and the pursuit turns into a search. */
    lostSightDelay: 2.4,
    cooldownDecayWhenSeen: 0.6,
    /** Escape reward: points per star, plus points per second of pursuit. */
    escapePointsPerStar: 500,
    escapePointsPerSecond: 12,
    bustFinePerStar: 400,
  },

  bust: {
    /** Slower than this with a unit next to you, and the arrest meter fills. */
    speed: 5,
    radius: 8,
    seconds: 4.6,
    /** Each extra unit nearby fills it this much faster. */
    extraUnitScale: 0.22,
    /** Once you move again, the meter empties this quickly. */
    drainSeconds: 1.1,
  },

  offense: {
    /** A patrol starts a pursuit if it sees you going faster than this, this close. */
    speedingKmh: 95,
    speedingRadius: 95,
    crashRadius: 130,
  },

  perception: {
    /** Ground units lose you beyond this even with a clear line. */
    sightRange: 175,
    checkSeconds: 0.2,
    /** A hidden, slow car is only noticed this close. */
    hiddenSightRange: 14,
  },

  units: {
    patrols: 2,
    spawnMinRadius: 150,
    spawnMaxRadius: 260,
    hiddenRadius: 210,
    respawnDistance: 440,
    spawnEverySeconds: 1.1,
    routeEverySeconds: 0.8,
    tacticsEverySeconds: 1,
    roamSpeed: 13,
    roamLaneOffset: 3,
    directRange: 105,
    /** A unit far behind gets this much extra engine, so a chase stays a chase. */
    rubberBandDistance: 170,
    rubberBandPower: 1.12,
    sirenYieldEverySeconds: 0.5,
    sirenYieldRadius: 38,
  },

  driver: {
    steerGain: 2.3,
    steerSmoothing: 11,
    lookAheadBase: 8,
    lookAheadPerSpeed: 0.5,
    cornerLateral: 10.5,
    cornerBrake: 10,
    routePointSpacing: 8,
    handbrakeError: 1.05,
    handbrakeMinSpeed: 15,
    whiskerBase: 6,
    whiskerPerSpeed: 0.55,
    whiskerAngle: 0.5,
    whiskerSteer: 0.55,
    whiskerSlow: 0.55,
    stuckSeconds: 1.3,
    reverseSeconds: 1.2,
    avoidRadius: 26,
    avoidLateral: 2.2,
    avoidSteer: 0.42,
    reverseSteer: 0.7,
    nitroMinError: 0.2,
    /** Heading error at which a driver starts slowing, and reaches its slowest. */
    turnSlowFrom: 0.6,
    turnSlowTo: 1.3,
    turnSlowTop: 22,
    turnSlowSpeed: 5.5,
  },

  tactics: {
    /** Star level where each tactic begins. */
    boxInFromStars: 2,
    pitFromStars: 3,
    ramFromStars: 4,
    frontSlotBase: 13,
    frontSlotPerSpeed: 0.55,
    flankSide: 2.9,
    flankAhead: 0.8,
    rearDistance: 7,
    /** How far from a stopped car the units pull up. */
    arrestRing: 5.5,
    pitSide: 1.7,
    pitBehind: 3.4,
    /** PIT: spin kick on the player, and how much rear grip it knocks out. */
    pitYawKick: 1750,
    pitRearGrip: 0.55,
    pitMinSpeed: 12,
    pitCooldown: 6,
    predictSeconds: 0.35,
    ramContactCooldown: 1.5,
    confuseRadius: 60,
    confuseSeconds: 3.2,
    confuseCooldown: 13,
    stunSeconds: 5,
  },

  roadblock: {
    fromStars: 3,
    everySeconds: 24,
    distanceAhead: 210,
    maxBlocks: 2,
    carSpacing: 4.5,
    /** The gap left open so there is always a way through. */
    gapWidth: 3.6,
    carMass: 1300,
    removeBehind: 130,
    lifeSeconds: 40,
    spikesFromStars: 4,
  },

  spikes: {
    dropFromStars: 4,
    dropEverySeconds: 17,
    dropAhead: 26,
    dropAheadMax: 80,
    halfDepth: 0.55,
    halfLengthDrop: 2.8,
    lifeSeconds: 16,
    punctureSeconds: 11,
    maxStrips: 4,
  },

  puncture: {
    topSpeedLoss: 0.4,
    powerLoss: 0.3,
    gripLoss: 0.28,
    wobbleRadians: 0.024,
    wobbleHz: 7,
  },

  drone: {
    fromStars: 3,
    height: 16,
    speed: 29,
    /** A drone sees only this far, and its battery runs out. */
    sightRange: 85,
    lifeSeconds: 34,
    everySeconds: 26,
    startDistance: 140,
  },

  helicopter: {
    fromStars: 5,
    height: 50,
    speed: 40,
    /** Fly faster than it can follow, and it loses you past this range. */
    sightRange: 125,
    orbitRadius: 26,
    startDistance: 260,
    spotRadius: 11,
    spotFollow: 1.6,
    rotorSpeed: 30,
    bankPerSpeed: 0.008,
  },

  hide: {
    /** Below this speed a hiding spot works. */
    slowSpeedKmh: 28,
    alleySpeedKmh: 70,
    garageFactor: 3.2,
    teaFactor: 2.6,
    alleyFactor: 1.6,
    flyoverFactor: 1.3,
    teaRadius: 13,
    garageCount: 4,
    /** Open ground between the road's edge and the garage mouth. */
    garageSetback: 5,
    garageSpacing: 320,
    /** Roofs block a helicopter or a drone. */
    garageWidth: 26,
    garageDepth: 16,
    garageHeight: 3.3,
    garageLevels: 2,
  },

  traps: {
    triggerRadius: 4.6,
    triggerMinSpeed: 9,
    stunRadius: 30,
    points: 400,
    nitro: 12,
    lifeSeconds: 12,
    rearmSeconds: 80,
    rearmDistance: 120,
    slowMoScale: 0.42,
    slowMoSeconds: 0.75,
    drumMass: 60,
    poleMass: 45,
    tankMass: 240,
    /** How hard the falling pieces are thrown across the road. */
    tipSpeed: 5.5,
    /** Every Nth suitable road gets a trap. */
    everyEdges: 2,
    offset: 1.6,
  },

  dom: {
    capacity: 100,
    start: 60,
    /** Burn is in real seconds: a full meter lasts this long. */
    fullBurnSeconds: 4.5,
    timeScale: 0.38,
    minToStart: 14,
    passivePerSecond: 2.2,
    nearMiss: 12,
    squeeze: 30,
    driftPerSecond: 7,
    trap: 22,
    /** How quickly time slows down and speeds up, in real seconds. */
    blendSeconds: 0.16,
  },

  adaptive: {
    min: 0.82,
    max: 1.22,
    start: 1,
    afterBust: -0.06,
    afterEscape: 0.045,
    longPursuitSeconds: 150,
    afterLongPursuit: 0.02,
    /** How strongly this reaches into police speed and unit count. */
    speedInfluence: 0.5,
    /** How strongly this changes the time an arrest takes. */
    bustInfluence: 1,
  },

  radio: {
    minGapSeconds: 2.1,
    showSeconds: 3.4,
    categoryCooldownSeconds: 7,
  },

  audio: {
    sirenGain: 0.15,
    sirenRange: 220,
    heliGain: 0.2,
    heliRange: 260,
    droneGain: 0.05,
    droneRange: 90,
    radioGain: 0.1,
  },
};

/** Star level (1 to 5) for a heat score. */
export function starsForScore(score: number): number {
  let stars = 1;
  for (let i = 0; i < POLICE.levels.length; i++) {
    if (score >= POLICE.levels[i].score) stars = i + 1;
  }
  return stars;
}
