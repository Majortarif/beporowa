/**
 * The rules of one running race, for all twelve kinds of event. It owns the start, the clock,
 * positions, gates, the AI cars and the result. It knows nothing of drawing or the DOM,
 * so whole races can run headless in tests.
 */

import { EVENT_BY_ID, TAKEDOWN_NODES, TAKEDOWN_START, type RaceEventDef, type RaceMode } from '../config/race-events';
import { RACE } from '../config/race-tuning';
import { CREW_LOOKS, RIVAL_BY_ID, crewTraits } from '../config/rivals';
import type { EventBus } from '../core/events';
import { clamp, createRng } from '../core/math';
import { createSample } from '../core/polyline';
import { createIntent, type Intent } from '../input/intent';
import type { PhysicsWorld } from '../physics/physics-world';
import type { TrafficSystem } from '../traffic/traffic-system';
import { carsTouch, type CarFootprint } from '../vehicle/car-contact';
import type { SpawnPose, VehicleController } from '../vehicle/vehicle-controller';
import type { RoadNetwork } from '../world/city/road-network';
import { RaceCourse } from './race-course';
import { RacerAgent, type PlayerView, type RacerWorld } from './racer-agent';
import { rivalScale } from '../progression/economy';
import { PlayerObserver, absorbRace, adaptTraits, preferredSide, scaleToCar, type MemoryData } from './rival-memory';

export type RacePhase = 'idle' | 'ready' | 'countdown' | 'running' | 'finishing' | 'done';

/** How the race is scored and steered. */
export type RaceFamily = 'route' | 'gates' | 'hunt' | 'drift';

export function familyOf(mode: RaceMode): RaceFamily {
  switch (mode) {
    case 'delivery':
    case 'checkpointRush':
    case 'bazaarMaze':
      return 'gates';
    case 'takedown':
      return 'hunt';
    case 'drift':
      return 'drift';
    default:
      return 'route';
  }
}

export interface RaceOutcome {
  event: RaceEventDef;
  /** Beat the event: finished, on time, and first where first place is what counts. */
  completed: boolean;
  /** Beat the rival, in a rival's race. */
  rivalBeaten: boolean;
  /** 0 none, 1 bronze, 2 silver, 3 gold. */
  medal: number;
  position: number;
  racers: number;
  timeMs: number;
  score: number;
  /** Seconds left on the clock, if there was one. */
  timeLeft: number;
  cargo: number;
  /** Why it ended early. */
  failure: 'none' | 'time' | 'cargo' | 'busted' | 'dnf';
  /** Seconds ahead of the nearest rival: positive means ahead. */
  margin: number;
}

export interface OpenGate {
  x: number;
  y: number;
  z: number;
  radius: number;
}

export interface StandingRow {
  agent: RacerAgent | null;
  progress: number;
}

const PLAYER_FOOTPRINT: CarFootprint = { x: 0, z: 0, fx: 0, fz: 1 };
const AGENT_FOOTPRINT: CarFootprint = { x: 0, z: 0, fx: 0, fz: 1 };

export class RaceSession {
  phase: RacePhase = 'idle';
  event: RaceEventDef | null = null;
  course: RaceCourse | null = null;
  outcome: RaceOutcome | null = null;
  readonly agents: RacerAgent[] = [];

  // ---------- What the HUD reads ----------
  countdown = 0;
  elapsed = 0;
  timeLeft = 0;
  hasClock = false;
  lap = 0;
  laps = 1;
  position = 1;
  gateIndex = 0;
  score = 0;
  targetScore = 0;
  cargo = 100;
  targetsTotal = 0;
  targetsLeft = 0;
  wrongWay = false;
  offRoute = false;
  leg = 0;
  /** Stars the police should be wanting right now. 0 keeps them off the race. */
  policeWanted = 0;
  /** Set when the player goes through the finish, for the slow-motion moment. */
  justFinished = false;
  /** The next place the player must reach. */
  readonly nextGate = { x: 0, y: 0, z: 0, valid: false };
  readonly standings: StandingRow[] = [];

  private readonly agentPool: RacerAgent[] = [];
  private readonly view: PlayerView = { x: 0, y: 0, z: 0, fx: 0, fz: 1, vx: 0, vz: 0, speed: 0, progress: 0 };
  private readonly world: RacerWorld;
  private readonly heldIntent = createIntent();
  private readonly observer = new PlayerObserver();
  private readonly passLast = new Map<RacerAgent, number>();
  private readonly random = createRng(3301);
  private readonly sample = createSample();
  private openGates: OpenGate[] = [];
  /** Nobody else is racing: no rivals and no crew. */
  solo = false;
  private lineS = 0;
  private playerProgress = 0;
  private totalDistance = 0;
  private family: RaceFamily = 'route';
  private coolDown = 0;
  private leaderFinishedAt = -1;
  private throttleSince = -1;
  private bogSeconds = 0;
  private launchDecided = false;
  private wasHandbrake = false;
  private wrongWayTime = 0;
  private memory: MemoryData | null = null;
  private lastCrashTime = -10;
  private lastCheckedLap = 0;
  private lastLapTime = 0;
  private tauntCooldown = 0;
  private ended = false;
  private playerStrength = 1;

  /** A rival says something. */
  onTaunt: ((rivalId: string, kind: TauntKind) => void) | null = null;
  /** A gate was passed. */
  onGate: ((index: number, total: number) => void) | null = null;

