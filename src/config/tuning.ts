/**
 * Every gameplay and presentation number in Phase 1 lives in this one file.
 * Units: metres, seconds, kilograms, newtons, radians unless the name says otherwise.
 * The dev panel (` key) edits this object live, so values are read every frame.
 */

export type QualityName = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityPreset {
  /** Largest device pixel ratio used by the renderer. */
  maxPixelRatio: number;
  /** Dynamic resolution never goes under this fraction of maxPixelRatio. */
  minResolutionScale: number;
  /** Composer samples; 0 disables MSAA. */
  multisampling: number;
  bloom: boolean;
  chromaticAberration: boolean;
  /** Planar wet-road reflection, as a fraction of screen size. 0 disables it. */
  reflectionScale: number;
  /** Re-render the reflection every N frames. */
  reflectionEveryNFrames: number;
  shadows: boolean;
  shadowMapSize: number;
  clearcoatPaint: boolean;
  headlightSpot: boolean;
  nitroLight: boolean;
  smokeParticles: number;
  sparkParticles: number;
  skidSegments: number;
  /** How many of the placed buildings to keep, 0 to 1. */
  buildingDensity: number;
  anisotropy: number;
  targetFps: number;
  /** Vehicles alive around the player in the city. */
  trafficTotal: number;
  /** Vehicles near the player with real colliders. */
  trafficBodies: number;
  pedestrians: number;
  /** Render traffic into the wet-road reflection too. */
  trafficReflections: boolean;
  /** Police cars with full physics at once. */
  policeUnits: number;
  /** Parked cars available for roadblocks. */
  policeParked: number;
  /** One real flashing light on the nearest police car. */
  policeLight: boolean;
  /** AI cars in a race at once. */
  raceOpponents: number;
  /** Falling raindrops around the camera. */
  rainDrops: number;
  /** Soft sheets of mist. */
  mistBanks: number;
  /** Shafts of light under street lamps, and their glare. */
  lampShafts: boolean;
  /** Clouds and stars drawn in the sky. */
  skyDetail: boolean;
  /** Seconds of driving kept for the replay. */
  replaySeconds: number;
}

