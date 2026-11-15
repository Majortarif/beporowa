/**
 * হর্ন ভাষা: turns horn presses into patterns.
 * Taps are counted until a short silence ends the phrase; holding the horn is a long call.
 */

import { CITY } from '../config/city-tuning';
import type { HornPattern } from '../core/events';

export class HornLanguage {
  private held = false;
  private pressTime = 0;
  private gapTime = 0;
  private taps = 0;
  private longFired = false;

  /** @returns a pattern on the frame it is recognised, otherwise null */
  update(dt: number, horn: boolean): HornPattern | null {
    const config = CITY.horn;
    if (horn) {
      if (!this.held) {
        this.held = true;
        this.pressTime = 0;
        this.longFired = false;
      }
      this.pressTime += dt;
      if (!this.longFired && this.pressTime >= config.longPressSeconds) {
        this.longFired = true;
        this.taps = 0;
        return 'long';
      }
      return null;
    }
    if (this.held) {
      this.held = false;
      if (!this.longFired) {
        this.taps++;
        this.gapTime = 0;
      }
      return null;
    }
    if (this.taps > 0) {
      this.gapTime += dt;
      if (this.gapTime >= config.tapGapSeconds) {
        const taps = this.taps;
        this.taps = 0;
        return taps === 1 ? 'tap' : taps === 2 ? 'double' : 'triple';
      }
    }
    return null;
  }
}
