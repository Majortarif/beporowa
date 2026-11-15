/**
 * Phase 7: ghosts, the challenge calendar, the season pass, the leaderboard's rules,
 * the banter writer's checks, the friends relay, and the small pure pieces of controls.
 * Run: npm test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RELAY_LIMITS, startRelay, type RelayHandle } from '../server/relay.js';
import { challengeDay, challengeWeek, dailyChallengeFor, paceSeconds, previousDay, seasonFor, weeklyChallengeFor, wordIndexFor } from '../src/challenges/challenge-calendar';
import { PAID_ATTEMPTS, judgeRun, pruneChallenges, recordChallenge } from '../src/challenges/challenge-rules';
import { addSeasonXp, claimTier, claimableTiers, ensureSeason, tierFor } from '../src/challenges/season';
import { CHALLENGE_BY_ID, DAILY_CHALLENGES, SEASON, WEEKLY_CHALLENGES } from '../src/config/challenges';
import { GHOST, MARKER_COLOURS } from '../src/config/extras';
import { BANTER, LEADERBOARD } from '../src/config/online';
import { EVENT_BY_ID, RACE_EVENTS } from '../src/config/race-events';
import { GHOST_STRIDE, GhostRecorder, createGhostPose, decodeGhost, encodeGhost, ghostDuration, ghostTimeAtProgress, ghostTopSpeed, sampleGhost, type GhostTrack } from '../src/ghost/ghost-track';
import { TiltInput } from '../src/input/tilt';
import { MemoryStore, cleanName, handleLeaderboard, parseBoard, straightLineDistance } from '../src/online/leaderboard-core';
import { buildPrompt, cleanLine, handleBanter, parseBanterRequest } from '../src/online/banter-core';
import { NetSession } from '../src/online/net-session';
import { RaceCourse } from '../src/race/race-course';
import { classifyGpu } from '../src/render/quality';
import { createCareer } from '../src/save/career';
import { NODES } from '../src/world/city/city-map';
import { RoadNetwork } from '../src/world/city/road-network';

const MAX_SAMPLES = Math.ceil(GHOST.maxSeconds * 30) + 2;

/** A ghost driving straight east from a point at a steady speed. */
function straightGhost(eventId: string, carId: string, seconds: number, speed: number, startX: number, startZ: number): GhostTrack {
  const recorder = new GhostRecorder();
  recorder.begin(eventId, carId, GHOST.hz, GHOST.maxSeconds);
  // A quarter turn about Y, so the car faces east.
  const half = Math.PI / 4;
  for (let step = 0; step <= seconds * 60; step++) {
    const time = step / 60;
    recorder.record(time, startX + speed * time, 0.65, startZ, 0, Math.sin(half), 0, Math.cos(half), speed * time);
  }
  const track = recorder.finish(seconds * 1000);
  if (!track) throw new Error('no ghost');
  return track;
}

