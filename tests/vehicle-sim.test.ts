/**
 * Headless driving tests. These cannot judge "fun", but they catch broken physics
 * and they print the numbers used to tune the car. Run: npm test
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config/tuning';
import { createIntent, type Intent } from '../src/input/intent';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { VehicleController } from '../src/vehicle/vehicle-controller';

const DT = 1 / TUNING.physics.fixedHz;

interface Sim {
  physics: PhysicsWorld;
  car: VehicleController;
  intent: Intent;
  run(seconds: number, onStep?: (time: number) => boolean | void): number;
}

function createSim(): Sim {
  const physics = new PhysicsWorld(DT);
  physics.addFixedCuboid(6000, 1, 6000, 0, -1, 0, 'dirt');
  physics.surfaceOverride = () => 'road';
  const car = new VehicleController(physics, { position: { x: 0, y: 0.75, z: 0 }, yaw: 0 });
  const intent = createIntent();
  physics.step();
  return {
    physics,
    car,
    intent,
    run(seconds, onStep) {
      const steps = Math.round(seconds / DT);
      for (let i = 0; i < steps; i++) {
        car.update(DT, intent);
        physics.step();
        if (onStep?.(i * DT)) return i * DT;
      }
      return seconds;
    },
  };
}

function settled(): Sim {
  const sim = createSim();
  sim.run(1.5);
  return sim;
}

/** Accelerates straight until the target speed, returning the time taken. */
function accelerateTo(sim: Sim, kmh: number, maxSeconds = 40): number {
  sim.intent.throttle = 1;
  return sim.run(maxSeconds, () => sim.car.telemetry.speedKmh >= kmh);
}

beforeAll(async () => {
  await loadPhysicsEngine();
});

