/** Heat rules, and whole pursuits run headless on the real roads. Run: npm test */

import { beforeAll, describe, expect, it } from 'vitest';
import { POLICE, starsForScore } from '../src/config/police-tuning';
import { QUALITY_PRESETS, TUNING } from '../src/config/tuning';
import { EventBus, type GameEvents } from '../src/core/events';
import { createIntent } from '../src/input/intent';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { AdaptiveDifficulty, HeatSystem } from '../src/police/heat-system';
import { PoliceSystem, type HideQuery, type PoliceTarget, type PoliceView } from '../src/police/police-system';
import { VehicleController } from '../src/vehicle/vehicle-controller';
import { computeElevatedGeometry } from '../src/world/city/elevated-geometry';
import { RoadNetwork } from '../src/world/city/road-network';

const DT = 1 / TUNING.physics.fixedHz;
const network = new RoadNetwork();

beforeAll(async () => {
  await loadPhysicsEngine();
});

describe('heat rules', () => {
  function makeHeat(): { heat: HeatSystem; events: string[]; bus: EventBus } {
    const bus = new EventBus();
    const events: string[] = [];
    bus.on('pursuitEscaped', () => events.push('escaped'));
    bus.on('pursuitBusted', () => events.push('busted'));
    bus.on('heatLevel', ({ stars }) => events.push(`stars${stars}`));
    return { heat: new HeatSystem(bus), events, bus };
  }

  const fast = { seen: true, hideFactor: 1, unitsClose: 0, speed: 30 };

  it('has five rising star levels', () => {
    expect(POLICE.levels.length).toBe(5);
    expect(starsForScore(0)).toBe(1);
    expect(starsForScore(POLICE.levels[4].score)).toBe(5);
    for (let i = 1; i < 5; i++) expect(POLICE.levels[i].score).toBeGreaterThan(POLICE.levels[i - 1].score);
  });

  it('climbs the stars the longer a pursuit lasts', () => {
    const { heat, events } = makeHeat();
    heat.startPursuit();
    expect(heat.stars).toBe(1);
    for (let t = 0; t < 400; t += DT) heat.update(DT, fast);
    expect(heat.stars).toBe(5);
    expect(events).toContain('stars3');
    console.log(`time to 5 stars with no extra heat: ${(POLICE.levels[4].score / POLICE.heat.perSecond).toFixed(0)} s`);
  });

  it('out of sight long enough means escape', () => {
    const { heat, events } = makeHeat();
    heat.startPursuit();
    for (let t = 0; t < 1; t += DT) heat.update(DT, fast);
    const unseen = { ...fast, seen: false };
    for (let t = 0; t < POLICE.heat.lostSightDelay + POLICE.levels[0].cooldownSeconds + 0.5; t += DT) heat.update(DT, unseen);
    expect(events).toContain('escaped');
    expect(heat.isActive).toBe(false);
  });

  it('hiding fills the cooldown faster, and being seen again interrupts it', () => {
    const run = (factor: number): number => {
      const { heat, events } = makeHeat();
      heat.startPursuit();
      let time = 0;
      while (!events.includes('escaped') && time < 60) {
        heat.update(DT, { seen: false, hideFactor: factor, unitsClose: 0, speed: 0 });
        time += DT;
      }
      return time;
    };
    expect(run(POLICE.hide.garageFactor)).toBeLessThan(run(1) * 0.6);

    const { heat } = makeHeat();
    heat.startPursuit();
    for (let t = 0; t < 5; t += DT) heat.update(DT, { ...fast, seen: false });
    expect(heat.phase).toBe('evading');
    const partial = heat.cooldown;
    expect(partial).toBeGreaterThan(0);
    heat.update(DT, fast);
    expect(heat.phase).toBe('pursuit');
    for (let t = 0; t < 2; t += DT) heat.update(DT, fast);
    expect(heat.cooldown).toBeLessThan(partial);
  });

  it('arrests a stopped car with a unit beside it, and more units are quicker', () => {
    const run = (units: number): number => {
      const { heat, events } = makeHeat();
      heat.startPursuit();
      let time = 0;
      while (!events.includes('busted') && time < 20) {
        heat.update(DT, { seen: true, hideFactor: 1, unitsClose: units, speed: 1 });
        time += DT;
      }
      return time;
    };
    const one = run(1);
    const four = run(4);
    expect(one).toBeCloseTo(POLICE.bust.seconds, 0);
    expect(four).toBeLessThan(one * 0.65);
  });

  it('never arrests a car that keeps moving', () => {
    const { heat, events } = makeHeat();
    heat.startPursuit();
    for (let t = 0; t < 30; t += DT) heat.update(DT, { seen: true, hideFactor: 1, unitsClose: 4, speed: 25 });
    expect(events).not.toContain('busted');
    expect(heat.bust).toBe(0);
  });

  it('adaptive difficulty eases off after arrests and rises after escapes, within limits', () => {
    const adaptive = new AdaptiveDifficulty();
    const start = adaptive.value;
    adaptive.onBusted();
    expect(adaptive.value).toBeLessThan(start);
    for (let i = 0; i < 40; i++) adaptive.onBusted();
    expect(adaptive.value).toBe(POLICE.adaptive.min);
    for (let i = 0; i < 40; i++) adaptive.onEscaped(30);
    expect(adaptive.value).toBe(POLICE.adaptive.max);
    expect(adaptive.unitsFor(5, 6)).toBeLessThanOrEqual(6);
    expect(new AdaptiveDifficulty(POLICE.adaptive.min).unitsFor(5, 8)).toBeLessThan(new AdaptiveDifficulty(POLICE.adaptive.max).unitsFor(5, 8));
    expect(new AdaptiveDifficulty(POLICE.adaptive.min).bustTimeScale).toBeGreaterThan(1);
    expect(new AdaptiveDifficulty(POLICE.adaptive.max).bustTimeScale).toBeLessThan(1);
  });
});

