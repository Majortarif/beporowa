/** Draws the fleet: cars, wheels, flashing lamps, spike strips, the helicopter and the drone. */

import {
  AdditiveBlending,
  BoxGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Quaternion,
  Vector3,
  type Scene,
} from 'three';
import { POLICE } from '../config/police-tuning';
import { TUNING, type QualityPreset } from '../config/tuning';
import { dampFactor } from '../core/math';
import { useBakedGlow } from '../render/model-builder';
import { REFLECT_LAYER, enableReflection } from '../render/planar-reflection';
import type { AirUnit } from './air-support';
import {
  LAMP_OFFSETS,
  buildDrone,
  buildHelicopterBody,
  buildPoliceCar,
  buildPoliceWheel,
  buildRotor,
  buildSpikeStrip,
  buildTailRotor,
  createPoliceAtlas,
} from './police-models';
import type { PoliceSystem } from './police-system';

const position = new Vector3();
const offset = new Vector3();
const quaternion = new Quaternion();
const previous = new Quaternion();
const steer = new Quaternion();
const spin = new Quaternion();
const matrix = new Matrix4();
const scale = new Vector3(1, 1, 1);
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
const scratchColor = new Color();

const RED_ON = new Color(7, 0.32, 0.18);
const RED_OFF = new Color(0.28, 0.03, 0.03);
const BLUE_ON = new Color(0.3, 1.1, 8);
const BLUE_OFF = new Color(0.03, 0.05, 0.3);
const PARKED_WHEEL_DROP = TUNING.vehicle.suspension.restLength;
const FLASH_RATE = 7.5;

export class PoliceRender {
  private readonly bodies: InstancedMesh;
  private readonly wheels: InstancedMesh;
  private readonly lamps: InstancedMesh;
  private readonly strips: InstancedMesh;
  private readonly light: PointLight | null;
  private readonly helicopter = new Group();
  private readonly rotor: Mesh;
  private readonly tailRotor: Mesh;
  private readonly spotBeam: Mesh;
  private readonly spotPool: Mesh;
  private readonly drone: Mesh;
  private readonly droneLamp: Mesh;
  private readonly droneLampMaterial: MeshBasicMaterial;
  private readonly heliX = new Smoothed();
  private readonly droneX = new Smoothed();
  private time = 0;
  private lightOn = 0;
  /** Flashes per second. */
  private flashRate = FLASH_RATE;
  private calmLight = false;

