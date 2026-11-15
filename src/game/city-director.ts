/**
 * Runs everything that lives in the city while the player drives: traffic, people, the horn language,
 * GPS, minimap, near-miss rewards, ambient sound and the horn tutorial.
 */

import { Mesh, MeshBasicMaterial, CylinderGeometry, AdditiveBlending, Color, type Scene, type PerspectiveCamera, type Vector3 } from 'three';
import type { AudioEngine } from '../audio/audio-engine';
import { speakRadioLine, stopRadioVoice } from '../audio/radio-voice';
import { CITY } from '../config/city-tuning';
import { POLICE } from '../config/police-tuning';
import { RACE } from '../config/race-tuning';
import type { QualityPreset } from '../config/tuning';
import type { EventBus, HornPattern } from '../core/events';
import { clamp } from '../core/math';
import { t } from '../i18n';
import { GpsNavigator } from '../gps/gps-navigator';
import { HornLanguage } from '../horn/horn-language';
import { PedestrianRender } from '../pedestrians/pedestrian-render';
import { PedestrianSystem, type PedestrianCar } from '../pedestrians/pedestrian-system';
import type { PhysicsWorld } from '../physics/physics-world';
import { ParticlePool } from '../fx/particle-pool';
import { HideSpots } from '../police/hide-spots';
import { PoliceRadio } from '../police/police-radio';
import { PoliceRender } from '../police/police-render';
import { PoliceSystem, type PoliceTarget } from '../police/police-system';
import { getSettings, updateSettings } from '../save/settings';
import { TrapRender } from '../traps/trap-render';
import { TrapSystem } from '../traps/trap-system';
import { TrafficLightsRender, TrafficRender } from '../traffic/traffic-render';
import { TRAFFIC_TYPES, TrafficSystem, type TrafficPlayer, type TrafficView } from '../traffic/traffic-system';
import { BustedScreen } from '../ui/busted-screen';
import { CityHud } from '../ui/city-hud';
import { MapScreen, placeName } from '../ui/map-screen';
import { MapPainter } from '../ui/minimap';
import { PursuitHud } from '../ui/pursuit-hud';
import type { Screens } from '../ui/screens';
import type { SpawnPose, VehicleController } from '../vehicle/vehicle-controller';
import { DISTRICT_NAME_KEYS, POINTS_OF_INTEREST, districtAt } from '../world/city/city-map';
import type { CityWorld } from '../world/city/city-world';
import { getCareer } from '../save/career';
import { CareerDirector, type CareerHost } from './career-director';
import type { ReplayActor } from '../replay/replay-player';
import { DomMeter } from './dom-meter';
import { RaceDirector, type RaceHost } from './race-director';

/** What the city needs from the game around it. */
export interface CityGameHost {
  placeCar(pose: SpawnPose): void;
  pauseFor(screen: 'ring' | 'raceResult'): void;
  resume(): void;
  careerReset(): void;
  carChanged(): void;
  restCar(): void;
  enterGarage(): void;
  enterStall: CareerHost['enterStall'];
  forceWeather(weather: 'monsoon' | null): void;
  openReplay(): void;
  setConditions: RaceHost['setConditions'];
  runFinished: RaceHost['runFinished'];
  openChallenges(): void;
}

type TutorialStep = 'tap' | 'long' | 'double' | 'tip' | 'done';

export class CityDirector {
  readonly traffic: TrafficSystem;
  readonly people: PedestrianSystem;
  readonly gps: GpsNavigator;
  readonly hud: CityHud;
  readonly mapScreen: MapScreen;
  readonly police: PoliceSystem;
  readonly traps: TrapSystem;
  readonly dom = new DomMeter();
  readonly pursuitHud: PursuitHud;
  readonly race: RaceDirector;
  readonly career: CareerDirector;
  /** Lets the game stop everything when the player is arrested. */
  onBusted: (() => void) | null = null;