export const TUNING = {
  physics: {
    fixedHz: 60,
    /** Prevents the spiral of death after a long frame. */
    maxStepsPerFrame: 5,
    /** Slightly above Earth so jumps do not feel floaty. */
    gravity: 12,
  },

  vehicle: {
    mass: 1150,
    centerOfMass: { x: 0, y: -0.22, z: 0.02 },
    /** Principal inertia: x is pitch, y is yaw, z is roll. */
    inertia: { pitch: 1700, yaw: 1450, roll: 650 },
    angularDamping: 0.25,

    chassis: {
      halfWidth: 0.86,
      halfHeight: 0.33,
      halfLength: 1.9,
      offsetY: -0.04,
      roundRadius: 0.06,
      cabinHalfWidth: 0.62,
      cabinHalfHeight: 0.18,
      cabinHalfLength: 1.0,
      cabinOffsetY: 0.5,
      cabinOffsetZ: -0.3,
      friction: 0.25,
      restitution: 0.12,
      /** Contact force needed before an impact event fires, in newtons. */
      impactForceThreshold: 60000,
    },

    wheels: {
      radius: 0.32,
      trackHalf: 0.76,
      frontAxleZ: 1.28,
      rearAxleZ: -1.22,
      mountY: 0,
      /** Rear wheel spin added in a burnout, rad/s. */
      burnoutSpin: 60,
      burnoutMaxSpeed: 9,
    },

    suspension: {
      restLength: 0.42,
      stiffness: 41000,
      damping: 3400,
      antiRoll: 12000,
      /** Beyond this compression the bump stop takes over. */
      maxCompression: 0.3,
      bumpStiffness: 180000,
      maxForce: 42000,
      compressionSpeedClamp: 8,
    },

    engine: {
      powerWatts: 118000,
      maxDriveForce: 7600,
      /** Share of drive force on the front axle. 0 is pure RWD. */
      frontBias: 0.3,
      topSpeedKmh: 205,
      reverseTopKmh: 55,
      reverseForceScale: 0.6,
      /** Rolling resistance and engine braking when off throttle, newtons. */
      rollingResistance: 260,
      engineBrake: 620,
      reverseDelay: 0.12,
      idleRpm: 950,
      redlineRpm: 7200,
      upshiftRpm: 6900,
      downshiftRpm: 3100,
      /** Top speed of each virtual gear, km/h. */
      gearTopKmh: [52, 92, 128, 162, 192, 225],
      shiftTime: 0.11,
      /** Fraction of drive force kept while a shift is in progress. */
      shiftForceScale: 0.25,
      backfireMinRpm: 4800,
    },

    brakes: {
      force: 15000,
      frontBias: 0.62,
      handbrakeForce: 4200,
    },

    aero: {
      dragCoefficient: 0.42,
      downforceCoefficient: 0.42,
    },

    steering: {
      maxAngleDeg: 36,
      minAngleDeg: 3.5,
      /** Full lock aims for this lateral acceleration at any speed. */
      targetLateralAccel: 12,
      rateDegPerSec: 300,
      /** Hard limit including automatic counter-steer. */
      counterLockDeg: 44,
      /** Fraction of body slip angle fed back as auto counter-steer. */
      assistNormal: 0.55,
      assistDrift: 0.78,
      assistMinSpeed: 3,
      assistFullSpeed: 10,
    },

    tyre: {
      /** Lateral force per radian of slip, per tyre. */
      corneringStiffness: 42000,
      /** Slip angle where grip peaks. */
      peakSlipDeg: 6.5,
      /** Slip angle where the tyre is fully sliding. */
      slideSlipDeg: 24,
      slideRatioFront: 0.86,
      slideRatioRear: 0.8,
      frontGrip: 1.0,
      rearGrip: 1.04,
      /** Effective mass per tyre for no-overshoot limits, fraction of total mass. */
      effectiveMassFraction: 0.16,
      lowSpeedReference: 2.5,
      /** Max load used for grip, as a multiple of static load. */
      loadCap: 1.9,
      /** Height where tyre forces act, 0 is contact patch, 1 is centre of mass. */
      lateralForceHeight: 0.72,
      longitudinalForceHeight: 0.55,
      /** How much drive and brake force eat into lateral grip. */
      frictionCircleWeight: 0.82,
      longitudinalGripScale: 1.1,
    },

    drift: {
      /** Rear grip while the handbrake is held. */
      handbrakeRearGrip: 0.36,
      /** Rear grip during a held drift, off and on full throttle. */
      holdGripOffThrottle: 0.8,
      holdGripFullThrottle: 0.6,
      /** Steering into the slide between these values blends from recovery to full hold. */
      holdSteerMin: -0.1,
      holdSteerFull: 0.45,
      /** Rear grip floor at very high speed, so full throttle cannot spin the car there. */
      highSpeedHoldGrip: 0.86,
      highSpeedStartKmh: 95,
      highSpeedFullKmh: 165,
      enterSlipHandbrakeDeg: 6,
      enterSlipPowerDeg: 13,
      enterSlipPowerHighSpeedDeg: 26,
      exitSlipDeg: 7,
      exitTime: 0.22,
      minSpeedKmh: 28,
      gripDropRate: 7,
      gripRecoverRate: 1.5,
      frontGripBonus: 0.12,
      /** One-shot yaw kick when the handbrake is pulled with steering, N*m*s. */
      handbrakeYawKick: 700,
      /** Yaw torque from steering while sliding. */
      steerTorque: 1700,
      /** The rear tyres start to bite again from this angle, and fully at maxAngleDeg. */
      softAngleDeg: 30,
      maxAngleDeg: 50,
      limiterTorquePerDeg: 800,
      yawDamping: 900,
      /** Yaw rate above this gets pushed back hard, rad/s. */
      maxYawRate: 2.4,
      yawRateLimitGain: 5200,
      /** Forward push along the direction of travel while drifting on throttle. */
      thrust: 3000,
    },

    /** Quiet stability control that only acts when not in a drift. */
    stability: {
      /** Yaw rate limit is this lateral acceleration divided by speed. */
      lateralLimit: 17,
      gain: 7000,
      minSpeed: 7,
    },

    nitro: {
      capacity: 100,
      startAmount: 70,
      burnPerSecond: 26,
      regenPerSecond: 1.2,
      minToStart: 8,
      force: 5400,
      topSpeedBonusKmh: 42,
      driftGainPerSecond: 11,
    },

    air: {
      levelTorque: 1500,
      angularDamping: 2.2,
      yawControlTorque: 900,
    },

    upright: {
      /** Torque that rights the car when tipped past uprightLimit, on the ground. */
      torque: 4200,
      limit: 0.72,
      /** Auto reset when this long upside down or stuck. */
      autoResetTime: 2.6,
      autoResetUpY: 0.25,
      fallResetY: -12,
    },
  },

  surfaces: {
    road: { grip: 1.18, drag: 0 },
    shoulder: { grip: 0.82, drag: 240 },
    dirt: { grip: 0.68, drag: 620 },
    plaza: { grip: 1.06, drag: 0 },
    /** Standing water, on top of its speed-squared drag. */
    flood: { grip: 0.82, drag: 420 },
  },

  scoring: {
    driftMinAngleDeg: 12,
    driftMinPoints: 150,
    /** Points per degree per km/h per second. */
    driftPointsRate: 0.09,
    /** Multiplier grows by this per second of unbroken drift. */
    driftMultiplierPerSecond: 0.45,
    driftMaxMultiplier: 4,
    tierThresholds: [800, 2500, 6000],
  },

  camera: {
    chase: {
      distance: 5.9,
      height: 2.05,
      lookHeight: 0.85,
      lookAhead: 4.2,
      /** Extra distance at top speed. */
      speedDistance: 1.5,
      /** How far velocity heading pulls the camera in a slide, 0 to 1. */
      velocityFollow: 0.42,
      yawStiffness: 4.8,
      positionStiffness: 26,
      heightStiffness: 9,
      /** Metres of pull-back per m/s^2 of acceleration. */
      accelerationPull: 0.055,
      accelerationSmoothing: 3.5,
      steerLookOffset: 0.55,
      fovBase: 62,
      fovSpeed: 15,
      fovNitro: 9,
      fovStiffness: 4,
      rollPerLateralAccel: 0.0032,
    },
    far: { distanceScale: 1.35, heightScale: 1.25 },
    /** A tall screen has a narrow view, so the chase camera sits further back. */
    portrait: { distanceScale: 1.5, heightScale: 1.25 },
    hood: { y: 0.46, z: 0.72, lookAhead: 30, fovBase: 72, fovSpeed: 10 },
    shake: {
      speedStart: 28,
      speedAmount: 0.028,
      nitroAmount: 0.05,
      impactAmount: 0.42,
      impactDecay: 5,
      frequency: 19,
    },
    title: {
      radius: 6.6,
      height: 1.5,
      orbitSpeed: 0.11,
      fov: 42,
      /** Pushes the car toward the empty side of the title screen. */
      lookOffsetX: -1.5,
      /** On tall screens the camera looks below the car, which frames it above the board. */
      stackedLookDown: -1.25,
      stackedMaxZoomOut: 2.1,
    },
  },

  rig: {
    /** Visual roll and pitch, radians per m/s^2. */
    rollPerAccel: 0.0105,
    pitchPerAccel: 0.0085,
    maxRoll: 0.13,
    maxPitch: 0.085,
    springFrequency: 9,
    springDamping: 0.42,
    /** Extra wobble from an impact. */
    impactWobble: 0.09,
    wheelSmoothing: 34,
    indicatorHz: 1.6,
    indicatorMaxSpeed: 16,
    indicatorMinSteer: 0.35,
    tailLightIdle: 1.5,
    tailLightBrake: 7,
    reverseLight: 5,
    headlightEmissive: 6,
    headlightSpotIntensity: 260,
    headlightSpotDistance: 95,
    headlightSpotAngleDeg: 27,
    headlightSpotPenumbra: 0.65,
    headlightSpotDecay: 1.35,
    underglowOpacity: 0.34,
    underglowFlickerHz: 11,
    flameLengthNitro: 1.25,
    flameWidthNitro: 0.17,
    backfireDuration: 0.09,
    nitroLightIntensity: 26,
  },

  fx: {
    skid: {
      minSlip: 0.24,
      width: 0.2,
      opacity: 0.62,
      heightOffset: 0.018,
      minSegmentLength: 0.35,
    },
    smoke: {
      minSlip: 0.32,
      ratePerSecond: 44,
      life: 1.35,
      startSize: 0.7,
      endSize: 4.2,
      opacity: 0.17,
      riseSpeed: 0.75,
      drag: 1.6,
      inheritVelocity: 0.14,
      color: { r: 0.72, g: 0.74, b: 0.76 },
    },
    spray: {
      /** Wet-road mist behind the rear tyres. */
      minSpeed: 14,
      ratePerSecond: 30,
      life: 0.5,
      startSize: 0.5,
      endSize: 2.4,
      opacity: 0.045,
      color: { r: 0.66, g: 0.72, b: 0.76 },
    },
    sparks: {
      perImpact: 26,
      life: 0.55,
      size: 0.1,
      speed: 9,
      gravity: 12,
      color: { r: 3.2, g: 1.7, b: 0.5 },
    },
  },

  audio: {
    masterVolume: 0.85,
    engine: {
      /** Firing pulses per engine revolution for a 4-cylinder. */
      pulsesPerRev: 2,
      idleGain: 0.13,
      fullGain: 0.3,
      filterMinHz: 340,
      filterMaxHz: 3800,
      subGain: 0.55,
      buzzGain: 0.34,
      intakeGain: 0.08,
      smoothing: 0.03,
    },
    turboWhistleHz: 2600,
    turboGain: 0.018,
    tyreGain: 0.2,
    tyreFilterHz: 1050,
    windGain: 0.2,
    nitroGain: 0.26,
    hornGain: 0.2,
    hornFrequencies: [392, 494],
    impactGain: 0.55,
    backfireGain: 0.34,
  },

  hud: {
    /** Text refresh rate. Needle and bars update every frame. */
    textHz: 15,
    dialMaxKmh: 260,
    dialStartDeg: -135,
    dialEndDeg: 135,
    dialLabelStep: 40,
    nitroLowFraction: 0.2,
    hintSeconds: 11,
    driftPopupSeconds: 2.2,
    lapPopupSeconds: 3.4,
  },

  world: {
    roadHalfWidth: 6,
    /** Ground sits this far below the road. */
    groundY: -0.4,
    sampleSpacing: 4,
    shoulderBaseWidth: 3,
    shoulderPerHeight: 2.5,
    spawnBehindStartLine: 26,
    lampSpacing: 40,
    lampOffset: 8.4,
    lampHeight: 8.4,
    signSpacing: 215,
    signOffset: 15,
    buildingCount: 170,
    buildingMinOffset: 24,
    buildingMaxOffset: 92,
    skylineCount: 150,
    skylineMinRadius: 1000,
    skylineMaxRadius: 1500,
    plaza: { centerX: 170, centerZ: 640, halfX: 82, halfZ: 112 },
    boundsPadding: 240,
    seed: 1433,
    fogDensity: 0.00125,
    roadWetness: 0.82,
    reflectionStrength: 1.15,
    envIntensity: 0.95,
    hemisphereIntensity: 1.75,
    moonIntensity: 1.5,
    colors: {
      skyTop: 0x0b1420,
      skyMid: 0x2a2530,
      skyHorizon: 0x9a5426,
      fog: 0x3a2a26,
      hemisphereSky: 0x4a5f7a,
      hemisphereGround: 0x3a2518,
      moon: 0xaec4e0,
      sodium: 0xffb060,
      underglow: 0xf2a20c,
      carPaint: 0xd8402b,
    },
  },

  render: {
    bloomIntensity: 0.85,
    bloomThreshold: 0.72,
    bloomSmoothing: 0.25,
    bloomRadius: 0.68,
    vignetteDarkness: 0.5,
    vignetteOffset: 0.34,
    chromaticNitro: 0.0032,
    toneMappingExposure: 1.08,
    /** Dynamic resolution: seconds between checks and frame budget slack. */
    dynamicCheckSeconds: 1.5,
    dynamicStep: 0.08,
    dynamicDownMargin: 1.12,
    /** A vsynced game cannot show spare headroom, so resolution is probed upward after this long. */
    dynamicProbeSeconds: 6,
    /** Each failed probe waits this many times longer before trying again. */
    dynamicProbeBackoff: 2,
    dynamicProbeMaxSeconds: 96,
  },

  input: {
    keyboardSteerRate: 3.4,
    keyboardSteerReturn: 6.5,
    /** Steering gets slower at speed so a tap does not unsettle the car. */
    keyboardHighSpeedRateScale: 0.58,
    keyboardThrottleRate: 7,
    keyboardBrakeRate: 9,
    gamepadDeadzone: 0.1,
    gamepadSteerCurve: 1.45,
    gamepadTriggerDeadzone: 0.04,
  },
};

