import { getSettings } from '../save/settings';
import { GamepadInput } from './gamepad';
import { createEdges, createIntent, type InputEdges, type Intent } from './intent';
import { KeyboardInput } from './keyboard';
import { Rumble } from './rumble';
import { TiltInput } from './tilt';
import { TouchInput } from './touch';

/** Merges all devices into one Intent, once per frame. */
export class InputManager {
  readonly intent: Intent = createIntent();
  readonly edges: InputEdges = createEdges();
  readonly touch: TouchInput;
  readonly keyboard = new KeyboardInput();
  readonly tilt = new TiltInput();
  readonly rumble = new Rumble();
  private readonly gamepad = new GamepadInput();

  constructor(uiRoot: HTMLElement) {
    this.touch = new TouchInput(uiRoot, () => this.tilt.straighten());
    this.applySteerMode();
  }

  /** Puts the touch controls into the player's chosen way of steering. */
  applySteerMode(): void {
    const mode = getSettings().touchSteer;
    this.touch.setSteerMode(mode);
    if (mode === 'tilt') this.tilt.start();
    else this.tilt.stop();
  }

  update(dt: number, speedFraction: number): void {
    const { intent, edges } = this;
    intent.handbrake = false;
    intent.nitro = false;
    intent.horn = false;
    intent.lookBack = false;
    intent.dom = false;
    for (const key of Object.keys(edges) as Array<keyof InputEdges>) edges[key] = false;

    this.keyboard.update(dt, speedFraction, intent, edges);
    this.gamepad.update(intent, edges);
    this.touch.update(dt, intent, edges);
    if (this.touch.isActive) this.tilt.update(dt, intent);
    this.rumble.pad = this.gamepad.pad;
    this.rumble.phone = this.touch.isActive;
  }

  /** Forgets held keys, for example when a menu opens. */
  clear(): void {
    this.keyboard.clear();
  }
}
