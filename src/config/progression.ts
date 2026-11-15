/** Every number for cash, reputation, levels, daily rewards and how rivals keep up with your car. */

export const PROGRESS = {
  startCash: 1500,

  /** Race cash, per point of the event's value, for a better medal and for a repeat. */
  raceCashPerPoint: 14,
  rivalBeatenCash: 6000,
  /** Free-roam points turn into cash and reputation at these rates. */
  roamCashPerPoint: 0.12,
  roamRepPerPoint: 0.03,
  /** Getting away from the police pays. */
  escapeCashPerPoint: 0.6,
  /** An arrest costs this share of the fine in cash, per point of fine. */
  fineCashPerPoint: 1,

  /** Reputation needed for level n is base * n ^ power. */
  levelBase: 110,
  levelPower: 1.55,
  levelCap: 30,
  levelUpCash: 500,

  daily: {
    /** Cash for each day of a streak. It repeats from the last value. */
    cash: [400, 600, 800, 1000, 1300, 1600, 2500] as const,
    rep: [10, 15, 20, 25, 30, 40, 80] as const,
  },

  condition: {
    /** Lost per unit of crash strength. */
    perCrash: 9,
    softCrash: 1.5,
    /** Below this the car starts losing power, down to the floor. */
    limpFrom: 55,
    limpPower: 0.86,
    limpTop: 0.92,
    smokeBelow: 32,
    smokePerSecond: 12,
  },

  tea: {
    price: 30,
    /** Seconds of the pouring animation. */
    seconds: 3.4,
    enterRadius: 15,
    enterSpeedKmh: 18,
    /** A boy from the stall looks the car over, enough to get it home. Full repairs are at the garage. */
    repairTo: 70,
  },

  /** How close to the place a delivery counts as there, in metres. */
  jobArriveRadius: 26,

  garage: {
    repairPricePerPoint: 12,
    enterRadius: 13,
    enterSpeedKmh: 30,
    orbitSpeed: 0.22,
    orbitRadius: 7.4,
    orbitHeight: 1.7,
    fov: 44,
    dragSpeed: 0.008,
    /** Work lamps, as a lift on the city's light so that paint can be judged in there. */
    lampBoost: 2.6,
    teaLampBoost: 1.5,
  },

  /** How far rivals' engines follow the player's car, rather than their rank's usual level. */
  balance: {
    /** A rival at rank n is built for a car of this strength. */
    expectedPerRank: 0.05,
    followPlayer: 0.6,
    /** Most a rival may be scaled either way. */
    minScale: 1,
    maxScale: 1.9,
    topSpeedShare: 0.62,
    cornerShare: 0.22,
    gripShare: 0.2,
    /** Police follow more loosely, since they come in numbers. */
    policeShare: 0.6,
  },

  /** Performance index: a single number for how strong a car is. 1 is a stock বুলবুলি. */
  performance: {
    power: 0.55,
    topSpeed: 0.33,
    grip: 0.12,
  },
};
