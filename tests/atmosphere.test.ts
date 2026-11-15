/** The hour, the weather, the water, the replay's film, the band and the radio. Run: npm test */

import { describe, expect, it } from 'vitest';
import { ATMOSPHERE, TIME_KEYS } from '../src/config/atmosphere';
import { TUNING } from '../src/config/tuning';
import { RADIO_TIMING, RadioStation, type RadioTopic } from '../src/audio/radio-station';
import { SCALES, STEPS_PER_BAR, buildSection, chooseMix, degreeToMidi, type Mood } from '../src/audio/music-patterns';
import bn from '../src/i18n/bn.json';
import en from '../src/i18n/en.json';
import { createIntent } from '../src/input/intent';
import { PhysicsWorld, loadPhysicsEngine } from '../src/physics/physics-world';
import { ACTOR_SIZE, PLAYER_FIELDS, ReplayBuffer } from '../src/replay/replay-buffer';
import { SHOT_KINDS, pace, planShots, poseFor, shotAt, type ShotPose } from '../src/replay/replay-director';
import { VehicleController } from '../src/vehicle/vehicle-controller';
import { AtmosphereDirector, type AtmosphereEvent } from '../src/world/atmosphere/atmosphere-director';
import { FloodField } from '../src/world/atmosphere/flood-field';
import { RoadNetwork } from '../src/world/city/road-network';
import { beforeAll } from 'vitest';

const JUNE = new Date(2026, 5, 15);
const JANUARY = new Date(2026, 0, 15);

function run(director: AtmosphereDirector, seconds: number, step = 0.5): void {
  for (let t = 0; t < seconds; t += step) director.update(step, 0, 0);
}

describe('the hours of the day', () => {
  it('keys cover a whole day, in order, and the night is the original look', () => {
    expect(TIME_KEYS[0].t).toBe(0);
    expect(TIME_KEYS[TIME_KEYS.length - 1].t).toBe(1);
    for (let i = 1; i < TIME_KEYS.length; i++) expect(TIME_KEYS[i].t).toBeGreaterThan(TIME_KEYS[i - 1].t);
    const night = TIME_KEYS[0];
    const world = TUNING.world;
    expect(night.fogDensity).toBe(world.fogDensity);
    expect(night.skyTop).toBe(world.colors.skyTop);
    expect(night.hemi).toBe(world.hemisphereIntensity);
    expect(night.lightIntensity).toBe(world.moonIntensity);
  });

  it('the sun is up by day and down by night, and lights go off in the day', () => {
    const director = new AtmosphereDirector(1, JUNE);
    director.setLocks('day', 'clear');
    director.update(0.1, 0, 0);
    expect(director.frame.sunY).toBeGreaterThan(0.5);
    expect(director.frame.daylight).toBeGreaterThan(0.9);
    expect(director.frame.lamps).toBe(0);
    expect(director.frame.windows).toBeLessThan(0.05);
    director.setLocks('night', 'clear');
    director.update(0.1, 0, 0);
    expect(director.frame.sunY).toBeLessThan(0);
    expect(director.frame.daylight).toBe(0);
    expect(director.frame.lamps).toBe(1);
    expect(director.frame.windows).toBe(1.5);
  });

  it('the sun rises in the east and sets in the west', () => {
    const director = new AtmosphereDirector(1, JUNE);
    director.setTime(0.3);
    director.update(0.001, 0, 0);
    expect(director.frame.sunX).toBeGreaterThan(0);
    director.setTime(0.75);
    director.update(0.001, 0, 0);
    expect(director.frame.sunX).toBeLessThan(0);
  });

  it('runs smoothly round a whole day, with no jumps in the light', () => {
    const director = new AtmosphereDirector(2, JUNE);
    director.setLocks('auto', 'clear');
    let last = director.frame.lightIntensity;
    let lastHemi = director.frame.hemi;
    const step = 1;
    const dayLength = ATMOSPHERE.dayMinutes * 60;
    for (let t = 0; t < dayLength; t += step) {
      director.update(step, 0, 0);
      const frame = director.frame;
      expect(Math.abs(frame.lightIntensity - last), `light at ${frame.time.toFixed(3)}`).toBeLessThan(0.25);
      expect(Math.abs(frame.hemi - lastHemi), `sky at ${frame.time.toFixed(3)}`).toBeLessThan(0.08);
      last = frame.lightIntensity;
      lastHemi = frame.hemi;
      expect(Number.isFinite(frame.sunX + frame.sunY + frame.sunZ)).toBe(true);
    }
  });

  it('says when the day turns', () => {
    const director = new AtmosphereDirector(3, JUNE);
    const events: AtmosphereEvent[] = [];
    director.onEvent = (event) => events.push(event);
    director.setLocks('auto', 'clear');
    run(director, ATMOSPHERE.dayMinutes * 60 * 1.02, 1);
    for (const mark of ['dawn', 'morning', 'dusk', 'night'] as const) expect(events, mark).toContain(mark);
  });
});