  private readonly policeRender: PoliceRender;
  private readonly trapRender: TrapRender;
  private readonly radio: PoliceRadio;
  private readonly bustedScreen: BustedScreen;
  private readonly policeTarget: PoliceTarget;
  private readonly policeCars: PedestrianCar[];
  private readonly policePoints = new Float32Array(32);
  private readonly racerPoints = new Float32Array(32);
  private policeTipTimer = 0;
  private wasDomActive = false;
  private readonly trafficRender: TrafficRender;
  private readonly lightsRender: TrafficLightsRender;
  private readonly peopleRender: PedestrianRender;
  private readonly horn = new HornLanguage();
  private readonly beacon: Mesh;
  private readonly steam: ParticlePool;
  private readonly player: TrafficPlayer;
  private readonly carState: PedestrianCar;
  private readonly view: TrafficView = { x: 0, z: 0, fx: 0, fz: 1 };
  private readonly scratchAgents: number[] = [];
  private readonly painter: MapPainter;

  private destinationPoi: string | null = null;
  private ambientHornTimer = 2;
  private ambientBellTimer = 3;
  private steamTimer = 0;
  private tutorialStep: TutorialStep;
  private tipTimer = 0;
  private started = false;

  constructor(
    scene: Scene,
    private readonly world: CityWorld,
    physics: PhysicsWorld,
    bus: EventBus,
    preset: QualityPreset,
    private readonly car: VehicleController,
    private readonly audio: AudioEngine,
    uiRoot: HTMLElement,
    private readonly screens: Screens,
    private readonly onCloseMap: () => void,
    game: CityGameHost,
  ) {
    const network = world.network;
    this.traffic = new TrafficSystem(network, physics, bus, preset.trafficTotal, preset.trafficBodies);
    this.trafficRender = new TrafficRender(scene, this.traffic, preset);
    this.lightsRender = new TrafficLightsRender(scene, network, this.traffic);
    this.people = new PedestrianSystem(network, preset.pedestrians, world.props.gatherings);
    this.peopleRender = new PedestrianRender(scene, this.people);
    this.gps = new GpsNavigator(network);

    const hideSpots = new HideSpots(network, world.garages, world.props.stalls);
    this.police = new PoliceSystem(network, physics, bus, preset, this.traffic, (x, y, z, kmh) => hideSpots.query(x, y, z, kmh), getSettings().policeDifficulty);
    this.policeRender = new PoliceRender(scene, this.police, preset);
    this.traps = new TrapSystem(physics, bus, world.traps);
    this.traps.stun = (x, z, radius) => this.police.stunNear(x, z, radius);
    this.trapRender = new TrapRender(scene, this.traps);
    this.policeTarget = { x: 0, y: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 1, speed: 0, car };
    // Room for every police car, and every racer as well.
    this.policeCars = Array.from({ length: this.police.units.length + 8 }, () => ({ x: 0, y: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 1, speed: 0, halfLength: 2.1, halfWidth: 0.95 }));

    const painter = new MapPainter(network);
    this.painter = painter;
    painter.paintSpots(world.garages, world.props.stalls.filter((stall) => stall.isTea), world.traps, world.garageHome);
    this.hud = new CityHud(uiRoot, painter);
    this.pursuitHud = new PursuitHud(uiRoot);
    this.radio = new PoliceRadio(
      bus,
      (line, category) => {
        this.pursuitHud.showRadio(line, category);
        this.audio.playRadioBlip();
        if (getSettings().radioVoice) speakRadioLine(line);
      },
      () => t(DISTRICT_NAME_KEYS[districtAt(this.player.x, this.player.z)]),
    );
    this.bustedScreen = new BustedScreen(() => this.onBustedContinue?.());
    screens.attachBusted(this.bustedScreen.element);
    this.race = new RaceDirector(scene, network, physics, bus, preset, car, this.traffic, audio, uiRoot, screens, {
      placeCar: (pose) => game.placeCar(pose),
      pauseFor: (screen) => game.pauseFor(screen),
      resume: () => game.resume(),
      policeActive: () => this.police.heat.isActive,
      clearPolice: () => {
        this.clearPolice();
      },
      summonPolice: (stars) => {
        this.police.enabled = true;
        this.police.heat.startPursuit();
        this.police.heat.addHeat(stars * RACE.boss.heatPerStar);
      },
      clearGps: () => this.clearDestination(),
      slowMoment: (seconds, scale) => this.dom.dip(seconds, scale),
      afterResult: (change) => this.career.afterRace(change),
      careerReset: () => game.careerReset(),
      forceWeather: (weather) => game.forceWeather(weather),
      openReplay: () => game.openReplay(),
      setConditions: (conditions) => game.setConditions(conditions),
      runFinished: (run) => game.runFinished(run),
      openChallenges: () => game.openChallenges(),
    });
    this.career = new CareerDirector(bus, uiRoot, world, this.hud, {
      phone: (from, text, seconds) => this.race.phone(from, text, seconds),
      routeTo: (poiId) => this.setRoute(poiId),
      clearRoute: () => this.clearDestination(),
      policeActive: () => this.police.heat.isActive,
      racing: () => this.race.isActive,
      raceOffered: () => this.race.hasOffer,
      carChanged: () => game.carChanged(),
      restCar: () => game.restCar(),
      enterGarage: () => game.enterGarage(),
      enterStall: (stall, index) => game.enterStall(stall, index),
    });
    this.mapScreen = new MapScreen(painter, network, {
      choose: (poiId) => this.chooseDestination(poiId),
      clearRoute: () => this.clearDestination(),
      close: () => this.onCloseMap(),
    });
    screens.attachMap(this.mapScreen.element);

    this.traffic.onPlayerVelocity = (vx, vz) => {
      const v = car.body.linvel();
      car.body.setLinvel({ x: vx, y: v.y, z: vz }, true);
    };

    this.player = { x: 0, y: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 1, speed: 0, halfLength: 1.95, halfWidth: 0.88, mass: 1150 };
    this.carState = { x: 0, y: 0, z: 0, vx: 0, vz: 0, fx: 0, fz: 1, speed: 0, halfLength: 1.95, halfWidth: 0.88 };

    bus.on('nearMiss', ({ squeeze, points, nitro }) => {
      car.addNitro(nitro);
      this.dom.add(squeeze ? POLICE.dom.squeeze : POLICE.dom.nearMiss);
      this.career.payRoam(points);
      this.onNearMissReward?.(squeeze, points);
      if (squeeze && this.tutorialStep === 'tip') this.setTutorialStep('done');
    });
    bus.on('trafficHit', ({ agent, soft }) => {
      if (soft) this.audio.playDistantHorn(0.1, 0, 1, 0.3);
      this.hud.say('city.bubble.hit', this.traffic.x[agent], this.traffic.y[agent], this.traffic.z[agent], 3);
    });

    bus.on('pursuitPhase', ({ phase, previous }) => {
      if (phase === 'pursuit' && previous === 'calm') this.showPursuitTip();
    });
    bus.on('pursuitEscaped', ({ points }) => {
      this.career.payEscape(points);
      this.pursuitHud.showEscaped(points);
      updateSettings({ policeDifficulty: this.police.adaptive.value });
    });
    bus.on('pursuitBusted', ({ stars, seconds, fine }) => {
      // In a race the arrest ends the race, and the race's own results explain it.
      if (this.race.isActive) return;
      this.bustedScreen.show(stars, seconds, this.career.payFine(fine));
      updateSettings({ policeDifficulty: this.police.adaptive.value });
      this.onBusted?.();
    });
    bus.on('trapSprung', ({ stunned }) => {
      const config = POLICE.traps;
      car.addNitro(config.nitro);
      this.dom.add(POLICE.dom.trap);
      this.dom.dip(config.slowMoSeconds, config.slowMoScale);
      this.career.payRoam(config.points);
      if (!getCareer().addaMode) this.police.heat.addHeat(POLICE.heat.trap);
      this.pursuitHud.showBanner(stunned > 0 ? t('police.hud.trapStunned', { count: stunned }) : t('police.hud.trap'), 2.4);
    });
    bus.on('spikeHit', () => this.audio.playSpikeHit());

    this.beacon = new Mesh(
      new CylinderGeometry(CITY.gps.beaconRadius, CITY.gps.beaconRadius, CITY.gps.beaconHeight, 16, 1, true),
      new MeshBasicMaterial({
        color: new Color(0.25, 1.4, 1.1),
        transparent: true,
        opacity: 0.32,
        blending: AdditiveBlending,
        depthWrite: false,
        side: 2,
        toneMapped: false,
      }),
    );
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;
    scene.add(this.beacon);

    this.steam = new ParticlePool(36, false, 0, 0.6, 0.55);
    scene.add(this.steam.mesh);

    this.tutorialStep = getSettings().hornTutorialDone ? 'done' : 'tap';
    this.hud.onTutorialSkip = () => this.setTutorialStep('done');
  }

