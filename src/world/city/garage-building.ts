/**
 * ওস্তাদের গ্যারেজ: an open-fronted workshop by the road, with a painted tin sign, work lamps,
 * tyres, drums and a bench. It is built for real, and it is where the game's garage screens happen.
 */

import { BufferGeometry, Mesh, MeshStandardMaterial, type Scene } from 'three';
import { createSample } from '../../core/polyline';
import { worldText } from '../../i18n';
import type { PhysicsWorld } from '../../physics/physics-world';
import { ModelBuilder, useBakedGlow, useSelfLitGlow } from '../../render/model-builder';
import { FONT_DISPLAY, PAINT, drawFlower, makeCanvas, paintGrain, toTexture } from '../../render/painted-textures';
import { enableReflection } from '../../render/planar-reflection';
import type { Occupancy } from './city-buildings';
import type { RoadNetwork } from './road-network';

const WIDTH = 22;
const DEPTH = 18;
const HEIGHT = 5.2;
const SETBACK = 6;

export interface GarageHome {
  x: number;
  z: number;
  /** +Z of the building points out of its mouth, toward the road. */
  yaw: number;
  /** Where the car stands inside. */
  bayX: number;
  bayZ: number;
  /** Where the car comes out, on the road, facing along it. */
  exitX: number;
  exitZ: number;
  exitYaw: number;
}

/** Roads to try, in order. The first with room is where ওস্তাদ set up shop. */
const WANTED_ROADS: ReadonlyArray<readonly [string, string]> = [['R', 'B1'], ['W1', 'A1'], ['E1', 'Q1'], ['R', 'W1'], ['B1', 'B2'], ['R', 'E1']];

export function findGarageHome(network: RoadNetwork, occupancy: Occupancy): GarageHome {
  const sample = createSample();
  const halfWidth = WIDTH / 2;
  const halfDepth = DEPTH / 2;
  const roads = [
    ...WANTED_ROADS.map(([a, b]) => network.edgeBetween(network.nodeIndex(a), network.nodeIndex(b))),
    ...network.edges.filter((edge) => !edge.elevated && !edge.jam && edge.kind !== 'lane' && edge.kind !== 'ramp' && edge.kind !== 'deck'),
  ];
  for (const edge of roads) {
    if (!edge) continue;
    const margin = halfWidth + 10;
    for (let s = margin; s < edge.center.length - margin; s += 6) {
      edge.center.sample(s, sample);
      for (const side of [1, -1]) {
        const outX = sample.tz * side;
        const outZ = -sample.tx * side;
        const offset = edge.spec.halfWidth + SETBACK + halfDepth;
        const x = sample.x + outX * offset;
        const z = sample.z + outZ * offset;
        const yaw = Math.atan2(-outX, -outZ);
        if (!occupancy.isFree(x, z, yaw, halfWidth + 1, halfDepth + 1)) continue;
        occupancy.mark(x, z, yaw, halfWidth + 1, halfDepth + 1);
        const front = edge.spec.halfWidth + SETBACK / 2;
        occupancy.mark(sample.x + outX * front, sample.z + outZ * front, yaw, halfWidth, SETBACK / 2 + 1);
        return {
          x,
          z,
          yaw,
          bayX: x,
          bayZ: z,
          exitX: sample.x + outX * (edge.spec.halfWidth * 0.5),
          exitZ: sample.z + outZ * (edge.spec.halfWidth * 0.5),
          exitYaw: Math.atan2(sample.tx * side, sample.tz * side),
        };
      }
    }
  }
  throw new Error('Nowhere to put the garage');
}

