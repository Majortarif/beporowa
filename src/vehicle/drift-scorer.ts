/** Turns a live drift into points and a Bangla callout at the end. */

import { TUNING } from '../config/tuning';
import type { EventBus } from '../core/events';
import type { VehicleTelemetry } from './vehicle-controller';

export class DriftScorer {
  points = 0;
  multiplier = 1;
  active = false;

  constructor(private readonly bus: EventBus) {}

  update(dt: number, telemetry: VehicleTelemetry): void {
    const config = TUNING.scoring;
    const angle = Math.abs(telemetry.slipAngleDeg);
    if (telemetry.drifting && telemetry.groundedWheels >= 2) {
      this.active = true;
      if (angle > config.driftMinAngleDeg) {
        this.multiplier = Math.min(config.driftMaxMultiplier, this.multiplier + config.driftMultiplierPerSecond * dt);
        this.points += angle * telemetry.speedKmh * config.driftPointsRate * this.multiplier * dt;
      }
    } else if (this.active) {
      this.finish();
    }
  }

  /** Ends the chain without a callout, for example on a reset. */
  cancel(): void {
    this.active = false;
    this.points = 0;
    this.multiplier = 1;
  }

  private finish(): void {
    const config = TUNING.scoring;
    if (this.points >= config.driftMinPoints) {
      let tier = 0;
      for (const threshold of config.tierThresholds) {
        if (this.points >= threshold) tier++;
      }
      this.bus.emit('driftEnd', { points: Math.round(this.points), tier });
    }
    this.cancel();
  }
}