describe('vehicle physics', () => {
  it('settles at rest without jitter', () => {
    const sim = createSim();
    sim.run(3);
    const body = sim.car.body;
    const heightBefore = body.translation().y;
    sim.run(1);
    const v = body.linvel();
    const a = body.angvel();
    const y = body.translation().y;
    console.log(`rest: height ${y.toFixed(3)} m, moved ${(y - heightBefore).toFixed(5)} m in 1 s, sideways ${Math.hypot(v.x, v.z).toFixed(4)}, spin ${Math.hypot(a.x, a.y, a.z).toFixed(4)}`);
    // Rapier reports a small constant vertical velocity at equilibrium, so watch the height itself.
    expect(Math.abs(y - heightBefore)).toBeLessThan(0.001);
    expect(Math.hypot(v.x, v.z)).toBeLessThan(0.02);
    expect(Math.hypot(a.x, a.y, a.z)).toBeLessThan(0.02);
    expect(sim.car.telemetry.groundedWheels).toBe(4);
    expect(y).toBeGreaterThan(0.5);
    expect(y).toBeLessThan(0.74);
  });

  it('accelerates like a quick hatchback', () => {
    const sim = settled();
    const t100 = accelerateTo(sim, 100);
    console.log(`0-100 km/h: ${t100.toFixed(2)} s`);
    expect(t100).toBeGreaterThan(3.5);
    expect(t100).toBeLessThan(8);
  });

  it('reaches its top speed and holds it', () => {
    const sim = settled();
    sim.intent.throttle = 1;
    sim.run(45);
    const kmh = sim.car.telemetry.speedKmh;
    console.log(`top speed after 45 s: ${kmh.toFixed(1)} km/h, gear ${sim.car.telemetry.gear}`);
    expect(kmh).toBeGreaterThan(175);
    expect(kmh).toBeLessThan(TUNING.vehicle.engine.topSpeedKmh + 5);
  });

  it('nitro adds real speed', () => {
    const sim = settled();
    accelerateTo(sim, 100);
    const start = sim.car.telemetry.speedKmh;
    sim.run(2.5);
    const plain = sim.car.telemetry.speedKmh - start;

    const boosted = settled();
    accelerateTo(boosted, 100);
    const startBoost = boosted.car.telemetry.speedKmh;
    boosted.intent.nitro = true;
    boosted.run(2.5);
    const withNitro = boosted.car.telemetry.speedKmh - startBoost;
    console.log(`2.5 s from 100 km/h: plain +${plain.toFixed(1)}, nitro +${withNitro.toFixed(1)} km/h`);
    expect(withNitro).toBeGreaterThan(plain * 1.3);
  });

  it('brakes hard and straight', () => {
    const sim = settled();
    accelerateTo(sim, 100);
    sim.intent.throttle = 0;
    sim.intent.brake = 1;
    const startPosition = sim.car.body.translation();
    sim.run(8, () => sim.car.telemetry.speed < 0.4);
    const end = sim.car.body.translation();
    const distance = Math.hypot(end.x - startPosition.x, end.z - startPosition.z);
    const drift = Math.abs(end.x - startPosition.x);
    console.log(`100-0 km/h: ${distance.toFixed(1)} m, sideways ${drift.toFixed(2)} m`);
    expect(distance).toBeGreaterThan(22);
    expect(distance).toBeLessThan(55);
    expect(drift).toBeLessThan(1);
  });

  it('reverses after stopping', () => {
    const sim = settled();
    sim.intent.brake = 1;
    sim.run(4);
    expect(sim.car.telemetry.reversing).toBe(true);
    expect(sim.car.telemetry.forwardSpeed).toBeLessThan(-3);
    sim.intent.brake = 0;
    sim.intent.throttle = 1;
    sim.run(4);
    expect(sim.car.telemetry.reversing).toBe(false);
    expect(sim.car.telemetry.forwardSpeed).toBeGreaterThan(3);
  });

  it('corners near the grip limit at city speed and stays on its wheels', () => {
    const sim = settled();
    accelerateTo(sim, 80);
    sim.intent.steer = 1;
    let minUp = 1;
    let peakLateral = 0;
    let peakSlip = 0;
    sim.run(4, () => {
      minUp = Math.min(minUp, sim.car.telemetry.upY);
      peakLateral = Math.max(peakLateral, Math.abs(sim.car.telemetry.lateralAccel));
      peakSlip = Math.max(peakSlip, Math.abs(sim.car.telemetry.slipAngleDeg));
    });
    const t = sim.car.telemetry;
    console.log(`full lock at 80 km/h: peak lateral ${peakLateral.toFixed(1)} m/s^2, final ${t.speedKmh.toFixed(0)} km/h, peak slip ${peakSlip.toFixed(1)} deg, min up ${minUp.toFixed(3)}`);
    expect(minUp).toBeGreaterThan(0.93);
    expect(peakLateral).toBeGreaterThan(8);
    expect(peakSlip).toBeLessThan(25);
  });

  it('stays stable at full lock at high speed', () => {
    const sim = settled();
    accelerateTo(sim, 165);
    sim.intent.steer = 1;
    let minUp = 1;
    let peakSlip = 0;
    sim.run(3, () => {
      minUp = Math.min(minUp, sim.car.telemetry.upY);
      peakSlip = Math.max(peakSlip, Math.abs(sim.car.telemetry.slipAngleDeg));
    });
    console.log(`full lock at 165 km/h: peak slip ${peakSlip.toFixed(1)} deg, end ${sim.car.telemetry.speedKmh.toFixed(0)} km/h, min up ${minUp.toFixed(3)}`);
    expect(minUp).toBeGreaterThan(0.9);
    expect(peakSlip).toBeLessThan(40);
  });

  it('handbrake starts a drift that a throttle and a straight wheel can catch', () => {
    const sim = settled();
    accelerateTo(sim, 95);
    sim.intent.steer = 1;
    sim.intent.handbrake = true;
    let peakSlip = 0;
    let drifted = false;
    sim.run(0.7, () => {
      peakSlip = Math.max(peakSlip, Math.abs(sim.car.telemetry.slipAngleDeg));
      drifted = drifted || sim.car.telemetry.drifting;
    });
    const entrySlip = peakSlip;
    const entrySpeed = sim.car.telemetry.speedKmh;
    expect(drifted).toBe(true);

    // Hold the slide on throttle with some steering.
    sim.intent.handbrake = false;
    sim.intent.throttle = 1;
    sim.intent.steer = 0.5;
    let spinPeak = 0;
    let driftTime = 0;
    let minUp = 1;
    sim.run(2.2, () => {
      spinPeak = Math.max(spinPeak, Math.abs(sim.car.telemetry.slipAngleDeg));
      minUp = Math.min(minUp, sim.car.telemetry.upY);
      if (sim.car.telemetry.drifting) driftTime += DT;
    });
    const holdSpeed = sim.car.telemetry.speedKmh;

    // Let go of the wheel: the car should straighten itself out.
    sim.intent.steer = 0;
    const recoverTime = sim.run(4, () => !sim.car.telemetry.drifting && Math.abs(sim.car.telemetry.slipAngleDeg) < 8);
    const finalSlip = Math.abs(sim.car.telemetry.slipAngleDeg);
    console.log(
      `drift: entry slip ${entrySlip.toFixed(1)} deg at ${entrySpeed.toFixed(0)} km/h, held peak ${spinPeak.toFixed(1)} deg, ` +
        `drift time ${driftTime.toFixed(2)} s, speed after hold ${holdSpeed.toFixed(0)} km/h, recover ${recoverTime.toFixed(2)} s, min up ${minUp.toFixed(3)}`,
    );
    expect(entrySlip).toBeGreaterThan(14);
    expect(spinPeak).toBeLessThan(75);
    expect(driftTime).toBeGreaterThan(0.9);
    expect(holdSpeed).toBeGreaterThan(45);
    expect(finalSlip).toBeLessThan(12);
    expect(minUp).toBeGreaterThan(0.85);
  });

  it('power slides are possible at low speed', () => {
    const sim = settled();
    accelerateTo(sim, 45);
    sim.intent.steer = 1;
    let peakSlip = 0;
    sim.run(2.5, () => {
      peakSlip = Math.max(peakSlip, Math.abs(sim.car.telemetry.slipAngleDeg));
    });
    console.log(`full throttle, full lock at 45 km/h: peak slip ${peakSlip.toFixed(1)} deg, drifting ${sim.car.telemetry.drifting}`);
    expect(peakSlip).toBeLessThan(70);
  });

  it('is deterministic for the same input', () => {
    const drive = (): number[] => {
      const sim = settled();
      accelerateTo(sim, 70);
      sim.intent.steer = 0.6;
      sim.run(1.5);
      const p = sim.car.body.translation();
      return [p.x, p.y, p.z];
    };
    expect(drive()).toEqual(drive());
  });

  it('lands a jump upright', () => {
    const sim = settled();
    sim.car.reset({ position: { x: 0, y: 7, z: 0 }, yaw: 0 });
    sim.car.body.setLinvel({ x: 0, y: 2, z: 25 }, true);
    sim.car.body.setAngvel({ x: 0.5, y: 0, z: 0.5 }, true);
    let minUpAfter = 1;
    sim.run(4, () => {
      if (sim.car.telemetry.groundedWheels > 0) minUpAfter = Math.min(minUpAfter, sim.car.telemetry.upY);
    });
    console.log(`jump landing: min up on ground ${minUpAfter.toFixed(3)}, final wheels ${sim.car.telemetry.groundedWheels}`);
    expect(sim.car.telemetry.groundedWheels).toBe(4);
    expect(sim.car.telemetry.upY).toBeGreaterThan(0.98);
  });
});