describe('the weather', () => {
  it('starts fair, and the same seed gives the same weather', () => {
    const history = (seed: number): string[] => {
      const director = new AtmosphereDirector(seed, JUNE);
      const out: string[] = [];
      director.onEvent = (event) => {
        if (event !== 'lightning') out.push(event);
      };
      expect(director.weather).toBe('clear');
      run(director, 1200);
      return out;
    };
    expect(history(9)).toEqual(history(9));
    expect(history(9).length).toBeGreaterThan(2);
  });

  it('follows the calendar: monsoon rain in June, fog in January', () => {
    const count = (date: Date, wanted: AtmosphereEvent): number => {
      let total = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const director = new AtmosphereDirector(seed, date);
        director.onEvent = (event) => {
          if (event === wanted) total++;
        };
        run(director, 900, 1);
      }
      return total;
    };
    expect(count(JUNE, 'rainStart')).toBeGreaterThan(count(JUNE, 'fogStart'));
    expect(count(JANUARY, 'fogStart')).toBeGreaterThan(count(JANUARY, 'rainStart'));
  });

  it('rain soaks the road, floods the low spots, lowers grip and hides you from the police', () => {
    const director = new AtmosphereDirector(1, JUNE);
    director.setLocks('night', 'monsoon');
    const dry = { grip: director.frame.grip, sight: director.frame.sightScale };
    expect(dry.grip).toBe(1);
    run(director, 200);
    const frame = director.frame;
    expect(frame.rain).toBe(1);
    expect(frame.wetness).toBe(1);
    expect(frame.flood).toBeGreaterThan(0.9);
    expect(frame.grip).toBeCloseTo(ATMOSPHERE.monsoon.gripWhenSoaked, 3);
    expect(frame.sightScale).toBeLessThan(1);
    expect(frame.fogDensity).toBeGreaterThan(TUNING.world.fogDensity);
  });

  it('the water and the wet go away slowly after the rain stops', () => {
    const director = new AtmosphereDirector(1, JUNE);
    director.setLocks('day', 'monsoon');
    run(director, 200);
    director.setLocks('day', 'clear');
    run(director, 30);
    expect(director.frame.rain).toBe(0);
    expect(director.frame.flood).toBeGreaterThan(0.5);
    expect(director.frame.wetness).toBeGreaterThan(0.5);
    run(director, 400);
    expect(director.frame.flood).toBe(0);
    expect(director.frame.wetness).toBeLessThan(0.2);
  });

  it('lightning comes only with heavy rain, and fades quickly', () => {
    const director = new AtmosphereDirector(1, JUNE);
    let bolts = 0;
    director.onEvent = (event) => {
      if (event === 'lightning') bolts++;
    };
    director.setLocks('night', 'clear');
    run(director, 120);
    expect(bolts).toBe(0);
    director.setLocks('night', 'monsoon');
    run(director, 200);
    expect(bolts).toBeGreaterThan(2);
    let seen = false;
    for (let t = 0; t < 60 && !seen; t += 0.05) {
      director.update(0.05, 0, 0);
      if (director.frame.flash > 0.9) seen = true;
    }
    expect(seen).toBe(true);
    for (let t = 0; t < 1.2; t += 0.05) director.update(0.05, 0, 0);
    expect(director.frame.flash).toBeLessThan(0.5);
  });

  it('fog closes the view right in', () => {
    const director = new AtmosphereDirector(1, JUNE);
    director.setLocks('day', 'fog');
    run(director, 40);
    expect(director.frame.fogDensity).toBeCloseTo(ATMOSPHERE.fog.density, 4);
    expect(director.frame.sightScale).toBeCloseTo(ATMOSPHERE.fog.sightScale, 3);
    expect(director.frame.rain).toBe(0);
  });

  it('a race can insist on a downpour with the water already up, and let go afterwards', () => {
    const director = new AtmosphereDirector(1, JUNE);
    director.setLocks('auto', 'auto');
    director.force('monsoon', true);
    expect(director.weather).toBe('monsoon');
    run(director, ATMOSPHERE.weather.raceTransitionSeconds + 1);
    expect(director.frame.rain).toBe(1);
    expect(director.frame.flood).toBe(1);
    director.release();
    expect(director.weather).toBe('clear');
  });
});