  constructor(
    private readonly network: RoadNetwork,
    private readonly physics: PhysicsWorld,
    private readonly bus: EventBus,
    private readonly playerCar: VehicleController,
    private readonly traffic: TrafficSystem | null,
    /** The most AI cars this machine should run. */
    private readonly maxOpponents: number,
  ) {
    this.world = {
      player: this.view,
      agents: this.agents,
      traffic,
      totalDistance: 0,
      rubberBand: false,
      preferredSide: 0,
      viewX: 0,
      viewZ: 0,
      viewFx: 0,
      viewFz: 1,
    };
    bus.on('driftEnd', ({ points }) => {
      if (this.phase === 'running' && this.family === 'drift') this.score += points;
    });
    bus.on('impact', ({ strength }) => this.onCrash(strength));
    bus.on('trafficHit', ({ strength, soft }) => this.onCrash(soft ? 0 : strength));
    bus.on('nitroStart', () => {
      if (this.phase === 'running' && this.totalDistance > 0) this.observer.noteNitro(this.playerProgress / this.totalDistance);
    });
    bus.on('pursuitBusted', () => {
      if (this.phase === 'running') this.finishRace('busted');
    });
  }

  get isActive(): boolean {
    return this.phase !== 'idle';
  }

  get isRunning(): boolean {
    return this.phase === 'running';
  }

  get raceFamily(): RaceFamily {
    return this.family;
  }

  /** Total racers including the player. */
  get racerCount(): number {
    return this.agents.length + 1;
  }

  /** Where the player's own progress stands, for the HUD's strip. */
  get playerShare(): number {
    return this.totalDistance > 0 ? clamp(this.playerProgress / this.totalDistance, 0, 1) : 0;
  }

  /** How far past the start line the player is. */
  get progress(): number {
    return this.playerProgress;
  }

  get raceDistance(): number {
    return this.totalDistance;
  }

  // ---------- Setting up ----------

  /**
   * Sets up the grid. @returns where the player's car should be placed
   * @param strength how strong the player's car is, where 1 is a stock বুলবুলি
   * @param solo nobody else on the grid: a ghost battle, a challenge or a race with friends
   */
  begin(id: string, memory: MemoryData, strength = 1, solo = false): SpawnPose {
    this.playerStrength = strength;
    const event = EVENT_BY_ID.get(id);
    if (!event) throw new Error(`No such race: ${id}`);
    this.clearAgents();
    this.event = event;
    this.memory = memory;
    this.outcome = null;
    this.ended = false;
    this.family = familyOf(event.mode);
    this.phase = 'ready';
    this.elapsed = 0;
    this.lap = 0;
    this.laps = event.laps ?? 1;
    this.gateIndex = 0;
    this.score = 0;
    this.cargo = 100;
    this.targetsLeft = 0;
    this.targetsTotal = 0;
    this.leg = 0;
    this.policeWanted = 0;
    this.justFinished = false;
    this.hasClock = event.timeLimit !== undefined;
    this.timeLeft = event.timeLimit ?? 0;
    this.coolDown = 0;
    this.leaderFinishedAt = -1;
    this.throttleSince = -1;
    this.bogSeconds = 0;
    this.launchDecided = false;
    this.wrongWayTime = 0;
    this.lastCheckedLap = 0;
    this.lastLapTime = 0;
    this.tauntCooldown = 0;
    this.observer.reset();
    this.passLast.clear();
    this.openGates = [];
    this.targetScore = this.family === 'drift' && event.medals ? (event.rivalRace ? event.medals[1] : event.medals[2]) : 0;
    this.world.preferredSide = preferredSide(memory);

    this.buildCourse(event);
    const course = this.course as RaceCourse;
    this.totalDistance = this.family === 'gates' || this.family === 'hunt' ? course.lapLength : course.lapLength * this.laps;
    this.world.totalDistance = this.totalDistance;
    this.world.rubberBand = this.family === 'route' || this.family === 'gates';

    // A takedown needs its runners, so it is never run alone.
    this.solo = solo && this.family !== 'hunt';
    const playerGrid = !this.solo && event.rivals.length + event.crew > 0 ? this.opponentCount(event) : 0;
    const pose = course.gridPose(playerGrid);
    if (!this.solo) this.placeOpponents(event, course);

    this.lineS = course.loop ? course.line.length - (RACE.grid.behindLine + Math.floor(playerGrid / 2) * RACE.grid.rowSpacing + (playerGrid % 2) * 2) : course.startS - (RACE.grid.behindLine + Math.floor(playerGrid / 2) * RACE.grid.rowSpacing + (playerGrid % 2) * 2);
    this.playerProgress = course.loop ? this.lineS - course.line.length : this.lineS - course.startS;

    if (this.traffic) {
      this.traffic.density = event.traffic;
      this.clearTrafficNearGrid(course, event);
    }
    this.refreshNextGate();
    this.position = this.racerCount;
    return { position: { x: pose.x, y: pose.y + 0.8, z: pose.z }, yaw: pose.yaw };
  }

  private opponentCount(event: RaceEventDef): number {
    return Math.min(this.maxOpponents, event.rivals.length + event.crew);
  }

  private buildCourse(event: RaceEventDef): void {
    const network = this.network;
    if (this.family === 'hunt') {
      this.course = RaceCourse.fromNodes(network, TAKEDOWN_START, false);
    } else if (event.gates) {
      // The list starts where the race starts. Drivers get to the rest however they like.
      this.course = RaceCourse.fromNodes(network, event.gates, false);
      const radius = event.mode === 'delivery' ? RACE.delivery.radius : RACE.openGates.radius;
      this.openGates = event.gates.slice(1).map((id) => {
        const node = network.nodes[network.nodeIndex(id)];
        return { x: node.x, y: node.y, z: node.z, radius: Math.max(radius, node.radius + 4) };
      });
    } else if (event.course) {
      this.course = RaceCourse.fromNodes(network, event.course.nodes, event.course.loop);
    } else {
      throw new Error(`Race ${event.id} has no course`);
    }
  }

