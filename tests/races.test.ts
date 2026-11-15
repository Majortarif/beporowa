/** Races on real roads, run headless: courses, the rules of each mode, and rival behaviour. Run: npm test */

import { beforeAll, describe, expect, it } from 'vitest';
import { rivalScale } from '../src/progression/economy';
import { scaleToCar } from '../src/race/rival-memory';
import { EVENT_BY_ID, RACE_EVENTS, RACE_MODES } from '../src/config/race-events';
import { RACE } from '../src/config/race-tuning';
import { RIVALS, RIVAL_BY_ID, crewTraits } from '../src/config/rivals';
import { TUNING } from '../src/config/tuning';
import { EventBus, type GameEvents } from '../src/core/events';
import { createIntent } from '../src/input/intent';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { PoliceDriver } from '../src/police/police-driver';
import { RaceCourse, expandRoute } from '../src/race/race-course';
import { RaceSession, familyOf } from '../src/race/race-session';
import { PlayerObserver, absorbRace, adaptTraits, createMemory, preferredSide } from '../src/race/rival-memory';
import { VehicleController } from '../src/vehicle/vehicle-controller';
import { computeElevatedGeometry } from '../src/world/city/elevated-geometry';
import { RoadNetwork } from '../src/world/city/road-network';

const DT = 1 / TUNING.physics.fixedHz;
const network = new RoadNetwork();

beforeAll(async () => {
  await loadPhysicsEngine();
});

function makeWorld(): PhysicsWorld {
  const physics = new PhysicsWorld(DT);
  physics.addFixedCuboid(5000, 2, 5000, 0, -2, 0, 'road');
  const elevated = computeElevatedGeometry(network);
  for (const surface of elevated.surfaces) physics.addFixedTrimesh(surface.positions, surface.indices, 'road');
  for (const barrier of elevated.barriers) physics.addFixedCuboid(0.3, barrier.halfHeight, barrier.halfLength, barrier.x, barrier.y, barrier.z, 'road', barrier.yaw);
  physics.step();
  return physics;
}

interface Race {
  physics: PhysicsWorld;
  bus: EventBus;
  session: RaceSession;
  player: VehicleController;
  intent: ReturnType<typeof createIntent>;
  /** Drives the player along the course with a simple AI, so races can finish. */
  bot: PoliceDriver;
  step(): void;
}

function setUpRace(id: string, opponents = 6, playerDriven = true): Race {
  const physics = makeWorld();
  const bus = new EventBus();
  const player = new VehicleController(physics, { position: { x: 0, y: -300, z: 0 }, yaw: 0 }, bus);
  const session = new RaceSession(network, physics, bus, player, null, opponents);
  const pose = session.begin(id, createMemory());
  player.reset(pose);
  const intent = createIntent();
  const bot = new PoliceDriver(physics, player, { ...RACE.driver });
  const course = session.course as RaceCourse;
  bot.setRoute(course.buildDriveLine(0.6, 0, course.lapLength * (session.laps + 1) + 400, RACE.driver.routePointSpacing));
  bot.relocate(pose.position.x, pose.position.z);
  physics.step();
  return {
    physics,
    bus,
    session,
    player,
    intent,
    bot,
    step() {
      if (playerDriven && session.isRunning) {
        bot.followRoute(DT, 80, 0, 1, false, 0);
        player.update(DT, session.filterIntent(bot.intent));
      } else {
        player.update(DT, session.filterIntent(intent));
      }
      const t = player.body.translation();
      session.preStep(DT, t.x, t.z, 0, 1);
      physics.step();
      session.postStep(DT);
    },
  };
}

function runToGo(race: Race): void {
  race.session.startCountdown();
  let guard = 0;
  while (race.session.phase === 'countdown' && guard++ < 60 * 8) race.step();
}

