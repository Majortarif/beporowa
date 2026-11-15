/**
 * Lane-following traffic in a bubble around the player.
 * Data lives in typed arrays. Vehicles use the Intelligent Driver Model for following and braking.
 * Far vehicles update less often, and only near ones get real colliders.
 * No rendering here, so tests can run a whole city of traffic headless.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { CITY, type RoadKind, type TrafficSpec, type TrafficType } from '../config/city-tuning';
import type { EventBus } from '../core/events';
import { clamp, createRng, moveToward } from '../core/math';
import { createSample } from '../core/polyline';
import { GROUP_TRAFFIC, type PhysicsWorld } from '../physics/physics-world';
import { createRoadHit, weightedPick, type Lane, type RoadNetwork } from '../world/city/road-network';
import { SignalController } from './signal-controller';

export const TRAFFIC_TYPES: readonly TrafficType[] = ['rickshaw', 'cng', 'bike', 'car', 'pickup', 'bus'];
const SPECS: readonly TrafficSpec[] = TRAFFIC_TYPES.map((type) => CITY.trafficTypes[type]);

const MODE_FOLLOW = 0;
const MODE_KNOCKED = 1;

/** The player as traffic sees it. Velocity is from before this physics step, so a crash can be resolved. */
export interface TrafficPlayer {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Unit forward in the ground plane. */
  fx: number;
  fz: number;
  speed: number;
  halfLength: number;
  halfWidth: number;
  mass: number;
}

/** Where the camera looks, so vehicles can appear out of sight. */
export interface TrafficView {
  x: number;
  z: number;
  fx: number;
  fz: number;
}

export interface HornResponse {
  /** Vehicles that reacted. */
  count: number;
  /** A vehicle to show a speech bubble on, or -1. */
  sample: number;
}

export class TrafficSystem {
  readonly capacity: number;
  readonly signals: SignalController;
  aliveCount = 0;

  readonly alive: Uint8Array;
  readonly type: Uint8Array;
  readonly variant: Uint8Array;
  readonly tint: Uint32Array;
  readonly mode: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly z: Float32Array;
  readonly yaw: Float32Array;
  readonly v: Float32Array;
  readonly tx: Float32Array;
  readonly tz: Float32Array;

  private readonly lane: Int32Array;
  private readonly nextLane: Int32Array;
  private readonly s: Float32Array;
  private readonly desired: Float32Array;
  private readonly lateral: Float32Array;
  private readonly yieldTimer: Float32Array;
  private readonly stopTimer: Float32Array;
  private readonly stuckTime: Float32Array;
  private readonly knockTimer: Float32Array;
  private readonly weavePhase: Float32Array;
  private readonly prevAlong: Float32Array;
  private readonly bodies: (RAPIER.RigidBody | null)[];
  private readonly leaving: Uint8Array;
  private readonly free: number[] = [];
  private readonly nodeAgents: number[][];
  private readonly moves: number[] = [];
  private readonly knocked: number[] = [];
  private readonly random = createRng(90210);
  private readonly sample = createSample();
  private readonly hit = createRoadHit();
  private readonly maxRoadWeight: number;

  private bodyCount = 0;
  private tick = 0;
  private time = 0;
  private spawnDebt = 0;
  private cleanupTimer = 0;
  private lastMissLeft = -10;
  private lastMissRight = -10;
  private lastMissEvent = -10;
  private hitCooldown = 0;

  /** Share of normal traffic. Races thin it out. */
  density = 1;

  /** Police cars and roadblocks to stop for: x, y, z of each. */
  readonly externalObstacles = new Float32Array(3 * 24);
  externalObstacleCount = 0;

  /** Called when a crash changes the player's velocity. */
  onPlayerVelocity: ((vx: number, vz: number) => void) | null = null;

  constructor(
    private readonly network: RoadNetwork,
    private readonly physics: PhysicsWorld,
    private readonly bus: EventBus,
    capacity: number,
    private readonly bodyLimit: number,
  ) {
    this.capacity = capacity;
    this.signals = new SignalController(network);
    this.alive = new Uint8Array(capacity);
    this.type = new Uint8Array(capacity);
    this.variant = new Uint8Array(capacity);
    this.tint = new Uint32Array(capacity);
    this.mode = new Uint8Array(capacity);
    this.x = new Float32Array(capacity);
    this.y = new Float32Array(capacity);
    this.z = new Float32Array(capacity);
    this.yaw = new Float32Array(capacity);
    this.v = new Float32Array(capacity);
    this.tx = new Float32Array(capacity);
    this.tz = new Float32Array(capacity);
    this.lane = new Int32Array(capacity).fill(-1);
    this.nextLane = new Int32Array(capacity).fill(-1);
    this.s = new Float32Array(capacity);
    this.desired = new Float32Array(capacity);
    this.lateral = new Float32Array(capacity);
    this.yieldTimer = new Float32Array(capacity);
    this.stopTimer = new Float32Array(capacity);
    this.stuckTime = new Float32Array(capacity);
    this.knockTimer = new Float32Array(capacity);
    this.weavePhase = new Float32Array(capacity);
    this.prevAlong = new Float32Array(capacity);
    this.leaving = new Uint8Array(capacity);
    this.bodies = new Array<RAPIER.RigidBody | null>(capacity).fill(null);
    for (let i = capacity - 1; i >= 0; i--) this.free.push(i);
    this.nodeAgents = network.nodes.map(() => []);
    this.maxRoadWeight = Math.max(...Object.values(CITY.roads).map((road) => road.spawnWeight));
  }

