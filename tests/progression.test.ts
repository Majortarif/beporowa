/** Money, levels, cars, parts, saves, achievements and side jobs. Run: npm test */

import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, JOBS, JOB_BY_ID, NPC_IDS, RUMOURS_PER_RIVAL, TALK_SHAPE } from '../src/config/achievements';
import { CARS, CAR_BY_ID, CLASS_COST_SCALE, PARTS, PART_KINDS, PART_LEVEL_NEEDS } from '../src/config/cars';
import { PROGRESS } from '../src/config/progression';
import { EVENT_BY_ID } from '../src/config/race-events';
import { RIVALS } from '../src/config/rivals';
import { EventBus } from '../src/core/events';
import bn from '../src/i18n/bn.json';
import en from '../src/i18n/en.json';
import {
  buyCar,
  buyPart,
  carLock,
  claimDaily,
  dayKey,
  displayRating,
  earn,
  levelFor,
  levelShare,
  limpScales,
  partCost,
  partLock,
  performanceIndex,
  playerPerformance,
  repForLevel,
  rivalScale,
  statsWithParts,
  wearFrom,
} from '../src/progression/economy';
import { ProgressTracker } from '../src/progression/progress-tracker';
import { applyResult } from '../src/race/ring-ladder';
import type { RaceOutcome } from '../src/race/race-session';
import { scaleToCar } from '../src/race/rival-memory';
import { SAVE_SCHEMA, createCareer, migrateSave, newOwnedCar, type CareerData } from '../src/save/career';

function outcome(id: string, patch: Partial<RaceOutcome>): RaceOutcome {
  return { event: EVENT_BY_ID.get(id)!, completed: true, rivalBeaten: false, medal: 3, position: 1, racers: 4, timeMs: 60000, score: 0, timeLeft: 0, cargo: 100, failure: 'none', margin: 2, ...patch };
}

describe('levels', () => {
  it('rise with reputation, more slowly each time, up to a cap', () => {
    expect(levelFor(0)).toBe(1);
    expect(repForLevel(1)).toBe(0);
    for (let level = 2; level < PROGRESS.levelCap; level++) {
      expect(repForLevel(level + 1) - repForLevel(level)).toBeGreaterThan(repForLevel(level) - repForLevel(level - 1));
      expect(levelFor(repForLevel(level))).toBe(level);
      expect(levelFor(repForLevel(level) - 1)).toBe(level - 1);
    }
    expect(levelFor(1e9)).toBe(PROGRESS.levelCap);
    expect(levelShare(1e9)).toBe(1);
  });

  it('a new level pays a bonus, and says so', () => {
    const career = createCareer();
    const before = career.cash;
    const quiet = earn(career, 100, 1);
    expect(quiet.levelUp).toBeNull();
    expect(career.cash).toBe(before + 100);
    const up = earn(career, 0, repForLevel(3));
    expect(up.levelUp).toBe(3);
    expect(career.cash).toBe(before + 100 + PROGRESS.levelUpCash * 2);
  });
});

describe('cars', () => {
  it('has nine cars in three classes, and one secret', () => {
    const count = (kind: string): number => CARS.filter((car) => car.class === kind).length;
    expect(count('goli')).toBe(3);
    expect(count('sarak')).toBe(3);
    expect(count('ural')).toBe(3);
    expect(count('secret')).toBe(1);
    expect(CAR_BY_ID.get('bulbuli')?.price).toBe(0);
  });

  it('a stock starter is the yardstick', () => {
    expect(performanceIndex(CAR_BY_ID.get('bulbuli')!.stats)).toBeCloseTo(1, 5);
    expect(displayRating(CAR_BY_ID.get('bulbuli')!.stats)).toBe(100);
  });

  it('classes get stronger, and dearer', () => {
    const rated = CARS.filter((car) => car.class !== 'secret').map((car) => performanceIndex(car.stats));
    expect(Math.max(...rated.slice(0, 3))).toBeLessThan(Math.min(...rated.slice(3, 6)));
    expect(Math.max(...rated.slice(3, 6))).toBeLessThan(Math.min(...rated.slice(6, 9)));
  });

  it('needs the rank and the money', () => {
    const career = createCareer();
    const shalik = CAR_BY_ID.get('shalik')!;
    const bagha = CAR_BY_ID.get('bagha')!;
    expect(carLock(career, shalik)).toBe('cash');
    career.cash = 1e6;
    expect(carLock(career, shalik)).toBe('none');
    expect(carLock(career, bagha)).toBe('rank');
    expect(buyCar(career, 'bagha')).toBe(false);
    const money = career.cash;
    expect(buyCar(career, 'shalik')).toBe(true);
    expect(career.cash).toBe(money - shalik.price);
    expect(career.selectedCar).toBe('shalik');
    expect(buyCar(career, 'shalik')).toBe(false);
  });

  it('রিকশা রকেট only opens for a champion', () => {
    const career = createCareer();
    career.cash = 1e6;
    career.rank = 1;
    const rocket = CAR_BY_ID.get('rocket')!;
    expect(carLock(career, rocket)).toBe('rank');
    career.champion = true;
    expect(carLock(career, rocket)).toBe('none');
    expect(buyCar(career, 'rocket')).toBe(true);
    expect(career.cash).toBe(1e6 - 1);
  });

  it('free play opens every car without charge', () => {
    const career = createCareer();
    career.freePlay = true;
    career.cash = 0;
    for (const car of CARS) {
      if (car.id === 'bulbuli') continue;
      expect(buyCar(career, car.id), car.id).toBe(true);
    }
    expect(career.cash).toBe(0);
  });
});