describe('the event list', () => {
  it('covers every kind of race in the brief', () => {
    const modes = new Set(RACE_EVENTS.map((event) => event.mode));
    for (const mode of RACE_MODES) expect(modes.has(mode), mode).toBe(true);
  });

  it('gives each of the ten rivals a race, in rank order', () => {
    for (const rival of RIVALS) {
      const race = RACE_EVENTS.find((event) => event.rivalRace === rival.id);
      expect(race, rival.id).toBeDefined();
      expect(race?.tier).toBe(rival.rank);
    }
    expect(RIVALS.length).toBe(10);
    expect(new Set(RIVALS.map((rival) => rival.rank)).size).toBe(10);
  });

  it('every course is on real roads, and a loop really closes', () => {
    for (const event of RACE_EVENTS) {
      if (event.course) {
        const course = RaceCourse.fromNodes(network, event.course.nodes, event.course.loop);
        expect(course.lapLength, event.id).toBeGreaterThan(300);
        expect(course.gates.length, event.id).toBeGreaterThanOrEqual(RACE.course.gateMinimum);
        expect(course.gates[course.gates.length - 1].progress, event.id).toBeCloseTo(course.lapLength, 0);
        if (event.course.loop) {
          const p = course.line.points;
          const last = (course.line.count - 1) * 3;
          expect(Math.hypot(p[0] - p[last], p[2] - p[last + 2]), event.id).toBeLessThan(1);
        }
      }
      if (event.gates) expect(() => RaceCourse.fromNodes(network, event.gates as string[], false), event.id).not.toThrow();
    }
  });

  it('no course asks for a U-turn', () => {
    for (const event of RACE_EVENTS) {
      const ids = event.course?.nodes ?? event.gates;
      if (!ids) continue;
      const route = expandRoute(network, ids);
      for (let i = 0; i + 2 < route.length; i++) expect(route[i] === route[i + 2], `${event.id} at ${network.nodes[route[i + 1]].id}`).toBe(false);
    }
  });

  it('a course never drives through the monument', () => {
    const roundabout = network.nodes.find((node) => node.roundabout)!;
    const course = RaceCourse.fromNodes(network, ['a1', 'a2', 'R', 'W1', 'a1'], true);
    for (let i = 0; i < course.line.count; i++) {
      const distance = Math.hypot(course.line.points[i * 3] - roundabout.x, course.line.points[i * 3 + 2] - roundabout.z);
      expect(distance).toBeGreaterThan(15);
    }
  });

  it('wide roads keep to the left of the median, so a course misses the flyover pillars', () => {
    const course = RaceCourse.fromNodes(network, ['a1', 'a2', 'a3', 'b3', 'b2', 'b1', 'a1'], true);
    const elevated = computeElevatedGeometry(network);
    let closest = Infinity;
    for (const pillar of elevated.pillars) {
      for (let i = 0; i < course.line.count; i += 2) {
        closest = Math.min(closest, Math.hypot(course.line.points[i * 3] - pillar.x, course.line.points[i * 3 + 2] - pillar.z));
      }
    }
    console.log(`closest a course line comes to a pillar: ${closest.toFixed(1)} m`);
    expect(closest).toBeGreaterThan(2);
  });

  it('grid places do not overlap', () => {
    const course = RaceCourse.fromNodes(network, ['c1', 'c2', 'c3', 'c4'], false);
    const poses = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => course.gridPose(i));
    for (let a = 0; a < poses.length; a++) {
      for (let b = a + 1; b < poses.length; b++) {
        expect(Math.hypot(poses[a].x - poses[b].x, poses[a].z - poses[b].z)).toBeGreaterThan(2.4);
      }
    }
  });
});

describe('the start', () => {
  it('counts down, holds everyone still, then goes', () => {
    const race = setUpRace('sutoSprint', 3);
    const start = race.player.body.translation();
    const events: number[] = [];
    race.bus.on('raceCountdown', ({ step }) => events.push(step));
    race.intent.throttle = 0;
    runToGo(race);
    const end = race.player.body.translation();
    expect(Math.hypot(start.x - end.x, start.z - end.z)).toBeLessThan(0.8);
    expect(events).toEqual([3, 2, 1, 0]);
    expect(race.session.phase).toBe('running');
    for (const agent of race.session.agents) expect(agent.car.telemetry.speed).toBeLessThan(1);
  });

  it('gas at the last moment is a perfect launch, too early bogs down', () => {
    const late = setUpRace('sutoSprint', 1, false);
    const seen: boolean[] = [];
    late.bus.on('raceLaunch', ({ perfect }) => seen.push(perfect));
    late.session.startCountdown();
    while (late.session.countdown > 0.3) late.step();
    late.intent.throttle = 1;
    while (late.session.phase === 'countdown') late.step();
    expect(seen).toEqual([true]);

    const early = setUpRace('sutoSprint', 1, false);
    const seenEarly: boolean[] = [];
    early.bus.on('raceLaunch', ({ perfect }) => seenEarly.push(perfect));
    early.session.startCountdown();
    early.intent.throttle = 1;
    while (early.session.phase === 'countdown') early.step();
    expect(seenEarly).toEqual([false]);
  });
});