  /** How hard it is raining, kept up to date by the game. */
  rainNow = 0;

  /** Marks the low roads on the map, once the game knows where they are. */
  paintFloods(floods: ReadonlyArray<{ x: number; z: number; yaw: number; halfLength: number; halfWidth: number }>): void {
    this.painter.paintSpots([], [], [], null, floods);
  }

  /** Traffic takes its place from a replay rather than from the road. */
  setTrafficReplay(on: boolean): void {
    this.trafficRender.replaying = on;
  }

  /** Everyone whose position a replay needs to record. */
  get replayActors(): ReplayActor[] {
    return [...this.police.units, ...this.race.session.agents];
  }

  /** Lets the game put the car back on the road after an arrest. */
  onBustedContinue: (() => void) | null = null;

  /** Lets the game show a callout for a near miss. */
  onNearMissReward: ((squeeze: boolean, points: number) => void) | null = null;

  /** Fills the streets before the title screen shows them. */
  prepare(cameraX: number, cameraZ: number, fx: number, fz: number): void {
    this.readCar();
    this.view.x = cameraX;
    this.view.z = cameraZ;
    this.view.fx = fx;
    this.view.fz = fz;
    this.traffic.prewarm(this.player, this.view);
    this.people.keepOutRadius = CITY.pedestrians.titleKeepOutRadius;
    // A minute of simulated life spreads vehicles out and lets people start walking.
    for (let i = 0; i < 300; i++) {
      this.traffic.update(1 / 30, this.player, this.view);
      this.people.update(1 / 30, this.carState, fx, fz);
    }
  }