describe('parts', () => {
  it('cost more on a bigger car, and need a level', () => {
    const goli = CAR_BY_ID.get('bulbuli')!;
    const ural = CAR_BY_ID.get('bagha')!;
    expect(partCost(ural, 'engine', 1)).toBe(Math.round(PARTS.engine.costs[0] * CLASS_COST_SCALE.ural));
    expect(partCost(ural, 'engine', 1)).toBeGreaterThan(partCost(goli, 'engine', 1));

    const career = createCareer();
    career.cash = 1e6;
    const owned = career.cars.bulbuli;
    expect(partLock(career, goli, owned, 'engine')).toBe('none');
    expect(buyPart(career, 'bulbuli', 'engine')).toBe(true);
    expect(owned.parts.engine).toBe(1);
    // Level two of a part needs a higher player level.
    expect(partLock(career, goli, owned, 'engine')).toBe('level');
    career.ringPoints = repForLevel(PART_LEVEL_NEEDS[1]);
    expect(buyPart(career, 'bulbuli', 'engine')).toBe(true);
    career.ringPoints = repForLevel(PART_LEVEL_NEEDS[2]);
    expect(buyPart(career, 'bulbuli', 'engine')).toBe(true);
    expect(partLock(career, goli, owned, 'engine')).toBe('max');
    expect(buyPart(career, 'bulbuli', 'engine')).toBe(false);
  });

  it('every part makes the car measurably better at what it says', () => {
    const car = CAR_BY_ID.get('bulbuli')!;
    const stock = car.stats;
    for (const kind of PART_KINDS) {
      const parts = { ...newOwnedCar('bulbuli').parts, [kind]: 3 };
      const tuned = statsWithParts(car, parts);
      for (const stat of Object.keys(PARTS[kind].effects) as Array<keyof typeof stock>) expect(tuned[stat], `${kind} ${stat}`).toBeGreaterThan(stock[stat]);
    }
    const career = createCareer();
    const before = playerPerformance(career);
    career.cars.bulbuli.parts.engine = 3;
    expect(playerPerformance(career)).toBeGreaterThan(before);
  });
});

describe('damage', () => {
  it('wears down in crashes, and only costs power once it is bad', () => {
    const career = createCareer();
    wearFrom(career, 1, false);
    expect(career.condition).toBeLessThan(100);
    expect(limpScales(100).power).toBe(1);
    expect(limpScales(PROGRESS.condition.limpFrom).power).toBe(1);
    expect(limpScales(0).power).toBeCloseTo(PROGRESS.condition.limpPower, 5);
    for (let i = 0; i < 40; i++) wearFrom(career, 1, false);
    expect(career.condition).toBe(0);
  });
});

describe('daily reward', () => {
  it('pays once a day, grows with a streak, and resets if a day is missed', () => {
    const career = createCareer();
    const day1 = new Date(2026, 10, 5, 12);
    const first = claimDaily(career, day1);
    expect(first?.streak).toBe(1);
    expect(first?.cash).toBe(PROGRESS.daily.cash[0]);
    expect(claimDaily(career, day1)).toBeNull();
    const day2 = new Date(2026, 10, 6, 1);
    const second = claimDaily(career, day2);
    expect(second?.streak).toBe(2);
    expect(second?.cash).toBe(PROGRESS.daily.cash[1]);
    const later = new Date(2026, 10, 12, 9);
    expect(claimDaily(career, later)?.streak).toBe(1);
    expect(dayKey(day1)).toBe('2026-11-05');
  });

  it('crosses a month without losing the streak', () => {
    const career = createCareer();
    claimDaily(career, new Date(2026, 10, 30, 23));
    expect(claimDaily(career, new Date(2026, 11, 1, 1))?.streak).toBe(2);
  });
});