  /** A closed road is really closed: nothing should be parked on the grid when the lights go out. */
  private clearTrafficNearGrid(course: RaceCourse, event: RaceEventDef): void {
    const traffic = this.traffic;
    if (!traffic) return;
    const sample = this.sample;
    course.line.sample(course.toLineS(0), sample);
    traffic.clearAround(sample.x, sample.z, 80);
    if (event.traffic === 0) {
      for (let s = 0; s < course.line.length; s += 60) {
        course.line.sample(s, sample);
        traffic.clearAround(sample.x, sample.z, 60);
      }
    }
  }

  private takeAgent(): RacerAgent {
    let agent = this.agentPool.find((candidate) => !candidate.active);
    if (!agent) {
      agent = new RacerAgent(this.physics);
      this.agentPool.push(agent);
    }
    return agent;
  }

  private placeOpponents(event: RaceEventDef, course: RaceCourse): void {
    if (this.family === 'hunt') {
      this.placeRunners(event);
      return;
    }
    const memory = this.memory as MemoryData;
    const spots = this.opponentCount(event);
    // The rival starts from pole, and the player starts at the back.
    let grid = 0;
    const lap = course.lapLength * this.laps + 800;
    for (const id of event.rivals) {
      if (grid >= spots) break;
      const rival = RIVAL_BY_ID.get(id);
      if (!rival) throw new Error(`No such rival: ${id}`);
      const agent = this.takeAgent();
      const pose = course.gridPose(grid);
      agent.prepare(scaleToCar(adaptTraits(rival.traits, memory), rivalScale(rival.rank, this.playerStrength)), { model: rival.model, body: rival.body, stripe: rival.stripe, glow: rival.glow, lightsOff: rival.traits.lightsOff === true }, course, pose.x, pose.y, pose.z, pose.yaw);
      agent.rivalId = id;
      this.startOnLine(agent, course, grid, lap);
      this.agents.push(agent);
      grid++;
    }
    let crewIndex = Math.floor(this.random() * 20);
    while (grid < spots) {
      const look = CREW_LOOKS[crewIndex % CREW_LOOKS.length];
      const agent = this.takeAgent();
      const pose = course.gridPose(grid);
      agent.prepare(scaleToCar(adaptTraits(crewTraits(event.crewSkill), memory), rivalScale(event.tier, this.playerStrength)), { ...look, lightsOff: false }, course, pose.x, pose.y, pose.z, pose.yaw);
      agent.rivalId = null;
      agent.crewIndex = crewIndex;
      this.startOnLine(agent, course, grid, lap);
      this.agents.push(agent);
      grid++;
      crewIndex++;
    }
    if (event.mode === 'drag') for (const agent of this.agents) agent.manualGears = true;
  }

  private startOnLine(agent: RacerAgent, course: RaceCourse, grid: number, distance: number): void {
    const back = RACE.grid.behindLine + Math.floor(grid / 2) * RACE.grid.rowSpacing + (grid % 2) * 2;
    agent.lineS = course.loop ? course.line.length - back : course.startS - back;
    agent.progress = course.loop ? -back : -back;
    const bias = grid % 2 === 0 ? 0.8 : -0.8;
    agent.driver.setRoute(course.buildDriveLine(agent.traits.lineInset, bias, distance, RACE.driver.routePointSpacing));
    agent.driver.relocate(agent.currX, agent.currZ);
    agent.startDelay = this.random() * (0.18 + agent.traits.mistakeRate);
  }

  private placeRunners(event: RaceEventDef): void {
    const count = Math.min(event.targets ?? 3, Math.max(2, this.maxOpponents));
    this.targetsTotal = count;
    this.targetsLeft = count;
    const sample = this.sample;
    for (let i = 0; i < count; i++) {
      const look = CREW_LOOKS[i % CREW_LOOKS.length];
      const agent = this.takeAgent();
      const traits = scaleToCar(crewTraits(event.crewSkill), rivalScale(event.tier, this.playerStrength));
      const nodeIndex = this.network.nodeIndex(TAKEDOWN_NODES[(i * 5 + 3) % TAKEDOWN_NODES.length]);
      const node = this.network.nodes[nodeIndex];
      const leg = node.legs[0];
      const edge = this.network.edges[leg.edge];
      const forward = edge.a === nodeIndex;
      edge.center.sample(forward ? 30 : edge.center.length - 30, sample);
      const sign = forward ? 1 : -1;
      agent.prepare(traits, { ...look, lightsOff: false }, null, sample.x, sample.y, sample.z, Math.atan2(sample.tx * sign, sample.tz * sign));
      agent.rivalId = null;
      agent.crewIndex = i;
      agent.role = 'runner';
      this.planRunner(agent);
      this.agents.push(agent);
    }
  }