describe('load-shedding', () => {
  it('only comes after dark, spreads from nearby, and the power returns', () => {
    const director = new AtmosphereDirector(4, JUNE);
    const events: AtmosphereEvent[] = [];
    director.onEvent = (event) => events.push(event);
    director.setLocks('day', 'auto');
    run(director, 1200, 1);
    expect(events).not.toContain('blackoutStart');

    director.setLocks('night', 'auto');
    let safety = 0;
    while (!director.isBlackout && safety++ < 4000) director.update(1, 100, 100);
    expect(director.isBlackout).toBe(true);
    expect(events).toContain('blackoutStart');
    expect(Math.hypot(director.frame.blackoutX - 100, director.frame.blackoutZ - 100)).toBeLessThan(200);
    const start = director.frame.blackoutRadius;
    run(director, 2);
    expect(director.frame.blackoutRadius).toBeGreaterThan(start);
    run(director, 200);
    expect(events).toContain('blackoutEnd');
    expect(director.frame.blackoutRadius).toBe(0);
  });

  it('can be asked for from the settings, right where you are', () => {
    const director = new AtmosphereDirector(1, JUNE);
    director.setLocks('night', 'blackout');
    run(director, 10);
    expect(director.isBlackout).toBe(true);
    expect(director.frame.sightScale).toBeLessThan(1);
  });
});

describe('flooded roads', () => {
  const network = new RoadNetwork();
  const flood = new FloodField(network);

  it('has low spots on real ground-level roads', () => {
    expect(flood.zones.length).toBeGreaterThanOrEqual(5);
    for (const zone of flood.zones) {
      const hit = network.nearestRoad(zone.x, zone.z, 0);
      expect(hit.distance).toBeLessThan(3);
      expect(network.edges[hit.edge].elevated).toBe(false);
    }
  });

  it('is dry until the water rises, deepest in the middle, and dry beyond the edge', () => {
    const zone = flood.zones[0];
    flood.level = 0;
    expect(flood.depthAt(zone.x, zone.z)).toBe(0);
    expect(flood.potholeAt(zone.potholes[0].x, zone.potholes[0].z)).toBeNull();
    flood.level = 1;
    expect(flood.depthAt(zone.x, zone.z)).toBeCloseTo(ATMOSPHERE.floodDepth, 3);
    const near = flood.depthAt(zone.x + zone.tx * zone.halfLength * 0.8, zone.z + zone.tz * zone.halfLength * 0.8);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(ATMOSPHERE.floodDepth);
    expect(flood.depthAt(zone.x + zone.tx * zone.halfLength * 1.2, zone.z + zone.tz * zone.halfLength * 1.2)).toBe(0);
    expect(flood.potholeAt(zone.potholes[0].x, zone.potholes[0].z)).not.toBeNull();
    flood.level = 0;
  });
});

