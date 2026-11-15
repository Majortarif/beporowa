/**
 * বিশেষ ধাওয়া ইউনিট: patrols, pursuits, tactics, roadblocks, spike strips and air support.
 * Police cars use the same physics and controls as the player, so a chase is a fair fight:
 * a box-in is real cars blocking you, and a PIT is a real shove.
 * No rendering here, so whole pursuits can run in headless tests.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { POLICE } from '../config/police-tuning';
import { TUNING, type QualityPreset } from '../config/tuning';
import type { EventBus, RadioCategory } from '../core/events';
import { clamp, createRng } from '../core/math';
import { createSample } from '../core/polyline';
import { GROUP_TRAFFIC, GROUP_WHEEL_RAY, type PhysicsWorld } from '../physics/physics-world';
import type { TrafficSystem } from '../traffic/traffic-system';
import { VehicleController, type SpawnPose } from '../vehicle/vehicle-controller';
import { createRoadHit, type RoadEdge, type RoadNetwork } from '../world/city/road-network';
import { AirUnit } from './air-support';
import { AdaptiveDifficulty, HeatSystem } from './heat-system';
import { PoliceDriver } from './police-driver';

export type PoliceRole = 'roam' | 'chase' | 'front' | 'flankLeft' | 'flankRight' | 'pit' | 'ram' | 'search';

/** The player as the police see it. y is the road height under the car. */
export interface PoliceTarget {
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  fx: number;
  fz: number;
  speed: number;
  car: VehicleController;
}

export interface PoliceView {
  x: number;
  z: number;
  fx: number;
  fz: number;
}

export interface HideResult {
  /** How much faster the cooldown fills. 1 means not hiding. */
  factor: number;
  kind: 'none' | 'alley' | 'tea' | 'garage' | 'flyover';
  /** The car is hard to spot from the road. */
  concealed: boolean;
  /** A roof hides the car from the air. */
  coveredFromAir: boolean;
}

export type HideQuery = (x: number, y: number, z: number, speedKmh: number) => HideResult;

const NOT_HIDING: HideResult = { factor: 1, kind: 'none', concealed: false, coveredFromAir: false };

export class PoliceUnit {
  readonly car: VehicleController;
  readonly driver: PoliceDriver;
  active = false;
  role: PoliceRole = 'roam';
  distance = 0;
  /** A clear line to the player, whatever the range. */
  lineOfSight = false;
  sees = false;
  stunSeconds = 0;
  confusedSeconds = 0;
  routeTimer = 0;
  avoidTimer = 0;
  avoidSide = 0;
  avoidSlow = 1;
  pitCooldown = 0;
  ramCooldown = 0;
  dropCooldown = 0;
  /** Spreads units across the road. */
  laneOffset = 0;
  /** For interpolated drawing. */
  prevX = 0;
  prevY = 0;
  prevZ = 0;
  prevQx = 0;
  prevQy = 0;
  prevQz = 0;
  prevQw = 1;
  currX = 0;
  currY = 0;
  currZ = 0;
  currQx = 0;
  currQy = 0;
  currQz = 0;
  currQw = 1;
  /** The tint of its heat level. */
  tint = 0xf1f0ea;

  constructor(physics: PhysicsWorld, parkedAt: SpawnPose) {
    this.car = new VehicleController(physics, parkedAt, undefined, { powerScale: 1, topSpeedScale: 1, gripScale: 1 });
    this.driver = new PoliceDriver(physics, this.car);
    this.car.setEnabled(false);
  }
}

export interface ParkedCar {
  body: RAPIER.RigidBody;
  active: boolean;
}

export interface Roadblock {
  cars: number[];
  strip: number;
  x: number;
  z: number;
  age: number;
}

export interface SpikeStrip {
  active: boolean;
  x: number;
  y: number;
  z: number;
  yaw: number;
  halfLength: number;
  age: number;
}

const FAR_AWAY: SpawnPose = { position: { x: 0, y: -400, z: 0 }, yaw: 0 };

export class PoliceSystem {
  readonly heat: HeatSystem;
  readonly adaptive: AdaptiveDifficulty;
  readonly units: PoliceUnit[] = [];
  readonly parked: ParkedCar[] = [];
  readonly strips: SpikeStrip[] = [];
  readonly drone = new AirUnit();
  readonly helicopter = new AirUnit();
  /** How much a better player car makes the police bring better cars too. */
  carScale = 1;
  /** Enabled once the player is driving. */
  enabled = false;
  /** Rain, fog and a blackout all shorten how far the police can see. */
  sightScale = 1;
  /** Last result of the hiding-spot check, for the HUD. */
  hide: HideResult = NOT_HIDING;

  private readonly roadblocks: Roadblock[] = [];
  private readonly random = createRng(2718);
  private readonly hit = createRoadHit();
  private readonly hitB = createRoadHit();
  private readonly sample = createSample();
  private readonly ray: RAPIER.Ray;
  private readonly closedNodes: Set<number>;
  private readonly obstacleScratch = new Float32Array(64);

  private time = 0;
  private perceptionTimer = 0;
  private tacticsTimer = 0;
  private spawnTimer = 0;
  private sirenTimer = 0;
  private roadblockTimer: number = POLICE.roadblock.everySeconds / 2;
  private droneTimer = 4;
  private confuseCooldown = 0;
  private spikeHitCooldown = 0;
  private seen = false;
  private lastKnownX = 0;
  private lastKnownY = 0;
  private lastKnownZ = 0;

