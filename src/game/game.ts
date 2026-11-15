/** The game: owns every system and moves between title, driving and paused. */

import { PMREMGenerator, Quaternion, Scene, Vector3 } from 'three';
import { AudioEngine } from '../audio/audio-engine';
import { VehicleRig } from '../animation/vehicle-rig';
import { ChaseCamera } from '../camera/chase-camera';
import { StopCamera } from '../camera/stop-camera';
import { CARS, CAR_BY_ID, type LiveryDef, type PartKind } from '../config/cars';
import { ATMOSPHERE } from '../config/atmosphere';
import { PROGRESS } from '../config/progression';
import { QUALITY_PRESETS, TUNING, type QualityName, type QualityPreset } from '../config/tuning';
import { EventBus } from '../core/events';
import { GameLoop } from '../core/loop';
import { clamp01 } from '../core/math';
import { VehicleFx } from '../fx/vehicle-fx';
import { InputManager } from '../input/input-manager';
import { createIntent } from '../input/intent';
import { TouchInput } from '../input/touch';
import RAPIER from '@dimforge/rapier3d-compat';
import type { MusicContext } from '../audio/music-patterns';
import { GROUP_WHEEL_RAY, PhysicsWorld, loadPhysicsEngine } from '../physics/physics-world';
import { buyCar, buyPart, limpScales, performanceIndex, repairCost, selectCar, spend, statsWithParts } from '../progression/economy';
import { LapTimer } from '../race/lap-timer';
import { enableReflection } from '../render/planar-reflection';
import { detectQuality } from '../render/quality';
import { RenderPipeline } from '../render/render-pipeline';
import { ReplayPlayer } from '../replay/replay-player';
import { flushCareer, getCareer, loadCareer, saveCareer } from '../save/career';
import { getSettings, loadBestLap, saveBestLap } from '../save/settings';
import { AddaScreen } from '../ui/adda-screen';
import { clockWords, weatherWord } from '../ui/clock-words';
import { PhotoScreen, type PhotoLook, type PhotoValues } from '../ui/photo-screen';
import { ReplayScreen } from '../ui/replay-screen';
import { DevPanel } from '../ui/dev-panel';
import { GarageScreen } from '../ui/garage-screen';
import { Hud } from '../ui/hud';
import { LedgerScreen } from '../ui/ledger-screen';
import { Screens } from '../ui/screens';
import { createCarVisual, type CarVisual } from '../vehicle/car-models';
import { DriftScorer } from '../vehicle/drift-scorer';
import { VehicleController, type SpawnPose } from '../vehicle/vehicle-controller';
import { createEnvironmentScene } from '../world/city-backdrop';
import type { StallSpot } from '../world/city/city-props';
import { CityWorld } from '../world/city/city-world';
import { TestRoad } from '../world/test-road';
import { AtmosphereRuntime } from '../world/atmosphere/atmosphere-runtime';
import { placeName } from '../ui/map-screen';
import { POINTS_OF_INTEREST } from '../world/city/city-map';
import { CityDirector } from './city-director';
import { SoundDirector } from './sound-director';
import { ExtrasDirector } from './extras-director';
import type { SkyConditions } from '../config/challenges';
import { applyAccessibility } from '../ui/accessibility';

/** Parked is the garage or a tea stall: the city runs on, and the car stands still. */
type GameState = 'title' | 'driving' | 'paused' | 'parked' | 'replay' | 'photo' | 'spectate';

const ZERO = new Vector3();

export function resolveQuality(): QualityName {
  const setting = getSettings().quality;
  return setting === 'auto' ? detectQuality() : setting;
}

export class Game {
  readonly bus = new EventBus();
  readonly quality: QualityName;
  private readonly preset: QualityPreset;
  private readonly scene = new Scene();
  private readonly physics: PhysicsWorld;
  /** Exactly one of these two worlds exists. */
  private readonly testRoad: TestRoad | null = null;
  private readonly city: CityWorld | null = null;
  private readonly director: CityDirector | null = null;
  private readonly car: VehicleController;
  private rig!: VehicleRig;
  private visual: CarVisual | null = null;
  private shownCar = '';
  private readonly fx: VehicleFx;
  private readonly camera: ChaseCamera;
  private readonly stopCamera = new StopCamera();
  private readonly garageScreen: GarageScreen | null = null;
  private readonly addaScreen: AddaScreen | null = null;
  private readonly ledgerScreen: LedgerScreen;
  private parkedAt: 'garage' | 'adda' | null = null;
  private parkedFromTitle = false;
  private readonly atmosphere: AtmosphereRuntime | null = null;
  private sound: SoundDirector | null = null;
  /** Challenges, the season, leaderboards and friends. City world only. */
  private extras: ExtrasDirector | null = null;
  /** A run is holding the sky to its own hour and weather. */
  private conditionsActive = false;
  private replay: ReplayPlayer | null = null;
  private replayScreen: ReplayScreen | null = null;
  private readonly photoScreen: PhotoScreen;
  private replayReturn: 'pause' | 'raceResult' = 'pause';
  private photoReturn: 'driving' | 'pause' | 'replay' | 'title' = 'driving';
  private readonly savedCamera = { position: new Vector3(), quaternion: new Quaternion(), fov: 60 };
  private readonly photo = { yaw: 0, pitch: 0.2, distance: 7, roll: 0, fov: 42, blur: 0, time: 0, startTime: 0 };
  private potholeCooldown = 0;
  private splashTimer = 0;
  private clockTimer = 0;
  private audioOpened = false;
  private readonly floodRay = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
  private readonly pipeline: RenderPipeline;
  private readonly input: InputManager;
  private readonly audio = new AudioEngine();
  private readonly hud: Hud;
  private readonly screens: Screens;
  private readonly devPanel: DevPanel;
  private readonly lap: LapTimer | null = null;
  private readonly drift: DriftScorer;
  private readonly loop: GameLoop;
  private readonly spawnPose: SpawnPose;

  private state: GameState = 'title';
  private readonly idleIntent = createIntent();
  private readonly prevPosition = new Vector3();
  private readonly currPosition = new Vector3();
  private readonly prevQuaternion = new Quaternion();
  private readonly currQuaternion = new Quaternion();
  private readonly renderPosition = new Vector3();
  private readonly renderQuaternion = new Quaternion();
  private readonly cameraDirection = new Vector3();
  private upsideDownTime = 0;
  private impactCooldown = 0;
  private nitroVisual = 0;
  private reflectionY = 0;

