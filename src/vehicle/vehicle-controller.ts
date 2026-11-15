/**
 * Custom arcade raycast vehicle: the heart of the driving feel.
 *
 * Coordinate convention on the car: +Z forward, +Y up, +X left (so "right" is -X).
 * Positive steer means turning right, which is a negative rotation about +Y.
 *
 * Every wheel casts a ray, makes a spring force, then makes tyre forces.
 * Grip is deliberately arcade: steering aims at the grip limit at every speed,
 * the rear axle loses grip on the handbrake and holds a slide on throttle,
 * and a limiter stops drifts from turning into spins.
 * This file has no rendering code, so tests can run it headless.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { Quaternion, Vector3 } from 'three';
import { ATMOSPHERE } from '../config/atmosphere';
import { POLICE } from '../config/police-tuning';
import { TUNING } from '../config/tuning';
import type { EventBus } from '../core/events';
import { DEG2RAD, RAD2DEG, clamp, lerp, moveToward, smoothstep } from '../core/math';
import type { Intent } from '../input/intent';
import { GROUP_TRAFFIC, GROUP_WHEEL_RAY, type PhysicsWorld, type SurfaceKind } from '../physics/physics-world';
import { Powertrain } from './powertrain';
import { lateralGripCurve, speedLimitedSteerAngle } from './tyre-model';

export interface WheelState {
  readonly isFront: boolean;
  readonly isLeft: boolean;
  readonly mountLocal: Vector3;
  contact: boolean;
  /** Current suspension length; the wheel centre sits this far under the mount. */
  springLength: number;
  compression: number;
  compressionPrev: number;
  load: number;
  readonly contactPoint: Vector3;
  /** Rolling angle for the visual wheel. */
  spinAngle: number;
  spinRate: number;
  /** 0 is rolling cleanly, 1 and above is sliding hard. Drives smoke, skid and sound. */
  slip: number;
  surface: SurfaceKind;
}

export interface VehicleTelemetry {
  speed: number;
  speedKmh: number;
  forwardSpeed: number;
  rpm: number;
  /** -1 in reverse, otherwise 1 to 6. */
  gear: number;
  isShifting: boolean;
  throttle: number;
  brake: number;
  handbrake: boolean;
  reversing: boolean;
  steerInput: number;
  steerAngle: number;
  nitro: number;
  nitroActive: boolean;
  /** Signed body slip angle in degrees. Positive means sliding toward the car's right. */
  slipAngleDeg: number;
  rearSlipDeg: number;
  drifting: boolean;
  groundedWheels: number;
  /** Smoothed acceleration in the car's frame, m/s^2. */
  longitudinalAccel: number;
  lateralAccel: number;
  maxSlip: number;
  upY: number;
  /** 0 is healthy, 1 is a full puncture. */
  puncture: number;
}

/** Scales a car away from the shared tuning, for police cars at each heat level. */
export interface VehicleProfile {
  powerScale: number;
  topSpeedScale: number;
  gripScale: number;
  /** Brakes, nitro push and steering response. Cars built for the garage set these. */
  brakeScale?: number;
  nitroScale?: number;
  steerScale?: number;
}

export interface SpawnPose {
  position: { x: number; y: number; z: number };
  /** Rotation about +Y; 0 faces +Z. */
  yaw: number;
}

const WORLD_UP = new Vector3(0, 1, 0);

export class VehicleController {
  readonly body: RAPIER.RigidBody;
  readonly wheels: WheelState[];
  readonly telemetry: VehicleTelemetry;
  readonly powertrain = new Powertrain();

  // Scratch objects: nothing on the update path allocates three.js objects.
  readonly position = new Vector3();
  readonly quaternion = new Quaternion();
  readonly velocity = new Vector3();
  private readonly angular = new Vector3();
  private readonly com = new Vector3();
  private readonly forward = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly mountWorld = new Vector3();
  private readonly wheelForward = new Vector3();
  private readonly wheelRight = new Vector3();
  private readonly pointVelocity = new Vector3();
  private readonly offset = new Vector3();
  private readonly force = new Vector3();
  private readonly applyPoint = new Vector3();
  private readonly tmp = new Vector3();
  private readonly prevVelocity = new Vector3();
  private readonly impulseOut = { x: 0, y: 0, z: 0 };
  private readonly pointOut = { x: 0, y: 0, z: 0 };
  private readonly ray: RAPIER.Ray;

  private steerAngle = 0;
  private rearGripScale = 1;
  private frontGripScale = 1;
  private reversing = false;
  private reverseTimer = 0;
  private drifting = false;
  private driftExitTimer = 0;
  private handbrakeWasHeld = false;
  private nitro: number = TUNING.vehicle.nitro.startAmount;
  private nitroActive = false;
  private previousDrive = 0;
  private longitudinalAccel = 0;
  private lateralAccel = 0;
  private punctureSeconds = 0;
  private punctureTotal = 1;
  private punctureLevel = 0;
  private wobbleTime = 0;