export const QUALITY_PRESETS: Record<QualityName, QualityPreset> = {
  low: {
    maxPixelRatio: 1,
    minResolutionScale: 0.6,
    multisampling: 0,
    bloom: false,
    chromaticAberration: false,
    reflectionScale: 0,
    reflectionEveryNFrames: 1,
    shadows: false,
    shadowMapSize: 512,
    clearcoatPaint: false,
    headlightSpot: false,
    nitroLight: false,
    smokeParticles: 60,
    sparkParticles: 24,
    skidSegments: 400,
    buildingDensity: 0.4,
    anisotropy: 2,
    targetFps: 30,
    trafficTotal: 30,
    trafficBodies: 6,
    pedestrians: 20,
    trafficReflections: false,
    policeUnits: 4,
    policeParked: 3,
    policeLight: false,
    raceOpponents: 3,
    rainDrops: 500,
    mistBanks: 8,
    lampShafts: false,
    skyDetail: false,
    replaySeconds: 25,
  },
  medium: {
    maxPixelRatio: 1,
    minResolutionScale: 0.7,
    multisampling: 0,
    bloom: true,
    chromaticAberration: false,
    reflectionScale: 0.22,
    reflectionEveryNFrames: 2,
    shadows: false,
    shadowMapSize: 1024,
    clearcoatPaint: false,
    headlightSpot: true,
    nitroLight: true,
    smokeParticles: 130,
    sparkParticles: 48,
    skidSegments: 800,
    buildingDensity: 0.75,
    anisotropy: 4,
    targetFps: 60,
    trafficTotal: 80,
    trafficBodies: 12,
    pedestrians: 60,
    trafficReflections: false,
    policeUnits: 6,
    policeParked: 6,
    policeLight: true,
    raceOpponents: 5,
    rainDrops: 1400,
    mistBanks: 14,
    lampShafts: true,
    skyDetail: true,
    replaySeconds: 40,
  },
  high: {
    maxPixelRatio: 1.5,
    minResolutionScale: 0.75,
    multisampling: 2,
    bloom: true,
    chromaticAberration: true,
    reflectionScale: 0.33,
    reflectionEveryNFrames: 1,
    shadows: true,
    shadowMapSize: 1024,
    clearcoatPaint: true,
    headlightSpot: true,
    nitroLight: true,
    smokeParticles: 220,
    sparkParticles: 72,
    skidSegments: 1400,
    buildingDensity: 1,
    anisotropy: 8,
    targetFps: 60,
    trafficTotal: 150,
    trafficBodies: 20,
    pedestrians: 120,
    trafficReflections: true,
    policeUnits: 8,
    policeParked: 8,
    policeLight: true,
    raceOpponents: 7,
    rainDrops: 2600,
    mistBanks: 20,
    lampShafts: true,
    skyDetail: true,
    replaySeconds: 50,
  },
  ultra: {
    maxPixelRatio: 2,
    minResolutionScale: 0.8,
    multisampling: 4,
    bloom: true,
    chromaticAberration: true,
    reflectionScale: 0.5,
    reflectionEveryNFrames: 1,
    shadows: true,
    shadowMapSize: 2048,
    clearcoatPaint: true,
    headlightSpot: true,
    nitroLight: true,
    smokeParticles: 340,
    sparkParticles: 120,
    skidSegments: 2200,
    buildingDensity: 1,
    anisotropy: 16,
    targetFps: 60,
    trafficTotal: 250,
    trafficBodies: 30,
    pedestrians: 200,
    trafficReflections: true,
    policeUnits: 8,
    policeParked: 10,
    policeLight: true,
    raceOpponents: 7,
    rainDrops: 4000,
    mistBanks: 28,
    lampShafts: true,
    skyDetail: true,
    replaySeconds: 60,
  },
};