describe('races run to the end', () => {
  // Every event with a fixed route, with a bot driving the player's car.
  const routeEvents = RACE_EVENTS.filter((event) => familyOf(event.mode) === 'route');
  for (const event of routeEvents) {
    it(`${event.id}: everyone gets round`, () => {
      const race = setUpRace(event.id, 5);
      runToGo(race);
      let steps = 0;
      const limit = 60 * 60 * 8;
      let flips = 0;
      while (race.session.phase === 'running' && steps < limit) {
        race.step();
        steps++;
        for (const agent of race.session.agents) if (agent.car.telemetry.upY < 0.2) flips++;
      }
      const outcome = race.session.outcome;
      expect(outcome, `${event.id} never ended`).not.toBeNull();
      const home = race.session.agents.filter((agent) => agent.finished).length;
      console.log(`${event.id}: ${(steps / 60).toFixed(1)} s, ${(race.session.raceDistance / 1000).toFixed(2)} km, bot placed ${outcome?.position}/${race.session.racerCount}, ${home} AI home, failure ${outcome?.failure}, flipped frames ${flips}`);
      expect(outcome?.failure === 'none' || outcome?.failure === 'dnf').toBe(true);
      expect(home + (outcome?.failure === 'none' ? 1 : 0)).toBeGreaterThan(0);
      expect(flips).toBeLessThan(60 * 12);
    }, 240000);
  }

  it('time trial gives a medal by the clock, with no opponents', () => {
    const race = setUpRace('avenueTrial');
    expect(race.session.agents.length).toBe(0);
    runToGo(race);
    let steps = 0;
    while (race.session.phase === 'running' && steps < 60 * 60 * 3) {
      race.step();
      steps++;
    }
    const outcome = race.session.outcome;
    console.log(`time trial by bot: ${((outcome?.timeMs ?? 0) / 1000).toFixed(1)} s, medal ${outcome?.medal}`);
    expect(outcome?.failure).toBe('none');
    expect(outcome?.medal).toBeGreaterThanOrEqual(0);
  }, 120000);
});

describe('nobody is stuck at the start', () => {
  for (const event of RACE_EVENTS) {
    if (familyOf(event.mode) === 'hunt') continue;
    it(`${event.id}: every car gets away`, () => {
      const race = setUpRace(event.id, 7);
      runToGo(race);
      for (let i = 0; i < 60 * 8; i++) race.step();
      for (const agent of race.session.agents) expect(agent.progress, `${agent.rivalId ?? 'crew'} on ${event.id}`).toBeGreaterThan(40);
      expect(race.session.progress, `player on ${event.id}`).toBeGreaterThan(30);
    }, 60000);
  }
});

describe('open-gate races', () => {
  /** Moves the car straight to the next gate, as if driven there. */
  function teleportToGate(race: Race): void {
    const gate = race.session.nextGate;
    race.player.reset({ position: { x: gate.x, y: gate.y + 0.8, z: gate.z }, yaw: 0 });
    race.step();
    race.step();
  }

  it('a checkpoint rush adds time at each gate and ends at the last', () => {
    const race = setUpRace('cityRush', 0, false);
    runToGo(race);
    const before = race.session.timeLeft;
    teleportToGate(race);
    expect(race.session.gateIndex).toBe(1);
    expect(race.session.timeLeft).toBeGreaterThan(before);
    let guard = 0;
    while (race.session.phase === 'running' && guard++ < 30) teleportToGate(race);
    expect(race.session.outcome?.completed).toBe(true);
    expect(race.session.outcome?.medal).toBeGreaterThan(0);
  });

  it('a rush ends when the clock runs out', () => {
    const race = setUpRace('cityRush', 0, false);
    runToGo(race);
    race.session.timeLeft = 0.05;
    for (let i = 0; i < 10; i++) race.step();
    expect(race.session.outcome?.failure).toBe('time');
    expect(race.session.outcome?.completed).toBe(false);
  });

  it('a delivery needs you to slow down, and crashes break the cargo', () => {
    const race = setUpRace('mishtiDelivery', 0, false);
    runToGo(race);
    const gate = race.session.nextGate;
    race.player.reset({ position: { x: gate.x, y: gate.y + 0.8, z: gate.z }, yaw: 0 });
    race.player.body.setLinvel({ x: 0, y: 0, z: 30 }, true);
    race.step();
    expect(race.session.gateIndex).toBe(0);
    teleportToGate(race);
    expect(race.session.gateIndex).toBe(1);

    race.bus.emit('impact', { strength: 1, x: 0, y: 0, z: 0 });
    expect(race.session.cargo).toBeLessThan(100);
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 40; k++) race.step();
      race.bus.emit('impact', { strength: 1, x: 0, y: 0, z: 0 });
    }
    for (let i = 0; i < 3; i++) race.step();
    expect(race.session.outcome?.failure).toBe('cargo');
  });

  it('a maze rival finds its own way through the lanes', () => {
    const race = setUpRace('bazaarMaze', 2, false);
    runToGo(race);
    const rival = race.session.agents.find((agent) => agent.rivalId === 'mithu')!;
    expect(rival).toBeDefined();
    let steps = 0;
    while (!rival.finished && steps < 60 * 60 * 4) {
      race.step();
      steps++;
    }
    console.log(`মিঠু through the maze alone: ${(steps / 60).toFixed(1)} s`);
    expect(rival.finished).toBe(true);
    expect(race.session.position).toBe(race.session.racerCount);
  }, 120000);
});

