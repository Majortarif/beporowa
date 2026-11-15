/** Title, pause, settings and controls screens. All text comes from i18n keys. */

import {
  applyI18n,
  formatBongabdoDate,
  formatInteger,
  formatNumber,
  getDigitMode,
  getLocale,
  onI18nChange,
  setDigitMode,
  setLocale,
  t,
  type DigitMode,
  type Locale,
} from '../i18n';
import { levelFor } from '../progression/economy';
import { getCareer } from '../save/career';
import type { TimeLock, WeatherLock } from '../config/atmosphere';
import {
  BIND_ACTIONS,
  defaultBindings,
  getSettings,
  isStorageWorking,
  updateSettings,
  type BindAction,
  type QualitySetting,
  type RadioMode,
  type TouchSteer,
  type WorldChoice,
} from '../save/settings';
import type { ColourVision, SubtitleSize } from '../config/extras';
import { TiltInput } from '../input/tilt';
import { birdSvg, flowerSvg, leafSprigSvg } from './ornaments';

export interface ScreenActions {
  start(): void;
  resume(): void;
  resetCar(): void;
  restart(): void;
  quitToTitle(): void;
  setVolume(value: number): void;
  setReduceMotion(value: boolean): void;
  openRing(): void;
  abandonRace(): void;
  retryRace(): void;
  startAdda(): void;
  openGarage(): void;
  openLedger(): void;
  toggleAdda(): void;
  openReplay(): void;
  openPhoto(): void;
  setMusicVolume(value: number): void;
  applyAtmosphere(): void;
  applyRadio(): void;
  openChallenges(): void;
  openFriends(): void;
  applyAccessibility(): void;
  /** Steering mode or key bindings changed. */
  applyControls(): void;
  /** The controls screen is waiting for a key, so the game must not act on it. */
  captureKeys(on: boolean): void;
}

/** Keys that stay where they are, so pause and menus always work. */
const FIXED_CODES = new Set(['Enter', 'Escape', 'KeyP', 'Backquote', 'Tab']);

/** A key's name as printed on the keycap. */
export function keyLabel(code: string): string {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1];
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1];
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  if (code === 'Space') return t('keys.space');
  // Left and right twins are told apart, so two of them never read the same.
  const side = code.endsWith('Left') ? 'L-' : code.endsWith('Right') ? 'R-' : '';
  if (code.startsWith('Shift')) return `${side}Shift`;
  if (code.startsWith('Control')) return `${side}Ctrl`;
  if (code.startsWith('Alt')) return `${side}Alt`;
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

type ScreenName = 'title' | 'pause' | 'settings' | 'controls' | 'map' | 'busted' | 'ring' | 'raceResult' | 'garage' | 'adda' | 'ledger' | 'replay' | 'photo' | 'challenges' | 'friends' | 'none';

const CONTROL_ACTIONS = ['throttle', 'brake', 'left', 'right', 'handbrake', 'nitro', 'horn', 'dom', 'ring', 'enter', 'map', 'camera', 'lookBack', 'photo', 'radio', 'reset', 'pause', 'devPanel'];

function corners(): string {
  return `
    <div class="board-corner board-corner-tl">${flowerSvg('#d8402b', '#f2a20c', '#efe3c8')}</div>
    <div class="board-corner board-corner-tr">${flowerSvg('#0f7f7a', '#efe3c8', '#f2a20c')}</div>`;
}

export class Screens {
  readonly root: HTMLElement;
  private current: ScreenName = 'none';
  private returnTo: ScreenName = 'title';
  private readonly title: HTMLElement;
  private readonly pause: HTMLElement;
  private readonly settings: HTMLElement;
  private readonly controls: HTMLElement;
  private map: HTMLElement | null = null;
  private busted: HTMLElement | null = null;
  private readonly extras = new Map<ScreenName, HTMLElement>();

