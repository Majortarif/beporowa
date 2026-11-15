/**
 * ঝামেলা-ফাঁদ: bamboo scaffolds, drum stacks and rooftop water tanks at the roadside.
 * Clip one at speed and it comes down across the road, and any police car nearby gets stuck in it.
 * The standing pieces have no physics; the falling pieces come from a fixed pool of bodies.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { POLICE } from '../config/police-tuning';
import type { EventBus } from '../core/events';
import { createRng } from '../core/math';
import { createSample } from '../core/polyline';
import { GROUP_TRAFFIC, type PhysicsWorld } from '../physics/physics-world';
import type { Occupancy } from '../world/city/city-buildings';
import type { RoadNetwork } from '../world/city/road-network';

export type TrapKind = 'bamboo' | 'drums' | 'tank';
export type PieceShape = 'pole' | 'drum' | 'tank';

export const TRAP_KINDS: readonly TrapKind[] = ['bamboo', 'drums', 'tank'];

export interface TrapPiece {
  shape: PieceShape;
  x: number;
  y: number;
  z: number;
  /** Rotation of the piece as a quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
}

export interface Trap {
  kind: TrapKind;
  x: number;
  y: number;
  z: number;
  /** Direction from the trap across the road. */
  towardX: number;
  towardZ: number;
  pieces: TrapPiece[];
  armed: boolean;
  rearmTimer: number;
}

export interface Debris {
  shape: PieceShape;
  body: RAPIER.RigidBody;
  active: boolean;
  life: number;
}

const POLE_LENGTH = 5.6;
const POLE_RADIUS = 0.07;
const DRUM_RADIUS = 0.36;
const DRUM_HEIGHT = 0.92;
const TANK_RADIUS = 1.02;
const TANK_HEIGHT = 1.7;
const STAND_HEIGHT = 2.6;

export const PIECE_SIZE = { POLE_LENGTH, POLE_RADIUS, DRUM_RADIUS, DRUM_HEIGHT, TANK_RADIUS, TANK_HEIGHT, STAND_HEIGHT };

const POOL: Record<PieceShape, number> = { pole: 14, drum: 12, tank: 2 };

function quaternionFromEuler(rotX: number, rotY: number, rotZ: number): [number, number, number, number] {
  // Order X, then Y, then Z, matching three.js defaults for these simple cases.
  const cx = Math.cos(rotX / 2);
  const sx = Math.sin(rotX / 2);
  const cy = Math.cos(rotY / 2);
  const sy = Math.sin(rotY / 2);
  const cz = Math.cos(rotZ / 2);
  const sz = Math.sin(rotZ / 2);
  return [sx * cy * cz + cx * sy * sz, cx * sy * cz - sx * cy * sz, cx * cy * sz + sx * sy * cz, cx * cy * cz - sx * sy * sz];
}

/** One trap's pieces, in world space. Local a runs along the road, local b runs away from it. */
function buildPieces(kind: TrapKind, x: number, y: number, z: number, yaw: number, random: () => number): TrapPiece[] {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pieces: TrapPiece[] = [];
  const add = (shape: PieceShape, a: number, up: number, b: number, rotX: number, rotZ: number): void => {
    const [qx, qy, qz, qw] = quaternionFromEuler(rotX, yaw, rotZ);
    pieces.push({ shape, x: x + a * c + b * s, y: y + up, z: z - a * s + b * c, qx, qy, qz, qw });
  };
  if (kind === 'bamboo') {
    // A rough scaffold: uprights, with rails lashed across them.
    const half = POLE_LENGTH / 2;
    for (const a of [-1.6, 0, 1.6]) add('pole', a, half, 0.5, 0.05 * (random() - 0.5), 0.05 * (random() - 0.5));
    add('pole', -1.6, half, -0.4, 0.04, 0);
    add('pole', 1.6, half, -0.4, -0.04, 0);
    for (const up of [2, 3.9]) add('pole', 0, up, 0.5, 0, Math.PI / 2);
    add('pole', 0, 3, 0, 0.9, 0);
  } else if (kind === 'drums') {
    const h = DRUM_HEIGHT;
    for (const a of [-0.8, 0, 0.8]) add('drum', a, h / 2, 0, 0, 0);
    for (const a of [-0.42, 0.42]) add('drum', a, h * 1.5, 0, 0, 0);
    add('drum', 0, h * 2.5, 0, 0, 0);
  } else {
    // A black water tank on a thin stand, as found on rooftops all over the city.
    for (const [a, b] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) {
      const [qx, qy, qz, qw] = quaternionFromEuler(0, yaw, 0);
      pieces.push({ shape: 'pole', x: x + a * c + b * s, y: y + POLE_LENGTH / 2 - (POLE_LENGTH - STAND_HEIGHT), z: z - a * s + b * c, qx, qy, qz, qw });
    }
    add('tank', 0, STAND_HEIGHT + TANK_HEIGHT / 2, 0, 0, 0);
  }
  return pieces;
}

