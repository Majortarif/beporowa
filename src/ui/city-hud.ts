/** City parts of the HUD: district plate, points, GPS directions, horn feedback, speech bubbles. */

import type { PerspectiveCamera } from 'three';
import { Vector3 } from 'three';
import { CITY } from '../config/city-tuning';
import { PROGRESS } from '../config/progression';
import { applyI18n, formatInteger, formatNumber, onI18nChange, t, tList } from '../i18n';
import type { GpsInstruction, TurnKind } from '../gps/gps-navigator';
import { DISTRICT_NAME_KEYS, type DistrictId } from '../world/city/city-map';
import type { MapPainter } from './minimap';
import { Minimap } from './minimap';

const TURN_ROTATION: Record<TurnKind, number> = { straight: 0, left: -90, right: 90, uturn: 180, arrive: 0, turnAround: 180 };

const SVG_ARROW = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 40 26H29v16H19V26H8Z" fill="currentColor" stroke="#1b1410" stroke-width="3" stroke-linejoin="round"/></svg>';

const BUBBLE_COUNT = 5;

interface Bubble {
  element: HTMLElement;
  timer: number;
  world: Vector3;
}

export class CityHud {
  readonly root: HTMLElement;
  readonly minimap: Minimap;
  private readonly district: HTMLElement;
  private readonly points: HTMLElement;
  private readonly gpsPlate: HTMLElement;
  private readonly gpsArrow: HTMLElement;
  private readonly gpsMain: HTMLElement;
  private readonly gpsSub: HTMLElement;
  private readonly hornToast: HTMLElement;
  private readonly tutorial: HTMLElement;
  private readonly tutorialText: HTMLElement;
  private readonly bubbles: Bubble[] = [];
  private readonly projected = new Vector3();
  private districtTimer = 0;
  private hornTimer = 0;
  private gpsTimer = 0;
  private currentDistrict: DistrictId | null = null;
  private shownCash = -1;
  private targetCash = 0;
  private level = 1;
  private readonly condition: HTMLElement;
  private readonly conditionFill: HTMLElement;
  private shownCondition = -1;
  private readonly clock: HTMLElement;
  private bubbleCursor = 0;
  private tutorialKey: string | null = null;

  /** Fires when the player presses the tutorial's skip button. */
  onTutorialSkip: (() => void) | null = null;

  constructor(parent: HTMLElement, painter: MapPainter) {
    this.root = document.createElement('div');
    this.root.className = 'hud-city';
    this.root.innerHTML = `
      <div class="hud-district plate plate-indigo">
        <div class="hud-district-name"></div>
        <div class="hud-points"></div>
        <div class="hud-condition" role="img"><i></i></div>
        <div class="hud-clock"></div>
      </div>
      <div class="hud-gps plate plate-tin">
        <div class="hud-gps-arrow">${SVG_ARROW}</div>
        <div class="hud-gps-text">
          <div class="hud-gps-main"></div>
          <div class="hud-gps-sub"></div>
        </div>
      </div>
      <div class="hud-horn-toast plate plate-marigold"></div>
      <div class="hud-tutorial plate plate-tin">
        <span class="hud-tutorial-name" data-i18n="city.tutorial.speaker"></span>
        <p class="hud-tutorial-text"></p>
        <button type="button" class="hud-tutorial-skip" data-i18n="city.tutorial.skip"></button>
      </div>
      <div class="hud-bubbles"></div>`;
    parent.appendChild(this.root);
    const q = (selector: string): HTMLElement => this.root.querySelector(selector) as HTMLElement;
    this.district = q('.hud-district-name');
    this.points = q('.hud-points');
    this.condition = q('.hud-condition');
    this.conditionFill = q('.hud-condition i');
    this.clock = q('.hud-clock');
    this.gpsPlate = q('.hud-gps');
    this.gpsArrow = q('.hud-gps-arrow');
    this.gpsMain = q('.hud-gps-main');
    this.gpsSub = q('.hud-gps-sub');
    this.hornToast = q('.hud-horn-toast');
    this.tutorial = q('.hud-tutorial');
    this.tutorialText = q('.hud-tutorial-text');
    const bubbleRoot = q('.hud-bubbles');
    for (let i = 0; i < BUBBLE_COUNT; i++) {
      const element = document.createElement('div');
      element.className = 'hud-bubble';
      bubbleRoot.appendChild(element);
      this.bubbles.push({ element, timer: 0, world: new Vector3() });
    }
    this.minimap = new Minimap(this.root, painter);
    applyI18n(this.root);
    q('.hud-tutorial-skip').addEventListener('click', () => this.onTutorialSkip?.());
    this.refreshPoints();
    onI18nChange(() => {
      this.refreshPoints();
      this.refreshDistrict();
      if (this.tutorialKey) this.tutorialText.textContent = t(this.tutorialKey);
    });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }

  /** The hour and the weather, in words. */
  setClock(text: string): void {
    if (this.clock.textContent !== text) this.clock.textContent = text;
  }

  /** Sets what the plate should show. The cash rolls up to its new value in update. */
  setMoney(cash: number, level: number, condition: number): void {
    this.targetCash = cash;
    if (this.shownCash < 0 || level !== this.level) {
      this.level = level;
      if (this.shownCash < 0) this.shownCash = cash;
      this.refreshPoints();
    }
    const rounded = Math.round(condition);
    if (rounded !== this.shownCondition) {
      this.shownCondition = rounded;
      this.conditionFill.style.width = `${rounded}%`;
      this.condition.classList.toggle('is-low', rounded < PROGRESS.condition.limpFrom);
      this.condition.setAttribute('aria-label', t('hud.condition', { condition: formatInteger(rounded) }));
    }
  }