  /** A runner picks somewhere far from the player and heads there. */
  private planRunner = (agent: RacerAgent): void => {
    const network = this.network;
    let bestNode = -1;
    let bestScore = -Infinity;
    for (let attempt = 0; attempt < 5; attempt++) {
      const id = TAKEDOWN_NODES[Math.floor(this.random() * TAKEDOWN_NODES.length)];
      const index = network.nodeIndex(id);
      const node = network.nodes[index];
      const score = Math.hypot(node.x - this.view.x, node.z - this.view.z) + this.random() * 200;
      if (score > bestScore) {
        bestScore = score;
        bestNode = index;
      }
    }
    const here = network.nearestRoad(agent.currX, agent.currZ, agent.currY - 0.65);
    const edge = network.edges[here.edge];
    const goesForward = here.tx * agent.fx + here.tz * agent.fz >= 0;
    const ahead = goesForward ? edge.b : edge.a;
    const route = network.findRoute(ahead, bestNode === ahead ? network.nodeIndex(TAKEDOWN_NODES[0]) : bestNode);
    const points: number[] = [];
    const sample = this.sample;
    const stretch = (from: number, to: number, line: typeof edge.center): void => {
      const spacing = RACE.driver.routePointSpacing;
      const steps = Math.max(1, Math.round(Math.abs(to - from) / spacing));
      for (let i = 0; i <= steps; i++) {
        line.sample(from + ((to - from) * i) / steps, sample);
        points.push(sample.x, sample.z);
      }
    };
    stretch(here.s, goesForward ? edge.center.length : 0, edge.center);
    for (let i = 0; i + 1 < route.length; i++) {
      const next = network.edgeBetween(route[i], route[i + 1]);
      if (!next) continue;
      const forward = next.a === route[i];
      stretch(forward ? 0 : next.center.length, forward ? next.center.length : 0, next.center);
    }
    agent.driver.setRoute(points);
  };

  // ---------- Before the start ----------

  /** The lights begin. */
  startCountdown(): void {
    if (this.phase !== 'ready') return;
    this.phase = 'countdown';
    this.countdown = RACE.countdown.stepSeconds * 3;
    this.throttleSince = -1;
    this.bus.emit('raceCountdown', { step: 3 });
  }

  /** What the car should actually be told, given what the player pressed. */
  filterIntent(source: Intent): Intent {
    const held = this.heldIntent;
    switch (this.phase) {
      case 'ready':
      case 'countdown':
        held.throttle = 0;
        held.brake = 0;
        held.steer = 0;
        held.handbrake = true;
        held.nitro = false;
        held.horn = source.horn;
        held.lookBack = false;
        held.dom = false;
        // The gas can be pressed before the lights go out: that is the launch.
        if (this.phase === 'countdown') {
          if (source.throttle > 0.3) {
            if (this.throttleSince < 0) this.throttleSince = this.elapsedCountdown();
          } else {
            this.throttleSince = -1;
          }
        }
        return held;
      case 'finishing':
      case 'done':
        held.throttle = 0;
        held.brake = 0.7;
        held.steer = source.steer;
        held.handbrake = false;
        held.nitro = false;
        held.horn = false;
        held.lookBack = false;
        held.dom = false;
        return held;
      default:
        break;
    }
    if (this.event?.mode === 'drag') {
      // In a drag race the handbrake button is the gear lever.
      held.throttle = source.throttle;
      held.brake = source.brake;
      held.steer = source.steer * 0.55;
      held.nitro = source.nitro;
      held.horn = source.horn;
      held.lookBack = source.lookBack;
      held.dom = source.dom;
      held.handbrake = false;
      if (source.handbrake && !this.wasHandbrake) {
        const shift = this.playerCar.powertrain.shiftUp();
        if (shift) this.bus.emit('raceShift', { perfect: this.shiftWasPerfect() });
      }
      this.wasHandbrake = source.handbrake;
      return held;
    }
    if (this.bogSeconds > 0) {
      held.throttle = source.throttle * RACE.launch.earlyPower;
      held.brake = source.brake;
      held.steer = source.steer;
      held.handbrake = source.handbrake;
      held.nitro = false;
      held.horn = source.horn;
      held.lookBack = source.lookBack;
      held.dom = source.dom;
      return held;
    }
    return source;
  }

  private shiftWasPerfect(): boolean {
    // The revs drop with the shift, so what counts is what the last gear had reached.
    return this.lastShareBeforeShift >= RACE.drag.bestFrom && this.lastShareBeforeShift <= RACE.drag.limiterAt;
  }

  private lastShareBeforeShift = 0;

  private elapsedCountdown(): number {
    return RACE.countdown.stepSeconds * 3 - this.countdown;
  }

  /** Tells the HUD whether now is the moment to shift. */
  get shiftLight(): boolean {
    if (this.event?.mode !== 'drag' || this.phase !== 'running') return false;
    return this.playerCar.powertrain.rpmShare >= RACE.drag.shiftLightFrom;
  }

  // ---------- Each physics step ----------

  /** Before the physics step: the AI cars decide and drive. */
  preStep(dt: number, viewX: number, viewZ: number, viewFx: number, viewFz: number): void {
    if (this.phase === 'idle') return;
    const world = this.world;
    world.viewX = viewX;
    world.viewZ = viewZ;
    world.viewFx = viewFx;
    world.viewFz = viewFz;
    this.readPlayer();
    this.lastShareBeforeShift = this.playerCar.powertrain.rpmShare;

    const racing = this.phase === 'running' || this.phase === 'finishing' || this.phase === 'done';
    for (const agent of this.agents) {
      if (!racing) agent.holdStill(dt);
      else if (agent.role === 'runner') agent.driveRunner(dt, world, this.planRunner);
      else agent.driveRace(dt, world);
    }
    this.publishObstacles();
  }

  /** After the physics step: read what happened, and apply the rules. */
  postStep(dt: number): void {
    if (this.phase === 'idle') return;
    this.readPlayer();
    for (const agent of this.agents) agent.readTransform();

    if (this.phase === 'countdown') this.updateCountdown(dt);
    if (this.phase === 'running' || this.phase === 'finishing') {
      this.updateAgentProgress();
      this.updatePlayerProgress(dt);
      this.updateStandings();
    }
    if (this.phase === 'running') {
      this.elapsed += dt;
      if (this.bogSeconds > 0) this.bogSeconds -= dt;
      if (this.tauntCooldown > 0) this.tauntCooldown -= dt;
      this.checkLaunchWindow();
      this.updateClock(dt);
      this.updateFamily(dt);
      this.watchPasses();
      this.watchDnf();
    }
    if (this.phase === 'finishing') {
      this.coolDown -= dt;
      if (this.coolDown <= 0) this.phase = 'done';
    }
  }

