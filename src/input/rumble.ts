/**
 * Gamepad rumble, and a short buzz on phones that have one. Only for moments that matter, and
 * never when switched off in the settings. Pads without motors simply feel nothing.
 */

import { RUMBLE } from '../config/extras';
import { getSettings } from '../save/settings';

type RumbleKind = keyof typeof RUMBLE;

interface Actuator {
  playEffect?: (type: 'dual-rumble', params: { startDelay: number; duration: number; weakMagnitude: number; strongMagnitude: number }) => Promise<unknown>;
}

export class Rumble {
  /** The gamepad last used, if any. */
  pad: Gamepad | null = null;
  /** Phones buzz only for hard knocks, and only if the player is on touch controls. */
  phone = false;

  play(kind: RumbleKind, scale = 1): void {
    if (!getSettings().rumble) return;
    const shape = RUMBLE[kind];
    const amount = Math.max(0, Math.min(1, scale));
    if (amount <= 0) return;
    const actuator = (this.pad as unknown as { vibrationActuator?: Actuator } | null)?.vibrationActuator;
    if (actuator?.playEffect) {
      actuator
        .playEffect('dual-rumble', { startDelay: 0, duration: shape.ms, weakMagnitude: shape.weak * amount, strongMagnitude: shape.strong * amount })
        .catch(() => undefined);
      return;
    }
    if (this.phone && (kind === 'impact' || kind === 'pothole') && typeof navigator.vibrate === 'function') {
      navigator.vibrate(Math.round(Math.min(shape.ms, 120) * amount));
    }
  }
}
