/**
 * Decides what the sky is doing: the hour, the weather and how it blends, how wet the road is, how
 * deep the water stands, lightning and blackouts. It draws nothing, so all of it can be tested headless.
 */

import { Color } from 'three';
import { ATMOSPHERE, TIME_KEYS, type EnvKind, type TimeKey, type TimeLock, type WeatherKind, type WeatherLock } from '../../config/atmosphere';
import { clamp01, createRng, moveToward, smoothstep } from '../../core/math';

export type AtmosphereEvent = 'rainStart' | 'rainStop' | 'fogStart' | 'fogStop' | 'blackoutStart' | 'blackoutEnd' | 'dawn' | 'morning' | 'dusk' | 'night' | 'lightning';

/** Everything the renderer and the sound need for one frame. Reused, so it makes no garbage. */
export interface AtmosphereFrame {
  time: number;
  daylight: number;
  sunX: number;
  sunY: number;
  sunZ: number;
  /** How much the sun itself can be seen, from 0 to 1. */
  sunVisible: number;
  /** Where the main light comes from, which is the sun or the moon. */
  lightX: number;
  lightY: number;
  lightZ: number;
  readonly skyTop: Color;
  readonly skyMid: Color;
  readonly skyHorizon: Color;
  readonly fog: Color;
  fogDensity: number;
  readonly hemiSky: Color;
  readonly hemiGround: Color;
  hemi: number;
  readonly light: Color;
  lightIntensity: number;
  env: number;
  envKind: EnvKind;
  windows: number;
  lamps: number;
  boards: number;
  selfLit: number;
  baked: number;
  bloom: number;
  bloomThreshold: number;
  readonly tint: Color;
  saturation: number;
  contrast: number;
  stars: number;
  haze: number;
  rain: number;
  wetness: number;
  flood: number;
  mist: number;
  /** Cloud cover, from 0 to 1. */
  clouds: number;
  flash: number;
  blackoutX: number;
  blackoutZ: number;
  /** How far the dark has spread, in metres. */
  blackoutRadius: number;
  /** 1 while the power is out and 0 when it is not. */
  blackoutLevel: number;
  /** How well tyres hold on a soaked road, as a share of dry. */
  grip: number;
  /** How far the police can see, as a share of normal. */
  sightScale: number;
}

function createFrame(): AtmosphereFrame {
  return {
    time: 0,
    daylight: 0,
    sunX: 0,
    sunY: -1,
    sunZ: 0,
    sunVisible: 0,
    lightX: 0,
    lightY: 1,
    lightZ: 0,
    skyTop: new Color(),
    skyMid: new Color(),
    skyHorizon: new Color(),
    fog: new Color(),
    fogDensity: 0,
    hemiSky: new Color(),
    hemiGround: new Color(),
    hemi: 1,
    light: new Color(),
    lightIntensity: 1,
    env: 1,
    envKind: 'night',
    windows: 1,
    lamps: 1,
    boards: 1,
    selfLit: 1,
    baked: 1,
    bloom: 1,
    bloomThreshold: 1,
    tint: new Color(1, 1, 1),
    saturation: 1,
    contrast: 1,
    stars: 0,
    haze: 0,
    rain: 0,
    wetness: 0,
    flood: 0,
    mist: 0,
    clouds: 0,
    flash: 0,
    blackoutX: 0,
    blackoutZ: 0,
    blackoutRadius: 0,
    blackoutLevel: 0,
    grip: 1,
    sightScale: 1,
  };
}

const scratchA = new Color();
const scratchB = new Color();

function setFromKeys(target: Color, a: number, b: number, t: number): void {
  scratchA.setHex(a);
  scratchB.setHex(b);
  target.lerpColors(scratchA, scratchB, t);
}

function mixHex(target: Color, hexA: number, hexB: number, t: number, amount: number): void {
  setFromKeys(scratchB, hexA, hexB, t);
  target.lerp(scratchB, amount);
}

export class AtmosphereDirector {
  readonly frame = createFrame();
  /** Fires for things worth saying or doing something about. */
  onEvent: ((event: AtmosphereEvent) => void) | null = null;

