/** Answers "is the car hiding right now, and how well?" for the heat system. */

import { CITY } from '../config/city-tuning';
import { POLICE } from '../config/police-tuning';
import type { GarageSpot } from '../world/city/parking-garages';
import { createRoadHit, type RoadNetwork } from '../world/city/road-network';
import type { HideResult } from './police-system';

const config = POLICE.hide;
const NONE: HideResult = { factor: 1, kind: 'none', concealed: false, coveredFromAir: false };
const GARAGE: HideResult = { factor: config.garageFactor, kind: 'garage', concealed: true, coveredFromAir: true };
/** Under the roof but still moving fast: the roof helps, the noise does not. */
const GARAGE_MOVING: HideResult = { factor: 1, kind: 'garage', concealed: false, coveredFromAir: true };
const TEA: HideResult = { factor: config.teaFactor, kind: 'tea', concealed: true, coveredFromAir: false };
const ALLEY_SLOW: HideResult = { factor: config.alleyFactor, kind: 'alley', concealed: true, coveredFromAir: false };
const ALLEY: HideResult = { factor: config.alleyFactor, kind: 'alley', concealed: false, coveredFromAir: false };
const FLYOVER: HideResult = { factor: config.flyoverFactor, kind: 'flyover', concealed: false, coveredFromAir: true };

export interface HidingStall {
  x: number;
  z: number;
  isTea: boolean;
}

export class HideSpots {
  private readonly tea: HidingStall[];
  private readonly hit = createRoadHit();

  constructor(
    private readonly network: RoadNetwork,
    readonly garages: readonly GarageSpot[],
    stalls: readonly HidingStall[],
  ) {
    this.tea = stalls.filter((stall) => stall.isTea);
  }

  /** The best hiding spot at this point. */
  query(x: number, y: number, z: number, speedKmh: number): HideResult {
    const slow = speedKmh < config.slowSpeedKmh;
    for (const garage of this.garages) {
      const dx = x - garage.x;
      const dz = z - garage.z;
      if (Math.abs(dx) > garage.halfWidth + garage.halfDepth || Math.abs(dz) > garage.halfWidth + garage.halfDepth) continue;
      const c = Math.cos(garage.yaw);
      const s = Math.sin(garage.yaw);
      if (Math.abs(dx * c - dz * s) < garage.halfWidth && Math.abs(dx * s + dz * c) < garage.halfDepth && y < config.garageHeight) {
        return slow ? GARAGE : GARAGE_MOVING;
      }
    }
    if (slow && y < 2) {
      for (const stall of this.tea) {
        if (Math.abs(stall.x - x) < config.teaRadius && Math.abs(stall.z - z) < config.teaRadius && Math.hypot(stall.x - x, stall.z - z) < config.teaRadius) return TEA;
      }
    }
    const network = this.network;
    const road = network.nearestRoad(x, z, y, this.hit);
    const edge = network.edges[road.edge];
    if (edge.kind === 'lane' && road.distance < edge.spec.halfWidth + 1.5 && speedKmh < config.alleySpeedKmh) {
      return slow ? ALLEY_SLOW : ALLEY;
    }
    const deckHeight = CITY.network.deckHeight;
    if (y < deckHeight - 2) {
      const above = network.nearestRoad(x, z, deckHeight, this.hit);
      const deck = network.edges[above.edge];
      if (deck.elevated && above.y > y + 3 && above.distance < deck.spec.halfWidth + 1) return FLYOVER;
    }
    return NONE;
  }
}
