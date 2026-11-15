/**
 * One AI driver in a race. It uses the same car and controls a player has: only its decisions differ.
 * Personality comes from its traits. No rendering here, so a whole race can run headless.
 */

import { RACE } from '../config/race-tuning';
import { TUNING } from '../config/tuning';
import type { RivalModel, RivalTraits } from '../config/rivals';
import { clamp, createRng, lerp, moveToward, smoothstep } from '../core/math';
import type { PhysicsWorld } from '../physics/physics-world';
import { PoliceDriver, type DriverTuning } from '../police/police-driver';
import type { TrafficSystem } from '../traffic/traffic-system';
import { VehicleController } from '../vehicle/vehicle-controller';
import type { RaceCourse } from './race-course';

export interface RacerLook {
  model: RivalModel;
  body: number;
  stripe: number;
  glow: number;
  lightsOff: boolean;
}

/** The player, as other drivers see them. */
export interface PlayerView {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  vx: number;
  vz: number;
  speed: number;
  progress: number;
}

/** Everything a driver looks at when deciding. */
export interface RacerWorld {
  player: PlayerView;
  agents: readonly RacerAgent[];
  traffic: TrafficSystem | null;
  /** Total length of the race, metres. */
  totalDistance: number;
  /** Rubber-banding only makes sense in a head-to-head race. */
  rubberBand: boolean;
  /** Side the player tends to pass on, from what is remembered. */
  preferredSide: number;
  /** Camera position and direction, so a car only reappears out of sight. */
  viewX: number;
  viewZ: number;
  viewFx: number;
  viewFz: number;
}

export type AgentRole = 'race' | 'runner';

const PARKED = { position: { x: 0, y: -400, z: 0 }, yaw: 0 };

export class RacerAgent {
  readonly car: VehicleController;
  readonly driver: PoliceDriver;
  active = false;
  role: AgentRole = 'race';
  /** Set when this car belongs to a named rival. */
  rivalId: string | null = null;
  /** Index into the crew name list. */
  crewIndex = 0;
  look: RacerLook = { model: 'hatch', body: 0xffffff, stripe: 0, glow: 0, lightsOff: false };
  traits!: RivalTraits;
  course: RaceCourse | null = null;

  lineS = 0;
  progress = 0;
  /** How far this car is from its line, as of the last reading. */
  offLine = 0;
  gateIndex = 0;
  finished = false;
  finishMs = 0;
  /** Takedown: out of the running. */
  eliminated = false;
  health = 100;
  hitCooldown = 0;
  /** Drag: the gear lever is in the driver's hands. */
  manualGears = false;
  /** Seconds after GO before this driver gets going. */
  startDelay = 0;
  provokedSeconds = 0;

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
  fx = 0;
  fz = 1;

  /** Current sideways shift from the driver's line, metres to the left. */
  private lateral = 0;
  private lateralTarget = 0;
  private avoidTimer = 0;
  private avoidSide = 0;
  private avoidSlow = 1;
  private mistakeTimer = 0;
  private mistakeCheck = 0;
  private mistakeSide = 0;
  private blockTimer = 0;
  private ramTimer = 0;
  private ramCooldown = 0;
  private hornTimer = 0;
  private stuckTime = 0;
  private shiftAt = 0.9;
  private readonly random = createRng(4242);
  private readonly tuning: DriverTuning;
  private baseCorner = 10;
  private baseBrake = 10;

  constructor(physics: PhysicsWorld) {
    this.car = new VehicleController(physics, PARKED, undefined, { powerScale: 1, topSpeedScale: 1, gripScale: 1 });
    this.tuning = { ...RACE.driver };
    this.driver = new PoliceDriver(physics, this.car, this.tuning);
    this.car.setEnabled(false);
  }

