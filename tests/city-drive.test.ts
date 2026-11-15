/**
 * Drives the real flyover headless: up a ramp, around the loop, down again, with keyboard-style
 * steering. Also checks that the barriers hold and how much CPU a full city of traffic costs.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { QUALITY_PRESETS, TUNING } from '../src/config/tuning';
import { EventBus } from '../src/core/events';
import { createSample } from '../src/core/polyline';
import { createIntent } from '../src/input/intent';
import { PedestrianSystem, type PedestrianCar } from '../src/pedestrians/pedestrian-system';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { TrafficSystem, type TrafficPlayer } from '../src/traffic/traffic-system';
import { VehicleController } from '../src/vehicle/vehicle-controller';
import { computeElevatedGeometry } from '../src/world/city/elevated-geometry';
import { RoadNetwork } from '../src/world/city/road-network';

const DT = 1 / TUNING.physics.fixedHz;
const network = new RoadNetwork();

function buildPhysics(): PhysicsWorld {
  const physics = new PhysicsWorld(DT);
  physics.addFixedCuboid(5000, 2, 5000, 0, -2, 0, 'road');
  const elevated = computeElevatedGeometry(network);
  for (const surface of elevated.surfaces) physics.addFixedTrimesh(surface.positions, surface.indices, 'road');
  for (const barrier of elevated.barriers) {
    physics.addFixedCuboid(0.3, barrier.halfHeight, barrier.halfLength, barrier.x, barrier.y, barrier.z, 'road', barrier.yaw);
  }
  for (const pillar of elevated.pillars) {
    physics.addFixedCuboid(0.8, (pillar.topY - 1.25) / 2, 1.2, pillar.x, (pillar.topY - 1.25) / 2, pillar.z, 'road', pillar.yaw);
  }
  return physics;
}

/** Flat x, y, z of a drive along a list of neighbouring nodes. */
function pathThrough(ids: readonly string[]): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = [];
  const sample = createSample();
  for (let i = 0; i < ids.length - 1; i++) {
    const a = network.nodeIndex(ids[i]);
    const b = network.nodeIndex(ids[i + 1]);
    const edge = network.edgeBetween(a, b);
    if (!edge) throw new Error(`No road from ${ids[i]} to ${ids[i + 1]}`);
    const forward = edge.a === a;
    for (let s = 0; s <= edge.full.length; s += 4) {
      edge.full.sample(forward ? s : edge.full.length - s, sample);
      points.push({ x: sample.x, y: sample.y, z: sample.z });
    }
  }
  return points;
}

function wrapAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

beforeAll(async () => {
  await loadPhysicsEngine();
});