  constructor(
    parent: HTMLElement,
    private readonly actions: ScreenActions,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'screens';
    this.title = this.buildTitle();
    this.pause = this.buildPause();
    this.settings = this.buildSettings();
    this.controls = this.buildControls();
    this.root.append(this.title, this.pause, this.settings, this.controls);
    parent.appendChild(this.root);
    applyI18n(this.root);
    this.refreshDate();
    onI18nChange(() => {
      this.refreshDate();
      this.refreshSettingsState();
      this.refreshCareer();
    });
  }

  private makeScreen(name: string, html: string): HTMLElement {
    const screen = document.createElement('section');
    screen.className = `screen screen-${name}`;
    screen.innerHTML = html;
    return screen;
  }

  private on(root: HTMLElement, selector: string, handler: () => void): void {
    root.querySelector(selector)?.addEventListener('click', handler);
  }

  private buildTitle(): HTMLElement {
    const screen = this.makeScreen(
      'title',
      `<div class="board board-title">
        ${corners()}
        <div class="title-eyebrow" data-i18n="app.phase"></div>
        <h1 class="title-logo" data-i18n="app.name"></h1>
        <div class="title-bird">${birdSvg()}</div>
        <p class="title-tagline" data-i18n="app.tagline"></p>
        <div class="title-actions">
          <button type="button" class="plaque plaque-tomato plaque-big" data-action="start" data-i18n="title.start"></button>
          <div class="title-actions-row city-only">
            <button type="button" class="plaque plaque-marigold" data-action="adda" data-i18n="title.adda"></button>
            <button type="button" class="plaque plaque-teal" data-action="garage" data-i18n="title.garage"></button>
          </div>
          <div class="title-actions-row city-only">
            <button type="button" class="plaque plaque-indigo" data-action="challenges" data-i18n="title.challenges"></button>
            <button type="button" class="plaque plaque-teal" data-action="friends" data-i18n="title.friends"></button>
          </div>
          <div class="title-actions-row title-actions-three">
            <button type="button" class="plaque plaque-soot city-only" data-action="ledger" data-i18n="title.ledger"></button>
            <button type="button" class="plaque plaque-soot" data-action="settings" data-i18n="title.settings"></button>
            <button type="button" class="plaque plaque-indigo" data-action="controls" data-i18n="title.controls"></button>
          </div>
        </div>
        <ul class="title-facts">
          <li class="title-car"></li>
          <li data-i18n="${getSettings().world === 'city' ? 'title.roadCity' : 'title.road'}"></li>
          <li class="title-date"></li>
        </ul>
        <div class="title-sprig">${leafSprigSvg()}</div>
      </div>
      <p class="title-disclaimer" data-i18n="title.disclaimer"></p>`,
    );
    this.on(screen, '[data-action="start"]', () => this.actions.start());
    this.on(screen, '[data-action="adda"]', () => this.actions.startAdda());
    this.on(screen, '[data-action="garage"]', () => this.actions.openGarage());
    this.on(screen, '[data-action="ledger"]', () => this.actions.openLedger());
    this.on(screen, '[data-action="challenges"]', () => this.actions.openChallenges());
    this.on(screen, '[data-action="friends"]', () => this.actions.openFriends());
    if (getSettings().world !== 'city') screen.querySelectorAll('.city-only').forEach((element) => element.remove());
    this.on(screen, '[data-action="settings"]', () => this.open('settings', 'title'));
    this.on(screen, '[data-action="controls"]', () => this.open('controls', 'title'));
    return screen;
  }