  private readPlayer(): void {
    const car = this.playerCar;
    const q = car.body.rotation();
    const t = car.body.translation();
    const v = car.body.linvel();
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const length = Math.hypot(fx, fz) || 1;
    const view = this.view;
    view.x = t.x;
    view.y = t.y - 0.65;
    view.z = t.z;
    view.fx = fx / length;
    view.fz = fz / length;
    view.vx = v.x;
    view.vz = v.z;
    view.speed = Math.hypot(v.x, v.z);
    view.progress = this.playerProgress;
  }

  private publishObstacles(): void {
    const traffic = this.traffic;
    if (!traffic) return;
    const out = traffic.externalObstacles;
    let count = traffic.externalObstacleCount;
    for (const agent of this.agents) {
      if (!agent.active || count >= out.length / 3) continue;
      out[count * 3] = agent.currX;
      out[count * 3 + 1] = agent.currY - 0.65;
      out[count * 3 + 2] = agent.currZ;
      count++;
    }
    traffic.externalObstacleCount = count;
  }

  private updateCountdown(dt: number): void {
    const before = Math.ceil(this.countdown / RACE.countdown.stepSeconds);
    this.countdown -= dt;
    const after = Math.ceil(this.countdown / RACE.countdown.stepSeconds);
    if (after !== before && after > 0) this.bus.emit('raceCountdown', { step: after });
    if (this.countdown <= 0) this.go();
  }

  private go(): void {
    this.phase = 'running';
    this.countdown = 0;
    this.elapsed = 0;
    this.bus.emit('raceCountdown', { step: 0 });
    this.bus.emit('raceStarted', {});
    if (this.event?.mode === 'drag') this.playerCar.powertrain.manual = true;

    // Judge the launch from when the gas went down.
    const launch = RACE.launch;
    if (this.throttleSince >= 0) {
      const heldFor = RACE.countdown.stepSeconds * 3 - this.throttleSince;
      this.launchDecided = true;
      if (heldFor <= launch.windowBefore) this.applyPerfectLaunch();
      else this.applyEarlyLaunch();
    }
    this.throttleSince = -1;
  }

  private checkLaunchWindow(): void {
    if (this.launchDecided) return;
    const launch = RACE.launch;
    if (this.elapsed > launch.windowAfter) {
      this.launchDecided = true;
    } else if (this.playerCar.telemetry.throttle > 0.3) {
      this.launchDecided = true;
      this.applyPerfectLaunch();
    }
  }

  private applyPerfectLaunch(): void {
    const launch = RACE.launch;
    const car = this.playerCar;
    const v = car.body.linvel();
    car.body.setLinvel({ x: v.x + this.view.fx * launch.perfectSpeed, y: v.y, z: v.z + this.view.fz * launch.perfectSpeed }, true);
    car.addNitro(launch.perfectNitro);
    this.bus.emit('raceLaunch', { perfect: true });
  }

  private applyEarlyLaunch(): void {
    this.bogSeconds = RACE.launch.earlySeconds;
    this.bus.emit('raceLaunch', { perfect: false });
  }

  private updateAgentProgress(): void {
    for (const agent of this.agents) {
      const course = agent.course;
      if (!course || agent.role !== 'race') continue;
      const s = course.locate(agent.currX, agent.currY - 0.65, agent.currZ, agent.lineS);
      agent.offLine = course.lastDistance;
      agent.progress += course.delta(agent.lineS, s);
      agent.lineS = s;
      if (agent.finished) continue;

      if (this.family === 'gates') {
        const gate = this.openGates[agent.gateIndex];
        if (gate && Math.hypot(gate.x - agent.currX, gate.z - agent.currZ) < gate.radius + 6) {
          agent.gateIndex++;
          if (agent.gateIndex >= this.openGates.length) this.finishAgent(agent);
        }
      } else if (this.family === 'route' && agent.progress >= this.totalDistance) {
        this.finishAgent(agent);
      }
    }
  }

  private finishAgent(agent: RacerAgent): void {
    agent.finished = true;
    agent.finishMs = this.elapsed * 1000;
    if (this.leaderFinishedAt < 0) this.leaderFinishedAt = this.elapsed;
    if (agent.rivalId && this.phase === 'running' && this.tauntCooldown <= 0) this.taunt(agent.rivalId, 'finishFirst');
  }

  private updatePlayerProgress(dt: number): void {
    const course = this.course;
    if (!course || this.family === 'hunt') return;
    const config = RACE.course;
    const view = this.view;
    const s = course.locate(view.x, view.y, view.z, this.lineS);
    const distance = course.lastDistance;
    this.offRoute = this.family !== 'gates' && distance > config.offRouteWarn;
    // Far from the road, nothing counts until the car comes back.
    if (distance < config.offRouteWarn * 1.6 || this.family === 'gates') {
      this.playerProgress += course.delta(this.lineS, s);
      this.lineS = s;
    }

    // Going the wrong way along a fixed route.
    if (this.family !== 'gates' && view.speed > 6) {
      course.line.sample(this.lineS, this.sample);
      const dot = view.fx * this.sample.tx + view.fz * this.sample.tz;
      this.wrongWayTime = dot < -0.35 ? this.wrongWayTime + dt : 0;
    } else {
      this.wrongWayTime = 0;
    }
    this.wrongWay = this.wrongWayTime > 1.1;
    this.refreshNextGate();
  }