interface Chase {
  physics: PhysicsWorld;
  bus: EventBus;
  police: PoliceSystem;
  player: VehicleController;
  target: PoliceTarget;
  view: PoliceView;
  intent: ReturnType<typeof createIntent>;
  step(): void;
  sync(): void;
}

function createChase(hide: HideQuery | null = null, units = QUALITY_PRESETS.high.policeUnits): Chase {
  const physics = new PhysicsWorld(DT);
  physics.addFixedCuboid(5000, 2, 5000, 0, -2, 0, 'road');
  const elevated = computeElevatedGeometry(network);
  for (const surface of elevated.surfaces) physics.addFixedTrimesh(surface.positions, surface.indices, 'road');
  for (const barrier of elevated.barriers) physics.addFixedCuboid(0.3, barrier.halfHeight, barrier.halfLength, barrier.x, barrier.y, barrier.z, 'road', barrier.yaw);

  const bus = new EventBus();
  const start = network.nodes[network.nodeIndex('b2')];
  const player = new VehicleController(physics, { position: { x: start.x + 2, y: 0.8, z: start.z + 60 }, yaw: Math.PI }, bus);
  const police = new PoliceSystem(network, physics, bus, { policeUnits: units, policeParked: 8 }, null, hide);
  police.enabled = true;
  const intent = createIntent();
  const target: PoliceTarget = { x: 0, y: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 1, speed: 0, car: player };
  const view: PoliceView = { x: 0, z: 0, fx: 0, fz: 1 };
  const sync = (): void => {
    const q = player.quaternion;
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const length = Math.hypot(fx, fz) || 1;
    target.x = player.position.x;
    target.y = player.position.y - 0.65;
    target.z = player.position.z;
    target.vx = player.velocity.x;
    target.vz = player.velocity.z;
    target.fx = fx / length;
    target.fz = fz / length;
    target.speed = player.telemetry.speed;
    view.x = target.x - target.fx * 6;
    view.z = target.z - target.fz * 6;
    view.fx = target.fx;
    view.fz = target.fz;
  };
  physics.step();
  player.update(DT, intent);
  sync();
  return {
    physics,
    bus,
    police,
    player,
    target,
    view,
    intent,
    sync,
    step() {
      player.update(DT, intent);
      sync();
      police.preStep(DT, target, view);
      physics.step();
      police.postStep(DT, target, view);
    },
  };
}

