/** Bangla foundation, track layout and core-loop checks. Run: npm test */

import { Vector3, type BufferGeometry } from 'three';
import { describe, expect, it } from 'vitest';
import { FixedStepClock } from '../src/core/loop';
import { buildBodyGeometry, buildCabinGeometries } from '../src/vehicle/bulbuli-model';
import { EventBus } from '../src/core/events';
import bn from '../src/i18n/bn.json';
import en from '../src/i18n/en.json';
import flags from '../src/i18n/review-flags.json';
import { toBongabdo } from '../src/i18n/bongabdo';
import {
  formatBongabdoDate,
  formatInteger,
  formatLapTime,
  formatNumber,
  formatOrdinal,
  initI18n,
  t,
  tList,
} from '../src/i18n';
import { LapTimer } from '../src/race/lap-timer';
import { TUNING } from '../src/config/tuning';
import { TrackPath } from '../src/world/track-path';
import { SIGN_KEYS } from '../src/world/sign-keys';

function flatten(node: unknown, prefix = ''): string[] {
  if (Array.isArray(node) || typeof node !== 'object' || node === null) return [prefix];
  return Object.entries(node).flatMap(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key));
}

describe('i18n tables', () => {
  it('bn.json and en.json have exactly the same keys', () => {
    expect(flatten(bn).sort()).toEqual(flatten(en).sort());
  });

  it('lists have the same length in both languages', () => {
    expect(bn.tips.length).toBe(en.tips.length);
    expect(bn.calendar.months.length).toBe(12);
    expect(en.calendar.months.length).toBe(12);
  });

  it('every review flag points at a real key', () => {
    const keys = new Set(flatten(bn));
    for (const key of Object.keys(flags)) {
      if (key.startsWith('_')) continue;
      expect(keys.has(key), key).toBe(true);
    }
  });

  it('every painted sign has its text', () => {
    const keys = new Set(flatten(bn));
    for (const key of SIGN_KEYS) expect(keys.has(key), key).toBe(true);
  });

  it('Bangla strings contain no Latin words outside the allowed control labels', () => {
    const allowed = /^(controls\.(key|pad)\.|settings\.(digitsLatn|languageEn)$|app\.latinName$|boot\.failed$|dev\.copy$)/;
    const table = bn as unknown as Record<string, unknown>;
    const read = (key: string): unknown => key.split('.').reduce<unknown>((n, part) => (n as Record<string, unknown>)[part], table);
    for (const key of flatten(bn)) {
      if (allowed.test(key)) continue;
      const value = read(key);
      const text = (Array.isArray(value) ? value.join(' ') : String(value)).replace(/\{\w+\}/g, '');
      expect(/[A-Za-z]{2,}/.test(text), `${key}: ${text}`).toBe(false);
    }
  });
});

describe('Bangla number formatting', () => {
  it('uses Bangla digits and lakh grouping by default', () => {
    initI18n('bn', 'bn');
    expect(formatNumber(1234567)).toBe('১২,৩৪,৫৬৭');
    expect(formatInteger(205)).toBe('২০৫');
    expect(formatLapTime(83456)).toBe('০১:২৩.৪৫');
  });

  it('switches digits without switching language', () => {
    initI18n('bn', 'latn');
    expect(formatNumber(1234567)).toBe('12,34,567');
    expect(formatInteger(205)).toBe('205');
    expect(t('hud.lap', { lap: formatInteger(3) })).toBe('ল্যাপ 3');
  });

  it('gives Bangla ordinals', () => {
    initI18n('bn', 'bn');
    expect(formatOrdinal(1)).toBe('১ম');
    expect(formatOrdinal(2)).toBe('২য়');
    expect(formatOrdinal(4)).toBe('৪র্থ');
    expect(formatOrdinal(6)).toBe('৬ষ্ঠ');
    expect(formatOrdinal(11)).toBe('১১তম');
  });

  it('gives English ordinals and plurals', () => {
    initI18n('en', 'latn');
    expect(formatOrdinal(1)).toBe('1st');
    expect(formatOrdinal(12)).toBe('12th');
    expect(formatOrdinal(23)).toBe('23rd');
    expect(t('hud.points', { count: 1 })).toBe('1 point');
    expect(t('hud.points', { count: 5 })).toBe('5 points');
    initI18n('bn', 'bn');
    expect(t('hud.points', { count: 5 })).toBe('৫ পয়েন্ট');
  });

  it('reads lists', () => {
    initI18n('bn', 'bn');
    expect(tList('calendar.months')[0]).toBe('বৈশাখ');
  });
});

describe('Bengali calendar', () => {
  it('matches fixed national dates', () => {
    expect(toBongabdo(new Date(2026, 3, 14))).toEqual({ year: 1433, monthIndex: 0, day: 1 }); // Pohela Boishakh
    expect(toBongabdo(new Date(2025, 11, 16))).toEqual({ year: 1432, monthIndex: 8, day: 1 }); // 16 December is 1 Poush
    expect(toBongabdo(new Date(2026, 1, 21))).toEqual({ year: 1432, monthIndex: 10, day: 8 }); // 21 February is 8 Falgun
    expect(toBongabdo(new Date(2026, 2, 26))).toEqual({ year: 1432, monthIndex: 11, day: 12 }); // 26 March is 12 Choitro
  });

  it('handles the last day of the year, including leap years', () => {
    expect(toBongabdo(new Date(2026, 3, 13))).toEqual({ year: 1432, monthIndex: 11, day: 30 });
    expect(toBongabdo(new Date(2028, 3, 13))).toEqual({ year: 1434, monthIndex: 11, day: 30 });
  });

  it('formats in Bangla', () => {
    initI18n('bn', 'bn');
    expect(formatBongabdoDate(new Date(2026, 10, 5))).toBe('২০ কার্তিক ১৪৩৩ বঙ্গাব্দ');
  });
});