function signTexture(anisotropy: number): ReturnType<typeof toTexture> {
  const { canvas, ctx } = makeCanvas(1024, 200);
  ctx.fillStyle = PAINT.tomato;
  ctx.fillRect(0, 0, 1024, 200);
  paintGrain(ctx, 1024, 200, 41, 0.16);
  ctx.strokeStyle = PAINT.marigold;
  ctx.lineWidth = 10;
  ctx.strokeRect(9, 9, 1006, 182);
  drawFlower(ctx, 80, 100, 56, PAINT.marigold, PAINT.tin, PAINT.indigo);
  drawFlower(ctx, 944, 100, 56, PAINT.marigold, PAINT.tin, PAINT.indigo);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `104px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAINT.soot;
  ctx.fillText(worldText('sign.garage'), 516, 110, 740);
  ctx.fillStyle = PAINT.tin;
  ctx.fillText(worldText('sign.garage'), 512, 105, 740);
  return toTexture(canvas, anisotropy);
}

export function buildGarageHome(scene: Scene, physics: PhysicsWorld, home: GarageHome, anisotropy: number): void {
  const b = new ModelBuilder();
  const c = Math.cos(home.yaw);
  const s = Math.sin(home.yaw);
  const worldX = (a: number, d: number): number => home.x + a * c + d * s;
  const worldZ = (a: number, d: number): number => home.z - a * s + d * c;
  const part = (w: number, h: number, depth: number, a: number, y: number, d: number, color: number, glow?: readonly [number, number, number]): void => {
    b.box(w, h, depth, worldX(a, d), y, worldZ(a, d), color, { rotY: home.yaw, glow });
  };
  const solid = (halfA: number, halfY: number, halfD: number, a: number, y: number, d: number): void => {
    physics.addFixedCuboid(halfA, halfY, halfD, worldX(a, d), y, worldZ(a, d), 'dirt', home.yaw);
  };
  const w = WIDTH / 2;
  const d = DEPTH / 2;
  const wall = 0x8fa59a;
  const tin = 0x6a6f74;

  // Floor, walls and a corrugated roof. The floor is thin, so that wheels stand on it.
  part(WIDTH, 0.02, DEPTH, 0, 0.012, 0, 0x3f3d3a);
  part(WIDTH, HEIGHT, 0.3, 0, HEIGHT / 2, -d, wall);
  part(0.3, HEIGHT, DEPTH, -w, HEIGHT / 2, 0, wall);
  part(0.3, HEIGHT, DEPTH, w, HEIGHT / 2, 0, wall);
  solid(w, HEIGHT / 2, 0.2, 0, HEIGHT / 2, -d);
  solid(0.2, HEIGHT / 2, d, -w, HEIGHT / 2, 0);
  solid(0.2, HEIGHT / 2, d, w, HEIGHT / 2, 0);
  part(WIDTH + 0.6, 0.2, DEPTH + 1.8, 0, HEIGHT + 0.1, 0.5, tin);
  for (let i = -10; i <= 10; i++) part(0.16, 0.05, DEPTH + 1.8, i, HEIGHT + 0.22, 0.5, 0x7d8288);
  // A half-rolled shutter at the mouth.
  part(WIDTH - 0.4, 1, 0.5, 0, HEIGHT - 0.5, d - 0.2, 0x4a4f54);
  for (let i = 0; i < 3; i++) part(WIDTH - 0.4, 0.05, 0.54, 0, HEIGHT - 0.1 - i * 0.32, d - 0.2, 0x34383c);

  // Bright lamps over the bay, because a mechanic needs to see.
  for (const a of [-7, 0, 7]) {
    for (const row of [-4, 1, 5]) part(3.2, 0.08, 0.26, a, HEIGHT - 0.3, row, 0xfff0d0, [3.4, 2.9, 2.1]);
  }

  // A bay painted on the floor, under the car.
  part(5.8, 0.01, 2.8, 0, 0.026, 0, 0xd9a312);
  part(5.2, 0.01, 2.2, 0, 0.034, 0, 0x2a2d33);

  // Along the back: a bench, tools on a board, tyres and drums.
  part(9, 0.14, 1.1, 0, 1, -d + 0.8, 0x6a4a2a);
  for (const a of [-4.2, 4.2]) part(0.14, 1, 1, a, 0.5, -d + 0.8, 0x4a3524);
  solid(4.5, 0.55, 0.6, 0, 0.55, -d + 0.8);
  part(8, 2, 0.08, 0, 2.5, -d + 0.2, 0xefe3c8);
  for (let i = 0; i < 12; i++) {
    const a = -3.5 + i * 0.64;
    part(0.08, 0.5 + (i % 3) * 0.28, 0.06, a, 2.7, -d + 0.26, i % 2 === 0 ? 0xd8402b : 0x20242a);
  }
  // Tyres in a stack on one side, and oil drums on the other.
  for (let stack = 0; stack < 2; stack++) {
    for (let i = 0; i < 5 - stack; i++) {
      b.cylinderY(0.42, 0.26, worldX(-w + 1.1 + stack, -d + 1 + stack * 1.8), 0.14 + i * 0.27, worldZ(-w + 1.1 + stack, -d + 1 + stack * 1.8), 0x121214, 14);
    }
    solid(0.45, 0.8, 0.45, -w + 1.1 + stack, 0.8, -d + 1 + stack * 1.8);
  }
  for (const [a, dz, tint] of [[w - 1.1, -d + 1, 0x1f6f78], [w - 2.2, -d + 1.1, 0xb5472a], [w - 1.2, -d + 2.2, 0xd9a312]] as const) {
    b.cylinderY(0.4, 1, worldX(a, dz), 0.55, worldZ(a, dz), tint, 12);
    solid(0.4, 0.55, 0.4, a, 0.55, dz);
  }

  const mesh = new Mesh(b.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.08 })));
  mesh.frustumCulled = false;
  enableReflection(mesh);
  scene.add(mesh);

  // The sign along the top of the mouth, facing the road.
  const sign = new ModelBuilder();
  sign.panel(WIDTH - 1, (WIDTH - 1) / 5.12, worldX(0, d + 0.42), HEIGHT + 1.7, worldZ(0, d + 0.42), 0xffffff, { rotY: home.yaw, uv: [0, 0, 1, 1], glow: [1, 1, 1] });
  const board = new Mesh(sign.build() as BufferGeometry, useSelfLitGlow(new MeshStandardMaterial({ map: signTexture(anisotropy), vertexColors: true, roughness: 0.65 })));
  board.frustumCulled = false;
  enableReflection(board);
  scene.add(board);
}
