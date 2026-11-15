/**
 * Player settings and the best lap, kept in localStorage under versioned keys.
 * Storage can throw in private windows, so every access is guarded.
 * Full game saves move to IndexedDB when progression arrives in Phase 5.
 */

import type { DigitMode, Locale } from '../i18n';
import type { TimeLock, WeatherLock } from '../config/atmosphere';
import type { QualityName } from '../config/tuning';
import type { ColourVision, SubtitleSize } from '../config/extras';

const SETTINGS_KEY = 'beporowa:v1:settings';
const BEST_LAP_KEY = 'beporowa:v1:bestLapMs';

export type QualitySetting = QualityName | 'auto';
export type WorldChoice = 'city' | 'test';
export type RadioMode = 'full' | 'music' | 'off';
export type TouchSteer = 'buttons' | 'slider' | 'tilt';
/** A keyboard action that can be moved to other keys. */
export type BindAction = 'throttle' | 'brake' | 'left' | 'right' | 'handbrake' | 'nitro' | 'horn' | 'lookBack' | 'dom' | 'camera' | 'reset' | 'map' | 'ring' | 'photo' | 'radio';
export type KeyBindings = Record<BindAction, string[]>;

export const BIND_ACTIONS: readonly BindAction[] = ['throttle', 'brake', 'left', 'right', 'handbrake', 'nitro', 'horn', 'lookBack', 'dom', 'camera', 'reset', 'map', 'ring', 'photo', 'radio'];

export function defaultBindings(): KeyBindings {
  return {
    throttle: ['KeyW', 'ArrowUp'],
    brake: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    handbrake: ['Space'],
    nitro: ['ShiftLeft', 'ShiftRight'],
    horn: ['KeyH'],
    lookBack: ['KeyB'],
    dom: ['KeyE'],
    camera: ['KeyC'],
    reset: ['KeyR'],
    map: ['KeyM'],
    ring: ['KeyG'],
    photo: ['KeyO'],
    radio: ['KeyY'],
  };
}

export interface Settings {
  locale: Locale;
  digits: DigitMode;
  quality: QualitySetting;
  volume: number;
  reduceMotion: boolean;
  showBongabdo: boolean;
  /** Which world to build at start. Changing it reloads the page. */
  world: WorldChoice;
  hornTutorialDone: boolean;
  /** ওস্তাদ has explained how to shake off the police. */
  pursuitTipDone: boolean;
  /** How hard the police push, learned from how pursuits have gone. */
  policeDifficulty: number;
  /** Speak radio lines aloud, if the browser has a Bangla voice. */
  radioVoice: boolean;
  /** Holds the hour still, or lets it run. */
  timeLock: TimeLock;
  /** Holds the weather still, or lets it change. */
  weatherLock: WeatherLock;
  musicVolume: number;
  /** Music and the DJ, music alone, or nothing. */
  radioMode: RadioMode;
  filmGrain: boolean;
  /** Show a ghost of the best run in races. */
  ghosts: boolean;
  /** The name shown on leaderboards and to friends. */
  onlineName: string;
  /** Send finished runs to the online leaderboard. */
  leaderboardUpload: boolean;
  /** Optional rival and DJ lines written live by a language model. Off unless the player turns it on. */
  aiBanter: boolean;
  touchSteer: TouchSteer;
  /** Some phones report tilt the other way round. */
  tiltInvert: boolean;
  rumble: boolean;
  colourVision: ColourVision;
  subtitleSize: SubtitleSize;
  /** A solid plate behind every subtitle. */
  subtitleBacking: boolean;
  highContrast: boolean;
  keyBindings: KeyBindings;
}

function defaults(): Settings {
  const prefersReduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  return {
    locale: 'bn',
    digits: 'bn',
    quality: 'auto',
    volume: 1,
    reduceMotion: prefersReduced,
    showBongabdo: true,
    world: 'city',
    hornTutorialDone: false,
    pursuitTipDone: false,
    policeDifficulty: 1,
    radioVoice: false,
    timeLock: 'auto',
    weatherLock: 'auto',
    musicVolume: 0.7,
    radioMode: 'full',
    filmGrain: false,
    ghosts: true,
    onlineName: '',
    leaderboardUpload: true,
    aiBanter: false,
    touchSteer: 'buttons',
    tiltInvert: false,
    rumble: true,
    colourVision: 'normal',
    subtitleSize: 'normal',
    subtitleBacking: false,
    highContrast: typeof matchMedia === 'function' && matchMedia('(prefers-contrast: more)').matches,
    keyBindings: defaultBindings(),
  };
}

let storageWorks = true;
let current: Settings = defaults();

export function loadSettings(): Settings {
  const base = defaults();
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const saved = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    current = { ...base, ...saved, keyBindings: { ...base.keyBindings, ...saved.keyBindings } };
  } catch {
    storageWorks = false;
    current = base;
  }
  return current;
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(current));
    storageWorks = true;
  } catch {
    storageWorks = false;
  }
  return current;
}

export function isStorageWorking(): boolean {
  return storageWorks;
}

export function loadBestLap(): number | null {
  try {
    const raw = localStorage.getItem(BEST_LAP_KEY);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function saveBestLap(ms: number): void {
  try {
    localStorage.setItem(BEST_LAP_KEY, String(Math.round(ms)));
  } catch {
    storageWorks = false;
  }
}