  private refreshPoints(): void {
    const cash = formatNumber(Math.max(0, Math.round(this.shownCash)));
    this.points.textContent = `${t('hud.money', { cash })} · ${t('hud.level', { level: formatInteger(this.level) })}`;
  }

  /** The cash counter rolls toward the real figure, and arrives at once for anyone with less motion. */
  private rollCash(dt: number): void {
    if (this.shownCash === this.targetCash) return;
    const instant = document.documentElement.dataset.reduceMotion === '1';
    const gap = this.targetCash - this.shownCash;
    const step = Math.max(Math.abs(gap) * Math.min(1, dt * 5), 40 * dt);
    this.shownCash = instant || Math.abs(gap) <= step ? this.targetCash : this.shownCash + Math.sign(gap) * step;
    this.refreshPoints();
  }

  private refreshDistrict(): void {
    if (this.currentDistrict) this.district.textContent = t(DISTRICT_NAME_KEYS[this.currentDistrict]);
  }

  setDistrict(district: DistrictId): void {
    if (district === this.currentDistrict) return;
    this.currentDistrict = district;
    this.refreshDistrict();
    this.district.classList.remove('is-new');
    void this.district.offsetWidth;
    this.district.classList.add('is-new');
    this.districtTimer = CITY.scoring.districtPlateSeconds;
  }

  showHornPattern(key: string): void {
    this.hornToast.textContent = t(key);
    this.hornToast.classList.add('is-visible');
    this.hornTimer = 1.3;
  }

  /** Shows a tutorial line from ওস্তাদ, or hides the plate. */
  setTutorial(key: string | null): void {
    this.tutorialKey = key;
    this.tutorial.classList.toggle('is-visible', key !== null);
    if (key) this.tutorialText.textContent = t(key);
  }

  /** A short spoken line above a vehicle or person. */
  say(listKey: string, x: number, y: number, z: number, height: number): void {
    const lines = tList(listKey);
    if (lines.length === 0) return;
    const bubble = this.bubbles[this.bubbleCursor];
    this.bubbleCursor = (this.bubbleCursor + 1) % this.bubbles.length;
    bubble.element.textContent = lines[Math.floor(Math.random() * lines.length)];
    bubble.world.set(x, y + height, z);
    bubble.timer = CITY.horn.bubbleSeconds;
    bubble.element.classList.remove('is-visible');
    void bubble.element.offsetWidth;
    bubble.element.classList.add('is-visible');
  }

  showArrived(name: string): void {
    this.gpsPlate.classList.add('is-visible', 'is-arrived');
    this.gpsArrow.style.transform = 'rotate(0deg)';
    this.gpsMain.textContent = t('city.gps.arrived');
    this.gpsSub.textContent = name;
    this.gpsTimer = 4;
  }

  hideGps(): void {
    this.gpsPlate.classList.remove('is-visible', 'is-arrived');
    this.gpsTimer = 0;
  }

  updateGps(instruction: GpsInstruction, destinationName: string): void {
    this.gpsPlate.classList.add('is-visible');
    this.gpsPlate.classList.remove('is-arrived');
    this.gpsArrow.style.transform = `rotate(${TURN_ROTATION[instruction.turn]}deg)`;
    const metres = formatInteger(Math.round(instruction.distance / 10) * 10);
    const key = `city.gps.turn.${instruction.turn}`;
    this.gpsMain.textContent = t(key, { metres });
    this.gpsSub.textContent = t('city.gps.toward', { name: destinationName, remaining: formatNumber(Math.round(instruction.remaining / 10) * 10) });
  }

  update(dt: number, camera: PerspectiveCamera, width: number, height: number): void {
    this.rollCash(dt);
    if (this.districtTimer > 0) this.districtTimer -= dt;
    if (this.hornTimer > 0) {
      this.hornTimer -= dt;
      if (this.hornTimer <= 0) this.hornToast.classList.remove('is-visible');
    }
    if (this.gpsTimer > 0) {
      this.gpsTimer -= dt;
      if (this.gpsTimer <= 0) this.hideGps();
    }
    for (const bubble of this.bubbles) {
      if (bubble.timer <= 0) continue;
      bubble.timer -= dt;
      if (bubble.timer <= 0) {
        bubble.element.classList.remove('is-visible');
        continue;
      }
      this.projected.copy(bubble.world).project(camera);
      const visible = this.projected.z < 1 && Math.abs(this.projected.x) < 1 && Math.abs(this.projected.y) < 1;
      bubble.element.style.opacity = visible ? '' : '0';
      if (visible) {
        const x = (this.projected.x * 0.5 + 0.5) * width;
        const y = (-this.projected.y * 0.5 + 0.5) * height;
        bubble.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
  }

  /** Clears speech and toasts, for a restart. */
  clearTransient(): void {
    for (const bubble of this.bubbles) {
      bubble.timer = 0;
      bubble.element.classList.remove('is-visible');
    }
    this.hornToast.classList.remove('is-visible');
    this.hideGps();
  }
}