describe('driving through weather', () => {
  beforeAll(async () => {
    await loadPhysicsEngine();
  });

  function drive(floodAt: ((x: number, z: number, y: number) => boolean) | null, grip: number, seconds: number): { top: number; end: number; distance: number; slip: number; up: number } {
    const physics = new PhysicsWorld(1 / TUNING.physics.fixedHz);
    physics.addFixedCuboid(4000, 1, 4000, 0, -1, 0, 'road');
    physics.floodAt = floodAt;
    physics.weatherGrip = grip;
    const car = new VehicleController(physics, { position: { x: 0, y: 0.8, z: -3000 }, yaw: 0 });
    const intent = createIntent();
    intent.throttle = 1;
    let top = 0;
    let slip = 0;
    let up = 1;
    physics.step();
    for (let i = 0; i < 60 * seconds; i++) {
      car.update(1 / 60, intent);
      physics.step();
      top = Math.max(top, car.telemetry.speedKmh);
      slip = Math.max(slip, car.telemetry.maxSlip);
      up = Math.min(up, car.telemetry.upY);
    }
    return { top, end: car.telemetry.speedKmh, distance: car.position.z + 3000, slip, up };
  }

  it('standing water holds a fast car back, and it stays on its wheels', () => {
    const dry = drive(null, 1, 14);
    const water = drive((_x, z) => z > -2900, 1, 14);
    expect(water.end).toBeLessThan(dry.end * 0.8);
    expect(water.distance).toBeLessThan(dry.distance);
    expect(water.up).toBeGreaterThan(0.9);
  });

  it('water only counts on the ground, never up on the flyover', () => {
    const physics = new PhysicsWorld(1 / 60);
    const floor = physics.addFixedCuboid(100, 1, 100, 0, -1, 0, 'road');
    physics.floodAt = () => true;
    expect(physics.surfaceAt(floor.handle, 0, 0, 0)).toBe('flood');
    expect(physics.surfaceAt(floor.handle, 0, 0, 8)).toBe('road');
  });

  it('a soaked road gives less grip under braking and cornering', () => {
    const stopFrom = (grip: number): number => {
      const physics = new PhysicsWorld(1 / 60);
      physics.addFixedCuboid(4000, 1, 4000, 0, -1, 0, 'road');
      physics.weatherGrip = grip;
      const car = new VehicleController(physics, { position: { x: 0, y: 0.8, z: -3000 }, yaw: 0 });
      const intent = createIntent();
      physics.step();
      intent.throttle = 1;
      for (let i = 0; i < 60 * 8; i++) {
        car.update(1 / 60, intent);
        physics.step();
      }
      intent.throttle = 0;
      intent.brake = 1;
      const from = car.position.z;
      for (let i = 0; i < 60 * 12 && car.telemetry.speed > 1; i++) {
        car.update(1 / 60, intent);
        physics.step();
      }
      return car.position.z - from;
    };
    expect(stopFrom(0.6)).toBeGreaterThan(stopFrom(1) * 1.05);
  });
});

describe('the replay buffer', () => {
  it('keeps the newest stretch, in order, and blends between frames', () => {
    const buffer = new ReplayBuffer(2, 10, 1, 1);
    expect(buffer.capacity).toBe(20);
    for (let i = 0; i < 100; i++) {
      const slot = buffer.advance(0.1);
      expect(slot).toBeGreaterThanOrEqual(0);
      const player = buffer.playerSlot(slot);
      player[PLAYER_FIELDS.x] = i;
      player[PLAYER_FIELDS.qw] = 1;
      buffer.writeActor(slot, 0, true, i, 0, 0, 0, 0, 0, 1);
      buffer.writeTraffic(slot, 0, i % 2 === 0, i, 0, 0, 0, 1, 2);
    }
    expect(buffer.frameCount).toBe(20);
    expect(buffer.duration).toBeCloseTo(1.9, 5);
    const located: [number, number, number] = [0, 0, 0];
    buffer.locate(buffer.endTime - 0.05, located);
    expect(located[2]).toBeCloseTo(0.5, 2);
    expect(buffer.playerValue(located[0], located[1], located[2], PLAYER_FIELDS.x)).toBeCloseTo(98.5, 2);
    buffer.locate(buffer.startTime - 100, located);
    expect(buffer.playerValue(located[0], located[1], 0, PLAYER_FIELDS.x)).toBe(80);
    buffer.locate(buffer.endTime + 100, located);
    expect(buffer.playerValue(located[0], located[1], 0, PLAYER_FIELDS.x)).toBe(99);
  });

  it('only takes a frame when one is due', () => {
    const buffer = new ReplayBuffer(2, 15, 1, 1);
    let frames = 0;
    for (let i = 0; i < 60; i++) if (buffer.advance(1 / 60) >= 0) frames++;
    expect(frames).toBeGreaterThanOrEqual(14);
    expect(frames).toBeLessThanOrEqual(16);
  });

  it('blends a turn the short way round', () => {
    const buffer = new ReplayBuffer(1, 10, 1, 0);
    const a = buffer.advance(1);
    buffer.writeActor(a, 0, true, 0, 0, 0, 0, 0, 0, 1);
    const b = buffer.advance(1);
    buffer.writeActor(b, 0, true, 0, 0, 0, 0, 0, 0, -1);
    const out = { x: 0, y: 0, z: 0, w: 0 };
    buffer.actorRotation(a, b, 0.5, 0, out);
    expect(Math.abs(out.w)).toBeCloseTo(1, 5);
    expect(ACTOR_SIZE).toBe(8);
  });

  it('knows a vehicle that was not there, and does not smear one moved across the map', () => {
    const buffer = new ReplayBuffer(1, 10, 0, 2);
    const a = buffer.advance(1);
    const b = buffer.advance(1);
    buffer.writeTraffic(a, 0, false, 0, 0, 0, 0, 0, 0);
    buffer.writeTraffic(b, 0, true, 10, 0, 0, 0, 0, 0);
    buffer.writeTraffic(a, 1, true, 0, 0, 0, 0, 3, 1);
    buffer.writeTraffic(b, 1, true, 500, 0, 0, 0, 3, 1);
    const out = { x: 0, y: 0, z: 0, yaw: 0, type: 0, variant: 0 };
    expect(buffer.trafficAt(a, b, 0.5, 0, out)).toBe(false);
    expect(buffer.trafficAt(a, b, 0.5, 1, out)).toBe(true);
    expect(out.x).toBe(0);
    expect(out.type).toBe(3);
    expect(out.variant).toBe(1);
  });
});

