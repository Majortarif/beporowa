import { applyI18n } from '../i18n';
import { TOUCH_SLIDER } from '../config/extras';
import { TUNING } from '../config/tuning';
import { moveToward } from '../core/math';
import type { TouchSteer } from '../save/settings';
import type { InputEdges, Intent } from './intent';

type TouchAction = 'left' | 'right' | 'gas' | 'brake' | 'handbrake' | 'nitro' | 'horn' | 'dom';

const ARROW_LEFT = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M30 8 12 24l18 16" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW_RIGHT = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="m18 8 18 16-18 16" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * On-screen controls for phones. Steering comes three ways: two arrow buttons, a slider that
 * steers as far as the thumb moves, or tilting the phone.
 */
export class TouchInput {
  readonly root: HTMLElement;
  private active = new Set<TouchAction>();
  private pointerActions = new Map<number, TouchAction>();
  private steer = 0;
  private pauseRequested = false;
  private mapRequested = false;
  private ringRequested = false;
  private mode: TouchSteer = 'buttons';
  private readonly slider: HTMLElement;
  private readonly knob: HTMLElement;
  private sliderPointer: number | null = null;
  /** -1 to 1, from the slider. */
  private sliderValue = 0;
  private visible = false;

  constructor(parent: HTMLElement, straighten: () => void) {
    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.innerHTML = `
      <div class="touch-cluster touch-steer">
        <button type="button" class="touch-btn touch-small touch-horn" data-action="horn" data-i18n="touch.horn"></button>
        <button type="button" class="touch-btn touch-small touch-dom" data-action="dom" data-i18n="touch.dom"></button>
        <button type="button" class="touch-btn touch-arrow" data-action="left" data-i18n-label="touch.left">${ARROW_LEFT}</button>
        <button type="button" class="touch-btn touch-arrow" data-action="right" data-i18n-label="touch.right">${ARROW_RIGHT}</button>
        <div class="touch-slider" role="slider" aria-valuemin="-1" aria-valuemax="1" aria-valuenow="0" data-i18n-label="touch.slider"><span class="touch-slider-knob"></span></div>
        <button type="button" class="touch-btn touch-small touch-straighten" data-i18n="touch.straighten"></button>
      </div>
      <div class="touch-cluster touch-pedals">
        <button type="button" class="touch-btn touch-small" data-action="nitro" data-i18n="touch.nitro"></button>
        <button type="button" class="touch-btn touch-small" data-action="handbrake" data-i18n="touch.handbrake"></button>
        <button type="button" class="touch-btn touch-brake" data-action="brake" data-i18n="touch.brake"></button>
        <button type="button" class="touch-btn touch-gas" data-action="gas" data-i18n="touch.gas"></button>
      </div>
      <button type="button" class="touch-pause" data-i18n="touch.pause"></button>
      <button type="button" class="touch-map" data-i18n="touch.map"></button>
      <button type="button" class="touch-ring" data-i18n="touch.ring"></button>`;
    parent.appendChild(this.root);
    applyI18n(this.root);
    this.slider = this.root.querySelector('.touch-slider') as HTMLElement;
    this.knob = this.root.querySelector('.touch-slider-knob') as HTMLElement;

    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((button) => {
      const action = button.dataset.action as TouchAction;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        button.setPointerCapture(event.pointerId);
        button.classList.add('is-pressed');
        this.pointerActions.set(event.pointerId, action);
        this.active.add(action);
      });
      const release = (event: PointerEvent): void => {
        button.classList.remove('is-pressed');
        this.pointerActions.delete(event.pointerId);
        if (![...this.pointerActions.values()].includes(action)) this.active.delete(action);
      };
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('contextmenu', (event) => event.preventDefault());
    });

    // The slider: the thumb's distance from the middle is how far the wheel turns.
    const moveSlider = (event: PointerEvent): void => {
      if (event.pointerId !== this.sliderPointer) return;
      const box = this.slider.getBoundingClientRect();
      const half = (box.width / 2) * TOUCH_SLIDER.fullLockShare;
      const offset = event.clientX - (box.left + box.width / 2);
      this.sliderValue = Math.max(-1, Math.min(1, half > 0 ? offset / half : 0));
    };
    this.slider.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      this.slider.setPointerCapture(event.pointerId);
      this.sliderPointer = event.pointerId;
      moveSlider(event);
    });
    this.slider.addEventListener('pointermove', moveSlider);
    const letGo = (event: PointerEvent): void => {
      if (event.pointerId !== this.sliderPointer) return;
      this.sliderPointer = null;
    };
    this.slider.addEventListener('pointerup', letGo);
    this.slider.addEventListener('pointercancel', letGo);
    this.root.querySelector('.touch-straighten')?.addEventListener('click', () => straighten());

    this.root.querySelector('.touch-pause')?.addEventListener('click', () => {
      this.pauseRequested = true;
    });
    this.root.querySelector('.touch-map')?.addEventListener('click', () => {
      this.mapRequested = true;
    });
    this.root.querySelector('.touch-ring')?.addEventListener('click', () => {
      this.ringRequested = true;
    });
  }

  /** Shows controls only on touch-first devices. */
  static isTouchDevice(): boolean {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  }

  /** On screen right now. */
  get isActive(): boolean {
    return this.visible;
  }

  setSteerMode(mode: TouchSteer): void {
    this.mode = mode;
    this.root.dataset.steer = mode;
    this.sliderValue = 0;
    this.sliderPointer = null;
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    this.root.classList.toggle('is-visible', visible);
    if (!visible) {
      this.active.clear();
      this.pointerActions.clear();
      this.sliderPointer = null;
      this.sliderValue = 0;
    }
  }

  update(dt: number, intent: Intent, edges: InputEdges): void {
    if (this.mode === 'slider') {
      if (this.sliderPointer === null) this.sliderValue = moveToward(this.sliderValue, 0, TOUCH_SLIDER.returnRate * dt);
      this.steer = this.sliderValue;
      this.knob.style.transform = `translateX(${(this.sliderValue * 50 * TOUCH_SLIDER.fullLockShare).toFixed(1)}%)`;
      this.slider.setAttribute('aria-valuenow', this.sliderValue.toFixed(2));
    } else if (this.mode === 'buttons') {
      const target = (this.active.has('right') ? 1 : 0) - (this.active.has('left') ? 1 : 0);
      const rate = target === 0 ? TUNING.input.keyboardSteerReturn : TUNING.input.keyboardSteerRate;
      this.steer = moveToward(this.steer, target, rate * dt);
    } else {
      this.steer = 0;
    }
    if (Math.abs(this.steer) > Math.abs(intent.steer)) intent.steer = this.steer;
    if (this.active.has('gas')) intent.throttle = 1;
    if (this.active.has('brake')) intent.brake = 1;
    if (this.active.has('handbrake')) intent.handbrake = true;
    if (this.active.has('nitro')) intent.nitro = true;
    if (this.active.has('horn')) intent.horn = true;
    if (this.active.has('dom')) intent.dom = true;
    if (this.mapRequested) {
      edges.map = true;
      this.mapRequested = false;
    }
    if (this.ringRequested) {
      edges.ring = true;
      this.ringRequested = false;
    }
    if (this.pauseRequested) {
      edges.pause = true;
      this.pauseRequested = false;
    }
  }
}