  private buildPause(): HTMLElement {
    const screen = this.makeScreen(
      'pause',
      `<div class="board board-menu">
        ${corners()}
        <h2 class="menu-title" data-i18n="pause.title"></h2>
        <div class="menu-list">
          <button type="button" class="plaque plaque-tomato plaque-big" data-action="resume" data-i18n="pause.resume"></button>
          <button type="button" class="plaque plaque-marigold" data-action="reset" data-i18n="pause.reset"></button>
          <button type="button" class="plaque plaque-tomato pause-race" data-action="retry" data-i18n="pause.retry"></button>
          <button type="button" class="plaque plaque-soot pause-race" data-action="abandon" data-i18n="pause.abandon"></button>
          <button type="button" class="plaque plaque-teal pause-free city-only" data-action="ring" data-i18n="pause.ring"></button>
          <button type="button" class="plaque plaque-teal pause-free city-only" data-action="garage" data-i18n="pause.garage"></button>
          <button type="button" class="plaque plaque-indigo pause-free city-only" data-action="challenges" data-i18n="title.challenges"></button>
          <button type="button" class="plaque plaque-teal city-only" data-action="friends" data-i18n="title.friends"></button>
          <button type="button" class="plaque plaque-marigold pause-free city-only" data-action="adda"></button>
          <button type="button" class="plaque plaque-soot city-only" data-action="ledger" data-i18n="pause.ledger"></button>
          <button type="button" class="plaque plaque-soot city-only" data-action="replay" data-i18n="pause.replay"></button>
          <button type="button" class="plaque plaque-soot city-only" data-action="photo" data-i18n="pause.photo"></button>
          <button type="button" class="plaque plaque-teal" data-action="settings" data-i18n="title.settings"></button>
          <button type="button" class="plaque plaque-indigo" data-action="controls" data-i18n="title.controls"></button>
          <button type="button" class="plaque plaque-soot" data-action="restart" data-i18n="pause.restart"></button>
          <button type="button" class="plaque plaque-soot" data-action="quit" data-i18n="pause.quit"></button>
        </div>
      </div>`,
    );
    this.on(screen, '[data-action="resume"]', () => this.actions.resume());
    this.on(screen, '[data-action="reset"]', () => this.actions.resetCar());
    this.on(screen, '[data-action="ring"]', () => this.actions.openRing());
    this.on(screen, '[data-action="garage"]', () => this.actions.openGarage());
    this.on(screen, '[data-action="adda"]', () => this.actions.toggleAdda());
    this.on(screen, '[data-action="ledger"]', () => this.actions.openLedger());
    this.on(screen, '[data-action="replay"]', () => this.actions.openReplay());
    this.on(screen, '[data-action="photo"]', () => this.actions.openPhoto());
    this.on(screen, '[data-action="challenges"]', () => this.actions.openChallenges());
    this.on(screen, '[data-action="friends"]', () => this.actions.openFriends());
    if (getSettings().world !== 'city') screen.querySelectorAll('.city-only').forEach((element) => element.remove());
    this.on(screen, '[data-action="abandon"]', () => this.actions.abandonRace());
    this.on(screen, '[data-action="retry"]', () => this.actions.retryRace());
    this.on(screen, '[data-action="settings"]', () => this.open('settings', 'pause'));
    this.on(screen, '[data-action="controls"]', () => this.open('controls', 'pause'));
    this.on(screen, '[data-action="restart"]', () => this.actions.restart());
    this.on(screen, '[data-action="quit"]', () => this.actions.quitToTitle());
    return screen;
  }

  private segmented(name: string, options: Array<[string, string]>): string {
    const buttons = options
      .map(([value, key]) => `<button type="button" class="segment" data-group="${name}" data-value="${value}" data-i18n="${key}"></button>`)
      .join('');
    return `<div class="segments" role="group" aria-labelledby="label-${name}">${buttons}</div>`;
  }