describe('the replay director', () => {
  it('cuts the whole film into shots, with no gaps and no repeats side by side', () => {
    const shots = planShots(10, 50, 3);
    expect(shots[0].from).toBe(10);
    expect(shots[shots.length - 1].to).toBe(50);
    for (let i = 1; i < shots.length; i++) {
      expect(shots[i].from).toBe(shots[i - 1].to);
      expect(shots[i].kind).not.toBe(shots[i - 1].kind);
    }
    expect(shotAt(shots, 30)).not.toBeNull();
    const kinds = new Set(planShots(0, 200, 3).map((shot) => shot.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(5);
  });

  it('every shot gives the camera a real place to stand', () => {
    const pose: ShotPose = { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0, fov: 60 };
    const car = { x: 10, y: 0.7, z: 20, fx: 0.6, fz: 0.8 };
    for (const kind of SHOT_KINDS) {
      poseFor(kind, car, car, 2, { kind, from: 0, to: 5, side: 1, variety: 0.4 }, pose);
      expect(Number.isFinite(pose.x + pose.y + pose.z), kind).toBe(true);
      expect(pose.fov, kind).toBeGreaterThan(15);
      expect(Math.hypot(pose.x - pose.lookX, pose.y - pose.lookY, pose.z - pose.lookZ), kind).toBeGreaterThan(1);
    }
  });

  it('slows the film around a crash, and not otherwise', () => {
    const events = [{ time: 5, kind: 'impact' as const, x: 0, y: 0, z: 0, strength: 1 }];
    expect(pace(events, 5)).toBeLessThan(0.5);
    expect(pace(events, 8)).toBe(1);
    expect(pace([{ ...events[0], kind: 'nitro' }], 5)).toBe(1);
  });
});

describe('the band', () => {
  it('every note it plays belongs to the scale, and bars are the right length', () => {
    const moods: Mood[] = ['adda', 'cruise', 'rain', 'blackout', 'race', 'pursuit'];
    for (const mood of moods) {
      const scale = SCALES.bhairavi;
      const section = buildSection(mood, 11, 8, scale.length);
      expect(section.length).toBe(8);
      for (const bar of section) {
        for (const list of [bar.kick, bar.snare, bar.hat, bar.dholLow, bar.dholHigh, bar.tablaNa, bar.tablaGe, bar.cowbell, bar.bass, bar.ektara, bar.bansuri]) {
          expect(list.length, mood).toBe(STEPS_PER_BAR);
        }
        for (const degree of [...bar.cowbell, ...bar.bass, ...bar.ektara, ...bar.bansuri]) {
          if (degree === null) continue;
          const note = degreeToMidi(scale, 40, degree);
          expect(scale, `${mood} degree ${degree}`).toContain((note - 40 + 120) % 12);
        }
      }
    }
  });

  it('the same seed plays the same music, and another seed something else', () => {
    expect(buildSection('cruise', 5, 8, 7)).toEqual(buildSection('cruise', 5, 8, 7));
    expect(buildSection('cruise', 5, 8, 7)).not.toEqual(buildSection('cruise', 6, 8, 7));
  });

  it('follows the scene: heavier with more stars, darker in the rain, thin in a blackout', () => {
    const base = { intensity: 0, rain: 0, blackout: false, daylight: 0, speed: 0 };
    const roam = chooseMix({ ...base, scene: 'roam' });
    expect(roam.mood).toBe('cruise');
    const wet = chooseMix({ ...base, scene: 'roam', rain: 1 });
    expect(wet.mood).toBe('rain');
    expect(wet.filterHz).toBeLessThan(roam.filterHz);
    const dark = chooseMix({ ...base, scene: 'roam', blackout: true });
    expect(dark.mood).toBe('blackout');
    expect(dark.layers.drums).toBe(0);
    const chase1 = chooseMix({ ...base, scene: 'pursuit', intensity: 0.2 });
    const chase5 = chooseMix({ ...base, scene: 'pursuit', intensity: 1 });
    expect(chase1.mood).toBe('pursuit');
    expect(chase5.layers.cowbell).toBeGreaterThan(chase1.layers.cowbell);
    expect(chase5.layers.dhol).toBeGreaterThan(chase1.layers.dhol);
    expect(chooseMix({ ...base, scene: 'race' }).mood).toBe('race');
    expect(chooseMix({ ...base, scene: 'menu' }).mood).toBe('adda');
    // A chase or a race outranks the weather and the dark.
    expect(chooseMix({ ...base, scene: 'pursuit', rain: 1, blackout: true }).mood).toBe('pursuit');
  });
});

describe('রেডিও ঝড়', () => {
  const lines: Record<'bn' | 'en', Record<string, string[]>> = { bn: bn.radio.lines, en: en.radio.lines };
  const topics: RadioTopic[] = ['welcome', 'heat1', 'heat3', 'heat5', 'escaped', 'busted', 'raceWin', 'raceLose', 'crash', 'levelUp', 'rainStart', 'rainStop', 'fogStart', 'fogStop', 'blackoutStart', 'blackoutEnd', 'dawn', 'morning', 'dusk', 'night', 'flood', 'report', 'advert', 'banter', 'song'];

  it('has words for everything she might talk about, in both languages', () => {
    for (const topic of topics) {
      expect(lines.bn[topic]?.length, `bn ${topic}`).toBeGreaterThan(0);
      expect(lines.en[topic]?.length, `en ${topic}`).toBe(lines.bn[topic].length);
    }
  });

  function station(): RadioStation {
    let seed = 1;
    return new RadioStation(() => 3, () => 40, () => (seed = (seed * 7 + 3) % 11) / 11);
  }
  const advance = (radio: RadioStation, seconds: number): Array<{ topic: RadioTopic; at: number }> => {
    const said: Array<{ topic: RadioTopic; at: number }> = [];
    for (let t = 0; t < seconds; t += 0.1) {
      const line = radio.update(0.1);
      if (line) said.push({ topic: line.topic, at: t });
    }
    return said;
  };

  it('talks now and then on her own, with quiet between', () => {
    const said = advance(station(), 400);
    expect(said.length).toBeGreaterThan(3);
    expect(said.length).toBeLessThan(14);
    for (let i = 1; i < said.length; i++) expect(said[i].at - said[i - 1].at).toBeGreaterThan(RADIO_TIMING.fillerEvery[0]);
  });

  it('a big moment cuts in at once, and the most important request wins', () => {
    const radio = station();
    advance(radio, 3);
    radio.request('banter');
    radio.request('heat5');
    radio.request('crash');
    const said = advance(radio, 1);
    expect(said.map((line) => line.topic)).toEqual(['heat5']);
  });

  it('never talks over herself', () => {
    const radio = station();
    advance(radio, 3);
    radio.request('escaped');
    expect(advance(radio, 0.5).length).toBe(1);
    radio.request('busted');
    expect(advance(radio, 1).length).toBe(0);
  });

  it('does not keep repeating a topic', () => {
    const radio = station();
    advance(radio, 3);
    radio.request('crash');
    const first = advance(radio, 12);
    expect(first.filter((line) => line.topic === 'crash').length).toBe(1);
    radio.request('crash');
    expect(advance(radio, 20).filter((line) => line.topic === 'crash').length).toBe(0);
  });

  it('stays silent when the radio is on music only', () => {
    const radio = station();
    radio.talking = false;
    radio.request('heat5');
    expect(advance(radio, 200).length).toBe(0);
  });
});