describe('ghost tracks', () => {
  const track = straightGhost('avenueTrial', 'bulbuli', 20, 30, -100, 40);

  it('samples at exact moments, whatever the steps', () => {
    expect(track.count).toBe(20 * GHOST.hz + 1);
    expect(ghostDuration(track)).toBeCloseTo(20, 5);
    const pose = createGhostPose();
    expect(sampleGhost(track, 7.3, pose)).toBe(true);
    expect(pose.x).toBeCloseTo(-100 + 30 * 7.3, 3);
    expect(pose.z).toBeCloseTo(40, 4);
    expect(pose.progress).toBeCloseTo(30 * 7.3, 2);
    // Past the end, the ghost waits at the finish and says so.
    expect(sampleGhost(track, 25, pose)).toBe(false);
    expect(pose.x).toBeCloseTo(-100 + 600, 2);
  });

  it('finds when it reached a point on the course, for the gap', () => {
    expect(ghostTimeAtProgress(track, 0)).toBe(0);
    expect(ghostTimeAtProgress(track, 300)).toBeCloseTo(10, 3);
    expect(ghostTimeAtProgress(track, 601)).toBeNull();
    expect(ghostTopSpeed(track)).toBeCloseTo(30, 3);
  });

  it('packs small and comes back close to the original', () => {
    const packet = encodeGhost(track);
    expect(packet).not.toBeNull();
    const bytes = JSON.stringify(packet).length;
    console.log(`ghost: ${track.count} samples, ${bytes} bytes as JSON`);
    expect(bytes).toBeLessThan(track.count * GHOST_STRIDE * 3);
    const back = decodeGhost(packet, MAX_SAMPLES) as GhostTrack;
    expect(back.count).toBe(track.count);
    expect(back.timeMs).toBe(track.timeMs);
    let worst = 0;
    for (let i = 0; i < track.frames.length; i++) worst = Math.max(worst, Math.abs(track.frames[i] - back.frames[i]));
    expect(worst).toBeLessThan(0.3);
  });

  it('refuses packets that are broken or too big', () => {
    const packet = encodeGhost(track);
    expect(decodeGhost(null, MAX_SAMPLES)).toBeNull();
    expect(decodeGhost({ ...packet, n: 99999 }, MAX_SAMPLES)).toBeNull();
    expect(decodeGhost({ ...packet, d: 'not base64!!' }, MAX_SAMPLES)).toBeNull();
    expect(decodeGhost({ ...packet, e: '../etc' }, MAX_SAMPLES)).toBeNull();
    expect(decodeGhost({ ...packet, h: 1000 }, MAX_SAMPLES)).toBeNull();
  });

  it('keeps no ghost of a run too long to hold', () => {
    const recorder = new GhostRecorder();
    recorder.begin('avenueTrial', 'bulbuli', 4, 2);
    for (let step = 0; step <= 600; step++) recorder.record(step / 60, step, 0, 0, 0, 0, 0, 1, step);
    expect(recorder.finish(10000)).toBeNull();
  });
});

describe('challenge calendar', () => {
  it('uses Bangladesh time for the day and ISO weeks for the week', () => {
    // 20:00 UTC is already the next morning in Dhaka.
    expect(challengeDay(new Date(Date.UTC(2026, 10, 10, 20, 0)))).toBe('2026-11-11');
    expect(challengeDay(new Date(Date.UTC(2026, 10, 10, 17, 59)))).toBe('2026-11-10');
    expect(challengeWeek(new Date(Date.UTC(2026, 10, 10, 6)))).toBe('2026-W46');
    expect(challengeWeek(new Date(Date.UTC(2021, 0, 3, 6)))).toBe('2020-W53');
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
  });

  it('gives everyone the same challenge, never the same one two days running', () => {
    let day = '2026-01-01';
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const next = previousDay(day);
      expect(dailyChallengeFor(day).id).toBe(dailyChallengeFor(day).id);
      expect(dailyChallengeFor(day).id, day).not.toBe(dailyChallengeFor(next).id);
      seen.add(dailyChallengeFor(day).id);
      day = next;
    }
    // Over a year every daily challenge comes round.
    expect(seen.size).toBe(DAILY_CHALLENGES.length);
    expect(WEEKLY_CHALLENGES.map((def) => def.id)).toContain(weeklyChallengeFor('2026-W46').id);
    expect(wordIndexFor('2026-11-10', 24)).toBe(wordIndexFor('2026-11-10', 24));
  });

  it('follows the six Bangla seasons', () => {
    expect(seasonFor('2026-04-14').name).toBe('grishmo');
    expect(seasonFor('2026-06-15').name).toBe('borsha');
    expect(seasonFor('2026-06-14').name).toBe('grishmo');
    expect(seasonFor('2026-11-10').name).toBe('hemonto');
    expect(seasonFor('2027-01-20').name).toBe('sheet');
    expect(seasonFor('2027-03-01').name).toBe('boshonto');
    expect(seasonFor('2026-06-14').daysLeft).toBe(1);
    expect(seasonFor('2026-11-10').id).toBe('1433-hemonto');
  });

  it('every challenge points at a real event and a fair goal', () => {
    for (const def of [...DAILY_CHALLENGES, ...WEEKLY_CHALLENGES]) {
      if (def.eventId) {
        const event = EVENT_BY_ID.get(def.eventId);
        expect(event, def.id).toBeDefined();
        expect(GHOST.skipModes.includes((event as NonNullable<typeof event>).mode) && def.rank === 'time', def.id).toBe(false);
        if (def.goal.kind === 'medal') expect(event?.medals, def.id).toBeDefined();
      } else {
        expect(['escape', 'photo']).toContain(def.goal.kind);
      }
      expect(CHALLENGE_BY_ID.get(def.id)).toBe(def);
    }
  });
});

