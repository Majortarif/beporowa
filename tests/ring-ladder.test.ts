/** Moving up the Ring, and whether every rival and race has its words. Run: npm test */

import { describe, expect, it } from 'vitest';
import { EVENT_BY_ID, RACE_EVENTS, RACE_MODES } from '../src/config/race-events';
import { RACE } from '../src/config/race-tuning';
import { RIVALS } from '../src/config/rivals';
import bn from '../src/i18n/bn.json';
import en from '../src/i18n/en.json';
import { applyResult, currentTier, isTierOpen, isUnlocked, lockReason, rivalRaceOf, warmupsOf } from '../src/race/ring-ladder';
import type { RaceOutcome } from '../src/race/race-session';
import { createCareer } from '../src/save/career';

function outcome(id: string, patch: Partial<RaceOutcome>): RaceOutcome {
  return {
    event: EVENT_BY_ID.get(id)!,
    completed: true,
    rivalBeaten: false,
    medal: 3,
    position: 1,
    racers: 4,
    timeMs: 60000,
    score: 0,
    timeLeft: 0,
    cargo: 100,
    failure: 'none',
    margin: 2,
    ...patch,
  };
}

describe('the ladder', () => {
  it('starts at the bottom, with only the first rival\'s warm-ups open', () => {
    const career = createCareer();
    expect(currentTier(career)).toBe(10);
    expect(isTierOpen(10, career)).toBe(true);
    expect(isTierOpen(9, career)).toBe(false);
    for (const warmup of warmupsOf(10)) expect(isUnlocked(warmup, career)).toBe(true);
    expect(lockReason(rivalRaceOf(10)!, career)).toBe('warmups');
    expect(lockReason(rivalRaceOf(9)!, career)).toBe('tier');
  });

  it('a finished warm-up opens the rival, and beating the rival opens the next tier', () => {
    const career = createCareer();
    const warmup = warmupsOf(10)[0];
    applyResult(career, outcome(warmup.id, {}));
    expect(lockReason(rivalRaceOf(10)!, career)).toBe('none');

    const change = applyResult(career, outcome('bazaarMaze', { rivalBeaten: true }));
    expect(change.rivalBeaten).toBe(true);
    expect(change.newRank).toBe(10);
    expect(career.rank).toBe(10);
    expect(currentTier(career)).toBe(9);
    expect(isTierOpen(9, career)).toBe(true);
    expect(lockReason(rivalRaceOf(9)!, career)).toBe('warmups');
    // Beaten tiers stay open for another go.
    expect(isUnlocked(warmup, career)).toBe(true);
  });

  it('a loss changes nothing, and earns nothing', () => {
    const career = createCareer();
    const change = applyResult(career, outcome('goliCircuit', { completed: false, medal: 0, position: 4 }));
    expect(change.pointsGained).toBe(0);
    expect(career.ringPoints).toBe(0);
    expect(career.events.goliCircuit.completed).toBe(false);
  });

  it('a better medal pays, and a repeat pays only a little', () => {
    const career = createCareer();
    const event = EVENT_BY_ID.get('goliCircuit')!;
    const first = applyResult(career, outcome('goliCircuit', { medal: 1 }));
    expect(first.pointsGained).toBe(Math.round(event.points * RACE.rewards.medalShare[2]));
    const better = applyResult(career, outcome('goliCircuit', { medal: 3 }));
    expect(better.newMedal).toBe(true);
    expect(better.pointsGained).toBe(event.points);
    const again = applyResult(career, outcome('goliCircuit', { medal: 3 }));
    expect(again.newMedal).toBe(false);
    expect(again.pointsGained).toBe(Math.round(event.points * RACE.rewards.replayShare));
    expect(career.events.goliCircuit.medal).toBe(3);
  });

  it('beating a rival again does not raise the rank again', () => {
    const career = createCareer();
    career.rank = 5;
    const change = applyResult(career, outcome('bazaarMaze', { rivalBeaten: true }));
    expect(change.newRank).toBeNull();
    expect(career.rank).toBe(5);
  });

  it('beating the last rival ends the ladder', () => {
    const career = createCareer();
    career.rank = 2;
    const change = applyResult(career, outcome('kalbaishakhi', { rivalBeaten: true }));
    expect(change.champion).toBe(true);
    expect(career.champion).toBe(true);
    expect(career.rank).toBe(1);
  });

  it('free play opens everything', () => {
    const career = createCareer();
    career.freePlay = true;
    for (const event of RACE_EVENTS) expect(isUnlocked(event, career), event.id).toBe(true);
  });

  it('keeps the best time and score it has seen', () => {
    const career = createCareer();
    applyResult(career, outcome('avenueTrial', { timeMs: 70000 }));
    const quicker = applyResult(career, outcome('avenueTrial', { timeMs: 65000 }));
    expect(quicker.newBest).toBe(true);
    applyResult(career, outcome('avenueTrial', { timeMs: 90000 }));
    expect(career.events.avenueTrial.bestMs).toBe(65000);
  });
});

describe('words for everyone', () => {
  const LISTS = ['intro', 'win', 'lose', 'passed', 'passing', 'bump', 'provoked', 'finishFirst'] as const;

  it('every rival has a name and all their lines, in both languages', () => {
    for (const table of [bn, en]) {
      for (const rival of RIVALS) {
        const words = (table.rival as Record<string, Record<string, unknown>>)[rival.id];
        expect(words, rival.id).toBeDefined();
        for (const field of ['name', 'nick', 'car', 'style', 'bio']) expect(words[field], `${rival.id}.${field}`).toBeTruthy();
        for (const list of LISTS) expect((words[list] as string[]).length, `${rival.id}.${list}`).toBeGreaterThan(0);
      }
    }
  });

  it('every event and mode has its words, in both languages', () => {
    for (const table of [bn, en]) {
      const race = table.race as { event: Record<string, { name: string; brief: string }>; mode: Record<string, string>; rules: Record<string, string> };
      for (const event of RACE_EVENTS) {
        expect(race.event[event.id]?.name, event.id).toBeTruthy();
        expect(race.event[event.id]?.brief, event.id).toBeTruthy();
      }
      for (const mode of RACE_MODES) {
        expect(race.mode[mode], mode).toBeTruthy();
        expect(race.rules[mode], mode).toBeTruthy();
      }
    }
  });
});