  /** Puts this car on the grid, ready to go. */
  prepare(traits: RivalTraits, look: RacerLook, course: RaceCourse | null, x: number, y: number, z: number, yaw: number): void {
    this.active = true;
    this.traits = traits;
    this.look = look;
    this.course = course;
    this.car.setEnabled(true);
    this.car.reset({ position: { x, y: y + 0.8, z }, yaw });
    this.car.addNitro(TUNING.vehicle.nitro.startAmount - this.car.telemetry.nitro);
    this.car.clearPuncture();
    this.driver.reset();
    this.driver.driftCorners = traits.drifty === true;
    this.baseCorner = traits.cornerLateral;
    this.baseBrake = traits.cornerBrake;
    this.tuning.cornerLateral = traits.cornerLateral;
    this.tuning.cornerBrake = traits.cornerBrake;
    this.car.profile.powerScale = traits.power;
    this.car.profile.topSpeedScale = traits.topSpeed;
    this.car.profile.gripScale = traits.grip;
    this.progress = 0;
    this.offLine = 0;
    this.gateIndex = 0;
    this.finished = false;
    this.finishMs = 0;
    this.eliminated = false;
    this.health = RACE.takedown.health;
    this.hitCooldown = 0;
    this.manualGears = false;
    this.startDelay = 0;
    this.provokedSeconds = 0;
    this.role = 'race';
    this.lateral = 0;
    this.lateralTarget = 0;
    this.avoidSide = 0;
    this.avoidSlow = 1;
    this.mistakeTimer = 0;
    this.stuckTime = 0;
    const half = yaw / 2;
    this.currX = this.prevX = x;
    this.currY = this.prevY = y + 0.8;
    this.currZ = this.prevZ = z;
    this.currQx = this.prevQx = 0;
    this.currQy = this.prevQy = Math.sin(half);
    this.currQz = this.prevQz = 0;
    this.currQw = this.prevQw = Math.cos(half);
    this.fx = Math.sin(yaw);
    this.fz = Math.cos(yaw);
    this.shiftAt = RACE.drag.aiShiftAt + (this.random() - 0.5) * 2 * RACE.drag.aiShiftSpread;
  }

  /** Off duty: out of the world until the next race. */
  retire(): void {
    if (!this.active) return;
    this.active = false;
    this.car.reset(PARKED);
    this.car.setEnabled(false);
    this.driver.reset();
    this.course = null;
  }

  /** Reads the car's new position after the physics step. */
  readTransform(): void {
    const t = this.car.body.translation();
    const r = this.car.body.rotation();
    this.prevX = this.currX;
    this.prevY = this.currY;
    this.prevZ = this.currZ;
    this.prevQx = this.currQx;
    this.prevQy = this.currQy;
    this.prevQz = this.currQz;
    this.prevQw = this.currQw;
    this.currX = t.x;
    this.currY = t.y;
    this.currZ = t.z;
    this.currQx = r.x;
    this.currQy = r.y;
    this.currQz = r.z;
    this.currQw = r.w;
    const fx = 2 * (r.x * r.z + r.w * r.y);
    const fz = 1 - 2 * (r.x * r.x + r.y * r.y);
    const length = Math.hypot(fx, fz) || 1;
    this.fx = fx / length;
    this.fz = fz / length;
  }

  /** Holds still on the grid. */
  holdStill(dt: number): void {
    this.driver.hold();
    this.driver.intent.brake = 0;
    this.driver.intent.handbrake = true;
    this.car.update(dt, this.driver.intent);
  }

