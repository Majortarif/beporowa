/**
 * Runs the চ্যালেঞ্জ board: today's and this week's challenge, the two roam challenges
 * (জ্যাম থেকে পালাও and the photo hunt), the season pass, and what every finished run is worth.
 */

import type { ChallengeDef, SkyConditions } from '../config/challenges';
import { SEASON } from '../config/challenges';
import { EVENT_BY_ID } from '../config/race-events';
import type { EventBus } from '../core/events';
import type { FinishedRun, RaceStartOptions } from '../game/race-director';
import { formatInteger, formatLapTime, formatNumber, localizeDigits, t, tList } from '../i18n';
import { getCareer, saveCareer } from '../save/career';
import type { ResultExtra } from '../ui/race-results';
import { challengeDay, challengeWeek, dailyChallengeFor, paceSeconds, seasonFor, weeklyChallengeFor, wordIndexFor, type SeasonInfo } from './challenge-calendar';
import { judgeRun, pruneChallenges, recordChallenge, type ChallengeVerdict } from './challenge-rules';
import { addSeasonXp, claimTier, claimableTiers, ensureSeason, tierFor, xpToNextTier } from './season';

export type ChallengeSlot = 'daily' | 'weekly';

/** What the challenges need from the rest of the game. */
export interface ChallengeHost {
  startEvent(eventId: string, options: RaceStartOptions): void;
  setConditions(sky: SkyConditions | null): void;
  /** @returns false if the police cannot come, as in আড্ডা mode */
  summonPolice(stars: number): boolean;
  setTraffic(share: number): void;
  routeTo(poi: string): void;
  clearRoute(): void;
  poiPosition(poi: string): { x: number; z: number } | null;
  /** Metres of a whole race, for pace goals. */
  eventDistance(eventId: string): number;
  /** Closes the board and drives. */
  drive(): void;
  toast(text: string): void;
  phone(text: string, seconds: number): void;
  isRacing(): boolean;
}

/** A finished, ranked challenge run, for the leaderboard to hear about. */
export interface ScoredRun {
  boardKey: string;
  def: ChallengeDef;
  value: number;
  run: FinishedRun | null;
}

interface RoamRun {
  def: ChallengeDef;
  slot: ChallengeSlot;
  key: string;
  clock: number;
  /** For the escape: the police have arrived. */
  chased: boolean;
}

export class ChallengeDirector {
  /** Told of each ranked run, so the leaderboard can take it. */
  onScored: ((run: ScoredRun) => void) | null = null;
  /** Told whenever the board's numbers change. */
  onChange: (() => void) | null = null;
  private roam: RoamRun | null = null;
  private readonly chip: HTMLElement;
  private chipTimer = 0;

  constructor(
    bus: EventBus,
    uiRoot: HTMLElement,
    private readonly host: ChallengeHost,
  ) {
    this.chip = document.createElement('div');
    this.chip.className = 'challenge-chip plate plate-indigo';
    this.chip.setAttribute('role', 'status');
    uiRoot.appendChild(this.chip);
    bus.on('pursuitEscaped', () => this.onEscaped());
    bus.on('pursuitBusted', () => this.failRoam('challenge.failBusted'));
    bus.on('heatLevel', ({ stars }) => {
      if (this.roam && stars > 0) this.roam.chased = true;
    });
    this.refreshSeason();
  }

  // ---------- What is on ----------

  get today(): string {
    return challengeDay(new Date());
  }

  get week(): string {
    return challengeWeek(new Date());
  }

  defFor(slot: ChallengeSlot): ChallengeDef {
    return slot === 'daily' ? dailyChallengeFor(this.today) : weeklyChallengeFor(this.week);
  }

  /** day:id or week:id, which is also the save's and the leaderboard's key. */
  keyFor(slot: ChallengeSlot): string {
    const def = this.defFor(slot);
    return slot === 'daily' ? `${this.today}:${def.id}` : `${this.week}:${def.id}`;
  }

  get season(): SeasonInfo {
    return seasonFor(this.today);
  }

  /** Starts a new season in the save if one has begun, and forgets old challenge records. */
  refreshSeason(): void {
    const career = getCareer();
    if (ensureSeason(career, this.season.id)) saveCareer();
    pruneChallenges(career, [this.keyFor('daily'), this.keyFor('weekly')]);
  }

  /** The word of the day, as "word — meaning". */
  get wordOfDay(): string {
    const words = tList('challenge.words');
    return words[wordIndexFor(this.today, words.length)] ?? '';
  }

  get activeRoam(): ChallengeDef | null {
    return this.roam?.def ?? null;
  }

  // ---------- Words for the board ----------

  goalText(def: ChallengeDef): string {
    const goal = def.goal;
    switch (goal.kind) {
      case 'pace': {
        const seconds = def.eventId ? paceSeconds(goal, this.host.eventDistance(def.eventId)) : null;
        return t('challenge.goal.pace', { kmh: formatInteger(goal.kmh), time: seconds !== null ? formatLapTime(seconds * 1000) : '' });
      }
      case 'medal':
        return t('challenge.goal.medal', { medal: t(`race.medal.${goal.medal}`) });
      case 'score':
        return t('challenge.goal.score', { points: formatNumber(goal.points) });
      case 'escape':
        return t('challenge.goal.escape', { stars: localizeDigits(String(goal.stars)), seconds: formatInteger(goal.seconds) });
      case 'photo':
        return t('challenge.goal.photo', { place: t(`city.poi.${goal.poi}`) });
    }
  }

