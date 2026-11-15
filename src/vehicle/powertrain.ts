import { RACE } from '../config/race-tuning';
import { TUNING } from '../config/tuning';
import { smoothstep } from '../core/math';

const KMH_TO_MS = 1 / 3.6;

export interface ShiftEvent {
  gear: number;
  up: boolean;
}

/**
 * Arcade automatic gearbox. Gears shape RPM, sound and shift cuts;
 * drive force itself comes from a power curve so tuning stays simple.
 */
export class Powertrain {
  gear = 1;
  rpm: number = TUNING.vehicle.engine.idleRpm;
  /** Drag races hand the gear lever to the driver. */
  manual = false;
  private shiftTimer = 0;

  reset(): void {
    this.gear = 1;
    this.rpm = TUNING.vehicle.engine.idleRpm;
    this.shiftTimer = 0;
    this.manual = false;
  }

  /** Revs as a share of the usable range, from 0 at idle to 1 at the redline. */
  get rpmShare(): number {
    const engine = TUNING.vehicle.engine;
    return (this.rpm - engine.idleRpm) / (engine.redlineRpm - engine.idleRpm);
  }

  /** Moves up a gear in manual mode. @returns the shift, or null if none was possible */
  shiftUp(): ShiftEvent | null {
    const tops = TUNING.vehicle.engine.gearTopKmh;
    if (!this.manual || this.gear >= tops.length || this.shiftTimer > 0) return null;
    this.gear++;
    this.shiftTimer = TUNING.vehicle.engine.shiftTime;
    return { gear: this.gear, up: true };
  }

  /** In manual mode, how much of the engine's power the current revs deliver. */
  get manualPowerScale(): number {
    if (!this.manual) return 1;
    const drag = RACE.drag;
    const share = this.rpmShare;
    if (share >= drag.limiterAt) return drag.limiterPower;
    if (share >= drag.bestFrom && share <= drag.bestTo) return 1;
    if (share < drag.bogBelow) return drag.bogPower;
    if (share < drag.bestFrom) return drag.bogPower + ((share - drag.bogBelow) / (drag.bestFrom - drag.bogBelow)) * (1 - drag.bogPower);
    return 1;
  }

  get isShifting(): boolean {
    return this.shiftTimer > 0;
  }

  /**
   * Updates gear and RPM.
   * @param drivenSpeed speed implied by the driven wheels, m/s
   * @param throttle 0 to 1, used for free-revving when nearly stopped
   * @returns a shift event when a gear change started this step
   */
  update(dt: number, drivenSpeed: number, throttle: number, reversing: boolean): ShiftEvent | null {
    const engine = TUNING.vehicle.engine;
    const tops = engine.gearTopKmh;
    if (this.shiftTimer > 0) this.shiftTimer -= dt;

    let event: ShiftEvent | null = null;
    if (reversing) {
      this.gear = 1;
    } else if (this.shiftTimer <= 0 && !this.manual) {
      if (this.rpm >= engine.upshiftRpm && this.gear < tops.length && throttle > 0.05) {
        this.gear++;
        this.shiftTimer = engine.shiftTime;
        event = { gear: this.gear, up: true };
      } else if (this.rpm <= engine.downshiftRpm && this.gear > 1) {
        this.gear--;
        event = { gear: this.gear, up: false };
      }
    }

    const gearTop = tops[this.gear - 1] * KMH_TO_MS;
    const range = engine.redlineRpm - engine.idleRpm;
    const fromSpeed = engine.idleRpm + (Math.abs(drivenSpeed) / gearTop) * range;
    // At a standstill the clutch slips, so the throttle can rev the engine freely.
    const freeRev = engine.idleRpm + throttle * range * 0.55;
    const target = Math.min(Math.max(fromSpeed, this.gear === 1 ? freeRev : engine.idleRpm), engine.redlineRpm);
    const response = target > this.rpm ? 22 : 12;
    this.rpm += (target - this.rpm) * Math.min(1, response * dt);
    return event;
  }

  /** Total drive force at this speed for full throttle, before input scaling. */
  driveForce(speed: number, topSpeedKmh: number, reversing: boolean): number {
    const engine = TUNING.vehicle.engine;
    const v = Math.abs(speed);
    const powerLimited = engine.powerWatts / Math.max(v, 1);
    let force = Math.min(engine.maxDriveForce, powerLimited);
    const topSpeed = topSpeedKmh * KMH_TO_MS;
    force *= 1 - smoothstep(topSpeed * 0.96, topSpeed * 1.01, v);
    if (reversing) force *= engine.reverseForceScale;
    if (this.isShifting) force *= engine.shiftForceScale;
    if (this.manual) {
      // At the top of a gear there is nothing left, until the driver shifts.
      const gearTop = engine.gearTopKmh[this.gear - 1] * KMH_TO_MS;
      force *= 1 - smoothstep(gearTop * 0.98, gearTop * 1.03, v);
    }
    return force * this.manualPowerScale;
  }
}