/** Sliders shown in the dev panel: dotted path into TUNING, min, max, step. */
export const DEV_PANEL_SLIDERS: ReadonlyArray<readonly [string, number, number, number]> = [
  ['vehicle.engine.powerWatts', 60000, 260000, 2000],
  ['vehicle.engine.maxDriveForce', 3000, 14000, 100],
  ['vehicle.engine.frontBias', 0, 1, 0.01],
  ['vehicle.brakes.force', 6000, 26000, 200],
  ['vehicle.steering.targetLateralAccel', 6, 20, 0.2],
  ['vehicle.steering.assistNormal', 0, 1.2, 0.01],
  ['vehicle.steering.assistDrift', 0, 1.2, 0.01],
  ['vehicle.tyre.corneringStiffness', 15000, 90000, 500],
  ['vehicle.tyre.frontGrip', 0.5, 1.6, 0.01],
  ['vehicle.tyre.rearGrip', 0.5, 1.6, 0.01],
  ['vehicle.tyre.slideRatioRear', 0.4, 1, 0.01],
  ['vehicle.drift.handbrakeRearGrip', 0.1, 0.9, 0.01],
  ['vehicle.drift.holdGripFullThrottle', 0.2, 1, 0.01],
  ['vehicle.drift.steerTorque', 0, 9000, 100],
  ['vehicle.drift.handbrakeYawKick', 0, 5000, 50],
  ['vehicle.drift.thrust', 0, 8000, 100],
  ['vehicle.drift.maxAngleDeg', 20, 80, 1],
  ['vehicle.suspension.stiffness', 18000, 90000, 500],
  ['vehicle.suspension.damping', 800, 8000, 50],
  ['vehicle.nitro.force', 1000, 12000, 100],
  ['camera.chase.distance', 3.5, 10, 0.1],
  ['camera.chase.height', 0.8, 4, 0.05],
  ['camera.chase.velocityFollow', 0, 1, 0.01],
  ['camera.chase.yawStiffness', 1, 12, 0.1],
  ['rig.rollPerAccel', 0, 0.03, 0.0005],
  ['rig.pitchPerAccel', 0, 0.03, 0.0005],
];
