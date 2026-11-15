/** Pursuit parts of the HUD: painted stars, search and arrest meters, the radio plate and দম. */

import { POLICE } from '../config/police-tuning';
import type { RadioCategory } from '../core/events';
import { applyI18n, formatNumber, onI18nChange, t } from '../i18n';
import type { PursuitPhase } from '../police/heat-system';
import type { HideResult } from '../police/police-system';

const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 6.6 7 .8-5.2 4.8 1.5 7L12 17.6 5.7 21.2l1.5-7L2 9.4l7-.8z"/></svg>';

export interface PursuitView {
  phase: PursuitPhase;
  stars: number;
  cooldown: number;
  bust: number;
  hideKind: HideResult['kind'];
  punctured: boolean;
  domValue: number;
  domActive: boolean;
  domAmount: number;
}

export class PursuitHud {
  readonly root: HTMLElement;
  private readonly plate: HTMLElement;
  private readonly starElements: HTMLElement[] = [];
  private readonly state: HTMLElement;
  private readonly cooldownBar: HTMLElement;
  private readonly bustBar: HTMLElement;
  private readonly radio: HTMLElement;
  private readonly radioFrom: HTMLElement;
  private readonly radioLine: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly domRoot: HTMLElement;
  private readonly domBar: HTMLElement;
  private readonly domFrame: HTMLElement;
  private readonly puncture: HTMLElement;

  private radioTimer = 0;
  private bannerTimer = 0;
  private lastStars = -1;
  private stateKey = '';
  private lastCooldown = -1;
  private lastBust = -1;
  private lastDom = -1;
  private lastFrame = -1;
  private lastPunctured = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud-pursuit-layer';
    this.root.innerHTML = `
      <div class="hud-dom-frame"></div>
      <div class="hud-pursuit plate plate-soot">
        <div class="hud-stars">${STAR.repeat(POLICE.levels.length)}</div>
        <div class="hud-pursuit-state" aria-live="polite"></div>
        <div class="hud-meter hud-meter-cool"><i></i></div>
        <div class="hud-meter hud-meter-bust"><i></i></div>
      </div>
      <div class="hud-radio plate plate-tin">
        <span class="hud-radio-from"></span>
        <p class="hud-radio-line"></p>
      </div>
      <div class="hud-banner plate plate-marigold"></div>
      <div class="hud-puncture plate plate-tomato" data-i18n="police.hud.puncture"></div>
      <div class="hud-dom plate plate-indigo">
        <span class="hud-dom-label" data-i18n="police.hud.dom"></span>
        <div class="hud-meter hud-meter-dom"><i></i></div>
      </div>`;
    parent.appendChild(this.root);
    const q = (selector: string): HTMLElement => this.root.querySelector(selector) as HTMLElement;
    this.plate = q('.hud-pursuit');
    this.root.querySelectorAll<HTMLElement>('.hud-stars svg').forEach((star) => this.starElements.push(star as unknown as HTMLElement));
    this.state = q('.hud-pursuit-state');
    this.cooldownBar = q('.hud-meter-cool i');
    this.bustBar = q('.hud-meter-bust i');
    this.radio = q('.hud-radio');
    this.radioFrom = q('.hud-radio-from');
    this.radioLine = q('.hud-radio-line');
    this.banner = q('.hud-banner');
    this.domRoot = q('.hud-dom');
    this.domBar = q('.hud-meter-dom i');
    this.domFrame = q('.hud-dom-frame');
    this.puncture = q('.hud-puncture');
    applyI18n(this.root);
    onI18nChange(() => {
      this.stateKey = '';
    });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }

  showRadio(line: string, category: RadioCategory): void {
    this.radioFrom.textContent = t(category === 'chief' ? 'police.radio.fromChief' : 'police.radio.from');
    this.radioLine.textContent = line;
    this.radio.classList.remove('is-visible');
    void this.radio.offsetWidth;
    this.radio.classList.add('is-visible');
    this.radioTimer = POLICE.radio.showSeconds;
  }

  showBanner(text: string, seconds = 3.2): void {
    this.banner.textContent = text;
    this.banner.classList.remove('is-visible');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-visible');
    this.bannerTimer = seconds;
  }

  showEscaped(points: number): void {
    this.showBanner(t('police.hud.escaped', { points: formatNumber(points) }), 4);
  }

  update(dt: number, view: PursuitView): void {
    if (this.radioTimer > 0) {
      this.radioTimer -= dt;
      if (this.radioTimer <= 0) this.radio.classList.remove('is-visible');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('is-visible');
    }

    const active = view.phase !== 'calm';
    this.plate.classList.toggle('is-visible', active);
    this.plate.classList.toggle('is-evading', view.phase === 'evading');
    if (view.stars !== this.lastStars) {
      this.starElements.forEach((star, index) => {
        star.classList.toggle('is-on', index < view.stars);
      });
      if (view.stars > this.lastStars && view.stars > 0) {
        this.plate.classList.remove('is-level-up');
        void this.plate.offsetWidth;
        this.plate.classList.add('is-level-up');
      }
      this.lastStars = view.stars;
    }
    if (active) {
      let key = view.bust > 0.05 ? 'police.hud.arrest' : view.phase === 'evading' ? 'police.hud.evading' : 'police.hud.pursuit';
      if (view.phase === 'evading' && view.hideKind !== 'none') key = `police.hud.hide.${view.hideKind}`;
      if (key !== this.stateKey) {
        this.stateKey = key;
        this.state.textContent = t(key);
      }
      const cool = view.phase === 'evading' ? view.cooldown : 0;
      if (Math.abs(cool - this.lastCooldown) > 0.005) {
        this.lastCooldown = cool;
        this.cooldownBar.style.transform = `scaleX(${cool.toFixed(3)})`;
      }
      if (Math.abs(view.bust - this.lastBust) > 0.005) {
        this.lastBust = view.bust;
        this.bustBar.style.transform = `scaleX(${view.bust.toFixed(3)})`;
        this.plate.classList.toggle('is-busting', view.bust > 0.02);
      }
    }

    const dom = view.domValue / POLICE.dom.capacity;
    if (Math.abs(dom - this.lastDom) > 0.004) {
      this.lastDom = dom;
      this.domBar.style.transform = `scaleX(${dom.toFixed(3)})`;
      this.domRoot.classList.toggle('is-low', view.domValue < POLICE.dom.minToStart);
    }
    this.domRoot.classList.toggle('is-active', view.domActive);
    if (Math.abs(view.domAmount - this.lastFrame) > 0.01) {
      this.lastFrame = view.domAmount;
      this.domFrame.style.opacity = view.domAmount.toFixed(2);
    }
    if (view.punctured !== this.lastPunctured) {
      this.lastPunctured = view.punctured;
      this.puncture.classList.toggle('is-visible', view.punctured);
    }
  }

  /** Clears what is on screen, for a restart. */
  clear(): void {
    this.radio.classList.remove('is-visible');
    this.banner.classList.remove('is-visible');
    this.radioTimer = 0;
    this.bannerTimer = 0;
    this.stateKey = '';
  }
}