  private refreshNextGate(): void {
    const gate = this.nextGate;
    const course = this.course;
    if (!course) {
      gate.valid = false;
      return;
    }
    if (this.family === 'gates') {
      const next = this.openGates[this.gateIndex];
      gate.valid = next !== undefined;
      if (next) {
        gate.x = next.x;
        gate.y = next.y;
        gate.z = next.z;
      }
      return;
    }
    if (this.family === 'hunt') {
      gate.valid = false;
      return;
    }
    const next = course.gates[this.gateIndex % course.gates.length];
    gate.valid = next !== undefined;
    if (next) {
      gate.x = next.x;
      gate.y = next.y;
      gate.z = next.z;
    }
  }

  /** Gates and laps, along a fixed route. */
  private updateRouteGates(): void {
    const course = this.course as RaceCourse;
    const lapsDone = Math.floor(Math.max(0, this.playerProgress) / course.lapLength);
    const gates = course.gates;
    const within = this.gateIndex % gates.length;
    const lapsPassed = Math.floor(this.gateIndex / gates.length);
    const nextAt = gates[within].progress + lapsPassed * course.lapLength;
    if (this.playerProgress >= nextAt) {
      this.gateIndex++;
      this.onGate?.(this.gateIndex, gates.length * this.laps);
      this.bus.emit('raceGate', { index: this.gateIndex });
    }
    if (lapsDone > this.lastCheckedLap && this.gateIndex >= lapsDone * gates.length) {
      this.lastCheckedLap = lapsDone;
      this.lap = lapsDone;
      const lapTime = this.elapsed - this.lastLapTime;
      this.lastLapTime = this.elapsed;
      if (lapsDone < this.laps) this.bus.emit('raceLap', { lap: lapsDone, seconds: lapTime, last: lapsDone === this.laps - 1 });
    }
  }

  private updateFamily(dt: number): void {
    switch (this.family) {
      case 'route':
        this.updateRoute();
        break;
      case 'gates':
        this.updateGates();
        break;
      case 'hunt':
        this.updateHunt(dt);
        break;
      case 'drift':
        this.updateDrift();
        break;
    }
  }

  private updateRoute(): void {
    this.updateRouteGates();
    const event = this.event as RaceEventDef;
    // A boss race runs in legs, and the police arrive partway.
    if (event.legs && this.totalDistance > 0) {
      const share = this.playerProgress / this.totalDistance;
      let leg = 0;
      for (const start of event.legs) if (share >= start) leg++;
      if (leg !== this.leg) {
        this.leg = leg;
        this.bus.emit('raceLeg', { leg });
        if (event.police && leg === event.police.leg) this.policeWanted = event.police.stars;
      }
    }
    if (this.playerProgress >= this.totalDistance && this.gateIndex >= (this.course as RaceCourse).gates.length * this.laps) {
      this.finishRace('none');
    }
  }

  private updateGates(): void {
    const event = this.event as RaceEventDef;
    const gate = this.openGates[this.gateIndex];
    if (gate) {
      const distance = Math.hypot(gate.x - this.view.x, gate.z - this.view.z);
      const closeEnough = distance < gate.radius && Math.abs(gate.y - this.view.y) < 4;
      const slowEnough = event.mode !== 'delivery' || this.view.speed * 3.6 < RACE.delivery.stopSpeedKmh;
      if (closeEnough && slowEnough) {
        this.gateIndex++;
        if (event.gateBonus) this.timeLeft += event.gateBonus;
        this.onGate?.(this.gateIndex, this.openGates.length);
        this.bus.emit('raceGate', { index: this.gateIndex });
        this.refreshNextGate();
      }
    }
    if (this.gateIndex >= this.openGates.length) this.finishRace('none');
    if (this.cargo <= 0) this.finishRace('cargo');
  }

  private updateDrift(): void {
    if (this.timeLeft <= 0) this.finishRace('none');
  }

  /** What the rival has scored so far, in a drift battle. */
  get rivalScoreNow(): number {
    const event = this.event;
    if (!event?.rivalRace || !event.timeLimit) return 0;
    return Math.round(this.targetScore * clamp(this.elapsed / event.timeLimit, 0, 1) * RACE.drift.rivalPace);
  }

  private updateHunt(dt: number): void {
    const config = RACE.takedown;
    const view = this.view;
    PLAYER_FOOTPRINT.x = view.x;
    PLAYER_FOOTPRINT.z = view.z;
    PLAYER_FOOTPRINT.fx = view.fx;
    PLAYER_FOOTPRINT.fz = view.fz;
    let left = 0;
    for (const agent of this.agents) {
      if (agent.eliminated) continue;
      left++;
      if (agent.hitCooldown > 0) agent.hitCooldown -= dt;
      const dx = agent.currX - view.x;
      const dz = agent.currZ - view.z;
      if (Math.abs(dx) > 6 || Math.abs(dz) > 6 || Math.abs(agent.currY - 0.65 - view.y) > 2.2) continue;
      AGENT_FOOTPRINT.x = agent.currX;
      AGENT_FOOTPRINT.z = agent.currZ;
      AGENT_FOOTPRINT.fx = agent.fx;
      AGENT_FOOTPRINT.fz = agent.fz;
      if (agent.hitCooldown > 0 || !carsTouch(PLAYER_FOOTPRINT, AGENT_FOOTPRINT)) continue;
      const length = Math.hypot(dx, dz) || 1;
      const velocity = agent.car.velocity;
      const closing = ((view.vx - velocity.x) * dx + (view.vz - velocity.z) * dz) / length;
      if (closing < config.minClosing) continue;
      // A hit in the side does more than one from behind.
      const sideOn = Math.abs(agent.fx * (dz / length) - agent.fz * (dx / length));
      const damage = (closing - config.minClosing) * config.damagePerSpeed * (1 + sideOn * (config.sideBonus - 1));
      agent.health -= damage;
      agent.hitCooldown = config.hitCooldown;
      this.bus.emit('targetHit', { x: (agent.currX + view.x) / 2, y: view.y + 0.7, z: (agent.currZ + view.z) / 2, strength: clamp(damage / 60, 0.2, 1) });
      if (agent.health <= 0) {
        agent.eliminated = true;
        agent.health = 0;
        left--;
        this.score += config.pointsPerTarget;
        // A knock that stops a car, without hurting anyone in it.
        agent.car.destabilize((sideOn > 0.5 ? 1 : -1) * 1500, 0.4);
        this.bus.emit('targetDown', { x: agent.currX, y: agent.currY, z: agent.currZ, left });
      }
    }
    this.targetsLeft = left;
    if (left === 0) this.finishRace('none');
  }