  constructor(
    private readonly network: RoadNetwork,
    private readonly physics: PhysicsWorld,
    private readonly bus: EventBus,
    preset: Pick<QualityPreset, 'policeUnits' | 'policeParked'>,
    private readonly traffic: TrafficSystem | null,
    private readonly hideQuery: HideQuery | null,
    adaptiveStart?: number,
  ) {
    this.heat = new HeatSystem(bus);
    this.adaptive = new AdaptiveDifficulty(adaptiveStart);
    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
    this.closedNodes = new Set(network.nodes.filter((node) => node.closedSign).map((node) => node.index));

    for (let i = 0; i < preset.policeUnits; i++) this.units.push(new PoliceUnit(physics, FAR_AWAY));
    for (let i = 0; i < preset.policeParked; i++) this.parked.push(this.createParked());
    for (let i = 0; i < POLICE.spikes.maxStrips; i++) {
      this.strips.push({ active: false, x: 0, y: 0, z: 0, yaw: 0, halfLength: 1, age: 0 });
    }

    bus.on('heatLevel', ({ stars, previous }) => this.onHeatLevel(stars, previous));
    bus.on('pursuitPhase', ({ phase, previous }) => this.onPhase(phase, previous));
    bus.on('pursuitEscaped', ({ seconds }) => {
      this.adaptive.onEscaped(seconds);
      this.radio('escape');
      this.endPursuit();
    });
    bus.on('pursuitBusted', () => {
      this.adaptive.onBusted();
      this.radio('bust');
      this.endPursuit();
    });
    bus.on('trafficHit', ({ x, z, soft }) => {
      if (soft) return;
      if (this.heat.isActive) this.heat.addHeat(POLICE.heat.trafficCrash);
      else this.reportOffense(x, z, POLICE.offense.crashRadius);
    });
    bus.on('nearMiss', () => {
      if (this.heat.isActive) this.heat.addHeat(POLICE.heat.nearMiss);
    });
  }

  private radio(category: RadioCategory): void {
    this.bus.emit('policeRadio', { category });
  }

