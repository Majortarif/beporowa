/**
 * People on the pavements. They live in a bubble around the player, walk their street, gather at stalls,
 * and always get out of the way: nobody in this game is ever hit. Each is pushed clear of the car's
 * footprint every frame, however fast it comes. No rendering here, so tests can check that rule.
 */

import { CITY } from '../config/city-tuning';
import { createRng } from '../core/math';
import { createSample } from '../core/polyline';
import { createRoadHit, type RoadEdge, type RoadNetwork } from '../world/city/road-network';

const STATE_WALK = 0;
const STATE_IDLE = 1;
const STATE_DODGE = 2;

export interface PedestrianCar {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  fx: number;
  fz: number;
  speed: number;
  halfLength: number;
  halfWidth: number;
}

export interface GatherSpot {
  x: number;
  y: number;
  z: number;
  faceYaw: number;
}

export class PedestrianSystem {
  readonly capacity: number;
  aliveCount = 0;
  /** Police cars, which people must also dodge and never touch. */
  extraCars: PedestrianCar[] = [];
  /** People inside this distance of the car leave, used while the title camera circles it. */
  keepOutRadius = 0;
  readonly alive: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly state: Uint8Array;
  /** Walk cycle phase, advanced by distance covered. */
  readonly phase: Float32Array;
  /** How hard limbs swing, 0 to 1. */
  readonly swing: Float32Array;
  readonly look: Uint8Array;

  private readonly edge: Int32Array;
  private readonly s: Float32Array;
  private readonly side: Int8Array;
  private readonly direction: Int8Array;
  private readonly speed: Float32Array;
  private readonly offset: Float32Array;
  private readonly dodgeTimer: Float32Array;
  private readonly dodgeX: Float32Array;
  private readonly dodgeZ: Float32Array;
  private readonly gathered: Int32Array;
  private readonly spotTaken: Uint8Array;
  private readonly random = createRng(5150);
  private readonly sample = createSample();
  private readonly hit = createRoadHit();
  private spawnDebt = 0;

  constructor(
    private readonly network: RoadNetwork,
    capacity: number,
    private readonly gatherings: readonly GatherSpot[],
  ) {
    this.capacity = capacity;
    this.alive = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.state = new Uint8Array(capacity);
    this.phase = new Float32Array(capacity);
    this.swing = new Float32Array(capacity);
    this.look = new Uint8Array(capacity);
    this.edge = new Int32Array(capacity);
    this.s = new Float32Array(capacity);
    this.side = new Int8Array(capacity);
    this.direction = new Int8Array(capacity);
    this.speed = new Float32Array(capacity);
    this.offset = new Float32Array(capacity);
    this.dodgeTimer = new Float32Array(capacity);
    this.dodgeX = new Float32Array(capacity);
    this.dodgeZ = new Float32Array(capacity);
    this.gathered = new Int32Array(capacity).fill(-1);
    this.spotTaken = new Uint8Array(gatherings.length);
  }

  private walkOffset(edge: RoadEdge): number {
    const config = CITY.pedestrians;
    if (edge.kind === 'lane') return edge.spec.halfWidth - config.laneOffset;
    if (edge.kind === 'street') return edge.spec.halfWidth + config.streetOffset;
    return edge.spec.halfWidth + config.avenueOffset;
  }