  private buildSettings(): HTMLElement {
    const screen = this.makeScreen(
      'settings',
      `<div class="board board-menu board-wide">
        ${corners()}
        <h2 class="menu-title" data-i18n="settings.title"></h2>
        <div class="settings-grid">
          <span class="settings-label" id="label-world" data-i18n="settings.world"></span>
          ${this.segmented('world', [['city', 'settings.worldCity'], ['test', 'settings.worldTest']])}
          <span class="settings-label" id="label-language" data-i18n="settings.language"></span>
          ${this.segmented('language', [['bn', 'settings.languageBn'], ['en', 'settings.languageEn']])}
          <span class="settings-label" id="label-digits" data-i18n="settings.digits"></span>
          ${this.segmented('digits', [['bn', 'settings.digitsBn'], ['latn', 'settings.digitsLatn']])}
          <span class="settings-label city-only" id="label-time" data-i18n="settings.time"></span>
          ${this.segmented('time', [['auto', 'settings.timeAuto'], ['dawn', 'settings.timeDawn'], ['day', 'settings.timeDay'], ['dusk', 'settings.timeDusk'], ['night', 'settings.timeNight']])}
          <span class="settings-label city-only" id="label-weather" data-i18n="settings.weather"></span>
          ${this.segmented('weather', [['auto', 'settings.weatherAuto'], ['clear', 'settings.weatherClear'], ['monsoon', 'settings.weatherMonsoon'], ['fog', 'settings.weatherFog'], ['blackout', 'settings.weatherBlackout']])}
          <span class="settings-label city-only" id="label-radio" data-i18n="settings.radio"></span>
          ${this.segmented('radio', [['full', 'settings.radioFull'], ['music', 'settings.radioMusic'], ['off', 'settings.off']])}
          <span class="settings-label" id="label-grain" data-i18n="settings.grain"></span>
          ${this.segmented('grain', [['1', 'settings.on'], ['0', 'settings.off']])}
          <span class="settings-label" id="label-quality" data-i18n="settings.quality"></span>
          ${this.segmented('quality', [
            ['auto', 'settings.qualityAuto'],
            ['low', 'settings.qualityLow'],
            ['medium', 'settings.qualityMedium'],
            ['high', 'settings.qualityHigh'],
            ['ultra', 'settings.qualityUltra'],
          ])}
          <span class="settings-label" id="label-motion" data-i18n="settings.reduceMotion"></span>
          ${this.segmented('motion', [['1', 'settings.on'], ['0', 'settings.off']])}
          <span class="settings-label" id="label-calendar" data-i18n="settings.calendar"></span>
          ${this.segmented('calendar', [['1', 'settings.on'], ['0', 'settings.off']])}
          <span class="settings-label" id="label-radioVoice" data-i18n="settings.radioVoice"></span>
          ${this.segmented('radioVoice', [['1', 'settings.on'], ['0', 'settings.off']])}
          <label class="settings-label" for="volume-slider" data-i18n="settings.volume"></label>
          <input id="volume-slider" class="volume" type="range" min="0" max="100" step="5" />
          <label class="settings-label city-only" for="music-slider" data-i18n="settings.music"></label>
          <input id="music-slider" class="volume city-only" type="range" min="0" max="100" step="5" />
          <h3 class="settings-group city-only" data-i18n="settings.groupOnline"></h3>
          <span class="settings-label city-only" id="label-ghosts" data-i18n="settings.ghosts"></span>
          ${this.segmented('ghosts', [['1', 'settings.on'], ['0', 'settings.off']])}
          <span class="settings-label city-only" id="label-upload" data-i18n="settings.upload"></span>
          ${this.segmented('upload', [['1', 'settings.on'], ['0', 'settings.off']])}
          <span class="settings-label city-only" id="label-banter" data-i18n="settings.banter"></span>
          ${this.segmented('banter', [['1', 'settings.on'], ['0', 'settings.off']])}
          <p class="settings-note city-only" data-i18n="settings.banterNote"></p>
          <h3 class="settings-group" data-i18n="settings.groupControls"></h3>
          <span class="settings-label" id="label-steer" data-i18n="settings.touchSteer"></span>
          ${this.segmented('steer', [['buttons', 'settings.steerButtons'], ['slider', 'settings.steerSlider'], ['tilt', 'settings.steerTilt']])}
          <span class="settings-label" id="label-tiltInvert" data-i18n="settings.tiltInvert"></span>
          ${this.segmented('tiltInvert', [['1', 'settings.on'], ['0', 'settings.off']])}
          <span class="settings-label" id="label-rumble" data-i18n="settings.rumble"></span>
          ${this.segmented('rumble', [['1', 'settings.on'], ['0', 'settings.off']])}
          <h3 class="settings-group" data-i18n="settings.groupAccess"></h3>
          <span class="settings-label" id="label-vision" data-i18n="settings.vision"></span>
          ${this.segmented('vision', [['normal', 'settings.visionNormal'], ['protan', 'settings.visionProtan'], ['deutan', 'settings.visionDeutan'], ['tritan', 'settings.visionTritan']])}
          <span class="settings-label" id="label-subtitles" data-i18n="settings.subtitles"></span>
          ${this.segmented('subtitles', [['small', 'settings.subSmall'], ['normal', 'settings.subNormal'], ['large', 'settings.subLarge'], ['huge', 'settings.subHuge']])}
          <span class="settings-label" id="label-backing" data-i18n="settings.subtitleBacking"></span>
          ${this.segmented('backing', [['1', 'settings.on'], ['0', 'settings.off']])}
          <span class="settings-label" id="label-contrast" data-i18n="settings.contrast"></span>
          ${this.segmented('contrast', [['1', 'settings.on'], ['0', 'settings.off']])}
          <p class="settings-note settings-tilt-note" role="status"></p>
        </div>
        <p class="settings-warning" data-i18n="settings.storageWarning"></p>
        <button type="button" class="plaque plaque-indigo" data-action="back" data-i18n="settings.back"></button>
      </div>`,
    );
    this.on(screen, '[data-action="back"]', () => this.open(this.returnTo));
    if (getSettings().world !== 'city') {
      screen.querySelectorAll('.city-only').forEach((element) => element.remove());
      for (const group of ['time', 'weather', 'radio', 'ghosts', 'upload', 'banter']) screen.querySelector(`[data-group="${group}"]`)?.parentElement?.remove();
    }
    screen.querySelectorAll<HTMLButtonElement>('.segment').forEach((button) => {
      button.addEventListener('click', () => this.onSegment(button.dataset.group as string, button.dataset.value as string));
    });
    const slider = screen.querySelector<HTMLInputElement>('#volume-slider');
    slider?.addEventListener('input', () => {
      const value = Number(slider.value) / 100;
      updateSettings({ volume: value });
      this.actions.setVolume(value);
    });
    const music = screen.querySelector<HTMLInputElement>('#music-slider');
    music?.addEventListener('input', () => {
      const value = Number(music.value) / 100;
      updateSettings({ musicVolume: value });
      this.actions.setMusicVolume(value);
    });
    return screen;
  }

