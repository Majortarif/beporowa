/**
 * Puts the director's numbers into the world each frame: sky, lights, fog, every shared shader, the
 * rain and mist, the standing water, and the renderer's grading. Only the city world has one of these.
 */

import { Color, type Mesh, PMREMGenerator, type PerspectiveCamera, type Scene, type ShaderMaterial, type Texture, Vector3, type FogExp2, type WebGLRenderer } from 'three';
import type { EnvKind, TimeLock, WeatherKind, WeatherLock } from '../../config/atmosphere';
import type { QualityPreset } from '../../config/tuning';
import { BirdFlock } from '../../fx/bird-flock';
import { FloodWater } from '../../fx/flood-water';
import { MistBanks } from '../../fx/mist-banks';
import { RainSystem } from '../../fx/rain-system';
import { ATMOS, GLOW_REGISTRY } from '../../render/atmosphere-uniforms';
import type { WetUniforms } from '../../render/planar-reflection';
import type { RenderPipeline } from '../../render/render-pipeline';
import { createEnvironmentScene } from '../city-backdrop';
import type { CityWorld } from '../city/city-world';
import { AtmosphereDirector, type AtmosphereEvent } from './atmosphere-director';
import { FloodField } from './flood-field';

const scratchSun = new Vector3();
const WHITE = new Color(1, 1, 1);

export class AtmosphereRuntime {
  readonly director: AtmosphereDirector;
  readonly flood: FloodField;
  /** How far the camera is under a roof, for hiding the rain. */
  sheltered = 0;
  /** Work lamps in the garage, or the bulb at a tea stall. */
  lampBoost = 1;
  /** Lightning is turned right down for anyone who asked for less motion. */
  reduceMotion = false;
  filmGrain = false;
  /** A look chosen in photo mode, laid over the hour's own. */
  photoLook: { r: number; g: number; b: number; saturation: number; contrast: number; sepia: number } | null = null;
  /** Frozen for photo mode: the sky stays, even if a slider moves it. */
  frozen = false;
  private readonly rain: RainSystem;
  private readonly mist: MistBanks;
  private readonly birds: BirdFlock;
  private readonly water: FloodWater;
  private readonly envMaps = new Map<EnvKind, Texture>();
  private currentEnv: EnvKind | null = null;
  private readonly sky: ShaderMaterial;
  private clock = 0;
  private flareOcclusion = 1;
  private flareSmoothed = 0;

  constructor(
    private readonly scene: Scene,
    private readonly world: CityWorld,
    renderer: WebGLRenderer,
    private readonly pipeline: RenderPipeline,
    preset: QualityPreset,
    wet: WetUniforms | null,
    seed: number,
  ) {
    this.director = new AtmosphereDirector(seed);
    this.flood = new FloodField(world.network);
    this.sky = (world.sky as Mesh).material as ShaderMaterial;
    this.rain = new RainSystem(scene, preset.rainDrops);
    this.mist = new MistBanks(scene, preset.mistBanks);
    this.birds = new BirdFlock(scene);
    this.water = new FloodWater(scene, this.flood.zones, wet);

    // A few ready-made skies for reflections. Lower presets make do with fewer.
    const pmrem = new PMREMGenerator(renderer);
    const kinds: readonly EnvKind[] = preset.bloom ? ['night', 'dusk', 'day', 'storm'] : ['night', 'day'];
    for (const kind of kinds) this.envMaps.set(kind, pmrem.fromScene(createEnvironmentScene(kind), 0.04).texture);
    pmrem.dispose();
  }

  setLocks(time: TimeLock, weather: WeatherLock): void {
    this.director.setLocks(time, weather);
  }

  get onEvent(): ((event: AtmosphereEvent) => void) | null {
    return this.director.onEvent;
  }

  set onEvent(listener: ((event: AtmosphereEvent) => void) | null) {
    this.director.onEvent = listener;
  }

  /** A race that insists on the weather. */
  force(weather: WeatherKind, fullWater: boolean): void {
    this.director.force(weather, fullWater);
  }

  release(): void {
    this.director.release();
  }

