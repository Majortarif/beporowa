import { TUNING } from '../config/tuning';
import { lerp, moveToward } from '../core/math';
import { BIND_ACTIONS, getSettings, type BindAction } from '../save/settings';
import { createEdges, type InputEdges, type Intent } from './intent';

/** Keys that are never moved: pause and menus always work, whatever the player rebinds. */
const FIXED_KEYS = new Set(['Enter', 'Escape', 'KeyP', 'Backquote']);

/** Keyboard is digital, so it ramps throttle, brake and steering to feel analog. */
export class KeyboardInput {
  private held = new Set<string>();
  private pendingEdges = createEdges();
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  /** Which actions each key does, rebuilt whenever the bindings change. */
  private actionsByKey = new Map<string, BindAction[]>();
  /** While the controls screen waits for a new key, the game ignores the keyboard. */
  capturing = false;

  constructor(target: Window = window) {
    this.rebind();
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    target.addEventListener('blur', this.clear);
  }

  /** Reads the player's bindings again. */
  rebind(): void {
    const bindings = getSettings().keyBindings;
    this.actionsByKey.clear();
    for (const action of BIND_ACTIONS) {
      for (const code of bindings[action] ?? []) {
        const list = this.actionsByKey.get(code) ?? [];
        list.push(action);
        this.actionsByKey.set(code, list);
      }
    }
    this.held.clear();
  }

  clear = (): void => {
    this.held.clear();
  };

  private isGameKey(code: string): boolean {
    return FIXED_KEYS.has(code) || this.actionsByKey.has(code);
  }

  private holds(action: BindAction): boolean {
    for (const code of getSettings().keyBindings[action] ?? []) if (this.held.has(code)) return true;
    return false;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.capturing || !this.isGameKey(event.code)) return;
    const target = event.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');
    // Menus own the keyboard focus: Space on a button should press that button.
    const inMenu = document.body.dataset.gameState !== 'driving';
    if (typing && event.code !== 'Escape') return;
    if (!inMenu || event.code.startsWith('Arrow')) event.preventDefault();

    if (!event.repeat) {
      const actions = this.actionsByKey.get(event.code) ?? [];
      const edges = this.pendingEdges;
      for (const action of actions) {
        if (action === 'camera') edges.camera = true;
        if (action === 'reset') edges.reset = true;
        if (action === 'map') edges.map = true;
        if (action === 'ring') edges.ring = true;
        if (action === 'photo') edges.photo = true;
        if (action === 'radio') edges.radio = true;
      }
      if (event.code === 'KeyP' || event.code === 'Escape') edges.pause = true;
      if (event.code === 'Backquote') edges.devPanel = true;
      // In a menu, Enter belongs to the focused button.
      if (event.code === 'Enter' && !inMenu) edges.confirm = true;
      if (actions.includes('left')) edges.left = true;
      if (actions.includes('right')) edges.right = true;
    }
    this.held.add(event.code);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.held.delete(event.code);
  };

  /** Writes the ramped keyboard state into the intent. */
  update(dt: number, speedFraction: number, intent: Intent, edges: InputEdges): void {
    const config = TUNING.input;
    const left = this.holds('left');
    const right = this.holds('right');
    const up = this.holds('throttle');
    const down = this.holds('brake');

    const steerTarget = (right ? 1 : 0) - (left ? 1 : 0);
    const rateScale = lerp(1, config.keyboardHighSpeedRateScale, speedFraction);
    const changingDirection = steerTarget !== 0 && Math.sign(steerTarget) !== Math.sign(this.steer) && this.steer !== 0;
    const rate = steerTarget === 0 || changingDirection ? config.keyboardSteerReturn : config.keyboardSteerRate * rateScale;
    this.steer = moveToward(this.steer, steerTarget, rate * dt);
    this.throttle = moveToward(this.throttle, up ? 1 : 0, config.keyboardThrottleRate * dt);
    this.brake = moveToward(this.brake, down ? 1 : 0, config.keyboardBrakeRate * dt);

    intent.steer = this.steer;
    intent.throttle = this.throttle;
    intent.brake = this.brake;
    if (this.holds('handbrake')) intent.handbrake = true;
    if (this.holds('nitro')) intent.nitro = true;
    if (this.holds('horn')) intent.horn = true;
    if (this.holds('lookBack')) intent.lookBack = true;
    if (this.holds('dom')) intent.dom = true;

    const pending = this.pendingEdges;
    for (const key of Object.keys(pending) as Array<keyof InputEdges>) if (pending[key]) edges[key] = true;
    this.pendingEdges = createEdges();
  }
}