  skyText(def: ChallengeDef): string {
    const parts: string[] = [];
    const sky = def.sky;
    if (sky?.time) parts.push(t(`settings.time${sky.time[0].toUpperCase()}${sky.time.slice(1)}`));
    if (sky?.weather) parts.push(t(`settings.weather${sky.weather[0].toUpperCase()}${sky.weather.slice(1)}`));
    if (def.traffic && def.traffic > 1) parts.push(t('challenge.heavyTraffic'));
    return parts.join(' · ');
  }

  titleText(def: ChallengeDef): string {
    return def.eventId ? t(`race.event.${def.eventId}.name`) : t(`challenge.def.${def.id}`);
  }

  bestText(def: ChallengeDef, best: number | null): string {
    if (best === null) return '';
    return def.rank === 'score' ? formatNumber(best) : formatLapTime(best);
  }

  // ---------- Starting ----------

  /** Starts a challenge. @returns false if it could not start */
  start(slot: ChallengeSlot): boolean {
    const def = this.defFor(slot);
    const key = this.keyFor(slot);
    this.cancelRoam();
    if (def.eventId) {
      if (!EVENT_BY_ID.has(def.eventId)) return false;
      this.host.startEvent(def.eventId, { kind: 'challenge', challengeId: `${slot}|${key}`, conditions: def.sky, traffic: def.traffic, ghost: { kind: 'best' } });
      return true;
    }
    if (this.host.isRacing()) return false;
    if (def.goal.kind === 'escape') {
      if (!this.host.summonPolice(def.goal.stars)) {
        this.host.toast(t('challenge.noPoliceInAdda'));
        return false;
      }
      if (def.traffic) this.host.setTraffic(def.traffic);
    }
    this.host.setConditions(def.sky ?? null);
    if (def.goal.kind === 'photo') this.host.routeTo(def.goal.poi);
    this.roam = { def, slot, key, clock: 0, chased: false };
    this.host.drive();
    this.host.phone(t(`challenge.begin.${def.goal.kind}`, { goal: this.goalText(def) }), 8);
    this.onChange?.();
    return true;
  }

  /** Gives up on a roam challenge. */
  cancelRoam(): void {
    if (!this.roam) return;
    this.endRoam();
  }

  private endRoam(): void {
    const roam = this.roam;
    this.roam = null;
    if (!roam) return;
    this.host.setConditions(null);
    this.host.setTraffic(1);
    if (roam.def.goal.kind === 'photo') this.host.clearRoute();
    this.chip.classList.remove('is-visible');
    this.onChange?.();
  }

  private failRoam(key: string): void {
    if (!this.roam || this.roam.def.goal.kind !== 'escape') return;
    this.finishRoam({ met: false, value: null });
    this.host.phone(t(key), 6);
  }

  private onEscaped(): void {
    const roam = this.roam;
    if (!roam || roam.def.goal.kind !== 'escape' || !roam.chased) return;
    const met = roam.clock <= roam.def.goal.seconds;
    const verdict: ChallengeVerdict = { met, value: Math.round(roam.clock * 1000) };
    const award = this.finishRoam(verdict);
    this.host.phone(t(met ? 'challenge.escaped' : 'challenge.escapedLate', { time: formatLapTime(roam.clock * 1000), reward: this.rewardText(award.xp, award.cash) }), 9);
  }

  /** A photo was taken: it counts if the car stands near the place asked for. */
  onPhoto(x: number, z: number): void {
    const roam = this.roam;
    if (!roam || roam.def.goal.kind !== 'photo') return;
    const place = this.host.poiPosition(roam.def.goal.poi);
    if (!place) return;
    const distance = Math.hypot(place.x - x, place.z - z);
    if (distance > roam.def.goal.radius) {
      this.host.toast(t('challenge.photoTooFar', { metres: formatInteger(Math.round(distance)) }));
      return;
    }
    const award = this.finishRoam({ met: true, value: null });
    this.host.phone(t('challenge.photoDone', { reward: this.rewardText(award.xp, award.cash) }), 9);
  }

  private finishRoam(verdict: ChallengeVerdict): { xp: number; cash: number } {
    const roam = this.roam;
    if (!roam) return { xp: 0, cash: 0 };
    const career = getCareer();
    const award = recordChallenge(career, roam.def, roam.key, verdict);
    addSeasonXp(career, award.xp);
    saveCareer();
    if (verdict.value !== null && roam.def.rank !== 'none' && verdict.met) {
      this.onScored?.({ boardKey: `${roam.slot}:${roam.key}`, def: roam.def, value: verdict.value, run: null });
    }
    this.endRoam();
    return award;
  }

