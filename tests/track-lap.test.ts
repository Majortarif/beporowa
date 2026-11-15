/**
 * A simple keyboard-style bot drives one lap of the real test road, with digital steering like
 * a player on keys. It catches suspension trouble on crests, spins, and a road the car cannot follow.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config/tuning';
import { EventBus } from '../src/core/events';
import { createIntent } from '../src/input/intent';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { LapTimer } from '../src/race/lap-timer';
import { VehicleController } from '../src/vehicle/vehicle-controller';
import { computeRoadGeometry } from '../src/world/road-geometry';
import { TrackPath } from '../src/world/track-path';

const DT = 1 / TUNING.physics.fixedHz;

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

beforeAll(async () => {
  await loadPhysicsEngine();
});

describe('a full lap on the test road', () => {
  it('stays on the road, upright and counts the lap', () => {
    const track = new TrackPath(TUNING.world.sampleSpacing);
    const physics = new PhysicsWorld(DT);
    const road = computeRoadGeometry(track);
    physics.addFixedTrimesh(road.roadPositions, road.roadIndices, 'road');
    physics.addFixedTrimesh(road.shoulderPositions, road.shoulderIndices, 'shoulder');
    physics.addFixedCuboid(4000, 2, 4000, 0, TUNING.world.groundY - 2, 0, 'dirt');

    const bus = new EventBus();
    const laps: number[] = [];
    bus.on('lapComplete', ({ timeMs }) => laps.push(timeMs));

    const spawnIndex = track.wrap(-Math.round(TUNING.world.spawnBehindStartLine / track.spacing));
    const car = new VehicleController(
      physics,
      { position: { x: track.x(spawnIndex), y: track.y(spawnIndex) + 0.8, z: track.z(spawnIndex) }, yaw: track.yaw(spawnIndex) },
      bus,
    );
    const timer = new LapTimer(track, bus, spawnIndex, null);
    const intent = createIntent();
    physics.step();

    let hint = spawnIndex;
    let steer = 0;
    let time = 0;
    let minUp = 1;
    let maxSlip = 0;
    let maxKmh = 0;
    let airborneSteps = 0;
    let offRoadSteps = 0;
    let maxOffset = 0;

    while (laps.length === 0 && time < 300) {
      const t = car.telemetry;
      const p = car.position;
      hint = track.nearestIndex(p.x, p.z, hint, 20);
      // A short look-ahead: a long one would cut every corner and leave the road on the inside.
      const look = track.wrap(hint + Math.round(3 + t.speed * 0.16));
      const q = car.quaternion;
      const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      const error = wrapAngle(Math.atan2(track.x(look) - p.x, track.z(look) - p.z) - heading);

      // Digital steering, ramped like the keyboard. Positive error means the target is to the left.
      const target = error > 0.04 ? -1 : error < -0.04 ? 1 : 0;
      const rate = target === 0 ? TUNING.input.keyboardSteerReturn : TUNING.input.keyboardSteerRate;
      const delta = target - steer;
      steer += Math.abs(delta) <= rate * DT ? delta : Math.sign(delta) * rate * DT;
      intent.steer = steer;

      // Brakes for the tightest speed limit within reach, like a driver reading the road ahead.
      let allowed = Infinity;
      for (let s = 1; s < 60; s++) {
        const a = track.wrap(hint + s - 2);
        const b = track.wrap(hint + s + 2);
        const turn = Math.abs(wrapAngle(track.yaw(b) - track.yaw(a)));
        const radius = (4 * track.spacing) / Math.max(turn, 0.0001);
        const cornerSpeed = Math.sqrt(11 * radius);
        const distance = s * track.spacing;
        allowed = Math.min(allowed, Math.sqrt(cornerSpeed * cornerSpeed + 2 * 11 * distance));
      }
      const tooFast = t.speed > allowed;
      intent.throttle = tooFast || t.speed > allowed - 1.5 ? 0 : 1;
      intent.brake = tooFast ? 1 : 0;

      car.update(DT, intent);
      physics.step();
      timer.update(DT, p.x, p.z, car.velocity.x, car.velocity.z, t.speed);

      time += DT;
      minUp = Math.min(minUp, t.upY);
      maxSlip = Math.max(maxSlip, Math.abs(t.slipAngleDeg));
      maxKmh = Math.max(maxKmh, t.speedKmh);
      if (t.groundedWheels === 0) airborneSteps++;
      const offset = track.distanceToSample(hint, p.x, p.z);
      maxOffset = Math.max(maxOffset, offset);
      if (offset > TUNING.world.roadHalfWidth) offRoadSteps++;
    }

    console.log(
      `lap: ${(laps[0] / 1000).toFixed(1)} s, top ${maxKmh.toFixed(0)} km/h, peak slip ${maxSlip.toFixed(1)} deg, ` +
        `min up ${minUp.toFixed(4)}, airborne ${(airborneSteps * DT).toFixed(2)} s, ` +
        `off road ${(offRoadSteps * DT).toFixed(2)} s, widest ${maxOffset.toFixed(1)} m`,
    );
    expect(laps.length).toBe(1);
    expect(minUp).toBeGreaterThan(0.95);
    expect(maxKmh).toBeGreaterThan(150);
    expect(laps[0] / 1000).toBeLessThan(150);
    expect(offRoadSteps * DT).toBeLessThan(5);
  });
});
