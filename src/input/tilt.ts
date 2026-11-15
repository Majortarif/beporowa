/**
 * Steering by tilting the phone, like a wheel held in both hands. The angle the phone has when
 * tilt is switched on (or straightened) is the middle. Browsers report the angles differently
 * by device, so a player can flip the direction in the settings.
 */

import { TILT } from '../config/extras';
import { moveToward } from '../core/math';
import { getSettings } from '../save/settings';
import type { Intent } from './intent';

/** iOS hides motion behind a permission prompt that only a tap may open. */
interface PermissionedOrientation {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export class TiltInput {
  private raw = 0;
  private neutral: number | null = null;
  private steer = 0;
  private listening = false;
  /** Readings have arrived, so the device really reports tilt. */
  hasReadings = false;

  static supported(): boolean {
    return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window;
  }

  /**
   * Asks for motion access where the browser wants that. Call it from a tap.
   * @returns whether tilt may be used
   */
  static async requestPermission(): Promise<boolean> {
    if (!TiltInput.supported()) return false;
    const constructor = DeviceOrientationEvent as unknown as PermissionedOrientation;
    if (typeof constructor.requestPermission !== 'function') return true;
    try {
      return (await constructor.requestPermission()) === 'granted';
    } catch {
      return false;
    }
  }

  start(): void {
    if (this.listening || !TiltInput.supported()) return;
    this.listening = true;
    this.neutral = null;
    window.addEventListener('deviceorientation', this.onOrientation);
  }

  stop(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.raw = 0;
    this.steer = 0;
  }

  /** Takes the phone's angle now as straight ahead. */
  straighten(): void {
    this.neutral = null;
  }

  private onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.beta === null || event.gamma === null) return;
    this.hasReadings = true;
    // Held sideways, the wheel turns through beta; held upright, through gamma.
    const angle = typeof screen !== 'undefined' && screen.orientation ? screen.orientation.angle : 0;
    let tilt: number;
    if (angle === 90) tilt = event.beta;
    else if (angle === 270 || angle === -90) tilt = -event.beta;
    else tilt = event.gamma;
    if (this.neutral === null) this.neutral = tilt;
    this.raw = tilt - this.neutral;
  };

  /** The steering the tilt asks for, from -1 to 1. Pure, for tests. */
  static steerFor(degrees: number): number {
    const magnitude = Math.abs(degrees) - TILT.deadzoneDegrees;
    if (magnitude <= 0) return 0;
    return Math.sign(degrees) * Math.min(1, magnitude / (TILT.fullLockDegrees - TILT.deadzoneDegrees));
  }

  update(dt: number, intent: Intent): void {
    if (!this.listening) return;
    const target = TiltInput.steerFor(this.raw) * (getSettings().tiltInvert ? -1 : 1);
    this.steer = moveToward(this.steer, target, TILT.follow * dt);
    if (Math.abs(this.steer) > Math.abs(intent.steer)) intent.steer = this.steer;
  }
}