  private time: number = ATMOSPHERE.startTime;
  private timeLock: TimeLock = 'auto';
  private weatherLock: WeatherLock = 'auto';
  private forced: WeatherKind | null = null;
  private current: WeatherKind = 'clear';
  private weatherTimer: number = ATMOSPHERE.weather.firstClearSeconds;
  private monsoon = 0;
  private fog = 0;
  private wetness: number = ATMOSPHERE.wetness.drySettledNight;
  private flood = 0;
  private flash = 0;
  private lightningTimer = 8;
  private blackoutTimer: number;
  private blackoutState: 'off' | 'spreading' | 'holding' | 'returning' = 'off';
  private blackoutHold = 0;
  private blackoutRadius = 0;
  private blackoutX = 0;
  private blackoutZ = 0;
  private blackoutLevel = 0;
  private lastTime: number = ATMOSPHERE.startTime;
  private readonly random: () => number;
  private readonly month: number;

  constructor(seed = 1, date: Date = new Date()) {
    this.random = createRng(seed);
    this.month = date.getMonth();
    this.blackoutTimer = this.between(ATMOSPHERE.blackout.every);
    this.compose();
  }

  private between(range: readonly [number, number]): number {
    return range[0] + this.random() * (range[1] - range[0]);
  }

  get weather(): WeatherKind {
    return this.forced ?? this.current;
  }

  get isBlackout(): boolean {
    return this.blackoutState !== 'off';
  }

  /** Fixes the hour or the weather, from the settings. */
  setLocks(time: TimeLock, weather: WeatherLock): void {
    this.timeLock = time;
    this.weatherLock = weather;
    if (time !== 'auto') this.time = ATMOSPHERE.lockedTimes[time];
    if (weather !== 'blackout' && this.blackoutState !== 'off' && weather !== 'auto') this.blackoutState = 'returning';
  }

  /** Sets the hour directly, for the slider in photo mode. */
  setTime(time: number): void {
    this.time = ((time % 1) + 1) % 1;
    this.lastTime = this.time;
  }

  /** A race can insist on the weather, and on the water being up already. */
  force(weather: WeatherKind, fullWater: boolean): void {
    this.forced = weather;
    if (fullWater) {
      this.flood = 1;
      this.wetness = 1;
    }
    if (weather === 'monsoon') this.fireRain(true);
  }

  release(): void {
    this.forced = null;
  }

  private fire(event: AtmosphereEvent): void {
    this.onEvent?.(event);
  }

  private fireRain(on: boolean): void {
    this.fire(on ? 'rainStart' : 'rainStop');
  }

  /** Picks what comes next, by the month. */
  private chooseWeather(): WeatherKind {
    const config = ATMOSPHERE.weather;
    const month = config.byMonth[this.month];
    const clear = Math.max(month.clear, config.minimumShare);
    const monsoon = Math.max(month.monsoon, config.minimumShare);
    const fog = Math.max(month.fog, config.minimumShare);
    // The same weather twice in a row would feel like nothing happened.
    const weights: Array<[WeatherKind, number]> = [
      ['clear', clear],
      ['monsoon', monsoon],
      ['fog', fog],
    ];
    const open = weights.filter(([kind]) => kind !== this.current);
    const total = open.reduce((sum, [, weight]) => sum + weight, 0);
    let pick = this.random() * total;
    for (const [kind, weight] of open) {
      pick -= weight;
      if (pick <= 0) return kind;
    }
    return open[0][0];
  }

  private updateWeather(dt: number): void {
    const config = ATMOSPHERE.weather;
    this.weatherTimer -= dt;
    if (this.weatherLock === 'auto' && !this.forced && this.weatherTimer <= 0) {
      const next = this.chooseWeather();
      if (next !== this.current) {
        const previous = this.current;
        this.current = next;
        if (previous === 'monsoon') this.fireRain(false);
        if (previous === 'fog') this.fire('fogStop');
        if (next === 'monsoon') this.fireRain(true);
        if (next === 'fog') this.fire('fogStart');
      }
      this.weatherTimer = this.between(config.seconds[next]);
    }
    let wanted: WeatherKind = this.forced ?? this.current;
    if (!this.forced && (this.weatherLock === 'clear' || this.weatherLock === 'monsoon' || this.weatherLock === 'fog')) wanted = this.weatherLock;
    if (!this.forced && this.weatherLock === 'blackout') wanted = 'clear';
    const seconds = this.forced ? config.raceTransitionSeconds : config.transitionSeconds;
    this.monsoon = moveToward(this.monsoon, wanted === 'monsoon' ? 1 : 0, dt / seconds);
    this.fog = moveToward(this.fog, wanted === 'fog' ? 1 : 0, dt / seconds);
  }