describe('saving', () => {
  it('brings an old save forward, and pays for what it had earned', () => {
    const old = { ringPoints: 400, rank: 8, events: { goliCircuit: { medal: 2, bestMs: 1, bestScore: null, completed: true } }, memory: { passLeft: 3 }, freePlay: false, introSeen: true, champion: false };
    const migrated = migrateSave(old);
    expect(migrated.schema).toBe(SAVE_SCHEMA);
    expect(migrated.rank).toBe(8);
    expect(migrated.events.goliCircuit.medal).toBe(2);
    expect(migrated.memory.passLeft).toBe(3);
    expect(migrated.memory.races).toBe(0);
    expect(migrated.cars.bulbuli).toBeDefined();
    expect(migrated.cash).toBe(PROGRESS.startCash + 400 * PROGRESS.raceCashPerPoint);
  });

  it('survives junk, a car that no longer exists, and missing parts', () => {
    expect(migrateSave(null).rank).toBe(11);
    expect(migrateSave('nonsense').cash).toBe(PROGRESS.startCash);
    const saved = createCareer();
    (saved.cars as Record<string, unknown>).ghost = { parts: {}, livery: {} };
    saved.selectedCar = 'ghost';
    delete (saved.cars.bulbuli.parts as Partial<typeof saved.cars.bulbuli.parts>).nitro;
    const migrated = migrateSave(JSON.parse(JSON.stringify(saved)));
    expect(migrated.cars.ghost).toBeUndefined();
    expect(migrated.selectedCar).toBe('bulbuli');
    expect(migrated.cars.bulbuli.parts.nitro).toBe(0);
  });

  it('a current save comes back as it went in', () => {
    const saved = createCareer();
    saved.cash = 4321;
    saved.jobsDone.push('milkRun');
    const migrated = migrateSave(JSON.parse(JSON.stringify(saved)));
    expect(migrated.cash).toBe(4321);
    expect(migrated.jobsDone).toEqual(['milkRun']);
  });
});

describe('race pay', () => {
  it('pays cash and reputation, more for a rival', () => {
    const career = createCareer();
    const before = career.cash;
    const change = applyResult(career, outcome('goliCircuit', { medal: 3 }));
    expect(change.pointsGained).toBe(EVENT_BY_ID.get('goliCircuit')!.points);
    // Crossing into a new level pays its bonus on top.
    expect(career.cash).toBe(before + change.cashGained + (change.levelUp !== null ? PROGRESS.levelUpCash : 0));
    const rival = applyResult(career, outcome('bazaarMaze', { rivalBeaten: true }));
    expect(rival.cashGained).toBeGreaterThan(PROGRESS.rivalBeatenCash);
    expect(career.stats.rivalsBeaten).toBe(1);
  });
});

describe('rivals keep pace with your car', () => {
  it('follow the car, but rank still counts', () => {
    expect(rivalScale(10, 1)).toBeCloseTo(1, 5);
    expect(rivalScale(1, 1)).toBeGreaterThan(rivalScale(10, 1));
    expect(rivalScale(5, 1.6)).toBeGreaterThan(rivalScale(5, 1));
    expect(rivalScale(1, 99)).toBe(PROGRESS.balance.maxScale);
    expect(rivalScale(10, 0.5)).toBe(PROGRESS.balance.minScale);
  });

  it('the scale changes the machine, and never the driver\'s habits', () => {
    const base = RIVALS[0].traits;
    const scaled = scaleToCar(base, 1.4);
    expect(scaled.power).toBeCloseTo(base.power * 1.4, 5);
    expect(scaled.topSpeed).toBeGreaterThan(base.topSpeed);
    expect(scaled.mistakeRate).toBe(base.mistakeRate);
    expect(scaled.block).toBe(base.block);
  });
});

