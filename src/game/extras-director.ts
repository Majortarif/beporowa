/**
 * Phase 7's pieces in one place: the চ্যালেঞ্জ board and season, the online leaderboard,
 * ghosts from other players, and racing friends. The game hands it what it needs once,
 * and calls it at a few moments: each frame, after each run, after each photo.
 */

import type { PerspectiveCamera, Scene } from 'three';
import { SEASON, type SkyConditions } from '../config/challenges';
import type { QualityPreset } from '../config/tuning';
import { ChallengeDirector, type ChallengeSlot, type ScoredRun } from '../challenges/challenge-director';
import type { EventBus } from '../core/events';
import { formatInteger, formatLapTime, formatNumber, formatOrdinal, localizeDigits, t } from '../i18n';
import { FriendsDirector } from '../online/friends-director';
import { LeaderboardClient, onlineName } from '../online/leaderboard-client';
import { getCareer } from '../save/career';
import { getSettings } from '../save/settings';
import { ChallengeScreen, type BoardView, type ChallengeCardView, type TierView } from '../ui/challenge-screen';
import type { ResultExtra, ResultRow } from '../ui/race-results';
import type { VehicleController } from '../vehicle/vehicle-controller';
import type { CityDirector } from './city-director';
import type { FinishedRun, RaceStartOptions } from './race-director';

export interface ExtrasHost {
  /** Shows one of the game's screens. */
  openScreen(name: 'challenges' | 'friends'): void;
  /** Closes every screen and drives. */
  drive(): void;
  toast(text: string): void;
  setConditions(sky: SkyConditions | null): void;
  enterSpectate(): void;
  leaveSpectate(): void;
  showingResults(): boolean;
  /** Where the photo's car stands. */
  carPosition(): { x: number; z: number };
}

export class ExtrasDirector {
  readonly challenges: ChallengeDirector;
  readonly friends: FriendsDirector;
  readonly screen: ChallengeScreen;
  private readonly leaderboard = new LeaderboardClient();
  private boardSlot: ChallengeSlot | null = null;
  private board: BoardView | null = null;
  /** Bumped per board request, so an old answer never overwrites a newer one. */
  private boardRequest = 0;
  private readonly friendPoints = new Float32Array(16);

  constructor(
    scene: Scene,
    preset: QualityPreset,
    uiRoot: HTMLElement,
    bus: EventBus,
    car: VehicleController,
    private readonly city: CityDirector,
    private readonly host: ExtrasHost,
  ) {
    const race = city.race;
    this.challenges = new ChallengeDirector(bus, uiRoot, {
      startEvent: (eventId, options) => {
        host.drive();
        race.startEvent(eventId, options);
      },
      setConditions: (sky) => host.setConditions(sky),
      summonPolice: (stars) => city.summonPolice(stars),
      setTraffic: (share) => {
        city.traffic.density = share;
      },
      routeTo: (poi) => city.setRoute(poi),
      clearRoute: () => city.clearDestination(),
      poiPosition: (poi) => city.poiPosition(poi),
      eventDistance: (eventId) => race.eventDistance(eventId),
      drive: () => host.drive(),
      toast: (text) => host.toast(text),
      phone: (text, seconds) => race.phone(t('challenge.phoneFrom'), text, seconds),
      isRacing: () => race.isActive,
    });
    this.challenges.onScored = (scored) => void this.submitChallenge(scored);
    this.challenges.onChange = () => this.refreshScreen();
    bus.on('pursuitEscaped', () => {
      if (!this.challenges.activeRoam) this.challenges.addRoamXp('escape');
    });

    this.screen = new ChallengeScreen({
      start: (slot) => {
        if (this.challenges.start(slot)) this.refreshScreen();
      },
      giveUp: () => {
        this.challenges.cancelRoam();
        this.refreshScreen();
      },
      showBoard: (slot) => void this.loadBoard(slot),
      raceGhost: (slot, entryId, name) => void this.raceBoardGhost(slot, entryId, name),
      claim: (tier) => {
        const text = this.challenges.claim(tier);
        if (text) host.toast(text);
        this.refreshScreen();
      },
      friends: () => this.openFriends(),
      close: () => host.drive(),
    });

    this.friends = new FriendsDirector(scene, preset, uiRoot, car, {
      startEvent: (eventId, options: RaceStartOptions) => {
        host.drive();
        race.startEvent(eventId, options);
      },
      closeScreen: () => host.drive(),
      enterSpectate: () => host.enterSpectate(),
      leaveSpectate: () => host.leaveSpectate(),
      racing: () => race.isActive,
      showingResults: () => host.showingResults(),
      setResultRows: (rows: ResultRow[]) => race.setResultRows(rows),
      toast: (text) => host.toast(text),
      carId: () => getCareer().selectedCar,
      progress: () => race.session.progress,
      defaultName: () => this.name(),
    });
  }