/** Picks trap sites beside the ground roads. They reserve their ground before buildings go up. */
export function layOutTraps(network: RoadNetwork, occupancy: Occupancy): Trap[] {
  const config = POLICE.traps;
  const random = createRng(9173);
  const traps: Trap[] = [];
  const sample = createSample();
  let edgeCounter = 0;
  for (const edge of network.edges) {
    if (edge.elevated || edge.jam || edge.center.length < 70) continue;
    if (edgeCounter++ % config.everyEdges !== 0) continue;
    const side = random() < 0.5 ? 1 : -1;
    edge.center.sample(edge.center.length * (0.35 + random() * 0.3), sample);
    const offset = edge.spec.halfWidth + config.offset;
    const outX = sample.tz * side;
    const outZ = -sample.tx * side;
    const x = sample.x + outX * offset;
    const z = sample.z + outZ * offset;
    const yaw = Math.atan2(outX, outZ);
    occupancy.mark(x, z, yaw, 3, 2);
    const kind = TRAP_KINDS[traps.length % TRAP_KINDS.length];
    traps.push({
      kind,
      x,
      y: sample.y,
      z,
      towardX: -outX,
      towardZ: -outZ,
      pieces: buildPieces(kind, x, sample.y, z, yaw, random),
      armed: true,
      rearmTimer: 0,
    });
  }
  return traps;
}

export class TrapSystem {
  readonly debris: Debris[] = [];
  /** Bumped whenever the standing pieces change, so the drawing knows to refresh. */
  revision = 0;
  /** Stuns police around a point. Returns how many it caught. */
  stun: ((x: number, z: number, radius: number) => number) | null = null;
  private readonly random = createRng(9174);

  constructor(
    private readonly physics: PhysicsWorld,
    private readonly bus: EventBus,
    readonly traps: Trap[],
  ) {
    for (const shape of ['pole', 'drum', 'tank'] as const) {
      for (let i = 0; i < POOL[shape]; i++) this.debris.push(this.createDebris(shape));
    }
  }

  private createDebris(shape: PieceShape): Debris {
    const config = POLICE.traps;
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -400, 0).setLinearDamping(0.25).setAngularDamping(0.5).setEnabled(false),
    );
    let collider: RAPIER.ColliderDesc;
    if (shape === 'pole') collider = RAPIER.ColliderDesc.cylinder(POLE_LENGTH / 2, POLE_RADIUS * 1.6).setMass(config.poleMass);
    else if (shape === 'drum') collider = RAPIER.ColliderDesc.cylinder(DRUM_HEIGHT / 2, DRUM_RADIUS).setMass(config.drumMass);
    else collider = RAPIER.ColliderDesc.cylinder(TANK_HEIGHT / 2, TANK_RADIUS).setMass(config.tankMass);
    this.physics.world.createCollider(collider.setFriction(0.55).setRestitution(0.28).setCollisionGroups(GROUP_TRAFFIC), body);
    return { shape, body, active: false, life: 0 };
  }

  /** The oldest piece of this shape is reused when the pool runs out. */
  private takeDebris(shape: PieceShape): Debris {
    let oldest: Debris | null = null;
    for (const piece of this.debris) {
      if (piece.shape !== shape) continue;
      if (!piece.active) return piece;
      if (!oldest || piece.life < oldest.life) oldest = piece;
    }
    return oldest as Debris;
  }

  update(dt: number, x: number, y: number, z: number, speed: number): void {
    const config = POLICE.traps;
    for (const piece of this.debris) {
      if (!piece.active) continue;
      piece.life -= dt;
      if (piece.life <= 0) this.retire(piece);
    }
    for (const trap of this.traps) {
      const dx = trap.x - x;
      const dz = trap.z - z;
      if (!trap.armed) {
        trap.rearmTimer -= dt;
        if (trap.rearmTimer <= 0 && Math.abs(dx) + Math.abs(dz) > config.rearmDistance) {
          trap.armed = true;
          this.revision++;
        }
        continue;
      }
      if (Math.abs(dx) > config.triggerRadius || Math.abs(dz) > config.triggerRadius) continue;
      const distance = Math.hypot(dx, dz);
      if (Math.abs(trap.y - y) > 2.5) continue;
      if ((distance < config.triggerRadius && speed >= config.triggerMinSpeed) || distance < 2.3) this.spring(trap);
    }
  }

  private retire(piece: Debris): void {
    piece.active = false;
    piece.body.setTranslation({ x: 0, y: -400, z: 0 }, false);
    piece.body.setEnabled(false);
  }

  /** Brings it all down, across the road. */
  spring(trap: Trap): void {
    const config = POLICE.traps;
    const random = this.random;
    trap.armed = false;
    trap.rearmTimer = config.rearmSeconds;
    this.revision++;
    for (const piece of trap.pieces) {
      const debris = this.takeDebris(piece.shape);
      const body = debris.body;
      debris.active = true;
      debris.life = config.lifeSeconds;
      body.setEnabled(true);
      body.setTranslation({ x: piece.x, y: piece.y, z: piece.z }, true);
      body.setRotation({ x: piece.qx, y: piece.qy, z: piece.qz, w: piece.qw }, true);
      const push = config.tipSpeed * (0.6 + random() * 0.8);
      body.setLinvel({ x: trap.towardX * push + (random() - 0.5) * 2, y: 0.8 + random() * 1.4, z: trap.towardZ * push + (random() - 0.5) * 2 }, true);
      body.setAngvel({ x: (random() - 0.5) * 3.4 + trap.towardZ * 1.6, y: (random() - 0.5) * 1.5, z: (random() - 0.5) * 3.4 - trap.towardX * 1.6 }, true);
    }
    const stunned = this.stun ? this.stun(trap.x, trap.z, config.stunRadius) : 0;
    this.bus.emit('trapSprung', { x: trap.x, y: trap.y, z: trap.z, stunned, kind: trap.kind });
  }

  /** Back to every trap standing, for a restart. */
  clear(): void {
    for (const piece of this.debris) if (piece.active) this.retire(piece);
    for (const trap of this.traps) {
      trap.armed = true;
      trap.rearmTimer = 0;
    }
    this.revision++;
  }
}