describe('takedown', () => {
  it('fleeing cars run, take damage from hard hits, and stop when beaten', () => {
    const race = setUpRace('firstTakedown', 6, false);
    runToGo(race);
    expect(race.session.targetsTotal).toBe(3);
    for (let i = 0; i < 60 * 6; i++) race.step();
    const target = race.session.agents[0];
    expect(target.car.telemetry.speed).toBeGreaterThan(5);

    // A soft touch does nothing, and a hard hit from the side does a lot.
    const health = target.health;
    const events: GameEvents['targetDown'][] = [];
    race.bus.on('targetDown', (event) => events.push(event));
    const strike = (speed: number): void => {
      const side = { x: target.fz, z: -target.fx };
      const v = target.car.velocity;
      race.player.reset({ position: { x: target.currX + side.x * 2, y: target.currY, z: target.currZ + side.z * 2 }, yaw: Math.atan2(-side.x, -side.z) });
      race.player.body.setLinvel({ x: v.x - side.x * speed, y: 0, z: v.z - side.z * speed }, true);
      race.step();
    };
    strike(1);
    expect(target.health).toBe(health);
    for (let i = 0; i < 5 && !target.eliminated; i++) {
      strike(26);
      for (let k = 0; k < 40; k++) race.step();
    }
    expect(target.eliminated).toBe(true);
    expect(events.length).toBe(1);
    expect(race.session.targetsLeft).toBe(2);
  }, 60000);
});

describe('drift', () => {
  it('counts your drifts, and against a rival you must beat her total', () => {
    const race = setUpRace('slipBattle', 2, false);
    runToGo(race);
    race.bus.emit('driftEnd', { points: 700, tier: 1 });
    expect(race.session.score).toBe(700);
    race.session.score = race.session.targetScore + 1;
    race.session.timeLeft = 0.02;
    for (let i = 0; i < 5; i++) race.step();
    expect(race.session.outcome?.rivalBeaten).toBe(true);

    const losing = setUpRace('slipBattle', 2, false);
    runToGo(losing);
    losing.session.score = 100;
    losing.session.timeLeft = 0.02;
    for (let i = 0; i < 5; i++) losing.step();
    expect(losing.session.outcome?.rivalBeaten).toBe(false);
  });
});

describe('drag', () => {
  it('needs real shifting: holding one gear loses to a car that shifts', () => {
    const run = (shift: boolean): number => {
      const race = setUpRace('kachDrag', 0, false);
      runToGo(race);
      race.intent.throttle = 1;
      let steps = 0;
      while (race.session.phase === 'running' && steps < 60 * 50) {
        race.intent.steer = 0;
        race.intent.handbrake = shift && race.player.powertrain.rpmShare > 0.9 && race.player.powertrain.gear < 6;
        race.step();
        race.intent.handbrake = false;
        race.step();
        steps += 2;
      }
      return race.session.elapsed;
    };
    const shifted = run(true);
    const stuck = run(false);
    console.log(`drag: shifting ${shifted.toFixed(1)} s, never shifting ${stuck.toFixed(1)} s`);
    expect(shifted).toBeLessThan(stuck * 0.8);
  }, 120000);

  it('the rival shifts for itself', () => {
    const race = setUpRace('kachDrag', 1, false);
    runToGo(race);
    const rival = race.session.agents[0];
    for (let i = 0; i < 60 * 12; i++) race.step();
    expect(rival.car.powertrain.gear).toBeGreaterThanOrEqual(3);
  }, 60000);
});

