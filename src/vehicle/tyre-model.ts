import { DEG2RAD, clamp01, lerp, smoothstep } from '../core/math';
import { TUNING } from '../config/tuning';

/**
 * Lateral grip factor from slip angle (radians).
 * Rises to 1 at the peak, then falls to slideRatio once fully sliding.
 * Falling grip past the peak is what makes a slide feel like a slide.
 */
export function lateralGripCurve(slipAngle: number, slideRatio: number): number {
  const { peakSlipDeg, slideSlipDeg } = TUNING.vehicle.tyre;
  const peak = peakSlipDeg * DEG2RAD;
  if (slipAngle <= peak) {
    const x = clamp01(slipAngle / peak);
    return x * (2 - x);
  }
  const slide = slideSlipDeg * DEG2RAD;
  return lerp(1, slideRatio, smoothstep(peak, slide, slipAngle));
}

/**
 * Steering lock that always aims near the grip limit:
 * geometry needed for the target lateral acceleration, plus the tyre peak slip angle.
 * This keeps full lock useful at any speed instead of scrubbing the front tyres.
 */
export function speedLimitedSteerAngle(speed: number, wheelbase: number): number {
  const { steering, tyre } = TUNING.vehicle;
  const v = Math.max(speed, 1);
  const geometric = Math.atan((wheelbase * steering.targetLateralAccel) / (v * v));
  const angle = geometric + tyre.peakSlipDeg * DEG2RAD;
  const max = steering.maxAngleDeg * DEG2RAD;
  const min = steering.minAngleDeg * DEG2RAD;
  return angle > max ? max : angle < min ? min : angle;
}
