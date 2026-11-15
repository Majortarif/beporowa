/** Traps, hiding spots, দম and the radio. Run: npm test */

import { beforeAll, describe, expect, it } from 'vitest';
import { POLICE } from '../src/config/police-tuning';
import { TUNING } from '../src/config/tuning';
import { EventBus, type GameEvents, type RadioCategory } from '../src/core/events';
import { DomMeter } from '../src/game/dom-meter';
import { setLocale, tList } from '../src/i18n';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { HideSpots } from '../src/police/hide-spots';
import { PoliceRadio } from '../src/police/police-radio';
import { TrapSystem, layOutTraps } from '../src/traps/trap-system';
import { buildRoadOccupancy } from '../src/world/city/city-buildings';
import { layOutGarages } from '../src/world/city/parking-garages';
import { RoadNetwork } from '../src/world/city/road-network';

const DT = 1 / TUNING.physics.fixedHz;
const network = new RoadNetwork();

beforeAll(async () => {
  await loadPhysicsEngine();
});

describe('ঝামেলা-ফাঁদ', () => {
  function setUp(): { system: TrapSystem; events: GameEvents['trapSprung'][]; stunned: number[] } {
    const physics = new PhysicsWorld(DT);
    physics.addFixedCuboid(5000, 2, 5000, 0, -2, 0, 'road');
    const bus = new EventBus();
    const traps = layOutTraps(network, buildRoadOccupancy(network));
    const system = new TrapSystem(physics, bus, traps);
    const events: GameEvents['trapSprung'][] = [];
    const stunned: number[] = [];
    bus.on('trapSprung', (event) => events.push(event));
    system.stun = (x, z, radius) => {
      stunned.push(radius);
      return x + z === Infinity ? 0 : 2;
    };
    physics.step();
    return { system, events, stunned };
  }

  it('stands on the roadside all over the map, in all three kinds', () => {
    const { system } = setUp();
    expect(system.traps.length).toBeGreaterThan(10);
    const kinds = new Set(system.traps.map((trap) => trap.kind));
    expect(kinds.size).toBe(3);
    const hit = { edge: 0, s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, distance: 0 };
    for (const trap of system.traps) {
      const road = network.nearestRoad(trap.x, trap.z, trap.y, hit);
      expect(road.distance, trap.kind).toBeGreaterThan(network.edges[road.edge].spec.halfWidth - 0.5);
      expect(road.distance, trap.kind).toBeLessThan(14);
    }
  });

  it('comes down when clipped at speed, stuns police, and pays out', () => {
    const { system, events, stunned } = setUp();
    const trap = system.traps[0];
    system.update(DT, trap.x + 3, trap.y, trap.z, POLICE.traps.triggerMinSpeed + 5);
    expect(events.length).toBe(1);
    expect(events[0].stunned).toBe(2);
    expect(stunned[0]).toBe(POLICE.traps.stunRadius);
    expect(trap.armed).toBe(false);
    expect(system.debris.filter((piece) => piece.active).length).toBe(trap.pieces.length);
  });

  it('stays up when you roll past slowly, but not if you actually hit it', () => {
    const { system, events } = setUp();
    const trap = system.traps[1];
    system.update(DT, trap.x + 4, trap.y, trap.z, 3);
    expect(events.length).toBe(0);
    system.update(DT, trap.x + 1.5, trap.y, trap.z, 3);
    expect(events.length).toBe(1);
  });

  it('ignores a car on the flyover overhead', () => {
    const { system, events } = setUp();
    const trap = system.traps[2];
    system.update(DT, trap.x, trap.y + 9, trap.z, 30);
    expect(events.length).toBe(0);
  });

  it('stands up again only after a while, and only when you are away', () => {
    const { system } = setUp();
    const trap = system.traps[0];
    system.spring(trap);
    for (let t = 0; t < POLICE.traps.rearmSeconds + 1; t += 1) system.update(1, trap.x + 20, trap.y, trap.z, 0);
    expect(trap.armed).toBe(false);
    system.update(1, trap.x + POLICE.traps.rearmDistance + 10, trap.y, trap.z, 0);
    expect(trap.armed).toBe(true);
  });

  it('falling pieces retire on their own, and a restart stands everything back up', () => {
    const { system } = setUp();
    system.spring(system.traps[0]);
    system.spring(system.traps[3]);
    for (let t = 0; t < POLICE.traps.lifeSeconds + 1; t += 1) system.update(1, 9000, 0, 9000, 0);
    expect(system.debris.filter((piece) => piece.active).length).toBe(0);
    system.spring(system.traps[0]);
    system.clear();
    expect(system.traps.every((trap) => trap.armed)).toBe(true);
    expect(system.debris.filter((piece) => piece.active).length).toBe(0);
  });
});

