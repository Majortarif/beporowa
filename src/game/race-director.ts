/**
 * Runs দ্য রিং: the board, flags in the city, the walk to the start line, the race itself,
 * the results, and what the rivals remember. The rules themselves live in RaceSession.
 */

import type { PerspectiveCamera, Scene } from 'three';
import type { AudioEngine } from '../audio/audio-engine';
import { CutsceneCamera } from '../camera/cutscene-camera';
import type { TimeLock, WeatherKind } from '../config/atmosphere';
import { EVENT_BY_ID, RACE_EVENTS, type RaceEventDef } from '../config/race-events';
import { RACE } from '../config/race-tuning';
import { RIVALS } from '../config/rivals';
import type { QualityPreset } from '../config/tuning';
import type { EventBus } from '../core/events';
import { clamp } from '../core/math';
import { formatLapTime, localizeDigits, t, tList } from '../i18n';
import type { Intent } from '../input/intent';
import type { PhysicsWorld } from '../physics/physics-world';
import { RaceCourse } from '../race/race-course';
import { RaceRender, type RaceFlag } from '../race/race-render';
import { RaceSession, type RaceOutcome } from '../race/race-session';
import { banter } from '../online/banter-client';
import { GhostDirector, eventKeepsGhost, loadBestGhost, type GhostChoice, type GhostOutcome } from '../ghost/ghost-director';
import type { GhostTrack } from '../ghost/ghost-track';
import { applyResult, currentTier, isUnlocked, type ResultChange } from '../race/ring-ladder';
import { playerPerformance } from '../progression/economy';
import { getCareer, resetCareer, saveCareer } from '../save/career';
import type { TrafficSystem } from '../traffic/traffic-system';
import { CutsceneOverlay } from '../ui/cutscene-overlay';
import { RaceHud, agentName } from '../ui/race-hud';
import { RaceResults, type ResultExtra, type ResultRow } from '../ui/race-results';
import { RingBoard } from '../ui/ring-board';
import type { Screens } from '../ui/screens';
import type { SpawnPose, VehicleController } from '../vehicle/vehicle-controller';
import type { RoadNetwork } from '../world/city/road-network';

/** Who a run is for: the Ring's ladder, a ghost, a challenge, or friends. Only the Ring changes the career. */
export type RunKind = 'career' | 'ghostBattle' | 'challenge' | 'friend';

/** The sky a run insists on. */
export interface RunConditions {
  time?: TimeLock;
  weather?: WeatherKind | 'blackout';
}

export interface RaceStartOptions {
  kind?: RunKind;
  ghost?: GhostChoice;
  conditions?: RunConditions;
  /** Traffic share instead of the event's own. */
  traffic?: number;
  /** Which challenge this run is for. */
  challengeId?: string;
  /** When the lights go out, on performance.now(), so friends start together. No cutscene then. */
  startAtMs?: number;
}

/** A finished run, for whoever wants to know: challenges, seasons, leaderboards, friends. */
export interface FinishedRun {
  kind: RunKind;
  outcome: RaceOutcome;
  ghost: GhostOutcome;
  options: RaceStartOptions;
}

/** What the race needs the rest of the game to do. */
export interface RaceHost {
  /** Puts the player's car at a pose, ready to drive, and hides the menus. */
  placeCar(pose: SpawnPose): void;
  /** Stops the world and shows a menu screen. */
  pauseFor(screen: 'ring' | 'raceResult'): void;
  /** Back to driving. */
  resume(): void;
  /** Whether the police are on the player right now. */
  policeActive(): boolean;
  /** Clears the police, for the start of a race. */
  clearPolice(): void;
  /** Calls the police in, wanting this many stars. */
  summonPolice(stars: number): void;
  /** Removes any GPS route. */
  clearGps(): void;
  /** A short slow-motion beat. */
  slowMoment(seconds: number, scale: number): void;
  /** A race has written its result into the career. */
  afterResult(change: ResultChange): void;
  /** The whole career has just been wiped. */
  careerReset(): void;
  /** A race can insist on the weather. Null lets it go again. */
  forceWeather(weather: 'monsoon' | null): void;
  /** Watches the last stretch of driving, and comes back to the results. */
  openReplay(): void;
  /** A run insists on an hour or a sky. Null gives the player's own settings back. */
  setConditions(conditions: RunConditions | null): void;
  /** A run is over. @returns anything extra the results should show */
  runFinished(run: FinishedRun): ResultExtra | null;
  /** Back to the challenge board, after a challenge run. */
  openChallenges(): void;
}