  private name(): string {
    return onlineName((digits) => t('online.defaultName', { digits: localizeDigits(digits) }));
  }

  // ---------- Screens ----------

  openChallenges(): void {
    this.challenges.refreshSeason();
    this.refreshScreen();
    this.host.openScreen('challenges');
    this.screen.focusFirst();
    if (this.boardSlot === null) void this.loadBoard('daily');
  }

  openFriends(): void {
    this.friends.refresh();
    this.host.openScreen('friends');
    this.friends.screen.focusFirst();
  }

  private cardFor(slot: ChallengeSlot): ChallengeCardView {
    const director = this.challenges;
    const def = director.defFor(slot);
    const record = getCareer().challenges[director.keyFor(slot)];
    const status: string[] = [];
    if (record?.done) status.push(t('challenge.doneToday'));
    if (record?.best != null) status.push(t('challenge.yourBest', { best: director.bestText(def, record.best) }));
    if (record && !record.done && record.attempts > 0) status.push(t('challenge.tries', { count: formatInteger(record.attempts) }));
    return {
      slot,
      mode: t(`challenge.mode.${def.mode}`),
      title: director.titleText(def),
      sky: director.skyText(def),
      brief: t(`challenge.modeBrief.${def.mode}`),
      goal: director.goalText(def),
      reward: t('challenge.rewardLine', { reward: director.rewardText(def.xp, def.cash) }),
      status: status.join(' · '),
      done: record?.done ?? false,
      running: director.activeRoam?.id === def.id,
    };
  }

  private rewardText(season: string, tier: number): string {
    const reward = SEASON.rewards(season as Parameters<typeof SEASON.rewards>[0])[tier - 1];
    if (!reward) return '';
    switch (reward.kind) {
      case 'cash':
        return t('hud.money', { cash: formatNumber(reward.amount) });
      case 'colour':
        return t('season.reward.colour');
      case 'glow':
        return t('season.reward.glow');
      case 'stamp':
        return t('season.reward.stamp');
    }
  }

  refreshScreen(): void {
    const state = this.challenges.seasonState();
    const tiers: TierView[] = [];
    for (let tier = 1; tier <= SEASON.tiers; tier++) {
      tiers.push({
        tier,
        label: formatInteger(tier),
        reward: this.rewardText(state.info.name, tier),
        state: state.claimed.includes(tier) ? 'claimed' : tier <= state.tier ? 'claimable' : 'locked',
      });
    }
    const stamps = getCareer().unlocks.stamps;
    this.screen.show({
      word: t('challenge.word', { word: this.challenges.wordOfDay }),
      cards: [this.cardFor('daily'), this.cardFor('weekly')],
      board: this.board,
      friends: true,
      season: {
        title: t('season.title', { season: t(`season.of.${state.info.name}`), year: localizeDigits(String(state.info.bongabdoYear)) }),
        days: t('season.daysLeft', { days: formatInteger(state.info.daysLeft) }),
        xpText:
          state.tier >= SEASON.tiers
            ? t('season.allTiers', { xp: formatNumber(state.xp) })
            : t('season.xpLine', { xp: formatNumber(state.xp), tier: formatInteger(state.tier), next: formatNumber(state.toNext) }),
        share: Math.min(1, state.xp / (SEASON.tiers * SEASON.xpPerTier)),
        tiers,
        stamps: stamps.length > 0 ? t('season.stamps', { list: stamps.map((id) => t(`season.name.${id.split('-')[1]}`) + ' ' + localizeDigits(id.split('-')[0])).join(' · ') }) : t('season.noStamps'),
      },
    });
  }

  // ---------- Leaderboards ----------

  private boardKey(slot: ChallengeSlot): string {
    return `${slot}:${this.challenges.keyFor(slot)}`;
  }

  private valueText(order: 'time' | 'score', value: number): string {
    return order === 'score' ? formatNumber(value) : formatLapTime(value);
  }