  constructor(uiRoot: HTMLElement, canvas: HTMLCanvasElement) {
    this.quality = resolveQuality();
    this.preset = QUALITY_PRESETS[this.quality];
    const settings = getSettings();

    this.camera = new ChaseCamera(window.innerWidth / window.innerHeight);
    this.pipeline = new RenderPipeline(canvas, this.scene, this.camera.camera, this.preset);

    const pmrem = new PMREMGenerator(this.pipeline.renderer);
    this.scene.environment = pmrem.fromScene(createEnvironmentScene(), 0.04).texture;
    this.scene.environmentIntensity = TUNING.world.envIntensity;
    pmrem.dispose();

    this.physics = new PhysicsWorld(1 / TUNING.physics.fixedHz);
    const wet = this.pipeline.reflection?.uniforms ?? null;
    if (settings.world === 'test') {
      this.testRoad = new TestRoad(this.scene, this.physics, this.preset, wet);
      this.spawnPose = this.testRoad.poseAt(this.testRoad.spawnIndex);
    } else {
      this.city = new CityWorld(this.scene, this.physics, this.preset, wet);
      this.spawnPose = this.city.spawnPose();
    }

    this.car = new VehicleController(this.physics, this.spawnPose, this.bus);
    this.installCar(getCareer().selectedCar);
    this.fx = new VehicleFx(this.scene, this.preset);
    if (this.city) {
      this.atmosphere = new AtmosphereRuntime(this.scene, this.city, this.pipeline.renderer, this.pipeline, this.preset, wet, Date.now() % 100000);
      this.atmosphere.setLocks(settings.timeLock, settings.weatherLock);
      this.atmosphere.filmGrain = settings.filmGrain;
      const flood = this.atmosphere.flood;
      this.physics.floodAt = (x, z) => flood.depthAt(x, z) > ATMOSPHERE.floodFromDepth;
    }

    this.input = new InputManager(uiRoot);
    if (this.testRoad) {
      this.lap = new LapTimer(this.testRoad.track, this.bus, this.testRoad.spawnIndex, loadBestLap());
    }
    this.drift = new DriftScorer(this.bus);

    this.hud = new Hud(uiRoot);
    this.hud.setCityMode(this.city !== null);
    this.screens = new Screens(uiRoot, {
      start: () => this.startDriving(),
      resume: () => this.resume(),
      resetCar: () => {
        this.resetToRoad();
        this.resume();
      },
      restart: () => {
        this.restart();
        this.resume();
      },
      quitToTitle: () => this.quitToTitle(),
      setVolume: (value) => this.audio.setVolume(value),
      setReduceMotion: (value) => this.applyReduceMotion(value),
      openRing: () => this.director?.race.openBoard(),
      abandonRace: () => {
        this.director?.race.abandon();
        this.resume();
      },
      retryRace: () => this.director?.race.retry(),
      startAdda: () => this.startDriving(true),
      openGarage: () => this.enterGarage(),
      openLedger: () => this.openLedger(),
      toggleAdda: () => this.toggleAdda(),
      openReplay: () => this.openReplay('pause'),
      openPhoto: () => this.openPhoto('pause'),
      setMusicVolume: (value) => this.sound?.setMusicVolume(value),
      applyAtmosphere: () => this.applyAtmosphereSettings(),
      applyRadio: () => this.sound?.applyMode(),
      openChallenges: () => this.extras?.openChallenges(),
      openFriends: () => this.extras?.openFriends(),
      applyAccessibility: () => applyAccessibility(),
      applyControls: () => {
        this.input.applySteerMode();
        this.input.keyboard.rebind();
      },
      captureKeys: (on) => {
        this.input.keyboard.capturing = on;
      },
    });
    if (this.city) {
      this.director = new CityDirector(
        this.scene,
        this.city,
        this.physics,
        this.bus,
        this.preset,
        this.car,
        this.audio,
        uiRoot,
        this.screens,
        () => this.resume(),
        {
          placeCar: (pose) => this.placeCar(pose),
          pauseFor: (screen) => this.pauseFor(screen),
          resume: () => this.resume(),
          careerReset: () => this.onCareerReset(),
          carChanged: () => this.applyCarProfile(),
          restCar: () => this.restCar(),
          enterGarage: () => this.enterGarage(),
          enterStall: (stall, index) => this.enterStall(stall, index),
          forceWeather: (weather) => this.forceWeather(weather),
          openReplay: () => this.openReplay('raceResult'),
          setConditions: (sky) => this.setConditions(sky),
          runFinished: (run) => this.extras?.runFinished(run) ?? null,
          openChallenges: () => this.extras?.openChallenges(),
        },
      );
      this.director.onNearMissReward = (squeeze, points) => this.hud.showNearMiss(squeeze, points);
      this.director.onBusted = () => this.onBusted();
      this.director.onBustedContinue = () => this.continueAfterBust();
      this.director.race.onCameraBack = () => this.camera.snap();
      const career = this.director.career;
      this.garageScreen = new GarageScreen({
        preview: (carId) => this.installCar(carId),
        buyCar: (carId) => this.onBuyCar(carId),
        selectCar: (carId) => this.onSelectCar(carId),
        buyPart: (kind) => this.onBuyPart(kind),
        setLivery: (patch) => this.onSetLivery(patch),
        resetLivery: () => this.onResetLivery(),
        repair: () => this.onRepair(),
        view: (view) => this.stopCamera.setView(view),
        orbit: () => this.stopCamera.resumeOrbit(),
        drag: (pixels) => this.stopCamera.drag(pixels),
        close: () => this.leaveGarage(),
      });
      this.screens.attachExtra('garage', this.garageScreen.element);
      this.addaScreen = new AddaScreen({
        teaPoured: () => career.teaPoured(),
        rumour: () => career.rumour(),
        jobFor: (npc) => career.jobFor(npc),
        jobInHand: () => career.jobInHand(),
        acceptJob: (id) => career.acceptJob(id),
        leave: () => this.leaveStall(),
      });
      this.screens.attachExtra('adda', this.addaScreen.element);
      this.setUpCitySound(uiRoot);
      this.extras = new ExtrasDirector(this.scene, this.preset, uiRoot, this.bus, this.car, this.director, {
        openScreen: (name) => this.openExtraScreen(name),
        drive: () => this.driveFromMenu(),
        toast: (text) => this.hud.showText(text),
        setConditions: (sky) => this.setConditions(sky),
        enterSpectate: () => this.enterSpectate(),
        leaveSpectate: () => this.leaveSpectate(),
        showingResults: () => this.screens.currentScreen === 'raceResult',
        carPosition: () => ({ x: this.currPosition.x, z: this.currPosition.z }),
      });
      this.screens.attachExtra('challenges', this.extras.screen.element);
      this.screens.attachExtra('friends', this.extras.friends.screen.element);
    }
    this.ledgerScreen = new LedgerScreen({
      close: () => this.screens.handleBack(),
      dropJob: () => this.director?.career.dropJob(),
    });
    this.screens.attachExtra('ledger', this.ledgerScreen.element);
    this.photoScreen = new PhotoScreen({
      change: (values) => this.onPhotoChange(values),
      setLook: (look) => this.setPhotoLook(look),
      drag: (dx, dy) => this.onPhotoDrag(dx, dy),
      renderNow: () => {
        this.pipeline.render(0, 0, this.reflectionY, false);
        this.audio.playShutter();
        return this.pipeline.renderer.domElement;
      },
      saved: () => {
        this.director?.career.tracker.count('photos');
        this.extras?.onPhoto();
      },
      close: () => this.closePhoto(),
    });
    this.screens.attachExtra('photo', this.photoScreen.element);
    this.applyCarProfile();
    this.devPanel = new DevPanel(uiRoot);

    this.audio.setVolume(settings.volume);
    this.applyReduceMotion(settings.reduceMotion);
    applyAccessibility();
    this.bindEvents();
    window.addEventListener('pointerdown', this.onFirstGesture);
    window.addEventListener('keydown', this.onFirstGesture);

    // Rapier answers ray casts only after its first step has built the query structures.
    this.physics.step();
    this.readCarTransform();
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
    this.car.update(0.001, this.idleIntent);
    this.director?.prepare(this.currPosition.x, this.currPosition.z, 0, 1);

    this.onResize();
    window.addEventListener('resize', this.onResize);
    document.addEventListener('visibilitychange', this.onVisibility);

    this.loop = new GameLoop(
      {
        frameStart: (dt) => this.frameStart(dt),
        fixedUpdate: (dt) => this.fixedUpdate(dt),
        render: (alpha, dt) => this.render(alpha, dt),
      },
      TUNING.physics.fixedHz,
      TUNING.physics.maxStepsPerFrame,
    );
  }

