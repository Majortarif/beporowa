/**
 * দম: hold your breath and the world slows down. A meter fills from driving close and burns
 * while held. Timing runs on real seconds, so a full meter always lasts the same on the clock.
 */

import { POLICE } from '../config/police-tuning';
import { clamp, dampFactor } from '../core/math';

export class DomMeter {
  value: number = POLICE.dom.start;
  active = false;
  /** 1 is normal speed. Slower while দম is held or a trap comes down. */
  timeScale = 1;
  private wasHeld = false;
  private dipSeconds = 0;
  private dipScale = 1;

  add(amount: number): void {
    this.value = clamp(this.value + amount, 0, POLICE.dom.capacity);
  }

  /** A short slow-motion beat, which costs nothing from the meter. */
  dip(seconds: number, scale: number): void {
    this.dipSeconds = seconds;
    this.dipScale = scale;
  }

  /** Returns how fast time should run this frame. */
  update(realDt: number, held: boolean, drifting: boolean): number {
    const config = POLICE.dom;
    if (held && !this.wasHeld && !this.active && this.value >= config.minToStart) this.active = true;
    if (!held) this.active = false;
    this.wasHeld = held;

    if (this.active) {
      this.value -= (config.capacity / config.fullBurnSeconds) * realDt;
      if (this.value <= 0) {
        this.value = 0;
        this.active = false;
      }
    } else {
      this.add(config.passivePerSecond * realDt);
      if (drifting) this.add(config.driftPerSecond * realDt);
    }

    let target = this.active ? config.timeScale : 1;
    if (this.dipSeconds > 0) {
      this.dipSeconds -= realDt;
      target = Math.min(target, this.dipScale);
    }
    this.timeScale += (target - this.timeScale) * dampFactor(1 / config.blendSeconds, realDt);
    if (Math.abs(this.timeScale - target) < 0.002) this.timeScale = target;
    return this.timeScale;
  }

  /** How strong the slow motion looks: 0 at normal speed, 1 at the slowest. */
  get amount(): number {
    return clamp((1 - this.timeScale) / (1 - POLICE.dom.timeScale), 0, 1);
  }

  reset(): void {
    this.value = POLICE.dom.start;
    this.active = false;
    this.timeScale = 1;
    this.wasHeld = false;
    this.dipSeconds = 0;
  }
}
