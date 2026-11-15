/**
 * The camera while the car is parked: a slow orbit around the car on the lift or a tea stall.
 * It frames its subject beside whichever panel is open, or above it on a tall screen.
 */

import type { PerspectiveCamera } from 'three';
import { PROGRESS } from '../config/progression';
import { damp } from '../core/math';

export type StopView = 'side' | 'rear' | 'front';

export interface StopFraming {
  x: number;
  y: number;
  z: number;
  /** The way the subject faces. */
  yaw: number;
  /** Which side of the screen the menu stands on. The subject goes on the other. */
  panel: 'left' | 'right';
  radius?: number;
  height?: number;
  /** Starts from this angle around the subject, relative to its nose. */
  angle?: number;
  /** Drifts slowly around by itself. */
  orbit?: boolean;
}

const TALL_ASPECT = 1.1;
/** Below this shape, the lens opens up to keep the whole car in view. */
const FULL_ASPECT = 1.55;
const MAX_FOV = 74;

export class StopCamera {
  active = false;
  private x = 0;
  private y = 0;
  private z = 0;
  private yaw = 0;
  private panel: 'left' | 'right' = 'right';
  private radius: number = PROGRESS.garage.orbitRadius;
  private height: number = PROGRESS.garage.orbitHeight;
  private orbit = true;
  private angle = 0;
  private targetAngle = 0;
  private reduceMotion = false;

  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
  }

  begin(framing: StopFraming): void {
    this.active = true;
    this.x = framing.x;
    this.y = framing.y;
    this.z = framing.z;
    this.yaw = framing.yaw;
    this.panel = framing.panel;
    this.radius = framing.radius ?? PROGRESS.garage.orbitRadius;
    this.height = framing.height ?? PROGRESS.garage.orbitHeight;
    this.orbit = framing.orbit ?? true;
    this.angle = this.yaw + (framing.angle ?? 0.7);
    this.targetAngle = this.angle;
  }

  end(): void {
    this.active = false;
  }

  /** Swings around to look at one part of the car, and stays there. */
  setView(view: StopView): void {
    const offset = view === 'rear' ? Math.PI - 0.35 : view === 'front' ? 0.55 : Math.PI / 2 + 0.2;
    const wanted = this.yaw + offset;
    const turns = Math.round((this.targetAngle - wanted) / (Math.PI * 2));
    this.targetAngle = wanted + turns * Math.PI * 2;
    this.orbit = false;
  }

  /** Lets the slow drift go on, from wherever the camera is now. */
  resumeOrbit(): void {
    this.orbit = true;
  }

  /** Turns the camera by a mouse or finger drag, in pixels. */
  drag(pixels: number): void {
    this.targetAngle -= pixels * PROGRESS.garage.dragSpeed;
    this.orbit = false;
  }

  update(dt: number, camera: PerspectiveCamera): void {
    if (this.orbit && !this.reduceMotion) this.targetAngle += PROGRESS.garage.orbitSpeed * dt;
    this.angle = this.reduceMotion ? this.targetAngle : damp(this.angle, this.targetAngle, 6, dt);

    // Room to move is limited indoors, so a tall screen opens the lens rather than backing away.
    const tall = camera.aspect <= TALL_ASPECT;
    const fov = Math.min(MAX_FOV, PROGRESS.garage.fov * Math.max(1, (tall ? TALL_ASPECT : FULL_ASPECT) / camera.aspect));
    if (camera.fov !== fov) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    const sin = Math.sin(this.angle);
    const cos = Math.cos(this.angle);
    camera.position.set(this.x + sin * this.radius, this.y + this.height, this.z + cos * this.radius);
    // The camera's right is (cos, -sin). Looking right of the subject moves it left on the screen.
    const pan = tall ? 0 : this.radius * 0.3 * (this.panel === 'right' ? 1 : -1);
    camera.lookAt(this.x + cos * pan, tall ? this.y - this.radius * 0.3 : this.y + 0.05, this.z - sin * pan);
  }
}