  private updateWater(dt: number, settled: number): void {
    const wet = ATMOSPHERE.wetness;
    const target = Math.max(this.monsoon, settled);
    this.wetness = moveToward(this.wetness, target, (target > this.wetness ? wet.risePerSecond : wet.fallPerSecond) * dt);
    const flood = ATMOSPHERE.flood;
    if (this.monsoon > flood.risesFromRain) this.flood = Math.min(1, this.flood + flood.risePerSecond * dt);
    else this.flood = Math.max(0, this.flood - flood.fallPerSecond * dt);
  }

  private updateLightning(dt: number): void {
    const config = ATMOSPHERE.monsoon;
    this.flash = Math.max(0, this.flash - config.flashDecay * this.flash * dt - 0.05 * dt);
    if (this.monsoon < 0.7) return;
    this.lightningTimer -= dt;
    if (this.lightningTimer > 0) return;
    this.lightningTimer = this.between(config.lightningEvery);
    this.flash = 1;
    this.fire('lightning');
  }

  private updateBlackout(dt: number, playerX: number, playerZ: number, daylight: number): void {
    const config = ATMOSPHERE.blackout;
    if (this.weatherLock === 'blackout') {
      if (this.blackoutState === 'off') this.startBlackout(playerX, playerZ);
      this.blackoutHold = 999;
    }
    switch (this.blackoutState) {
      case 'off':
        if (this.weatherLock !== 'auto' || this.forced || daylight > 0.2) break;
        this.blackoutTimer -= dt;
        if (this.blackoutTimer <= 0) {
          this.blackoutTimer = this.between(config.every);
          if (this.random() < config.chance) this.startBlackout(playerX, playerZ);
        }
        break;
      case 'spreading':
        this.blackoutRadius += config.spreadSpeed * dt;
        if (this.blackoutRadius >= config.radius) {
          this.blackoutRadius = config.radius;
          this.blackoutState = 'holding';
        }
        break;
      case 'holding':
        this.blackoutHold -= dt;
        if (this.blackoutHold <= 0 || daylight > 0.45) this.blackoutState = 'returning';
        break;
      case 'returning':
        this.blackoutRadius -= config.returnSpeed * dt;
        if (this.blackoutRadius <= 0) {
          this.blackoutRadius = 0;
          this.blackoutState = 'off';
          this.fire('blackoutEnd');
        }
        break;
    }
    this.blackoutLevel = this.blackoutState === 'off' ? 0 : 1;
  }

  private startBlackout(x: number, z: number): void {
    this.blackoutState = 'spreading';
    this.blackoutHold = this.between(ATMOSPHERE.blackout.seconds);
    this.blackoutRadius = 0;
    // It starts a little way off, so that you can watch the dark come up the road.
    const angle = this.random() * Math.PI * 2;
    this.blackoutX = x + Math.cos(angle) * 140;
    this.blackoutZ = z + Math.sin(angle) * 140;
    this.fire('blackoutStart');
  }

  private updateClock(dt: number): void {
    if (this.timeLock !== 'auto') {
      this.time = ATMOSPHERE.lockedTimes[this.timeLock];
      this.lastTime = this.time;
      return;
    }
    this.time = (this.time + dt / (ATMOSPHERE.dayMinutes * 60)) % 1;
    const marks = ATMOSPHERE.dayMarks;
    const passed = (mark: number): boolean => this.lastTime < mark && this.time >= mark;
    if (passed(marks.dawn)) this.fire('dawn');
    if (passed(marks.morning)) this.fire('morning');
    if (passed(marks.dusk)) this.fire('dusk');
    if (passed(marks.night)) this.fire('night');
    this.lastTime = this.time;
  }

  /** Moves everything on by one frame. The frame then holds the result. */
  update(dt: number, playerX: number, playerZ: number): void {
    this.updateClock(dt);
    this.updateWeather(dt);
    this.compose();
    this.updateWater(dt, this.settledWetness());
    this.updateLightning(dt);
    this.updateBlackout(dt, playerX, playerZ, this.frame.daylight);
    this.compose();
  }

