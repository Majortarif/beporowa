/** Horn language, pedestrians and GPS. Run: npm test */

import { describe, expect, it } from 'vitest';
import { CITY } from '../src/config/city-tuning';
import { GpsNavigator } from '../src/gps/gps-navigator';
import { HornLanguage } from '../src/horn/horn-language';
import { PedestrianSystem, type PedestrianCar } from '../src/pedestrians/pedestrian-system';
import { RoadNetwork } from '../src/world/city/road-network';

const DT = 1 / 60;
const network = new RoadNetwork();

describe('horn language', () => {
  function play(sequence: ReadonlyArray<readonly [boolean, number]>): string[] {
    const horn = new HornLanguage();
    const heard: string[] = [];
    for (const [held, seconds] of sequence) {
      for (let t = 0; t < seconds; t += DT) {
        const pattern = horn.update(DT, held);
        if (pattern) heard.push(pattern);
      }
    }
    return heard;
  }

  it('hears one tap', () => {
    expect(play([[true, 0.1], [false, 0.5]])).toEqual(['tap']);
  });
  it('hears two taps as one phrase', () => {
    expect(play([[true, 0.1], [false, 0.12], [true, 0.1], [false, 0.5]])).toEqual(['double']);
  });
  it('hears three taps', () => {
    expect(play([[true, 0.08], [false, 0.1], [true, 0.08], [false, 0.1], [true, 0.08], [false, 0.5]])).toEqual(['triple']);
  });
  it('hears a long horn once, while it is still held', () => {
    expect(play([[true, 1.5], [false, 0.5]])).toEqual(['long']);
  });
  it('treats separate taps as separate phrases', () => {
    expect(play([[true, 0.1], [false, 0.6], [true, 0.1], [false, 0.6]])).toEqual(['tap', 'tap']);
  });
});

describe('pedestrians', () => {
  function makeCar(x: number, z: number, speed: number): PedestrianCar {
    return { x, y: 0, z, vx: 0, vz: speed, fx: 0, fz: 1, speed, halfLength: 1.95, halfWidth: 0.88 };
  }

  it('fills up and walks', () => {
    const people = new PedestrianSystem(network, 60, []);
    const car = makeCar(-250, 230, 0);
    for (let step = 0; step < 60 * 10; step++) people.update(DT, car, 0, 1);
    expect(people.aliveCount).toBeGreaterThan(30);
    let walking = 0;
    for (let i = 0; i < people.capacity; i++) if (people.alive[i] && people.state[i] === 0) walking++;
    expect(walking).toBeGreaterThan(20);
  });

  it('nobody is ever inside the car, at any speed', () => {
    const people = new PedestrianSystem(network, 120, []);
    // Drive at speed along the bazaar road, straight through the crowd.
    const from = network.nodes[network.nodeIndex('B1')];
    const to = network.nodes[network.nodeIndex('B2')];
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const fx = (to.x - from.x) / length;
    const fz = (to.z - from.z) / length;
    let worst = Infinity;
    for (const speed of [15, 40, 70]) {
      for (let step = 0; step < 60 * 12; step++) {
        const t = ((step * DT * speed) % (length * 3)) / (length * 3);
        const car: PedestrianCar = {
          x: from.x + fx * (t * length * 3 - length),
          y: 0,
          z: from.z + fz * (t * length * 3 - length),
          vx: fx * speed,
          vz: fz * speed,
          fx,
          fz,
          speed,
          halfLength: 1.95,
          halfWidth: 0.88,
        };
        people.update(DT, car, fx, fz);
        for (let i = 0; i < people.capacity; i++) {
          if (!people.alive[i]) continue;
          const dx = people.x[i] - car.x;
          const dz = people.z[i] - car.z;
          const along = Math.abs(dx * fx + dz * fz);
          const side = Math.abs(dx * fz - dz * fx);
          if (along < car.halfLength && side < car.halfWidth) worst = Math.min(worst, Math.max(along - car.halfLength, side - car.halfWidth));
        }
      }
    }
    expect(worst).toBe(Infinity);
  });

  it('a long horn scatters people nearby', () => {
    const people = new PedestrianSystem(network, 80, []);
    const car = makeCar(-250, 230, 0);
    for (let step = 0; step < 60 * 6; step++) people.update(DT, car, 0, 1);
    const response = people.scatter(car);
    expect(response.count).toBeGreaterThan(0);
    expect(response.sample).toBeGreaterThanOrEqual(0);
    expect(people.state[response.sample]).toBe(2);
    const startX = people.x[response.sample];
    const startZ = people.z[response.sample];
    for (let step = 0; step < 30; step++) people.update(DT, car, 0, 1);
    expect(Math.hypot(people.x[response.sample] - startX, people.z[response.sample] - startZ)).toBeGreaterThan(1);
  });

  it('gives gathered people a stall to stand at', () => {
    const people = new PedestrianSystem(network, 40, [{ x: -250, y: 0, z: 230, faceYaw: 0 }, { x: -240, y: 0, z: 240, faceYaw: 0 }]);
    const car = makeCar(-250, 300, 0);
    for (let step = 0; step < 60 * 10; step++) people.update(DT, car, 0, -1);
    let idle = 0;
    for (let i = 0; i < people.capacity; i++) if (people.alive[i] && people.state[i] === 1) idle++;
    expect(idle).toBeGreaterThan(0);
  });
});