  private chooseEnv(kind: EnvKind): void {
    const wanted = this.envMaps.has(kind) ? kind : kind === 'dusk' ? 'night' : kind === 'storm' ? 'night' : kind;
    if (wanted === this.currentEnv) return;
    const map = this.envMaps.get(wanted);
    if (!map) return;
    this.currentEnv = wanted;
    this.scene.environment = map;
  }

  /** Sets every uniform from the frame. Runs each frame, even while the sky is frozen. */
  private apply(dt: number, carX: number, carY: number, carZ: number, cameraPosition: Vector3, carVx: number, carVz: number, camera: PerspectiveCamera, lineToSky: (x: number, y: number, z: number) => boolean): void {
    const f = this.director.frame;
    const world = this.world;

    // Sky.
    const sky = this.sky.uniforms;
    sky.uTop.value.copy(f.skyTop);
    sky.uMid.value.copy(f.skyMid);
    sky.uHorizon.value.copy(f.skyHorizon);
    sky.uSunDir.value.set(f.sunX, f.sunY, f.sunZ);
    sky.uSunAmount.value = f.sunVisible * (1 - f.clouds * 0.75);
    sky.uMoonAmount.value = (1 - f.daylight) * (1 - f.clouds * 0.8);
    sky.uStars.value = f.stars * (1 - f.clouds * 0.7);
    sky.uClouds.value = f.clouds;
    sky.uDaylight.value = f.daylight;
    sky.uFlash.value = this.reduceMotion ? f.flash * 0.1 : f.flash;
    sky.uClock.value = this.clock;

    // Lights and fog.
    const hemisphere = world.hemisphere;
    hemisphere.color.copy(f.hemiSky);
    hemisphere.groundColor.copy(f.hemiGround);
    hemisphere.intensity = f.hemi + f.flash * (this.reduceMotion ? 0.2 : 2.4);
    const sun = world.moon;
    sun.color.copy(f.light);
    sun.intensity = f.lightIntensity;
    scratchSun.set(f.lightX, f.lightY, f.lightZ);
    sun.target.position.set(carX, carY, carZ);
    sun.position.set(carX + scratchSun.x * 140, carY + scratchSun.y * 140, carZ + scratchSun.z * 140);
    const fog = this.scene.fog as FogExp2;
    fog.color.copy(f.fog);
    fog.density = f.fogDensity;
    this.pipeline.setClearColor(f.fog);
    this.scene.environmentIntensity = f.env * this.lampBoost;
    this.chooseEnv(f.envKind);

    // Shared shader numbers.
    ATMOS.uTime.value = this.clock;
    ATMOS.uWetness.value = f.wetness;
    ATMOS.uRain.value = f.rain;
    ATMOS.uPuddles.value = Math.max(0, f.wetness - 0.55) * 2.2 * (0.35 + f.rain * 0.65);
    ATMOS.uBakedGlow.value = f.baked;
    ATMOS.uSelfGlow.value = f.selfLit * (f.blackoutLevel > 0 ? 1.25 : 1);
    ATMOS.uLampGlow.value = f.lamps;
    ATMOS.uFogColor.value.copy(f.fog);
    ATMOS.uFogDensity.value = f.fogDensity;
    ATMOS.uAmbient.value = 0.72 + f.daylight * 1.6 + f.flash * 0.5;
    ATMOS.uAmbientColor.value.copy(f.hemiSky).lerp(WHITE, 0.6);
    ATMOS.uBlackout.value.set(f.blackoutX, f.blackoutZ, f.blackoutRadius, f.blackoutLevel);
    ATMOS.uFlood.value = f.flood;
    ATMOS.uMist.value = f.mist;
    ATMOS.uFlash.value = f.flash;
    this.flood.level = f.flood;

    for (const material of GLOW_REGISTRY.windows) material.emissiveIntensity = f.windows;
    const boards = 0.55 + 0.45 * f.boards;
    for (const board of GLOW_REGISTRY.boards) board.color.copy(board.base).multiplyScalar(boards + f.daylight * 0.2);
    const ground = 1 - f.wetness * 0.26;
    for (const item of GLOW_REGISTRY.ground) {
      item.roughness = item.baseRoughness - f.wetness * 0.34;
      item.color.copy(item.base).multiplyScalar(ground + f.daylight * 0.05);
    }

    // Things in the air.
    const groundY = carY - 0.65;
    this.rain.update(dt, f.rain, this.sheltered, cameraPosition, groundY, carVx, carVz, f.daylight);
    this.mist.update(dt, Math.max(f.mist, f.rain * 0.35) * (1 - this.sheltered), cameraPosition, groundY, f.fog);
    this.birds.update(dt, clampDaylight(f.daylight) * (1 - f.rain) * (1 - f.mist), carX, carZ);
    this.water.update(f.flood);

    // Grading.
    const look = this.photoLook;
    this.pipeline.setAtmosphere(
      f.tint.r * (look ? look.r : 1),
      f.tint.g * (look ? look.g : 1),
      f.tint.b * (look ? look.b : 1),
      f.saturation * (look ? look.saturation : 1),
      f.contrast * (look ? look.contrast : 1),
      look ? look.sepia : 0,
      f.bloom,
      f.bloomThreshold,
    );
    const flash = (this.reduceMotion ? 0.04 : 0.34) * f.flash;
    // Where the horizon falls on screen decides where the shimmer goes.
    const horizon = 0.5 - camera.getWorldDirection(scratchSun).y * (camera.aspect > 1 ? 1.1 : 0.9);
    this.pipeline.setAtmosphereMoment(this.clock, flash, f.haze * (1 - this.sheltered) * (this.reduceMotion ? 0 : 1), horizon, this.filmGrain ? 0.055 : 0, camera.aspect);
    this.updateFlare(dt, f.sunX, f.sunY, f.sunZ, f.sunVisible * (1 - f.clouds), cameraPosition, camera, lineToSky);
  }

