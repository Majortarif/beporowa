/**
 * Low roads that fill with water in a long downpour, with potholes hiding under it.
 * It holds no drawing, so physics, AI and tests can all ask how deep the water is.
 */

import { ATMOSPHERE } from '../../config/atmosphere';
import { createRng } from '../../core/math';
import { createSample } from '../../core/polyline';
import type { RoadNetwork } from '../city/road-network';

export interface FloodZone {
  x: number;
  z: number;
  /** Along the road. */
  tx: number;
  tz: number;
  yaw: number;
  halfLength: number;
  halfWidth: number;
  potholes: Array<{ x: number; z: number }>;
}

export class FloodField {
  readonly zones: FloodZone[] = [];
  /** How far the water has risen, from 0 to 1. */
  level = 0;

  constructor(network: RoadNetwork) {
    const sample = createSample();
    const random = createRng(7741);
    for (const [from, to] of ATMOSPHERE.floodRoads) {
      const edge = network.edgeBetween(network.nodeIndex(from), network.nodeIndex(to));
      if (!edge || edge.elevated || edge.center.length < 50) continue;
      edge.center.sample(edge.center.length / 2, sample);
      const halfLength = Math.min(30, edge.center.length * 0.3);
      const halfWidth = edge.spec.halfWidth + 2.4;
      const zone: FloodZone = { x: sample.x, z: sample.z, tx: sample.tx, tz: sample.tz, yaw: Math.atan2(sample.tx, sample.tz), halfLength, halfWidth, potholes: [] };
      for (let i = 0; i < ATMOSPHERE.potholesPerZone; i++) {
        const along = (random() - 0.5) * halfLength * 1.2;
        const across = (random() - 0.5) * edge.spec.halfWidth * 1.4;
        zone.potholes.push({ x: sample.x + sample.tx * along + sample.tz * across, z: sample.z + sample.tz * along - sample.tx * across });
      }
      this.zones.push(zone);
    }
  }

  /** How deep the water stands here, in metres. */
  depthAt(x: number, z: number): number {
    if (this.level <= 0.001) return 0;
    let deepest = 0;
    for (const zone of this.zones) {
      const dx = x - zone.x;
      const dz = z - zone.z;
      if (Math.abs(dx) > 50 || Math.abs(dz) > 50) continue;
      const along = (dx * zone.tx + dz * zone.tz) / zone.halfLength;
      const across = (dx * zone.tz - dz * zone.tx) / zone.halfWidth;
      const edge = along * along + across * across;
      if (edge >= 1) continue;
      deepest = Math.max(deepest, (1 - edge) * ATMOSPHERE.floodDepth * this.level);
    }
    return deepest;
  }

  /** The pothole under this point, if the water is up enough to hide it. */
  potholeAt(x: number, z: number): { x: number; z: number } | null {
    if (this.level < 0.3) return null;
    const radius = ATMOSPHERE.potholeRadius;
    for (const zone of this.zones) {
      if (Math.abs(x - zone.x) > 50 || Math.abs(z - zone.z) > 50) continue;
      for (const hole of zone.potholes) {
        if (Math.abs(hole.x - x) < radius && Math.abs(hole.z - z) < radius) return hole;
      }
    }
    return null;
  }

  /** Where the deepest water nearest this point is, for the radio's report. */
  nearestZone(x: number, z: number): FloodZone | null {
    let best: FloodZone | null = null;
    let bestDistance = Infinity;
    for (const zone of this.zones) {
      const distance = Math.hypot(zone.x - x, zone.z - z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = zone;
      }
    }
    return best;
  }
}
