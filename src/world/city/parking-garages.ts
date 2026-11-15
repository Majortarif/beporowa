/**
 * Open-fronted parking garages beside the road: drive in, stop, and the roof hides you from the air.
 * They reserve their ground before the buildings are placed.
 */

import { BufferGeometry, Mesh, MeshStandardMaterial, type Scene } from 'three';
import { POLICE } from '../../config/police-tuning';
import { createRng } from '../../core/math';
import { createSample } from '../../core/polyline';
import { worldText } from '../../i18n';
import type { PhysicsWorld } from '../../physics/physics-world';
import { ModelBuilder, useBakedGlow, useSelfLitGlow } from '../../render/model-builder';
import { FONT_DISPLAY, PAINT, drawFlower, makeCanvas, paintGrain, toTexture } from '../../render/painted-textures';
import { enableReflection } from '../../render/planar-reflection';
import type { Occupancy } from './city-buildings';
import type { RoadNetwork } from './road-network';

export interface GarageSpot {
  x: number;
  z: number;
  /** The garage's +Z points out of the entrance, toward the road. */
  yaw: number;
  halfWidth: number;
  halfDepth: number;
}

/** Finds free ground beside the roads. Same result every time. */
export function layOutGarages(network: RoadNetwork, occupancy: Occupancy): GarageSpot[] {
  const hide = POLICE.hide;
  const random = createRng(4471);
  const spots: GarageSpot[] = [];
  const sample = createSample();
  const candidates = network.edges.filter((edge) => !edge.elevated && !edge.jam && edge.kind !== 'lane' && edge.center.length > hide.garageWidth + 50);
  // A shuffled order spreads the garages over the map.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
  }
  const halfWidth = hide.garageWidth / 2;
  const halfDepth = hide.garageDepth / 2;

  const tryEdge = (edge: (typeof candidates)[number]): boolean => {
    const margin = halfWidth + 22;
    for (let s = margin; s < edge.center.length - margin; s += 18) {
      edge.center.sample(s, sample);
      for (const side of [1, -1]) {
        // Left of the road is (tz, -tx).
        const outX = sample.tz * side;
        const outZ = -sample.tx * side;
        const offset = edge.spec.halfWidth + hide.garageSetback + halfDepth;
        const x = sample.x + outX * offset;
        const z = sample.z + outZ * offset;
        const yaw = Math.atan2(-outX, -outZ);
        if (!occupancy.isFree(x, z, yaw, halfWidth + 1, halfDepth + 1)) continue;
        if (spots.some((spot) => Math.hypot(spot.x - x, spot.z - z) < hide.garageSpacing)) continue;
        // The ground out front stays empty too, so the way in is always clear.
        occupancy.mark(x, z, yaw, halfWidth + 1, halfDepth + 1);
        const frontOffset = edge.spec.halfWidth + hide.garageSetback / 2;
        occupancy.mark(sample.x + outX * frontOffset, sample.z + outZ * frontOffset, yaw, halfWidth, hide.garageSetback / 2 + 1);
        spots.push({ x, z, yaw, halfWidth, halfDepth });
        return true;
      }
    }
    return false;
  };
  for (const edge of candidates) {
    if (spots.length >= hide.garageCount) break;
    tryEdge(edge);
  }
  return spots;
}