export class RaceDirector {
  readonly session: RaceSession;
  readonly cutscene = new CutsceneCamera();
  private readonly render: RaceRender;
  private readonly hud: RaceHud;
  private readonly overlay: CutsceneOverlay;
  private readonly board: RingBoard;
  private readonly results: RaceResults;
  private readonly flags: RaceFlag[] = [];
  private readonly startPoints = new Map<string, RaceFlag>();
  private readonly routeCache: number[] = [];
  readonly ghost: GhostDirector;
  private run: { kind: RunKind; options: RaceStartOptions } = { kind: 'career', options: {} };
  private lastOptions: RaceStartOptions = {};
  private frameCamera: PerspectiveCamera | null = null;
  private frameWidth = 1;
  private frameHeight = 1;
  /** A friend race waits for a set moment before its countdown. */
  private pendingStart: number | null = null;

  private lastEventId: string | null = null;
  private offered: string | null = null;
  private policeCalled = false;
  private resultShown = false;
  private needsFlagRefresh = true;
  private tipTimer = 6;

  constructor(
    scene: Scene,
    private readonly network: RoadNetwork,
    physics: PhysicsWorld,
    private readonly bus: EventBus,
    preset: QualityPreset,
    car: VehicleController,
    traffic: TrafficSystem,
    private readonly audio: AudioEngine,
    uiRoot: HTMLElement,
    screens: Screens,
    private readonly host: RaceHost,
  ) {
    this.session = new RaceSession(network, physics, bus, car, traffic, preset.raceOpponents);
    this.render = new RaceRender(scene, this.session, preset);
    this.ghost = new GhostDirector(scene, preset, car, uiRoot);
    this.hud = new RaceHud(uiRoot);
    this.overlay = new CutsceneOverlay(uiRoot);
    this.board = new RingBoard({
      startEvent: (id) => this.startEvent(id),
      close: () => this.host.resume(),
      setFreePlay: (value) => {
        getCareer().freePlay = value;
        saveCareer();
        this.needsFlagRefresh = true;
      },
      reset: () => {
        // The board keeps showing whichever career it was given, so hand it the new one.
        this.board.show(resetCareer(), null);
        this.needsFlagRefresh = true;
        this.host.careerReset();
      },
    });
    this.results = new RaceResults({
      retry: () => {
        if (this.lastEventId) this.startEvent(this.lastEventId, this.lastOptions);
      },
      board: () => {
        const kind = this.run.kind;
        this.endRace();
        if (kind === 'challenge') this.host.openChallenges();
        else this.openBoard();
      },
      ghostBattle: () => {
        if (this.lastEventId) void this.startGhostBattle(this.lastEventId);
      },
      city: () => {
        this.endRace();
        this.host.resume();
      },
      replay: () => this.host.openReplay(),
    });
    screens.attachExtra('ring', this.board.element);
    screens.attachExtra('raceResult', this.results.element);
    this.hud.onPrompt = () => this.acceptOffer();
    this.overlay.onSkip = () => this.cutscene.skip();
    this.cutscene.onRivalShot = () => this.onRivalShot();
    this.session.onTaunt = (rivalId, kind) => this.hud.showTaunt(rivalId, kind);
    this.buildStartPoints();
    this.bindEvents();
  }

