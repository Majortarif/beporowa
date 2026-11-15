/** What the dyno graph shows: engine power against road speed, from the real drive-force curve. */

import { TUNING } from '../config/tuning';
import { Powertrain } from '../vehicle/powertrain';

const WATTS_PER_HORSEPOWER = 745.7;
const SPEED_STEP_KMH = 10;

/** The speeds a graph is drawn at, up to just past the fastest of these top-speed shares. */
export function dynoSpeeds(topSpeedShares: readonly number[]): number[] {
  const top = TUNING.vehicle.engine.topSpeedKmh * Math.max(...topSpeedShares);
  const speeds: number[] = [];
  for (let kmh = SPEED_STEP_KMH; kmh <= top + SPEED_STEP_KMH; kmh += SPEED_STEP_KMH) speeds.push(kmh);
  return speeds;
}

/** Horsepower at each speed, for a car with these shares of the starter's power and top speed. */
export function dynoCurve(power: number, topSpeed: number, speeds: readonly number[]): number[] {
  const powertrain = new Powertrain();
  const top = TUNING.vehicle.engine.topSpeedKmh * topSpeed;
  return speeds.map((kmh) => {
    const metresPerSecond = kmh / 3.6;
    return (powertrain.driveForce(metresPerSecond, top, false) * power * metresPerSecond) / WATTS_PER_HORSEPOWER;
  });
}