  private settledWetness(): number {
    const wet = ATMOSPHERE.wetness;
    return wet.drySettledNight + (wet.drySettledDay - wet.drySettledNight) * this.frame.daylight;
  }

  /** Blends the two nearest keys of the day, and lays the weather over them. */
  private compose(): void {
    const time = this.time;
    let a: TimeKey = TIME_KEYS[0];
    let b: TimeKey = TIME_KEYS[1];
    for (let i = 0; i < TIME_KEYS.length - 1; i++) {
      if (time >= TIME_KEYS[i].t && time <= TIME_KEYS[i + 1].t) {
        a = TIME_KEYS[i];
        b = TIME_KEYS[i + 1];
        break;
      }
    }
    const t = smoothstep(0, 1, (time - a.t) / Math.max(1e-5, b.t - a.t));
    const f = this.frame;
    const mix = (x: number, y: number): number => x + (y - x) * t;

    f.time = time;
    f.daylight = mix(a.daylight, b.daylight);
    setFromKeys(f.skyTop, a.skyTop, b.skyTop, t);
    setFromKeys(f.skyMid, a.skyMid, b.skyMid, t);
    setFromKeys(f.skyHorizon, a.skyHorizon, b.skyHorizon, t);
    setFromKeys(f.fog, a.fog, b.fog, t);
    f.fogDensity = mix(a.fogDensity, b.fogDensity);
    setFromKeys(f.hemiSky, a.hemiSky, b.hemiSky, t);
    setFromKeys(f.hemiGround, a.hemiGround, b.hemiGround, t);
    f.hemi = mix(a.hemi, b.hemi);
    setFromKeys(f.light, a.light, b.light, t);
    f.lightIntensity = mix(a.lightIntensity, b.lightIntensity);
    f.env = mix(a.env, b.env);
    f.envKind = t < 0.5 ? a.envKind : b.envKind;
    f.windows = mix(a.windows, b.windows);
    f.lamps = mix(a.lamps, b.lamps);
    f.boards = mix(a.boards, b.boards);
    f.selfLit = mix(a.selfLit, b.selfLit);
    f.baked = mix(a.baked, b.baked);
    f.bloom = mix(a.bloom, b.bloom);
    f.bloomThreshold = mix(a.bloomThreshold, b.bloomThreshold);
    f.tint.setRGB(mix(a.tint[0], b.tint[0]), mix(a.tint[1], b.tint[1]), mix(a.tint[2], b.tint[2]));
    f.saturation = mix(a.saturation, b.saturation);
    f.contrast = mix(a.contrast, b.contrast);
    f.stars = mix(a.stars, b.stars);
    f.haze = mix(a.haze, b.haze);

    this.composeSun();
    this.composeMonsoon();
    this.composeFog();

    f.rain = this.monsoon;
    f.wetness = this.wetness;
    f.flood = this.flood;
    f.mist = this.fog;
    f.clouds = clamp01(0.22 + this.monsoon + this.fog * 0.6);
    f.flash = this.flash;
    f.blackoutX = this.blackoutX;
    f.blackoutZ = this.blackoutZ;
    f.blackoutRadius = this.blackoutRadius;
    f.blackoutLevel = this.blackoutLevel;
    f.grip = 1 + (ATMOSPHERE.monsoon.gripWhenSoaked - 1) * smoothstep(0.75, 1, this.wetness) * smoothstep(0.2, 0.8, this.monsoon);
    f.sightScale = (1 + (ATMOSPHERE.monsoon.sightScale - 1) * this.monsoon) * (1 + (ATMOSPHERE.fog.sightScale - 1) * this.fog) * (this.blackoutLevel > 0 ? ATMOSPHERE.blackout.sightScale : 1);
  }

