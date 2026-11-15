/** Connects the car's tyre state to smoke, spray, skid marks and sparks. */

import type { Scene } from 'three';
import { TUNING, type QualityPreset } from '../config/tuning';
import { createRng } from '../core/math';
import type { VehicleController } from '../vehicle/vehicle-controller';
import { ParticlePool } from './particle-pool';
import { SkidMarks } from './skid-marks';

export class VehicleFx {
  readonly skids: SkidMarks;
  private readonly smoke: ParticlePool;
  private readonly sparks: ParticlePool;
  private readonly smokeDebt = [0, 0, 0, 0];
  private readonly sprayDebt = [0, 0, 0, 0];
  private engineDebt = 0;
  /** How wet the road is, for how much mist the tyres throw up. */
  wetness = 1;
  private readonly random = createRng(TUNING.world.seed);

  constructor(scene: Scene, preset: QualityPreset) {
    const fx = TUNING.fx;
    this.skids = new SkidMarks(preset.skidSegments, 4);
    this.smoke = new ParticlePool(preset.smokeParticles, false, 0, fx.smoke.drag, fx.smoke.riseSpeed);
    this.sparks = new ParticlePool(preset.sparkParticles, true, fx.sparks.gravity, 0.6, 0);
    scene.add(this.skids.mesh, this.smoke.mesh, this.sparks.mesh);
  }

  /** Called once per physics step while the car is live. */
  emit(dt: number, car: VehicleController): void {
    const { smoke, spray, skid } = TUNING.fx;
    const velocity = car.velocity;
    const speed = car.telemetry.speed;

    for (let i = 0; i < car.wheels.length; i++) {
      const wheel = car.wheels[i];
      if (!wheel.contact) {
        this.skids.lift(i);
        continue;
      }
      if (wheel.surface === 'flood') {
        // Water, not smoke: a sheet of it thrown up behind each wheel.
        this.skids.lift(i);
        this.sprayDebt[i] += (6 + speed * 1.5) * dt;
        while (this.sprayDebt[i] >= 1) {
          this.sprayDebt[i] -= 1;
          this.spawnWater(wheel.contactPoint.x, wheel.contactPoint.y + 0.1, wheel.contactPoint.z, velocity.x * 0.3, 1.5 + speed * 0.14, velocity.z * 0.3, speed);
        }
        continue;
      }
      const onPavement = wheel.surface === 'road' || wheel.surface === 'plaza';

      if (wheel.slip > skid.minSlip && onPavement) {
        this.skids.add(i, wheel.contactPoint, Math.min(1, wheel.slip));
      } else {
        this.skids.lift(i);
      }

      if (wheel.slip > smoke.minSlip) {
        this.smokeDebt[i] += smoke.ratePerSecond * Math.min(1.4, wheel.slip) * dt;
        const color = onPavement ? smoke.color : { r: 0.42, g: 0.32, b: 0.22 };
        while (this.smokeDebt[i] >= 1) {
          this.smokeDebt[i] -= 1;
          this.smoke.spawn({
            x: wheel.contactPoint.x + (this.random() - 0.5) * 0.3,
            y: wheel.contactPoint.y + 0.14,
            z: wheel.contactPoint.z + (this.random() - 0.5) * 0.3,
            vx: velocity.x * smoke.inheritVelocity + (this.random() - 0.5) * 1.2,
            vy: 0.3 + this.random() * 0.5,
            vz: velocity.z * smoke.inheritVelocity + (this.random() - 0.5) * 1.2,
            life: smoke.life * (0.75 + this.random() * 0.5),
            startSize: smoke.startSize,
            endSize: smoke.endSize * (0.8 + this.random() * 0.4),
            opacity: smoke.opacity,
            r: color.r,
            g: color.g,
            b: color.b,
          });
        }
      }

      // The road is wet in this city, so fast tyres throw a thin mist behind them.
      if (!wheel.isFront && onPavement && speed > spray.minSpeed) {
        const amount = Math.min(1, (speed - spray.minSpeed) / 40) * this.wetness;
        this.sprayDebt[i] += spray.ratePerSecond * amount * dt;
        while (this.sprayDebt[i] >= 1) {
          this.sprayDebt[i] -= 1;
          this.smoke.spawn({
            x: wheel.contactPoint.x,
            y: wheel.contactPoint.y + 0.16,
            z: wheel.contactPoint.z,
            vx: velocity.x * 0.42 + (this.random() - 0.5) * 1.8,
            vy: 0.8 + this.random() * 1.2,
            vz: velocity.z * 0.42 + (this.random() - 0.5) * 1.8,
            life: spray.life,
            startSize: spray.startSize,
            endSize: spray.endSize,
            opacity: spray.opacity * (0.5 + amount * 0.5),
            r: spray.color.r,
            g: spray.color.g,
            b: spray.color.b,
          });
        }
      }
    }
  }

