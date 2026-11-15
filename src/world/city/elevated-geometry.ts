/**
 * Collision and support data for the flyover and its ramps: driving surfaces, side barriers
 * and pillars. No rendering here, so a headless bot can drive on the real flyover.
 */

import { createSample } from '../../core/polyline';
import type { RoadEdge, RoadNetwork, RoadNode } from './road-network';

export interface SurfaceMesh {
  positions: Float32Array;
  indices: Uint32Array;
}

export interface BarrierSegment {
  x: number;
  /** Centre height of the collider. */
  y: number;
  z: number;
  halfLength: number;
  halfHeight: number;
  /** Rotation about +Y; local +Z runs along the barrier. */
  yaw: number;
  /** Road height here, for drawing the visible barrier on top of the deck. */
  roadY: number;
}

export interface Pillar {
  x: number;
  z: number;
  topY: number;
  yaw: number;
}

export interface ElevatedGeometry {
  surfaces: SurfaceMesh[];
  barriers: BarrierSegment[];
  pillars: Pillar[];
}

const BARRIER_SEGMENT = 10;
const BARRIER_OFFSET = 0.25;
const BARRIER_TOP = 1.05;
const PILLAR_SPACING = 34;
const MIN_PILLAR_HEIGHT = 3.2;
const NODE_ARC_STEP = Math.PI / 12;

function edgeSurface(edge: RoadEdge): SurfaceMesh {
  const line = edge.center;
  const half = edge.spec.halfWidth;
  const sample = createSample();
  const positions = new Float32Array(line.count * 2 * 3);
  const indices = new Uint32Array((line.count - 1) * 6);
  for (let i = 0; i < line.count; i++) {
    line.sample(i * line.spacing, sample);
    // Left of travel is (tz, -tx).
    positions.set(
      [
        sample.x + sample.tz * half, sample.y, sample.z - sample.tx * half,
        sample.x - sample.tz * half, sample.y, sample.z + sample.tx * half,
      ],
      i * 6,
    );
  }
  for (let i = 0; i < line.count - 1; i++) {
    const a = i * 2;
    indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 6);
  }
  return { positions, indices };
}

function discSurface(node: RoadNode): SurfaceMesh {
  const segments = 24;
  const positions = new Float32Array((segments + 1) * 3);
  const indices = new Uint32Array(segments * 3);
  positions.set([node.x, node.y, node.z], 0);
  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    positions.set([node.x + Math.cos(angle) * node.radius, node.y, node.z + Math.sin(angle) * node.radius], (i + 1) * 3);
    indices.set([0, ((i + 1) % segments) + 1, i + 1], i * 3);
  }
  return { positions, indices };
}

export function computeElevatedGeometry(network: RoadNetwork): ElevatedGeometry {
  const elevatedEdges = network.edges.filter((edge) => edge.elevated);
  const elevatedNodes = network.nodes.filter((node) => node.elevated);
  const surfaces: SurfaceMesh[] = [
    ...elevatedEdges.map(edgeSurface),
    ...elevatedNodes.map(discSurface),
  ];

  const sample = createSample();

  /** True when a point lies on another elevated road at about the same height. */
  const insideElevatedRoad = (x: number, y: number, z: number, skipEdge: number): boolean => {
    for (const edge of elevatedEdges) {
      if (edge.index === skipEdge) continue;
      const line = edge.center;
      const inner = edge.spec.halfWidth - 0.2;
      for (let i = 0; i < line.count; i++) {
        const base = i * 3;
        const dx = line.points[base] - x;
        const dz = line.points[base + 2] - z;
        if (dx * dx + dz * dz < inner * inner && Math.abs(line.points[base + 1] - y) < 2.2) return true;
      }
    }
    for (const node of elevatedNodes) {
      if (Math.hypot(node.x - x, node.z - z) < node.radius - 0.2 && Math.abs(node.y - y) < 2.2) return true;
    }
    return false;
  };

  const barriers: BarrierSegment[] = [];

  const addBarrier = (x: number, roadY: number, z: number, halfLength: number, yaw: number): void => {
    const top = roadY + BARRIER_TOP;
    // Low on a ramp the barrier runs down to the ground, so nobody can slip under the road.
    const bottom = roadY < 3 ? 0 : roadY - 0.3;
    barriers.push({ x, y: (top + bottom) / 2, z, halfLength, halfHeight: (top - bottom) / 2, yaw, roadY });
  };

  for (const edge of elevatedEdges) {
    const line = edge.center;
    const offset = edge.spec.halfWidth + BARRIER_OFFSET;
    const segments = Math.max(1, Math.round(line.length / BARRIER_SEGMENT));
    const step = line.length / segments;
    for (let i = 0; i < segments; i++) {
      line.sample((i + 0.5) * step, sample);
      if (sample.y < 0.35) continue;
      const yaw = Math.atan2(sample.tx, sample.tz);
      for (const side of [1, -1]) {
        const x = sample.x + sample.tz * offset * side;
        const z = sample.z - sample.tx * offset * side;
        if (insideElevatedRoad(x, sample.y, z, edge.index)) continue;
        addBarrier(x, sample.y, z, step / 2 + 0.2, yaw);
      }
    }
  }

  // Close the gaps around each flyover junction, between the roads that leave it.
  for (const node of elevatedNodes) {
    const radius = node.radius + BARRIER_OFFSET;
    const halfLength = (radius * NODE_ARC_STEP) / 2 + 0.2;
    for (let angle = 0; angle < Math.PI * 2 - 1e-3; angle += NODE_ARC_STEP) {
      const x = node.x + Math.cos(angle) * radius;
      const z = node.z + Math.sin(angle) * radius;
      if (insideElevatedRoad(x, node.y, z, -1)) continue;
      // The tangent of the circle at this angle.
      addBarrier(x, node.y, z, halfLength, Math.atan2(-Math.sin(angle), Math.cos(angle)));
    }
  }

  const pillars: Pillar[] = [];
  for (const edge of elevatedEdges) {
    const line = edge.center;
    const count = Math.floor(line.length / PILLAR_SPACING);
    for (let i = 1; i <= count; i++) {
      line.sample(i * PILLAR_SPACING - PILLAR_SPACING / 2, sample);
      if (sample.y < MIN_PILLAR_HEIGHT) continue;
      // Never stand in a junction or in a lane of the road below.
      const nearJunction = network.nodes.some(
        (node) => !node.elevated && Math.hypot(node.x - sample.x, node.z - sample.z) < node.radius + 6,
      );
      if (nearJunction) continue;
      const ground = network.nearestRoad(sample.x, sample.z, 0);
      const groundEdge = network.edges[ground.edge];
      if (!groundEdge.elevated) {
        const median = groundEdge.spec.median / 2;
        const onLanes = ground.distance > median && ground.distance < groundEdge.spec.halfWidth + 1.4;
        if (onLanes) continue;
      }
      pillars.push({ x: sample.x, z: sample.z, topY: sample.y, yaw: Math.atan2(sample.tx, sample.tz) });
    }
  }

  return { surfaces, barriers, pillars };
}

export { BARRIER_TOP };