describe('boss race', () => {
  it('runs in legs, and calls the police at the right one', () => {
    const race = setUpRace('kalbaishakhi', 4, false);
    runToGo(race);
    const legs: number[] = [];
    race.bus.on('raceLeg', ({ leg }) => legs.push(leg));
    const total = race.session.raceDistance;
    expect(total).toBeGreaterThan(3000);
    (race.session as unknown as { playerProgress: number }).playerProgress = total * 0.5;
    race.step();
    expect(legs).toEqual([1]);
    expect(race.session.policeWanted).toBe(EVENT_BY_ID.get('kalbaishakhi')?.police?.stars);
  });

  it('an arrest ends it', () => {
    const race = setUpRace('kalbaishakhi', 4, false);
    runToGo(race);
    race.bus.emit('pursuitBusted', { stars: 3, seconds: 10, fine: 100 });
    expect(race.session.outcome?.failure).toBe('busted');
    expect(race.session.outcome?.rivalBeaten).toBe(false);
  });
});

describe('fair rubber-banding', () => {
  it('stays within its caps, either way, and is gone by the end', () => {
    const race = setUpRace('flyoverLoop', 2, false);
    runToGo(race);
    const rival = race.session.agents.find((agent) => agent.rivalId === 'tanvir')!;
    // Rubber-banding works around the rival's engine, as scaled to the car the player brought.
    const tanvir = RIVAL_BY_ID.get('tanvir')!;
    const base = scaleToCar(tanvir.traits, rivalScale(tanvir.rank, 1));
    const band = RACE.rubberBand;
    let highest = 0;
    let lowest = 9;
    for (let i = 0; i < 60 * 30; i++) {
      race.step();
      highest = Math.max(highest, rival.car.profile.powerScale);
      lowest = Math.min(lowest, rival.car.profile.powerScale);
    }
    // The bot is not driving, so the rival is far ahead and eases off, but only so far.
    console.log(`rival power with the player far behind: ${lowest.toFixed(3)} to ${highest.toFixed(3)}, base ${base.power}`);
    expect(lowest).toBeGreaterThanOrEqual(base.power - band.easePower - 0.001);
    expect(highest).toBeLessThanOrEqual(base.power + band.catchUpPower + 0.001);
    expect(lowest).toBeLessThan(base.power - 0.02);

    // Near the end there is no help at all.
    rival.progress = race.session.raceDistance * 0.97;
    race.step();
    expect(rival.car.profile.powerScale).toBeCloseTo(base.power, 3);
  }, 60000);
});

describe('what rivals remember', () => {
  it('learns which side you pass on, and forgets slowly', () => {
    const memory = createMemory();
    const observer = new PlayerObserver();
    expect(preferredSide(memory)).toBe(0);
    for (let i = 0; i < 6; i++) observer.notePass(true);
    observer.notePass(false);
    absorbRace(memory, observer, 3, 2);
    expect(preferredSide(memory)).toBe(1);
    expect(memory.races).toBe(1);

    observer.reset();
    for (let i = 0; i < 20; i++) observer.notePass(false);
    absorbRace(memory, observer, 3, 2);
    expect(preferredSide(memory)).toBe(-1);
  });

  it('an adaptive rival plans around your nitro, and only that kind does', () => {
    const memory = createMemory();
    const observer = new PlayerObserver();
    observer.noteNitro(0.9);
    absorbRace(memory, observer, 3, 1);
    const jahan = RIVAL_BY_ID.get('jahan')!.traits;
    const sadia = RIVAL_BY_ID.get('sadia')!.traits;
    expect(adaptTraits(jahan, memory).nitroStart).toBeCloseTo(0.9 - RACE.memory.nitroEarlierBy, 3);
    expect(adaptTraits(sadia, memory).nitroStart).toBe(sadia.nitroStart);
  });

  it('winning big sharpens everyone, within limits, and losing eases them off', () => {
    const win = createMemory();
    win.races = 3;
    win.margin = 60;
    const lose = createMemory();
    lose.races = 3;
    lose.margin = -60;
    const crew = crewTraits(0.5);
    expect(adaptTraits(crew, win).power).toBeCloseTo(crew.power + RACE.memory.skillPower, 3);
    expect(adaptTraits(crew, lose).power).toBeCloseTo(crew.power - RACE.memory.skillPower, 3);
  });
});

describe('budget', () => {
  it('a full grid fits the frame', () => {
    const race = setUpRace('meterCircuit', 7);
    runToGo(race);
    for (let i = 0; i < 60 * 12; i++) race.step();
    const steps = 600;
    const start = performance.now();
    for (let i = 0; i < steps; i++) race.step();
    const milliseconds = (performance.now() - start) / steps;
    console.log(`race CPU: ${milliseconds.toFixed(2)} ms per step, with ${race.session.agents.length} AI cars and the player`);
    expect(milliseconds).toBeLessThan(5);
  }, 60000);
});