describe('courses and the leaderboard floor', () => {
  const network = new RoadNetwork();

  it('never asks for a time faster than the road allows, and the floor is below any real run', () => {
    for (const event of RACE_EVENTS) {
      if (event.mode === 'takedown') continue;
      const ids = event.course?.nodes ?? event.gates ?? [];
      const course = RaceCourse.fromNodes(network, ids, event.course?.loop ?? false);
      const real = event.gates ? course.lapLength : course.lapLength * (event.laps ?? 1);
      expect(straightLineDistance(event) * LEADERBOARD.straightLineShare, event.id).toBeLessThanOrEqual(real);
    }
    for (const def of [...DAILY_CHALLENGES, ...WEEKLY_CHALLENGES]) {
      if (def.goal.kind !== 'pace' || !def.eventId) continue;
      const event = EVENT_BY_ID.get(def.eventId) as NonNullable<ReturnType<typeof EVENT_BY_ID.get>>;
      const course = RaceCourse.fromNodes(network, event.course?.nodes ?? [], event.course?.loop ?? false);
      const distance = course.lapLength * (event.laps ?? 1);
      const seconds = paceSeconds(def.goal, distance) as number;
      console.log(`${def.id}: ${event.id} ${Math.round(distance)} m at ${def.goal.kmh} km/h = ${seconds} s`);
      expect(seconds).toBeGreaterThan(20);
      // The goal must be slower than what the board would call impossible.
      expect(distance / seconds).toBeLessThan(LEADERBOARD.maxAverageSpeed);
    }
  });
});

describe('challenge rules and the season pass', () => {
  const pace = CHALLENGE_BY_ID.get('borshaDash') as NonNullable<ReturnType<typeof CHALLENGE_BY_ID.get>>;
  const drift = CHALLENGE_BY_ID.get('wetDrift') as NonNullable<ReturnType<typeof CHALLENGE_BY_ID.get>>;

  it('judges pace, medal and points goals', () => {
    const distance = 2000;
    const allowed = paceSeconds(pace.goal, distance) as number;
    expect(judgeRun(pace, { completedCleanly: true, timeMs: allowed * 1000 - 1, medal: 0, score: 0 }, distance)).toEqual({ met: true, value: Math.round(allowed * 1000 - 1) });
    expect(judgeRun(pace, { completedCleanly: true, timeMs: allowed * 1000 + 500, medal: 0, score: 0 }, distance).met).toBe(false);
    expect(judgeRun(pace, { completedCleanly: false, timeMs: 1000, medal: 3, score: 0 }, distance)).toEqual({ met: false, value: null });
    expect(judgeRun(drift, { completedCleanly: true, timeMs: 80000, medal: 2, score: 6000 }, 0)).toEqual({ met: true, value: 6000 });
  });

  it('pays a challenge once, and only a few attempts earn points', () => {
    const career = createCareer();
    const key = '2026-11-10:wetDrift';
    const first = recordChallenge(career, drift, key, { met: true, value: 6000 });
    expect(first.firstClear).toBe(true);
    expect(first.xp).toBe(drift.xp + 40);
    expect(career.cash).toBe(createCareer().cash + drift.cash);
    const again = recordChallenge(career, drift, key, { met: true, value: 5000 });
    expect(again.firstClear).toBe(false);
    expect(again.newBest).toBe(false);
    for (let i = 0; i < PAID_ATTEMPTS; i++) recordChallenge(career, drift, key, { met: false, value: null });
    expect(recordChallenge(career, drift, key, { met: false, value: null }).xp).toBe(0);
    expect(career.challenges[key].best).toBe(6000);
    pruneChallenges(career, ['2026-11-11:jamDaily']);
    expect(career.challenges[key]).toBeUndefined();
  });

  it('fills tiers, gives each reward once, and keeps unlocks across seasons', () => {
    const career = createCareer();
    ensureSeason(career, '1433-hemonto');
    expect(tierFor(SEASON.xpPerTier * 4.5)).toBe(4);
    addSeasonXp(career, SEASON.xpPerTier * 5);
    expect(claimableTiers(career)).toEqual([1, 2, 3, 4, 5]);
    const before = career.cash;
    expect(claimTier(career, 'hemonto', 1)).toEqual({ kind: 'cash', amount: 800 });
    expect(career.cash).toBe(before + 800);
    expect(claimTier(career, 'hemonto', 1)).toBeNull();
    expect(claimTier(career, 'hemonto', 6)).toBeNull();
    expect(claimTier(career, 'hemonto', 5)?.kind).toBe('colour');
    expect(career.unlocks.colours.length).toBe(1);
    expect(ensureSeason(career, '1433-sheet')).toBe(true);
    expect(career.season.xp).toBe(0);
    expect(career.unlocks.colours.length).toBe(1);
  });
});

