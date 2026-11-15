/**
 * Everything that makes the car look alive and has no effect on physics:
 * body roll and pitch on springs, wheel travel, steering, spin, lights, flames.
 */

import { Color, MeshBasicMaterial, PointLight, SpotLight, type Object3D, type Quaternion, type Vector3 } from 'three';
import { TUNING, type QualityPreset } from '../config/tuning';
import { clamp, damp, noise1D } from '../core/math';
import { PLAYER_FIELDS as F } from '../replay/replay-buffer';
import type { VehicleController } from '../vehicle/vehicle-controller';
import type { CarVisual } from '../vehicle/car-models';

class Spring {
  value = 0;
  velocity = 0;

  update(target: number, frequency: number, damping: number, dt: number): void {
    const acceleration = frequency * frequency * (target - this.value) - 2 * damping * frequency * this.velocity;
    this.velocity += acceleration * dt;
    this.value += this.velocity * dt;
  }
}

const COLOR_TAIL = new Color(1, 0.07, 0.03);
const COLOR_HEADLIGHT = new Color(1, 0.93, 0.78);
const COLOR_REVERSE = new Color(1, 0.96, 0.88);
const COLOR_INDICATOR = new Color(1, 0.55, 0.04);

export class VehicleRig {
  private readonly roll = new Spring();
  private readonly pitch = new Spring();
  private readonly wheelTravel = [0, 0, 0, 0];
  private time = 0;
  private backfire = 0;
  private nitroVisual = 0;
  private spot: SpotLight | null = null;
  private nitroLight: PointLight | null = null;
  private reduceMotion = false;
  private readonly spotBase: number = TUNING.rig.headlightSpotIntensity;
  /** Headlights and underglow matter far less in broad daylight. */
  daylight = 0;

  constructor(
    readonly visual: CarVisual,
    preset: QualityPreset,
  ) {
    const rig = TUNING.rig;
    if (preset.headlightSpot) {
      const spot = new SpotLight(
        COLOR_HEADLIGHT.getHex(),
        rig.headlightSpotIntensity,
        rig.headlightSpotDistance,
        (rig.headlightSpotAngleDeg * Math.PI) / 180,
        rig.headlightSpotPenumbra,
        rig.headlightSpotDecay,
      );
      spot.position.set(0, 0.25, 1.7);
      spot.target.position.set(0, -0.9, 26);
      visual.root.add(spot, spot.target);
      this.spot = spot;
    }
    if (preset.nitroLight) {
      const light = new PointLight(0xff8a2a, 0, 16, 1.6);
      light.position.set(0, -0.15, -2.6);
      visual.root.add(light);
      this.nitroLight = light;
    }
  }