  constructor(scene: Scene, private readonly police: PoliceSystem, preset: QualityPreset) {
    const atlas = createPoliceAtlas(preset.anisotropy);
    const material = useBakedGlow(new MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.42, metalness: 0.15 }));
    const capacity = police.units.length + police.parked.length;

    this.bodies = new InstancedMesh(buildPoliceCar(), material, capacity);
    this.bodies.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.bodies.frustumCulled = false;
    this.bodies.count = 0;
    scene.add(this.bodies);

    this.wheels = new InstancedMesh(buildPoliceWheel(TUNING.vehicle.wheels.radius), material, capacity * 4);
    this.wheels.frustumCulled = false;
    this.wheels.count = 0;
    scene.add(this.wheels);

    this.lamps = new InstancedMesh(new BoxGeometry(0.56, 0.12, 0.24), new MeshBasicMaterial({ toneMapped: false }), capacity * 2);
    this.lamps.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 2 * 3), 3);
    this.lamps.frustumCulled = false;
    this.lamps.count = 0;
    enableReflection(this.lamps);
    scene.add(this.lamps);
    if (preset.trafficReflections) enableReflection(this.bodies);

    this.strips = new InstancedMesh(buildSpikeStrip(), material, police.strips.length);
    this.strips.frustumCulled = false;
    this.strips.count = 0;
    scene.add(this.strips);

    // One real light, on the nearest unit, so the flashing washes over wet road and walls.
    if (preset.policeLight) {
      this.light = new PointLight(0xffffff, 0, 34, 1.7);
      this.light.layers.enable(REFLECT_LAYER);
      scene.add(this.light);
    } else {
      this.light = null;
    }

    const plain = useBakedGlow(new MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.5, metalness: 0.2 }));
    const heliBody = new Mesh(buildHelicopterBody(), plain);
    this.rotor = new Mesh(buildRotor(), plain);
    this.rotor.position.set(0, 1.28, 0.2);
    this.tailRotor = new Mesh(buildTailRotor(), plain);
    this.tailRotor.position.set(0.16, 1, -6.7);
    this.helicopter.add(heliBody, this.rotor, this.tailRotor);
    this.helicopter.visible = false;
    this.helicopter.traverse((child) => {
      child.frustumCulled = false;
    });
    scene.add(this.helicopter);

    // The searchlight: a soft cone, and a pool of light where it lands.
    const beam = new ConeGeometry(1, 1, 18, 1, true);
    beam.translate(0, -0.5, 0);
    beam.rotateX(Math.PI);
    this.spotBeam = new Mesh(
      beam,
      new MeshBasicMaterial({ color: new Color(0.85, 0.82, 0.62), transparent: true, opacity: 0.1, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }),
    );
    this.spotBeam.frustumCulled = false;
    this.spotBeam.visible = false;
    scene.add(this.spotBeam);
    this.spotPool = new Mesh(
      new CircleGeometry(POLICE.helicopter.spotRadius, 28),
      new MeshBasicMaterial({ color: new Color(0.9, 0.86, 0.62), transparent: true, opacity: 0.34, blending: AdditiveBlending, depthWrite: false, fog: false }),
    );
    this.spotPool.rotation.x = -Math.PI / 2;
    this.spotPool.frustumCulled = false;
    this.spotPool.visible = false;
    scene.add(this.spotPool);

    this.drone = new Mesh(buildDrone(), plain);
    this.drone.scale.setScalar(1.4);
    this.drone.frustumCulled = false;
    this.drone.visible = false;
    scene.add(this.drone);
    this.droneLampMaterial = new MeshBasicMaterial({ toneMapped: false, color: 0xffffff });
    this.droneLamp = new Mesh(new BoxGeometry(0.22, 0.12, 0.22), this.droneLampMaterial);
    this.droneLamp.position.y = -0.2;
    this.drone.add(this.droneLamp);
  }

  /** Flashing light is what photosensitive players need less of, more than anything else here. */
  setReduceMotion(value: boolean): void {
    this.flashRate = value ? 1.5 : FLASH_RATE;
    this.calmLight = value;
  }

  update(alpha: number, dt: number): void {
    this.time += dt;
    this.drawCars(alpha);
    this.drawStrips();
    this.drawLight();
    this.drawAir(dt);
  }

  private setLamps(index: number, on: boolean, phase: number): void {
    const array = this.lamps.instanceColor?.array as Float32Array;
    // Two quick flashes on one side, then two on the other.
    const beat = Math.floor((this.time + phase) * this.flashRate) % 8;
    const red = on && (beat === 0 || beat === 2);
    const blue = on && (beat === 4 || beat === 6);
    (red ? RED_ON : RED_OFF).toArray(array, index * 3);
    (blue ? BLUE_ON : BLUE_OFF).toArray(array, (index + 1) * 3);
  }

  private placeLamps(index: number): void {
    LAMP_OFFSETS.forEach((lamp, side) => {
      offset.set(lamp.x, lamp.y, lamp.z).applyQuaternion(quaternion).add(position);
      matrix.compose(offset, quaternion, scale);
      this.lamps.setMatrixAt(index + side, matrix);
    });
  }

  private drawCars(alpha: number): void {
    const police = this.police;
    const colors = this.bodies.instanceColor?.array as Float32Array;
    let count = 0;
    let wheelCount = 0;

    for (let u = 0; u < police.units.length; u++) {
      const unit = police.units[u];
      if (!unit.active) continue;
      position.set(unit.prevX + (unit.currX - unit.prevX) * alpha, unit.prevY + (unit.currY - unit.prevY) * alpha, unit.prevZ + (unit.currZ - unit.prevZ) * alpha);
      previous.set(unit.prevQx, unit.prevQy, unit.prevQz, unit.prevQw);
      quaternion.set(unit.currQx, unit.currQy, unit.currQz, unit.currQw);
      quaternion.slerp(previous, 1 - alpha);
      matrix.compose(position, quaternion, scale);
      this.bodies.setMatrixAt(count, matrix);
      scratchColor.setHex(unit.tint);
      scratchColor.toArray(colors, count * 3);

      const steerAngle = unit.car.telemetry.steerAngle;
      for (const wheel of unit.car.wheels) {
        offset.set(wheel.mountLocal.x, wheel.mountLocal.y - wheel.springLength, wheel.mountLocal.z).applyQuaternion(quaternion).add(position);
        steer.setFromAxisAngle(axisY, wheel.isFront ? -steerAngle : 0);
        spin.setFromAxisAngle(axisX, wheel.spinAngle);
        previous.copy(quaternion).multiply(steer).multiply(spin);
        matrix.compose(offset, previous, scale);
        this.wheels.setMatrixAt(wheelCount++, matrix);
      }

      this.placeLamps(count * 2);
      this.setLamps(count * 2, unit.role !== 'roam' && unit.stunSeconds <= 0, u * 0.17);
      count++;
    }

    for (let p = 0; p < police.parked.length; p++) {
      const car = police.parked[p];
      if (!car.active) continue;
      const t = car.body.translation();
      const r = car.body.rotation();
      position.set(t.x, t.y, t.z);
      quaternion.set(r.x, r.y, r.z, r.w);
      matrix.compose(position, quaternion, scale);
      this.bodies.setMatrixAt(count, matrix);
      scratchColor.setHex(0xf1f0ea);
      scratchColor.toArray(colors, count * 3);
      const wheels = TUNING.vehicle.wheels;
      for (const [x, z] of [[wheels.trackHalf, wheels.frontAxleZ], [-wheels.trackHalf, wheels.frontAxleZ], [wheels.trackHalf, wheels.rearAxleZ], [-wheels.trackHalf, wheels.rearAxleZ]] as const) {
        offset.set(x, wheels.mountY - PARKED_WHEEL_DROP, z).applyQuaternion(quaternion).add(position);
        matrix.compose(offset, quaternion, scale);
        this.wheels.setMatrixAt(wheelCount++, matrix);
      }
      this.placeLamps(count * 2);
      this.setLamps(count * 2, true, p * 0.31);
      count++;
    }

    this.bodies.count = count;
    this.wheels.count = wheelCount;
    this.lamps.count = count * 2;
    this.bodies.instanceMatrix.needsUpdate = true;
    if (this.bodies.instanceColor) this.bodies.instanceColor.needsUpdate = true;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.lamps.instanceMatrix.needsUpdate = true;
    if (this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }

  private drawStrips(): void {
    let count = 0;
    for (const strip of this.police.strips) {
      if (!strip.active) continue;
      position.set(strip.x, strip.y + 0.02, strip.z);
      quaternion.setFromAxisAngle(axisY, strip.yaw);
      offset.set(strip.halfLength, 1, 1);
      matrix.compose(position, quaternion, offset);
      this.strips.setMatrixAt(count++, matrix);
    }
    this.strips.count = count;
    this.strips.instanceMatrix.needsUpdate = true;
  }

  private drawLight(): void {
    const light = this.light;
    if (!light) return;
    const unit = this.police.nearestUnit();
    if (!unit || unit.role === 'roam' || unit.distance > 110) {
      light.intensity = 0;
      return;
    }
    light.position.set(unit.currX, unit.currY + 2.2, unit.currZ);
    if (this.calmLight) {
      light.color.setRGB(0.55, 0.2, 0.6);
      light.intensity = 26;
      return;
    }
    const beat = Math.floor(this.time * this.flashRate) % 8;
    if (beat === 0 || beat === 2) {
      light.color.setRGB(1, 0.12, 0.08);
      this.lightOn = 1;
    } else if (beat === 4 || beat === 6) {
      light.color.setRGB(0.1, 0.28, 1);
      this.lightOn = 1;
    } else {
      this.lightOn = 0;
    }
    light.intensity = this.lightOn * 90;
  }

  private drawAir(dt: number): void {
    const heli = this.police.helicopter;
    this.helicopter.visible = heli.active;
    this.spotBeam.visible = heli.active;
    this.spotPool.visible = heli.active;
    if (heli.active) {
      this.heliX.follow(heli, dt);
      this.helicopter.position.set(this.heliX.x, this.heliX.y, this.heliX.z);
      this.helicopter.rotation.set(0.12, heli.yaw, -heli.bank, 'YXZ');
      this.rotor.rotation.y += POLICE.helicopter.rotorSpeed * dt;
      this.tailRotor.rotation.x += POLICE.helicopter.rotorSpeed * 1.4 * dt;

      const groundY = heli.y - POLICE.helicopter.height;
      this.spotPool.position.set(heli.spotX, groundY + 0.18, heli.spotZ);
      // The cone stretches from the nose down to the pool of light.
      const dx = heli.spotX - this.heliX.x;
      const dy = groundY - (this.heliX.y - 1);
      const dz = heli.spotZ - this.heliX.z;
      const length = Math.hypot(dx, dy, dz);
      this.spotBeam.position.set(this.heliX.x, this.heliX.y - 1, this.heliX.z);
      offset.set(dx / length, dy / length, dz / length);
      this.spotBeam.quaternion.setFromUnitVectors(UP_FROM_BEAM, offset);
      this.spotBeam.scale.set(POLICE.helicopter.spotRadius, length, POLICE.helicopter.spotRadius);
    }

    const drone = this.police.drone;
    this.drone.visible = drone.active;
    if (drone.active) {
      this.droneX.follow(drone, dt);
      this.drone.position.set(this.droneX.x, this.droneX.y + Math.sin(this.time * 2.1) * 0.3, this.droneX.z);
      this.drone.rotation.y = drone.yaw;
      const beat = Math.floor(this.time * 3) % 2;
      this.droneLampMaterial.color.copy(beat === 0 ? RED_ON : BLUE_ON);
    }
  }
}

/** The beam is built pointing along +Y, down from its tip. */
const UP_FROM_BEAM = new Vector3(0, 1, 0);

/** Air units update at the physics rate, which is slower during দম, so their drawing glides. */
class Smoothed {
  x = 0;
  y = 0;
  z = 0;
  private live = false;

  follow(unit: AirUnit, dt: number): void {
    if (!this.live) {
      this.x = unit.x;
      this.y = unit.y;
      this.z = unit.z;
      this.live = true;
      return;
    }
    const factor = dampFactor(16, dt);
    this.x += (unit.x - this.x) * factor;
    this.y += (unit.y - this.y) * factor;
    this.z += (unit.z - this.z) * factor;
  }
}