  private bindEvents(): void {
    const { bus, hud, audio } = this;
    bus.on('raceCountdown', ({ step }) => {
      hud.showCount(step);
      this.render.setStartLamps(step);
      audio.playCountdown(step === 0);
    });
    bus.on('raceLaunch', ({ perfect }) => {
      hud.showBanner(t(perfect ? 'race.hud.perfectLaunch' : 'race.hud.earlyLaunch'), 1.6);
      if (perfect) audio.playNitroStart();
    });
    bus.on('raceShift', ({ perfect }) => {
      if (perfect) hud.showBanner(t('race.hud.perfectShift'), 0.8);
    });
    bus.on('raceGate', () => audio.playGate());
    bus.on('raceLap', ({ lap, seconds, last }) => {
      hud.showBanner(last ? t('race.hud.lastLap') : t('race.hud.lapDone', { lap: localizeDigits(String(lap)), time: formatLapTime(seconds * 1000) }), 2);
    });
    bus.on('raceLeg', ({ leg }) => {
      const id = this.session.event?.rivalRace;
      if (id) hud.showTaunt(id, leg === 1 ? 'leg1' : 'leg2');
      hud.showBanner(t('race.hud.legStart', { leg: localizeDigits(String(leg + 1)) }), 2.4);
    });
    bus.on('targetHit', ({ strength }) => audio.playImpact(strength));
    bus.on('targetDown', ({ left }) => {
      hud.showBanner(left > 0 ? t('race.hud.targetDown') : t('race.hud.allDown'), 1.8);
      this.host.slowMoment(RACE.takedown.slowMoSeconds, RACE.takedown.slowMoScale);
      audio.playClatter();
    });
    bus.on('cargoHit', () => hud.showBanner(t('race.hud.cargoHit'), 1));
    bus.on('raceFinished', ({ completed }) => {
      this.host.slowMoment(RACE.finish.coolDownSeconds, RACE.finish.slowMoScale);
      audio.playFinish(completed);
    });
  }

  /** Where every event begins, for the flags in the city. */
  private buildStartPoints(): void {
    for (const event of RACE_EVENTS) {
      const ids = event.course?.nodes ?? event.gates ?? ['b2', 'b3'];
      const course = RaceCourse.fromNodes(this.network, ids, event.course?.loop ?? false);
      const pose = course.gridPose(0);
      // The flag stands beside the road, on the driver's left.
      const half = course.startGate.halfWidth + 1.4;
      const leftX = Math.cos(pose.yaw);
      const leftZ = -Math.sin(pose.yaw);
      this.startPoints.set(event.id, {
        id: event.id,
        x: course.startGate.x + leftX * half,
        y: pose.y,
        z: course.startGate.z + leftZ * half,
        yaw: pose.yaw,
        rival: event.rivalRace !== undefined,
      });
    }
  }

  private refreshFlags(): void {
    this.needsFlagRefresh = false;
    this.flags.length = 0;
    const career = getCareer();
    for (const event of RACE_EVENTS) {
      if (!isUnlocked(event, career)) continue;
      const flag = this.startPoints.get(event.id);
      if (flag) this.flags.push(flag);
    }
    this.render.setFlags(this.flags);
  }

  get isActive(): boolean {
    return this.session.isActive;
  }

  /** How tense it is, from 0 to 1: it climbs toward the finish. */
  get tension(): number {
    return this.session.isActive ? this.session.playerShare : 0;
  }

  /** The lights are coming down, which is no moment for the radio. */
  get isCountingDown(): boolean {
    return this.session.phase === 'countdown';
  }

  /** A race is on offer at a flag right now. */
  get hasOffer(): boolean {
    return this.offered !== null;
  }

  /** A message on the phone in the corner. */
  phone(from: string, text: string, seconds: number): void {
    this.hud.showPhone(from, text, seconds);
  }

  /** Whether the police may run around right now. */
  get policeAllowed(): boolean {
    return !this.session.isActive || this.session.policeWanted > 0;
  }

  /** The event flags, for the full map. */
  get flagList(): readonly RaceFlag[] {
    return this.flags;
  }

  /** The race's course, for the minimap. */
  get routePoints(): readonly number[] {
    return this.routeCache;
  }

  /** The next place to reach, for the minimap. */
  get targetPoint(): { x: number; z: number } | null {
    const gate = this.session.nextGate;
    return this.session.isActive && gate.valid ? gate : null;
  }

  /** Doubled-up horn taps near a rival. @returns how many took offence */
  provoke(): number {
    return this.session.provokeRivals();
  }

  setHudVisible(visible: boolean): void {
    this.hud.setVisible(visible);
  }

  setReduceMotion(value: boolean): void {
    this.cutscene.setReduceMotion(value);
  }

  // ---------- The board ----------

  openBoard(): void {
    const blocked = this.host.policeActive() ? t('ring.policeBlock') : null;
    this.board.show(getCareer(), blocked);
    this.host.pauseFor('ring');
  }

  // ---------- Starting ----------

  private readonly distances = new Map<string, number>();