function paintSign(anisotropy: number): ReturnType<typeof toTexture> {
  const { canvas, ctx } = makeCanvas(512, 128);
  ctx.fillStyle = PAINT.indigo;
  ctx.fillRect(0, 0, 512, 128);
  paintGrain(ctx, 512, 128, 91, 0.16);
  ctx.strokeStyle = PAINT.marigold;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);
  drawFlower(ctx, 52, 64, 28, PAINT.tomato, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, 460, 64, 28, PAINT.tomato, PAINT.marigold, PAINT.tin);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `72px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAINT.soot;
  ctx.fillText(worldText('sign.parking'), 259, 71, 340);
  ctx.fillStyle = PAINT.tin;
  ctx.fillText(worldText('sign.parking'), 256, 68, 340);
  return toTexture(canvas, anisotropy);
}

const CONCRETE = 0x6b6a66;
const CONCRETE_DARK = 0x4a4a48;
const WALL_TINTS = [0xb9a06a, 0x8fa59a, 0xc8835a, 0x8a9cb4];
const CAR_TINTS = [0x7c2f2a, 0x2e4a5e, 0x8a8478, 0x35503c, 0xa9a59a, 0x5a4a6a];
const TUBE_GLOW = [2.6, 2.1, 1.25] as const;

/** Draws the garages and gives them walls, columns, a roof and parked cars to hit. */
export function buildGarages(scene: Scene, physics: PhysicsWorld, spots: readonly GarageSpot[], anisotropy: number): void {
  if (spots.length === 0) return;
  const hide = POLICE.hide;
  const builder = new ModelBuilder();
  const signs = new ModelBuilder();
  const random = createRng(4473);

  for (const [index, spot] of spots.entries()) {
    const c = Math.cos(spot.yaw);
    const s = Math.sin(spot.yaw);
    // Local a runs across the front, local b runs from the back wall out to the road.
    const worldX = (a: number, b: number): number => spot.x + a * c + b * s;
    const worldZ = (a: number, b: number): number => spot.z - a * s + b * c;
    const part = (width: number, height: number, depth: number, a: number, y: number, b: number, color: number, glow?: readonly [number, number, number]): void => {
      builder.box(width, height, depth, worldX(a, b), y, worldZ(a, b), color, { rotY: spot.yaw, glow });
    };
    const solid = (halfA: number, halfY: number, halfB: number, a: number, y: number, b: number): void => {
      physics.addFixedCuboid(halfA, halfY, halfB, worldX(a, b), y, worldZ(a, b), 'dirt', spot.yaw);
    };

    const w = spot.halfWidth;
    const d = spot.halfDepth;
    const h = hide.garageHeight;
    const levels = hide.garageLevels;
    const top = h * levels;
    const tint = WALL_TINTS[index % WALL_TINTS.length];

    part(w * 2, 0.08, d * 2, 0, 0.04, 0, CONCRETE_DARK);
    for (let level = 1; level <= levels; level++) {
      part(w * 2 + 0.4, 0.34, d * 2 + 0.4, 0, h * level, 0, CONCRETE);
      // Parapets, with a painted stripe.
      part(w * 2 + 0.4, 0.8, 0.22, 0, h * level + 0.56, d + 0.1, tint);
    }
    solid(w + 0.2, (top - h + 0.34) / 2 + 0.2, d + 0.2, 0, (h + top) / 2, 0);

    // Three walls, leaving the road side open.
    part(w * 2, top, 0.32, 0, top / 2, -d, tint);
    part(0.32, top, d * 2, -w, top / 2, 0, tint);
    part(0.32, top, d * 2, w, top / 2, 0, tint);
    solid(w, top / 2, 0.2, 0, top / 2, -d);
    solid(0.2, top / 2, d, -w, top / 2, 0);
    solid(0.2, top / 2, d, w, top / 2, 0);

    // Columns at the mouth and inside, far enough apart to drive between.
    for (const a of [-w / 3, w / 3]) {
      for (const b of [d - 0.4, -d / 3]) {
        part(0.5, top, 0.5, a, top / 2, b, CONCRETE);
        solid(0.25, top / 2, 0.25, a, top / 2, b);
      }
    }

    // Tube lights under the ceiling, warm and a little dim.
    for (const a of [-w * 0.66, 0, w * 0.66]) {
      part(3.4, 0.07, 0.18, a, h - 0.22, d * 0.1, 0xfff0d0, TUBE_GLOW);
    }

    // Painted bays along the back wall, some with a car parked in them.
    for (let bay = 0; bay < 7; bay++) {
      const a = -w + 1.9 + bay * ((w * 2 - 3.8) / 6);
      part(0.1, 0.01, 4.6, a + 1.25, 0.09, -d + 2.6, 0xe5dcc0);
      if (random() < 0.62 && Math.abs(a - w / 3) > 1.6 && Math.abs(a + w / 3) > 1.6) {
        const color = CAR_TINTS[Math.floor(random() * CAR_TINTS.length)];
        part(1.72, 0.68, 3.9, a, 0.62, -d + 2.5, color);
        part(1.5, 0.52, 2.0, a, 1.2, -d + 2.4, 0x20262b);
        solid(0.88, 0.6, 2, a, 0.6, -d + 2.5);
      }
    }

    // The sign over the entrance.
    signs.panel(6.4, 1.6, worldX(0, d + 0.24), h + 0.56, worldZ(0, d + 0.24), 0xffffff, { rotY: spot.yaw, uv: [0, 0, 1, 1], glow: [1, 1, 1] });
  }

  const add = (geometry: BufferGeometry, material: MeshStandardMaterial): void => {
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    enableReflection(mesh);
    scene.add(mesh);
  };
  add(builder.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 })));
  add(signs.build(), useSelfLitGlow(new MeshStandardMaterial({ map: paintSign(anisotropy), vertexColors: true, roughness: 0.7 })));
}