describe('leaderboard rules', () => {
  const now = Date.UTC(2026, 10, 10, 8, 0);
  const event = EVENT_BY_ID.get('avenueTrial') as NonNullable<ReturnType<typeof EVENT_BY_ID.get>>;
  const start = NODES.find((node) => node.id === (event.course?.nodes ?? [])[0]) as (typeof NODES)[number];
  const spec = parseBoard('event:avenueTrial', now) as NonNullable<ReturnType<typeof parseBoard>>;
  const seconds = Math.ceil(spec.min / 1000) + 12;

  function post(store: MemoryStore, body: unknown, ip = '10.0.0.1'): Promise<Response> {
    return handleLeaderboard(new Request('http://x/api/leaderboard', { method: 'POST', body: JSON.stringify(body) }), { store, now: () => now, clientIp: ip });
  }

  function run(clientId: string, extraSeconds = 0, name = 'চালক'): Record<string, unknown> {
    const time = seconds + extraSeconds;
    const ghost = encodeGhost(straightGhost('avenueTrial', 'bulbuli', time, 25, start.x, start.z));
    return { board: 'event:avenueTrial', name, value: time * 1000, carId: 'bulbuli', clientId, ghost };
  }

  it('knows which boards exist today', () => {
    expect(parseBoard('event:takedown', now)).toBeNull();
    expect(parseBoard('event:firstTakedown', now)).toBeNull();
    expect(parseBoard('event:nope', now)).toBeNull();
    const today = challengeDay(new Date(now));
    const yesterday = previousDay(today);
    const old = previousDay(yesterday);
    for (const day of [today, yesterday]) {
      const def = dailyChallengeFor(day);
      const board = parseBoard(`daily:${day}:${def.id}`, now);
      if (def.rank === 'none') expect(board).toBeNull();
      else expect(board?.order).toBe(def.rank);
    }
    expect(parseBoard(`daily:${old}:${dailyChallengeFor(old).id}`, now)).toBeNull();
    const wrong = DAILY_CHALLENGES.find((def) => def.id !== dailyChallengeFor(today).id) as (typeof DAILY_CHALLENGES)[number];
    expect(parseBoard(`daily:${today}:${wrong.id}`, now)).toBeNull();
    const week = challengeWeek(new Date(now));
    const weekly = weeklyChallengeFor(week);
    expect(parseBoard(`weekly:${week}:${weekly.id}`, now)?.order).toBe(weekly.rank);
    expect(parseBoard('daily:2026-11-10:dawnAvenue; drop table', now)).toBeNull();
  });

  it('cleans names and turns away rude ones', () => {
    expect(cleanName('  মিঠু​   ভাই ')).toEqual({ name: 'মিঠু ভাই' });
    expect(cleanName('a'.repeat(LEADERBOARD.nameMax + 1))).toEqual({ error: 'longName' });
    expect(cleanName('f u c k')).toEqual({ error: 'rudeName' });
    expect(cleanName(42)).toEqual({ error: 'badName' });
  });

  it('takes an honest run with its ghost, and gives the ghost back', async () => {
    const store = new MemoryStore();
    const response = await post(store, run('client-aaaaaaaa'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { rank: number; entries: Array<{ id: string; ghost: boolean; name: string }> };
    expect(body.rank).toBe(1);
    expect(body.entries[0].ghost).toBe(true);
    expect(body.entries[0].name).toBe('চালক');
    expect(JSON.stringify(body)).not.toContain('client-aaaaaaaa');
    const ghost = await handleLeaderboard(new Request(`http://x/api/leaderboard?board=event:avenueTrial&ghost=${body.entries[0].id}`), { store, now: () => now, clientIp: '' });
    expect(decodeGhost(await ghost.json(), MAX_SAMPLES)?.eventId).toBe('avenueTrial');
    // Nothing kept says where the request came from.
    expect([...store.data.keys()].join(' ')).not.toContain('10.0.0.1');
  });

  it('turns away impossible, ghostless and mismatched runs', async () => {
    const store = new MemoryStore();
    const tooFast = { ...run('client-bbbbbbbb'), value: spec.min - 1000 };
    expect((await post(store, tooFast)).status).toBe(422);
    const noGhost = { ...run('client-bbbbbbbb'), ghost: undefined };
    expect(((await (await post(store, noGhost)).json()) as { error: string }).error).toBe('noGhost');
    const mismatch = { ...run('client-bbbbbbbb'), value: (seconds + 5) * 1000 };
    expect(((await (await post(store, mismatch)).json()) as { error: string }).error).toBe('badGhost');
    const farStart = { ...run('client-bbbbbbbb'), ghost: encodeGhost(straightGhost('avenueTrial', 'bulbuli', seconds, 25, start.x + 900, start.z)) };
    expect((await post(store, farStart)).status).toBe(422);
    // One sample jumps 50 m in a twelfth of a second.
    const jumpy = straightGhost('avenueTrial', 'bulbuli', seconds, 25, start.x, start.z);
    jumpy.frames[10 * GHOST_STRIDE] += 50;
    const rocket = { ...run('client-bbbbbbbb'), ghost: encodeGhost(jumpy) };
    expect(((await (await post(store, rocket)).json()) as { error: string }).error).toBe('implausible');
    expect((await post(store, { ...run('client-bbbbbbbb'), name: 'shit' })).status).toBe(400);
    const garbled = await handleLeaderboard(new Request('http://x/api/leaderboard', { method: 'POST', body: '{not json' }), { store, now: () => now, clientIp: '10.0.0.1' });
    expect(garbled.status).toBe(400);
    expect((await post(store, 'just a string')).status).toBe(404);
  });

  it('keeps one place per player, and slows down a flood', async () => {
    const store = new MemoryStore();
    await post(store, run('client-cccccccc', 5), '10.0.0.2');
    await post(store, run('client-dddddddd', 2), '10.0.0.3');
    const better = (await (await post(store, run('client-cccccccc', 0), '10.0.0.2')).json()) as { rank: number; total: number; improved: boolean };
    expect(better).toMatchObject({ rank: 1, total: 2, improved: true });
    const worse = (await (await post(store, run('client-cccccccc', 9), '10.0.0.2')).json()) as { rank: number; improved: boolean };
    expect(worse).toMatchObject({ rank: 1, improved: false });
    let last = 200;
    for (let i = 0; i < LEADERBOARD.rateMax + 1; i++) last = (await post(store, run('client-eeeeeeee', 3), '10.0.0.9')).status;
    expect(last).toBe(429);
  });
});

describe('banter writer rules', () => {
  it('only asks for lines on offer', () => {
    expect(parseBanterRequest({ kind: 'taunt', topic: 'passed', rivalId: 'mithu', locale: 'bn' })).not.toBeNull();
    expect(parseBanterRequest({ kind: 'taunt', topic: 'passed', rivalId: 'nobody', locale: 'bn' })).toBeNull();
    expect(parseBanterRequest({ kind: 'radio', topic: 'advert', locale: 'bn' })).toBeNull();
    expect(parseBanterRequest({ kind: 'radio', topic: 'heat3', locale: 'fr' })).toBeNull();
  });

  it('writes a brief with the rules and the voice, and never the player', () => {
    const prompt = buildPrompt({ kind: 'taunt', topic: 'passed', rivalId: 'mithu', locale: 'bn' });
    expect(prompt.system).toContain('No religion or politics');
    expect(prompt.system).toContain('Bengali script');
    expect(prompt.user).toContain('overtaken');
    expect(prompt.user.length).toBeLessThan(2000);
  });

  it('throws away lines that break the rules', () => {
    expect(cleanLine('"ধরতে পারলে না তো, ভাই!"\nTranslation: ...', 'bn')).toBe('ধরতে পারলে না তো, ভাই!');
    expect(cleanLine('ওকে bro, চলো', 'bn')).toBeNull();
    expect(cleanLine('এই বাল', 'bn')).toBeNull();
    expect(cleanLine('সরকার তোমায় ধরবে', 'bn')).toBeNull();
    expect(cleanLine('ক'.repeat(BANTER.maxChars + 1), 'bn')).toBeNull();
    expect(cleanLine('Catch me if you can!', 'en')).toBe('Catch me if you can!');
    expect(cleanLine('Pray to god you win', 'en')).toBeNull();
  });

  it('says when it is not set up, uses the writer when it is, and stops at the daily cap', async () => {
    const body = JSON.stringify({ kind: 'radio', topic: 'rainStart', locale: 'bn' });
    const make = (): Request => new Request('http://x/api/banter', { method: 'POST', body });
    const store = new MemoryStore();
    expect((await handleBanter(make(), { store, now: () => 0, clientIp: '1', write: null })).status).toBe(503);
    let asked = 0;
    const write = async (): Promise<string> => {
      asked++;
      return 'বৃষ্টি নামল, চাকা সামলে!';
    };
    const ok = await handleBanter(make(), { store, now: () => 0, clientIp: '1', write });
    expect(await ok.json()).toEqual({ text: 'বৃষ্টি নামল, চাকা সামলে!' });
    expect(asked).toBe(1);
    const bad = await handleBanter(make(), { store, now: () => 0, clientIp: '2', write: async () => 'okay rain' });
    expect(bad.status).toBe(502);
    await store.set(`banter-day/${new Date(0).toISOString().slice(0, 10)}`, BANTER.dailyCap);
    expect((await handleBanter(make(), { store, now: () => 0, clientIp: '3', write })).status).toBe(429);
  });
});

describe('friends relay', () => {
  let relay: RelayHandle;
  beforeAll(async () => {
    relay = await startRelay({ port: 0 });
  });
  afterAll(async () => {
    await relay.close();
  });

  interface Client {
    socket: WebSocket;
    messages: Array<Record<string, unknown>>;
    next(type: string): Promise<Record<string, unknown>>;
    send(message: unknown): void;
  }

  function client(): Promise<Client> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${relay.port}`);
      const messages: Array<Record<string, unknown>> = [];
      const waiting: Array<{ type: string; done: (message: Record<string, unknown>) => void }> = [];
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as Record<string, unknown>;
        const index = waiting.findIndex((item) => item.type === message.t);
        if (index >= 0) waiting.splice(index, 1)[0].done(message);
        else messages.push(message);
      });
      socket.addEventListener('error', () => reject(new Error('socket error')));
      socket.addEventListener('open', () =>
        resolve({
          socket,
          messages,
          send: (message) => socket.send(JSON.stringify(message)),
          next: (type) => {
            const index = messages.findIndex((message) => message.t === type);
            if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
            return new Promise((done) => waiting.push({ type, done }));
          },
        }),
      );
    });
  }

  it('opens a room, lets friends in, passes cars on, and starts everyone together', async () => {
    const host = await client();
    const friend = await client();
    const watcher = await client();
    host.send({ t: 'hello', name: 'মিঠু', car: 'bulbuli' });
    host.send({ t: 'create' });
    const joined = await host.next('joined');
    const code = joined.code as string;
    expect(code).toMatch(new RegExp(`^[${RELAY_LIMITS.codeAlphabet}]{${RELAY_LIMITS.codeLength}}$`));
    friend.send({ t: 'hello', name: 'সাদিয়া', car: 'tiktiki' });
    friend.send({ t: 'join', code: code.toLowerCase(), spectate: false });
    await friend.next('joined');
    watcher.send({ t: 'join', code, spectate: true });
    await watcher.next('joined');

    host.send({ t: 'state', s: [1, 2, 3, 0, 0, 0, 1, 20, 50] });
    const state = await friend.next('state');
    expect(state.s).toEqual([1, 2, 3, 0, 0, 0, 1, 20, 50]);
    expect((await watcher.next('state')).id).toBe(state.id);

    friend.send({ t: 'start', eventId: 'goliCircuit' });
    expect((await friend.next('error')).code).toBe('notHost');
    host.send({ t: 'start', eventId: 'goliCircuit' });
    for (const each of [host, friend, watcher]) expect((await each.next('go')).eventId).toBe('goliCircuit');

    friend.send({ t: 'finish', ms: 61234 });
    expect((await host.next('finish')).ms).toBe(61234);
    // Watchers cannot pretend to race.
    watcher.send({ t: 'finish', ms: 1 });
    watcher.send({ t: 'state', s: [0, 0, 0, 0, 0, 0, 1, 0, 0] });
    host.send({ t: 'join', code: 'ZZZZ', spectate: false });
    expect((await host.next('error')).code).toBe('noRoom');
    for (const each of [host, friend, watcher]) each.socket.close();
  });

  it('cuts off a connection that floods it', async () => {
    const flood = await client();
    const closed = new Promise<number>((resolve) => flood.socket.addEventListener('close', (event) => resolve(event.code)));
    for (let i = 0; i < RELAY_LIMITS.maxMessagesPerSecond + 5; i++) flood.send({ t: 'hello', name: 'x' });
    expect(await closed).toBe(1008);
  });

  it('works with the game’s own connection class', async () => {
    const a = new NetSession();
    const b = new NetSession();
    expect(await a.connect(`ws://127.0.0.1:${relay.port}`, 'এক', 'bulbuli')).toBe(true);
    expect(await b.connect(`ws://127.0.0.1:${relay.port}`, 'দুই', 'bulbuli')).toBe(true);
    const rosterSeen = new Promise<void>((resolve) => {
      a.onRoster = () => {
        if (a.peers.length === 2) resolve();
      };
    });
    a.createRoom();
    await new Promise<void>((resolve) => {
      const check = (): void => (a.roomCode ? resolve() : void setTimeout(check, 10));
      check();
    });
    b.joinRoom(a.roomCode as string, false);
    await rosterSeen;
    expect(a.isHost).toBe(true);
    expect(b.isHost).toBe(false);
    const got = new Promise<number[]>((resolve) => {
      b.onState = (_id, state) => resolve(state);
    });
    a.sendState(1000, [10.123456, 1, -5, 0, 0.7071, 0, 0.7071, 33.3, 120]);
    expect(await got).toEqual([10.12, 1, -5, 0, 0.7071, 0, 0.7071, 33.3, 120]);
    a.close();
    b.close();
  });
});

