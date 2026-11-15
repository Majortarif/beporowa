/** The garage's rules: rude slogans, the dyno graph, where the workshop stands, and top-end cars. Run: npm test */

import { beforeAll, describe, expect, it } from 'vitest';
import { CARS, CAR_BY_ID, LIVERY_ARTS, LIVERY_BANDS, LIVERY_COLOURS, LIVERY_GLOWS, SLOGAN_MAX_LENGTH } from '../src/config/cars';
import { TUNING } from '../src/config/tuning';
import { dynoCurve, dynoSpeeds } from '../src/garage/dyno-curve';
import { checkSlogan, visibleLength } from '../src/garage/slogan-filter';
import { statsWithParts } from '../src/progression/economy';
import { loadPhysicsEngine } from '../src/physics/physics-world';
import { PhysicsWorld } from '../src/physics/physics-world';
import { SHAPES } from '../src/race/rival-models';
import { newOwnedCar } from '../src/save/career';
import { VehicleController } from '../src/vehicle/vehicle-controller';
import { createIntent } from '../src/input/intent';
import { createRoadHit, RoadNetwork } from '../src/world/city/road-network';
import { buildRoadOccupancy } from '../src/world/city/city-buildings';
import { findGarageHome } from '../src/world/city/garage-building';
import bn from '../src/i18n/bn.json';
import en from '../src/i18n/en.json';

describe('words on the tail', () => {
  it('lets ordinary slogans through', () => {
    for (const line of ['মায়ের দোয়া', 'ধীরে চলো', 'আবার দেখা হবে', 'রাজা বাদশা', 'Keep your distance', 'বালক', 'শালিক পাখি', 'class act', '']) {
      expect(checkSlogan(line), line).toBe('none');
    }
  });

  it('stops rude words in Bangla, Banglish and English', () => {
    for (const line of ['শালা', 'তুই বাল', 'খানকি', 'হারামজাদা', 'madarchod', 'BOKACHODA', 'fuck', 'bal']) {
      expect(checkSlogan(line), line).toBe('rude');
    }
  });

  it('sees through simple disguises', () => {
    for (const line of ['f u c k', 'sh1t', 'f.u.c.k', 'খান‍কি']) {
      expect(checkSlogan(line), line).toBe('rude');
    }
  });

  it('counts conjuncts as people do, and refuses what will not fit', () => {
    expect(visibleLength('ক্ষ')).toBe(1);
    expect(checkSlogan('অ'.repeat(SLOGAN_MAX_LENGTH))).toBe('none');
    expect(checkSlogan('অ'.repeat(SLOGAN_MAX_LENGTH + 1))).toBe('tooLong');
  });

  it('the ready-made slogans pass their own filter, and there are enough of them', () => {
    for (const table of [bn, en]) {
      for (const line of table.garage.sloganChoices) expect(checkSlogan(line), line).toBe('none');
    }
    expect(bn.garage.sloganChoices.length).toBe(en.garage.sloganChoices.length);
  });
});

describe('dyno graph', () => {
  const speeds = dynoSpeeds([1]);

  it('runs from low speed to just past the top', () => {
    expect(speeds[0]).toBe(10);
    expect(speeds[speeds.length - 1]).toBeGreaterThanOrEqual(TUNING.vehicle.engine.topSpeedKmh);
  });

  it('rises, then falls to nothing at the top speed', () => {
    const curve = dynoCurve(1, 1, speeds);
    expect(curve[1]).toBeGreaterThan(curve[0]);
    expect(Math.max(...curve)).toBeGreaterThan(curve[0]);
    expect(curve[curve.length - 1]).toBeCloseTo(0, 3);
    for (const value of curve) expect(Number.isFinite(value)).toBe(true);
  });

  it('every engine part moves the line up, and more top speed moves its end out', () => {
    const car = CAR_BY_ID.get('bulbuli')!;
    const stock = dynoCurve(car.stats.power, car.stats.topSpeed, speeds);
    const engine = statsWithParts(car, { ...newOwnedCar('bulbuli').parts, engine: 3 });
    const tuned = dynoCurve(engine.power, engine.topSpeed, speeds);
    expect(Math.max(...tuned)).toBeGreaterThan(Math.max(...stock));
    const turbo = statsWithParts(car, { ...newOwnedCar('bulbuli').parts, turbo: 3 });
    const wide = dynoSpeeds([car.stats.topSpeed, turbo.topSpeed]);
    expect(wide.length).toBeGreaterThan(speeds.length);
  });
});