  private async loadBoard(slot: ChallengeSlot): Promise<void> {
    this.boardSlot = slot;
    const def = this.challenges.defFor(slot);
    const title = t('challenge.boardTitle', { name: this.challenges.titleText(def) });
    if (def.rank === 'none') {
      this.board = { slot, title, rows: [], note: t('challenge.noBoard'), ghosts: false };
      this.refreshScreen();
      return;
    }
    const request = ++this.boardRequest;
    this.board = { slot, title, rows: [], note: t('online.loading'), ghosts: false };
    this.refreshScreen();
    const answer = await this.leaderboard.board(this.boardKey(slot));
    if (request !== this.boardRequest) return;
    if (!answer.ok) {
      const record = getCareer().challenges[this.challenges.keyFor(slot)];
      const mine = record?.best != null ? t('online.offlineBest', { best: this.challenges.bestText(def, record.best) }) : '';
      this.board = { slot, title, rows: [], note: [t('online.offline'), mine].filter(Boolean).join(' '), ghosts: false };
    } else {
      const view = answer.value;
      this.board = {
        slot,
        title,
        rows: view.entries.map((entry) => ({ id: entry.id, rank: formatOrdinal(entry.rank), name: entry.name, value: this.valueText(view.order, entry.value), car: t(`car.${entry.carId}.name`), ghost: entry.ghost })),
        note: view.entries.length === 0 ? t('online.empty') : t('online.total', { count: formatInteger(view.total) }),
        ghosts: def.eventId !== undefined,
      };
    }
    this.refreshScreen();
  }

  private async raceBoardGhost(slot: ChallengeSlot, entryId: string, name: string): Promise<void> {
    const def = this.challenges.defFor(slot);
    if (!def.eventId) return;
    const track = await this.leaderboard.ghost(this.boardKey(slot), entryId);
    if (!track || track.eventId !== def.eventId) {
      this.host.toast(t('online.ghostMissing'));
      return;
    }
    this.host.drive();
    this.city.race.startEvent(def.eventId, { kind: 'challenge', challengeId: `${slot}|${this.challenges.keyFor(slot)}`, conditions: def.sky, traffic: def.traffic, ghost: { kind: 'track', track, label: t('ghost.tagNamed', { name }) } });
  }

  private async submitChallenge(scored: ScoredRun): Promise<void> {
    if (!getSettings().leaderboardUpload) return;
    const ghost = scored.run?.ghost.track ?? null;
    const answer = await this.leaderboard.submit(scored.boardKey, scored.value, getCareer().selectedCar, ghost, this.name());
    if (!answer.ok) {
      if (answer.reason === 'offline') this.host.toast(t('online.notSent'));
      else this.host.toast(t('online.refused'));
      return;
    }
    if (answer.value.rank !== null) this.city.race.phone(t('online.boardFrom'), t('online.rankNow', { rank: formatOrdinal(answer.value.rank), total: formatInteger(answer.value.total) }), 7);
    if (this.boardSlot !== null) void this.loadBoard(this.boardSlot);
  }

  /** Sends a clean run to its event's all-time board, quietly. */
  private async submitEventRun(run: FinishedRun): Promise<void> {
    const track = run.ghost.track;
    if (!getSettings().leaderboardUpload || !track || run.outcome.failure !== 'none' || run.kind === 'challenge') return;
    const answer = await this.leaderboard.submit(`event:${run.outcome.event.id}`, run.outcome.timeMs, track.carId, track, this.name());
    if (answer.ok && answer.value.improved && answer.value.rank !== null) {
      this.city.race.phone(t('online.boardFrom'), t('online.eventRank', { rank: formatOrdinal(answer.value.rank), event: t(`race.event.${run.outcome.event.id}.name`) }), 7);
    }
  }

  // ---------- Moments ----------

  runFinished(run: FinishedRun): ResultExtra | null {
    const fromChallenges = this.challenges.onRunFinished(run);
    const fromFriends = this.friends.onRunFinished(run);
    void this.submitEventRun(run);
    if (!fromChallenges && !fromFriends) return null;
    return {
      title: fromChallenges?.title ?? fromFriends?.title,
      subtitle: fromFriends?.subtitle ?? fromChallenges?.subtitle,
      facts: [...(fromChallenges?.facts ?? []), ...(fromFriends?.facts ?? [])],
      ghostBattle: fromFriends?.ghostBattle,
    };
  }

  onPhoto(): void {
    const at = this.host.carPosition();
    this.challenges.onPhoto(at.x, at.z);
  }

  /** Runs once per rendered frame. */
  frame(dt: number, nowMs: number, camera: PerspectiveCamera, width: number, height: number, driving: boolean): void {
    if (driving) this.challenges.frame(dt);
    this.friends.frame(nowMs, camera, width, height, driving);
    const count = this.friends.inRoom ? this.friends.remote.mapPoints(this.friendPoints) : 0;
    this.city.hud.minimap.setFriends(this.friendPoints, count);
  }
}