  /** Fills the bubble at once, so the first look at the city is not an empty street. */
  prewarm(player: TrafficPlayer, view: TrafficView): void {
    for (let i = 0; i < this.capacity * 12 && this.aliveCount < this.capacity; i++) this.trySpawn(player, view, 40);
  }

  update(dt: number, player: TrafficPlayer, view: TrafficView): void {
    this.tick++;
    this.time += dt;
    this.hitCooldown -= dt;
    this.signals.update(dt);

    if (this.tick % 8 === 0) this.sortLanes();
    this.stepLanes(dt, player);
    this.applyMoves();
    this.updateKnocked(dt);
    this.updateBodies(player);
    this.checkPlayerProximity(player);
    this.manageSpawning(dt, player, view);
  }

  /** Keeps each lane's list in driving order. Bikes filter past others, so order can change. */
  private sortLanes(): void {
    for (const lane of this.network.lanes) {
      const list = lane.agents;
      for (let i = 1; i < list.length; i++) {
        const agent = list[i];
        let j = i - 1;
        while (j >= 0 && this.s[list[j]] < this.s[agent]) {
          list[j + 1] = list[j];
          j--;
        }
        list[j + 1] = agent;
      }
    }
  }

  private stepLanes(dt: number, player: TrafficPlayer): void {
    const config = CITY.traffic;
    const nearSquared = config.tickNearRadius * config.tickNearRadius;
    const jamWave = 0.5 + 0.5 * Math.sin((this.time / config.jamWaveSeconds) * Math.PI * 2);
    const jamFactor = config.jamSpeedMin + (config.jamSpeedMax - config.jamSpeedMin) * jamWave;

    for (const lane of this.network.lanes) {
      const list = lane.agents;
      for (let k = 0; k < list.length; k++) {
        const agent = list[k];
        const dx = this.x[agent] - player.x;
        const dz = this.z[agent] - player.z;
        const distanceSquared = dx * dx + dz * dz;
        const near = distanceSquared < nearSquared;
        if (!near && (agent + this.tick) % config.farTickEvery !== 0) continue;
        const stepDt = near ? dt : dt * config.farTickEvery;
        this.stepAgent(agent, lane, k, stepDt, player, distanceSquared, jamFactor);
      }
    }
  }