  /** Metres from the start line to the finish, for pace goals. Free-routed races count their gates in a line. */
  eventDistance(id: string): number {
    const cached = this.distances.get(id);
    if (cached !== undefined) return cached;
    const event = EVENT_BY_ID.get(id);
    if (!event) return 0;
    const ids = event.course?.nodes ?? event.gates ?? ['b2', 'b3'];
    const course = RaceCourse.fromNodes(this.network, ids, event.course?.loop ?? false);
    const distance = event.gates ? course.lapLength : course.lapLength * (event.laps ?? 1);
    this.distances.set(id, distance);
    return distance;
  }

  /** The kind of run going on, or last finished. */
  get runKind(): RunKind {
    return this.run.kind;
  }

  /**
   * Races a ghost alone on the road: this machine's best for the event, or one handed in.
   * @returns false if there was no ghost to race
   */
  async startGhostBattle(id: string, given?: { track: GhostTrack; label: string }): Promise<boolean> {
    const track = given?.track ?? (await loadBestGhost(id));
    if (!track) {
      this.hud.showBanner(t('ghost.none'), 2.4);
      return false;
    }
    this.startEvent(id, { kind: 'ghostBattle', ghost: { kind: 'track', track, label: given?.label ?? t('ghost.tagBest') } });
    return true;
  }

  startEvent(id: string, options: RaceStartOptions = {}): void {
    const event = EVENT_BY_ID.get(id);
    if (!event) return;
    if (this.session.isActive) this.session.end();
    this.render.clear();
    this.lastEventId = id;
    this.lastOptions = options;
    const kind = options.kind ?? 'career';
    this.run = { kind, options };
    this.policeCalled = false;
    this.resultShown = false;
    this.offered = null;
    this.hud.setPrompt(null);
    this.host.clearPolice();
    this.host.clearGps();
    this.host.forceWeather(options.conditions?.weather ? null : (event.weather ?? null));
    this.host.setConditions(options.conditions ?? null);
    this.ghost.prepare(event, options.ghost ?? (kind === 'friend' ? { kind: 'none' } : { kind: 'best' }));

    const pose = this.session.begin(id, getCareer().memory, playerPerformance(getCareer()), kind !== 'career');
    if (!this.session.solo) for (const rivalId of event.rivals) banter.warmRival(rivalId);
    if (options.traffic !== undefined) this.session.setTraffic(options.traffic);
    this.host.placeCar(pose);
    this.session.preStep(0, pose.position.x, pose.position.z, Math.sin(pose.yaw), Math.cos(pose.yaw));
    for (const agent of this.session.agents) agent.readTransform();
    this.render.prepare();
    this.render.setFlagsVisible(false);
    this.hud.setRacing(true);
    this.updateRoute(event);
    this.pendingStart = null;
    if (options.startAtMs !== undefined) {
      // Friends start on a shared moment, so there is no time for the cutscene.
      this.pendingStart = options.startAtMs;
      this.onCameraBack?.();
    } else {
      this.startCutscene(event, pose);
    }
  }

  private updateRoute(event: RaceEventDef): void {
    const course = this.session.course;
    this.routeCache.length = 0;
    // A maze race gives no path: finding one is the point.
    if (course && event.mode !== 'bazaarMaze' && event.mode !== 'takedown') {
      for (const value of course.mapPoints()) this.routeCache.push(value);
    }
  }

  private startCutscene(event: RaceEventDef, pose: SpawnPose): void {
    const rival = this.session.agents.find((agent) => agent.rivalId === event.rivalRace && agent.rivalId !== null);
    this.overlay.open(t(`race.mode.${event.mode}`), t(`race.event.${event.id}.name`), t(`race.rules.${event.mode}`));
    this.cutscene.begin(
      {
        playerX: pose.position.x,
        playerY: pose.position.y,
        playerZ: pose.position.z,
        fx: Math.sin(pose.yaw),
        fz: Math.cos(pose.yaw),
        rivalX: rival?.currX ?? 0,
        rivalY: rival?.currY ?? 0,
        rivalZ: rival?.currZ ?? 0,
        hasRival: rival !== undefined,
      },
      () => this.onCutsceneDone(),
    );
    this.audio.playCheer();
  }

  private onRivalShot(): void {
    const id = this.session.event?.rivalRace;
    if (id) this.overlay.speak(id, tList(`rival.${id}.intro`));
  }

  private onCutsceneDone(): void {
    this.overlay.close();
    this.session.startCountdown();
    this.onCameraBack?.();
  }

  /** Lets the game give the chase camera back. */
  onCameraBack: (() => void) | null = null;