  private composeSun(): void {
    const f = this.frame;
    const config = ATMOSPHERE;
    const across = (f.time - config.sunriseAt) / (config.sunsetAt - config.sunriseAt);
    // The sun rises in the east, which is +X on this map, and sets in the west.
    const elevation = Math.sin(across * Math.PI) * config.sunPeak;
    const flat = Math.sqrt(Math.max(0.0001, 1 - elevation * elevation));
    const sweep = Math.cos(across * Math.PI);
    f.sunX = sweep * flat;
    f.sunY = elevation;
    f.sunZ = Math.sqrt(Math.max(0, 1 - sweep * sweep)) * flat * 0.6;
    const length = Math.hypot(f.sunX, f.sunY, f.sunZ) || 1;
    f.sunX /= length;
    f.sunY /= length;
    f.sunZ /= length;
    f.sunVisible = smoothstep(-0.02, 0.1, f.sunY);

    // The shadows change hands from the sun to the moon while the light passes through nothing.
    const moon = config.moonDirection;
    const sunIsUp = f.sunY > 0.04;
    f.lightX = sunIsUp ? f.sunX : moon[0];
    f.lightY = sunIsUp ? Math.max(0.12, f.sunY) : moon[1];
    f.lightZ = sunIsUp ? f.sunZ : moon[2];
    f.lightIntensity *= smoothstep(0, 0.12, Math.abs(f.sunY - 0.04));
  }

  private composeMonsoon(): void {
    const amount = this.monsoon;
    if (amount <= 0) return;
    const f = this.frame;
    const config = ATMOSPHERE.monsoon;
    const light = f.daylight;
    const sky = config.skyMix * amount;
    mixHex(f.skyTop, config.skyNight, config.skyDay, light, sky);
    mixHex(f.skyMid, config.skyNight, config.skyDay, light, sky);
    mixHex(f.skyHorizon, config.horizonNight, config.horizonDay, light, sky);
    mixHex(f.fog, config.fogNight, config.fogDay, light, amount);
    f.fogDensity *= 1 + (config.fogDensityScale - 1) * amount;
    f.lightIntensity *= 1 + (config.lightScale - 1) * amount;
    f.hemi *= 1 + (config.hemiScale - 1) * amount;
    f.windows = Math.max(f.windows, config.windowsAtLeast * amount);
    f.lamps = Math.max(f.lamps, config.lampsAtLeast * amount);
    f.boards = Math.max(f.boards, config.boardsAtLeast * amount);
    f.selfLit = Math.max(f.selfLit, config.selfLitAtLeast * amount);
    f.baked = Math.max(f.baked, 0.9 * amount);
    f.bloom *= 1 + (config.bloomScale - 1) * amount;
    f.bloomThreshold += (0.74 - f.bloomThreshold) * amount;
    f.tint.r *= 1 + (config.tint[0] - 1) * amount;
    f.tint.g *= 1 + (config.tint[1] - 1) * amount;
    f.tint.b *= 1 + (config.tint[2] - 1) * amount;
    f.saturation *= 1 + (config.saturation - 1) * amount;
    f.stars *= 1 - amount;
    f.haze *= 1 - amount;
    if (amount > 0.5 && light > 0.3) f.envKind = 'storm';
  }

  private composeFog(): void {
    const amount = this.fog;
    if (amount <= 0) return;
    const f = this.frame;
    const config = ATMOSPHERE.fog;
    mixHex(f.fog, config.colourNight, config.colourDay, f.daylight, amount);
    mixHex(f.skyHorizon, config.colourNight, config.colourDay, f.daylight, amount);
    mixHex(f.skyMid, config.colourNight, config.colourDay, f.daylight, amount * 0.8);
    mixHex(f.skyTop, config.colourNight, config.colourDay, f.daylight, amount * 0.6);
    f.fogDensity += (config.density - f.fogDensity) * amount;
    f.lightIntensity *= 1 + (config.lightScale - 1) * amount;
    f.hemi *= 1 + (config.hemiScale - 1) * amount;
    f.windows = Math.max(f.windows, config.windowsAtLeast * amount);
    f.lamps = Math.max(f.lamps, config.lampsAtLeast * amount);
    f.tint.r *= 1 + (config.tint[0] - 1) * amount;
    f.tint.g *= 1 + (config.tint[1] - 1) * amount;
    f.tint.b *= 1 + (config.tint[2] - 1) * amount;
    f.saturation *= 1 + (config.saturation - 1) * amount;
    f.contrast *= 1 + (config.contrast - 1) * amount;
    f.stars *= 1 - amount;
    f.haze *= 1 - amount;
  }
}
