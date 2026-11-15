/**
 * Camera for Phase 1: chase, far chase, hood, plus the slow title-screen orbit.
 * The chase camera blends toward the direction of travel so a drift shows the car's side,
 * and it pulls back under acceleration, which is most of the sense of speed.
 */

import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { TUNING } from '../config/tuning';
import { clamp, dampFactor, lerp, noise1D, smoothstep } from '../core/math';
import type { VehicleTelemetry } from '../vehicle/vehicle-controller';

export type CameraMode = 'chase' | 'far' | 'hood';
const MODES: CameraMode[] = ['chase', 'far', 'hood'];
const UP = new Vector3(0, 1, 0);

export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  mode: CameraMode = 'chase';

  private readonly heading = new Vector3(0, 0, 1);
  private readonly forward = new Vector3();
  private readonly travel = new Vector3();
  private readonly desired = new Vector3();
  private readonly look = new Vector3();
  private readonly lookSmoothed = new Vector3();
  private readonly side = new Vector3();
  private smoothedAccel = 0;
  private height = TUNING.camera.chase.height;
  private shakeTime = 0;
  private impact = 0;
  private fov = TUNING.camera.chase.fovBase;
  private roll = 0;
  private titleAngle = 2.5;
  private initialised = false;
  private reduceMotion = false;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(TUNING.camera.chase.fovBase, aspect, 0.3, 3600);
  }

  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
  }

  nextMode(): void {
    this.mode = MODES[(MODES.indexOf(this.mode) + 1) % MODES.length];
    this.initialised = false;
  }

  addImpact(strength: number): void {
    if (this.reduceMotion) return;
    this.impact = Math.min(1, this.impact + clamp(strength, 0, 1));
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Snaps to the car instead of smoothing, for example after a reset. */
  snap(): void {
    this.initialised = false;
  }

  /** Slow orbit behind the title screen. The car sits to the right of the menu board. */
  updateTitle(dt: number, carPosition: Vector3): void {
    const config = TUNING.camera.title;
    if (!this.reduceMotion) this.titleAngle += config.orbitSpeed * dt;
    const camera = this.camera;
    // Tall screens stack the board under the car: back away so it fits, and frame it high.
    const stacked = camera.aspect <= 1.1;
    const radius = stacked ? config.radius * Math.min(1.1 / camera.aspect, config.stackedMaxZoomOut) : config.radius;
    camera.position.set(
      carPosition.x + Math.sin(this.titleAngle) * radius,
      carPosition.y + config.height,
      carPosition.z + Math.cos(this.titleAngle) * radius,
    );
    this.side.set(Math.cos(this.titleAngle), 0, -Math.sin(this.titleAngle));
    const offset = stacked ? 0 : config.lookOffsetX;
    const lookY = carPosition.y + (stacked ? config.stackedLookDown * (radius / config.radius) : 0.15);
    camera.lookAt(carPosition.x + this.side.x * offset, lookY, carPosition.z + this.side.z * offset);
    if (camera.fov !== config.fov) {
      camera.fov = config.fov;
      camera.updateProjectionMatrix();
    }
    this.fov = config.fov;
    this.initialised = false;
  }

  update(
    dt: number,
    carPosition: Vector3,
    carQuaternion: Quaternion,
    velocity: Vector3,
    telemetry: VehicleTelemetry,
    lookBack: boolean,
  ): void {
    if (this.mode === 'hood') this.updateHood(dt, carPosition, carQuaternion, telemetry, lookBack);
    else this.updateChase(dt, carPosition, carQuaternion, velocity, telemetry, lookBack);
    this.applyShake(dt, telemetry);
  }

  private updateChase(
    dt: number,
    carPosition: Vector3,
    carQuaternion: Quaternion,
    velocity: Vector3,
    telemetry: VehicleTelemetry,
    lookBack: boolean,
  ): void {
    const config = TUNING.camera.chase;
    const far = this.mode === 'far';
    const tall = this.camera.aspect < 1;
    const distanceScale = (far ? TUNING.camera.far.distanceScale : 1) * (tall ? TUNING.camera.portrait.distanceScale : 1);
    const heightScale = (far ? TUNING.camera.far.heightScale : 1) * (tall ? TUNING.camera.portrait.heightScale : 1);
    const speed = telemetry.speed;

    this.forward.set(0, 0, 1).applyQuaternion(carQuaternion);
    this.forward.y = 0;
    this.forward.normalize();

    // Heading blends from the nose toward the direction of travel as speed builds.
    this.travel.copy(velocity);
    this.travel.y = 0;
    let follow = 0;
    if (speed > 1 && telemetry.forwardSpeed > 0) {
      this.travel.normalize();
      follow = config.velocityFollow * smoothstep(4, 14, speed);
    }
    this.desired.copy(this.forward).multiplyScalar(1 - follow).addScaledVector(this.travel, follow);
    if (this.desired.lengthSq() < 0.0001) this.desired.copy(this.forward);
    this.desired.normalize();

    if (!this.initialised) {
      this.heading.copy(this.desired);
      this.height = carPosition.y + config.height * heightScale;
      this.lookSmoothed.copy(carPosition);
    } else {
      this.heading.lerp(this.desired, dampFactor(config.yawStiffness, dt)).normalize();
    }

    this.smoothedAccel += (telemetry.longitudinalAccel - this.smoothedAccel) * dampFactor(config.accelerationSmoothing, dt);

    const speedFraction = clamp(speed / 60, 0, 1);
    const pull = this.reduceMotion ? 0 : clamp(this.smoothedAccel * config.accelerationPull, -0.5, 0.75);
    const distance = (config.distance + config.speedDistance * speedFraction + pull) * distanceScale;
    const direction = lookBack ? -1 : 1;

    this.desired.copy(carPosition).addScaledVector(this.heading, -distance * direction);
    const targetHeight = carPosition.y + config.height * heightScale;
    this.height += (targetHeight - this.height) * dampFactor(config.heightStiffness, dt);
    this.desired.y = this.height;

    const camera = this.camera;
    if (!this.initialised) camera.position.copy(this.desired);
    else camera.position.lerp(this.desired, dampFactor(config.positionStiffness, dt));

    // Look a little into the corner.
    this.side.crossVectors(this.heading, UP);
    this.look.copy(carPosition).addScaledVector(this.heading, config.lookAhead * direction);
    this.look.y = carPosition.y + config.lookHeight;
    this.look.addScaledVector(this.side, telemetry.steerInput * config.steerLookOffset * direction);
    if (!this.initialised) this.lookSmoothed.copy(this.look);
    else this.lookSmoothed.lerp(this.look, dampFactor(14, dt));
    camera.lookAt(this.lookSmoothed);

    const rollTarget = this.reduceMotion ? 0 : -telemetry.lateralAccel * config.rollPerLateralAccel;
    this.roll += (rollTarget - this.roll) * dampFactor(6, dt);
    camera.rotateZ(this.roll);

    this.updateFov(dt, config.fovBase, config.fovSpeed, speedFraction, telemetry.nitroActive);
    this.initialised = true;
  }

  private updateHood(
    dt: number,
    carPosition: Vector3,
    carQuaternion: Quaternion,
    telemetry: VehicleTelemetry,
    lookBack: boolean,
  ): void {
    const config = TUNING.camera.hood;
    const camera = this.camera;
    camera.position.set(0, config.y, config.z).applyQuaternion(carQuaternion).add(carPosition);
    this.look.set(0, config.y - 0.6, lookBack ? -config.lookAhead : config.lookAhead);
    this.look.applyQuaternion(carQuaternion).add(carPosition);
    camera.lookAt(this.look);
    this.updateFov(dt, config.fovBase, config.fovSpeed, clamp(telemetry.speed / 60, 0, 1), telemetry.nitroActive);
    this.initialised = false;
  }

  private updateFov(dt: number, base: number, perSpeed: number, speedFraction: number, nitro: boolean): void {
    const config = TUNING.camera.chase;
    const motion = this.reduceMotion ? 0.25 : 1;
    const target = base + (perSpeed * speedFraction * speedFraction + (nitro ? config.fovNitro : 0)) * motion;
    this.fov = lerp(this.fov, target, dampFactor(config.fovStiffness, dt));
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  private applyShake(dt: number, telemetry: VehicleTelemetry): void {
    const config = TUNING.camera.shake;
    this.impact *= Math.exp(-config.impactDecay * dt);
    if (this.reduceMotion) return;
    this.shakeTime += dt * config.frequency;
    const speedPart = Math.max(0, telemetry.speed - config.speedStart) / 40;
    const amount =
      speedPart * config.speedAmount + (telemetry.nitroActive ? config.nitroAmount : 0) + this.impact * config.impactAmount;
    if (amount < 0.0005) return;
    const camera = this.camera;
    camera.position.x += noise1D(this.shakeTime) * amount;
    camera.position.y += noise1D(this.shakeTime * 1.3 + 7) * amount * 0.7;
    camera.rotateZ(noise1D(this.shakeTime * 0.8 + 3) * amount * 0.04);
  }
}