  private readCar(): void {
    const car = this.car;
    const position = car.position;
    const velocity = car.velocity;
    const quaternion = car.quaternion;
    const fx = 2 * (quaternion.x * quaternion.z + quaternion.w * quaternion.y);
    const fz = 1 - 2 * (quaternion.x * quaternion.x + quaternion.y * quaternion.y);
    const length = Math.hypot(fx, fz) || 1;
    const player = this.player;
    player.x = position.x;
    player.y = position.y - 0.65;
    player.z = position.z;
    player.vx = velocity.x;
    player.vz = velocity.z;
    player.fx = fx / length;
    player.fz = fz / length;
    player.speed = car.telemetry.speed;
    const state = this.carState;
    state.x = player.x;
    state.y = player.y;
    state.z = player.z;
    state.vx = player.vx;
    state.vz = player.vz;
    state.fx = player.fx;
    state.fz = player.fz;
    state.speed = player.speed;
    const target = this.policeTarget;
    target.x = player.x;
    target.y = player.y;
    target.z = player.z;
    target.vx = player.vx;
    target.vz = player.vz;
    target.fx = player.fx;
    target.fz = player.fz;
    target.speed = player.speed;
  }

  /** Before the physics step: the police decide and steer. */
  beforePhysics(dt: number, driving: boolean): void {
    // In আড্ডা mode nobody chases anybody, unless a race itself calls them in.
    this.police.enabled = driving && this.race.policeAllowed && (this.race.isActive || !getCareer().addaMode);
    if (!driving) return;
    this.readCar();
    this.traffic.externalObstacleCount = 0;
    this.police.preStep(dt, this.policeTarget, this.view);
    this.race.preStep(dt, this.view.x, this.view.z, this.view.fx, this.view.fz);
  }

  /** One physics step of city life. */
  fixedUpdate(dt: number, cameraPosition: Vector3, cameraFx: number, cameraFz: number, driving: boolean): void {
    this.readCar();
    this.view.x = cameraPosition.x;
    this.view.z = cameraPosition.z;
    this.view.fx = cameraFx;
    this.view.fz = cameraFz;
    this.traffic.update(dt, this.player, this.view);
    if (driving) {
      this.traps.update(dt, this.player.x, this.player.y, this.player.z, this.player.speed);
      this.police.postStep(dt, this.policeTarget, this.view);
      this.race.postStep(dt);
    }
  }

  /** How fast time should run this frame, given the দম button. */
  updateDom(realDt: number, held: boolean, drifting: boolean): number {
    const scale = this.dom.update(realDt, held, drifting);
    if (this.dom.active !== this.wasDomActive) {
      this.wasDomActive = this.dom.active;
      this.audio.playBreath(this.dom.active);
    }
    return scale;
  }