  private createParked(): ParkedCar {
    const body = this.physics.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(0, -400, 0).setLinearDamping(0.9).setAngularDamping(1.8).setEnabled(false),
    );
    const collider = RAPIER.ColliderDesc.cuboid(0.88, 0.62, 2)
      .setTranslation(0, 0.1, 0)
      .setMass(POLICE.roadblock.carMass)
      .setFriction(0.8)
      .setRestitution(0.1)
      .setCollisionGroups(GROUP_TRAFFIC);
    this.physics.world.createCollider(collider, body);
    return { body, active: false };
  }

  // ---------- Events ----------

  private onHeatLevel(stars: number, previous: number): void {
    if (previous === 0) {
      this.radio('pursuitStart');
    } else {
      this.radio(stars >= POLICE.levels.length ? 'chief' : 'heatUp');
    }
    this.applyLevelToUnits();
  }

  private onPhase(phase: string, previous: string): void {
    if (phase === 'evading') this.radio('lost');
    else if (phase === 'pursuit' && previous === 'evading') this.radio('found');
  }

  private applyLevelToUnits(): void {
    const stars = Math.max(1, this.heat.stars);
    const level = POLICE.levels[stars - 1];
    for (const unit of this.units) {
      const profile = unit.car.profile;
      profile.topSpeedScale = level.speedScale * this.adaptive.speedScale * this.carScale;
      profile.powerScale = level.powerScale * this.adaptive.speedScale * this.carScale;
      unit.tint = level.tint;
    }
  }

  /** Something illegal happened here. Any patrol that can see it starts a pursuit. */
  private reportOffense(x: number, z: number, radius: number): void {
    if (!this.enabled || this.heat.isActive) return;
    for (const unit of this.units) {
      if (!unit.active) continue;
      if (Math.hypot(unit.currX - x, unit.currZ - z) < radius && unit.lineOfSight) {
        this.heat.startPursuit();
        return;
      }
    }
  }

  private endPursuit(): void {
    this.removeRoadblocks();
    for (const strip of this.strips) strip.active = false;
    this.drone.stop();
    this.helicopter.stop();
    this.droneTimer = 4;
    this.roadblockTimer = POLICE.roadblock.everySeconds / 2;
    let kept = 0;
    for (const unit of this.units) {
      if (!unit.active) continue;
      unit.role = 'roam';
      unit.driver.route = [];
      if (++kept > POLICE.units.patrols) this.parkUnit(unit);
    }
    this.applyLevelToUnits();
  }

  /** Clears the streets, for a restart. */
  clear(): void {
    this.heat.reset();
    this.removeRoadblocks();
    for (const strip of this.strips) strip.active = false;
    this.drone.stop();
    this.helicopter.stop();
    for (const unit of this.units) this.parkUnit(unit);
    this.spawnTimer = 2;
    this.droneTimer = 4;
    this.roadblockTimer = POLICE.roadblock.everySeconds / 2;
  }

  private parkUnit(unit: PoliceUnit): void {
    unit.active = false;
    unit.car.reset(FAR_AWAY);
    unit.car.setEnabled(false);
    unit.driver.reset();
    unit.stunSeconds = 0;
    unit.confusedSeconds = 0;
  }

  // ---------- Steps ----------

  /** Before the physics step: decide, then drive. */
  preStep(dt: number, player: PoliceTarget, view: PoliceView): void {
    if (!this.enabled) return;
    this.time += dt;
    this.confuseCooldown -= dt;
    this.spikeHitCooldown -= dt;

    this.manageUnits(dt, player, view);
    this.perceive(dt, player);
    this.updateTactics(dt, player);
    this.updateSirenYield(dt);
    for (const unit of this.units) {
      if (unit.active) this.driveUnit(unit, dt, player);
    }
    this.publishObstacles();
  }

  /** After the physics step: read results, and apply the rules of the chase. */
  postStep(dt: number, player: PoliceTarget, view: PoliceView): void {
    if (!this.enabled) return;
    this.readTransforms();
    this.checkContacts(player);
    this.checkSpikes(player);
    this.updateRoadblocks(dt, player, view);
    this.updateStrips(dt);
    this.updateAir(dt, player);

    let close = 0;
    const bust = POLICE.bust;
    for (const unit of this.units) {
      if (unit.active && unit.distance < bust.radius && Math.abs(unit.currY - 0.65 - player.y) < 3 && unit.stunSeconds <= 0) close++;
    }
    this.heat.bustTimeScale = this.adaptive.bustTimeScale;
    this.heat.update(dt, { seen: this.seen, hideFactor: this.hide.factor, unitsClose: close, speed: player.speed });
  }

  private readTransforms(): void {
    for (const unit of this.units) {
      if (!unit.active) continue;
      const t = unit.car.body.translation();
      const r = unit.car.body.rotation();
      unit.prevX = unit.currX;
      unit.prevY = unit.currY;
      unit.prevZ = unit.currZ;
      unit.prevQx = unit.currQx;
      unit.prevQy = unit.currQy;
      unit.prevQz = unit.currQz;
      unit.prevQw = unit.currQw;
      unit.currX = t.x;
      unit.currY = t.y;
      unit.currZ = t.z;
      unit.currQx = r.x;
      unit.currQy = r.y;
      unit.currQz = r.z;
      unit.currQw = r.w;
    }
  }

  // ---------- Spawning ----------

  private desiredUnits(): number {
    const limit = this.units.length;
    if (!this.heat.isActive) return Math.min(POLICE.units.patrols, limit);
    return this.adaptive.unitsFor(this.heat.stars, limit);
  }

  private manageUnits(dt: number, player: PoliceTarget, view: PoliceView): void {
    const config = POLICE.units;
    let activeCount = 0;
    for (const unit of this.units) {
      if (!unit.active) continue;
      activeCount++;
      unit.distance = Math.hypot(unit.currX - player.x, unit.currZ - player.z);
      if (unit.distance > config.respawnDistance && this.isHidden(unit.currX, unit.currZ, view)) {
        const pose = this.findSpawnPose(player, view);
        if (pose) this.placeUnit(unit, pose);
      } else if (unit.currY < -5 || unit.car.telemetry.upY < 0.2) {
        // Off the map or on its roof: replace it, out of sight.
        const pose = this.findSpawnPose(player, view);
        if (pose) this.placeUnit(unit, pose);
      }
    }
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || activeCount >= this.desiredUnits()) return;
    this.spawnTimer = config.spawnEverySeconds;
    const free = this.units.find((unit) => !unit.active);
    if (!free) return;
    const pose = this.findSpawnPose(player, view);
    if (!pose) return;
    free.active = true;
    free.car.setEnabled(true);
    free.role = this.heat.isActive ? 'chase' : 'roam';
    free.laneOffset = (this.random() - 0.5) * 2.4;
    free.driver.reset();
    this.placeUnit(free, pose);
    this.applyLevelToUnits();
  }

  private placeUnit(unit: PoliceUnit, pose: SpawnPose): void {
    unit.car.reset(pose);
    unit.driver.reset();
    unit.stunSeconds = 0;
    unit.confusedSeconds = 0;
    unit.routeTimer = 0;
    const half = pose.yaw / 2;
    unit.currX = unit.prevX = pose.position.x;
    unit.currY = unit.prevY = pose.position.y;
    unit.currZ = unit.prevZ = pose.position.z;
    unit.currQx = unit.prevQx = 0;
    unit.currQy = unit.prevQy = Math.sin(half);
    unit.currQz = unit.prevQz = 0;
    unit.currQw = unit.prevQw = Math.cos(half);
    unit.distance = 9999;
  }

  private isHidden(x: number, z: number, view: PoliceView): boolean {
    return (x - view.x) * view.fx + (z - view.z) * view.fz < 0;
  }

  /** A road point out of sight, facing roughly toward the player. */
  private findSpawnPose(player: PoliceTarget, view: PoliceView): SpawnPose | null {
    const config = POLICE.units;
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = this.random() * Math.PI * 2;
      const radius = config.spawnMinRadius + this.random() * (config.spawnMaxRadius - config.spawnMinRadius);
      const hit = this.network.nearestRoad(player.x + Math.cos(angle) * radius, player.z + Math.sin(angle) * radius, player.y, this.hit);
      const distance = Math.hypot(hit.x - player.x, hit.z - player.z);
      if (distance < config.spawnMinRadius * 0.8) continue;
      if (distance < config.hiddenRadius && !this.isHidden(hit.x, hit.z, view)) continue;
      if (this.closedNodes.has(this.network.edges[hit.edge].a) && hit.s < 12) continue;
      let crowded = false;
      for (const unit of this.units) {
        if (unit.active && Math.hypot(unit.currX - hit.x, unit.currZ - hit.z) < 18) crowded = true;
      }
      if (crowded) continue;
      const toward = (player.x - hit.x) * hit.tx + (player.z - hit.z) * hit.tz >= 0 ? 1 : -1;
      return {
        position: { x: hit.x, y: hit.y + 0.8, z: hit.z },
        yaw: Math.atan2(hit.tx * toward, hit.tz * toward),
      };
    }
    return null;
  }

  // ---------- Seeing ----------

  private hasClearLine(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ignore: RAPIER.RigidBody | undefined): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const length = Math.hypot(dx, dy, dz);
    if (length < 0.5) return true;
    const ray = this.ray;
    ray.origin.x = ax;
    ray.origin.y = ay;
    ray.origin.z = az;
    ray.dir.x = dx / length;
    ray.dir.y = dy / length;
    ray.dir.z = dz / length;
    return this.physics.world.castRay(ray, length, true, undefined, GROUP_WHEEL_RAY, undefined, ignore) === null;
  }

  private perceive(dt: number, player: PoliceTarget): void {
    this.perceptionTimer -= dt;
    if (this.perceptionTimer > 0) return;
    this.perceptionTimer = POLICE.perception.checkSeconds;
    const config = POLICE.perception;

    this.hide = this.hideQuery ? this.hideQuery(player.x, player.y, player.z, player.speed * 3.6) : NOT_HIDING;
    const range = (this.hide.concealed ? config.hiddenSightRange : config.sightRange) * this.sightScale;
    const playerEyeY = player.y + 1;
    let anySees = false;

    for (const unit of this.units) {
      if (!unit.active) continue;
      unit.lineOfSight = unit.distance < config.sightRange * 1.4 && this.hasClearLine(unit.currX, unit.currY + 0.4, unit.currZ, player.x, playerEyeY, player.z, unit.car.body);
      unit.sees = unit.lineOfSight && unit.distance < range && unit.stunSeconds <= 0 && unit.confusedSeconds <= 0;
      if (unit.sees) anySees = true;
    }

    for (const air of [this.drone, this.helicopter]) {
      if (!air.active) continue;
      const clear = !this.hide.coveredFromAir && this.hasClearLine(air.x, air.y, air.z, player.x, playerEyeY, player.z, undefined);
      const inRange = Math.hypot(air.x - player.x, air.z - player.z) < (air === this.drone ? POLICE.drone.sightRange : POLICE.helicopter.sightRange);
      air.sees = clear && inRange;
      if (air.sees) anySees = true;
    }

    this.seen = anySees;
    if (anySees) {
      this.lastKnownX = player.x;
      this.lastKnownY = player.y;
      this.lastKnownZ = player.z;
    }

    // Calm city: a patrol that watches you speed starts it all.
    if (!this.heat.isActive) {
      const offense = POLICE.offense;
      if (player.speed * 3.6 > offense.speedingKmh) this.reportOffense(player.x, player.z, offense.speedingRadius);
    }
  }

  // ---------- Tactics ----------

  private updateTactics(dt: number, player: PoliceTarget): void {
    this.tacticsTimer -= dt;
    if (this.tacticsTimer > 0) return;
    this.tacticsTimer = POLICE.units.tacticsEverySeconds;
    const heat = this.heat;
    if (!heat.isActive) return;

    const active = this.units.filter((unit) => unit.active);
    if (heat.phase === 'evading') {
      for (const unit of active) {
        if (unit.role !== 'search') {
          unit.role = 'search';
          unit.routeTimer = 0;
        }
      }
      return;
    }

    const config = POLICE.tactics;
    const stars = heat.stars;
    // Units close to the player get jobs. Far ones just chase.
    const along = (unit: PoliceUnit): number => (unit.currX - player.x) * player.fx + (unit.currZ - player.z) * player.fz;
    const near = active.filter((unit) => unit.distance < 140).sort((a, b) => along(b) - along(a));
    for (const unit of active) unit.role = 'chase';

    let index = 0;
    if (stars >= config.boxInFromStars && near.length >= 2) {
      near[index++].role = 'front';
      if (index < near.length) near[index++].role = 'flankLeft';
      if (stars >= 3 && index < near.length) near[index++].role = 'flankRight';
      if (near.length >= 3) this.radio('boxIn');
    }
    // The rearmost units push: a PIT first, then rams.
    for (let i = near.length - 1; i >= index; i--) {
      if (stars >= config.pitFromStars && i === near.length - 1) near[i].role = 'pit';
      else if (stars >= config.ramFromStars) near[i].role = 'ram';
    }
  }

  private updateSirenYield(dt: number): void {
    const traffic = this.traffic;
    if (!traffic || !this.heat.isActive) return;
    this.sirenTimer -= dt;
    if (this.sirenTimer > 0) return;
    this.sirenTimer = POLICE.units.sirenYieldEverySeconds;
    for (const unit of this.units) {
      if (!unit.active || unit.distance > 220) continue;
      const q = unit.car.quaternion;
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      traffic.sirenYield(unit.currX, unit.currY, unit.currZ, fx, fz, POLICE.units.sirenYieldRadius);
    }
  }

  private publishObstacles(): void {
    const traffic = this.traffic;
    if (!traffic) return;
    let count = 0;
    const out = traffic.externalObstacles;
    for (const unit of this.units) {
      if (!unit.active) continue;
      out[count * 3] = unit.currX;
      out[count * 3 + 1] = unit.currY - 0.65;
      out[count * 3 + 2] = unit.currZ;
      count++;
    }
    for (const car of this.parked) {
      if (!car.active || count >= out.length / 3) continue;
      const t = car.body.translation();
      out[count * 3] = t.x;
      out[count * 3 + 1] = t.y - 0.7;
      out[count * 3 + 2] = t.z;
      count++;
    }
    traffic.externalObstacleCount = count;
  }

  // ---------- Driving ----------

  private driveUnit(unit: PoliceUnit, dt: number, player: PoliceTarget): void {
    const driver = unit.driver;
    unit.pitCooldown -= dt;
    unit.ramCooldown -= dt;
    unit.dropCooldown -= dt;
    this.updateAvoidance(unit, dt);

    if (unit.stunSeconds > 0) {
      unit.stunSeconds -= dt;
      driver.hold();
    } else if (unit.confusedSeconds > 0) {
      unit.confusedSeconds -= dt;
      // Honked at from every side: it drifts on, not sure where to go.
      const position = unit.car.position;
      const q = unit.car.quaternion;
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const wander = Math.sin(this.time * 1.7 + unit.laneOffset * 9) * 8;
      driver.driveToward(dt, position.x + fx * 24 + fz * wander, position.z + fz * 24 - fx * wander, 12, unit.avoidSide, unit.avoidSlow, false);
    } else if (unit.role === 'roam') {
      this.driveRoam(unit, dt);
    } else if (unit.role === 'search') {
      this.driveSearch(unit, dt);
    } else {
      this.drivePursuit(unit, dt, player);
    }
    unit.car.update(dt, driver.intent);
  }

  private driveRoam(unit: PoliceUnit, dt: number): void {
    const followed = unit.driver.followRoute(dt, POLICE.units.roamSpeed, unit.avoidSide, unit.avoidSlow, false);
    if (!followed) {
      const nodes = this.network.nodes;
      let target = Math.floor(this.random() * nodes.length);
      while (this.closedNodes.has(target)) target = Math.floor(this.random() * nodes.length);
      this.buildRoute(unit, nodes[target].x, nodes[target].y, nodes[target].z, true);
      unit.driver.followRoute(dt, POLICE.units.roamSpeed, unit.avoidSide, unit.avoidSlow, false);
    }
  }

  private driveSearch(unit: PoliceUnit, dt: number): void {
    unit.routeTimer -= dt;
    const speed = 22;
    if (unit.routeTimer <= 0 || !unit.driver.followRoute(dt, speed, unit.avoidSide, unit.avoidSlow, false)) {
      unit.routeTimer = 5;
      // Fan out around where the car was last seen.
      const angle = this.random() * Math.PI * 2;
      const radius = 30 + this.random() * 110;
      const hit = this.network.nearestRoad(this.lastKnownX + Math.cos(angle) * radius, this.lastKnownZ + Math.sin(angle) * radius, this.lastKnownY, this.hit);
      this.buildRoute(unit, hit.x, hit.y, hit.z, false);
      unit.driver.followRoute(dt, speed, unit.avoidSide, unit.avoidSlow, false);
    }
  }

  private drivePursuit(unit: PoliceUnit, dt: number, player: PoliceTarget): void {
    const units = POLICE.units;
    const config = POLICE.tactics;
    const heightOk = Math.abs(unit.currY - 0.65 - player.y) < 2.6;
    const maxSpeed = (TUNING.vehicle.engine.topSpeedKmh / 3.6) * unit.car.profile.topSpeedScale;
    const profile = unit.car.profile;
    const level = POLICE.levels[Math.max(1, this.heat.stars) - 1];
    // A unit left far behind gets a bit more engine, so the chase stays a chase.
    profile.powerScale = level.powerScale * this.adaptive.speedScale * this.carScale * (unit.distance > units.rubberBandDistance ? units.rubberBandPower : 1);

    if (unit.lineOfSight && heightOk && unit.distance < units.directRange) {
      this.driveSlot(unit, dt, player, maxSpeed, config);
      return;
    }
    // Out of sight or on another level: use the roads, ramps included.
    unit.routeTimer -= dt;
    if (unit.routeTimer <= 0 || unit.driver.route.length === 0) {
      unit.routeTimer = units.routeEverySeconds;
      this.buildRoute(unit, player.x, player.y, player.z, false);
    }
    const nitro = unit.distance > 120 && this.heat.stars >= 3;
    if (!unit.driver.followRoute(dt, maxSpeed, unit.avoidSide, unit.avoidSlow, nitro)) {
      unit.driver.driveToward(dt, player.x, player.z, maxSpeed, unit.avoidSide, unit.avoidSlow, false);
    }
  }

  /** In plain sight: drive to this unit's slot around the player. */
  private driveSlot(unit: PoliceUnit, dt: number, player: PoliceTarget, maxSpeed: number, config: typeof POLICE.tactics): void {
    const { x, z, fx, fz, vx, vz, speed } = player;
    // Left of the player is (fz, -fx).
    const leftX = fz;
    const leftZ = -fx;
    const along = (unit.currX - x) * fx + (unit.currZ - z) * fz;
    let targetX = x + vx * config.predictSeconds;
    let targetZ = z + vz * config.predictSeconds;
    let wanted = maxSpeed;
    let nitro = false;

    // The car has all but stopped: everyone pulls up around it, instead of shoving it down the road.
    if (speed < POLICE.bust.speed * 1.4 && unit.distance < 32) {
      const ring = config.arrestRing;
      const toUnit = Math.max(unit.distance, 0.1);
      unit.driver.driveToward(
        dt,
        x + ((unit.currX - x) / toUnit) * ring,
        z + ((unit.currZ - z) / toUnit) * ring,
        clamp((unit.distance - ring) * 0.9, 0, 14),
        unit.avoidSide,
        unit.avoidSlow,
        false,
      );
      return;
    }

    switch (unit.role) {
      case 'front': {
        const ahead = config.frontSlotBase + speed * config.frontSlotPerSpeed;
        targetX = x + fx * ahead;
        targetZ = z + fz * ahead;
        // Get ahead, then slow down in the player's way.
        wanted = along > ahead * 0.7 ? Math.max(4, speed * 0.72) : maxSpeed;
        nitro = along < 0;
        break;
      }
      case 'flankLeft':
      case 'flankRight': {
        const side = unit.role === 'flankLeft' ? 1 : -1;
        targetX = x + leftX * config.flankSide * side + fx * config.flankAhead + vx * 0.3;
        targetZ = z + leftZ * config.flankSide * side + fz * config.flankAhead + vz * 0.3;
        wanted = clamp(speed + (config.flankAhead - along) * 1.2, 3, maxSpeed);
        break;
      }
      case 'pit': {
        // Line up on a rear corner, then steer into it.
        const side = (unit.currX - x) * leftX + (unit.currZ - z) * leftZ >= 0 ? 1 : -1;
        const closing = unit.distance < 7;
        const offset = closing ? config.pitSide * 0.5 : config.pitSide;
        const behind = closing ? config.pitBehind * 0.5 : config.pitBehind;
        targetX = x - fx * behind + leftX * offset * side + vx * 0.15;
        targetZ = z - fz * behind + leftZ * offset * side + vz * 0.15;
        wanted = clamp(speed + (unit.distance - 2) * 1.4, 4, maxSpeed);
        if (unit.distance < 14 && unit.pitCooldown <= 0) this.radio('pit');
        break;
      }
      case 'ram':
        nitro = unit.distance > 12;
        break;
      default:
        // Plain chase: sits on the bumper at the player's speed, rather than running it over.
        if (unit.distance < 50) wanted = clamp(speed + (unit.distance - config.rearDistance) * 1.1, 0, maxSpeed);
        break;
    }
    unit.driver.driveToward(dt, targetX, targetZ, wanted, unit.avoidSide, unit.avoidSlow, nitro);
  }

  /** Steers around vehicles in the way. Checked a few times a second. */
  private updateAvoidance(unit: PoliceUnit, dt: number): void {
    unit.avoidTimer -= dt;
    if (unit.avoidTimer > 0) return;
    unit.avoidTimer = 0.1;
    unit.avoidSide = 0;
    unit.avoidSlow = 1;
    const traffic = this.traffic;
    if (!traffic) return;
    const config = POLICE.driver;
    const q = unit.car.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    let nearest = config.avoidRadius;
    for (let agent = 0; agent < traffic.capacity; agent++) {
      if (!traffic.alive[agent]) continue;
      const dx = traffic.x[agent] - unit.currX;
      const dz = traffic.z[agent] - unit.currZ;
      if (Math.abs(dx) > config.avoidRadius || Math.abs(dz) > config.avoidRadius) continue;
      const along = dx * fx + dz * fz;
      if (along < 1 || along >= nearest) continue;
      const side = dx * fz - dz * fx;
      if (Math.abs(side) > config.avoidLateral) continue;
      nearest = along;
      // Positive side means it is on the left, so steer right.
      unit.avoidSide = side >= 0 ? 1 : -1;
      unit.avoidSlow = clamp(0.45 + (along / config.avoidRadius) * 0.55, 0.45, 1);
    }
    // Their own roadblocks and each other are in the way too, though no ray can see them.
    const others = this.obstacleScratch;
    let count = 0;
    for (const other of this.units) {
      if (!other.active || other === unit) continue;
      others[count++] = other.currX;
      others[count++] = other.currZ;
    }
    for (const car of this.parked) {
      if (!car.active) continue;
      const t = car.body.translation();
      others[count++] = t.x;
      others[count++] = t.z;
    }
    for (let i = 0; i < count; i += 2) {
      const dx = others[i] - unit.currX;
      const dz = others[i + 1] - unit.currZ;
      const along = dx * fx + dz * fz;
      if (along < 1 || along >= Math.min(nearest, 16)) continue;
      const side = dx * fz - dz * fx;
      if (Math.abs(side) > config.avoidLateral) continue;
      nearest = along;
      unit.avoidSide = side >= 0 ? 1 : -1;
      unit.avoidSlow = clamp(0.5 + (along / 16) * 0.5, 0.5, 1);
    }
  }

  /** Builds a road route from the unit to a point, over the road graph. */
  private buildRoute(unit: PoliceUnit, tx: number, ty: number, tz: number, keepLeft: boolean): void {
    const network = this.network;
    const fromY = unit.currY - 0.65;
    const from = network.nearestRoad(unit.currX, unit.currZ, fromY, this.hit);
    const fromEdge = network.edges[from.edge];
    const q = unit.car.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const goesForward = from.tx * fx + from.tz * fz >= 0;

    const to = network.nearestRoad(tx, tz, ty, this.hitB);
    const toEdge = network.edges[to.edge];
    const toNode = to.s < toEdge.center.length / 2 ? toEdge.a : toEdge.b;

    const points: number[] = [];
    // Same road, target ahead: a straight run along it.
    if (from.edge === to.edge && (to.s > from.s) === goesForward) {
      this.appendStretch(points, fromEdge, from.s, to.s, unit, keepLeft);
      points.push(tx, tz);
      unit.driver.setRoute(points);
      return;
    }
    const ahead = goesForward ? fromEdge.b : fromEdge.a;
    const behind = goesForward ? fromEdge.a : fromEdge.b;
    const routeAhead = network.findRoute(ahead, toNode);
    const routeBehind = network.findRoute(behind, toNode);
    const useAhead = routeAhead.length > 0 && (routeBehind.length === 0 || this.routeLength(routeAhead) < this.routeLength(routeBehind) + 180);
    const route = useAhead ? routeAhead : routeBehind;
    const startsForward = useAhead ? goesForward : !goesForward;

    this.appendStretch(points, fromEdge, from.s, startsForward ? fromEdge.center.length : 0, unit, keepLeft);
    for (let i = 0; i + 1 < route.length; i++) {
      const edge = network.edgeBetween(route[i], route[i + 1]);
      if (!edge) continue;
      const forward = edge.a === route[i];
      this.appendStretch(points, edge, forward ? 0 : edge.center.length, forward ? edge.center.length : 0, unit, keepLeft);
    }
    points.push(tx, tz);
    unit.driver.setRoute(points);
  }

  private routeLength(route: readonly number[]): number {
    let total = 0;
    for (let i = 0; i + 1 < route.length; i++) total += this.network.edgeBetween(route[i], route[i + 1])?.full.length ?? 0;
    return total;
  }

  private appendStretch(points: number[], edge: RoadEdge, from: number, to: number, unit: PoliceUnit, keepLeft: boolean): void {
    const spacing = POLICE.driver.routePointSpacing;
    const distance = Math.abs(to - from);
    const steps = Math.max(1, Math.round(distance / spacing));
    const direction = to >= from ? 1 : -1;
    const spec = edge.spec;
    const offset = keepLeft ? spec.median / 2 + spec.laneWidth * (spec.lanes - 0.5) : clamp(unit.laneOffset, -spec.halfWidth + 1.5, spec.halfWidth - 1.5);
    for (let i = 0; i <= steps; i++) {
      edge.center.sample(from + (to - from) * (i / steps), this.sample);
      // Left of travel is (tz, -tx), and a reversed road flips both tangent signs.
      points.push(this.sample.x + this.sample.tz * direction * offset, this.sample.z - this.sample.tx * direction * offset);
    }
  }

  // ---------- Contact, spikes, roadblocks ----------

  private checkContacts(player: PoliceTarget): void {
    const config = POLICE.tactics;
    for (const unit of this.units) {
      if (!unit.active || unit.distance > 7.5 || Math.abs(unit.currY - 0.65 - player.y) > 2) continue;
      if (!this.touchesPlayer(unit, player)) continue;

      // Driving into a police car is never ignored, and it costs more than being hit by one.
      if (!this.heat.isActive) {
        this.heat.startPursuit();
      } else if (unit.ramCooldown <= 0 && player.speed > unit.car.telemetry.speed + 3) {
        unit.ramCooldown = config.ramContactCooldown;
        this.heat.addHeat(POLICE.heat.ramPolice);
      }
      // A rear-corner hit from a unit doing a PIT spins the player's car.
      const dx = unit.currX - player.x;
      const dz = unit.currZ - player.z;
      const along = dx * player.fx + dz * player.fz;
      const side = dx * player.fz - dz * player.fx;
      const isPit = unit.role === 'pit' && unit.pitCooldown <= 0 && along < -1 && Math.abs(side) > 0.5 && player.speed > config.pitMinSpeed;
      if (isPit) {
        unit.pitCooldown = config.pitCooldown;
        // Pushed from the left rear, the tail swings right and the nose turns left.
        player.car.destabilize((side > 0 ? 1 : -1) * config.pitYawKick, config.pitRearGrip);
      }
      this.bus.emit('policeContact', { x: (unit.currX + player.x) / 2, y: player.y + 0.7, z: (unit.currZ + player.z) / 2, pit: isPit });
    }
  }

  /** Whether a unit's footprint touches the player's. */
  private touchesPlayer(unit: PoliceUnit, player: PoliceTarget): boolean {
    const q = unit.car.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const dx = unit.currX - player.x;
    const dz = unit.currZ - player.z;
    const halfLength = 2.05;
    const halfWidth = 0.95;
    const axes = [player.fx, player.fz, player.fz, -player.fx, fx, fz, fz, -fx];
    for (let i = 0; i < 8; i += 2) {
      const nx = axes[i];
      const nz = axes[i + 1];
      const distance = Math.abs(dx * nx + dz * nz);
      const a = halfLength * Math.abs(player.fx * nx + player.fz * nz) + halfWidth * Math.abs(player.fz * nx - player.fx * nz);
      const b = halfLength * Math.abs(fx * nx + fz * nz) + halfWidth * Math.abs(fz * nx - fx * nz);
      if (distance > a + b) return false;
    }
    return true;
  }

  private checkSpikes(player: PoliceTarget): void {
    if (this.spikeHitCooldown > 0) return;
    const depth = POLICE.spikes.halfDepth;
    for (const strip of this.strips) {
      if (!strip.active) continue;
      if (Math.abs(strip.x - player.x) > 12 || Math.abs(strip.z - player.z) > 12) continue;
      const fx = Math.sin(strip.yaw);
      const fz = Math.cos(strip.yaw);
      for (const wheel of player.car.wheels) {
        if (!wheel.contact) continue;
        const dx = wheel.contactPoint.x - strip.x;
        const dz = wheel.contactPoint.z - strip.z;
        const along = dx * fx + dz * fz;
        const across = dx * fz - dz * fx;
        if (Math.abs(along) < depth + 0.25 && Math.abs(across) < strip.halfLength) {
          player.car.applyPuncture(POLICE.spikes.punctureSeconds);
          this.spikeHitCooldown = 3;
          this.bus.emit('spikeHit', {});
          return;
        }
      }
    }
  }

  private placeStrip(x: number, y: number, z: number, yaw: number, halfLength: number): number {
    let index = this.strips.findIndex((strip) => !strip.active);
    if (index < 0) {
      // Reuse the oldest.
      index = 0;
      for (let i = 1; i < this.strips.length; i++) if (this.strips[i].age > this.strips[index].age) index = i;
    }
    const strip = this.strips[index];
    strip.active = true;
    strip.x = x;
    strip.y = y;
    strip.z = z;
    strip.yaw = yaw;
    strip.halfLength = halfLength;
    strip.age = 0;
    return index;
  }

  private updateStrips(dt: number): void {
    for (const strip of this.strips) {
      if (!strip.active) continue;
      strip.age += dt;
      if (strip.age > POLICE.spikes.lifeSeconds) strip.active = false;
    }
    // A unit out in front can drop a strip in the player's path.
    if (this.heat.phase !== 'pursuit' || this.heat.stars < POLICE.spikes.dropFromStars) return;
    for (const unit of this.units) {
      if (!unit.active || unit.role !== 'front' || unit.dropCooldown > 0) continue;
      if (unit.distance < POLICE.spikes.dropAhead || unit.distance > POLICE.spikes.dropAheadMax) continue;
      const q = unit.car.quaternion;
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      unit.dropCooldown = POLICE.spikes.dropEverySeconds;
      this.placeStrip(unit.currX - fx * 3.5, unit.currY - 0.65, unit.currZ - fz * 3.5, Math.atan2(fx, fz), POLICE.spikes.halfLengthDrop);
      this.radio('spike');
    }
  }

  private updateRoadblocks(dt: number, player: PoliceTarget, view: PoliceView): void {
    const config = POLICE.roadblock;
    for (let i = this.roadblocks.length - 1; i >= 0; i--) {
      const block = this.roadblocks[i];
      block.age += dt;
      const distance = Math.hypot(block.x - player.x, block.z - player.z);
      const behind = (block.x - player.x) * player.fx + (block.z - player.z) * player.fz < 0;
      if ((behind && distance > config.removeBehind) || (block.age > config.lifeSeconds && this.isHidden(block.x, block.z, view))) {
        this.removeRoadblock(i);
      }
    }
    if (this.heat.phase !== 'pursuit' || this.heat.stars < config.fromStars) return;
    this.roadblockTimer -= dt;
    if (this.roadblockTimer > 0 || this.roadblocks.length >= config.maxBlocks) return;
    if (player.speed < 12) return;
    this.roadblockTimer = config.everySeconds / this.adaptive.value;
    this.placeRoadblock(player);
  }

  /** Walks the road ahead of the player to find where a roadblock should stand. */
  roadAhead(player: PoliceTarget, distance: number): { x: number; y: number; z: number; tx: number; tz: number; edge: RoadEdge } | null {
    const network = this.network;
    const hit = network.nearestRoad(player.x, player.z, player.y, this.hit);
    let edge = network.edges[hit.edge];
    let forward = hit.tx * player.fx + hit.tz * player.fz >= 0;
    let s = hit.s;
    let remaining = distance;
    for (let hops = 0; hops < 6; hops++) {
      const available = forward ? edge.center.length - s : s;
      if (remaining < available) {
        const at = forward ? s + remaining : s - remaining;
        edge.center.sample(at, this.sample);
        const sign = forward ? 1 : -1;
        return { x: this.sample.x, y: this.sample.y, z: this.sample.z, tx: this.sample.tx * sign, tz: this.sample.tz * sign, edge };
      }
      remaining -= available;
      // On to whichever road carries on straightest.
      edge.center.sample(forward ? edge.center.length : 0, this.sample);
      const sign = forward ? 1 : -1;
      const tx = this.sample.tx * sign;
      const tz = this.sample.tz * sign;
      const node = network.nodes[forward ? edge.b : edge.a];
      let bestLeg = -1;
      let bestDot = 0.3;
      for (let i = 0; i < node.legs.length; i++) {
        const leg = node.legs[i];
        if (leg.edge === edge.index) continue;
        const dot = leg.awayX * tx + leg.awayZ * tz;
        if (dot > bestDot) {
          bestDot = dot;
          bestLeg = i;
        }
      }
      if (bestLeg < 0) return null;
      const next = network.edges[node.legs[bestLeg].edge];
      forward = next.a === node.index;
      s = forward ? 0 : next.center.length;
      edge = next;
    }
    return null;
  }

  private placeRoadblock(player: PoliceTarget): void {
    const config = POLICE.roadblock;
    const spot = this.roadAhead(player, config.distanceAhead);
    if (!spot) return;
    const half = spot.edge.spec.halfWidth;
    const width = half * 2;
    const gap = Math.min(config.gapWidth, width * 0.45);
    const carCount = Math.floor((width - gap) / config.carSpacing);
    if (carCount < 1) return;
    const free: number[] = [];
    for (let i = 0; i < this.parked.length && free.length < carCount; i++) if (!this.parked[i].active) free.push(i);
    if (free.length === 0) return;

    // Left across the road is (tz, -tx). The gap goes on a random side.
    const leftX = spot.tz;
    const leftZ = -spot.tx;
    const gapOnLeft = this.random() < 0.5;
    const yaw = Math.atan2(spot.tx, spot.tz) + Math.PI / 2;
    const half2 = yaw / 2;
    const start = gapOnLeft ? -half + config.carSpacing / 2 : half - config.carSpacing / 2;
    const step = gapOnLeft ? config.carSpacing : -config.carSpacing;
    free.forEach((index, order) => {
      const offset = start + step * order;
      const car = this.parked[index];
      car.active = true;
      car.body.setEnabled(true);
      car.body.setTranslation({ x: spot.x + leftX * offset, y: spot.y + 0.72, z: spot.z + leftZ * offset }, true);
      car.body.setRotation({ x: 0, y: Math.sin(half2), z: 0, w: Math.cos(half2) }, true);
      car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    });
    let strip = -1;
    if (this.heat.stars >= config.spikesFromStars) {
      const gapCenter = (gapOnLeft ? 1 : -1) * (half - gap / 2);
      strip = this.placeStrip(spot.x + leftX * gapCenter, spot.y, spot.z + leftZ * gapCenter, Math.atan2(spot.tx, spot.tz), gap / 2 + 0.2);
      this.radio('spike');
    } else {
      this.radio('roadblock');
    }
    this.roadblocks.push({ cars: free, strip, x: spot.x, z: spot.z, age: 0 });
  }

  private removeRoadblock(index: number): void {
    const block = this.roadblocks[index];
    for (const car of block.cars) {
      this.parked[car].active = false;
      this.parked[car].body.setTranslation({ x: 0, y: -400, z: 0 }, false);
      this.parked[car].body.setEnabled(false);
    }
    if (block.strip >= 0) this.strips[block.strip].active = false;
    this.roadblocks.splice(index, 1);
  }

  private removeRoadblocks(): void {
    for (let i = this.roadblocks.length - 1; i >= 0; i--) this.removeRoadblock(i);
  }

  // ---------- Air ----------

  private updateAir(dt: number, player: PoliceTarget): void {
    const drone = POLICE.drone;
    const heli = POLICE.helicopter;
    const heat = this.heat;
    const lookX = heat.phase === 'evading' ? this.lastKnownX : player.x;
    const lookZ = heat.phase === 'evading' ? this.lastKnownZ : player.z;
    const lookY = heat.phase === 'evading' ? this.lastKnownY : player.y;

    if (heat.isActive && heat.stars >= drone.fromStars) {
      if (!this.drone.active) {
        this.droneTimer -= dt;
        if (this.droneTimer <= 0) {
          const angle = this.random() * Math.PI * 2;
          this.drone.launch(player.x + Math.cos(angle) * drone.startDistance, lookY + drone.height, player.z + Math.sin(angle) * drone.startDistance);
          this.radio('drone');
        }
      } else {
        this.drone.flyToward(dt, lookX, lookY + drone.height, lookZ, drone.speed);
        this.drone.moveSpot(dt, lookX, lookZ, 3);
        if (this.drone.age > drone.lifeSeconds) {
          this.drone.stop();
          this.droneTimer = drone.everySeconds;
        }
      }
    }

    if (heat.isActive && heat.stars >= heli.fromStars) {
      if (!this.helicopter.active) {
        const angle = this.random() * Math.PI * 2;
        this.helicopter.launch(player.x + Math.cos(angle) * heli.startDistance, lookY + heli.height + 20, player.z + Math.sin(angle) * heli.startDistance);
        this.radio('heli');
      } else {
        this.helicopter.orbitAround(dt, lookX, lookY + heli.height, lookZ, heli.orbitRadius, heli.speed);
        const sweep = heat.phase === 'evading' ? 40 : 0;
        this.helicopter.moveSpot(dt, lookX + Math.sin(this.time * 0.9) * sweep, lookZ + Math.cos(this.time * 0.7) * sweep, heli.spotFollow);
      }
    }
  }

  // ---------- Player actions ----------

  /** Three horn taps: units nearby lose track for a moment. Returns how many fell for it. */
  hornConfuse(): number {
    const config = POLICE.tactics;
    if (!this.heat.isActive || this.confuseCooldown > 0) return 0;
    let count = 0;
    for (const unit of this.units) {
      if (!unit.active || unit.distance > config.confuseRadius) continue;
      unit.confusedSeconds = config.confuseSeconds;
      count++;
    }
    if (count > 0) {
      this.confuseCooldown = config.confuseCooldown;
      this.radio('horn');
    }
    return count;
  }

  /** A trap fell on the road: units nearby spin out and stop. Returns how many. */
  stunNear(x: number, z: number, radius: number): number {
    let count = 0;
    for (const unit of this.units) {
      if (!unit.active || Math.hypot(unit.currX - x, unit.currZ - z) > radius) continue;
      unit.stunSeconds = POLICE.tactics.stunSeconds;
      unit.car.destabilize((this.random() < 0.5 ? -1 : 1) * 1400, 0.4);
      count++;
    }
    if (count > 0) this.radio('trap');
    return count;
  }

  /** Nearest active unit to the player, for the siren and the real flashing light. */
  nearestUnit(): PoliceUnit | null {
    let best: PoliceUnit | null = null;
    for (const unit of this.units) {
      if (unit.active && (!best || unit.distance < best.distance)) best = unit;
    }
    return best;
  }

  get isSeen(): boolean {
    return this.seen;
  }
}