  /** Starts the loop and shows the title screen. */
  begin(): void {
    this.parkInBay();
    this.frameBay('left', true);
    this.setState('title');
    this.screens.open('title');
    this.loop.start();
  }

  private bindEvents(): void {
    this.bus.on('driftEnd', ({ points, tier }) => {
      this.hud.showDriftEnd(points, tier);
      this.director?.career.payRoam(points);
    });
    this.bus.on('lapComplete', ({ timeMs, isBest, lap }) => {
      this.hud.showLap(timeMs, isBest, lap);
      if (isBest) saveBestLap(timeMs);
    });
    this.bus.on('gearChange', () => this.audio.onGearChange());
    this.bus.on('backfire', () => {
      this.rig.triggerBackfire();
      this.audio.playBackfire();
    });
    this.bus.on('nitroStart', () => {
      this.audio.playNitroStart();
      this.input.rumble.play('nitro');
    });
    // The pad shakes for the moments the body would feel.
    this.bus.on('impact', ({ strength }) => this.input.rumble.play('impact', strength));
    this.bus.on('policeContact', ({ pit }) => this.input.rumble.play('police', pit ? 1 : 0.5));
    this.bus.on('potholeHit', () => this.input.rumble.play('pothole'));
    this.bus.on('trapSprung', () => this.input.rumble.play('trap'));
    this.bus.on('raceFinished', () => this.input.rumble.play('finish'));
    this.bus.on('raceCountdown', ({ step }) => this.input.rumble.play('countdown', step === 0 ? 1 : 0.5));
    const onImpact = (strength: number, x: number, y: number, z: number): void => {
      this.camera.addImpact(strength);
      this.rig.addImpactWobble(strength);
      this.fx.burstSparks(x, y, z, strength);
      this.audio.playImpact(strength);
    };
    this.bus.on('impact', ({ strength, x, y, z }) => onImpact(strength, x, y, z));
    this.bus.on('trafficHit', ({ strength, x, y, z, soft }) => {
      if (!soft) onImpact(strength, x, y, z);
    });
    this.bus.on('policeContact', ({ x, y, z, pit }) => onImpact(pit ? 0.85 : 0.3, x, y, z));
    this.bus.on('trapSprung', ({ x, y, z }) => {
      this.camera.addImpact(0.4);
      this.fx.burstSparks(x, y + 1, z, 0.5);
      this.audio.playClatter();
    });
    this.bus.on('spikeHit', () => {
      this.camera.addImpact(0.3);
      this.rig.addImpactWobble(0.5);
    });
    this.bus.on('impact', ({ strength, x, y, z }) => this.replay?.buffer.mark('impact', x, y, z, strength));
    this.bus.on('nearMiss', () => this.replay?.buffer.mark('nearMiss', this.currPosition.x, this.currPosition.y, this.currPosition.z, 1));
    this.bus.on('targetDown', ({ x, y, z }) => this.replay?.buffer.mark('takedown', x, y, z, 1));
    this.bus.on('potholeHit', ({ x, y, z }) => {
      this.camera.addImpact(0.5);
      this.rig.addImpactWobble(0.7);
      this.fx.splash(x, y, z, 1);
      this.audio.playPothole();
      this.replay?.buffer.mark('splash', x, y, z, 1);
    });
  }

  private applyReduceMotion(value: boolean): void {
    document.documentElement.dataset.reduceMotion = value ? '1' : '0';
    this.camera.setReduceMotion(value);
    if (this.atmosphere) this.atmosphere.reduceMotion = value;
    this.stopCamera.setReduceMotion(value);
    this.rig.setReduceMotion(value);
    this.director?.setReduceMotion(value);
  }

  private setState(state: GameState): void {
    this.state = state;
    document.body.dataset.gameState = state;
    const showHud = state === 'driving' || state === 'paused';
    this.sound?.hud.setVisible(showHud);
    this.hud.setVisible(showHud);
    this.director?.setHudVisible(showHud);
    this.input.touch.setVisible(state === 'driving' && TouchInput.isTouchDevice());
  }

  // ---------- Sound and sky ----------