describe('fixed-step clock', () => {
  it('runs the right number of steps and keeps the remainder', () => {
    const clock = new FixedStepClock(1 / 60, 5);
    expect(clock.advance(1 / 30 + 0.001)).toBe(2);
    expect(clock.alpha).toBeGreaterThan(0);
    expect(clock.alpha).toBeLessThan(1);
  });

  it('drops the backlog after a stall', () => {
    const clock = new FixedStepClock(1 / 60, 5);
    expect(clock.advance(2)).toBe(5);
    expect(clock.advance(1 / 240)).toBe(0);
  });
});

describe('test road layout', () => {
  const track = new TrackPath(TUNING.world.sampleSpacing);

  it('has a useful length for a lap', () => {
    console.log(`track: ${track.length.toFixed(0)} m, ${track.count} samples, tightest corner ${track.minCornerRadius().toFixed(1)} m, clearance ${track.minSelfClearance(150).toFixed(1)} m`);
    expect(track.length).toBeGreaterThan(2500);
    expect(track.length).toBeLessThan(4500);
  });

  it('corners are wide enough for the road and shoulders', () => {
    expect(track.minCornerRadius()).toBeGreaterThan(TUNING.world.roadHalfWidth + TUNING.world.shoulderBaseWidth + 6);
  });

  it('never runs over itself', () => {
    expect(track.minSelfClearance(150)).toBeGreaterThan(40);
  });

  it('the drift yard stays clear of the road', () => {
    const plaza = TUNING.world.plaza;
    let closest = Infinity;
    for (let i = 0; i < track.count; i++) {
      const dx = Math.max(Math.abs(track.x(i) - plaza.centerX) - plaza.halfX, 0);
      const dz = Math.max(Math.abs(track.z(i) - plaza.centerZ) - plaza.halfZ, 0);
      closest = Math.min(closest, Math.hypot(dx, dz));
    }
    console.log(`drift yard clearance: ${closest.toFixed(1)} m`);
    expect(closest).toBeGreaterThan(20);
  });
});

describe('car model', () => {
  /** Share of triangles whose face normal points away from the car's centre line. */
  function outwardShare(geometry: BufferGeometry, centerY: number): number {
    const position = geometry.getAttribute('position');
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    const normal = new Vector3();
    const center = new Vector3();
    let total = 0;
    let outward = 0;
    for (let i = 0; i < position.count; i += 3) {
      a.fromBufferAttribute(position, i);
      b.fromBufferAttribute(position, i + 1);
      c.fromBufferAttribute(position, i + 2);
      normal.crossVectors(b.clone().sub(a), c.clone().sub(a));
      if (normal.lengthSq() < 1e-9) continue;
      center.copy(a).add(b).add(c).divideScalar(3);
      total++;
      if (normal.dot(new Vector3(center.x, center.y - centerY, center.z * 0.2)) > 0) outward++;
    }
    return outward / total;
  }

  it('body and cabin faces point outward, or the near side would vanish', () => {
    expect(outwardShare(buildBodyGeometry(), -0.1)).toBeGreaterThan(0.9);
    const cabin = buildCabinGeometries();
    expect(outwardShare(cabin.glass, 0.2)).toBeGreaterThan(0.9);
    expect(outwardShare(cabin.roof, 0.2)).toBeGreaterThan(0.9);
  });
});

describe('lap timer', () => {
  const track = new TrackPath(TUNING.world.sampleSpacing);

  /** Drives along the track at a fixed speed, returning finished lap times. */
  function drive(timer: LapTimer, from: number, samples: number, speed = 40): void {
    const dt = track.spacing / speed;
    for (let s = 0; s < samples; s++) {
      const i = track.wrap(from + s);
      timer.update(dt, track.x(i), track.z(i), track.tangents[i * 3] * speed, track.tangents[i * 3 + 2] * speed, speed);
    }
  }

  it('counts a full lap and keeps the best time', () => {
    const bus = new EventBus();
    const laps: number[] = [];
    bus.on('lapComplete', ({ timeMs }) => laps.push(timeMs));
    const start = track.wrap(-6);
    const timer = new LapTimer(track, bus, start, null);
    drive(timer, start, track.count + 12);
    expect(laps.length).toBe(1);
    expect(laps[0] / 1000).toBeCloseTo(track.length / 40, 0);
    expect(timer.bestMs).toBe(laps[0]);
  });

  it('does not count a short cut across the start line', () => {
    const bus = new EventBus();
    let laps = 0;
    bus.on('lapComplete', () => laps++);
    const start = track.wrap(-6);
    const timer = new LapTimer(track, bus, start, null);
    drive(timer, start, 12);
    // Teleporting back behind the line and crossing again skips the sectors.
    timer.update(0.1, track.x(start), track.z(start), 0, 40, 40);
    drive(timer, start, 12);
    expect(laps).toBe(0);
  });

  it('flags driving the wrong way', () => {
    const timer = new LapTimer(track, new EventBus(), 100, null);
    for (let s = 0; s < 80; s++) {
      const i = 100 - s;
      timer.update(0.05, track.x(i), track.z(i), -track.tangents[i * 3] * 30, -track.tangents[i * 3 + 2] * 30, 30);
    }
    expect(timer.wrongWay).toBe(true);
  });
});
