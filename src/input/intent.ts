/** The single input format every device feeds and the vehicle reads. */

export interface Intent {
  /** 0 to 1. */
  throttle: number;
  /** 0 to 1. */
  brake: number;
  /** -1 full left to 1 full right. */
  steer: number;
  handbrake: boolean;
  nitro: boolean;
  horn: boolean;
  lookBack: boolean;
  /** Hold for দম, the slow-motion ability. */
  dom: boolean;
}

export function createIntent(): Intent {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, nitro: false, horn: false, lookBack: false, dom: false };
}

/** One-shot actions, consumed once per frame. */
export interface InputEdges {
  camera: boolean;
  reset: boolean;
  pause: boolean;
  devPanel: boolean;
  photo: boolean;
  radio: boolean;
  /** Gamepad A or Start, so a pad alone can leave the title and pause screens. */
  confirm: boolean;
  map: boolean;
  /** Opens the Ring board. */
  ring: boolean;
  /** A tap left or right, for choosing whom to watch. */
  left: boolean;
  right: boolean;
}

export function createEdges(): InputEdges {
  return { camera: false, reset: false, pause: false, devPanel: false, confirm: false, map: false, ring: false, photo: false, radio: false, left: false, right: false };
}