  /** Decides and drives, for one physics step of a race. */
  driveRace(dt: number, world: RacerWorld): void {
    if (this.startDelay > 0) {
      this.startDelay -= dt;
      this.holdStill(dt);
      return;
    }
    const share = world.totalDistance > 0 ? clamp(this.progress / world.totalDistance, 0, 1) : 0;
    const ai = RACE.ai;
    const traits = this.traits;

    if (this.finished) {
      this.driver.followRoute(dt, RACE.finish.cruiseSpeed, this.avoidSide, this.avoidSlow, false, 0);
      this.car.update(dt, this.driver.intent);
      return;
    }

    this.updateRubberBand(world, share);
    this.updateAvoidance(dt, world);
    this.updateBlockAndRam(dt, world);
    this.updateMistakes(dt);
    if (this.provokedSeconds > 0) this.provokedSeconds -= dt;

    const onLane = this.course ? this.course.isLaneAt(this.progress) : false;
    const pushing = traits.lastPush === true && share > ai.pushFraction;
    const provoked = this.provokedSeconds > 0;
    this.tuning.cornerLateral = (this.baseCorner + (pushing ? ai.pushCorner : 0) + (provoked ? ai.provokedCorner : 0)) * (onLane ? traits.laneScale : 1);
    this.tuning.cornerBrake = this.baseBrake;

    const engineTop = (TUNING.vehicle.engine.topSpeedKmh / 3.6) * this.car.profile.topSpeedScale;
    let maxSpeed = engineTop * 1.3;
    if (onLane && traits.laneScale < 1) maxSpeed = engineTop * traits.laneScale * 0.8;
    if (this.mistakeTimer > 0) maxSpeed = Math.min(maxSpeed, this.car.telemetry.speed * ai.mistakeSpeedScale + 4);

    // Nitro on a straight, once its moment in the race has come.
    const speed = this.car.telemetry.speed;
    const behindLeader = world.rubberBand && world.player.progress - this.progress > 40;
    const nitro =
      this.driver.straightAhead >= ai.nitroStraight &&
      speed > 12 &&
      (share >= traits.nitroStart || behindLeader) &&
      !onLane;
    this.car.addNitro(ai.nitroRegenPerSecond * dt);

    if (traits.hornsTraffic && world.traffic) {
      this.hornTimer -= dt;
      if (this.hornTimer <= 0) {
        this.hornTimer = ai.hornEverySeconds;
        world.traffic.sirenYield(this.currX, this.currY - 0.65, this.currZ, this.fx, this.fz, ai.hornReach);
      }
    }

    const room = this.lateralRoom(onLane);
    const wanted = clamp(this.lateralTarget + (this.mistakeTimer > 0 ? this.mistakeSide * ai.mistakeLateral : 0), -room, room);
    this.lateral = moveToward(this.lateral, wanted, ai.lateralRate * dt);

    if (!this.driver.followRoute(dt, maxSpeed, this.avoidSide, this.avoidSlow, nitro, this.lateral)) {
      this.driver.hold();
    }
    if (this.manualGears) this.updateManualGears();
    this.car.update(dt, this.driver.intent);
    this.checkStuck(dt, world);
  }

  /** Takedown: runs from the player, around the streets. */
  driveRunner(dt: number, world: RacerWorld, planNext: (agent: RacerAgent) => void): void {
    if (this.eliminated) {
      this.driver.hold();
      this.car.update(dt, this.driver.intent);
      return;
    }
    const ai = RACE.ai;
    this.updateAvoidance(dt, world);
    const distance = Math.hypot(this.currX - world.player.x, this.currZ - world.player.z);
    const fleeing = distance < ai.fleeRadius;
    const engineTop = (TUNING.vehicle.engine.topSpeedKmh / 3.6) * this.car.profile.topSpeedScale;
    this.car.addNitro(ai.nitroRegenPerSecond * dt);
    const maxSpeed = engineTop * (fleeing ? 1 : ai.runnerSpeedScale);
    const nitro = fleeing && this.driver.straightAhead >= ai.nitroStraight;
    if (!this.driver.followRoute(dt, maxSpeed, this.avoidSide, this.avoidSlow, nitro, 0)) {
      planNext(this);
    }
    this.car.update(dt, this.driver.intent);
    this.checkStuck(dt, world);
  }

  /** Small, capped help that fades out before the end. Physics stays the same for everyone. */
  private updateRubberBand(world: RacerWorld, share: number): void {
    const traits = this.traits;
    const profile = this.car.profile;
    const ai = RACE.ai;
    const band = RACE.rubberBand;
    let power = traits.power;
    let top = traits.topSpeed;
    if (traits.lastPush && share > ai.pushFraction) {
      power += ai.pushPower;
      top += ai.pushTopSpeed;
    }
    if (world.rubberBand) {
      const fade = 1 - smoothstep(band.fadeFrom, band.fadeTo, share);
      const gap = world.player.progress - this.progress;
      const amount = traits.rubber * fade;
      if (gap > band.catchUpStart) {
        const t = clamp((gap - band.catchUpStart) / (band.catchUpFull - band.catchUpStart), 0, 1);
        power += band.catchUpPower * t * amount;
        top += band.catchUpTopSpeed * t * amount;
      } else if (gap < -band.easeStart) {
        const t = clamp((-gap - band.easeStart) / (band.easeFull - band.easeStart), 0, 1);
        power -= band.easePower * t * amount;
        top -= band.easeTopSpeed * t * amount;
      }
    }
    profile.powerScale = power;
    profile.topSpeedScale = top;
  }