describe('achievements and jobs', () => {
  function tracked(): { career: CareerData; bus: EventBus; tracker: ProgressTracker; earned: string[]; done: string[]; failed: string[] } {
    const career = createCareer();
    const bus = new EventBus();
    const tracker = new ProgressTracker(bus, () => career, () => {});
    const earned: string[] = [];
    const done: string[] = [];
    const failed: string[] = [];
    tracker.onAchievement = (achievement) => earned.push(achievement.id);
    tracker.onJobDone = (job) => done.push(job.id);
    tracker.onJobFailed = (job) => failed.push(job.id);
    return { career, bus, tracker, earned, done, failed };
  }

  it('counts what happens, and pays once', () => {
    const { career, bus, earned } = tracked();
    const cash = career.cash;
    bus.emit('pursuitEscaped', { stars: 2, seconds: 30, points: 100 });
    expect(earned).toEqual(['firstEscape']);
    expect(career.cash).toBeGreaterThan(cash);
    const after = career.cash;
    bus.emit('pursuitEscaped', { stars: 2, seconds: 30, points: 100 });
    expect(earned).toEqual(['firstEscape']);
    expect(career.cash).toBe(after);
    bus.emit('pursuitEscaped', { stars: 5, seconds: 30, points: 100 });
    expect(earned).toContain('fiveStar');
  });

  it('every achievement can be reached by its count', () => {
    const { career, tracker, earned } = tracked();
    for (const achievement of ACHIEVEMENTS) tracker.count(achievement.stat, achievement.target);
    expect(new Set(earned).size).toBe(ACHIEVEMENTS.length);
    expect(Object.keys(career.achievements).length).toBe(ACHIEVEMENTS.length);
  });

  it('a counting job finishes when the count has risen by enough, from when it started', () => {
    const { career, bus, tracker, done } = tracked();
    for (let i = 0; i < 5; i++) bus.emit('nearMiss', { squeeze: false, points: 1, nitro: 1 });
    expect(tracker.acceptJob('clearJam')).toBe(true);
    expect(career.job?.startValue).toBe(5);
    expect(tracker.acceptJob('smokeShow')).toBe(false);
    for (let i = 0; i < 7; i++) bus.emit('nearMiss', { squeeze: false, points: 1, nitro: 1 });
    expect(done).toEqual([]);
    expect(tracker.jobShare()).toBeCloseTo(7 / 8, 5);
    const cash = career.cash;
    bus.emit('nearMiss', { squeeze: false, points: 1, nitro: 1 });
    expect(done).toEqual(['clearJam']);
    expect(career.job).toBeNull();
    expect(career.cash).toBeGreaterThanOrEqual(cash + JOB_BY_ID.get('clearJam')!.cash);
    expect(career.jobsDone).toContain('clearJam');
  });

  it('a job on the clock ends in time, or fails', () => {
    const { career, tracker, done, failed } = tracked();
    tracker.acceptJob('milkRun');
    tracker.frame(1, 0, false);
    expect(career.job).not.toBeNull();
    tracker.arrivedAtJobPlace();
    expect(done).toEqual(['milkRun']);

    tracker.acceptJob('medicine');
    tracker.frame(JOB_BY_ID.get('medicine')!.seconds! + 1, 0, false);
    expect(failed).toEqual(['medicine']);
    expect(career.job).toBeNull();
  });

  it('counts distance in kilometres', () => {
    const { career, tracker } = tracked();
    for (let i = 0; i < 60; i++) tracker.frame(1, 30, false);
    expect(career.stats.kilometres ?? 0).toBeCloseTo(1.5, 0);
  });
});

describe('words for everything', () => {
  const tables = { bn, en } as unknown as Record<'bn' | 'en', Record<string, any>>;

  it('every car, part, achievement and job has its words', () => {
    for (const name of ['bn', 'en'] as const) {
      const table = tables[name];
      for (const car of CARS) {
        expect(table.car[car.id]?.name, `${name} car ${car.id}`).toBeTruthy();
        expect(table.car[car.id]?.blurb, `${name} car ${car.id}`).toBeTruthy();
      }
      for (const kind of PART_KINDS) expect(table.garage.part[kind]?.name, `${name} part ${kind}`).toBeTruthy();
      for (const achievement of ACHIEVEMENTS) {
        expect(table.ach[achievement.id]?.title, `${name} ach ${achievement.id}`).toBeTruthy();
        expect(table.ach[achievement.id]?.desc, `${name} ach ${achievement.id}`).toBeTruthy();
      }
      for (const job of JOBS) {
        for (const field of ['offer', 'goal', 'done']) expect(table.adda.job[job.id]?.[field], `${name} job ${job.id}.${field}`).toBeTruthy();
      }
    }
  });

  it('every person at the tea stall has a whole conversation, and every rival has rumours', () => {
    for (const name of ['bn', 'en'] as const) {
      const table = tables[name];
      for (const id of NPC_IDS) {
        const npc = table.adda.npc[id];
        expect(npc.name, `${name} ${id}`).toBeTruthy();
        for (const node of TALK_SHAPE) {
          expect(npc.talk[node.id]?.line, `${name} ${id} ${node.id}`).toBeTruthy();
          for (const reply of node.replies) expect(npc.talk[node.id]?.[reply.id], `${name} ${id} ${node.id}.${reply.id}`).toBeTruthy();
        }
      }
      for (const rival of RIVALS) expect(table.adda.rumour[rival.id].length, `${name} ${rival.id}`).toBe(RUMOURS_PER_RIVAL);
    }
  });

  it('every job comes from someone real, and goes somewhere real', () => {
    for (const job of JOBS) {
      expect(NPC_IDS).toContain(job.npc);
      if (job.kind === 'goto') {
        expect(job.place).toBeTruthy();
        expect(job.seconds).toBeGreaterThan(0);
      } else {
        expect(job.stat).toBeTruthy();
        expect(job.amount).toBeGreaterThan(0);
      }
    }
  });
});