describe('hiding spots', () => {
  const occupancy = buildRoadOccupancy(network);
  const garages = layOutGarages(network, occupancy);
  const stall = { x: 12345, z: 12345, isTea: true };
  const spots = new HideSpots(network, garages, [stall, { x: 0, z: 0, isTea: false }]);

  it('places several garages, off the road and well apart', () => {
    expect(garages.length).toBe(POLICE.hide.garageCount);
    const hit = { edge: 0, s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, distance: 0 };
    for (const garage of garages) {
      const road = network.nearestRoad(garage.x, garage.z, 0, hit);
      expect(road.distance - network.edges[road.edge].spec.halfWidth).toBeGreaterThan(POLICE.hide.garageDepth / 2);
      // The mouth faces the road it was built on.
      const mouthX = garage.x + Math.sin(garage.yaw) * garage.halfDepth;
      const mouthZ = garage.z + Math.cos(garage.yaw) * garage.halfDepth;
      expect(Math.hypot(mouthX - road.x, mouthZ - road.z)).toBeLessThan(Math.hypot(garage.x - road.x, garage.z - road.z));
    }
    for (let i = 0; i < garages.length; i++) {
      for (let j = i + 1; j < garages.length; j++) {
        expect(Math.hypot(garages[i].x - garages[j].x, garages[i].z - garages[j].z)).toBeGreaterThanOrEqual(POLICE.hide.garageSpacing);
      }
    }
  });

  it('a garage hides a slow car from everything, and a fast one only from the air', () => {
    const garage = garages[0];
    const slow = spots.query(garage.x, 0, garage.z, 10);
    expect(slow.kind).toBe('garage');
    expect(slow.factor).toBe(POLICE.hide.garageFactor);
    expect(slow.concealed).toBe(true);
    expect(slow.coveredFromAir).toBe(true);
    const fast = spots.query(garage.x, 0, garage.z, 90);
    expect(fast.factor).toBe(1);
    expect(fast.concealed).toBe(false);
    expect(fast.coveredFromAir).toBe(true);
  });

  it('a tea stall crowd helps only when slow, and only from the ground', () => {
    const slow = spots.query(stall.x + 4, 0, stall.z, 12);
    expect(slow.kind).toBe('tea');
    expect(slow.coveredFromAir).toBe(false);
    expect(spots.query(stall.x + 4, 0, stall.z, 80).kind).not.toBe('tea');
  });

  it('alleys and the ground under the flyover count, and an open avenue does not', () => {
    const lane = network.edges.find((edge) => edge.kind === 'lane' && !edge.jam)!;
    const sample = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
    lane.center.sample(lane.center.length / 2, sample);
    expect(spots.query(sample.x, 0, sample.z, 40).kind).toBe('alley');

    const deck = network.edges.find((edge) => edge.kind === 'deck')!;
    deck.center.sample(deck.center.length / 2, sample);
    const under = spots.query(sample.x, 0, sample.z, 40);
    expect(under.kind).toBe('flyover');
    expect(under.coveredFromAir).toBe(true);
    expect(spots.query(sample.x, sample.y, sample.z, 40).kind).toBe('none');

    const avenue = network.edges.find((edge) => edge.kind === 'avenue' && !edge.jam)!;
    avenue.center.sample(avenue.center.length / 2, sample);
    const open = spots.query(sample.x, 0, sample.z, 60);
    expect(open.factor).toBeLessThanOrEqual(POLICE.hide.flyoverFactor);
  });
});