  private lateralRoom(onLane: boolean): number {
    const ai = RACE.ai;
    return onLane ? ai.lanePassLimit : ai.lateralLimit;
  }

  /** Looks for what is in the way: traffic, other racers and the player. */
  private updateAvoidance(dt: number, world: RacerWorld): void {
    this.avoidTimer -= dt;
    if (this.avoidTimer > 0) return;
    const ai = RACE.ai;
    this.avoidTimer = ai.avoidEverySeconds;
    this.avoidSide = 0;
    this.avoidSlow = 1;
    const fx = this.fx;
    const fz = this.fz;
    const x = this.currX;
    const z = this.currZ;
    const skill = this.traits.trafficSkill;
    const reach = lerp(ai.trafficReachMin, ai.trafficReachMax, skill);
    const slowest = lerp(ai.trafficSlowMin, ai.trafficSlowMax, skill);
    const lateralClear = RACE.driver.avoidLateral;
    let nearest = reach;

    const traffic = world.traffic;
    if (traffic) {
      for (let agent = 0; agent < traffic.capacity; agent++) {
        if (!traffic.alive[agent]) continue;
        const dx = traffic.x[agent] - x;
        const dz = traffic.z[agent] - z;
        if (Math.abs(dx) > reach || Math.abs(dz) > reach) continue;
        if (Math.abs(traffic.y[agent] - (this.currY - 0.65)) > 3) continue;
        const along = dx * fx + dz * fz;
        if (along < 1 || along >= nearest) continue;
        const side = dx * fz - dz * fx;
        if (Math.abs(side) > lateralClear) continue;
        nearest = along;
        this.avoidSide = side >= 0 ? 1 : -1;
        this.avoidSlow = clamp(slowest + (along / reach) * (1 - slowest), slowest, 1);
      }
    }

    // Other cars in the race are passed, rather than braked for.
    let passSide = 0;
    let nearestCar = ai.racerReach;
    const speed = this.car.telemetry.speed;
    const check = (ox: number, oz: number, oy: number, otherSpeed: number): void => {
      const dx = ox - x;
      const dz = oz - z;
      if (Math.abs(dx) > ai.racerReach || Math.abs(dz) > ai.racerReach) return;
      if (Math.abs(oy - this.currY) > 3) return;
      const along = dx * fx + dz * fz;
      if (along < 1 || along >= nearestCar) return;
      const side = dx * fz - dz * fx;
      if (Math.abs(side) > ai.passClearance || otherSpeed > speed + 1) return;
      nearestCar = along;
      passSide = side >= 0 ? -1 : 1;
      if (along < 7 && otherSpeed < speed - 2) {
        this.avoidSlow = Math.min(this.avoidSlow, 0.8);
      }
    };
    for (const other of world.agents) {
      if (other === this || !other.active) continue;
      check(other.currX, other.currZ, other.currY, other.car.telemetry.speed);
    }
    check(world.player.x, world.player.z, world.player.y + 0.65, world.player.speed);
    if (passSide !== 0 && this.blockTimer <= 0 && this.ramTimer <= 0) {
      this.lateralTarget = this.lateral + passSide * ai.passClearance;
    } else if (passSide === 0 && this.blockTimer <= 0 && this.ramTimer <= 0) {
      this.lateralTarget = moveToward(this.lateralTarget, 0, 0.2);
    }
  }