describe('pursuits on real roads', () => {
  it('patrols roam, and do nothing while you behave', () => {
    const chase = createChase();
    for (let i = 0; i < 60 * 25; i++) chase.step();
    const active = chase.police.units.filter((unit) => unit.active);
    expect(active.length).toBe(POLICE.units.patrols);
    expect(chase.police.heat.isActive).toBe(false);
    const moved = active.filter((unit) => unit.car.telemetry.speed > 3).length;
    expect(moved).toBeGreaterThan(0);
  });

  it('a patrol that sees you speeding starts a pursuit', () => {
    const chase = createChase();
    for (let i = 0; i < 60 * 5; i++) chase.step();
    const patrol = chase.police.units.find((unit) => unit.active);
    expect(patrol).toBeDefined();
    // Bring a patrol into view, and go fast.
    chase.player.reset({ position: { x: patrol!.currX + 30, y: patrol!.currY + 0.1, z: patrol!.currZ }, yaw: 0 });
    chase.intent.throttle = 1;
    let started = false;
    chase.bus.on('pursuitPhase', ({ phase }) => {
      if (phase === 'pursuit') started = true;
    });
    chase.player.body.setLinvel({ x: 0, y: 0, z: 35 }, true);
    for (let i = 0; i < 60 * 3 && !started; i++) chase.step();
    expect(started).toBe(true);
  });

  it('units catch and arrest a car that sits still', () => {
    const chase = createChase();
    const events: GameEvents['pursuitBusted'][] = [];
    chase.bus.on('pursuitBusted', (event) => events.push(event));
    // A patrol comes into view of the parked car, and the pursuit starts from there.
    for (let i = 0; i < 60 * 4; i++) chase.step();
    const patrol = chase.police.units.find((unit) => unit.active)!;
    patrol.car.reset({ position: { x: chase.target.x, y: 0.8, z: chase.target.z - 60 }, yaw: 0 });
    patrol.currX = chase.target.x;
    patrol.currY = 0.8;
    patrol.currZ = chase.target.z - 60;
    chase.police.heat.startPursuit();
    let time = 0;
    let minUp = 1;
    let closest = Infinity;
    while (events.length === 0 && time < 90) {
      chase.step();
      time += DT;
      for (const unit of chase.police.units) {
        if (!unit.active) continue;
        minUp = Math.min(minUp, unit.car.telemetry.upY);
        closest = Math.min(closest, unit.distance);
      }
    }
    console.log(`arrest of a parked car: ${time.toFixed(1)} s, closest ${closest.toFixed(1)} m, min up ${minUp.toFixed(3)}`);
    expect(events.length).toBe(1);
    expect(time).toBeLessThan(60);
    expect(minUp).toBeGreaterThan(0.5);
  });

  it('every level holds up: units keep pace with a moving car and stay on their wheels', () => {
    const chase = createChase();
    chase.police.heat.startPursuit();
    chase.police.heat.addHeat(POLICE.levels[4].score);
    expect(chase.police.heat.stars).toBe(5);
    // The player loops around the block fast, so nobody can arrest it.
    const loop = ['b2', 'b3', 'c3', 'c2', 'b2'].map((id) => network.nodes[network.nodeIndex(id)]);
    let target = 1;
    let flips = 0;
    let closest = Infinity;
    let busts = 0;
    let air = 0;
    chase.bus.on('pursuitBusted', () => busts++);
    for (let i = 0; i < 60 * 60; i++) {
      const p = chase.player.position;
      const q = chase.player.quaternion;
      const heading = Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y));
      const node = loop[target];
      if (Math.hypot(node.x - p.x, node.z - p.z) < 30) target = (target % (loop.length - 1)) + 1;
      let error = Math.atan2(node.x - p.x, node.z - p.z) - heading;
      while (error > Math.PI) error -= Math.PI * 2;
      while (error < -Math.PI) error += Math.PI * 2;
      chase.intent.steer = Math.max(-1, Math.min(1, -error * 2.2));
      const distance = Math.hypot(node.x - p.x, node.z - p.z);
      const tooFast = chase.player.telemetry.speed > 16 + distance * 0.18;
      chase.intent.throttle = tooFast ? 0 : 1;
      chase.intent.brake = tooFast ? 0.8 : 0;
      chase.step();
      for (const unit of chase.police.units) {
        if (!unit.active) continue;
        closest = Math.min(closest, unit.distance);
        if (unit.car.telemetry.upY < 0.2) flips++;
      }
      if (chase.police.helicopter.active && chase.police.helicopter.sees) air++;
    }
    const active = chase.police.units.filter((unit) => unit.active).length;
    console.log(`five-star chase for 60 s: ${active} units, closest ${closest.toFixed(1)} m, flipped frames ${flips}, helicopter saw for ${(air * DT).toFixed(1)} s, busts ${busts}, hit ${chase.player.telemetry.speedKmh.toFixed(0)} km/h`);
    expect(active).toBeGreaterThanOrEqual(5);
    expect(closest).toBeLessThan(25);
    expect(chase.police.helicopter.active).toBe(true);
    expect(air).toBeGreaterThan(60);
    // A rare roll is fine, since the system replaces the car; a constant one is not.
    expect(flips).toBeLessThan(60 * 20);
  });

  it('loses a car that gets away and stays out of sight', () => {
    const chase = createChase();
    const escapes: GameEvents['pursuitEscaped'][] = [];
    chase.bus.on('pursuitEscaped', (event) => escapes.push(event));
    chase.police.heat.startPursuit();
    // Far away, behind nothing but distance: the units have no line and no range.
    for (let i = 0; i < 60 * 2; i++) chase.step();
    chase.player.reset({ position: { x: -500, y: 0.8, z: 400 }, yaw: 0 });
    for (const unit of chase.police.units) unit.stunSeconds = 60;
    let time = 0;
    while (escapes.length === 0 && time < 30) {
      chase.step();
      time += DT;
    }
    expect(escapes.length).toBe(1);
    expect(escapes[0].points).toBeGreaterThan(0);
  });

  it('a hiding spot keeps a nearby unit from noticing', () => {
    const concealed: HideQuery = () => ({ factor: POLICE.hide.garageFactor, kind: 'garage', concealed: true, coveredFromAir: true });
    const chase = createChase(concealed);
    for (let i = 0; i < 30; i++) chase.step();
    chase.police.heat.startPursuit();
    const unit = chase.police.units[0];
    unit.active = true;
    unit.car.setEnabled(true);
    unit.car.reset({ position: { x: chase.target.x + 40, y: 0.8, z: chase.target.z }, yaw: 0 });
    for (let i = 0; i < 30; i++) {
      unit.stunSeconds = 10;
      chase.step();
    }
    expect(unit.lineOfSight).toBe(true);
    expect(unit.sees).toBe(false);
  });

  it('roadblocks stand ahead of the player, across the road', () => {
    const chase = createChase();
    chase.police.heat.startPursuit();
    chase.player.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
    for (let i = 0; i < 10; i++) chase.step();
    const spot = chase.police.roadAhead(chase.target, POLICE.roadblock.distanceAhead);
    expect(spot).not.toBeNull();
    const ahead = (spot!.x - chase.target.x) * chase.target.fx + (spot!.z - chase.target.z) * chase.target.fz;
    expect(ahead).toBeGreaterThan(100);
  });

  it('a spike strip punctures the car: slower, until it wears off', () => {
    const chase = createChase();
    chase.player.applyPuncture(POLICE.spikes.punctureSeconds);
    chase.intent.throttle = 1;
    for (let i = 0; i < 60 * 8; i++) chase.step();
    const punctured = chase.player.telemetry.speedKmh;
    expect(chase.player.telemetry.puncture).toBeGreaterThan(0);

    const clean = createChase();
    clean.intent.throttle = 1;
    for (let i = 0; i < 60 * 8; i++) clean.step();
    console.log(`speed after 8 s: clean ${clean.player.telemetry.speedKmh.toFixed(0)}, punctured ${punctured.toFixed(0)} km/h`);
    expect(punctured).toBeLessThan(clean.player.telemetry.speedKmh * 0.85);

    for (let i = 0; i < 60 * 12; i++) chase.step();
    expect(chase.player.telemetry.puncture).toBe(0);

    chase.player.applyPuncture(POLICE.spikes.punctureSeconds);
    chase.step();
    expect(chase.player.telemetry.puncture).toBeGreaterThan(0);
    chase.player.clearPuncture();
    chase.step();
    expect(chase.player.telemetry.puncture).toBe(0);
  });

  it('a helicopter can be outrun, and a roof hides you from it', () => {
    const chase = createChase();
    chase.police.heat.startPursuit();
    chase.police.heat.addHeat(POLICE.levels[4].score);
    for (let i = 0; i < 60 * 3; i++) chase.step();
    const heli = chase.police.helicopter;
    expect(heli.active).toBe(true);
    for (let i = 0; i < 60 * 8; i++) chase.step();
    expect(heli.sees).toBe(true);
    // Far beyond what it can follow: it has lost sight, whatever the line looks like.
    chase.player.reset({ position: { x: chase.target.x + 3000, y: 0.8, z: chase.target.z }, yaw: 0 });
    for (let i = 0; i < 30; i++) chase.step();
    expect(heli.sees).toBe(false);
  });

  it('three horn taps confuse nearby units, then need time to recharge', () => {
    const chase = createChase();
    for (let i = 0; i < 60 * 3; i++) chase.step();
    chase.police.heat.startPursuit();
    const unit = chase.police.units.find((candidate) => candidate.active);
    expect(unit).toBeDefined();
    unit!.distance = 10;
    expect(chase.police.hornConfuse()).toBeGreaterThan(0);
    expect(unit!.confusedSeconds).toBeGreaterThan(0);
    expect(chase.police.hornConfuse()).toBe(0);
  });

  it('a PIT from a rear corner spins the player, and costs the police a cooldown', () => {
    const chase = createChase();
    chase.police.heat.startPursuit();
    chase.police.heat.addHeat(POLICE.levels[2].score);
    chase.intent.throttle = 1;
    chase.player.body.setLinvel({ x: 0, y: 0, z: -25 }, true);
    for (let i = 0; i < 5; i++) chase.step();
    const unit = chase.police.units[0];
    unit.active = true;
    unit.car.setEnabled(true);
    unit.role = 'pit';
    unit.pitCooldown = 0;
    const events: GameEvents['policeContact'][] = [];
    chase.bus.on('policeContact', (event) => events.push(event));
    const before = chase.player.body.angvel().y;
    // Tucked into the rear-left corner of the player, moving with it.
    for (let i = 0; i < 2 && !events.some((event) => event.pit); i++) {
      const t = chase.target;
      unit.currX = t.x - t.fx * 2.6 + t.fz * 1.4;
      unit.currY = t.y + 0.65;
      unit.currZ = t.z - t.fz * 2.6 - t.fx * 1.4;
      unit.distance = 3;
      unit.car.body.setTranslation({ x: unit.currX, y: unit.currY, z: unit.currZ }, true);
      chase.police.postStep(DT, chase.target, chase.view);
    }
    expect(events.some((event) => event.pit)).toBe(true);
    expect(unit.pitCooldown).toBeGreaterThan(0);
    expect(chase.player.body.angvel().y).not.toBe(before);
  });

  it('eight police cars with full physics fit the frame budget', () => {
    const chase = createChase(null, 8);
    chase.police.heat.startPursuit();
    chase.police.heat.addHeat(POLICE.levels[4].score);
    // The car sits still here, so the arrest meter is held down to keep the pursuit running.
    const step = (): void => {
      chase.police.heat.bust = 0;
      chase.step();
    };
    for (let i = 0; i < 60 * 15; i++) step();
    const steps = 600;
    const start = performance.now();
    for (let i = 0; i < steps; i++) step();
    const milliseconds = (performance.now() - start) / steps;
    const active = chase.police.units.filter((unit) => unit.active).length;
    console.log(`full pursuit CPU: ${milliseconds.toFixed(2)} ms per step, with ${active} units and the player`);
    expect(active).toBe(8);
    expect(milliseconds).toBeLessThan(5);
  });
});