  /** Runs once per frame while driving: the escape's clock and the chip on screen. */
  frame(dt: number): void {
    const roam = this.roam;
    if (!roam) return;
    if (this.host.isRacing()) {
      this.cancelRoam();
      return;
    }
    roam.clock += dt;
    const goal = roam.def.goal;
    if (goal.kind === 'escape' && roam.clock > goal.seconds + 60) {
      // Far past the limit: the challenge is lost, but the chase goes on.
      this.finishRoam({ met: false, value: null });
      this.host.phone(t('challenge.failTime'), 6);
      return;
    }
    this.chipTimer -= dt;
    if (this.chipTimer > 0) return;
    this.chipTimer = 0.5;
    this.chip.classList.add('is-visible');
    if (goal.kind === 'escape') {
      const left = Math.max(0, goal.seconds - roam.clock);
      this.chip.textContent = t('challenge.chipEscape', { seconds: formatInteger(Math.ceil(left)) });
      this.chip.dataset.state = left > 0 ? 'on' : 'late';
    } else if (goal.kind === 'photo') {
      this.chip.textContent = t('challenge.chipPhoto', { place: t(`city.poi.${goal.poi}`) });
      this.chip.dataset.state = 'on';
    }
  }

  // ---------- Finished races ----------

  rewardText(xp: number, cash: number): string {
    const parts = [t('challenge.xp', { xp: formatNumber(xp) })];
    if (cash > 0) parts.push(t('hud.money', { cash: formatNumber(cash) }));
    return parts.join(' · ');
  }

  /** Every finished run passes through here: challenges are judged, and the season gets its points. */
  onRunFinished(run: FinishedRun): ResultExtra | null {
    const career = getCareer();
    this.refreshSeason();
    const outcome = run.outcome;
    const facts: Array<[string, string]> = [];
    let title: string | undefined;
    let xp = 0;

    if (run.kind === 'challenge' && run.options.challengeId) {
      const [slot, key] = run.options.challengeId.split('|') as [ChallengeSlot, string];
      const def = this.defFor(slot);
      // A run that started yesterday still counts for yesterday's challenge, if it was the same.
      if (key.endsWith(`:${def.id}`) && def.eventId === outcome.event.id) {
        const verdict = judgeRun(def, { completedCleanly: outcome.failure === 'none', timeMs: outcome.timeMs, medal: outcome.medal, score: outcome.score }, this.host.eventDistance(def.eventId));
        const award = recordChallenge(career, def, key, verdict);
        xp += award.xp;
        title = t(verdict.met ? 'challenge.met' : 'challenge.missed');
        facts.push([t('challenge.goalLabel'), this.goalText(def)]);
        if (award.firstClear) facts.push([t('challenge.rewardLabel'), this.rewardText(def.xp, def.cash)]);
        if (award.newBest && verdict.value !== null) facts.push([t('challenge.bestLabel'), this.bestText(def, verdict.value)]);
        if (verdict.value !== null && def.rank !== 'none') {
          this.onScored?.({ boardKey: `${slot}:${key}`, def, value: verdict.value, run });
        }
      }
    } else if (run.kind === 'career' && outcome.failure === 'none') {
      xp += SEASON.xp.raceFinish + SEASON.xp.perMedal * outcome.medal;
    } else if (run.kind === 'ghostBattle' && run.ghost.ghostMs !== null && outcome.failure === 'none' && outcome.timeMs < run.ghost.ghostMs) {
      xp += SEASON.xp.ghostWin;
    }

    if (xp > 0) {
      const { before, after } = addSeasonXp(career, xp);
      facts.push([t('challenge.seasonLabel'), t('challenge.xp', { xp: formatNumber(xp) })]);
      if (after > before) facts.push([t('challenge.tierLabel'), t('challenge.tierReached', { tier: formatInteger(after) })]);
    }
    saveCareer();
    this.onChange?.();
    return facts.length > 0 || title ? { title, facts } : null;
  }

  /** Small things done in the city that still count for the season. */
  addRoamXp(kind: 'photo' | 'escape'): void {
    addSeasonXp(getCareer(), SEASON.xp[kind]);
    saveCareer();
  }

  // ---------- The season pass ----------

  seasonState(): { info: SeasonInfo; xp: number; tier: number; toNext: number; claimable: number[]; claimed: number[] } {
    const career = getCareer();
    this.refreshSeason();
    return { info: this.season, xp: career.season.xp, tier: tierFor(career.season.xp), toNext: xpToNextTier(career.season.xp), claimable: claimableTiers(career), claimed: [...career.season.claimed] };
  }

  /** Collects a tier. @returns words for what it gave, or null */
  claim(tier: number): string | null {
    const career = getCareer();
    const reward = claimTier(career, this.season.name, tier);
    if (!reward) return null;
    saveCareer();
    this.onChange?.();
    switch (reward.kind) {
      case 'cash':
        return t('season.gotCash', { cash: formatNumber(reward.amount) });
      case 'colour':
        return t('season.gotColour');
      case 'glow':
        return t('season.gotGlow');
      case 'stamp':
        return t('season.gotStamp', { season: t(`season.of.${this.season.name}`) });
    }
  }
}