  /** Runs once per frame while driving. simDt is slowed by দম, and realDt is not. */
  frame(realDt: number, simDt: number, horn: boolean, camera: PerspectiveCamera, width: number, height: number, driving: boolean): void {
    this.readCar();
    this.people.keepOutRadius = driving ? 0 : CITY.pedestrians.titleKeepOutRadius;
    this.publishPoliceCars();
    this.people.update(simDt, this.carState, this.view.fx, this.view.fz);
    this.steam.update(simDt);
    this.emitSteam(simDt);
    this.career.frame(realDt, this.player.x, this.player.z, this.player.speed, this.dom.active, driving, this.rainNow);

    if (!driving) return;
    const dt = realDt;
    if (!this.started) {
      this.started = true;
      this.audio.setCityAmbience(CITY.horn.ambientGain);
      this.setTutorialStep(this.tutorialStep);
    }

    const pattern = this.horn.update(dt, horn);
    if (pattern) {
      this.onHornPattern(pattern);
      if (pattern === 'tap') this.career.tracker.count('hornTaps');
    }

    this.updateAmbientSound(dt);
    this.updateNavigation(dt);
    this.updateTutorial(dt);
    this.updatePursuit(dt);
    this.race.frame(dt, camera, width, height, this.player.x, this.player.z, this.player.speed);
    this.hud.setDistrict(districtAt(this.player.x, this.player.z));
    this.hud.update(dt, camera, width, height);
  }

  /** Draws traffic, lights and the police. Runs every frame in every state. */
  render(back: number, alpha: number, dt: number): void {
    this.trafficRender.update(back);
    this.lightsRender.update();
    this.peopleRender.update();
    this.trapRender.update();
    this.policeRender.update(alpha, dt);
    this.race.draw(alpha, dt);
  }

  /** People step out of the way of police cars as well, and never get touched. */
  private publishPoliceCars(): void {
    const extras = this.people.extraCars;
    extras.length = 0;
    this.police.units.forEach((unit, index) => {
      if (!unit.active || unit.distance > 90) return;
      const q = unit.car.quaternion;
      const fx = 2 * (q.x * q.z + q.w * q.y);
      const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
      const length = Math.hypot(fx, fz) || 1;
      const car = this.policeCars[index];
      car.x = unit.currX;
      car.y = unit.currY - 0.65;
      car.z = unit.currZ;
      car.vx = unit.car.velocity.x;
      car.vz = unit.car.velocity.z;
      car.fx = fx / length;
      car.fz = fz / length;
      car.speed = unit.car.telemetry.speed;
      extras.push(car);
    });
    // Racers are cars like any other, and people get out of their way too.
    let spare = this.police.units.length;
    for (const agent of this.race.session.agents) {
      if (!agent.active || spare >= this.policeCars.length) continue;
      if (Math.hypot(agent.currX - this.player.x, agent.currZ - this.player.z) > 90) continue;
      const car = this.policeCars[spare++];
      car.x = agent.currX;
      car.y = agent.currY - 0.65;
      car.z = agent.currZ;
      car.vx = agent.car.velocity.x;
      car.vz = agent.car.velocity.z;
      car.fx = agent.fx;
      car.fz = agent.fz;
      car.speed = agent.car.telemetry.speed;
      extras.push(car);
    }
  }