  private stepAgent(
    agent: number,
    lane: Lane,
    order: number,
    dt: number,
    player: TrafficPlayer,
    distanceSquared: number,
    jamFactor: number,
  ): void {
    const config = CITY.traffic;
    const spec = SPECS[this.type[agent]];
    const list = lane.agents;
    const lengthHere = spec.length;
    const isBike = TRAFFIC_TYPES[this.type[agent]] === 'bike';

    let gap = Infinity;
    let leaderSpeed = 0;

    // Same lane: the next vehicle ahead. A bike in a jam looks only at what blocks its own line.
    for (let j = order - 1; j >= 0; j--) {
      const other = list[j];
      if (this.mode[other] !== MODE_FOLLOW) continue;
      const otherSpec = SPECS[this.type[other]];
      if (isBike && Math.abs(this.lateral[other] - this.lateral[agent]) > (spec.width + otherSpec.width) / 2 + 0.15) continue;
      gap = this.s[other] - this.s[agent] - (lengthHere + otherSpec.length) / 2;
      leaderSpeed = this.v[other];
      break;
    }

    const remaining = lane.line.length - this.s[agent];
    const blocked = !lane.isConnector && this.isHeldAtLine(agent, lane, remaining);
    if (blocked) {
      const toLine = remaining - lengthHere / 2 - 1;
      if (toLine < gap) {
        gap = toLine;
        leaderSpeed = 0;
      }
    } else if (gap === Infinity) {
      // Nothing ahead on this lane, so look along the route.
      let look = this.nextLane[agent];
      let distance = remaining;
      for (let hop = 0; hop < 3 && look >= 0 && distance < 75; hop++) {
        const nextLane = this.network.lanes[look];
        const others = nextLane.agents;
        if (others.length > 0) {
          const last = others[others.length - 1];
          const candidate = distance + this.s[last] - (lengthHere + SPECS[this.type[last]].length) / 2;
          if (candidate < gap) {
            gap = candidate;
            leaderSpeed = this.v[last];
          }
          break;
        }
        distance += nextLane.line.length;
        look = nextLane.isConnector ? nextLane.next[0] : -1;
      }
    }

    if (lane.isConnector) this.lookInsideNode(agent, lane, spec, order === 0);

    // The player and any crashed vehicles are obstacles for everyone close by.
    if (distanceSquared < config.obstacleLookAhead * config.obstacleLookAhead * 1.5) {
      const playerGap = this.obstacleGap(agent, spec, player.x, player.y, player.z, player.halfLength, player.halfWidth);
      if (playerGap < gap) {
        gap = playerGap;
        leaderSpeed = Math.max(0, player.vx * this.tx[agent] + player.vz * this.tz[agent]);
      }
    }
    for (let i = 0; i < this.externalObstacleCount; i++) {
      const ox = this.externalObstacles[i * 3];
      const oz = this.externalObstacles[i * 3 + 2];
      if (Math.abs(ox - this.x[agent]) > config.obstacleLookAhead || Math.abs(oz - this.z[agent]) > config.obstacleLookAhead) continue;
      const obstacle = this.obstacleGap(agent, spec, ox, this.externalObstacles[i * 3 + 1], oz, 2, 0.9);
      if (obstacle < gap) {
        gap = obstacle;
        leaderSpeed = 0;
      }
    }
    for (const other of this.knocked) {
      const otherSpec = SPECS[this.type[other]];
      const obstacle = this.obstacleGap(agent, spec, this.x[other], this.y[other], this.z[other], otherSpec.length / 2, otherSpec.width / 2);
      if (obstacle < gap) {
        gap = obstacle;
        leaderSpeed = 0;
      }
    }

    // Target speed: personality, road limit, jams and yielding to a horn.
    let target = Math.min(this.desired[agent], lane.speedLimit * (isBike ? 1.25 : 1));
    const inJam = lane.jam && !isBike;
    if (inJam) target *= jamFactor;
    else if (lane.jam && isBike) target *= 0.55;
    if (this.yieldTimer[agent] > 0) {
      this.yieldTimer[agent] -= dt;
      target *= config.yield.speedScale;
    }
    if (this.stopTimer[agent] > 0) {
      this.stopTimer[agent] -= dt;
      target = 0;
    }
    target = Math.max(target, 0.01);

    // Intelligent Driver Model.
    const v = this.v[agent];
    const ratio = v / target;
    let acceleration = spec.accel * (1 - ratio * ratio * ratio * ratio);
    if (gap < Infinity) {
      const closing = v - leaderSpeed;
      const desiredGap = spec.minGap + Math.max(0, v * spec.headway + (v * closing) / (2 * Math.sqrt(spec.accel * spec.brake)));
      const safeGap = Math.max(gap, 0.1);
      acceleration -= (spec.accel * desiredGap * desiredGap) / (safeGap * safeGap);
    }
    acceleration = Math.max(acceleration, -config.maxDeceleration);
    const nextV = Math.max(0, v + acceleration * dt);
    this.v[agent] = nextV;
    this.s[agent] += nextV * dt;

    if (nextV < 0.15) this.stuckTime[agent] += dt;
    else this.stuckTime[agent] = 0;

    if (this.s[agent] >= lane.line.length) {
      if (blocked || this.nextLane[agent] < 0) {
        this.s[agent] = lane.line.length - 0.02;
        this.v[agent] = 0;
      } else {
        this.moves.push(agent);
      }
    }

    this.updateLateral(agent, lane, spec, isBike, dt);
    this.writePose(agent, lane);
  }

  /** Red lights and full junctions hold a vehicle at the stop line. */
  private isHeldAtLine(agent: number, lane: Lane, remaining: number): boolean {
    const node = this.network.nodes[lane.node];
    if (node.signalized) {
      const state = this.signals.stateFor(node, lane.signalGroup);
      if (state === 'red') return true;
      if (state === 'amber') {
        const spec = SPECS[this.type[agent]];
        const v = this.v[agent];
        return remaining > (v * v) / (2 * spec.brake);
      }
      return false;
    }
    return node.occupancy >= node.capacity;
  }