  private updateBlockAndRam(dt: number, world: RacerWorld): void {
    const ai = RACE.ai;
    const traits = this.traits;
    const player = world.player;
    const dx = player.x - this.currX;
    const dz = player.z - this.currZ;
    // Forward is (fx, fz), and left of travel is (fz, -fx).
    const along = dx * this.fx + dz * this.fz;
    const side = dx * this.fz - dz * this.fx;
    if (this.blockTimer > 0) this.blockTimer -= dt;
    if (this.ramTimer > 0) this.ramTimer -= dt;
    if (this.ramCooldown > 0) this.ramCooldown -= dt;

    // Player close behind: move across to stay in the way.
    const block = traits.block;
    if (block > 0 && along < -3 && along > -ai.blockReachBehind && Math.abs(dx) + Math.abs(dz) < ai.blockReachBehind * 2) {
      const bias = world.preferredSide !== 0 && traits.adaptive ? world.preferredSide * 2.4 : side;
      this.lateralTarget = this.lateral + clamp(bias, -2.6, 2.6) * block * 0.85;
      this.blockTimer = ai.blockHoldSeconds * block;
    }

    // Player alongside: lean in. Being provoked makes it more likely.
    const aggression = traits.aggression + (this.provokedSeconds > 0 ? ai.provokedAggression : 0);
    if (aggression > 0.01 && this.ramCooldown <= 0 && Math.abs(along) < 4.5 && Math.abs(side) < ai.ramReach && Math.abs(side) > 1.2) {
      if (this.random() < aggression * dt * 3) {
        this.ramTimer = 0.8;
        this.ramCooldown = ai.ramCooldown;
      }
    }
    if (this.ramTimer > 0) {
      this.lateralTarget = this.lateral + Math.sign(side) * ai.ramSteer * Math.max(0.5, aggression);
    }
  }

  private updateMistakes(dt: number): void {
    const ai = RACE.ai;
    if (this.mistakeTimer > 0) this.mistakeTimer -= dt;
    this.mistakeCheck -= dt;
    if (this.mistakeCheck > 0) return;
    this.mistakeCheck = ai.mistakeCheckSeconds;
    const rate = this.traits.mistakeRate * (this.provokedSeconds > 0 ? ai.provokedMistakes : 1);
    if (this.random() < rate) {
      this.mistakeTimer = ai.mistakeSeconds;
      this.mistakeSide = this.random() < 0.5 ? -1 : 1;
    }
  }

  private updateManualGears(): void {
    const powertrain = this.car.powertrain;
    powertrain.manual = true;
    if (powertrain.rpmShare >= this.shiftAt && powertrain.shiftUp()) {
      this.shiftAt = RACE.drag.aiShiftAt + (this.random() - 0.5) * 2 * RACE.drag.aiShiftSpread;
    }
  }

  private checkStuck(dt: number, world: RacerWorld): void {
    const ai = RACE.ai;
    const telemetry = this.car.telemetry;
    const off = this.role === 'race' && this.offLine > ai.offRouteRespawn;
    if (telemetry.speed < 2 || telemetry.upY < 0.3 || off) this.stuckTime += dt;
    else this.stuckTime = 0;
    if (this.stuckTime < ai.stuckRespawnSeconds) return;
    const inView = (this.currX - world.viewX) * world.viewFx + (this.currZ - world.viewZ) * world.viewFz > 0;
    if (inView && this.stuckTime < ai.stuckForceRespawnSeconds) return;
    this.respawn();
  }

  /** Back on the road a little behind where it got stuck, for a driver the player cannot see. */
  respawn(): void {
    this.stuckTime = 0;
    const course = this.course;
    if (!course || this.role !== 'race') return;
    const progress = this.progress - RACE.ai.respawnBehind;
    const s = course.toLineS(progress);
    const sample = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
    course.line.sample(s, sample);
    this.car.reset({ position: { x: sample.x, y: sample.y + 0.8, z: sample.z }, yaw: Math.atan2(sample.tx, sample.tz) });
    this.lineS = s;
    this.progress = progress;
    this.lateral = 0;
    this.lateralTarget = 0;
    this.driver.relocate(sample.x, sample.z);
    const half = Math.atan2(sample.tx, sample.tz) / 2;
    this.currX = this.prevX = sample.x;
    this.currY = this.prevY = sample.y + 0.8;
    this.currZ = this.prevZ = sample.z;
    this.currQx = this.prevQx = 0;
    this.currQy = this.prevQy = Math.sin(half);
    this.currQz = this.prevQz = 0;
    this.currQw = this.prevQw = Math.cos(half);
  }
}