  private updatePursuit(dt: number): void {
    const police = this.police;
    const heat = police.heat;
    this.radio.update(dt);
    this.pursuitHud.update(dt, {
      phase: heat.phase,
      stars: heat.stars,
      cooldown: heat.cooldown,
      bust: heat.bust,
      hideKind: police.hide.kind,
      punctured: this.car.telemetry.puncture > 0,
      domValue: this.dom.value,
      domActive: this.dom.active,
      domAmount: this.dom.amount,
    });
    this.audio.setSlowMotion(this.dom.amount);

    // Sound and the minimap only need the nearest things.
    const config = POLICE.audio;
    let siren = 0;
    let sirenPan = 0;
    let count = 0;
    for (const unit of police.units) {
      if (!unit.active) continue;
      if (unit.distance < 320 && count < 16) {
        this.policePoints[count * 2] = unit.currX;
        this.policePoints[count * 2 + 1] = unit.currZ;
        count++;
      }
      if (unit.role === 'roam' || unit.stunSeconds > 0) continue;
      const level = Math.pow(clamp(1 - unit.distance / config.sirenRange, 0, 1), 1.5);
      if (level > siren) {
        siren = level;
        sirenPan = this.panFor(unit.currX, unit.currZ);
      }
    }
    const heli = police.helicopter;
    const drone = police.drone;
    const distanceTo = (x: number, y: number, z: number): number => Math.hypot(x - this.player.x, y - this.player.y, z - this.player.z);
    const heliLevel = heli.active ? Math.pow(clamp(1 - distanceTo(heli.x, heli.y, heli.z) / config.heliRange, 0, 1), 1.2) : 0;
    const droneLevel = drone.active ? clamp(1 - distanceTo(drone.x, drone.y, drone.z) / config.droneRange, 0, 1) : 0;
    this.audio.updatePursuitSounds(
      siren,
      sirenPan,
      heliLevel,
      heli.active ? this.panFor(heli.x, heli.z) : 0,
      droneLevel,
      drone.active ? this.panFor(drone.x, drone.z) : 0,
    );
    this.hud.minimap.setPolice(this.policePoints, count, heli.active ? heli.x : null, heli.z);

    if (this.policeTipTimer > 0) {
      this.policeTipTimer -= dt;
      if (this.policeTipTimer <= 0) this.hud.setTutorial(null);
    }
  }

  /** The first time the police give chase, ওস্তাদ says how to shake them off. */
  private showPursuitTip(): void {
    if (getSettings().pursuitTipDone || this.tutorialStep !== 'done') return;
    updateSettings({ pursuitTipDone: true });
    this.policeTipTimer = 15;
    this.hud.setTutorial('city.tutorial.pursuit');
  }

  /** Called on the way out of the arrest screen: the street is empty again. */
  clearPolice(): void {
    this.police.clear();
    this.traps.clear();
    this.radio.clear();
    this.pursuitHud.clear();
    this.dom.reset();
    this.people.extraCars.length = 0;
    this.audio.updatePursuitSounds(0, 0, 0, 0, 0, 0);
    this.audio.setSlowMotion(0);
    stopRadioVoice();
    this.car.clearPuncture();
  }

  private emitSteam(dt: number): void {
    this.steamTimer -= dt;
    if (this.steamTimer > 0) return;
    this.steamTimer = 0.14;
    const radius = CITY.props.steamStallRadius;
    for (const stall of this.world.props.stalls) {
      if (!stall.isTea || Math.hypot(stall.x - this.player.x, stall.z - this.player.z) > radius) continue;
      this.steam.spawn({
        x: stall.x,
        y: stall.y,
        z: stall.z,
        vx: (Math.random() - 0.5) * 0.15,
        vy: 0.45,
        vz: (Math.random() - 0.5) * 0.15,
        life: 1.5,
        startSize: 0.14,
        endSize: 0.7,
        opacity: 0.22,
        r: 0.82,
        g: 0.82,
        b: 0.8,
      });
    }
  }