  private onSegment(group: string, value: string): void {
    switch (group) {
      case 'world': {
        const world = value as WorldChoice;
        if (world !== getSettings().world) {
          updateSettings({ world });
          // Each world is built once at start, so a clean reload is the safe way to switch.
          window.location.reload();
        }
        break;
      }
      case 'language': {
        const locale = value as Locale;
        // The digits follow the language unless the player has picked them apart later.
        updateSettings({ locale, digits: locale === 'bn' ? 'bn' : 'latn' });
        setDigitMode(locale === 'bn' ? 'bn' : 'latn');
        setLocale(locale);
        break;
      }
      case 'digits':
        updateSettings({ digits: value as DigitMode });
        setDigitMode(value as DigitMode);
        break;
      case 'quality': {
        const quality = value as QualitySetting;
        if (quality !== getSettings().quality) {
          updateSettings({ quality });
          // Geometry and buffers depend on the preset, so a clean reload is the safe way to switch.
          window.location.reload();
        }
        break;
      }
      case 'motion':
        updateSettings({ reduceMotion: value === '1' });
        this.actions.setReduceMotion(value === '1');
        break;
      case 'calendar':
        updateSettings({ showBongabdo: value === '1' });
        this.refreshDate();
        break;
      case 'radioVoice':
        updateSettings({ radioVoice: value === '1' });
        break;
      case 'time':
        updateSettings({ timeLock: value as TimeLock });
        this.actions.applyAtmosphere();
        break;
      case 'weather':
        updateSettings({ weatherLock: value as WeatherLock });
        this.actions.applyAtmosphere();
        break;
      case 'radio':
        updateSettings({ radioMode: value as RadioMode });
        this.actions.applyRadio();
        break;
      case 'grain':
        updateSettings({ filmGrain: value === '1' });
        this.actions.applyAtmosphere();
        break;
      case 'ghosts':
        updateSettings({ ghosts: value === '1' });
        break;
      case 'upload':
        updateSettings({ leaderboardUpload: value === '1' });
        break;
      case 'banter':
        updateSettings({ aiBanter: value === '1' });
        break;
      case 'steer': {
        const mode = value as TouchSteer;
        const note = this.settings.querySelector('.settings-tilt-note') as HTMLElement;
        note.textContent = '';
        if (mode === 'tilt') {
          // The permission prompt needs this very tap, so it is asked for here.
          void TiltInput.requestPermission().then((allowed) => {
            if (!allowed) {
              updateSettings({ touchSteer: 'buttons' });
              note.textContent = t('settings.tiltDenied');
              this.actions.applyControls();
              this.refreshSettingsState();
            }
          });
        }
        updateSettings({ touchSteer: mode });
        this.actions.applyControls();
        break;
      }
      case 'tiltInvert':
        updateSettings({ tiltInvert: value === '1' });
        break;
      case 'rumble':
        updateSettings({ rumble: value === '1' });
        break;
      case 'vision':
        updateSettings({ colourVision: value as ColourVision });
        this.actions.applyAccessibility();
        break;
      case 'subtitles':
        updateSettings({ subtitleSize: value as SubtitleSize });
        this.actions.applyAccessibility();
        break;
      case 'backing':
        updateSettings({ subtitleBacking: value === '1' });
        this.actions.applyAccessibility();
        break;
      case 'contrast':
        updateSettings({ highContrast: value === '1' });
        this.actions.applyAccessibility();
        break;
    }
    this.refreshSettingsState();
  }