describe('controls and machines', () => {
  it('tilt has a dead zone and a full lock', () => {
    expect(TiltInput.steerFor(1)).toBe(0);
    expect(TiltInput.steerFor(-60)).toBe(-1);
    expect(TiltInput.steerFor(14)).toBeGreaterThan(0.4);
    expect(TiltInput.steerFor(14)).toBeLessThan(0.6);
  });

  it('starts each machine on a sensible preset', () => {
    const facts = (renderer: string, mobile = false, memory = 8, cores = 8) => ({ renderer, mobile, memory, cores });
    expect(classifyGpu(facts('angle (google, swiftshader)'))).toBe('low');
    expect(classifyGpu(facts('angle (nvidia, nvidia geforce rtx 4070 direct3d11)'))).toBe('ultra');
    expect(classifyGpu(facts('angle (nvidia, nvidia geforce gtx 1650 direct3d11)'))).toBe('high');
    expect(classifyGpu(facts('angle (intel, intel(r) uhd graphics 620 direct3d11)'))).toBe('medium');
    expect(classifyGpu(facts('angle (intel, intel(r) uhd graphics 620 direct3d11)', false, 4))).toBe('low');
    expect(classifyGpu(facts('adreno (tm) 740', true, 8))).toBe('medium');
    expect(classifyGpu(facts('mali-g52', true, 4))).toBe('low');
    expect(classifyGpu(facts(''))).toBe('medium');
  });

  it('keeps a colour set for every kind of colour vision', () => {
    for (const set of Object.values(MARKER_COLOURS)) {
      for (const value of Object.values(set)) expect(value).toMatch(/^#[0-9a-f]{6}$/);
      expect(set.policeA).not.toBe(set.policeB);
    }
  });
});