  /** Vehicles crossing a junction on different paths must still not drive through each other. */
  private lookInsideNode(agent: number, lane: Lane, spec: TrafficSpec, isFirst: boolean): void {
    if (!isFirst) return;
    const others = this.nodeAgents[lane.node];
    const tx = this.tx[agent];
    const tz = this.tz[agent];
    for (const other of others) {
      if (other === agent || this.lane[other] === this.lane[agent]) continue;
      const dx = this.x[other] - this.x[agent];
      const dz = this.z[other] - this.z[agent];
      const along = dx * tx + dz * tz;
      if (along <= 0) continue;
      const otherSpec = SPECS[this.type[other]];
      const reach = (spec.length + otherSpec.length) / 2 + 3;
      if (along > reach) continue;
      const side = Math.abs(dx * tz - dz * tx);
      if (side > (spec.width + otherSpec.width) / 2 + 0.2) continue;
      // Whoever entered first keeps going, which also rules out two vehicles waiting for each other.
      if (other < agent || this.s[other] > this.s[agent]) {
        this.v[agent] = Math.max(0, this.v[agent] * 0.82);
        return;
      }
    }
  }

  /** Distance to something in this vehicle's path, or Infinity if it is clear. */
  private obstacleGap(agent: number, spec: TrafficSpec, ox: number, oy: number, oz: number, halfLength: number, halfWidth: number): number {
    const dx = ox - this.x[agent];
    const dz = oz - this.z[agent];
    if (Math.abs(oy - this.y[agent]) > 3) return Infinity;
    const along = dx * this.tx[agent] + dz * this.tz[agent];
    if (along <= 0 || along > CITY.traffic.obstacleLookAhead) return Infinity;
    const side = Math.abs(dx * this.tz[agent] - dz * this.tx[agent]);
    if (side > spec.width / 2 + halfWidth + 0.35) return Infinity;
    return along - spec.length / 2 - halfLength;
  }

  private updateLateral(agent: number, lane: Lane, spec: TrafficSpec, isBike: boolean, dt: number): void {
    const config = CITY.traffic;
    const limit = Math.max(0, (lane.laneWidth - spec.width) / 2 - 0.05);
    let target = 0;
    if (this.yieldTimer[agent] > 0) {
      // Everyone hugs the left, which in left-hand traffic is the outside of the road.
      target = limit;
    } else if (isBike && lane.jam) {
      // Bikes filter between the lanes.
      target = -Math.min(config.jamBikeLateral, limit + 0.5);
    } else if (spec.weave > 0) {
      target = Math.sin(this.time * 0.6 + this.weavePhase[agent]) * spec.weave;
    }
    this.lateral[agent] = moveToward(this.lateral[agent], clamp(target, -limit - 0.5, limit), config.yield.lateralRate * dt);
  }

  private writePose(agent: number, lane: Lane): void {
    const sample = lane.line.sample(this.s[agent], this.sample);
    const lateral = this.lateral[agent];
    this.x[agent] = sample.x + sample.tz * lateral;
    this.y[agent] = sample.y;
    this.z[agent] = sample.z - sample.tx * lateral;
    this.tx[agent] = sample.tx;
    this.tz[agent] = sample.tz;
    this.yaw[agent] = Math.atan2(sample.tx, sample.tz);
  }

  /** Moves vehicles that reached the end of their lane onto the next one. */
  private applyMoves(): void {
    for (const agent of this.moves) {
      const from = this.network.lanes[this.lane[agent]];
      const toId = this.nextLane[agent];
      const to = this.network.lanes[toId];
      const overflow = this.s[agent] - from.line.length;
      const index = from.agents.indexOf(agent);
      if (index >= 0) from.agents.splice(index, 1);
      if (from.isConnector) this.leaveNode(agent, from.node);
      to.agents.push(agent);
      this.lane[agent] = toId;
      this.s[agent] = Math.max(0, overflow);
      if (to.isConnector) this.enterNode(agent, to.node);
      this.nextLane[agent] = to.isConnector ? to.next[0] : this.chooseNext(agent, to);
    }
    this.moves.length = 0;
  }

  private enterNode(agent: number, node: number): void {
    this.nodeAgents[node].push(agent);
    this.network.nodes[node].occupancy++;
  }

  private leaveNode(agent: number, node: number): void {
    const list = this.nodeAgents[node];
    const index = list.indexOf(agent);
    if (index >= 0) {
      list.splice(index, 1);
      this.network.nodes[node].occupancy--;
    }
  }

  /** Picks where to go at the end of a lane, among roads this vehicle may use. */
  private chooseNext(agent: number, lane: Lane): number {
    const allowed = SPECS[this.type[agent]].allowedRoads as readonly RoadKind[];
    const weights = lane.nextWeights.map((weight, i) => (allowed.includes(this.network.lanes[lane.next[i]].kind) ? weight : 0));
    if (weights.every((weight) => weight === 0)) {
      // Nowhere legal to go: carry on, and disappear as soon as nobody is looking.
      this.leaving[agent] = 1;
      return lane.next[Math.floor(this.random() * lane.next.length)];
    }
    return lane.next[weightedPick(weights, this.random())];
  }