  /** Skips the cutscene, if one is running. */
  skipCutscene(): void {
    this.cutscene.skip();
  }

  /** Takes up the race on offer at a flag. */
  acceptOffer(): boolean {
    if (!this.offered || this.session.isActive) return false;
    this.startEvent(this.offered);
    return true;
  }

  // ---------- Each step ----------

  filterIntent(source: Intent): Intent {
    return this.session.isActive ? this.session.filterIntent(source) : source;
  }

  preStep(dt: number, viewX: number, viewZ: number, viewFx: number, viewFz: number): void {
    this.session.preStep(dt, viewX, viewZ, viewFx, viewFz);
  }

  postStep(dt: number): void {
    this.session.postStep(dt);
    this.ghost.postStep(this.session);
    if (this.session.policeWanted > 0 && !this.policeCalled) {
      this.policeCalled = true;
      this.host.summonPolice(this.session.policeWanted);
    }
  }

  /** Runs once per frame while driving. */
  frame(dt: number, camera: PerspectiveCamera, width: number, height: number, playerX: number, playerZ: number, speed: number): void {
    this.frameCamera = camera;
    this.frameWidth = width;
    this.frameHeight = height;
    if (this.pendingStart !== null && performance.now() >= this.pendingStart - RACE.countdown.stepSeconds * 3000) {
      this.pendingStart = null;
      this.session.startCountdown();
    }
    if (this.needsFlagRefresh) this.refreshFlags();
    this.overlay.update(dt);
    this.hud.update(dt, this.session, camera, width, height, playerX, playerZ);

    if (this.session.isActive) {
      this.updateRivalSound(playerX, playerZ);
      if (this.session.phase === 'done' && !this.resultShown) this.showResults();
      return;
    }
    this.audio.updateRivalEngine(0, 0, 0);

    // Free roam: stop at a flag to be offered its race.
    this.tipTimer -= dt;
    if (this.tipTimer <= 0 && !getCareer().introSeen) {
      getCareer().introSeen = true;
      saveCareer();
      this.hud.showPhone(t('ring.phoneFrom'), t('ring.phoneWelcome'), 9);
    }
    this.updateOffer(playerX, playerZ, speed);
  }

  private updateOffer(x: number, z: number, speed: number): void {
    const config = RACE.markers;
    let found: string | null = null;
    if (speed * 3.6 < config.enterSpeedKmh && !this.host.policeActive()) {
      let best = config.enterRadius;
      for (const flag of this.flags) {
        const distance = Math.hypot(flag.x - x, flag.z - z);
        if (distance < best) {
          best = distance;
          found = flag.id;
        }
      }
    }
    if (found !== this.offered) {
      this.offered = found;
      this.hud.setPrompt(found ? t('race.hud.enter', { name: t(`race.event.${found}.name`) }) : null);
    }
  }

  private updateRivalSound(x: number, z: number): void {
    let nearest = Infinity;
    let pan = 0;
    let rpm = 0;
    for (const agent of this.session.agents) {
      const dx = agent.currX - x;
      const dz = agent.currZ - z;
      const distance = Math.hypot(dx, dz);
      if (distance < nearest) {
        nearest = distance;
        rpm = clamp(agent.car.powertrain.rpmShare, 0, 1);
        pan = clamp(dx / Math.max(distance, 1), -1, 1);
      }
    }
    const level = nearest < 90 ? Math.pow(1 - nearest / 90, 1.6) : 0;
    this.audio.updateRivalEngine(level, -pan * 0.7, rpm);
  }

  // ---------- Finishing ----------

