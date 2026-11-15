import { TUNING } from '../config/tuning';
import type { InputEdges, Intent } from './intent';

/** Standard Gamepad API mapping (Xbox layout names). */
const BUTTON = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, dpadUp: 12, dpadLeft: 14, dpadRight: 15 };

export class GamepadInput {
  private previous: boolean[] = [];
  /** The pad in use, for rumble. */
  pad: Gamepad | null = null;

  update(intent: Intent, edges: InputEdges): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    let pad: Gamepad | null = null;
    for (const candidate of pads) {
      if (candidate && candidate.connected) {
        pad = candidate;
        break;
      }
    }
    this.pad = pad;
    if (!pad) return;

    const config = TUNING.input;
    const rawSteer = pad.axes[0] ?? 0;
    if (Math.abs(rawSteer) > config.gamepadDeadzone) {
      const magnitude = (Math.abs(rawSteer) - config.gamepadDeadzone) / (1 - config.gamepadDeadzone);
      const curved = Math.pow(magnitude, config.gamepadSteerCurve) * Math.sign(rawSteer);
      if (Math.abs(curved) > Math.abs(intent.steer)) intent.steer = curved;
    }

    const trigger = (index: number): number => {
      const value = pad.buttons[index]?.value ?? 0;
      return value > config.gamepadTriggerDeadzone ? value : 0;
    };
    intent.throttle = Math.max(intent.throttle, trigger(BUTTON.rt));
    intent.brake = Math.max(intent.brake, trigger(BUTTON.lt));

    const pressed = (index: number): boolean => pad.buttons[index]?.pressed ?? false;
    if (pressed(BUTTON.a)) intent.handbrake = true;
    if (pressed(BUTTON.b)) intent.nitro = true;
    if (pressed(BUTTON.rb)) intent.horn = true;
    if (pressed(BUTTON.lb)) intent.lookBack = true;
    if (pressed(BUTTON.l3) || pressed(BUTTON.r3)) intent.dom = true;

    const edge = (index: number): boolean => pressed(index) && !this.previous[index];
    if (edge(BUTTON.y)) edges.camera = true;
    if (edge(BUTTON.x)) edges.reset = true;
    if (edge(BUTTON.start)) edges.pause = true;
    if (edge(BUTTON.back)) edges.map = true;
    if (edge(BUTTON.dpadUp)) edges.ring = true;
    if (edge(BUTTON.a) || edge(BUTTON.start)) edges.confirm = true;
    if (edge(BUTTON.dpadLeft)) edges.left = true;
    if (edge(BUTTON.dpadRight)) edges.right = true;

    for (let i = 0; i < pad.buttons.length; i++) this.previous[i] = pad.buttons[i].pressed;
  }
}
