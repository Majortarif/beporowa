/**
 * Every number for the living city (Phase 2): road sizes, traffic behaviour, pedestrians,
 * horn language, GPS and minimap. Driving numbers stay in tuning.ts.
 */

export type RoadKind = 'lane' | 'street' | 'avenue' | 'deck' | 'ramp';

export interface RoadKindSpec {
  halfWidth: number;
  /** Lanes in each direction. */
  lanes: number;
  laneWidth: number;
  /** Space between the two directions. */
  median: number;
  /** m/s */
  speedLimit: number;
  /** Relative chance that traffic spawns on this kind of road. */
  spawnWeight: number;
}

export type TrafficType = 'rickshaw' | 'cng' | 'bike' | 'car' | 'pickup' | 'bus';

export interface TrafficSpec {
  length: number;
  width: number;
  height: number;
  mass: number;
  /** Desired speed range, m/s. */
  speedMin: number;
  speedMax: number;
  accel: number;
  brake: number;
  /** Time headway to the vehicle ahead, seconds. */
  headway: number;
  minGap: number;
  /** A crash can never throw this vehicle faster than this, m/s. */
  maxKnockSpeed: number;
  /** Slow, narrow vehicles weave a little inside the lane. */
  weave: number;
  allowedRoads: readonly RoadKind[];
  /** Spawn share on each road kind. */
  share: Partial<Record<RoadKind, number>>;
  /** Random tints; one is chosen per vehicle. */
  tints: readonly number[];
}