  private showResults(): void {
    const outcome = this.session.outcome;
    if (!outcome) return;
    this.resultShown = true;
    const kind = this.run.kind;
    const keeps = eventKeepsGhost(outcome.event);
    const ghost = this.ghost.finish(outcome.timeMs, outcome.failure === 'none' && keeps);
    let change: ResultChange = { pointsGained: 0, cashGained: 0, levelUp: null, newMedal: false, newBest: false, rivalBeaten: false, newRank: null, champion: false };
    if (kind === 'career') {
      change = applyResult(getCareer(), outcome);
      this.host.afterResult(change);
    }
    const facts: Array<[string, string]> = [];
    const extra: ResultExtra = { practice: kind !== 'career', facts, ghostBattle: keeps && kind !== 'friend', boardLabel: kind === 'challenge' ? t('challenge.boardButton') : undefined };
    if (ghost.newBest) facts.push([t('ghost.label'), t('ghost.saved')]);
    if (kind === 'ghostBattle' && ghost.ghostMs !== null) {
      const won = outcome.failure === 'none' && outcome.timeMs < ghost.ghostMs;
      extra.title = t(won ? 'ghost.won' : 'ghost.lost');
      facts.push([t('ghost.theirTime'), formatLapTime(ghost.ghostMs)]);
    }
    const more = this.host.runFinished({ kind, outcome, ghost, options: this.run.options });
    if (more) {
      extra.title = more.title ?? extra.title;
      extra.subtitle = more.subtitle ?? extra.subtitle;
      if (more.facts) facts.push(...more.facts);
      if (more.ghostBattle === false) extra.ghostBattle = false;
    }
    saveCareer();
    this.needsFlagRefresh = true;
    this.results.show(outcome, change, kind === 'friend' ? [] : this.buildRows(), extra);
    this.host.pauseFor('raceResult');
    if (kind === 'career') this.sendPhoneNews(change);
  }

  /** Replaces the table on the results board, such as with friends' times as they come in. */
  setResultRows(rows: readonly ResultRow[]): void {
    this.results.setRows(rows);
  }

  private buildRows(): ResultRow[] {
    const session = this.session;
    const rows: ResultRow[] = [];
    if (session.raceFamily !== 'route' && session.event?.mode !== 'bazaarMaze') return rows;
    for (const row of session.standings) {
      if (row.agent === null) {
        rows.push({ name: t('race.hud.you'), isPlayer: true, time: formatLapTime(session.elapsed * 1000) });
      } else {
        rows.push({ name: agentName(row.agent), isPlayer: false, time: row.agent.finished ? formatLapTime(row.agent.finishMs) : t('race.result.stillRacing') });
      }
    }
    // Everyone already home is listed by when they got there, with the player among them.
    rows.sort((a, b) => {
      const aHome = a.time !== t('race.result.stillRacing');
      const bHome = b.time !== t('race.result.stillRacing');
      return aHome === bHome ? 0 : aHome ? -1 : 1;
    });
    const player = session.outcome?.position ?? 1;
    const index = rows.findIndex((row) => row.isPlayer);
    if (index >= 0) {
      const [me] = rows.splice(index, 1);
      rows.splice(Math.min(player - 1, rows.length), 0, me);
    }
    return rows;
  }

  /** ওস্তাদ sends word of what comes next. */
  private sendPhoneNews(change: ResultChange): void {
    if (change.newRank === null) return;
    if (change.champion) {
      this.hud.showPhone(t('ring.phoneFrom'), t('ring.phoneChampion'), 12);
      return;
    }
    const career = getCareer();
    const next = RIVALS.find((rival) => rival.rank === currentTier(career));
    if (next) {
      this.hud.showPhone(t('ring.phoneFrom'), t('ring.phoneNext', { name: t(`rival.${next.id}.name`), nick: t(`rival.${next.id}.nick`) }), 9);
    }
  }

  /** Back to free roam. */
  endRace(): void {
    this.pendingStart = null;
    this.session.end();
    this.ghost.clear();
    this.host.setConditions(null);
    this.render.clear();
    this.render.setFlagsVisible(true);
    this.hud.setRacing(false);
    this.overlay.close();
    this.cutscene.active = false;
    this.routeCache.length = 0;
    this.audio.updateRivalEngine(0, 0, 0);
    this.needsFlagRefresh = true;
    this.host.clearPolice();
    this.host.forceWeather(null);
  }

  /** Draws the race world. */
  draw(alpha: number, dt: number): void {
    this.render.update(alpha, dt);
    if (this.frameCamera) this.ghost.frame(dt, this.session, alpha, this.frameCamera, this.frameWidth, this.frameHeight);
  }

  /** A pose back on the course, if the player asks for one during a race. */
  resetPose(): SpawnPose | null {
    return this.session.isActive ? this.session.resetPose() : null;
  }

  /** Gives up on the race in progress, without a result. */
  abandon(): void {
    if (this.session.isActive) this.endRace();
  }

  /** Runs the race again from the grid. */
  retry(): void {
    if (this.lastEventId) this.startEvent(this.lastEventId, this.lastOptions);
  }
}