  private refreshSettingsState(): void {
    const settings = getSettings();
    const selected: Record<string, string> = {
      world: settings.world,
      language: getLocale(),
      digits: getDigitMode(),
      quality: settings.quality,
      motion: settings.reduceMotion ? '1' : '0',
      calendar: settings.showBongabdo ? '1' : '0',
      radioVoice: settings.radioVoice ? '1' : '0',
      time: settings.timeLock,
      weather: settings.weatherLock,
      radio: settings.radioMode,
      grain: settings.filmGrain ? '1' : '0',
      ghosts: settings.ghosts ? '1' : '0',
      upload: settings.leaderboardUpload ? '1' : '0',
      banter: settings.aiBanter ? '1' : '0',
      steer: settings.touchSteer,
      tiltInvert: settings.tiltInvert ? '1' : '0',
      rumble: settings.rumble ? '1' : '0',
      vision: settings.colourVision,
      subtitles: settings.subtitleSize,
      backing: settings.subtitleBacking ? '1' : '0',
      contrast: settings.highContrast ? '1' : '0',
    };
    this.settings.querySelectorAll<HTMLButtonElement>('.segment').forEach((button) => {
      const pressed = selected[button.dataset.group as string] === button.dataset.value;
      button.setAttribute('aria-pressed', String(pressed));
    });
    const slider = this.settings.querySelector<HTMLInputElement>('#volume-slider');
    if (slider) slider.value = String(Math.round(settings.volume * 100));
    const music = this.settings.querySelector<HTMLInputElement>('#music-slider');
    if (music) music.value = String(Math.round(settings.musicVolume * 100));
    this.settings.querySelector('.settings-warning')?.classList.toggle('is-visible', !isStorageWorking());
  }

