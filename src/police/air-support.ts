/** The drone and the helicopter: no physics, they simply fly to where they want to be. */

import { POLICE } from '../config/police-tuning';
import { dampFactor } from '../core/math';

export class AirUnit {
  active = false;
  x = 0;
  y = 0;
  z = 0;
  yaw = 0;
  bank = 0;
  /** Where its searchlight or attention is pointed. */
  spotX = 0;
  spotZ = 0;
  sees = false;
  age = 0;
  private orbit = 0;

  /** Enters from some distance away, on the far side from the camera. */
  launch(x: number, y: number, z: number): void {
    this.active = true;
    this.x = x;
    this.y = y;
    this.z = z;
    this.spotX = x;
    this.spotZ = z;
    this.age = 0;
    this.sees = false;
  }

  stop(): void {
    this.active = false;
    this.sees = false;
  }

  /** Flies toward a point at a fixed top speed. Fast cars can outrun a drone. */
  flyToward(dt: number, tx: number, ty: number, tz: number, speed: number): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const distance = Math.hypot(dx, dz);
    if (distance > 0.5) {
      const step = Math.min(distance, speed * dt);
      this.x += (dx / distance) * step;
      this.z += (dz / distance) * step;
      this.yaw = Math.atan2(dx, dz);
      this.bank += (Math.min(distance / 40, 1) * POLICE.helicopter.bankPerSpeed * speed - this.bank) * dampFactor(2, dt);
    }
    this.y += (ty - this.y) * dampFactor(1.5, dt);
    this.age += dt;
  }

  /** Circles a point, so the searchlight always comes from a new angle. */
  orbitAround(dt: number, tx: number, ty: number, tz: number, radius: number, speed: number): void {
    this.orbit += dt * 0.35;
    this.flyToward(dt, tx + Math.cos(this.orbit) * radius, ty, tz + Math.sin(this.orbit) * radius, speed);
  }

  moveSpot(dt: number, tx: number, tz: number, follow: number): void {
    const factor = dampFactor(follow, dt);
    this.spotX += (tx - this.spotX) * factor;
    this.spotZ += (tz - this.spotZ) * factor;
  }
}