  /** The sun's flare, once a clear line to the sky has been checked for. */
  private updateFlare(dt: number, sx: number, sy: number, sz: number, amount: number, cameraPosition: Vector3, camera: PerspectiveCamera, lineToSky: (x: number, y: number, z: number) => boolean): void {
    if (amount < 0.02 || this.sheltered > 0.5) {
      this.flareSmoothed = 0;
      this.pipeline.setFlare(0, 0, 0);
      return;
    }
    scratchSun.set(cameraPosition.x + sx * 1000, cameraPosition.y + sy * 1000, cameraPosition.z + sz * 1000).project(camera);
    const inFront = scratchSun.z < 1 && Math.abs(scratchSun.x) < 1.25 && Math.abs(scratchSun.y) < 1.25;
    // Buildings hide it, and asking the physics is cheap enough to do now and then.
    if ((this.clock * 8) % 1 < dt * 8) this.flareOcclusion = lineToSky(sx, sy, sz) ? 1 : 0;
    const wanted = inFront ? amount * this.flareOcclusion : 0;
    this.flareSmoothed += (wanted - this.flareSmoothed) * Math.min(1, dt * 7);
    this.pipeline.setFlare(scratchSun.x * 0.5 + 0.5, scratchSun.y * 0.5 + 0.5, this.flareSmoothed * 0.8);
  }

  update(dt: number, carX: number, carY: number, carZ: number, cameraPosition: Vector3, carVx: number, carVz: number, camera: PerspectiveCamera, lineToSky: (x: number, y: number, z: number) => boolean): void {
    if (!this.frozen) {
      this.clock += dt;
      this.director.update(dt, carX, carZ);
    }
    this.apply(this.frozen ? 0 : dt, carX, carY, carZ, cameraPosition, carVx, carVz, camera, lineToSky);
  }

  /** Physics grip and police sight follow the weather. */
  get grip(): number {
    return this.director.frame.grip;
  }

  get sightScale(): number {
    return this.director.frame.sightScale;
  }

  /** Sets the hour, for the slider in photo mode. */
  setPhotoTime(time: number): void {
    this.director.setTime(time);
    this.director.update(0, this.world.garageHome.x, this.world.garageHome.z);
  }
}

function clampDaylight(daylight: number): number {
  return Math.max(0, Math.min(1, (daylight - 0.2) * 1.6));
}