  private updateClock(dt: number): void {
    if (!this.hasClock) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      if (this.family !== 'drift') this.finishRace('time');
    }
  }

  /** Spots passes on rivals, which is what the rivals learn from, and what gets them talking. */
  private watchPasses(): void {
    const view = this.view;
    for (const agent of this.agents) {
      if (agent.role !== 'race') continue;
      const dx = view.x - agent.currX;
      const dz = view.z - agent.currZ;
      const near = Math.abs(dx) + Math.abs(dz) < 26;
      const along = dx * agent.fx + dz * agent.fz;
      const before = this.passLast.get(agent);
      if (near && before !== undefined) {
        if (before < -1 && along > 1) {
          // The player came through on one side of this car.
          const side = dx * agent.fz - dz * agent.fx;
          this.observer.notePass(side >= 0);
          if (agent.rivalId) this.taunt(agent.rivalId, 'passed');
        } else if (before > 1 && along < -1 && agent.rivalId) {
          this.taunt(agent.rivalId, 'passing');
        }
      }
      if (near) this.passLast.set(agent, along);
      else this.passLast.delete(agent);

      // Bumping a rival gets a reaction too.
      if (agent.rivalId && Math.abs(dx) < 4.6 && Math.abs(dz) < 4.6 && this.elapsed - this.lastCrashTime > 0.1) {
        PLAYER_FOOTPRINT.x = view.x;
        PLAYER_FOOTPRINT.z = view.z;
        PLAYER_FOOTPRINT.fx = view.fx;
        PLAYER_FOOTPRINT.fz = view.fz;
        AGENT_FOOTPRINT.x = agent.currX;
        AGENT_FOOTPRINT.z = agent.currZ;
        AGENT_FOOTPRINT.fx = agent.fx;
        AGENT_FOOTPRINT.fz = agent.fz;
        if (carsTouch(PLAYER_FOOTPRINT, AGENT_FOOTPRINT)) this.taunt(agent.rivalId, 'bump');
      }
    }
  }

  private taunt(rivalId: string, kind: TauntKind): void {
    if (this.tauntCooldown > 0) return;
    this.tauntCooldown = RACE.taunts.cooldownSeconds;
    this.onTaunt?.(rivalId, kind);
  }

  private watchDnf(): void {
    if (this.leaderFinishedAt >= 0 && this.elapsed - this.leaderFinishedAt > RACE.finish.dnfSeconds) {
      this.finishRace('dnf');
    }
  }

  private onCrash(strength: number): void {
    if (this.phase !== 'running') return;
    if (this.elapsed - this.lastCrashTime < RACE.delivery.crashCooldown) return;
    this.lastCrashTime = this.elapsed;
    this.observer.noteCrash();
    if (this.event?.mode === 'delivery') {
      this.cargo -= strength > 0 ? RACE.delivery.cargoPerCrash * strength : RACE.delivery.softCrashCargo;
      if (this.cargo < 0) this.cargo = 0;
      this.bus.emit('cargoHit', { cargo: this.cargo });
    }
  }

  /** Two taps of the horn near a rival: they take it badly. */
  provokeRivals(): number {
    if (this.phase !== 'running') return 0;
    let count = 0;
    for (const agent of this.agents) {
      if (!agent.active || agent.eliminated) continue;
      const distance = Math.hypot(agent.currX - this.view.x, agent.currZ - this.view.z);
      if (distance > RACE.ai.provokeRadius) continue;
      agent.provokedSeconds = RACE.ai.provokedSeconds;
      count++;
      if (agent.rivalId) {
        this.tauntCooldown = 0;
        this.taunt(agent.rivalId, 'provoked');
      }
    }
    return count;
  }

  private updateStandings(): void {
    const rows = this.standings;
    rows.length = 0;
    rows.push({ agent: null, progress: this.rankValue(null) });
    if (this.family !== 'hunt' && this.family !== 'drift') {
      for (const agent of this.agents) {
        if (agent.role === 'race') rows.push({ agent, progress: this.rankValue(agent) });
      }
    }
    rows.sort((a, b) => b.progress - a.progress);
    this.position = rows.findIndex((row) => row.agent === null) + 1;
  }

  private rankValue(agent: RacerAgent | null): number {
    const finishedBonus = 1e7;
    if (agent === null) {
      if (this.ended && this.family === 'route') return finishedBonus * 2 - this.elapsed;
      if (this.family === 'gates') {
        const gate = this.openGates[this.gateIndex];
        const distance = gate ? Math.hypot(gate.x - this.view.x, gate.z - this.view.z) : 0;
        return this.gateIndex * 1e4 - distance;
      }
      return this.playerProgress;
    }
    if (agent.finished) return finishedBonus * 3 - agent.finishMs / 1000;
    if (this.family === 'gates') {
      const gate = this.openGates[agent.gateIndex];
      const distance = gate ? Math.hypot(gate.x - agent.currX, gate.z - agent.currZ) : 0;
      return agent.gateIndex * 1e4 - distance;
    }
    return agent.progress;
  }

  // ---------- Finishing ----------

  private finishRace(failure: RaceOutcome['failure']): void {
    if (this.ended) return;
    this.ended = true;
    this.updateStandings();
    const event = this.event as RaceEventDef;
    const rankFinish = this.family === 'route' || event.mode === 'bazaarMaze';
    let position = this.position;
    if (rankFinish && failure === 'none') {
      // Everyone already home is ahead. Everyone else is behind.
      position = 1 + this.agents.filter((agent) => agent.finished).length;
    }
    // Whole milliseconds, so the board, the save and friends all show the same time.
    const timeMs = Math.round(this.elapsed * 1000);
    const nearestFinish = this.agents.filter((agent) => agent.rivalId || event.rivals.length === 0).map((agent) => agent);
    const margin = this.computeMargin(nearestFinish, failure);
    const medal = this.medalFor(event, position, timeMs, failure);
    const completed = this.isCompleted(event, position, medal, failure);
    const rivalBeaten = event.rivalRace !== undefined && completed && this.beatsRival(event, position);
    this.outcome = {
      event,
      completed,
      rivalBeaten,
      medal,
      position,
      racers: rankFinish ? this.racerCount : 1,
      timeMs,
      score: this.score,
      timeLeft: this.timeLeft,
      cargo: this.cargo,
      failure,
      margin,
    };
    if (this.memory && rankFinish) {
      absorbRace(this.memory, this.observer, Math.max(this.playerProgress, 0) / 1000, margin);
    }
    this.justFinished = true;
    this.phase = 'finishing';
    this.coolDown = RACE.finish.coolDownSeconds;
    this.bus.emit('raceFinished', { completed });
  }

  private computeMargin(rivals: readonly RacerAgent[], failure: RaceOutcome['failure']): number {
    if (failure !== 'none' || rivals.length === 0) return failure === 'none' ? 0 : -10;
    let best = Infinity;
    for (const agent of rivals) {
      if (agent.finished) {
        best = Math.min(best, (this.elapsed * 1000 - agent.finishMs) / -1000);
      } else {
        const gap = this.playerProgress - agent.progress;
        const speed = Math.max(agent.car.telemetry.speed, 12);
        best = Math.min(best, gap / speed);
      }
    }
    return best === Infinity ? 0 : best;
  }

  private medalFor(event: RaceEventDef, position: number, timeMs: number, failure: RaceOutcome['failure']): number {
    if (failure !== 'none') return 0;
    const medals = event.medals;
    if (!medals) return position === 1 ? 3 : position === 2 ? 2 : position === 3 ? 1 : 0;
    const [gold, silver, bronze] = medals;
    switch (event.mode) {
      case 'timeTrial': {
        const seconds = timeMs / 1000;
        return seconds <= gold ? 3 : seconds <= silver ? 2 : seconds <= bronze ? 1 : 0;
      }
      case 'drift':
        return this.score >= gold ? 3 : this.score >= silver ? 2 : this.score >= bronze ? 1 : 0;
      case 'delivery': {
        // Time left counts for less when the sweets arrive in pieces.
        const value = this.timeLeft * (this.cargo / 100);
        return value >= gold ? 3 : value >= silver ? 2 : value >= bronze ? 1 : 1;
      }
      default:
        return this.timeLeft >= gold ? 3 : this.timeLeft >= silver ? 2 : this.timeLeft >= bronze ? 1 : 1;
    }
  }

  private isCompleted(event: RaceEventDef, position: number, medal: number, failure: RaceOutcome['failure']): boolean {
    if (failure !== 'none') return false;
    if (event.rivalRace) return this.beatsRival(event, position);
    if (event.medals) return medal > 0;
    return position <= 3;
  }

  private beatsRival(event: RaceEventDef, position: number): boolean {
    if (event.mode === 'drift') return this.score >= this.targetScore;
    return position === 1;
  }

  /** A run can ask for more or less traffic than its event has. */
  setTraffic(share: number): void {
    if (this.traffic) this.traffic.density = share;
  }

  /** Puts everything away after a race. */
  end(): void {
    this.clearAgents();
    this.phase = 'idle';
    this.event = null;
    this.course = null;
    this.policeWanted = 0;
    this.standings.length = 0;
    this.nextGate.valid = false;
    this.playerCar.powertrain.manual = false;
    if (this.traffic) this.traffic.density = 1;
  }

  private clearAgents(): void {
    for (const agent of this.agents) agent.retire();
    this.agents.length = 0;
  }

  /** Where the car goes if the player asks to get back on the road during a race. */
  resetPose(): SpawnPose | null {
    const course = this.course;
    if (!course || this.family === 'hunt' || this.family === 'gates') return null;
    const sample = this.sample;
    const progress = Math.max(0, this.playerProgress - 6);
    const s = course.toLineS(progress);
    course.line.sample(s, sample);
    this.lineS = s;
    this.playerProgress = progress;
    return { position: { x: sample.x, y: sample.y + 0.8, z: sample.z }, yaw: Math.atan2(sample.tx, sample.tz) };
  }

  /** The gates a player or the map should see, in order. */
  get gateList(): readonly OpenGate[] {
    return this.openGates;
  }
}

export type TauntKind = 'passed' | 'passing' | 'bump' | 'provoked' | 'finishFirst';
