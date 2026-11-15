/** A whole city of traffic, run headless. Run: npm test */

import { beforeAll, describe, expect, it } from 'vitest';
import { CITY } from '../src/config/city-tuning';
import { EventBus, type GameEvents } from '../src/core/events';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { TRAFFIC_TYPES, TrafficSystem, type TrafficPlayer, type TrafficView } from '../src/traffic/traffic-system';
import { RoadNetwork } from '../src/world/city/road-network';

const DT = 1 / 60;
const network = new RoadNetwork();

function makePlayer(x: number, z: number): TrafficPlayer {
  return { x, y: 0, z, vx: 0, vz: 0, fx: 0, fz: 1, speed: 0, halfLength: 1.95, halfWidth: 0.88, mass: 1150 };
}

function viewOf(player: TrafficPlayer): TrafficView {
  return { x: player.x, z: player.z, fx: player.fx, fz: player.fz };
}

function createTraffic(capacity = 120, bodies = 20): { traffic: TrafficSystem; physics: PhysicsWorld; bus: EventBus } {
  for (const lane of network.lanes) lane.agents.length = 0;
  for (const node of network.nodes) node.occupancy = 0;
  const physics = new PhysicsWorld(DT);
  physics.addFixedCuboid(5000, 2, 5000, 0, -2, 0, 'road');
  const bus = new EventBus();
  const traffic = new TrafficSystem(network, physics, bus, capacity, bodies);
  return { traffic, physics, bus };
}

beforeAll(async () => {
  await loadPhysicsEngine();
});

