/** Every number for races (Phase 4): courses, starts, AI driving, rubber-banding and rewards. */

export const RACE = {
  course: {
    /** Distance between stored points on a course line, metres. */
    spacing: 3,
    /** Sharp corners at junctions are rounded by averaging over this many points each way. */
    smoothRadius: 3,
    smoothPasses: 2,
    /** Sideways changes, such as moving to the left carriageway, happen over this many points each way. */
    offsetSmoothRadius: 7,
    offsetSmoothPasses: 2,
    /** A point-to-point course begins this far after its first node, leaving room for the grid. */
    runUp: 58,
    /** ...and ends this far before its last node. */
    finishInset: 24,
    /** A loop's start line sits this far after its first node. */
    loopStartOffset: 44,
    gateSpacing: 210,
    gateMinimum: 3,
    /** How far back and ahead a car is looked for on the line, from where it last was. */
    locateBack: 24,
    locateAhead: 60,
    /** Height differences count this much more than distance, so a flyover is not the road beneath it. */
    locateHeightWeight: 5,
    /** Beyond this the HUD asks the player to come back. */
    offRouteWarn: 42,
    /** Corner markers appear where the road turns more than this over cornerSpan metres. */
    cornerAngle: 0.62,
    cornerSpan: 30,
    cornerSpacing: 46,
    /** Places a line must go around, such as the toll booth on the flyover. */
    obstaclePush: 4.8,
    obstacleReach: 26,
  },

  grid: {
    rowSpacing: 8.5,
    sideOffset: 2.7,
    behindLine: 5,
    crowdPerSide: 12,
  },

  countdown: {
    /** Seconds on each of ৩, ২ and ১. */
    stepSeconds: 0.95,
    goShowSeconds: 0.9,
  },

  launch: {
    /** Press the gas within this long before GO for a perfect launch. */
    windowBefore: 0.42,
    windowAfter: 0.2,
    /** Instant push at a perfect launch, m/s. */
    perfectSpeed: 4.2,
    perfectNitro: 14,
    /** Too early, and the wheels spin for this long at reduced power. */
    earlySeconds: 0.7,
    earlyPower: 0.45,
  },

  finish: {
    /** Seconds of auto-braking and slow motion before the results. */
    coolDownSeconds: 2.6,
    slowMoScale: 0.55,
    /** Once the leader is home, everyone else has this long. */
    dnfSeconds: 40,
    /** A slower limit for the rival's own cool-down lap. */
    cruiseSpeed: 16,
  },

  driver: {
    steerGain: 2.25,
    steerSmoothing: 12,
    lookAheadBase: 8,
    lookAheadPerSpeed: 0.52,
    cornerLateral: 10.5,
    cornerBrake: 10,
    routePointSpacing: 8,
    handbrakeError: 1.15,
    handbrakeMinSpeed: 17,
    whiskerBase: 5,
    whiskerPerSpeed: 0.42,
    whiskerAngle: 0.44,
    whiskerSteer: 0.5,
    whiskerSlow: 0.6,
    stuckSeconds: 1.2,
    reverseSeconds: 1.1,
    avoidRadius: 26,
    avoidLateral: 2.2,
    avoidSteer: 0.42,
    reverseSteer: 0.7,
    nitroMinError: 0.14,
    turnSlowFrom: 0.6,
    turnSlowTo: 1.3,
    turnSlowTop: 24,
    turnSlowSpeed: 5.5,
  },

  ai: {
    avoidEverySeconds: 0.1,
    /** How far ahead a driver reacts to traffic, from no traffic skill to full skill. */
    trafficReachMin: 16,
    trafficReachMax: 34,
    /** How much a driver slows for an obstacle, from no traffic skill to full skill. */
    trafficSlowMin: 0.5,
    trafficSlowMax: 0.85,
    racerReach: 18,
    /** Sideways room a driver leaves when passing another car, metres. */
    passClearance: 2.5,
    lateralLimit: 3.6,
    lateralRate: 3.2,
    lanePassLimit: 1.2,
    mistakeCheckSeconds: 1,
    mistakeSeconds: 0.9,
    mistakeSpeedScale: 0.74,
    mistakeLateral: 2.2,
    blockReachBehind: 26,
    blockHoldSeconds: 1.2,
    ramReach: 6,
    ramCooldown: 4,
    ramSteer: 1.5,
    /** Nitro only comes out with this much straight road ahead. */
    nitroStraight: 90,
    nitroRegenPerSecond: 3.2,
    stuckRespawnSeconds: 5,
    stuckForceRespawnSeconds: 12,
    respawnBehind: 16,
    offRouteRespawn: 34,
    driftCornerSpeed: 15,
    driftSlipAmount: 0.3,
    provokedSeconds: 9,
    provokedCorner: 0.7,
    provokedAggression: 0.55,
    provokedMistakes: 2.2,
    provokeRadius: 42,
    pushFraction: 0.72,
    pushPower: 0.07,
    pushTopSpeed: 0.035,
    pushCorner: 0.9,
    pushBlock: 0.4,
    runnerSpeedScale: 0.9,
    fleeRadius: 80,
    hornEverySeconds: 1.1,
    hornReach: 38,
  },

  /** Fair rubber-banding: small, capped, and gone by the end, so the finish is always earned. */
  rubberBand: {
    catchUpStart: 45,
    catchUpFull: 240,
    catchUpPower: 0.14,
    catchUpTopSpeed: 0.05,
    easeStart: 70,
    easeFull: 320,
    easePower: 0.2,
    easeTopSpeed: 0.09,
    /** Fades out across this last part of the race. */
    fadeFrom: 0.78,
    fadeTo: 0.94,
  },

  /** How much the player's record moves all rivals, either way. */
  memory: {
    marginForFullSkill: 18,
    skillPower: 0.035,
    skillCorner: 0.7,
    sideMinimum: 4,
    nitroEarlierBy: 0.12,
    /** Each new race weighs this much against what is remembered. */
    learnRate: 0.3,
    crashAggression: 0.25,
    crashesForFull: 0.9,
  },

  drag: {
    /** Below this share of the rev range the engine bogs, and at the limiter it loses power. */
    bogBelow: 0.48,
    bogPower: 0.62,
    bestFrom: 0.8,
    bestTo: 0.965,
    limiterAt: 0.985,
    limiterPower: 0.72,
    /** A rival shifts at a share of the range, plus or minus this. */
    aiShiftAt: 0.9,
    aiShiftSpread: 0.05,
    shiftLightFrom: 0.84,
  },

  drift: {
    rivalPace: 1,
  },

  takedown: {
    health: 100,
    /** Closing speed below this does nothing, m/s. */
    minClosing: 3,
    damagePerSpeed: 11,
    sideBonus: 1.35,
    hitCooldown: 0.55,
    slowMoScale: 0.5,
    slowMoSeconds: 0.7,
    pointsPerTarget: 300,
  },

  delivery: {
    /** Slower than this inside the circle counts as handing over. */
    stopSpeedKmh: 42,
    radius: 13,
    /** Cargo lost per unit of crash strength. */
    cargoPerCrash: 34,
    softCrashCargo: 5,
    crashCooldown: 0.5,
  },

  openGates: {
    radius: 15,
  },

  rewards: {
    /** Ring points for gold, silver and bronze, as a share of the event's value. */
    medalShare: [1, 0.65, 0.4] as const,
    replayShare: 0.25,
    rivalBeatenBonus: 500,
  },

  taunts: {
    cooldownSeconds: 7,
    showSeconds: 3.4,
    /** Only taunt when this close. */
    reach: 70,
  },

  markers: {
    /** Stop within this of a race flag to enter it. */
    enterRadius: 15,
    enterSpeedKmh: 70,
    visibleRadius: 420,
  },

  cutscene: {
    flySeconds: 3,
    rivalSeconds: 5.4,
    settleSeconds: 1.4,
    wordsPerSecond: 3.6,
    closeFov: 42,
    wideFov: 56,
    orbitRadius: 6.6,
    orbitHeight: 1.25,
    orbitSpeed: 0.34,
  },

  boss: {
    /** Heat added when the police join, per star wanted. */
    heatPerStar: 170,
  },
};