export const CITY = {
  roads: {
    lane: { halfWidth: 3.3, lanes: 1, laneWidth: 3, median: 0, speedLimit: 9, spawnWeight: 0.8 },
    street: { halfWidth: 5.6, lanes: 1, laneWidth: 4.6, median: 0.6, speedLimit: 13, spawnWeight: 1.2 },
    avenue: { halfWidth: 10, lanes: 2, laneWidth: 3.7, median: 3, speedLimit: 17, spawnWeight: 1.5 },
    deck: { halfWidth: 7, lanes: 2, laneWidth: 3.2, median: 0.6, speedLimit: 24, spawnWeight: 0.9 },
    ramp: { halfWidth: 4.8, lanes: 1, laneWidth: 3.8, median: 0.4, speedLimit: 15, spawnWeight: 0.3 },
  } satisfies Record<RoadKind, RoadKindSpec>,

  network: {
    edgeSampleSpacing: 4,
    laneSampleSpacing: 3,
    connectorSampleSpacing: 2,
    deckHeight: 9,
    nodeRadiusScale: 1.25,
    nodeRadiusPadding: 2,
    /** A node where two roads simply continue needs only a small joint. */
    continuationRadiusScale: 0.7,
    roundaboutRadius: 34,
    roundaboutIslandRadius: 13,
    roundaboutRingRadius: 22,
    /** Below this turn angle a connector counts as going straight, degrees. */
    straightAngleDeg: 35,
    connectorSpeedPerRootRadius: 1.9,
    connectorMinSpeed: 4,
    spatialCell: 40,
  },

  signals: {
    green: 11,
    amber: 2,
    allRed: 1.4,
    /** Elevated merges and the alleys have no lights. These limit how many enter at once. */
    unsignaledCapacity: { lane: 2, street: 3, deck: 4, roundabout: 8 },
  },

  traffic: {
    tickNearRadius: 150,
    farTickEvery: 4,
    /** Traffic lives in a bubble around the player. */
    spawnMinRadius: 140,
    spawnMaxRadius: 340,
    despawnRadius: 420,
    spawnChecksPerSecond: 30,
    spawnClearance: 14,
    /** Inside this distance a new vehicle must be out of the camera's view. */
    spawnHiddenRadius: 200,
    jamSpawnShare: 0.45,
    bodyRadius: 55,
    bodyReleaseRadius: 70,
    maxDeceleration: 9,
    obstacleLookAhead: 55,
    stuckDespawnTime: 30,
    /** Jam zones breathe: speed swings between these fractions over this period. */
    jamSpeedMin: 0.08,
    jamSpeedMax: 0.34,
    jamWaveSeconds: 11,
    jamBikeLateral: 1.25,
    turnStraightWeight: 3,
    yield: { radius: 46, seconds: 3.4, speedScale: 0.4, lateralRate: 2.2, forwardCone: -0.2 },
    knock: {
      restitution: 0.22,
      /** Below this impact speed the vehicle only stops and complains. */
      softSpeed: 4,
      softStopSeconds: 2,
      seconds: 3.2,
      despawnDistance: 45,
      maxSeconds: 14,
      spin: 1.4,
      /** Keeps some speed so a hit is a setback, not a brick wall. */
      playerSpeedFloor: 0.28,
    },
    nearMiss: {
      radius: 24,
      minPlayerSpeed: 10,
      minRelativeSpeed: 6,
      clearance: 1.25,
      /** Two near misses on opposite sides this close together make a ফাঁক-ফোকর. */
      squeezeWindow: 0.75,
      points: 180,
      squeezePoints: 750,
      nitro: 5,
      squeezeNitro: 14,
      cooldown: 0.35,
    },
  },

  trafficTypes: {
    rickshaw: {
      length: 2.7, width: 1.15, height: 2, mass: 260,
      speedMin: 4.5, speedMax: 6.5, accel: 0.9, brake: 2.4, headway: 0.8, minGap: 0.9,
      maxKnockSpeed: 6.5, weave: 0.2,
      allowedRoads: ['lane', 'street'],
      share: { lane: 5, street: 2.4 },
      tints: [0xffffff, 0xf4efe0, 0xffe6c7],
    },
    cng: {
      length: 2.9, width: 1.42, height: 1.75, mass: 450,
      speedMin: 8, speedMax: 13, accel: 1.8, brake: 3.4, headway: 0.9, minGap: 1,
      maxKnockSpeed: 11, weave: 0.14,
      allowedRoads: ['lane', 'street', 'avenue', 'ramp', 'deck'],
      share: { lane: 2.2, street: 2.6, avenue: 2.2, deck: 0.6, ramp: 0.6 },
      tints: [0x3f9b52, 0x2f8a46, 0x54ad5f, 0x8fb33c],
    },
    bike: {
      length: 2, width: 0.72, height: 1.5, mass: 180,
      speedMin: 10, speedMax: 17, accel: 3, brake: 4.6, headway: 0.7, minGap: 0.8,
      maxKnockSpeed: 7, weave: 0.3,
      allowedRoads: ['lane', 'street', 'avenue', 'ramp', 'deck'],
      share: { lane: 1.6, street: 2, avenue: 2, deck: 1.2, ramp: 1 },
      tints: [0xd8402b, 0x1d2a5b, 0x222222, 0xf2a20c, 0xc2185b],
    },
    car: {
      length: 4.2, width: 1.8, height: 1.45, mass: 1200,
      speedMin: 11, speedMax: 21, accel: 2.3, brake: 4.2, headway: 1.1, minGap: 1.5,
      maxKnockSpeed: 18, weave: 0,
      allowedRoads: ['street', 'avenue', 'ramp', 'deck'],
      share: { street: 1.5, avenue: 3.4, deck: 4, ramp: 2 },
      tints: [0xefe3c8, 0xb8bcc0, 0x3b3f46, 0x8a2a20, 0x1f4a66, 0xd9d4c6, 0x5f6a3a],
    },
    pickup: {
      length: 5, width: 1.95, height: 1.8, mass: 1900,
      speedMin: 10, speedMax: 17, accel: 1.7, brake: 3.6, headway: 1.3, minGap: 1.8,
      maxKnockSpeed: 13, weave: 0,
      allowedRoads: ['street', 'avenue', 'ramp', 'deck'],
      share: { street: 0.6, avenue: 1.2, deck: 1, ramp: 0.6 },
      tints: [0x6f7e4a, 0x8b5a2b, 0x31566e, 0xc9c1ad],
    },
    bus: {
      length: 10.2, width: 2.5, height: 3.2, mass: 9000,
      speedMin: 8, speedMax: 15, accel: 1, brake: 2.8, headway: 1.6, minGap: 2.2,
      maxKnockSpeed: 4, weave: 0,
      allowedRoads: ['street', 'avenue', 'ramp', 'deck'],
      share: { street: 0.4, avenue: 1.4, deck: 0.9, ramp: 0.3 },
      tints: [0xffffff, 0xf2eadc, 0xffe2c4],
    },
  } satisfies Record<TrafficType, TrafficSpec>,

  pedestrians: {
    spawnRadius: 120,
    despawnRadius: 165,
    hiddenRadius: 45,
    walkSpeedMin: 0.9,
    walkSpeedMax: 1.6,
    laneOffset: 0.55,
    streetOffset: 1.4,
    avenueOffset: 1.9,
    dodgeLookAhead: 1.5,
    dodgeMinDistance: 7,
    dodgeLateral: 3.2,
    dodgeSpeed: 8,
    dodgeSeconds: 0.8,
    separation: 0.65,
    scatterRadius: 34,
    scatterSeconds: 1.8,
    scatterSpeed: 5,
    idleShare: 0.3,
    titleKeepOutRadius: 14,
    height: 1.68,
  },

  horn: {
    longPressSeconds: 0.55,
    tapGapSeconds: 0.27,
    bubbleSeconds: 1.5,
    honkBackRadius: 60,
    honkBackMax: 4,
    ambientHornEvery: 2.6,
    ambientHornRadius: 170,
    ambientBellEvery: 4.5,
    ambientGain: 0.1,
  },

  gps: {
    offRouteDistance: 38,
    arriveDistance: 28,
    instructionLookAhead: 280,
    repathCooldown: 2.5,
    /** Metres a route is treated as longer when it starts by turning round. */
    turnAroundPenalty: 140,
    beaconHeight: 90,
    beaconRadius: 3.2,
  },

  minimap: {
    pixelsPerMetre: 0.62,
    viewMetres: 340,
    refreshHz: 15,
    fullMapPadding: 60,
  },

  props: {
    avenueLampSpacing: 46,
    laneLampSpacing: 38,
    deckLampSpacing: 54,
    lampHeightUnderDeck: 6,
    cablePoleSpacing: 30,
    shopSignChance: 0.8,
    stallSpacing: 46,
    stallChance: 0.62,
    billboardSpacing: 180,
    steamStallRadius: 70,
  },

  buildings: {
    chunkSize: 220,
    occupancyCell: 2,
    oldTown: { widthMin: 7, widthMax: 13, depthMin: 9, depthMax: 15, floorsMin: 2, floorsMax: 7, setback: 0.9, gap: 0.5 },
    modern: { widthMin: 18, widthMax: 36, depthMin: 16, depthMax: 28, floorsMin: 5, floorsMax: 22, setback: 4.5, gap: 3 },
    fillAttempts: 900,
    fillSpacing: 8,
  },

  scoring: {
    districtPlateSeconds: 3,
  },
};