describe('gps', () => {
  it('routes from the monument to the bazaar and tells you where to turn', () => {
    const gps = new GpsNavigator(network);
    const start = network.nodes[network.nodeIndex('a2')];
    expect(gps.setDestination(network.nodeIndex('B3'), start.x, 0, start.z - 30)).toBe(true);
    expect(gps.route.length).toBeGreaterThan(1);
    gps.update(DT, start.x, 0, start.z - 30, 0, 1);
    expect(gps.instruction.remaining).toBeGreaterThan(200);
    expect(gps.routePoints.length).toBeGreaterThan(8);
  });

  it('knows left from right', () => {
    const gps = new GpsNavigator(network);
    // Heading south (+Z) down the x = 0 avenue, then east (+X) along z = -200 means the driver's left.
    const nodeA = network.nodes[network.nodeIndex('b2')];
    gps.setDestination(network.nodeIndex('a3'), nodeA.x, 0, nodeA.z + 60);
    gps.update(DT, nodeA.x, 0, nodeA.z + 60, 0, 1);
    expect(gps.route[0]).toBeDefined();
    const towardA2 = network.nodes[network.nodeIndex('a2')];
    gps.update(DT, towardA2.x, 0, towardA2.z - 60, 0, 1);
    expect(gps.instruction.turn).toBe('left');
    // Going the other way along the same road, the turn is to the driver's right.
    gps.setDestination(network.nodeIndex('a1'), nodeA.x, 0, nodeA.z + 60);
    gps.update(DT, towardA2.x, 0, towardA2.z - 60, 0, 1);
    expect(gps.instruction.turn).toBe('right');
  });

  it('notices arrival', () => {
    const gps = new GpsNavigator(network);
    const target = network.nodes[network.nodeIndex('B2')];
    gps.setDestination(target.index, target.x + 200, 0, target.z);
    for (let d = 200; d >= 0; d -= 20) gps.update(DT, target.x + d, 0, target.z, -1, 0);
    expect(gps.arrived).toBe(true);
  });

  it('plans again when you leave the route', () => {
    const gps = new GpsNavigator(network);
    const from = network.nodes[network.nodeIndex('b2')];
    gps.setDestination(network.nodeIndex('c4'), from.x, 0, from.z);
    gps.update(DT, from.x, 0, from.z, 0, -1);
    const before = gps.route.join(',');
    const far = network.nodes[network.nodeIndex('a4')];
    gps.update(CITY.gps.repathCooldown + 1, far.x, 0, far.z, 0, -1);
    expect(gps.route.join(',')).not.toBe(before);
  });
});