  private onHornPattern(pattern: HornPattern): void {
    const player = this.player;
    this.scratchAgents.length = 0;
    if (pattern === 'tap') {
      const response = this.traffic.hornYield(player);
      this.hud.showHornPattern(response.count > 0 ? 'city.horn.tap' : 'city.horn.nobody');
      if (response.sample >= 0) {
        const type = TRAFFIC_TYPES[this.traffic.type[response.sample]];
        const height = CITY.trafficTypes[type].height + 0.5;
        this.hud.say('city.bubble.yield', this.traffic.x[response.sample], this.traffic.y[response.sample], this.traffic.z[response.sample], height);
        if (this.tutorialStep === 'tap') this.setTutorialStep('long');
      }
    } else if (pattern === 'long') {
      const response = this.people.scatter(this.carState);
      this.hud.showHornPattern(response.count > 0 ? 'city.horn.long' : 'city.horn.nobody');
      if (response.sample >= 0) {
        this.hud.say('city.bubble.scatter', this.people.x[response.sample], this.people.y[response.sample], this.people.z[response.sample], 2.1);
        if (this.tutorialStep === 'long') this.setTutorialStep('double');
      }
    } else if (pattern === 'double') {
      const honkers = this.traffic.nearestAgents(player.x, player.z, CITY.horn.honkBackRadius, CITY.horn.honkBackMax, this.scratchAgents);
      this.hud.showHornPattern(honkers.length > 0 ? 'city.horn.double' : 'city.horn.nobody');
      honkers.forEach((agent, index) => {
        window.setTimeout(() => this.honkFrom(agent, 0.7), 120 + index * 150);
      });
      // In a race, two taps get a rival's back up.
      if (this.race.provoke() > 0) this.hud.showHornPattern('city.horn.provoke');
      if (honkers.length > 0) {
        const first = honkers[0];
        this.hud.say('city.bubble.honkBack', this.traffic.x[first], this.traffic.y[first], this.traffic.z[first], 3);
        if (this.tutorialStep === 'double') this.setTutorialStep('tip');
      }
    } else if (pattern === 'triple') {
      const fooled = this.police.hornConfuse();
      this.hud.showHornPattern(fooled > 0 ? 'city.horn.triple' : 'city.horn.tripleNone');
      if (fooled > 0) {
        // Everyone joins in, which is the whole point.
        this.traffic.nearestAgents(player.x, player.z, CITY.horn.honkBackRadius, CITY.horn.honkBackMax, this.scratchAgents).forEach((agent, index) => {
          window.setTimeout(() => this.honkFrom(agent, 0.9), 90 + index * 110);
        });
      }
    }
  }

  private panFor(x: number, z: number): number {
    // Player's right is (fz, -fx) in this coordinate frame.
    const dx = x - this.player.x;
    const dz = z - this.player.z;
    const distance = Math.hypot(dx, dz) || 1;
    return clamp(((dx * -this.player.fz + dz * this.player.fx) / distance) * 0.8, -1, 1);
  }

  private honkFrom(agent: number, loudness: number): void {
    if (!this.traffic.alive[agent]) return;
    const x = this.traffic.x[agent];
    const z = this.traffic.z[agent];
    const distance = Math.hypot(x - this.player.x, z - this.player.z);
    const gain = (0.16 * loudness) / (1 + distance / 40);
    this.audio.playDistantHorn(gain, this.panFor(x, z), 0.85 + Math.random() * 0.4, 0.16 + Math.random() * 0.22);
  }

  /** Horn culture: there is always someone honking, and a rickshaw bell somewhere. */
  private updateAmbientSound(dt: number): void {
    const config = CITY.horn;
    this.ambientHornTimer -= dt;
    if (this.ambientHornTimer <= 0) {
      this.ambientHornTimer = config.ambientHornEvery * (0.4 + Math.random() * 1.2);
      const agents = this.traffic.nearestAgents(this.player.x + (Math.random() - 0.5) * 200, this.player.z + (Math.random() - 0.5) * 200, config.ambientHornRadius, 1, this.scratchAgents);
      if (agents.length > 0) this.honkFrom(agents[0], 0.55);
    }
    this.ambientBellTimer -= dt;
    if (this.ambientBellTimer <= 0) {
      this.ambientBellTimer = config.ambientBellEvery * (0.5 + Math.random());
      for (let agent = 0; agent < this.traffic.capacity; agent++) {
        if (!this.traffic.alive[agent] || TRAFFIC_TYPES[this.traffic.type[agent]] !== 'rickshaw') continue;
        const x = this.traffic.x[agent];
        const z = this.traffic.z[agent];
        const distance = Math.hypot(x - this.player.x, z - this.player.z);
        if (distance < 70) {
          this.audio.playBell(0.05 / (1 + distance / 25), this.panFor(x, z));
          break;
        }
      }
    }
  }