  constructor(
    private readonly physics: PhysicsWorld,
    spawn: SpawnPose,
    private readonly bus?: EventBus,
    /** Public so a police car can change with the heat level. */
    readonly profile: VehicleProfile = { powerScale: 1, topSpeedScale: 1, gripScale: 1 },
  ) {
    const config = TUNING.vehicle;
    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.position.x, spawn.position.y, spawn.position.z)
      .setRotation({ x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) })
      .setAdditionalMassProperties(
        config.mass,
        config.centerOfMass,
        { x: config.inertia.pitch, y: config.inertia.yaw, z: config.inertia.roll },
        { x: 0, y: 0, z: 0, w: 1 },
      )
      .setAngularDamping(config.angularDamping)
      .setCcdEnabled(true)
      .setCanSleep(false);
    this.body = physics.world.createRigidBody(bodyDesc);

    const chassis = config.chassis;
    const lower = RAPIER.ColliderDesc.roundCuboid(
      chassis.halfWidth - chassis.roundRadius,
      chassis.halfHeight - chassis.roundRadius,
      chassis.halfLength - chassis.roundRadius,
      chassis.roundRadius,
    )
      .setTranslation(0, chassis.offsetY, 0)
      .setDensity(0)
      .setFriction(chassis.friction)
      .setRestitution(chassis.restitution)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(chassis.impactForceThreshold)
      // Same group as traffic: no car's wheel rays ever land on another car.
      .setCollisionGroups(GROUP_TRAFFIC);
    physics.world.createCollider(lower, this.body);

    const cabin = RAPIER.ColliderDesc.cuboid(chassis.cabinHalfWidth, chassis.cabinHalfHeight, chassis.cabinHalfLength)
      .setTranslation(0, chassis.cabinOffsetY, chassis.cabinOffsetZ)
      .setDensity(0)
      .setFriction(chassis.friction)
      .setRestitution(chassis.restitution)
      .setCollisionGroups(GROUP_TRAFFIC);
    physics.world.createCollider(cabin, this.body);

    const w = config.wheels;
    const makeWheel = (isFront: boolean, isLeft: boolean): WheelState => ({
      isFront,
      isLeft,
      mountLocal: new Vector3(isLeft ? w.trackHalf : -w.trackHalf, w.mountY, isFront ? w.frontAxleZ : w.rearAxleZ),
      contact: false,
      springLength: config.suspension.restLength,
      compression: 0,
      compressionPrev: 0,
      load: 0,
      contactPoint: new Vector3(),
      spinAngle: 0,
      spinRate: 0,
      slip: 0,
      surface: 'road',
    });
    this.wheels = [makeWheel(true, true), makeWheel(true, false), makeWheel(false, true), makeWheel(false, false)];

    this.ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 });
    this.telemetry = {
      speed: 0,
      speedKmh: 0,
      forwardSpeed: 0,
      rpm: config.engine.idleRpm,
      gear: 1,
      isShifting: false,
      throttle: 0,
      brake: 0,
      handbrake: false,
      reversing: false,
      steerInput: 0,
      steerAngle: 0,
      nitro: this.nitro,
      nitroActive: false,
      slipAngleDeg: 0,
      rearSlipDeg: 0,
      drifting: false,
      groundedWheels: 0,
      longitudinalAccel: 0,
      lateralAccel: 0,
      maxSlip: 0,
      upY: 1,
      puncture: 0,
    };
  }

  /** Puts the car back on its wheels at a pose, keeping nitro. */
  reset(pose: SpawnPose): void {
    this.body.setTranslation(pose.position, true);
    this.body.setRotation({ x: 0, y: Math.sin(pose.yaw / 2), z: 0, w: Math.cos(pose.yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.powertrain.reset();
    this.steerAngle = 0;
    this.rearGripScale = 1;
    this.frontGripScale = 1;
    this.reversing = false;
    this.reverseTimer = 0;
    this.drifting = false;
    this.driftExitTimer = 0;
    this.prevVelocity.set(0, 0, 0);
    this.longitudinalAccel = 0;
    this.lateralAccel = 0;
    this.punctureSeconds = 0;
    for (const wheel of this.wheels) {
      wheel.compression = 0;
      wheel.compressionPrev = 0;
      wheel.contact = false;
      wheel.slip = 0;
      wheel.spinRate = 0;
    }
  }

  /** A spike strip: the car limps for a while, then the tyre is good enough again. */
  /** Good as new, for after an arrest or a restart. */
  clearPuncture(): void {
    this.punctureSeconds = 0;
    this.punctureLevel = 0;
    this.telemetry.puncture = 0;
  }

  applyPuncture(seconds: number): void {
    this.punctureSeconds = Math.max(this.punctureSeconds, seconds);
    this.punctureTotal = this.punctureSeconds;
  }

  /** Takes the car out of the world, or puts it back. Used for pooling police cars. */
  setEnabled(enabled: boolean): void {
    this.body.setEnabled(enabled);
  }

  /**
   * A shove to the rear corner: a yaw kick, and a moment of low rear grip.
   * Positive yaw turns the nose to the left.
   */
  destabilize(yawImpulse: number, rearGrip: number): void {
    this.impulseOut.x = this.up.x * yawImpulse;
    this.impulseOut.y = this.up.y * yawImpulse;
    this.impulseOut.z = this.up.z * yawImpulse;
    this.body.applyTorqueImpulse(this.impulseOut, true);
    this.rearGripScale = Math.min(this.rearGripScale, rearGrip);
  }

  /** Fills the nitro tank, for example from drift points. */
  addNitro(amount: number): void {
    this.nitro = clamp(this.nitro + amount, 0, TUNING.vehicle.nitro.capacity);
  }

  /** One fixed physics step. Call before world.step(). */
  update(dt: number, intent: Intent): void {
    this.readBodyState();
    const config = TUNING.vehicle;
    const { velocity, forward, right, up } = this;

    if (this.punctureSeconds > 0) this.punctureSeconds = Math.max(0, this.punctureSeconds - dt);
    const puncture = this.punctureSeconds > 0 ? Math.min(1, (this.punctureSeconds / this.punctureTotal) * 2) : 0;
    this.punctureLevel = puncture;

    const speed = velocity.length();
    const forwardSpeed = velocity.dot(forward);
    const lateralSpeed = velocity.dot(right);
    const speedKmh = speed * 3.6;

    this.updateDirection(dt, intent, forwardSpeed);
    const driveInput = this.reversing ? intent.brake : intent.throttle;
    const brakeInput = this.reversing ? intent.throttle : intent.brake;

    const bodySlip = forwardSpeed > 0.5 || speed > 2 ? Math.atan2(lateralSpeed, Math.max(Math.abs(forwardSpeed), 1)) : 0;

    const rearSlip = this.computeRearSlip();
    this.updateDriftState(dt, intent, speedKmh, forwardSpeed, rearSlip);
    this.updateGripScales(dt, intent, driveInput, speed, bodySlip);
    this.updateSteering(dt, intent, speed, forwardSpeed, bodySlip);
    this.updateNitro(dt, intent, forwardSpeed);

    const topSpeedKmh =
      (this.reversing
        ? config.engine.reverseTopKmh
        : (config.engine.topSpeedKmh + (this.nitroActive ? config.nitro.topSpeedBonusKmh : 0)) * this.profile.topSpeedScale) *
      (1 - POLICE.puncture.topSpeedLoss * puncture);

    const drivenWheelSpeed = this.drivenWheelSpeed(forwardSpeed);
    const shift = this.powertrain.update(dt, drivenWheelSpeed, driveInput, this.reversing);
    if (shift && this.bus) {
      this.bus.emit('gearChange', shift);
      if (shift.up && this.powertrain.rpm > config.engine.backfireMinRpm) this.bus.emit('backfire', {});
    }
    if (this.previousDrive > 0.7 && driveInput < 0.2 && this.powertrain.rpm > config.engine.backfireMinRpm) {
      this.bus?.emit('backfire', {});
    }
    this.previousDrive = driveInput;

    const driveForce =
      this.powertrain.driveForce(forwardSpeed, topSpeedKmh, this.reversing) *
      driveInput *
      this.profile.powerScale *
      (1 - POLICE.puncture.powerLoss * puncture);
    const driveDirection = this.reversing ? -1 : 1;

    const grounded = this.updateWheels(dt, intent, driveForce * driveDirection, brakeInput, driveInput);

    this.applyAero(dt, forwardSpeed, speed, grounded);
    if (grounded > 0) {
      this.applyDriftForces(dt, intent, driveInput, bodySlip, speed);
      if (this.nitroActive) {
        this.impulseAtCom(forward, config.nitro.force * (this.profile.nitroScale ?? 1) * dt * (1 - smoothstep((topSpeedKmh - 8) / 3.6, topSpeedKmh / 3.6, speed)));
      }
      if (up.y < config.upright.limit) this.applyLeveling(dt, config.upright.torque);
    } else {
      this.applyAirControl(dt, intent);
    }

    this.updateTelemetry(dt, intent, speed, forwardSpeed, bodySlip, rearSlip, grounded, brakeInput);
  }

  private readBodyState(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    const v = this.body.linvel();
    const a = this.body.angvel();
    const c = this.body.worldCom();
    this.position.set(t.x, t.y, t.z);
    this.quaternion.set(r.x, r.y, r.z, r.w);
    this.velocity.set(v.x, v.y, v.z);
    this.angular.set(a.x, a.y, a.z);
    this.com.set(c.x, c.y, c.z);
    this.forward.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.right.set(-1, 0, 0).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);
  }

  /** Brake pedal becomes reverse once the car has stopped, and the other way around. */
  private updateDirection(dt: number, intent: Intent, forwardSpeed: number): void {
    const engine = TUNING.vehicle.engine;
    if (!this.reversing) {
      if (intent.brake > 0.1 && intent.throttle < 0.1 && forwardSpeed < 1) {
        this.reverseTimer += dt;
        if (this.reverseTimer > engine.reverseDelay) this.reversing = true;
      } else {
        this.reverseTimer = 0;
      }
    } else if (intent.throttle > 0.1 && forwardSpeed > -1) {
      this.reversing = false;
      this.reverseTimer = 0;
    }
  }

  private computeRearSlip(): number {
    const { rearAxleZ } = TUNING.vehicle.wheels;
    this.offset.copy(this.forward).multiplyScalar(rearAxleZ).add(this.position).sub(this.com);
    this.tmp.crossVectors(this.angular, this.offset).add(this.velocity);
    const rearForward = this.tmp.dot(this.forward);
    const rearLateral = this.tmp.dot(this.right);
    return Math.atan2(Math.abs(rearLateral), Math.max(Math.abs(rearForward), 1));
  }

  private updateDriftState(
    dt: number,
    intent: Intent,
    speedKmh: number,
    forwardSpeed: number,
    rearSlip: number,
  ): void {
    const drift = TUNING.vehicle.drift;
    const slipDeg = rearSlip * RAD2DEG;
    if (!this.drifting) {
      const fastEnough = speedKmh > drift.minSpeedKmh && forwardSpeed > 2;
      const powerThreshold = lerp(
        drift.enterSlipPowerDeg,
        drift.enterSlipPowerHighSpeedDeg,
        smoothstep(drift.highSpeedStartKmh, drift.highSpeedFullKmh, speedKmh),
      );
      const entering = intent.handbrake ? slipDeg > drift.enterSlipHandbrakeDeg : slipDeg > powerThreshold;
      if (fastEnough && entering) {
        this.drifting = true;
        this.driftExitTimer = 0;
      }
    } else {
      if (slipDeg < drift.exitSlipDeg && !intent.handbrake) this.driftExitTimer += dt;
      else this.driftExitTimer = 0;
      if (this.driftExitTimer > drift.exitTime || speedKmh < drift.minSpeedKmh * 0.7 || forwardSpeed < 0) {
        this.drifting = false;
      }
    }
  }

  private updateGripScales(dt: number, intent: Intent, driveInput: number, speed: number, bodySlip: number): void {
    const drift = TUNING.vehicle.drift;
    let rearTarget = 1;
    if (intent.handbrake && speed > 2) {
      rearTarget = drift.handbrakeRearGrip;
    } else if (this.drifting) {
      const hold = lerp(drift.holdGripOffThrottle, drift.holdGripFullThrottle, driveInput);
      const highSpeed = smoothstep(drift.highSpeedStartKmh, drift.highSpeedFullKmh, speed * 3.6);
      // Holding the wheel into the slide keeps it going; straight or counter-steer lets the car recover.
      const steerInto = intent.steer * -Math.sign(bodySlip);
      const holdWeight = smoothstep(drift.holdSteerMin, drift.holdSteerFull, steerInto);
      rearTarget = lerp(1, lerp(hold, drift.highSpeedHoldGrip, highSpeed), holdWeight);
    }
    // Past the soft angle the rear bites again, which is the natural way to stop a spin.
    const slipDeg = Math.abs(bodySlip) * RAD2DEG;
    rearTarget = lerp(rearTarget, 1, smoothstep(drift.softAngleDeg, drift.maxAngleDeg, slipDeg));
    const rate = rearTarget < this.rearGripScale ? drift.gripDropRate : drift.gripRecoverRate * (slipDeg > drift.softAngleDeg ? 4 : 1);
    this.rearGripScale = moveToward(this.rearGripScale, rearTarget, rate * dt);
    const frontTarget = this.drifting ? 1 + drift.frontGripBonus : 1;
    this.frontGripScale = moveToward(this.frontGripScale, frontTarget, drift.gripRecoverRate * dt);
  }

  private updateSteering(dt: number, intent: Intent, speed: number, forwardSpeed: number, bodySlip: number): void {
    const steering = TUNING.vehicle.steering;
    const wheels = TUNING.vehicle.wheels;
    const wheelbase = wheels.frontAxleZ - wheels.rearAxleZ;
    let target = intent.steer * speedLimitedSteerAngle(speed, wheelbase);
    if (!this.reversing && forwardSpeed > 0) {
      // Feeding slip angle into the steering is the auto counter-steer that makes keyboard drifts catchable.
      const assist = this.drifting ? steering.assistDrift : steering.assistNormal;
      const weight = smoothstep(steering.assistMinSpeed, steering.assistFullSpeed, speed);
      target += bodySlip * assist * weight;
    }
    const lock = steering.counterLockDeg * DEG2RAD;
    target = clamp(target, -lock, lock);
    this.steerAngle = moveToward(this.steerAngle, target, steering.rateDegPerSec * (this.profile.steerScale ?? 1) * DEG2RAD * dt);
    if (this.punctureLevel > 0) {
      // A flat tyre tugs at the wheel.
      this.wobbleTime += dt;
      this.steerAngle += Math.sin(this.wobbleTime * POLICE.puncture.wobbleHz * Math.PI * 2) * POLICE.puncture.wobbleRadians * this.punctureLevel;
    }
  }

  private updateNitro(dt: number, intent: Intent, forwardSpeed: number): void {
    const nitro = TUNING.vehicle.nitro;
    const wanted = intent.nitro && forwardSpeed > -0.5 && !this.reversing;
    const canBurn = this.nitroActive ? this.nitro > 0 : this.nitro >= nitro.minToStart;
    const active = wanted && canBurn;
    if (active && !this.nitroActive) this.bus?.emit('nitroStart', {});
    this.nitroActive = active;
    if (active) this.nitro = Math.max(0, this.nitro - nitro.burnPerSecond * dt);
    else this.nitro = Math.min(nitro.capacity, this.nitro + nitro.regenPerSecond * dt);
    if (this.drifting) this.nitro = Math.min(nitro.capacity, this.nitro + nitro.driftGainPerSecond * dt);
  }

  private drivenWheelSpeed(forwardSpeed: number): number {
    const radius = TUNING.vehicle.wheels.radius;
    const rearLeft = this.wheels[2];
    const rearRight = this.wheels[3];
    const fromWheels = ((rearLeft.spinRate + rearRight.spinRate) / 2) * radius;
    return Math.abs(fromWheels) > Math.abs(forwardSpeed) ? fromWheels : forwardSpeed;
  }

  /** Suspension and tyre forces for all wheels. Returns how many touch the ground. */
  private updateWheels(
    dt: number,
    intent: Intent,
    signedDriveForce: number,
    brakeInput: number,
    driveInput: number,
  ): number {
    const config = TUNING.vehicle;
    const { suspension, wheels: wheelConfig, tyre, brakes, engine } = config;
    const maxRay = suspension.restLength + wheelConfig.radius;
    const up = this.up;
    const staticLoad = (config.mass * TUNING.physics.gravity) / 4;
    const effectiveMass = config.mass * tyre.effectiveMassFraction;
    const comHeightAboveMount = this.tmp.copy(this.com).sub(this.position).dot(up) - wheelConfig.mountY;
    let grounded = 0;

    const sinSteer = Math.sin(this.steerAngle);
    const cosSteer = Math.cos(this.steerAngle);

    for (let i = 0; i < this.wheels.length; i++) {
      const wheel = this.wheels[i];
      this.mountWorld.copy(wheel.mountLocal).applyQuaternion(this.quaternion).add(this.position);

      this.ray.origin.x = this.mountWorld.x;
      this.ray.origin.y = this.mountWorld.y;
      this.ray.origin.z = this.mountWorld.z;
      this.ray.dir.x = -up.x;
      this.ray.dir.y = -up.y;
      this.ray.dir.z = -up.z;
      const hit = this.physics.world.castRayAndGetNormal(
        this.ray,
        maxRay,
        true,
        undefined,
        GROUP_WHEEL_RAY,
        undefined,
        this.body,
      );

      wheel.compressionPrev = wheel.compression;
      if (!hit) {
        wheel.contact = false;
        wheel.compression = 0;
        wheel.load = 0;
        wheel.slip = 0;
        wheel.springLength = suspension.restLength;
        this.updateAirborneSpin(wheel, intent, driveInput, dt);
        continue;
      }

      grounded++;
      wheel.contact = true;
      const distance = hit.timeOfImpact;
      wheel.compression = maxRay - distance;
      wheel.springLength = Math.max(0, distance - wheelConfig.radius);
      wheel.contactPoint.copy(this.mountWorld).addScaledVector(up, -distance);

      // Spring, damper, anti-roll bar and bump stop.
      const compressionSpeed = clamp(
        (wheel.compression - wheel.compressionPrev) / dt,
        -suspension.compressionSpeedClamp,
        suspension.compressionSpeedClamp,
      );
      const partner = this.wheels[i ^ 1];
      let suspensionForce =
        suspension.stiffness * wheel.compression +
        suspension.damping * compressionSpeed +
        suspension.antiRoll * (wheel.compression - partner.compression);
      if (wheel.compression > suspension.maxCompression) {
        suspensionForce += suspension.bumpStiffness * (wheel.compression - suspension.maxCompression);
      }
      suspensionForce = clamp(suspensionForce, 0, suspension.maxForce);
      wheel.load = suspensionForce;
      this.applyImpulse(up, suspensionForce * dt, this.mountWorld);

      // Tyre frame at the contact patch.
      const normal = up;
      if (wheel.isFront) {
        this.wheelForward.copy(this.forward).multiplyScalar(cosSteer).addScaledVector(this.right, sinSteer);
      } else {
        this.wheelForward.copy(this.forward);
      }
      this.wheelForward.addScaledVector(normal, -this.wheelForward.dot(normal)).normalize();
      this.wheelRight.crossVectors(this.wheelForward, normal);

      this.offset.copy(wheel.contactPoint).sub(this.com);
      this.pointVelocity.crossVectors(this.angular, this.offset).add(this.velocity);
      const vForward = this.pointVelocity.dot(this.wheelForward);
      const vSide = this.pointVelocity.dot(this.wheelRight);

      const surfaceKind = this.physics.surfaceAt(hit.collider.handle, wheel.contactPoint.x, wheel.contactPoint.z, wheel.contactPoint.y);
      wheel.surface = surfaceKind;
      const surface = TUNING.surfaces[surfaceKind];
      // Fast tyres start to ride up on standing water, and the steering goes light.
      const inWater = surfaceKind === 'flood';
      const floating = inWater ? 1 + (ATMOSPHERE.aquaplaneGrip - 1) * smoothstep(ATMOSPHERE.aquaplaneFrom, ATMOSPHERE.aquaplaneFull, Math.abs(vForward)) : 1;
      const gripLoad = Math.min(suspensionForce, staticLoad * tyre.loadCap);
      const gripScale = wheel.isFront ? tyre.frontGrip * this.frontGripScale : tyre.rearGrip * this.rearGripScale;
      const available = surface.grip * this.physics.weatherGrip * floating * gripLoad * gripScale * this.profile.gripScale * (1 - POLICE.puncture.gripLoss * this.punctureLevel);

      // Longitudinal: engine, brake, handbrake, then resistance when coasting.
      const noOvershootLong = (Math.abs(vForward) * effectiveMass) / dt;
      let longForce = 0;
      const driveShare = wheel.isFront ? engine.frontBias / 2 : (1 - engine.frontBias) / 2;
      longForce += signedDriveForce * driveShare;
      let opposing = 0;
      if (brakeInput > 0) {
        const brakeShare = wheel.isFront ? brakes.frontBias / 2 : (1 - brakes.frontBias) / 2;
        opposing += brakeInput * brakes.force * (this.profile.brakeScale ?? 1) * brakeShare;
      }
      if (intent.handbrake && !wheel.isFront) opposing += brakes.handbrakeForce / 2;
      if (driveInput < 0.05) opposing += (engine.rollingResistance + engine.engineBrake) / 4;
      opposing += surface.drag / 4;
      if (inWater) opposing += ATMOSPHERE.floodDragPerSpeed2 * vForward * vForward;
      longForce -= Math.sign(vForward) * Math.min(opposing, noOvershootLong);
      const longLimit = available * tyre.longitudinalGripScale;
      longForce = clamp(longForce, -longLimit, longLimit);

      // Lateral: linear with slip, capped by the falling grip curve and the friction circle.
      const slipAngle = Math.atan2(Math.abs(vSide), Math.max(Math.abs(vForward), tyre.lowSpeedReference));
      const slideRatio = wheel.isFront ? tyre.slideRatioFront : tyre.slideRatioRear;
      const gripCurve = lateralGripCurve(slipAngle, slideRatio);
      const usedByLong = longForce * tyre.frictionCircleWeight;
      const remaining = Math.sqrt(Math.max(available * available - usedByLong * usedByLong, 0));
      let latForce = Math.min(tyre.corneringStiffness * slipAngle, available * gripCurve, remaining);
      latForce = Math.min(latForce, (Math.abs(vSide) * effectiveMass) / dt);
      latForce *= -Math.sign(vSide);

      // Forces act above the contact patch so the chassis stays planted; the rig shows the roll.
      const lift = comHeightAboveMount + distance;
      this.applyPoint.copy(wheel.contactPoint).addScaledVector(up, lift * tyre.lateralForceHeight);
      this.applyImpulse(this.wheelRight, latForce * dt, this.applyPoint);
      this.applyPoint.copy(wheel.contactPoint).addScaledVector(up, lift * tyre.longitudinalForceHeight);
      this.applyImpulse(this.wheelForward, longForce * dt, this.applyPoint);

      this.updateContactSpin(wheel, intent, driveInput, vForward, dt);
      this.updateSlipMetric(wheel, vSide, vForward, intent);
    }
    return grounded;
  }

  private updateContactSpin(wheel: WheelState, intent: Intent, driveInput: number, vForward: number, dt: number): void {
    const wheelConfig = TUNING.vehicle.wheels;
    let target = vForward / wheelConfig.radius;
    if (!wheel.isFront) {
      if (intent.handbrake) target = 0;
      else if (driveInput > 0.8 && Math.abs(vForward) < wheelConfig.burnoutMaxSpeed) {
        target += (this.reversing ? -1 : 1) * wheelConfig.burnoutSpin * (1 - Math.abs(vForward) / wheelConfig.burnoutMaxSpeed);
      }
    }
    wheel.spinRate += (target - wheel.spinRate) * Math.min(1, 18 * dt);
    wheel.spinAngle += wheel.spinRate * dt;
  }

  private updateAirborneSpin(wheel: WheelState, intent: Intent, driveInput: number, dt: number): void {
    if (!wheel.isFront && intent.handbrake) wheel.spinRate = 0;
    else if (!wheel.isFront && driveInput > 0.5) wheel.spinRate += 40 * dt;
    wheel.spinRate *= 1 - 0.4 * dt;
    wheel.spinAngle += wheel.spinRate * dt;
  }

  private updateSlipMetric(wheel: WheelState, vSide: number, vForward: number, intent: Intent): void {
    const radius = TUNING.vehicle.wheels.radius;
    const sideSlip = Math.max(0, (Math.abs(vSide) - 1.6) / 6);
    const spinDifference = Math.abs(wheel.spinRate * radius - vForward);
    let longSlip = Math.max(0, (spinDifference - 2.5) / 8);
    if (!wheel.isFront && intent.handbrake && Math.abs(vForward) > 2) longSlip = Math.max(longSlip, 0.6);
    wheel.slip = Math.max(sideSlip, longSlip);
  }

  private applyAero(dt: number, forwardSpeed: number, speed: number, grounded: number): void {
    const aero = TUNING.vehicle.aero;
    if (speed > 0.1) {
      const drag = aero.dragCoefficient * speed * dt;
      this.impulseOut.x = -this.velocity.x * drag;
      this.impulseOut.y = -this.velocity.y * drag;
      this.impulseOut.z = -this.velocity.z * drag;
      this.body.applyImpulse(this.impulseOut, true);
    }
    if (grounded > 0) {
      this.impulseAtCom(this.up, -aero.downforceCoefficient * forwardSpeed * forwardSpeed * dt);
    }
  }

  /** Extra arcade forces while sliding: steering authority, spin limiter, speed keep. */
  private applyDriftForces(dt: number, intent: Intent, driveInput: number, bodySlip: number, speed: number): void {
    const { drift, stability } = TUNING.vehicle;
    const yawRate = this.angular.dot(this.up);
    let yawTorque = 0;

    const handbrakeJustPulled = intent.handbrake && !this.handbrakeWasHeld;
    this.handbrakeWasHeld = intent.handbrake;
    if (handbrakeJustPulled && speed > 8 && Math.abs(intent.steer) > 0.1) {
      yawTorque -= (Math.sign(intent.steer) * drift.handbrakeYawKick) / dt;
    }

    if (this.drifting || intent.handbrake) {
      const slipDeg = Math.abs(bodySlip) * RAD2DEG;
      // Steering stops pushing the slide wider as it reaches the soft angle.
      const steerAuthority = 1 - smoothstep(drift.softAngleDeg * 0.7, drift.softAngleDeg, slipDeg);
      yawTorque -= intent.steer * drift.steerTorque * steerAuthority;
      yawTorque -= yawRate * drift.yawDamping;
      const excessRate = Math.abs(yawRate) - drift.maxYawRate;
      if (excessRate > 0) yawTorque -= Math.sign(yawRate) * excessRate * drift.yawRateLimitGain;
      if (slipDeg > drift.softAngleDeg) {
        yawTorque -= Math.sign(bodySlip) * (slipDeg - drift.softAngleDeg) * drift.limiterTorquePerDeg;
      }
      if (this.drifting && driveInput > 0.05 && speed > 1) {
        this.tmp.copy(this.velocity).normalize();
        this.impulseAtCom(this.tmp, drift.thrust * driveInput * dt);
      }
    } else if (speed > stability.minSpeed && !this.reversing) {
      const yawLimit = stability.lateralLimit / speed;
      const excess = Math.abs(yawRate) - yawLimit;
      if (excess > 0) yawTorque -= Math.sign(yawRate) * excess * stability.gain;
    }

    if (yawTorque !== 0) {
      this.impulseOut.x = this.up.x * yawTorque * dt;
      this.impulseOut.y = this.up.y * yawTorque * dt;
      this.impulseOut.z = this.up.z * yawTorque * dt;
      this.body.applyTorqueImpulse(this.impulseOut, true);
    }
  }

  private applyAirControl(dt: number, intent: Intent): void {
    const air = TUNING.vehicle.air;
    const inertia = TUNING.vehicle.inertia;
    const damping = Math.min(1, air.angularDamping * dt);
    this.impulseOut.x = -this.angular.x * inertia.pitch * damping;
    this.impulseOut.y = -this.angular.y * inertia.yaw * damping;
    this.impulseOut.z = -this.angular.z * inertia.roll * damping;
    this.body.applyTorqueImpulse(this.impulseOut, true);
    this.applyLeveling(dt, air.levelTorque);
    if (intent.steer !== 0) {
      const yaw = -intent.steer * air.yawControlTorque * dt;
      this.impulseOut.x = this.up.x * yaw;
      this.impulseOut.y = this.up.y * yaw;
      this.impulseOut.z = this.up.z * yaw;
      this.body.applyTorqueImpulse(this.impulseOut, true);
    }
  }

  /** Torque that rotates the car's up vector toward world up. */
  private applyLeveling(dt: number, torque: number): void {
    this.tmp.crossVectors(this.up, WORLD_UP);
    this.impulseOut.x = this.tmp.x * torque * dt;
    this.impulseOut.y = this.tmp.y * torque * dt;
    this.impulseOut.z = this.tmp.z * torque * dt;
    this.body.applyTorqueImpulse(this.impulseOut, true);
  }

  private updateTelemetry(
    dt: number,
    intent: Intent,
    speed: number,
    forwardSpeed: number,
    bodySlip: number,
    rearSlip: number,
    grounded: number,
    brakeInput: number,
  ): void {
    const telemetry = this.telemetry;
    this.force.copy(this.velocity).sub(this.prevVelocity).divideScalar(dt);
    this.prevVelocity.copy(this.velocity);
    const smoothing = Math.min(1, 12 * dt);
    this.longitudinalAccel += (this.force.dot(this.forward) - this.longitudinalAccel) * smoothing;
    this.lateralAccel += (this.force.dot(this.right) - this.lateralAccel) * smoothing;

    let maxSlip = 0;
    for (const wheel of this.wheels) maxSlip = Math.max(maxSlip, wheel.slip);

    telemetry.speed = speed;
    telemetry.speedKmh = speed * 3.6;
    telemetry.forwardSpeed = forwardSpeed;
    telemetry.rpm = this.powertrain.rpm;
    telemetry.gear = this.reversing ? -1 : this.powertrain.gear;
    telemetry.isShifting = this.powertrain.isShifting;
    telemetry.throttle = intent.throttle;
    telemetry.brake = brakeInput;
    telemetry.handbrake = intent.handbrake;
    telemetry.reversing = this.reversing;
    telemetry.steerInput = intent.steer;
    telemetry.steerAngle = this.steerAngle;
    telemetry.nitro = this.nitro;
    telemetry.nitroActive = this.nitroActive;
    telemetry.slipAngleDeg = bodySlip * RAD2DEG;
    telemetry.rearSlipDeg = rearSlip * RAD2DEG;
    telemetry.drifting = this.drifting;
    telemetry.groundedWheels = grounded;
    telemetry.longitudinalAccel = this.longitudinalAccel;
    telemetry.lateralAccel = this.lateralAccel;
    telemetry.maxSlip = maxSlip;
    telemetry.upY = this.up.y;
    telemetry.puncture = this.punctureLevel;
  }

  private applyImpulse(direction: Vector3, magnitude: number, point: Vector3): void {
    this.impulseOut.x = direction.x * magnitude;
    this.impulseOut.y = direction.y * magnitude;
    this.impulseOut.z = direction.z * magnitude;
    this.pointOut.x = point.x;
    this.pointOut.y = point.y;
    this.pointOut.z = point.z;
    this.body.applyImpulseAtPoint(this.impulseOut, this.pointOut, true);
  }

  private impulseAtCom(direction: Vector3, magnitude: number): void {
    this.impulseOut.x = direction.x * magnitude;
    this.impulseOut.y = direction.y * magnitude;
    this.impulseOut.z = direction.z * magnitude;
    this.body.applyImpulse(this.impulseOut, true);
  }
}