describe('driving the city', () => {
  it('climbs a ramp, laps the flyover and comes back down', () => {
    const physics = buildPhysics();
    const path = pathThrough(['W1', 'g1', 'dSW', 'dSE', 'dNE', 'dNW', 'dSW', 'g1', 'W1']);
    const start = path[6];
    const next = path[8];
    const car = new VehicleController(
      physics,
      { position: { x: start.x, y: start.y + 0.8, z: start.z }, yaw: Math.atan2(next.x - start.x, next.z - start.z) },
      new EventBus(),
    );
    const intent = createIntent();
    physics.step();

    let index = 8;
    let steer = 0;
    let time = 0;
    let topKmh = 0;
    let minUp = 1;
    let airborne = 0;
    let highest = 0;
    let lowestOnDeck = Infinity;
    let stuckTime = 0;

    while (index < path.length - 3 && time < 280) {
      const t = car.telemetry;
      const p = car.position;
      while (index < path.length - 2 && Math.hypot(path[index].x - p.x, path[index].z - p.z) < 6 + t.speed * 0.45) index++;
      const q = car.quaternion;
      const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      const target = path[index];
      const error = wrapAngle(Math.atan2(target.x - p.x, target.z - p.z) - heading);
      const wanted = error > 0.03 ? -1 : error < -0.03 ? 1 : 0;
      const rate = wanted === 0 ? TUNING.input.keyboardSteerReturn : TUNING.input.keyboardSteerRate;
      const delta = wanted - steer;
      steer += Math.abs(delta) <= rate * DT ? delta : Math.sign(delta) * rate * DT;
      intent.steer = steer;

      // Brake for what lies ahead.
      let allowed = Infinity;
      for (let look = 2; look < 50 && index + look + 3 < path.length; look++) {
        const a = path[index + look - 2];
        const b = path[index + look];
        const c = path[index + look + 2];
        const turn = Math.abs(wrapAngle(Math.atan2(c.x - b.x, c.z - b.z) - Math.atan2(b.x - a.x, b.z - a.z)));
        const radius = 8 / Math.max(turn, 0.0005);
        const corner = Math.sqrt(9 * radius);
        allowed = Math.min(allowed, Math.sqrt(corner * corner + 2 * 9 * look * 4));
      }
      const tooFast = t.speed > allowed;
      intent.throttle = tooFast ? 0 : 1;
      intent.brake = tooFast ? 1 : 0;

      car.update(DT, intent);
      physics.step();
      time += DT;

      topKmh = Math.max(topKmh, t.speedKmh);
      minUp = Math.min(minUp, t.upY);
      if (t.groundedWheels === 0) airborne += DT;
      highest = Math.max(highest, p.y);
      if (target.y > 8.9 && path[Math.max(0, index - 6)].y > 8.9) lowestOnDeck = Math.min(lowestOnDeck, p.y);
      stuckTime = t.speed < 1 && time > 3 ? stuckTime + DT : 0;
      if (stuckTime > 6) break;
    }

    console.log(
      `flyover drive: ${time.toFixed(1)} s, reached ${index}/${path.length}, top ${topKmh.toFixed(0)} km/h, highest ${highest.toFixed(1)} m, ` +
        `lowest on deck ${lowestOnDeck.toFixed(1)} m, min up ${minUp.toFixed(3)}, airborne ${airborne.toFixed(2)} s`,
    );
    expect(index).toBeGreaterThanOrEqual(path.length - 3);
    expect(highest).toBeGreaterThan(9.3);
    expect(lowestOnDeck).toBeGreaterThan(9);
    expect(topKmh).toBeGreaterThan(150);
    expect(minUp).toBeGreaterThan(0.9);
    expect(airborne).toBeLessThan(2);
  });

  it('barriers keep a fast car on the flyover', () => {
    const physics = buildPhysics();
    const edge = network.edgeBetween(network.nodeIndex('dSW'), network.nodeIndex('dSE'));
    expect(edge).not.toBeNull();
    const sample = createSample();
    edge!.center.sample(edge!.center.length * 0.3, sample);
    for (const side of [1, -1]) {
      // Aimed at the barrier at a steep angle, at top speed.
      const heading = Math.atan2(sample.tx, sample.tz) + side * 0.9;
      const car = new VehicleController(
        physics,
        { position: { x: sample.x, y: sample.y + 0.8, z: sample.z }, yaw: heading },
        new EventBus(),
      );
      const intent = createIntent();
      intent.throttle = 1;
      car.body.setLinvel({ x: Math.sin(heading) * 55, y: 0, z: Math.cos(heading) * 55 }, true);
      physics.step();
      let lowest = Infinity;
      for (let step = 0; step < 60 * 3; step++) {
        car.update(DT, intent);
        physics.step();
        lowest = Math.min(lowest, car.position.y);
      }
      console.log(`barrier hit at 198 km/h, side ${side}: lowest ${lowest.toFixed(2)} m`);
      expect(lowest).toBeGreaterThan(8.5);
      physics.world.removeRigidBody(car.body);
    }
  });

  it('a full ultra city of traffic and people costs little CPU', () => {
    for (const lane of network.lanes) lane.agents.length = 0;
    for (const node of network.nodes) node.occupancy = 0;
    const preset = QUALITY_PRESETS.ultra;
    const physics = new PhysicsWorld(DT);
    physics.addFixedCuboid(5000, 2, 5000, 0, -2, 0, 'road');
    const traffic = new TrafficSystem(network, physics, new EventBus(), preset.trafficTotal, preset.trafficBodies);
    const people = new PedestrianSystem(network, preset.pedestrians, []);
    const player: TrafficPlayer = { x: -250, y: 0, z: 230, vx: 0, vz: 20, fx: 0, fz: 1, speed: 20, halfLength: 1.95, halfWidth: 0.88, mass: 1150 };
    const car: PedestrianCar = { x: -250, y: 0, z: 230, vx: 0, vz: 20, fx: 0, fz: 1, speed: 20, halfLength: 1.95, halfWidth: 0.88 };
    const view = { x: -250, z: 230, fx: 0, fz: 1 };
    traffic.prewarm(player, view);
    for (let step = 0; step < 600; step++) {
      traffic.update(DT, player, view);
      people.update(DT, car, 0, 1);
    }
    const start = performance.now();
    const steps = 600;
    for (let step = 0; step < steps; step++) {
      player.x = -250 + Math.sin(step / 200) * 150;
      player.z = 230 + Math.cos(step / 200) * 150;
      car.x = player.x;
      car.z = player.z;
      traffic.update(DT, player, view);
      people.update(DT, car, 0, 1);
    }
    const milliseconds = (performance.now() - start) / steps;
    console.log(`ultra city CPU: ${milliseconds.toFixed(3)} ms per step, ${traffic.aliveCount} vehicles, ${people.aliveCount} people`);
    // The design budget for AI at 60 FPS is 2 ms, with room left on slower machines.
    expect(milliseconds).toBeLessThan(2);
  });
});
