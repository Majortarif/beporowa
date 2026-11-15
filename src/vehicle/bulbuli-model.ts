/**
 * বুলবুলি: the starter hatchback, an original design built from code.
 * The body is lofted through cross-sections so wheel arches are real cut-outs.
 * All sizes are relative to the physics body origin (+Z forward, +Y up).
 */

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  type Group,
  Matrix4,
  Quaternion,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNING } from '../config/tuning';
import { lerp } from '../core/math';

/** Piecewise-linear lookup over [z, value] keys sorted from front to rear. */
function sample(keys: ReadonlyArray<readonly [number, number]>, z: number): number {
  if (z >= keys[0][0]) return keys[0][1];
  for (let i = 0; i < keys.length - 1; i++) {
    const [z0, v0] = keys[i];
    const [z1, v1] = keys[i + 1];
    if (z <= z0 && z >= z1) return lerp(v0, v1, (z0 - z) / (z0 - z1));
  }
  return keys[keys.length - 1][1];
}

const TOP_KEYS = [
  [2.0, -0.06], [1.95, 0.02], [1.84, 0.12], [1.6, 0.2], [1.0, 0.26], [0.72, 0.29],
  [0, 0.3], [-1.0, 0.31], [-1.42, 0.31], [-1.7, 0.3], [-1.88, 0.26], [-1.98, 0.16],
] as const;

const WIDTH_KEYS = [
  [2.0, 0.6], [1.95, 0.72], [1.84, 0.82], [1.6, 0.87], [1.0, 0.89], [0, 0.9],
  [-1.0, 0.9], [-1.6, 0.87], [-1.85, 0.8], [-1.98, 0.7],
] as const;

const SILL_Y = -0.44;
const ARCH_RADIUS = 0.42;
/** Wheel centre at static ride height, relative to the body origin. */
const WHEEL_REST_Y = -0.337;

function archSill(z: number): number {
  const { frontAxleZ, rearAxleZ } = TUNING.vehicle.wheels;
  let sill = z > 1.72 ? -0.4 : z < -1.72 ? -0.38 : SILL_Y;
  for (const axle of [frontAxleZ, rearAxleZ]) {
    const dz = z - axle;
    if (Math.abs(dz) < ARCH_RADIUS) {
      sill = Math.max(sill, WHEEL_REST_Y + Math.sqrt(ARCH_RADIUS * ARCH_RADIUS - dz * dz));
    }
  }
  return sill;
}

function stationZs(): number[] {
  const { frontAxleZ, rearAxleZ } = TUNING.vehicle.wheels;
  const arch = [0.42, 0.38, 0.3, 0.18, 0, -0.18, -0.3, -0.38, -0.42];
  return [
    2.0, 1.95, 1.84,
    ...arch.map((d) => frontAxleZ + d),
    0.5, 0, -0.4,
    ...arch.map((d) => rearAxleZ + d),
    -1.8, -1.9, -1.98,
  ];
}

/** One closed-top cross-section from the sill on one side, over the top, to the other sill. */
function bodyRing(z: number): Vector3[] {
  const halfWidth = sample(WIDTH_KEYS, z);
  const top = sample(TOP_KEYS, z);
  const sill = archSill(z);
  const shoulder = top - 0.05;
  const line = Math.max(-0.12, sill + 0.015);
  const left = [
    new Vector3(halfWidth * 0.95, sill, z),
    new Vector3(halfWidth, line, z),
    new Vector3(halfWidth * 0.985, shoulder, z),
    new Vector3(halfWidth * 0.76, top, z),
  ];
  const center = new Vector3(0, top + 0.02, z);
  const right = [...left].reverse().map((p) => new Vector3(-p.x, p.y, p.z));
  return [...left, center, ...right];
}

/** Livery UV: side projection, U along the car, V up the side. */
function liveryUv(p: Vector3): [number, number] {
  return [(2 - p.z) / 4, (p.y - SILL_Y) / 1.0];
}

function pushQuad(positions: number[], uvs: number[], a: Vector3, b: Vector3, c: Vector3, d: Vector3): void {
  // The car's right side reads the texture the other way, or a picture on the door would be backwards.
  const rightSide = a.x <= 0 && b.x <= 0 && c.x <= 0 && d.x <= 0;
  for (const p of [a, b, c, a, c, d]) {
    positions.push(p.x, p.y, p.z);
    const [u, v] = liveryUv(p);
    uvs.push(rightSide ? 1 - u : u, v);
  }
}

function buildGeometry(positions: number[], uvs: number[]): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildBodyGeometry(): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const rings = stationZs().map(bodyRing);
  for (let s = 0; s < rings.length - 1; s++) {
    const near = rings[s];
    const far = rings[s + 1];
    for (let i = 0; i < near.length - 1; i++) {
      // Counter-clockwise from outside, with the front ring first.
      pushQuad(positions, uvs, near[i], far[i], far[i + 1], near[i + 1]);
    }
  }
  // Nose and tail caps.
  const capFan = (ring: Vector3[], flip: boolean): void => {
    const center = new Vector3(0, (ring[0].y + ring[4].y) / 2, ring[0].z);
    for (let i = 0; i < ring.length - 1; i++) {
      const a = flip ? ring[i + 1] : ring[i];
      const b = flip ? ring[i] : ring[i + 1];
      pushQuad(positions, uvs, center, a, b, b);
    }
    pushQuad(positions, uvs, center, flip ? ring[0] : ring[ring.length - 1], flip ? ring[ring.length - 1] : ring[0], flip ? ring[ring.length - 1] : ring[0]);
  };
  capFan(rings[0], false);
  capFan(rings[rings.length - 1], true);
  return buildGeometry(positions, uvs);
}