describe('দম', () => {
  const FRAME = 1 / 60;

  it('slows time while held, and a full meter lasts the promised real seconds', () => {
    const dom = new DomMeter();
    dom.value = POLICE.dom.capacity;
    let seconds = 0;
    dom.update(FRAME, true, false);
    while (dom.active && seconds < 20) {
      dom.update(FRAME, true, false);
      seconds += FRAME;
    }
    expect(seconds).toBeCloseTo(POLICE.dom.fullBurnSeconds, 0);
    expect(dom.value).toBe(0);
  });

  it('eases toward the slow rate, and back after release', () => {
    const dom = new DomMeter();
    dom.value = POLICE.dom.capacity;
    for (let i = 0; i < 60; i++) dom.update(FRAME, true, false);
    expect(dom.timeScale).toBeCloseTo(POLICE.dom.timeScale, 2);
    expect(dom.amount).toBeCloseTo(1, 1);
    for (let i = 0; i < 60; i++) dom.update(FRAME, false, false);
    expect(dom.timeScale).toBe(1);
    expect(dom.amount).toBe(0);
  });

  it('needs enough in the meter to start, and an empty one needs a fresh press', () => {
    const dom = new DomMeter();
    dom.value = POLICE.dom.minToStart - 2;
    dom.update(FRAME, true, false);
    expect(dom.active).toBe(false);
    // Still held while the meter refills: nothing happens until it is pressed again.
    dom.value = POLICE.dom.capacity;
    dom.update(FRAME, true, false);
    expect(dom.active).toBe(false);
    dom.update(FRAME, false, false);
    dom.update(FRAME, true, false);
    expect(dom.active).toBe(true);
  });

  it('fills from drifting and near misses, up to the cap', () => {
    const dom = new DomMeter();
    dom.value = 10;
    const plain = new DomMeter();
    plain.value = 10;
    for (let i = 0; i < 60; i++) {
      dom.update(FRAME, false, true);
      plain.update(FRAME, false, false);
    }
    expect(dom.value).toBeGreaterThan(plain.value + POLICE.dom.driftPerSecond * 0.9);
    dom.add(9999);
    expect(dom.value).toBe(POLICE.dom.capacity);
  });

  it('a trap dip slows time briefly without touching the meter', () => {
    const dom = new DomMeter();
    const before = dom.value;
    dom.dip(0.5, 0.4);
    for (let i = 0; i < 20; i++) dom.update(FRAME, false, false);
    expect(dom.timeScale).toBeLessThan(0.6);
    expect(dom.value).toBeGreaterThanOrEqual(before);
    for (let i = 0; i < 90; i++) dom.update(FRAME, false, false);
    expect(dom.timeScale).toBe(1);
  });
});

describe('police radio', () => {
  const CATEGORIES: RadioCategory[] = ['pursuitStart', 'heatUp', 'chief', 'lost', 'found', 'boxIn', 'pit', 'roadblock', 'spike', 'drone', 'heli', 'trap', 'horn', 'escape', 'bust'];

  it('has lines for every category in both languages', () => {
    for (const locale of ['en', 'bn'] as const) {
      setLocale(locale);
      for (const category of CATEGORIES) expect(tList(`police.radio.${category}`).length, `${locale} ${category}`).toBeGreaterThan(0);
    }
  });

  it('spaces lines out, keeps categories from repeating, and names the place', () => {
    setLocale('bn');
    const bus = new EventBus();
    const said: Array<[string, RadioCategory]> = [];
    const radio = new PoliceRadio(bus, (line, category) => said.push([line, category]), () => 'পুরানটোলা');

    bus.emit('policeRadio', { category: 'pursuitStart' });
    bus.emit('policeRadio', { category: 'heatUp' });
    radio.update(0.1);
    expect(said.length).toBe(1);
    expect(said[0][1]).toBe('pursuitStart');
    expect(said[0][0]).not.toContain('{place}');

    bus.emit('policeRadio', { category: 'lost' });
    radio.update(0.1);
    expect(said.length).toBe(1);
    radio.update(POLICE.radio.minGapSeconds + 0.1);
    expect(said.length).toBe(2);
    expect(said[1][1]).toBe('lost');

    // The same category again, too soon: dropped.
    bus.emit('policeRadio', { category: 'lost' });
    radio.update(POLICE.radio.minGapSeconds + 0.1);
    expect(said.length).toBe(2);
  });

  it('an arrest or an escape cuts straight through', () => {
    const bus = new EventBus();
    const said: RadioCategory[] = [];
    const radio = new PoliceRadio(bus, (_line, category) => said.push(category), () => '');
    bus.emit('policeRadio', { category: 'pit' });
    radio.update(0.1);
    bus.emit('policeRadio', { category: 'bust' });
    bus.emit('policeRadio', { category: 'pit' });
    radio.update(0.1);
    expect(said).toEqual(['pit', 'bust']);
  });
});