  /** Lets reflections light the car too, since lights must share a layer with the camera. */
  get lights(): Object3D[] {
    const lights: Object3D[] = [];
    if (this.spot) lights.push(this.spot);
    if (this.nitroLight) lights.push(this.nitroLight);
    return lights;
  }

  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
  }

  triggerBackfire(): void {
    this.backfire = TUNING.rig.backfireDuration;
  }

  addImpactWobble(strength: number): void {
    if (this.reduceMotion) return;
    const amount = TUNING.rig.impactWobble * clamp(strength, 0, 1);
    this.roll.velocity += amount * 18 * (this.time % 2 < 1 ? 1 : -1);
    this.pitch.velocity += amount * 12;
  }

  update(dt: number, car: VehicleController, position: Vector3, quaternion: Quaternion): void {
    const rig = TUNING.rig;
    const t = car.telemetry;
    this.time += dt;
    const stepDt = Math.min(dt, 1 / 30);

    const { root, bodyPivot, wheels } = this.visual;
    root.position.copy(position);
    root.quaternion.copy(quaternion);

    // Body leans away from the turn and squats or dives with acceleration.
    const motionScale = this.reduceMotion ? 0.35 : 1;
    const rollTarget = clamp(-t.lateralAccel * rig.rollPerAccel, -rig.maxRoll, rig.maxRoll) * motionScale;
    const pitchTarget = clamp(-t.longitudinalAccel * rig.pitchPerAccel, -rig.maxPitch, rig.maxPitch) * motionScale;
    this.roll.update(rollTarget, rig.springFrequency, rig.springDamping, stepDt);
    this.pitch.update(pitchTarget, rig.springFrequency, rig.springDamping, stepDt);
    bodyPivot.rotation.z = this.roll.value;
    bodyPivot.rotation.x = this.pitch.value;

    // Wheels follow suspension travel, front wheels steer, all of them spin.
    for (let i = 0; i < wheels.length; i++) {
      const state = car.wheels[i];
      const wheel = wheels[i];
      this.wheelTravel[i] = damp(this.wheelTravel[i], state.springLength, rig.wheelSmoothing, dt);
      wheel.steer.position.y = state.mountLocal.y - this.wheelTravel[i];
      wheel.steer.rotation.y = state.isFront ? -t.steerAngle : 0;
      wheel.spin.rotation.x = state.spinAngle;
    }

    this.updateLights(t.brake > 0.05, t.reversing, t.steerInput, t.speedKmh, t.nitroActive, dt);
  }

  /** Poses the car from a replay frame, instead of from the physics. */
  applyReplay(dt: number, position: Vector3, quaternion: Quaternion, values: Float32Array, car: VehicleController, spin: number): void {
    const rig = TUNING.rig;
    this.time += dt;
    const stepDt = Math.min(dt, 1 / 30);
    const { root, bodyPivot, wheels } = this.visual;
    root.position.copy(position);
    root.quaternion.copy(quaternion);
    const motionScale = this.reduceMotion ? 0.35 : 1;
    this.roll.update(clamp(-values[F.lateral] * rig.rollPerAccel, -rig.maxRoll, rig.maxRoll) * motionScale, rig.springFrequency, rig.springDamping, stepDt);
    this.pitch.update(clamp(-values[F.longitudinal] * rig.pitchPerAccel, -rig.maxPitch, rig.maxPitch) * motionScale, rig.springFrequency, rig.springDamping, stepDt);
    bodyPivot.rotation.z = this.roll.value;
    bodyPivot.rotation.x = this.pitch.value;
    for (let i = 0; i < wheels.length; i++) {
      const state = car.wheels[i];
      wheels[i].steer.position.y = state.mountLocal.y - values[F.wheel0 + i];
      wheels[i].steer.rotation.y = state.isFront ? -values[F.steer] : 0;
      wheels[i].spin.rotation.x = spin;
    }
    this.updateLights(values[F.brake] > 0.05, values[F.reversing] > 0.5, 0, values[F.speed] * 3.6, values[F.nitro] > 0.5, dt);
  }

  private updateLights(
    braking: boolean,
    reversing: boolean,
    steer: number,
    speedKmh: number,
    nitroActive: boolean,
    dt: number,
  ): void {
    const rig = TUNING.rig;
    const visual = this.visual;
    setGlow(visual.headlightMaterial, COLOR_HEADLIGHT, rig.headlightEmissive);
    setGlow(visual.tailMaterial, COLOR_TAIL, braking ? rig.tailLightBrake : rig.tailLightIdle);
    setGlow(visual.reverseMaterial, COLOR_REVERSE, reversing ? rig.reverseLight : 0.04);

    const blinkOn = Math.sin(this.time * rig.indicatorHz * Math.PI * 2) > 0;
    const slowEnough = speedKmh < rig.indicatorMaxSpeed;
    const turningLeft = slowEnough && steer < -rig.indicatorMinSteer;
    const turningRight = slowEnough && steer > rig.indicatorMinSteer;
    setGlow(visual.indicatorLeft, COLOR_INDICATOR, turningLeft && blinkOn ? 5 : 0.12);
    setGlow(visual.indicatorRight, COLOR_INDICATOR, turningRight && blinkOn ? 5 : 0.12);

    // The underglow is a cheap neon tube: mostly steady, with a nervous flicker.
    const glow = visual.underglow.material as MeshBasicMaterial;
    const flicker = 0.88 + 0.12 * noise1D(this.time * rig.underglowFlickerHz);
    glow.opacity = rig.underglowOpacity * (this.reduceMotion ? 1 : flicker) * (1 - this.daylight * 0.8);
    if (this.spot) this.spot.intensity = this.spotBase * (1 - this.daylight * 0.85);

    // Flames.
    this.nitroVisual = damp(this.nitroVisual, nitroActive ? 1 : 0, nitroActive ? 16 : 11, dt);
    if (this.backfire > 0) this.backfire -= dt;
    const pop = this.backfire > 0 ? 0.55 : 0;
    const flameAmount = Math.max(this.nitroVisual, pop);
    const visible = flameAmount > 0.02;
    for (let i = 0; i < visual.flames.length; i++) {
      const flame = visual.flames[i];
      flame.outer.visible = visible;
      flame.inner.visible = visible;
      if (!visible) continue;
      const wobble = 1 + 0.26 * noise1D(this.time * 47 + i * 3.1);
      const length = rig.flameLengthNitro * flameAmount * wobble;
      const width = rig.flameWidthNitro * (0.55 + 0.45 * flameAmount) * (2 - wobble);
      flame.outer.scale.set(width, width, length);
      flame.inner.scale.set(width * 0.5, width * 0.5, length * 0.62);
    }

    if (this.nitroLight) {
      this.nitroLight.intensity = rig.nitroLightIntensity * flameAmount;
    }
  }
}

function setGlow(material: MeshBasicMaterial, base: Color, intensity: number): void {
  material.color.copy(base).multiplyScalar(intensity);
}