  private buildControls(): HTMLElement {
    const rows = CONTROL_ACTIONS.map((action) => {
      const bindable = (BIND_ACTIONS as readonly string[]).includes(action);
      const keys = bindable
        ? `<td class="controls-keys" data-bind="${action}"></td>`
        : `<td><kbd data-i18n="controls.key.${action}"></kbd></td>`;
      return `<tr>
        <th scope="row" data-i18n="controls.action.${action}"></th>
        ${keys}
        <td><kbd data-i18n="controls.pad.${action}"></kbd></td>
      </tr>`;
    }).join('');
    const screen = this.makeScreen(
      'controls',
      `<div class="board board-menu board-wide">
        ${corners()}
        <h2 class="menu-title" data-i18n="controls.title"></h2>
        <div class="controls-scroll">
          <table class="controls-table">
            <thead><tr><td></td><th scope="col" data-i18n="controls.keyboard"></th><th scope="col" data-i18n="controls.gamepad"></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <p class="controls-hint" role="status" aria-live="polite"></p>
        <div class="controls-buttons">
          <button type="button" class="plaque plaque-soot" data-action="resetKeys" data-i18n="controls.resetKeys"></button>
          <button type="button" class="plaque plaque-indigo" data-action="back" data-i18n="settings.back"></button>
        </div>
      </div>`,
    );
    this.on(screen, '[data-action="back"]', () => {
      this.stopCapture();
      this.open(this.returnTo);
    });
    this.on(screen, '[data-action="resetKeys"]', () => {
      this.stopCapture();
      updateSettings({ keyBindings: defaultBindings() });
      this.actions.applyControls();
      this.renderBindings(screen);
      this.setControlsHint(screen, t('controls.keysReset'));
    });
    this.renderBindings(screen);
    onI18nChange(() => this.renderBindings(screen));
    return screen;
  }

  private capture: { action: BindAction; slot: number } | null = null;

  private setControlsHint(screen: HTMLElement, text: string): void {
    (screen.querySelector('.controls-hint') as HTMLElement).textContent = text;
  }

  /** Two key buttons per action: press one, then the new key. */
  private renderBindings(screen: HTMLElement): void {
    const bindings = getSettings().keyBindings;
    screen.querySelectorAll<HTMLElement>('[data-bind]').forEach((cell) => {
      const action = cell.dataset.bind as BindAction;
      cell.replaceChildren();
      for (let slot = 0; slot < 2; slot++) {
        const code = bindings[action]?.[slot];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'key-bind';
        const waiting = this.capture?.action === action && this.capture.slot === slot;
        button.textContent = waiting ? t('controls.pressKey') : code ? keyLabel(code) : '—';
        button.classList.toggle('is-waiting', waiting);
        button.setAttribute('aria-label', t('controls.bindLabel', { action: t(`controls.action.${action}`), key: code ? keyLabel(code) : t('controls.noKey') }));
        button.addEventListener('click', () => this.startCapture(screen, action, slot));
        cell.appendChild(button);
      }
    });
  }

  private startCapture(screen: HTMLElement, action: BindAction, slot: number): void {
    this.stopCapture();
    this.capture = { action, slot };
    this.actions.captureKeys(true);
    this.setControlsHint(screen, t('controls.pressKeyFor', { action: t(`controls.action.${action}`) }));
    window.addEventListener('keydown', this.onCaptureKey, true);
    this.renderBindings(screen);
  }

  private stopCapture(): void {
    if (!this.capture) return;
    this.capture = null;
    window.removeEventListener('keydown', this.onCaptureKey, true);
    this.actions.captureKeys(false);
  }

  private onCaptureKey = (event: KeyboardEvent): void => {
    const capture = this.capture;
    if (!capture) return;
    event.preventDefault();
    event.stopPropagation();
    const screen = this.controls;
    if (event.code === 'Escape') {
      this.stopCapture();
      this.setControlsHint(screen, t('controls.captureCancelled'));
      this.renderBindings(screen);
      return;
    }
    if (FIXED_CODES.has(event.code)) {
      this.setControlsHint(screen, t('controls.keyFixed', { key: keyLabel(event.code) }));
      return;
    }
    const bindings = { ...getSettings().keyBindings };
    const keys = [...(bindings[capture.action] ?? [])];
    const slot = Math.min(capture.slot, keys.length);
    const replaced = keys[slot];
    // A key does one job. The action that had it takes this slot's old key instead, so nothing is left bare.
    for (const other of BIND_ACTIONS) {
      if (other === capture.action) continue;
      const theirs = bindings[other] ?? [];
      const at = theirs.indexOf(event.code);
      if (at < 0) continue;
      const swapped = [...theirs];
      if (replaced && !theirs.includes(replaced)) swapped[at] = replaced;
      else swapped.splice(at, 1);
      bindings[other] = swapped;
    }
    keys[slot] = event.code;
    bindings[capture.action] = keys.filter((code, index) => Boolean(code) && keys.indexOf(code) === index).slice(0, 2);
    updateSettings({ keyBindings: bindings });
    this.stopCapture();
    this.actions.applyControls();
    this.setControlsHint(screen, t('controls.keySet', { action: t(`controls.action.${capture.action}`), key: keyLabel(event.code) }));
    this.renderBindings(screen);
  };