  private updateNavigation(dt: number): void {
    const player = this.player;
    const gps = this.gps;
    if (this.race.isActive) {
      let count = 0;
      for (const agent of this.race.session.agents) {
        if (!agent.active || agent.eliminated || count >= 16) continue;
        this.racerPoints[count * 2] = agent.currX;
        this.racerPoints[count * 2 + 1] = agent.currZ;
        count++;
      }
      this.hud.minimap.setRacers(this.racerPoints, count);
      const target = this.race.targetPoint;
      this.hud.minimap.update(dt, player.x, player.z, player.fx, player.fz, this.race.routePoints, target ? target.x : null, target ? target.z : null);
      return;
    }
    this.hud.minimap.setRacers(this.racerPoints, 0);
    this.hud.minimap.update(
      dt,
      player.x,
      player.z,
      player.fx,
      player.fz,
      gps.routePoints,
      gps.isActive ? this.world.network.nodes[gps.destination].x : null,
      gps.isActive ? this.world.network.nodes[gps.destination].z : null,
    );
    if (!gps.isActive || !this.destinationPoi) return;
    gps.update(dt, player.x, player.y, player.z, player.fx, player.fz);
    const name = placeName(this.destinationPoi);
    if (gps.arrived) {
      this.hud.showArrived(name);
      this.career.payRoam(500);
      this.clearDestination(false);
      return;
    }
    this.hud.updateGps(gps.instruction, name);
  }

  private chooseDestination(poiId: string): void {
    this.setRoute(poiId);
    this.onCloseMap();
  }

  /** Where a named place is, for the photo challenge. */
  poiPosition(poiId: string): { x: number; z: number } | null {
    const poi = POINTS_OF_INTEREST.find((candidate) => candidate.id === poiId);
    if (!poi) return null;
    const node = this.world.network.nodes[this.world.network.nodeIndex(poi.node)];
    return node ? { x: node.x, z: node.z } : null;
  }

  /**
   * Calls the police in, for the jam-escape challenge.
   * @returns false in আড্ডা mode, where there are no police
   */
  summonPolice(stars: number): boolean {
    if (getCareer().addaMode) return false;
    this.police.enabled = true;
    const heat = this.police.heat;
    heat.startPursuit();
    // Exactly the stars asked for: just past that level's score.
    const level = POLICE.levels[Math.max(0, Math.min(POLICE.levels.length, stars) - 1)];
    heat.addHeat(Math.max(0, level.score - heat.score) + 1);
    return true;
  }

  /** Draws a GPS route to a named place. */
  setRoute(poiId: string): void {
    const poi = POINTS_OF_INTEREST.find((candidate) => candidate.id === poiId);
    if (!poi) return;
    const network = this.world.network;
    const nodeIndex = network.nodeIndex(poi.node);
    this.readCar();
    if (this.gps.setDestination(nodeIndex, this.player.x, this.player.y, this.player.z, this.player.fx, this.player.fz)) {
      this.destinationPoi = poiId;
      const node = network.nodes[nodeIndex];
      this.beacon.position.set(node.x, node.y + CITY.gps.beaconHeight / 2, node.z);
      this.beacon.visible = true;
    }
  }

  clearDestination(hideHud = true): void {
    this.gps.clear();
    this.destinationPoi = null;
    this.beacon.visible = false;
    if (hideHud) this.hud.hideGps();
  }

  /** Opens the map with the current state drawn on it. */
  openMap(): void {
    this.readCar();
    this.mapScreen.setFlags(this.race.isActive ? [] : this.race.flagList);
    this.mapScreen.show(this.player.x, this.player.z, this.player.fx, this.player.fz, this.race.isActive ? this.race.routePoints : this.gps.routePoints, this.gps.destination);
    this.screens.open('map');
  }

  private setTutorialStep(step: TutorialStep): void {
    this.tutorialStep = step;
    if (step === 'done') {
      this.hud.setTutorial(null);
      updateSettings({ hornTutorialDone: true });
      return;
    }
    if (step === 'tip') this.tipTimer = 16;
    this.hud.setTutorial(`city.tutorial.${step}`);
  }

  private updateTutorial(dt: number): void {
    if (this.tutorialStep !== 'tip') return;
    this.tipTimer -= dt;
    if (this.tipTimer <= 0) this.setTutorialStep('done');
  }

  /** Slower, softer flashing for players who asked for less motion. */
  setReduceMotion(value: boolean): void {
    this.policeRender.setReduceMotion(value);
    this.race.setReduceMotion(value);
  }

  setHudVisible(visible: boolean): void {
    this.hud.setVisible(visible);
    this.pursuitHud.setVisible(visible);
    this.race.setHudVisible(visible);
    this.career.hud.setVisible(visible);
  }

  /** Back to an empty city and a fresh start. */
  restart(): void {
    this.clearDestination();
    this.hud.clearTransient();
    this.race.abandon();
    this.clearPolice();
  }
}