describe('paint', () => {
  it('every car starts in paint the editor can offer', () => {
    for (const car of CARS) {
      expect(LIVERY_BANDS, car.id).toContain(car.livery.band);
      expect(LIVERY_ARTS, car.id).toContain(car.livery.art);
      expect(LIVERY_GLOWS.length).toBeGreaterThan(0);
      expect(LIVERY_COLOURS.length).toBeGreaterThan(0);
      expect(car.livery.base, car.id).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('every kit car has a body to build', () => {
    for (const car of CARS) {
      if (car.model === 'bulbuli' || car.model === 'rocket') continue;
      expect(SHAPES[car.model], car.id).toBeDefined();
    }
  });
});

describe("ওস্তাদ's garage", () => {
  const network = new RoadNetwork();
  const occupancy = buildRoadOccupancy(network);
  const home = findGarageHome(network, occupancy);

  it('stands beside the road, near where a drive starts', () => {
    expect(Math.hypot(home.x, home.z)).toBeLessThan(320);
    const hit = network.nearestRoad(home.exitX, home.exitZ, 0, createRoadHit());
    const edge = network.edges[hit.edge];
    expect(hit.distance).toBeLessThan(edge.spec.halfWidth);
    expect(edge.elevated).toBe(false);
  });

  it('opens toward the road, and sends the car off along it', () => {
    const toRoadX = home.exitX - home.x;
    const toRoadZ = home.exitZ - home.z;
    expect(Math.sin(home.yaw) * toRoadX + Math.cos(home.yaw) * toRoadZ).toBeGreaterThan(0);
    const hit = network.nearestRoad(home.exitX, home.exitZ, 0, createRoadHit());
    const along = Math.abs(Math.sin(home.exitYaw) * hit.tx + Math.cos(home.exitYaw) * hit.tz);
    expect(along).toBeGreaterThan(0.9);
  });

  it('is on ground nothing else may take', () => {
    expect(occupancy.isFree(home.x, home.z, home.yaw, 2, 2)).toBe(false);
  });
});

describe('the strongest cars', () => {
  beforeAll(async () => {
    await loadPhysicsEngine();
  });

  function drive(profile: ConstructorParameters<typeof VehicleController>[3]): { top: number; upright: boolean } {
    const physics = new PhysicsWorld(1 / TUNING.physics.fixedHz);
    physics.addFixedCuboid(4000, 1, 4000, 0, -1, 0, 'road');
    const car = new VehicleController(physics, { position: { x: 0, y: 0.8, z: -3000 }, yaw: 0 }, undefined, profile);
    const intent = createIntent();
    intent.throttle = 1;
    let top = 0;
    physics.step();
    for (let i = 0; i < 60 * 45; i++) {
      car.update(1 / TUNING.physics.fixedHz, intent);
      physics.step();
      top = Math.max(top, car.telemetry.speedKmh);
    }
    return { top, upright: car.telemetry.upY > 0.9 };
  }

  it('hold the road at full throttle with every part fitted, and top out where they should', () => {
    const full = { engine: 3, turbo: 3, tyres: 3, suspension: 3, brakes: 3, nitro: 3 };
    for (const id of ['bagha', 'rocket']) {
      const stats = statsWithParts(CAR_BY_ID.get(id)!, full);
      const result = drive({ powerScale: stats.power, topSpeedScale: stats.topSpeed, gripScale: stats.grip, brakeScale: stats.brake, nitroScale: stats.nitro, steerScale: stats.steer });
      expect(result.upright, id).toBe(true);
      const limit = TUNING.vehicle.engine.topSpeedKmh * stats.topSpeed;
      expect(result.top, id).toBeLessThan(limit * 1.06);
      expect(result.top, id).toBeGreaterThan(TUNING.vehicle.engine.topSpeedKmh);
    }
  });
});