  update(dt: number, car: PedestrianCar, viewFx: number, viewFz: number): void {
    const config = CITY.pedestrians;
    this.spawnDebt += 40 * dt;
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      if (this.aliveCount < this.capacity) this.trySpawn(car, viewFx, viewFz);
    }
    const despawnSquared = config.despawnRadius * config.despawnRadius;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const dx = this.x[i] - car.x;
      const dz = this.z[i] - car.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared > despawnSquared || distanceSquared < this.keepOutRadius * this.keepOutRadius) {
        this.despawn(i);
        continue;
      }
      this.reactToCar(i, car, dx, dz);
      for (const extra of this.extraCars) this.reactToCar(i, extra, this.x[i] - extra.x, this.z[i] - extra.z);
      this.move(i, dt);
      this.keepClearOfCar(i, car);
      for (const extra of this.extraCars) this.keepClearOfCar(i, extra);
    }
  }

  /** People look up and move if the car's path will reach them soon. */
  private reactToCar(i: number, car: PedestrianCar, dx: number, dz: number): void {
    const config = CITY.pedestrians;
    if (this.state[i] === STATE_DODGE) return;
    if (Math.abs(this.y[i] - car.y) > 3) return;
    const along = dx * car.fx + dz * car.fz;
    const lookAhead = config.dodgeMinDistance + car.speed * config.dodgeLookAhead;
    if (along < -car.halfLength || along > lookAhead) return;
    const side = dx * car.fz - dz * car.fx;
    if (Math.abs(side) > car.halfWidth + config.dodgeLateral) return;
    // Away from the car's line, at a sprint.
    const away = side >= 0 ? 1 : -1;
    this.startDodge(i, car.fz * away, -car.fx * away, config.dodgeSeconds, config.dodgeSpeed);
  }

  private startDodge(i: number, dirX: number, dirZ: number, seconds: number, speed: number): void {
    this.state[i] = STATE_DODGE;
    this.dodgeTimer[i] = seconds;
    this.dodgeX[i] = dirX * speed;
    this.dodgeZ[i] = dirZ * speed;
    this.yaw[i] = Math.atan2(dirX, dirZ);
    this.swing[i] = 1;
    if (this.gathered[i] >= 0) {
      this.spotTaken[this.gathered[i]] = 0;
      this.gathered[i] = -1;
    }
  }

  private move(i: number, dt: number): void {
    if (this.state[i] === STATE_DODGE) {
      this.x[i] += this.dodgeX[i] * dt;
      this.z[i] += this.dodgeZ[i] * dt;
      this.phase[i] += 14 * dt;
      this.dodgeTimer[i] -= dt;
      if (this.dodgeTimer[i] <= 0) {
        // Back to a calm stand, wherever the sprint ended.
        this.state[i] = STATE_IDLE;
        this.swing[i] = 0;
      }
      return;
    }
    if (this.state[i] === STATE_IDLE) {
      this.phase[i] += dt;
      return;
    }
    const edge = this.network.edges[this.edge[i]];
    const line = edge.center;
    this.s[i] += this.direction[i] * this.speed[i] * dt;
    if (this.s[i] < 1) {
      this.s[i] = 1;
      this.direction[i] = 1;
    } else if (this.s[i] > line.length - 1) {
      this.s[i] = line.length - 1;
      this.direction[i] = -1;
    }
    line.sample(this.s[i], this.sample);
    const offset = this.offset[i] * this.side[i];
    this.x[i] = this.sample.x + this.sample.tz * offset;
    this.y[i] = this.sample.y;
    this.z[i] = this.sample.z - this.sample.tx * offset;
    this.yaw[i] = Math.atan2(this.sample.tx * this.direction[i], this.sample.tz * this.direction[i]);
    this.phase[i] += this.speed[i] * 3.6 * dt;
  }

  /** The hard rule: no one is ever inside the car's footprint. */
  private keepClearOfCar(i: number, car: PedestrianCar): void {
    if (Math.abs(this.y[i] - car.y) > 3) return;
    const clearance = CITY.pedestrians.separation;
    const dx = this.x[i] - car.x;
    const dz = this.z[i] - car.z;
    const along = dx * car.fx + dz * car.fz;
    const side = dx * car.fz - dz * car.fx;
    const halfLength = car.halfLength + clearance;
    const halfWidth = car.halfWidth + clearance;
    if (Math.abs(along) >= halfLength || Math.abs(side) >= halfWidth) return;
    const push = (side >= 0 ? 1 : -1) * (halfWidth - Math.abs(side));
    this.x[i] += car.fz * push;
    this.z[i] += -car.fx * push;
    if (this.state[i] !== STATE_DODGE) {
      const away = side >= 0 ? 1 : -1;
      this.startDodge(i, car.fz * away, -car.fx * away, CITY.pedestrians.dodgeSeconds, CITY.pedestrians.dodgeSpeed);
    }
  }

  /** A long horn: everyone nearby clears out. Returns how many reacted, and one to speak. */
  scatter(car: PedestrianCar): { count: number; sample: number } {
    const config = CITY.pedestrians;
    const radiusSquared = config.scatterRadius * config.scatterRadius;
    let count = 0;
    let sample = -1;
    let best = Infinity;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const dx = this.x[i] - car.x;
      const dz = this.z[i] - car.z;
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared > radiusSquared || Math.abs(this.y[i] - car.y) > 3) continue;
      const distance = Math.sqrt(distanceSquared) || 1;
      this.startDodge(i, dx / distance, dz / distance, config.scatterSeconds, config.scatterSpeed);
      count++;
      if (distanceSquared < best) {
        best = distanceSquared;
        sample = i;
      }
    }
    return { count, sample };
  }

  private trySpawn(car: PedestrianCar, viewFx: number, viewFz: number): void {
    const config = CITY.pedestrians;
    const index = this.alive.indexOf(0);
    if (index < 0) return;

    // Some people belong to a stall; the rest walk.
    if (this.gatherings.length > 0 && this.random() < config.idleShare) {
      const spot = Math.floor(this.random() * this.gatherings.length);
      const gather = this.gatherings[spot];
      if (!this.spotTaken[spot] && this.isSpawnable(gather.x, gather.z, car, viewFx, viewFz)) {
        this.spotTaken[spot] = 1;
        this.gathered[index] = spot;
        this.activate(index, gather.x + (this.random() - 0.5) * 1.2, gather.y, gather.z + (this.random() - 0.5) * 1.2, gather.faceYaw, STATE_IDLE);
        return;
      }
    }

    const angle = this.random() * Math.PI * 2;
    const radius = config.hiddenRadius + this.random() * (config.spawnRadius - config.hiddenRadius);
    const targetX = car.x + Math.cos(angle) * radius;
    const targetZ = car.z + Math.sin(angle) * radius;
    // The street nearest to a random point around the car. Nobody strolls on the flyover.
    const hit = this.network.nearestRoad(targetX, targetZ, 0, this.hit);
    const edge = this.network.edges[hit.edge];
    if (edge.elevated) return;
    const bestEdge = edge.index;
    const bestS = hit.s;
    const side = this.random() < 0.5 ? 1 : -1;
    const offset = this.walkOffset(edge);
    edge.center.sample(bestS, this.sample);
    const x = this.sample.x + this.sample.tz * offset * side;
    const z = this.sample.z - this.sample.tx * offset * side;
    if (!this.isSpawnable(x, z, car, viewFx, viewFz)) return;

    this.edge[index] = bestEdge;
    this.s[index] = bestS;
    this.side[index] = side;
    this.direction[index] = this.random() < 0.5 ? 1 : -1;
    this.offset[index] = offset;
    this.speed[index] = config.walkSpeedMin + this.random() * (config.walkSpeedMax - config.walkSpeedMin);
    this.activate(index, x, this.sample.y, z, 0, STATE_WALK);
    this.swing[index] = 0.7;
  }

  private isSpawnable(x: number, z: number, car: PedestrianCar, viewFx: number, viewFz: number): boolean {
    const config = CITY.pedestrians;
    const dx = x - car.x;
    const dz = z - car.z;
    const distance = Math.hypot(dx, dz);
    if (distance > config.spawnRadius || distance < this.keepOutRadius) return false;
    // Close up, a person must never pop into view.
    return distance > config.hiddenRadius || dx * viewFx + dz * viewFz < 0;
  }

  private activate(index: number, x: number, y: number, z: number, yaw: number, state: number): void {
    this.alive[index] = 1;
    this.aliveCount++;
    this.x[index] = x;
    this.y[index] = y;
    this.z[index] = z;
    this.yaw[index] = yaw;
    this.state[index] = state;
    this.phase[index] = this.random() * 6.28;
    this.swing[index] = 0;
    this.look[index] = Math.floor(this.random() * 255);
    this.dodgeTimer[index] = 0;
  }

  private despawn(index: number): void {
    this.alive[index] = 0;
    this.aliveCount--;
    if (this.gathered[index] >= 0) {
      this.spotTaken[this.gathered[index]] = 0;
      this.gathered[index] = -1;
    }
  }

  clear(): void {
    for (let i = 0; i < this.capacity; i++) if (this.alive[i]) this.despawn(i);
  }
}