  private setUpCitySound(uiRoot: HTMLElement): void {
    const atmosphere = this.atmosphere;
    const director = this.director;
    if (!atmosphere || !director) return;
    this.sound = new SoundDirector(this.bus, uiRoot, this.audio, {
      floodPlace: () => {
        const zone = atmosphere.flood.nearestZone(this.currPosition.x, this.currPosition.z);
        if (!zone) return '';
        let best = POINTS_OF_INTEREST[0].id;
        let bestDistance = Infinity;
        for (const poi of POINTS_OF_INTEREST) {
          const network = this.city?.network;
          if (!network) break;
          const node = network.nodes[network.nodeIndex(poi.node)];
          const distance = Math.hypot(node.x - zone.x, node.z - zone.z);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = poi.id;
          }
        }
        return placeName(best);
      },
      jamPlace: () => placeName('bazaar'),
      weatherWord: () => weatherWord(atmosphere.director.weather, atmosphere.director.isBlackout),
      clockWords: () => clockWords(atmosphere.director.frame.time),
    });
    atmosphere.onEvent = (event) => this.sound?.onAtmosphere(event);
    director.career.tracker.onLevelUp = (level) => {
      director.career.hud.showLevelUp(level, PROGRESS.levelUpCash);
      this.sound?.onLevelUp();
    };
    director.paintFloods(atmosphere.flood.zones);
    this.replay = new ReplayPlayer(this.preset.replaySeconds, director.replayActors, director.traffic, this.car);
    const replayScreen = new ReplayScreen({
      togglePlay: () => {
        if (this.replay) this.replay.playing = !this.replay.playing;
        return this.replay?.playing ?? false;
      },
      setSpeed: (speed) => {
        if (this.replay) this.replay.speed = speed;
      },
      setCamera: (camera) => {
        if (this.replay) this.replay.camera = camera;
      },
      seek: (share) => this.replay?.seek(share),
      photo: () => this.openPhoto('replay'),
      close: () => this.closeReplay(),
    });
    this.replayScreen = replayScreen;
    this.screens.attachExtra('replay', replayScreen.element);
  }

  /** Sound can only start after a click or a key press, and the menus deserve some music. */
  private onFirstGesture = (): void => {
    window.removeEventListener('pointerdown', this.onFirstGesture);
    window.removeEventListener('keydown', this.onFirstGesture);
    this.openAudio();
  };

  private openAudio(): void {
    if (this.audioOpened) return;
    this.audioOpened = true;
    this.audio.start();
    this.audio.quietCar();
    this.sound?.connect();
  }

  private applyAtmosphereSettings(): void {
    const settings = getSettings();
    if (!this.atmosphere) return;
    this.atmosphere.setLocks(settings.timeLock, settings.weatherLock);
    this.atmosphere.filmGrain = settings.filmGrain;
  }

  /** A run holds the sky to its hour and weather; null gives the player's own settings back. */
  private setConditions(sky: SkyConditions | null): void {
    const atmosphere = this.atmosphere;
    if (!atmosphere) return;
    if (!sky) {
      if (!this.conditionsActive) return;
      this.conditionsActive = false;
      atmosphere.release();
      this.applyAtmosphereSettings();
      return;
    }
    const settings = getSettings();
    this.conditionsActive = true;
    atmosphere.setLocks(sky.time ?? settings.timeLock, sky.weather === 'blackout' ? 'blackout' : sky.weather ? 'auto' : settings.weatherLock);
    if (sky.weather && sky.weather !== 'blackout') atmosphere.force(sky.weather, sky.weather === 'monsoon');
  }

  /** Opens a Phase 7 board over whatever is on screen. */
  private openExtraScreen(name: 'challenges' | 'friends'): void {
    if (this.state === 'driving') {
      this.setState('paused');
      this.audio.setSuspended(true);
      this.input.clear();
    }
    this.screens.open(name, this.state === 'title' ? 'title' : 'pause');
  }

  /** From a menu straight onto the road: from the title it starts the drive, from pause it resumes. */
  private driveFromMenu(): void {
    if (this.state === 'title') this.startDriving();
    else if (this.state === 'spectate') this.leaveSpectate();
    else this.resume();
  }

  /** Watching a friend's race: the car waits, and the camera follows them. */
  private enterSpectate(): void {
    if (!this.extras) return;
    if (this.state === 'title') this.startDriving();
    this.setState('spectate');
    this.screens.open('none');
    this.rig.visual.root.visible = false;
    this.audio.quietCar();
    this.extras.friends.startSpectating();
  }

  private leaveSpectate(): void {
    if (this.state !== 'spectate') return;
    this.extras?.friends.stopSpectating();
    this.rig.visual.root.visible = true;
    this.camera.snap();
    this.resume();
  }

  private forceWeather(weather: 'monsoon' | null): void {
    if (weather) this.atmosphere?.force(weather, true);
    else this.atmosphere?.release();
  }

  /** Is there open sky in this direction from the camera? Buildings hide the sun's flare. */
  private lineToSky = (x: number, y: number, z: number): boolean => {
    const from = this.camera.camera.position;
    this.floodRay.origin.x = from.x;
    this.floodRay.origin.y = from.y;
    this.floodRay.origin.z = from.z;
    this.floodRay.dir.x = x;
    this.floodRay.dir.y = y;
    this.floodRay.dir.z = z;
    return this.physics.world.castRay(this.floodRay, 400, true, undefined, GROUP_WHEEL_RAY) === null;
  };

  /** Water on the road: holes under it, and the rush of it around the wheels. */
  private checkWater(dt: number): void {
    const flood = this.atmosphere?.flood;
    if (!flood) return;
    this.potholeCooldown -= dt;
    this.splashTimer -= dt;
    const speed = this.car.telemetry.speed;
    let inWater = false;
    for (const wheel of this.car.wheels) {
      if (!wheel.contact || wheel.surface !== 'flood') continue;
      inWater = true;
      if (!wheel.isFront || this.potholeCooldown > 0 || speed < 5) continue;
      if (!flood.potholeAt(wheel.contactPoint.x, wheel.contactPoint.z)) continue;
      this.potholeCooldown = 0.8;
      const velocity = this.car.velocity;
      const keep = 1 - ATMOSPHERE.potholeSpeedLoss;
      this.car.body.setLinvel({ x: velocity.x * keep, y: velocity.y, z: velocity.z * keep }, true);
      this.car.body.applyImpulse({ x: 0, y: TUNING.vehicle.mass * 1.6, z: 0 }, true);
      this.bus.emit('potholeHit', { x: wheel.contactPoint.x, y: wheel.contactPoint.y + 0.1, z: wheel.contactPoint.z });
    }
    this.audio.setWaterRush(inWater ? clamp01(speed / 24) : 0);
    if (inWater && speed > 8 && this.splashTimer <= 0) {
      this.splashTimer = 1.4;
      this.audio.playSplash(clamp01(speed / 30));
      this.replay?.buffer.mark('splash', this.currPosition.x, this.currPosition.y - 0.5, this.currPosition.z, clamp01(speed / 30));
    }
  }

  private saveCameraView(): void {
    const camera = this.camera.camera;
    this.savedCamera.position.copy(camera.position);
    this.savedCamera.quaternion.copy(camera.quaternion);
    this.savedCamera.fov = camera.fov;
  }

  private restoreCameraView(): void {
    const camera = this.camera.camera;
    camera.position.copy(this.savedCamera.position);
    camera.quaternion.copy(this.savedCamera.quaternion);
    camera.fov = this.savedCamera.fov;
    camera.updateProjectionMatrix();
  }

  // ---------- Replays ----------

  private openReplay(from: 'pause' | 'raceResult'): void {
    const replay = this.replay;
    if (!replay || !this.replayScreen || !this.director) return;
    if (!replay.ready) {
      this.hud.showToast('replay.tooShort');
      return;
    }
    this.replayReturn = from;
    this.saveCameraView();
    replay.enter();
    this.director.setTrafficReplay(true);
    this.setState('replay');
    this.audio.start();
    this.audio.setSuspended(false);
    this.audio.updatePursuitSounds(0, 0, 0, 0, 0, 0);
    this.audio.updateRivalEngine(0, 0, 0);
    this.input.clear();
    this.fx.clear();
    this.replayScreen.show();
    this.screens.open('replay');
  }

  private closeReplay(): void {
    const replay = this.replay;
    if (!replay?.active || !this.director) return;
    replay.exit();
    this.director.setTrafficReplay(false);
    this.fx.clear();
    this.restoreCameraView();
    this.audio.quietCar();
    if (this.replayReturn === 'raceResult') {
      this.pauseFor('raceResult');
    } else {
      this.setState('paused');
      this.audio.setSuspended(true);
      this.screens.open('pause', 'pause');
    }
  }

  // ---------- Photo mode ----------

  private openPhoto(from: 'driving' | 'pause' | 'replay' | 'title'): void {
    if (!this.atmosphere) return;
    this.photoReturn = from;
    // In a replay the replay's own camera is what is being kept.
    if (from !== 'replay') this.saveCameraView();
    if (this.replay?.active) this.replay.playing = false;
    const camera = this.camera.camera;
    const target = this.renderPosition;
    const photo = this.photo;
    photo.yaw = Math.atan2(camera.position.x - target.x, camera.position.z - target.z);
    photo.distance = Math.min(14, Math.max(4, camera.position.distanceTo(target)));
    photo.pitch = Math.min(0.6, Math.max(-0.05, Math.asin((camera.position.y - target.y) / Math.max(1, photo.distance))));
    photo.roll = 0;
    photo.fov = 42;
    photo.blur = 0;
    photo.time = this.atmosphere.director.frame.time;
    photo.startTime = photo.time;
    this.atmosphere.frozen = true;
    this.setState('photo');
    this.audio.quietCar();
    this.audio.setSuspended(false);
    this.input.clear();
    this.photoScreen.show({ distance: photo.distance, height: photo.pitch, roll: 0, fov: 42, blur: 0, time: photo.time }, this.pipeline.hasEffects);
    this.screens.open('photo');
  }

  private onPhotoChange(values: PhotoValues): void {
    const photo = this.photo;
    photo.distance = values.distance;
    photo.pitch = values.height;
    photo.roll = values.roll;
    photo.fov = values.fov;
    photo.blur = values.blur;
    if (values.time !== photo.time) {
      photo.time = values.time;
      this.atmosphere?.setPhotoTime(values.time);
    }
    this.pipeline.setPhotoFocus(photo.distance, photo.blur);
  }

  private onPhotoDrag(dx: number, dy: number): void {
    const photo = this.photo;
    photo.yaw -= dx * 0.006;
    photo.pitch = Math.min(1.2, Math.max(-0.12, photo.pitch + dy * 0.004));
    this.photoScreen.setValues({ height: photo.pitch });
  }

  private setPhotoLook(look: PhotoLook): void {
    if (!this.atmosphere) return;
    const looks: Record<PhotoLook, AtmosphereRuntime['photoLook']> = {
      plain: null,
      rickshaw: { r: 1.05, g: 1, b: 0.96, saturation: 1.5, contrast: 1.12, sepia: 0 },
      cinema: { r: 1.08, g: 0.94, b: 0.86, saturation: 1.18, contrast: 1.2, sepia: 0.2 },
      monsoon: { r: 0.88, g: 0.98, b: 1.12, saturation: 0.72, contrast: 1.06, sepia: 0 },
      old: { r: 1, g: 1, b: 1, saturation: 0.3, contrast: 0.94, sepia: 0.85 },
    };
    this.atmosphere.photoLook = looks[look];
  }

  private updatePhotoCamera(): void {
    const camera = this.camera.camera;
    const photo = this.photo;
    const target = this.renderPosition;
    const flat = Math.cos(photo.pitch) * photo.distance;
    camera.position.set(target.x + Math.sin(photo.yaw) * flat, Math.max(target.y - 0.4, target.y + Math.sin(photo.pitch) * photo.distance), target.z + Math.cos(photo.yaw) * flat);
    camera.up.set(0, 1, 0);
    camera.lookAt(target.x, target.y + 0.1, target.z);
    camera.rotateZ(photo.roll);
    if (camera.fov !== photo.fov) {
      camera.fov = photo.fov;
      camera.updateProjectionMatrix();
    }
  }

  private closePhoto(): void {
    const atmosphere = this.atmosphere;
    if (!atmosphere) return;
    atmosphere.photoLook = null;
    atmosphere.setPhotoTime(this.photo.startTime);
    atmosphere.frozen = false;
    this.pipeline.setPhotoFocus(0, 0);
    if (this.photoReturn === 'replay') {
      this.setState('replay');
      this.screens.open('replay');
      return;
    }
    this.restoreCameraView();
    if (this.photoReturn === 'driving') {
      this.camera.snap();
      this.resume();
    } else if (this.photoReturn === 'pause') {
      this.setState('paused');
      this.audio.setSuspended(true);
      this.screens.open('pause', 'pause');
    }
  }

  // ---------- The car itself ----------

  /** Builds and shows this car, in its owner's paint if it has an owner. */
  private installCar(carId: string): void {
    const definition = CAR_BY_ID.get(carId) ?? CARS[0];
    if (this.visual) {
      this.scene.remove(this.visual.root);
      this.visual.dispose();
    }
    const visual = createCarVisual(definition, getCareer().cars[definition.id]?.livery ?? definition.livery, this.preset);
    this.scene.add(visual.root);
    this.visual = visual;
    this.shownCar = definition.id;
    this.rig = new VehicleRig(visual, this.preset);
    visual.bodyPivot.traverse((child) => child.layers.enable(1));
    visual.wheels.forEach((wheel) => enableReflection(wheel.steer));
    this.rig.lights.forEach((light) => light.layers.enable(1));
    this.rig.setReduceMotion(getSettings().reduceMotion);
  }

  /** Works out what the car can do, from its class, parts and state of repair. */
  private applyCarProfile(): void {
    const career = getCareer();
    const definition = CAR_BY_ID.get(career.selectedCar) ?? CARS[0];
    const stats = statsWithParts(definition, career.cars[definition.id].parts);
    const limp = limpScales(career.condition);
    const profile = this.car.profile;
    profile.powerScale = stats.power * limp.power;
    profile.topSpeedScale = stats.topSpeed * limp.top;
    profile.gripScale = stats.grip;
    profile.brakeScale = stats.brake;
    profile.nitroScale = stats.nitro;
    profile.steerScale = stats.steer;
    if (this.director) this.director.police.carScale = 1 + (performanceIndex(stats) - 1) * PROGRESS.balance.policeShare;
  }

  private onCareerReset(): void {
    this.installCar(getCareer().selectedCar);
    this.applyCarProfile();
    this.director?.career.hud.setAddaMode(false);
    this.screens.refreshCareer();
  }

  /** Tea and a look under the bonnet: full nitro, no puncture, and this is where the next drive starts. */
  private restCar(): void {
    this.car.addNitro(TUNING.vehicle.nitro.capacity);
    this.car.clearPuncture();
    const position = this.car.position;
    const q = this.car.quaternion;
    getCareer().checkpoint = {
      x: position.x,
      y: position.y + 0.15,
      z: position.z,
      yaw: Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)),
    };
  }

  /** Brings every frame's idea of where the car is in line with where it now stands. */
  private syncCar(): void {
    this.drift.cancel();
    this.fx.clear();
    this.upsideDownTime = 0;
    this.camera.snap();
    this.readCarTransform();
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
  }

  // ---------- The garage ----------

  /** Puts the car on the painted bay, if this world has one. */
  private parkInBay(): void {
    const home = this.city?.garageHome;
    if (!home) return;
    this.car.reset({ position: { x: home.bayX, y: 0.8, z: home.bayZ }, yaw: home.yaw });
    this.car.clearPuncture();
    this.syncCar();
  }

  private frameBay(panel: 'left' | 'right', orbit: boolean): void {
    const home = this.city?.garageHome;
    if (!home) return;
    this.stopCamera.begin({ x: home.bayX, y: 0.6, z: home.bayZ, yaw: home.yaw, panel, orbit });
    this.setLampBoost(PROGRESS.garage.lampBoost);
  }

  /** The city's light is dim. Under a work lamp or a stall's bulb it needs to be stronger. */
  private setLampBoost(boost: number): void {
    if (this.atmosphere) {
      this.atmosphere.lampBoost = boost;
      // A roof keeps the rain off, wherever there is one.
      this.atmosphere.sheltered = boost >= PROGRESS.garage.lampBoost ? 1 : 0;
    } else {
      this.scene.environmentIntensity = TUNING.world.envIntensity * boost;
    }
  }

  private enterGarage(): void {
    if (!this.garageScreen || !this.director || this.director.race.isActive) return;
    if (this.director.police.heat.isActive) {
      this.hud.showToast('garage.policeBlock');
      return;
    }
    this.parkedFromTitle = this.state === 'title';
    this.parkedAt = 'garage';
    this.parkInBay();
    this.frameBay('right', true);
    this.setState('parked');
    this.audio.start();
    this.audio.setSuspended(false);
    this.audio.quietCar();
    this.input.clear();
    this.garageScreen.show(getCareer());
    this.screens.open('garage');
  }

  private leaveGarage(): void {
    const home = this.city?.garageHome;
    if (!home) return;
    this.parkedAt = null;
    if (this.shownCar !== getCareer().selectedCar) this.installCar(getCareer().selectedCar);
    this.applyCarProfile();
    saveCareer();
    if (this.parkedFromTitle) {
      this.frameBay('left', true);
      this.setState('title');
      this.screens.open('title', 'title');
      return;
    }
    this.stopCamera.end();
    this.setLampBoost(1);
    this.placeCar({ position: { x: home.exitX, y: 0.8, z: home.exitZ }, yaw: home.exitYaw });
  }

  private onBuyCar(carId: string): void {
    if (!buyCar(getCareer(), carId)) return;
    this.audio.playCash();
    this.installCar(carId);
    this.applyCarProfile();
    this.director?.career.tracker.check();
    saveCareer();
  }

  private onSelectCar(carId: string): void {
    if (!selectCar(getCareer(), carId)) return;
    if (this.shownCar !== carId) this.installCar(carId);
    this.applyCarProfile();
    saveCareer();
  }

  private onBuyPart(kind: PartKind): void {
    const career = getCareer();
    if (!buyPart(career, career.selectedCar, kind)) return;
    this.audio.playCash();
    this.applyCarProfile();
    this.director?.career.tracker.check();
    saveCareer();
  }

  private onSetLivery(patch: Partial<LiveryDef>): void {
    const career = getCareer();
    const livery = career.cars[career.selectedCar].livery;
    Object.assign(livery, patch);
    this.visual?.applyLivery(livery);
    this.audio.playPaint();
    saveCareer();
  }

  private onResetLivery(): void {
    const career = getCareer();
    const definition = CAR_BY_ID.get(career.selectedCar) ?? CARS[0];
    career.cars[definition.id].livery = { ...definition.livery };
    this.visual?.applyLivery(career.cars[definition.id].livery);
    saveCareer();
  }

  private onRepair(): void {
    const career = getCareer();
    const cost = repairCost(career);
    if (career.cash < cost) return;
    spend(career, cost);
    career.condition = 100;
    this.audio.playCash();
    this.applyCarProfile();
    saveCareer();
  }

  // ---------- The tea stall ----------

  private enterStall(stall: StallSpot, index: number): void {
    if (!this.addaScreen) return;
    this.parkedAt = 'adda';
    this.parkedFromTitle = false;
    // The handbrake goes on, or the car would roll off during the conversation.
    this.car.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.car.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.stopCamera.begin({ x: stall.x, y: 1.1, z: stall.z, yaw: stall.faceYaw, panel: 'right', radius: 6.6, height: 1, angle: 0.55, orbit: false });
    this.setLampBoost(PROGRESS.garage.teaLampBoost);
    this.setState('parked');
    this.audio.setSuspended(false);
    this.audio.quietCar();
    this.audio.playTeaPour(PROGRESS.tea.seconds);
    this.input.clear();
    this.addaScreen.show(index);
    this.screens.open('adda');
  }

  private leaveStall(): void {
    this.addaScreen?.hide();
    this.parkedAt = null;
    this.stopCamera.end();
    this.setLampBoost(1);
    this.camera.snap();
    this.resume();
  }

  // ---------- Menus that belong to the career ----------

  private openLedger(): void {
    this.ledgerScreen.show(getCareer());
    this.screens.open('ledger', this.state === 'title' ? 'title' : 'pause');
  }

  /** আড্ডা mode: the city with nobody after you. It cannot be used to slip out of a chase. */
  private toggleAdda(): void {
    if (!this.director) return;
    const career = getCareer();
    if (!career.addaMode && this.director.police.heat.isActive) {
      this.hud.showToast('adda.policeBlock');
      return;
    }
    career.addaMode = !career.addaMode;
    if (career.addaMode) this.director.clearPolice();
    this.director.career.hud.setAddaMode(career.addaMode);
    saveCareer();
    this.screens.refreshCareer();
  }

  // ---------- Driving ----------

  private startDriving(adda = false): void {
    this.audio.start();
    this.audio.setSuspended(false);
    const home = this.city?.garageHome;
    if (home) {
      const career = getCareer();
      career.addaMode = adda;
      const saved = career.checkpoint;
      this.car.reset(saved ? { position: { x: saved.x, y: saved.y, z: saved.z }, yaw: saved.yaw } : { position: { x: home.exitX, y: 0.8, z: home.exitZ }, yaw: home.exitYaw });
      this.syncCar();
      this.stopCamera.end();
      this.setLampBoost(1);
      saveCareer();
    }
    this.setState('driving');
    this.screens.open('none');
    this.hud.showHint(this.city ? 'city.hint' : 'controls.hint');
    this.camera.snap();
    (document.activeElement as HTMLElement | null)?.blur();
    this.director?.career.greet();
  }

  private pause(): void {
    if (this.state !== 'driving') return;
    this.setState('paused');
    this.audio.setSuspended(true);
    this.input.clear();
    this.screens.open('pause', 'pause');
  }

  private openMap(): void {
    if (this.state !== 'driving' || !this.director) return;
    this.setState('paused');
    this.audio.setSuspended(true);
    this.input.clear();
    this.director.openMap();
  }

  /** Puts the car on a race's grid, and gets everything ready to drive. */
  private placeCar(pose: SpawnPose): void {
    this.car.reset(pose);
    this.car.clearPuncture();
    this.car.addNitro(TUNING.vehicle.nitro.startAmount - this.car.telemetry.nitro);
    this.drift.cancel();
    this.fx.clear();
    this.upsideDownTime = 0;
    this.camera.snap();
    this.readCarTransform();
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
    this.audio.start();
    this.audio.setSuspended(false);
    this.setState('driving');
    this.screens.open('none');
    (document.activeElement as HTMLElement | null)?.blur();
  }

  /** Stops the world, for a menu that belongs to the race. */
  private pauseFor(screen: 'ring' | 'raceResult'): void {
    this.setState('paused');
    this.audio.setSuspended(true);
    this.input.clear();
    this.screens.open(screen);
  }

  /** Everything stops, and the arrest screen takes over. */
  private onBusted(): void {
    this.setState('paused');
    this.audio.setSuspended(true);
    this.input.clear();
    this.screens.open('busted');
  }

  /** Back on the road where it happened, with the police gone. */
  private continueAfterBust(): void {
    this.director?.clearPolice();
    this.resetToRoad();
    this.resume();
  }

  private resume(): void {
    this.setState('driving');
    this.audio.setSuspended(false);
    this.screens.open('none');
    (document.activeElement as HTMLElement | null)?.blur();
  }

  private restart(): void {
    this.car.reset(this.spawnPose);
    this.car.addNitro(TUNING.vehicle.nitro.startAmount - this.car.telemetry.nitro);
    if (this.lap && this.testRoad) this.lap.restart(this.testRoad.spawnIndex);
    this.director?.restart();
    // The GPS was cleared, but a job on the clock still needs its route.
    this.director?.career.greet();
    this.replay?.buffer.clear();
    this.drift.cancel();
    this.fx.clear();
    this.camera.snap();
    this.readCarTransform();
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
  }

  private quitToTitle(): void {
    this.restart();
    this.audio.setSuspended(false);
    this.audio.quietCar();
    this.parkInBay();
    this.frameBay('left', true);
    this.setState('title');
    this.screens.open('title', 'title');
  }

  /** Returns the car to the nearest point on the road, facing the right way. */
  private resetToRoad(): void {
    const position = this.car.position;
    let pose: SpawnPose | null = this.director?.race.resetPose() ?? null;
    if (pose) {
      // A race's own road takes the car back.
    } else if (this.testRoad && this.lap) {
      const index = this.testRoad.track.nearestIndexGlobal(position.x, position.z);
      pose = this.testRoad.poseAt(index);
      this.lap.invalidate(position.x, position.z);
    } else if (this.city) {
      const forward = this.cameraDirection;
      forward.set(0, 0, 1).applyQuaternion(this.car.quaternion);
      pose = this.city.resetPose(position.x, position.y - 0.6, position.z, forward.x, forward.z);
    }
    if (!pose) return;
    this.car.reset(pose);
    this.drift.cancel();
    this.upsideDownTime = 0;
    this.camera.snap();
    this.readCarTransform();
    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
    this.hud.showToast('hud.carReset');
    this.bus.emit('carReset', {});
  }

  private frameStart(dt: number): void {
    const speedFraction = clamp01(this.car.telemetry.speed / 45);
    this.input.update(dt, speedFraction);
    if (this.director) {
      this.loop.timeScale = this.state === 'driving' ? this.director.updateDom(dt, this.input.intent.dom, this.car.telemetry.drifting) : 1;
    }
    const edges = this.input.edges;
    if (edges.devPanel) this.devPanel.toggle();
    const screen = this.screens.currentScreen;
    if (this.state === 'parked') {
      if (edges.pause) {
        if (this.parkedAt === 'garage') this.leaveGarage();
        else this.leaveStall();
      }
      return;
    }
    if (this.state === 'replay') {
      if (edges.pause) this.closeReplay();
      return;
    }
    if (this.state === 'photo') {
      if (edges.pause) this.closePhoto();
      return;
    }
    if (this.state === 'spectate') {
      if (edges.pause) this.leaveSpectate();
      else if (edges.left) this.extras?.friends.spectateKey(-1);
      else if (edges.right) this.extras?.friends.spectateKey(1);
      return;
    }
    if (screen === 'busted') {
      if (edges.confirm || edges.pause) this.continueAfterBust();
      return;
    }
    const race = this.director?.race;
    if (screen === 'ring' && (edges.ring || edges.pause)) {
      this.resume();
      return;
    }
    if (screen === 'raceResult') return;
    if (race?.cutscene.active && this.state === 'driving') {
      if (edges.confirm || edges.pause) race.skipCutscene();
      return;
    }
    if (race && this.state === 'driving') {
      if (edges.ring && !race.isActive) {
        race.openBoard();
        return;
      }
      if (edges.confirm && race.acceptOffer()) return;
      if (edges.confirm && this.director?.career.acceptStop()) return;
    }
    if (this.state === 'title' && edges.confirm && screen === 'title') {
      this.startDriving();
      return;
    }
    if (this.state === 'paused' && edges.confirm && !edges.pause && screen === 'pause') {
      this.resume();
      return;
    }
    if (edges.map) {
      if (this.state === 'driving') this.openMap();
      else if (this.state === 'paused' && screen === 'map') this.resume();
      return;
    }
    if (edges.pause) {
      if (this.state === 'driving') this.pause();
      else if (this.state === 'paused' && screen === 'map') this.resume();
      else if (this.state === 'paused' && !this.screens.handleBack()) this.resume();
      else if (this.state === 'title') this.screens.handleBack();
      return;
    }
    if (this.state !== 'driving') return;
    if (edges.photo && this.atmosphere) {
      this.openPhoto('driving');
      return;
    }
    if (edges.radio && this.sound) this.hud.showText(this.sound.cycleMode());
    if (edges.camera) this.camera.nextMode();
    if (edges.reset) this.resetToRoad();
  }

  private fixedUpdate(dt: number): void {
    if (this.state === 'paused' || this.state === 'replay' || this.state === 'photo') return;
    const driving = this.state === 'driving';
    const intent = driving ? (this.director ? this.director.race.filterIntent(this.input.intent) : this.input.intent) : this.idleIntent;
    this.car.update(dt, intent);
    this.director?.beforePhysics(dt, driving);
    this.physics.step();
    this.handleContacts(dt);

    this.prevPosition.copy(this.currPosition);
    this.prevQuaternion.copy(this.currQuaternion);
    this.readCarTransform();

    if (this.director) {
      const camera = this.camera.camera;
      camera.getWorldDirection(this.cameraDirection);
      this.director.fixedUpdate(dt, camera.position, this.cameraDirection.x, this.cameraDirection.z, driving);
    }

    if (!driving) return;
    const velocity = this.car.velocity;
    const telemetry = this.car.telemetry;
    this.lap?.update(dt, this.currPosition.x, this.currPosition.z, velocity.x, velocity.z, telemetry.speed);
    this.drift.update(dt, telemetry);
    this.fx.emit(dt, this.car);
    this.checkWater(dt);
    if (this.replay && !this.director?.race.cutscene.active) this.replay.record(dt);
    if (this.city && getCareer().condition < PROGRESS.condition.smokeBelow) {
      this.cameraDirection.set(0, 0, 1).applyQuaternion(this.currQuaternion);
      this.fx.engineSmoke(dt, this.currPosition.x + this.cameraDirection.x * 1.5, this.currPosition.y + 0.45, this.currPosition.z + this.cameraDirection.z * 1.5, PROGRESS.condition.smokePerSecond);
    }
    this.checkAutoReset(dt);
  }

  private readCarTransform(): void {
    const position = this.car.body.translation();
    const rotation = this.car.body.rotation();
    this.currPosition.set(position.x, position.y, position.z);
    this.currQuaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
  }

  private handleContacts(dt: number): void {
    this.impactCooldown -= dt;
    const threshold = TUNING.vehicle.chassis.impactForceThreshold;
    let strongest = 0;
    this.physics.eventQueue.drainContactForceEvents((event) => {
      strongest = Math.max(strongest, event.totalForceMagnitude());
    });
    if (strongest > threshold && this.impactCooldown <= 0 && this.state === 'driving') {
      this.impactCooldown = 0.18;
      const velocity = this.car.velocity;
      const speed = Math.max(velocity.length(), 0.001);
      this.bus.emit('impact', {
        strength: clamp01((strongest - threshold) / (threshold * 8)) * 0.8 + 0.2,
        x: this.currPosition.x + (velocity.x / speed) * 1.9,
        y: this.currPosition.y,
        z: this.currPosition.z + (velocity.z / speed) * 1.9,
      });
    }
  }

  private checkAutoReset(dt: number): void {
    const upright = TUNING.vehicle.upright;
    const telemetry = this.car.telemetry;
    const stuck = telemetry.upY < upright.autoResetUpY || (telemetry.groundedWheels === 0 && telemetry.speed < 0.5);
    this.upsideDownTime = stuck ? this.upsideDownTime + dt : 0;
    if (this.upsideDownTime > upright.autoResetTime || this.currPosition.y < upright.fallResetY) {
      this.resetToRoad();
    }
  }

  private render(alpha: number, dt: number): void {
    const frozen = this.state === 'paused' || this.state === 'photo';
    const blend = frozen ? 1 : alpha;
    const inReplay = this.replay?.active === true;
    const replay = this.replay;
    if (inReplay && replay && this.state === 'replay') {
      replay.update(dt, this.camera.camera, this.rig, this.fx, this.audio);
      this.replayScreen?.setProgress(replay.progress, dt);
    }
    if (inReplay && replay) {
      this.renderPosition.copy(replay.position);
      this.renderQuaternion.copy(replay.quaternion);
    } else {
      this.renderPosition.lerpVectors(this.prevPosition, this.currPosition, blend);
      this.renderQuaternion.slerpQuaternions(this.prevQuaternion, this.currQuaternion, blend);
    }

    const telemetry = this.car.telemetry;
    // দম slows the world, but never the camera or the HUD.
    const frameDt = frozen ? 0 : dt * this.loop.timeScale;
    if (!inReplay && this.state !== 'photo') this.rig.update(frameDt, this.car, this.renderPosition, this.renderQuaternion);

    if (this.state === 'photo') {
      this.updatePhotoCamera();
    } else if (this.state === 'spectate') {
      this.extras?.friends.updateSpectateCamera(dt, this.camera.camera);
    } else if (this.state === 'replay') {
      // The replay has already placed the camera.
    } else if (this.stopCamera.active) {
      this.stopCamera.update(dt, this.camera.camera);
    } else if (this.state === 'title') {
      this.camera.updateTitle(dt, this.renderPosition);
    } else if (this.state === 'driving') {
      const cutscene = this.director?.race.cutscene;
      if (cutscene?.active) cutscene.update(dt, this.camera.camera);
      else this.camera.update(dt, this.renderPosition, this.renderQuaternion, this.car.velocity, telemetry, this.input.intent.lookBack);
    }
    document.body.dataset.cutscene = this.director?.race.cutscene.active ? '1' : '0';
    document.body.dataset.racing = this.director?.race.isActive ? '1' : '0';
    this.screens.setRacing(this.director?.race.isActive ?? false);

    const cameraPosition = this.camera.camera.position;
    this.testRoad?.update(this.renderPosition, cameraPosition);
    this.city?.update(frameDt, this.renderPosition, cameraPosition);
    this.fx.update(frameDt);
    this.updateAtmosphere(dt, frameDt);

    if (this.director) {
      if (!frozen) {
        this.director.frame(dt, frameDt, this.input.intent.horn, this.camera.camera, window.innerWidth, window.innerHeight, this.state === 'driving');
      }
      // Traffic is drawn a little behind its latest step, matching the interpolated player car.
      this.director.render((1 - blend) / TUNING.physics.fixedHz, blend, frameDt);
      this.extras?.frame(frameDt, performance.now(), this.camera.camera, window.innerWidth, window.innerHeight, this.state === 'driving');
    }

    const nitroTarget = telemetry.nitroActive && this.state === 'driving' ? 1 : 0;
    this.nitroVisual += (nitroTarget - this.nitroVisual) * Math.min(1, dt * 10);
    if (inReplay && replay) this.reflectionY = replay.position.y - 0.62;
    else this.updateReflectionPlane();
    this.pipeline.render(dt, this.nitroVisual, this.reflectionY, this.state === 'driving');

    if (this.state === 'driving') {
      if (this.lap) this.hud.update(dt, telemetry, this.lap, this.drift);
      else this.hud.updateCity(dt, telemetry, this.drift);
      this.audio.update(telemetry, this.input.intent.horn);
    }
    this.devPanel.update(dt, telemetry, this.pipeline.stats);
  }

  /** The sky and the sound, once per frame. */
  private updateAtmosphere(dt: number, frameDt: number): void {
    const atmosphere = this.atmosphere;
    const director = this.director;
    if (!atmosphere || !director) return;
    const velocity = this.state === 'driving' ? this.car.velocity : ZERO;
    const position = this.renderPosition;
    atmosphere.update(frameDt, position.x, position.y, position.z, this.camera.camera.position, velocity.x, velocity.z, this.camera.camera, this.lineToSky);
    const frame = atmosphere.director.frame;
    this.physics.weatherGrip = atmosphere.grip;
    director.police.sightScale = atmosphere.sightScale;
    director.rainNow = frame.rain;
    this.fx.wetness = frame.wetness;
    this.rig.daylight = frame.daylight;
    this.city?.props.lamps.setAir(Math.max(frame.rain, frame.mist));

    this.clockTimer -= dt;
    if (this.clockTimer <= 0) {
      this.clockTimer = 1;
      director.hud.setClock(`${clockWords(frame.time)} · ${weatherWord(atmosphere.director.weather, atmosphere.director.isBlackout)}`);
    }

    const sound = this.sound;
    if (!sound || this.state === 'paused') return;
    const race = director.race;
    const heat = director.police.heat;
    const driving = this.state === 'driving' || this.state === 'replay';
    let scene: MusicContext['scene'] = 'menu';
    if (driving) scene = race.isActive ? 'race' : heat.isActive ? 'pursuit' : 'roam';
    sound.frame(
      dt,
      {
        scene,
        intensity: scene === 'pursuit' ? heat.stars / 5 : scene === 'race' ? race.tension : 0,
        rain: frame.rain,
        blackout: atmosphere.director.isBlackout,
        daylight: frame.daylight,
        speed: clamp01(this.car.telemetry.speed / 50),
      },
      frame,
      clamp01(this.car.telemetry.speed / 45),
      this.state === 'driving' && !race.cutscene.active && !race.isCountingDown,
    );
  }

  /** The reflection plane sits on whatever road the wheels touch, flyover included. */
  private updateReflectionPlane(): number {
    let sum = 0;
    let count = 0;
    for (const wheel of this.car.wheels) {
      if (wheel.contact) {
        sum += wheel.contactPoint.y;
        count++;
      }
    }
    if (count > 0) this.reflectionY = sum / count;
    return this.reflectionY;
  }

  private onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.camera.setAspect(width / height);
    this.pipeline.resize(width, height);
  };

  private onVisibility = (): void => {
    if (!document.hidden) return;
    this.pause();
    flushCareer();
  };

  /** Read-only snapshot for debugging in the browser console. */
  get debug(): {
    state: GameState;
    quality: QualityName;
    telemetry: VehicleController['telemetry'];
    stats: RenderPipeline['stats'];
    position: Vector3;
    lap: LapTimer | null;
  } {
    return {
      state: this.state,
      quality: this.quality,
      telemetry: this.car.telemetry,
      stats: this.pipeline.stats,
      position: this.currPosition,
      lap: this.lap,
    };
  }
}

/** Loads the physics engine, then builds the game. */
export async function createGame(uiRoot: HTMLElement, canvas: HTMLCanvasElement): Promise<Game> {
  await Promise.all([loadPhysicsEngine(), loadCareer()]);
  return new Game(uiRoot, canvas);
}