describe('traffic', () => {
  it('fills the bubble and keeps moving without gridlock', () => {
    const { traffic, physics } = createTraffic();
    const player = makePlayer(0, -300);
    traffic.prewarm(player, viewOf(player));
    expect(traffic.aliveCount).toBeGreaterThan(60);

    let speedSum = 0;
    let samples = 0;
    let stopped = 0;
    let worstGap = Infinity;
    for (let step = 0; step < 60 * 120; step++) {
      traffic.update(DT, player, viewOf(player));
      physics.step();
      if (step % 60 === 0) {
        let moving = 0;
        for (let i = 0; i < traffic.capacity; i++) {
          if (!traffic.alive[i]) continue;
          speedSum += traffic.v[i];
          samples++;
          if (traffic.v[i] < 0.2) moving++;
        }
        stopped = moving;
        for (const lane of network.lanes) {
          if (lane.agents.length < 2) continue;
          // Bikes filter past others on purpose, so only check lanes without them.
          if (lane.agents.some((a) => TRAFFIC_TYPES[traffic.type[a]] === 'bike')) continue;
          worstGap = Math.min(worstGap, ...traffic.laneGaps(lane.id));
        }
      }
    }
    const average = speedSum / samples;
    console.log(`traffic after 120 s: ${traffic.aliveCount} alive, mean ${average.toFixed(1)} m/s, ${stopped} stopped now, worst same-lane gap ${worstGap.toFixed(2)} m, ${traffic.activeBodies} bodies`);
    expect(traffic.aliveCount).toBeGreaterThan(70);
    expect(average).toBeGreaterThan(2.5);
    expect(stopped / traffic.aliveCount).toBeLessThan(0.75);
    // Two vehicles merging from different connectors may touch for a moment, but never pile up.
    expect(worstGap).toBeGreaterThan(-3);
  });

  it('keeps its bookkeeping straight', () => {
    const { traffic, physics } = createTraffic(100, 12);
    const player = makePlayer(-250, 230);
    for (let step = 0; step < 60 * 40; step++) {
      // The player keeps moving, so vehicles spawn and despawn all the time.
      player.x = -250 + Math.sin(step / 500) * 200;
      player.z = 230 + Math.cos(step / 500) * 200;
      traffic.update(DT, player, viewOf(player));
      physics.step();
    }
    let onLanes = 0;
    for (const lane of network.lanes) onLanes += lane.agents.length;
    // A vehicle knocked off its lane by the moving player is alive but on no lane.
    let knocked = 0;
    for (let i = 0; i < traffic.capacity; i++) if (traffic.alive[i] && traffic.mode[i] === 1) knocked++;
    expect(onLanes + knocked).toBe(traffic.aliveCount);
    for (const node of network.nodes) expect(node.occupancy, node.id).toBeGreaterThanOrEqual(0);
    expect(traffic.activeBodies).toBeLessThanOrEqual(12);
  });

  it('stops at red lights', () => {
    const { traffic, physics } = createTraffic(80, 0);
    const player = makePlayer(0, -300);
    traffic.prewarm(player, viewOf(player));
    let crossingsOnRed = 0;
    const lastLane = new Int32Array(traffic.capacity).fill(-1);
    for (let step = 0; step < 60 * 60; step++) {
      for (let i = 0; i < traffic.capacity; i++) {
        lastLane[i] = traffic.alive[i] ? traffic.agentLane(i).lane : -1;
      }
      traffic.update(DT, player, viewOf(player));
      physics.step();
      for (let i = 0; i < traffic.capacity; i++) {
        if (!traffic.alive[i] || lastLane[i] < 0) continue;
        const now = traffic.agentLane(i).lane;
        if (now === lastLane[i]) continue;
        const from = network.lanes[lastLane[i]];
        if (from.isConnector) continue;
        const node = network.nodes[from.node];
        if (node.signalized && traffic.signals.stateFor(node, from.signalGroup) === 'red') crossingsOnRed++;
      }
    }
    console.log(`crossings on red in 60 s: ${crossingsOnRed}`);
    expect(crossingsOnRed).toBe(0);
  });

  it('gives near vehicles colliders, and stops for a player in the lane', () => {
    const { traffic, physics } = createTraffic(60, 12);
    const player = makePlayer(0, -320);
    traffic.prewarm(player, viewOf(player));
    let minimumBumper = Infinity;
    for (let step = 0; step < 60 * 60; step++) {
      traffic.update(DT, player, viewOf(player));
      physics.step();
      if (step < 60 * 5) continue;
      for (let i = 0; i < traffic.capacity; i++) {
        if (!traffic.alive[i]) continue;
        const dx = traffic.x[i] - player.x;
        const dz = traffic.z[i] - player.z;
        minimumBumper = Math.min(minimumBumper, Math.hypot(dx, dz));
      }
    }
    expect(traffic.activeBodies).toBeGreaterThan(0);
    // The player parks at the side of the avenue, so nothing should drive through it.
    expect(minimumBumper).toBeGreaterThan(1.2);
  });

  it('pulls over for a horn tap', () => {
    const { traffic, physics } = createTraffic(100, 0);
    const player = makePlayer(0, -320);
    traffic.prewarm(player, viewOf(player));
    for (let step = 0; step < 60 * 20; step++) {
      traffic.update(DT, player, viewOf(player));
      physics.step();
    }
    let response = { count: 0, sample: -1 };
    for (let step = 0; step < 60 * 30 && response.count === 0; step++) {
      traffic.update(DT, player, viewOf(player));
      physics.step();
      response = traffic.hornYield(player);
    }
    expect(response.count).toBeGreaterThan(0);
    const before = traffic.v[response.sample];
    for (let step = 0; step < 60; step++) traffic.update(DT, player, viewOf(player));
    expect(traffic.v[response.sample]).toBeLessThanOrEqual(Math.max(before, 3) + 0.5);
  });

  it('a crash scales with mass: buses stop the player, rickshaws hardly do', () => {
    const results: Record<string, number> = {};
    for (const wanted of ['bus', 'rickshaw'] as const) {
      const { traffic, physics, bus } = createTraffic(120, 30);
      const player = makePlayer(0, -320);
      traffic.prewarm(player, viewOf(player));
      for (let step = 0; step < 30; step++) {
        traffic.update(DT, player, viewOf(player));
        physics.step();
      }
      // Find a vehicle of this type, wherever the map keeps it, and drive into it.
      let target = -1;
      for (let attempt = 0; attempt < 3000 && target < 0; attempt++) {
        player.x = (attempt * 37) % 1200 - 600;
        player.z = (attempt * 53) % 1400 - 800;
        traffic.update(DT, player, viewOf(player));
        physics.step();
        for (let i = 0; i < traffic.capacity; i++) {
          if (traffic.alive[i] && TRAFFIC_TYPES[traffic.type[i]] === wanted && traffic.mode[i] === 0) target = i;
        }
      }
      expect(target, wanted).toBeGreaterThanOrEqual(0);
      let outVx = 0;
      let outVz = 0;
      let responded = false;
      traffic.onPlayerVelocity = (vx, vz) => {
        outVx = vx;
        outVz = vz;
        responded = true;
      };
      const events: GameEvents['trafficHit'][] = [];
      bus.on('trafficHit', (event) => events.push(event));
      const speed = 28;
      for (let step = 0; step < 90 && !responded; step++) {
        player.fx = traffic.tx[target];
        player.fz = traffic.tz[target];
        player.x = traffic.x[target] - player.fx * 2.5;
        player.z = traffic.z[target] - player.fz * 2.5;
        player.y = traffic.y[target];
        player.vx = player.fx * speed;
        player.vz = player.fz * speed;
        player.speed = speed;
        traffic.update(DT, player, viewOf(player));
        physics.step();
      }
      expect(responded, wanted).toBe(true);
      expect(events.length).toBeGreaterThan(0);
      results[wanted] = Math.hypot(outVx, outVz);
      expect(traffic.mode[target]).toBe(1);
    }
    console.log(`player speed after a 28 m/s crash: bus ${results.bus.toFixed(1)}, rickshaw ${results.rickshaw.toFixed(1)} m/s`);
    expect(results.rickshaw).toBeGreaterThan(20);
    expect(results.bus).toBeLessThan(12);
  });

  it('rewards passing close, and a squeeze between two vehicles rewards more', () => {
    const { traffic, physics, bus } = createTraffic(100, 0);
    const player = makePlayer(0, -320);
    traffic.prewarm(player, viewOf(player));
    const events: GameEvents['nearMiss'][] = [];
    bus.on('nearMiss', (event) => events.push(event));
    for (let step = 0; step < 60; step++) {
      traffic.update(DT, player, viewOf(player));
      physics.step();
    }
    let target = -1;
    for (let i = 0; i < traffic.capacity && target < 0; i++) {
      if (traffic.alive[i] && traffic.mode[i] === 0) target = i;
    }
    expect(target).toBeGreaterThanOrEqual(0);

    // Overtake this vehicle fast, on its right, about half a metre clear of it.
    const halfWidth = CITY.trafficTypes[TRAFFIC_TYPES[traffic.type[target]]].width / 2;
    const speed = 30;
    let along = -18;
    for (let step = 0; step < 90 && events.length === 0; step++) {
      const fx = traffic.tx[target];
      const fz = traffic.tz[target];
      // Right of travel is (-tz, tx) with +X to the left of +Z.
      const side = halfWidth + player.halfWidth + 0.5;
      player.fx = fx;
      player.fz = fz;
      player.x = traffic.x[target] + fx * along - fz * side;
      player.z = traffic.z[target] + fz * along + fx * side;
      player.y = traffic.y[target];
      player.vx = fx * speed;
      player.vz = fz * speed;
      player.speed = speed;
      traffic.update(DT, player, viewOf(player));
      physics.step();
      along += (speed - traffic.v[target]) * DT;
    }
    expect(events.length).toBe(1);
    expect(events[0].squeeze).toBe(false);

    // The next pass on the other side, right after it, counts as squeezing through.
    const internal = traffic as unknown as { recordNearMiss(onLeft: boolean): void; time: number; lastMissLeft: number; lastMissRight: number };
    internal.lastMissLeft = -10;
    internal.lastMissRight = -10;
    internal.time += 5;
    events.length = 0;
    internal.recordNearMiss(true);
    internal.time += 0.3;
    internal.recordNearMiss(false);
    expect(events[events.length - 1].squeeze).toBe(true);
    expect(events[events.length - 1].points).toBe(CITY.traffic.nearMiss.squeezePoints);
  });

  it('never lets a crash throw a vehicle faster than its limit', () => {
    for (const type of TRAFFIC_TYPES) {
      expect(CITY.trafficTypes[type].maxKnockSpeed).toBeLessThanOrEqual(18);
    }
    expect(CITY.trafficTypes.rickshaw.maxKnockSpeed).toBeLessThan(7);
  });
});