  private refreshDate(): void {
    const element = this.title.querySelector('.title-date');
    if (!element) return;
    const show = getSettings().showBongabdo;
    element.textContent = show ? t('title.today', { date: formatBongabdoDate(new Date()) }) : '';
    element.classList.toggle('is-hidden', !show);
  }

  /** Everything on the title and pause screens that depends on the save. */
  refreshCareer(): void {
    const career = getCareer();
    const set = (root: HTMLElement, selector: string, text: string): void => {
      const element = root.querySelector(selector);
      if (element) element.textContent = text;
    };
    set(this.title, '.title-car', t('title.car', { car: t(`car.${career.selectedCar}.name`), cash: formatNumber(career.cash), level: formatInteger(levelFor(career.ringPoints)) }));
    set(this.pause, '[data-action="adda"]', t(career.addaMode ? 'pause.addaOn' : 'pause.addaOff'));
  }

  /** Shows one screen, or none, and moves keyboard focus into it. */
  open(name: ScreenName, returnTo?: ScreenName): void {
    if (returnTo) this.returnTo = returnTo;
    this.current = name;
    for (const [key, element] of [['title', this.title], ['pause', this.pause], ['settings', this.settings], ['controls', this.controls]] as const) {
      element.classList.toggle('is-open', key === name);
    }
    this.map?.classList.toggle('is-open', name === 'map');
    this.busted?.classList.toggle('is-open', name === 'busted');
    for (const [key, element] of this.extras) element.classList.toggle('is-open', key === name);
    this.root.classList.toggle('is-open', name !== 'none');
    this.root.classList.toggle('is-dimmed', name === 'pause' || name === 'map' || name === 'busted' || name === 'ring' || name === 'raceResult' || ((name === 'settings' || name === 'controls' || name === 'ledger' || name === 'challenges' || name === 'friends') && this.returnTo === 'pause'));
    if (name !== 'controls') this.stopCapture();
    if (name === 'settings') this.refreshSettingsState();
    if (name === 'title' || name === 'pause') this.refreshCareer();
    const base: Partial<Record<ScreenName, HTMLElement | null>> = { title: this.title, pause: this.pause, settings: this.settings, controls: this.controls, map: this.map, busted: this.busted };
    const open = this.extras.get(name) ?? base[name] ?? null;
    open?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  }

  /** Adds the city map screen, which only exists in the city world. */
  attachMap(element: HTMLElement): void {
    this.map = element;
    this.root.appendChild(element);
  }

  /** Adds the arrest screen, which only exists in the city world. */
  attachBusted(element: HTMLElement): void {
    this.busted = element;
    this.root.appendChild(element);
  }

  /** Adds a screen that belongs to a system outside this file. */
  attachExtra(name: ScreenName, element: HTMLElement): void {
    this.extras.set(name, element);
    this.root.appendChild(element);
  }

  /** Shows the buttons that only make sense during a race, or those that do not. */
  setRacing(racing: boolean): void {
    this.pause.classList.toggle('is-racing', racing);
  }

  get currentScreen(): ScreenName {
    return this.current;
  }

  /** Back behaviour for Esc inside nested menus. Returns true if it handled the key. */
  handleBack(): boolean {
    if (this.current === 'settings' || this.current === 'controls' || this.current === 'ledger' || this.current === 'challenges' || this.current === 'friends') {
      this.open(this.returnTo);
      return true;
    }
    return false;
  }
}