  private spawnWater(x: number, y: number, z: number, vx: number, vy: number, vz: number, speed: number): void {
    const spread = 1 + speed * 0.05;
    this.smoke.spawn({
      x: x + (this.random() - 0.5) * 0.4,
      y,
      z: z + (this.random() - 0.5) * 0.4,
      vx: vx + (this.random() - 0.5) * spread * 2,
      vy: vy * (0.6 + this.random() * 0.6),
      vz: vz + (this.random() - 0.5) * spread * 2,
      life: 0.42 + this.random() * 0.3,
      startSize: 0.3,
      endSize: 1.5 + this.random(),
      opacity: 0.2,
      r: 0.55,
      g: 0.56,
      b: 0.5,
    });
  }

  /** A burst of water, from a wave or from a hole under the surface. */
  splash(x: number, y: number, z: number, strength: number): void {
    const count = Math.round(10 + strength * 22);
    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2;
      const power = 1 + this.random() * 4 * strength;
      this.spawnWater(x, y, z, Math.cos(angle) * power, 2 + this.random() * 4 * strength, Math.sin(angle) * power, 10);
    }
  }

  /** Tyre smoke during a replay, where there are no wheels in contact to ask. */
  replaySmoke(dt: number, x: number, y: number, z: number, slip: number): void {
    const { smoke } = TUNING.fx;
    this.engineDebt += smoke.ratePerSecond * Math.min(1.4, slip) * dt * 2;
    while (this.engineDebt >= 1) {
      this.engineDebt -= 1;
      this.smoke.spawn({
        x: x + (this.random() - 0.5) * 1.6,
        y: y + 0.14,
        z: z + (this.random() - 0.5) * 1.6,
        vx: (this.random() - 0.5) * 1.2,
        vy: 0.3 + this.random() * 0.5,
        vz: (this.random() - 0.5) * 1.2,
        life: smoke.life * (0.75 + this.random() * 0.5),
        startSize: smoke.startSize,
        endSize: smoke.endSize,
        opacity: smoke.opacity,
        r: smoke.color.r,
        g: smoke.color.g,
        b: smoke.color.b,
      });
    }
  }

  /** Dark smoke from under the bonnet of a badly hurt car. */
  engineSmoke(dt: number, x: number, y: number, z: number, perSecond: number): void {
    this.engineDebt += perSecond * dt;
    while (this.engineDebt >= 1) {
      this.engineDebt -= 1;
      this.smoke.spawn({
        x: x + (this.random() - 0.5) * 0.5,
        y,
        z: z + (this.random() - 0.5) * 0.5,
        vx: (this.random() - 0.5) * 0.6,
        vy: 1 + this.random() * 0.8,
        vz: (this.random() - 0.5) * 0.6,
        life: 1.2 + this.random() * 0.6,
        startSize: 0.3,
        endSize: 1.6,
        opacity: 0.32,
        r: 0.08,
        g: 0.07,
        b: 0.07,
      });
    }
  }

  burstSparks(x: number, y: number, z: number, strength: number): void {
    const config = TUNING.fx.sparks;
    const count = Math.round(config.perImpact * Math.min(1, strength));
    for (let i = 0; i < count; i++) {
      const angle = this.random() * Math.PI * 2;
      const power = config.speed * (0.3 + this.random() * 0.9);
      this.sparks.spawn({
        x,
        y,
        z,
        vx: Math.cos(angle) * power,
        vy: this.random() * power * 0.8,
        vz: Math.sin(angle) * power,
        life: config.life * (0.5 + this.random()),
        startSize: config.size,
        endSize: config.size * 0.3,
        opacity: 1,
        r: config.color.r,
        g: config.color.g,
        b: config.color.b,
      });
    }
  }

  /** Called once per rendered frame. */
  update(dt: number): void {
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.skids.flush();
  }

  clear(): void {
    this.smoke.clear();
    this.sparks.clear();
    this.skids.clear();
  }
}