  private updateKnocked(dt: number): void {
    const config = CITY.traffic.knock;
    for (let i = this.knocked.length - 1; i >= 0; i--) {
      const agent = this.knocked[i];
      this.knockTimer[agent] += dt;
      const body = this.bodies[agent];
      if (body) {
        const t = body.translation();
        this.x[agent] = t.x;
        this.y[agent] = t.y;
        this.z[agent] = t.z;
      }
      // Crashed vehicles settle with their damping; they never drive away on their own.
      if (this.knockTimer[agent] > config.seconds && body) {
        const v = body.linvel();
        body.setLinvel({ x: v.x * 0.96, y: v.y, z: v.z * 0.96 }, true);
      }
    }
  }

  /** Near vehicles get a real collider, and it follows their lane position. */
  private updateBodies(player: TrafficPlayer): void {
    const config = CITY.traffic;
    const enter = config.bodyRadius * config.bodyRadius;
    const release = config.bodyReleaseRadius * config.bodyReleaseRadius;
    for (let agent = 0; agent < this.capacity; agent++) {
      if (!this.alive[agent]) continue;
      const dx = this.x[agent] - player.x;
      const dz = this.z[agent] - player.z;
      const distanceSquared = dx * dx + dz * dz;
      const body = this.bodies[agent];
      if (body) {
        if (this.mode[agent] === MODE_FOLLOW) {
          if (distanceSquared > release) {
            this.destroyBody(agent);
          } else {
            body.setNextKinematicTranslation({ x: this.x[agent], y: this.y[agent], z: this.z[agent] });
            const half = this.yaw[agent] / 2;
            body.setNextKinematicRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) });
          }
        }
      } else if (distanceSquared < enter && this.bodyCount < this.bodyLimit && this.mode[agent] === MODE_FOLLOW) {
        this.createBody(agent);
      }
    }
  }

  private createBody(agent: number): void {
    const spec = SPECS[this.type[agent]];
    const half = this.yaw[agent] / 2;
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(this.x[agent], this.y[agent], this.z[agent])
        .setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }),
    );
    const collider = RAPIER.ColliderDesc.cuboid(spec.width / 2, spec.height / 2, spec.length / 2)
      .setTranslation(0, spec.height / 2 + 0.05, 0)
      .setMass(spec.mass)
      .setFriction(0.55)
      .setRestitution(0.1)
      .setCollisionGroups(GROUP_TRAFFIC);
    this.physics.world.createCollider(collider, body);
    this.bodies[agent] = body;
    this.bodyCount++;
  }

  private destroyBody(agent: number): void {
    const body = this.bodies[agent];
    if (!body) return;
    this.physics.world.removeRigidBody(body);
    this.bodies[agent] = null;
    this.bodyCount--;
  }

  /** Crashes and near misses. */
  private checkPlayerProximity(player: TrafficPlayer): void {
    const nearMiss = CITY.traffic.nearMiss;
    const radiusSquared = nearMiss.radius * nearMiss.radius;
    const rx = player.fz;
    const rz = -player.fx;
    for (let agent = 0; agent < this.capacity; agent++) {
      if (!this.alive[agent] || this.mode[agent] !== MODE_FOLLOW) continue;
      const dx = this.x[agent] - player.x;
      const dz = this.z[agent] - player.z;
      if (dx * dx + dz * dz > radiusSquared || Math.abs(this.y[agent] - player.y) > 3) {
        this.prevAlong[agent] = dx * player.fx + dz * player.fz;
        continue;
      }
      const along = dx * player.fx + dz * player.fz;
      const side = dx * rx + dz * rz;

      if (this.hitCooldown <= 0 && this.bodies[agent] && this.overlapsPlayer(agent, player)) {
        this.resolveCrash(agent, player);
        this.prevAlong[agent] = along;
        continue;
      }

      const passed = this.prevAlong[agent] > 0 && along <= 0;
      this.prevAlong[agent] = along;
      if (!passed || player.speed < nearMiss.minPlayerSpeed) continue;
      const relative = Math.hypot(player.vx - this.v[agent] * this.tx[agent], player.vz - this.v[agent] * this.tz[agent]);
      if (relative < nearMiss.minRelativeSpeed) continue;
      const clearance = Math.abs(side) - SPECS[this.type[agent]].width / 2 - player.halfWidth;
      if (clearance > nearMiss.clearance || clearance < -0.1) continue;
      this.recordNearMiss(side > 0);
    }
  }

  private recordNearMiss(onLeft: boolean): void {
    const config = CITY.traffic.nearMiss;
    if (onLeft) this.lastMissLeft = this.time;
    else this.lastMissRight = this.time;
    const otherSide = onLeft ? this.lastMissRight : this.lastMissLeft;
    const squeeze = this.time - otherSide < config.squeezeWindow;
    if (!squeeze && this.time - this.lastMissEvent < config.cooldown) return;
    this.lastMissEvent = this.time;
    this.bus.emit('nearMiss', {
      squeeze,
      points: squeeze ? config.squeezePoints : config.points,
      nitro: squeeze ? config.squeezeNitro : config.nitro,
    });
    if (squeeze) {
      // A squeeze uses up both near misses, so the next one starts fresh.
      this.lastMissLeft = -10;
      this.lastMissRight = -10;
    }
  }

  /** Separating-axis test between two rectangles on the ground. */
  private overlapsPlayer(agent: number, player: TrafficPlayer): boolean {
    const spec = SPECS[this.type[agent]];
    const dx = this.x[agent] - player.x;
    const dz = this.z[agent] - player.z;
    const margin = 0.14;
    const ax = this.tx[agent];
    const az = this.tz[agent];
    const axes = [player.fx, player.fz, player.fz, -player.fx, ax, az, az, -ax];
    for (let i = 0; i < 8; i += 2) {
      const nx = axes[i];
      const nz = axes[i + 1];
      const distance = Math.abs(dx * nx + dz * nz);
      const playerExtent = player.halfLength * Math.abs(player.fx * nx + player.fz * nz) + player.halfWidth * Math.abs(player.fz * nx - player.fx * nz);
      const agentExtent = (spec.length / 2) * Math.abs(ax * nx + az * nz) + (spec.width / 2) * Math.abs(az * nx - ax * nz);
      if (distance > playerExtent + agentExtent + margin) return false;
    }
    return true;
  }

  private resolveCrash(agent: number, player: TrafficPlayer): void {
    const config = CITY.traffic.knock;
    const spec = SPECS[this.type[agent]];
    const agentVx = this.v[agent] * this.tx[agent];
    const agentVz = this.v[agent] * this.tz[agent];
    const relX = player.vx - agentVx;
    const relZ = player.vz - agentVz;
    const speed = Math.hypot(relX, relZ);
    this.hitCooldown = 0.25;

    const strength = clamp(speed / 26, 0.15, 1);
    this.bus.emit('trafficHit', { agent, strength, x: this.x[agent], y: this.y[agent] + spec.height / 2, z: this.z[agent], soft: speed < config.softSpeed });

    if (speed < config.softSpeed) {
      this.stopTimer[agent] = config.softStopSeconds;
      return;
    }

    // An inelastic bump between the two masses: a bus stops you, a rickshaw hardly does.
    const nx = relX / speed;
    const nz = relZ / speed;
    const impulse = ((1 + config.restitution) * speed) / (1 / player.mass + 1 / spec.mass);
    let playerVx = player.vx - (impulse / player.mass) * nx;
    let playerVz = player.vz - (impulse / player.mass) * nz;
    let agentOutX = agentVx + (impulse / spec.mass) * nx;
    let agentOutZ = agentVz + (impulse / spec.mass) * nz;

    const agentSpeed = Math.hypot(agentOutX, agentOutZ);
    if (agentSpeed > spec.maxKnockSpeed) {
      agentOutX *= spec.maxKnockSpeed / agentSpeed;
      agentOutZ *= spec.maxKnockSpeed / agentSpeed;
    }
    // Light vehicles never bring the player to a dead stop.
    const playerBefore = Math.hypot(player.vx, player.vz);
    const playerAfter = Math.hypot(playerVx, playerVz);
    const floor = playerBefore * config.playerSpeedFloor * Math.min(1, 1500 / spec.mass);
    if (playerAfter < floor && playerAfter > 0.001) {
      playerVx *= floor / playerAfter;
      playerVz *= floor / playerAfter;
    }
    this.onPlayerVelocity?.(playerVx, playerVz);
    this.knockAgent(agent, agentOutX, agentOutZ);
  }

  private knockAgent(agent: number, vx: number, vz: number): void {
    const body = this.bodies[agent];
    if (!body) return;
    const laneId = this.lane[agent];
    const lane = this.network.lanes[laneId];
    const index = lane.agents.indexOf(agent);
    if (index >= 0) lane.agents.splice(index, 1);
    if (lane.isConnector) this.leaveNode(agent, lane.node);
    this.lane[agent] = -1;
    this.mode[agent] = MODE_KNOCKED;
    this.knockTimer[agent] = 0;
    this.knocked.push(agent);
    body.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    body.setLinearDamping(0.35);
    body.setAngularDamping(1.6);
    body.setLinvel({ x: vx, y: 0.4, z: vz }, true);
    const spin = (this.random() - 0.5) * 2 * CITY.traffic.knock.spin;
    body.setAngvel({ x: 0, y: spin, z: 0 }, true);
  }

  private manageSpawning(dt: number, player: TrafficPlayer, view: TrafficView): void {
    const config = CITY.traffic;
    this.spawnDebt += config.spawnChecksPerSecond * dt;
    while (this.spawnDebt >= 1) {
      this.spawnDebt -= 1;
      if (this.aliveCount < this.capacity * this.density) this.trySpawn(player, view, config.spawnMinRadius);
    }
    this.cleanupTimer -= dt;
    if (this.cleanupTimer > 0) return;
    this.cleanupTimer = 0.4;

    const despawnSquared = config.despawnRadius * config.despawnRadius;
    const knock = config.knock;
    for (let agent = 0; agent < this.capacity; agent++) {
      if (!this.alive[agent]) continue;
      const dx = this.x[agent] - player.x;
      const dz = this.z[agent] - player.z;
      const distanceSquared = dx * dx + dz * dz;
      const hidden = this.isHidden(this.x[agent], this.z[agent], view);
      if (this.mode[agent] === MODE_KNOCKED) {
        const far = distanceSquared > knock.despawnDistance * knock.despawnDistance;
        if (this.knockTimer[agent] > knock.seconds && ((far && hidden) || this.knockTimer[agent] > knock.maxSeconds)) this.despawn(agent);
        continue;
      }
      if (distanceSquared > despawnSquared) {
        this.despawn(agent);
      } else if (hidden && this.aliveCount > this.capacity * this.density && distanceSquared > 50 * 50) {
        this.despawn(agent);
      } else if (hidden && distanceSquared > 60 * 60 && (this.leaving[agent] || this.stuckTime[agent] > config.stuckDespawnTime)) {
        this.despawn(agent);
      }
    }
  }

  private isHidden(x: number, z: number, view: TrafficView): boolean {
    return (x - view.x) * view.fx + (z - view.z) * view.fz < 0;
  }

  private trySpawn(player: TrafficPlayer, view: TrafficView, minRadius: number): boolean {
    const config = CITY.traffic;
    const network = this.network;
    let laneId: number;
    let fraction: number;
    if (network.jamLanes.length > 0 && this.random() < config.jamSpawnShare) {
      laneId = network.jamLanes[Math.floor(this.random() * network.jamLanes.length)];
      fraction = this.random();
    } else {
      const angle = this.random() * Math.PI * 2;
      const radius = minRadius + this.random() * (config.spawnMaxRadius - minRadius);
      const hit = network.nearestRoad(player.x + Math.cos(angle) * radius, player.z + Math.sin(angle) * radius, null, this.hit);
      const edge = network.edges[hit.edge];
      if (this.random() > edge.spec.spawnWeight / this.maxRoadWeight) return false;
      const laneIndex = Math.floor(this.random() * edge.lanes.length);
      laneId = edge.lanes[laneIndex];
      const forward = laneIndex < edge.spec.lanes;
      const along = hit.s / edge.center.length;
      fraction = forward ? along : 1 - along;
    }
    const lane = network.lanes[laneId];
    const s = fraction * lane.line.length;
    // Never appear on top of someone arriving from the junction behind, or right at a stop line.
    if (s < config.spawnClearance || lane.line.length - s < 8) return false;
    lane.line.sample(s, this.sample);
    const x = this.sample.x;
    const z = this.sample.z;
    const distance = Math.hypot(x - player.x, z - player.z);
    if (distance < minRadius || distance > config.despawnRadius - 20) return false;
    if (distance < config.spawnHiddenRadius && !this.isHidden(x, z, view)) return false;
    for (const other of lane.agents) {
      if (Math.abs(this.s[other] - s) < config.spawnClearance) return false;
    }

    const typeIndex = this.pickType(lane.kind);
    if (typeIndex < 0) return false;
    const agent = this.free.pop();
    if (agent === undefined) return false;
    const spec = SPECS[typeIndex];

    this.alive[agent] = 1;
    this.aliveCount++;
    this.type[agent] = typeIndex;
    this.variant[agent] = this.random() < 0.5 ? 0 : 1;
    this.tint[agent] = spec.tints[Math.floor(this.random() * spec.tints.length)];
    this.mode[agent] = MODE_FOLLOW;
    this.lane[agent] = laneId;
    this.s[agent] = s;
    this.desired[agent] = spec.speedMin + this.random() * (spec.speedMax - spec.speedMin);
    this.v[agent] = this.desired[agent] * 0.7;
    this.lateral[agent] = 0;
    this.yieldTimer[agent] = 0;
    this.stopTimer[agent] = 0;
    this.stuckTime[agent] = 0;
    this.knockTimer[agent] = 0;
    this.weavePhase[agent] = this.random() * Math.PI * 2;
    this.leaving[agent] = 0;
    this.prevAlong[agent] = 0;
    // A new vehicle can appear mid-lane, so it goes in at its place in driving order.
    let position = lane.agents.length;
    while (position > 0 && this.s[lane.agents[position - 1]] < s) position--;
    lane.agents.splice(position, 0, agent);
    this.nextLane[agent] = this.chooseNext(agent, lane);
    this.writePose(agent, lane);
    return true;
  }

  private pickType(kind: RoadKind): number {
    const weights = SPECS.map((spec) => spec.share[kind] ?? 0);
    if (weights.every((weight) => weight === 0)) return -1;
    return weightedPick(weights, this.random());
  }

  private despawn(agent: number): void {
    this.destroyBody(agent);
    const laneId = this.lane[agent];
    if (laneId >= 0) {
      const lane = this.network.lanes[laneId];
      const index = lane.agents.indexOf(agent);
      if (index >= 0) lane.agents.splice(index, 1);
      if (lane.isConnector) this.leaveNode(agent, lane.node);
    }
    const knockedIndex = this.knocked.indexOf(agent);
    if (knockedIndex >= 0) this.knocked.splice(knockedIndex, 1);
    this.lane[agent] = -1;
    this.alive[agent] = 0;
    this.mode[agent] = MODE_FOLLOW;
    this.aliveCount--;
    this.free.push(agent);
  }

  /** Horn tap: vehicles ahead of the player pull over and slow down. */
  hornYield(player: TrafficPlayer): HornResponse {
    const config = CITY.traffic.yield;
    let count = 0;
    let sample = -1;
    let sampleDistance = Infinity;
    for (let agent = 0; agent < this.capacity; agent++) {
      if (!this.alive[agent] || this.mode[agent] !== MODE_FOLLOW) continue;
      const dx = this.x[agent] - player.x;
      const dz = this.z[agent] - player.z;
      const distance = Math.hypot(dx, dz);
      if (distance > config.radius || Math.abs(this.y[agent] - player.y) > 3) continue;
      const facing = (dx * player.fx + dz * player.fz) / Math.max(distance, 0.1);
      if (facing < config.forwardCone) continue;
      this.yieldTimer[agent] = config.seconds;
      count++;
      if (distance < sampleDistance) {
        sampleDistance = distance;
        sample = agent;
      }
    }
    return { count, sample };
  }

  /** A siren behind you: pull over and slow down. */
  sirenYield(x: number, y: number, z: number, fx: number, fz: number, radius: number): void {
    for (let agent = 0; agent < this.capacity; agent++) {
      if (!this.alive[agent] || this.mode[agent] !== MODE_FOLLOW) continue;
      const dx = this.x[agent] - x;
      const dz = this.z[agent] - z;
      if (Math.abs(dx) > radius || Math.abs(dz) > radius || Math.abs(this.y[agent] - y) > 3) continue;
      if (dx * fx + dz * fz < 0) continue;
      if (this.yieldTimer[agent] < 1) this.yieldTimer[agent] = 1.5;
    }
  }

  /** Removes all traffic near a stretch of road ahead of a closed race, wherever it is seen from. */
  clearAround(x: number, z: number, radius: number): void {
    for (let agent = 0; agent < this.capacity; agent++) {
      if (!this.alive[agent]) continue;
      if (Math.hypot(this.x[agent] - x, this.z[agent] - z) < radius) this.despawn(agent);
    }
  }

  /** The vehicles nearest to a point, for honking back and for ambient sound. */
  nearestAgents(x: number, z: number, radius: number, max: number, out: number[]): number[] {
    out.length = 0;
    const radiusSquared = radius * radius;
    for (let agent = 0; agent < this.capacity && out.length < max; agent++) {
      if (!this.alive[agent] || this.mode[agent] !== MODE_FOLLOW) continue;
      const dx = this.x[agent] - x;
      const dz = this.z[agent] - z;
      if (dx * dx + dz * dz < radiusSquared) out.push(agent);
    }
    return out;
  }

  /** Body pose of a crashed vehicle, for drawing it tumbled. */
  knockedBody(agent: number): RAPIER.RigidBody | null {
    return this.mode[agent] === MODE_KNOCKED ? this.bodies[agent] : null;
  }

  get activeBodies(): number {
    return this.bodyCount;
  }

  /** Clears every vehicle, for a restart. */
  clear(): void {
    for (let agent = 0; agent < this.capacity; agent++) {
      if (this.alive[agent]) this.despawn(agent);
    }
  }

  /** Test helper: bumper gaps on one lane, front to back. */
  laneGaps(laneId: number): number[] {
    const list = this.network.lanes[laneId].agents;
    const gaps: number[] = [];
    for (let i = 1; i < list.length; i++) {
      const front = list[i - 1];
      const back = list[i];
      gaps.push(this.s[front] - this.s[back] - (SPECS[this.type[front]].length + SPECS[this.type[back]].length) / 2);
    }
    return gaps;
  }

  /** Test helper: how far along its lane a vehicle is. */
  agentLane(agent: number): { lane: number; s: number } {
    return { lane: this.lane[agent], s: this.s[agent] };
  }
}