interface CabinStation {
  z: number;
  baseY: number;
  topY: number;
  baseHalf: number;
  topHalf: number;
}

const CABIN: CabinStation[] = [
  { z: 0.78, baseY: 0.285, topY: 0.3, baseHalf: 0.8, topHalf: 0.78 },
  { z: 0.02, baseY: 0.3, topY: 0.7, baseHalf: 0.84, topHalf: 0.6 },
  { z: -0.98, baseY: 0.31, topY: 0.7, baseHalf: 0.84, topHalf: 0.6 },
  { z: -1.56, baseY: 0.31, topY: 0.33, baseHalf: 0.82, topHalf: 0.74 },
];

export function buildCabinGeometries(): { glass: BufferGeometry; roof: BufferGeometry } {
  const glassP: number[] = [];
  const glassU: number[] = [];
  const roofP: number[] = [];
  const roofU: number[] = [];
  for (let i = 0; i < CABIN.length - 1; i++) {
    const a = CABIN[i];
    const b = CABIN[i + 1];
    const topLeftA = new Vector3(a.topHalf, a.topY, a.z);
    const topRightA = new Vector3(-a.topHalf, a.topY, a.z);
    const topLeftB = new Vector3(b.topHalf, b.topY, b.z);
    const topRightB = new Vector3(-b.topHalf, b.topY, b.z);
    const baseLeftA = new Vector3(a.baseHalf, a.baseY, a.z);
    const baseRightA = new Vector3(-a.baseHalf, a.baseY, a.z);
    const baseLeftB = new Vector3(b.baseHalf, b.baseY, b.z);
    const baseRightB = new Vector3(-b.baseHalf, b.baseY, b.z);
    const isRoof = i === 1;
    pushQuad(isRoof ? roofP : glassP, isRoof ? roofU : glassU, topLeftA, topLeftB, topRightB, topRightA);
    pushQuad(glassP, glassU, baseLeftA, baseLeftB, topLeftB, topLeftA);
    pushQuad(glassP, glassU, topRightA, topRightB, baseRightB, baseRightA);
  }
  return { glass: buildGeometry(glassP, glassU), roof: buildGeometry(roofP, roofU) };
}

/** A thin box between two points, for pillars and trim. */
function beam(from: Vector3, to: Vector3, width: number, height: number): BufferGeometry {
  const length = from.distanceTo(to);
  const geometry = new BoxGeometry(width, height, length);
  const mid = from.clone().add(to).multiplyScalar(0.5);
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), to.clone().sub(from).normalize());
  geometry.applyMatrix4(new Matrix4().compose(mid, rotation, new Vector3(1, 1, 1)));
  return geometry;
}

function box(w: number, h: number, d: number, x: number, y: number, z: number): BufferGeometry {
  const geometry = new BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  return geometry;
}

function buildTrim(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  for (const side of [1, -1]) {
    parts.push(beam(new Vector3(side * 0.8, 0.3, 0.78), new Vector3(side * 0.6, 0.7, 0.02), 0.05, 0.05));
    parts.push(beam(new Vector3(side * 0.75, 0.32, -0.4), new Vector3(side * 0.6, 0.7, -0.42), 0.06, 0.06));
    parts.push(beam(new Vector3(side * 0.6, 0.7, -0.98), new Vector3(side * 0.8, 0.32, -1.56), 0.09, 0.05));
    parts.push(beam(new Vector3(side * 0.61, 0.705, 0.02), new Vector3(side * 0.61, 0.705, -0.98), 0.05, 0.03));
    parts.push(box(0.11, 0.07, 0.15, side * 0.92, 0.37, 0.58));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()));
}

export function buildWheelGeometries(): { tyre: BufferGeometry; rim: BufferGeometry } {
  const { radius } = TUNING.vehicle.wheels;
  const width = 0.24;
  const tyre = new CylinderGeometry(radius, radius, width, 20);
  tyre.rotateZ(Math.PI / 2);

  const rimParts: BufferGeometry[] = [];
  const hub = new CylinderGeometry(radius * 0.22, radius * 0.22, width + 0.03, 10);
  hub.rotateZ(Math.PI / 2);
  rimParts.push(hub.toNonIndexed());
  const ring = new CylinderGeometry(radius * 0.66, radius * 0.66, width + 0.012, 18, 1, true);
  ring.rotateZ(Math.PI / 2);
  rimParts.push(ring.toNonIndexed());
  for (let i = 0; i < 5; i++) {
    const spoke = new BoxGeometry(width + 0.02, radius * 0.56, radius * 0.16);
    spoke.translate(0, radius * 0.4, 0);
    spoke.rotateX((i / 5) * Math.PI * 2);
    rimParts.push(spoke.toNonIndexed());
  }
  return { tyre, rim: mergeGeometries(rimParts) };
}

export interface WheelVisual {
  /** Moves with the suspension and steers. */
  readonly steer: Group;
  /** Rotates as the wheel rolls. */
  readonly spin: Group;
}

/** বুলবুলি's body parts, ready for whichever paint the player has chosen. */
export function buildBulbuliBody(): { body: BufferGeometry; glass: BufferGeometry; roof: BufferGeometry; trim: BufferGeometry } {
  const cabin = buildCabinGeometries();
  return { body: buildBodyGeometry(), glass: cabin.glass, roof: cabin.roof, trim: buildTrim() };
}
