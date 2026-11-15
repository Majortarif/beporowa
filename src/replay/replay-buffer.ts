/**
 * A ring buffer of the last stretch of driving: the player, every police car and racer, and traffic.
 * Everything lives in typed arrays made once, so recording makes no garbage and costs almost nothing.
 */

/** Numbers kept for the player's car in each frame. */
export const PLAYER_FIELDS = {
  x: 0,
  y: 1,
  z: 2,
  qx: 3,
  qy: 4,
  qz: 5,
  qw: 6,
  steer: 7,
  speed: 8,
  rpm: 9,
  throttle: 10,
  brake: 11,
  nitro: 12,
  drifting: 13,
  reversing: 14,
  slip: 15,
  lateral: 16,
  longitudinal: 17,
  wheel0: 18,
  wheel1: 19,
  wheel2: 20,
  wheel3: 21,
} as const;

export const PLAYER_SIZE = 22;
/** active, x, y, z, qx, qy, qz, qw */
export const ACTOR_SIZE = 8;
/** x, y, z, yaw. A negative-infinity x means nobody was there. */
export const TRAFFIC_SIZE = 4;

export type ReplayMark = 'impact' | 'nearMiss' | 'nitro' | 'takedown' | 'splash';

export interface ReplayEvent {
  time: number;
  kind: ReplayMark;
  x: number;
  y: number;
  z: number;
  strength: number;
}

export class ReplayBuffer {
  readonly capacity: number;
  readonly interval: number;
  private readonly times: Float64Array;
  private readonly player: Float32Array;
  private readonly actors: Float32Array;
  private readonly traffic: Float32Array;
  private readonly trafficKinds: Uint8Array;
  private head = 0;
  private filled = 0;
  private clock = 0;
  private sinceLast = Infinity;
  readonly events: ReplayEvent[] = [];
  private readonly maxEvents = 64;

  constructor(
    seconds: number,
    hz: number,
    readonly actorCount: number,
    readonly trafficCount: number,
  ) {
    this.capacity = Math.ceil(seconds * hz);
    this.interval = 1 / hz;
    this.times = new Float64Array(this.capacity);
    this.player = new Float32Array(this.capacity * PLAYER_SIZE);
    this.actors = new Float32Array(this.capacity * actorCount * ACTOR_SIZE);
    this.traffic = new Float32Array(this.capacity * trafficCount * TRAFFIC_SIZE);
    this.trafficKinds = new Uint8Array(this.capacity * trafficCount * 2);
  }

  /** Seconds of driving held right now. */
  get duration(): number {
    return this.filled < 2 ? 0 : this.times[this.index(this.filled - 1)] - this.times[this.index(0)];
  }

  get startTime(): number {
    return this.filled === 0 ? 0 : this.times[this.index(0)];
  }

  get endTime(): number {
    return this.filled === 0 ? 0 : this.times[this.index(this.filled - 1)];
  }

  get frameCount(): number {
    return this.filled;
  }

  /** The nth oldest frame's place in the arrays. */
  private index(n: number): number {
    return (this.head - this.filled + n + this.capacity * 2) % this.capacity;
  }

  clear(): void {
    this.head = 0;
    this.filled = 0;
    this.sinceLast = Infinity;
    this.events.length = 0;
  }

  /** Moves the clock on. @returns the frame to write into, or -1 if it is not time for one yet */
  advance(dt: number): number {
    this.clock += dt;
    this.sinceLast += dt;
    if (this.sinceLast < this.interval) return -1;
    this.sinceLast = 0;
    const slot = this.head;
    this.times[slot] = this.clock;
    this.head = (this.head + 1) % this.capacity;
    this.filled = Math.min(this.filled + 1, this.capacity);
    return slot;
  }

  /** The player's numbers in a frame, for writing. */
  playerSlot(slot: number): Float32Array {
    return this.player.subarray(slot * PLAYER_SIZE, (slot + 1) * PLAYER_SIZE);
  }

  writeActor(slot: number, actor: number, active: boolean, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): void {
    const at = (slot * this.actorCount + actor) * ACTOR_SIZE;
    const data = this.actors;
    data[at] = active ? 1 : 0;
    data[at + 1] = x;
    data[at + 2] = y;
    data[at + 3] = z;
    data[at + 4] = qx;
    data[at + 5] = qy;
    data[at + 6] = qz;
    data[at + 7] = qw;
  }

  writeTraffic(slot: number, agent: number, alive: boolean, x: number, y: number, z: number, yaw: number, type: number, variant: number): void {
    const at = (slot * this.trafficCount + agent) * TRAFFIC_SIZE;
    const data = this.traffic;
    data[at] = alive ? x : Number.NEGATIVE_INFINITY;
    data[at + 1] = y;
    data[at + 2] = z;
    data[at + 3] = yaw;
    const kinds = (slot * this.trafficCount + agent) * 2;
    this.trafficKinds[kinds] = type;
    this.trafficKinds[kinds + 1] = variant;
  }

  /** Notes something worth slowing the replay down for. */
  mark(kind: ReplayMark, x: number, y: number, z: number, strength: number): void {
    this.events.push({ time: this.clock, kind, x, y, z, strength });
    if (this.events.length > this.maxEvents) this.events.shift();
  }

  /**
   * Finds the two frames either side of a time.
   * @returns the blend between them in out[2], with the frames in out[0] and out[1]
   */
  locate(time: number, out: [number, number, number]): void {
    if (this.filled === 0) {
      out[0] = out[1] = out[2] = 0;
      return;
    }
    let low = 0;
    let high = this.filled - 1;
    if (time <= this.times[this.index(0)]) {
      out[0] = out[1] = this.index(0);
      out[2] = 0;
      return;
    }
    if (time >= this.times[this.index(high)]) {
      out[0] = out[1] = this.index(high);
      out[2] = 0;
      return;
    }
    while (high - low > 1) {
      const middle = (low + high) >> 1;
      if (this.times[this.index(middle)] <= time) low = middle;
      else high = middle;
    }
    const a = this.index(low);
    const b = this.index(high);
    out[0] = a;
    out[1] = b;
    out[2] = (time - this.times[a]) / Math.max(1e-6, this.times[b] - this.times[a]);
  }

  /** Reads one player number at a blended point. */
  playerValue(a: number, b: number, blend: number, field: number): number {
    const from = this.player[a * PLAYER_SIZE + field];
    return from + (this.player[b * PLAYER_SIZE + field] - from) * blend;
  }

  /** Writes the blended player orientation into out as x, y, z, w. */
  playerRotation(a: number, b: number, blend: number, out: { x: number; y: number; z: number; w: number }): void {
    blendQuaternion(this.player, a * PLAYER_SIZE + 3, b * PLAYER_SIZE + 3, blend, out);
  }

  actorActive(a: number, b: number, actor: number): boolean {
    return this.actors[(a * this.actorCount + actor) * ACTOR_SIZE] > 0.5 && this.actors[(b * this.actorCount + actor) * ACTOR_SIZE] > 0.5;
  }

  actorPosition(a: number, b: number, blend: number, actor: number, out: { x: number; y: number; z: number }): void {
    const data = this.actors;
    const ai = (a * this.actorCount + actor) * ACTOR_SIZE;
    const bi = (b * this.actorCount + actor) * ACTOR_SIZE;
    out.x = data[ai + 1] + (data[bi + 1] - data[ai + 1]) * blend;
    out.y = data[ai + 2] + (data[bi + 2] - data[ai + 2]) * blend;
    out.z = data[ai + 3] + (data[bi + 3] - data[ai + 3]) * blend;
  }

  actorRotation(a: number, b: number, blend: number, actor: number, out: { x: number; y: number; z: number; w: number }): void {
    blendQuaternion(this.actors, (a * this.actorCount + actor) * ACTOR_SIZE + 4, (b * this.actorCount + actor) * ACTOR_SIZE + 4, blend, out);
  }

  /** A vehicle in traffic at a blended point. @returns false if it was not there */
  trafficAt(a: number, b: number, blend: number, agent: number, out: { x: number; y: number; z: number; yaw: number; type: number; variant: number }): boolean {
    const data = this.traffic;
    const ai = (a * this.trafficCount + agent) * TRAFFIC_SIZE;
    const bi = (b * this.trafficCount + agent) * TRAFFIC_SIZE;
    const fromX = data[ai];
    const toX = data[bi];
    if (fromX === Number.NEGATIVE_INFINITY || toX === Number.NEGATIVE_INFINITY) return false;
    // Far apart between frames means a vehicle was moved back to the edge of the bubble.
    const jumped = Math.abs(toX - fromX) > 40 || Math.abs(data[bi + 2] - data[ai + 2]) > 40;
    const t = jumped ? 0 : blend;
    out.x = fromX + (toX - fromX) * t;
    out.y = data[ai + 1] + (data[bi + 1] - data[ai + 1]) * t;
    out.z = data[ai + 2] + (data[bi + 2] - data[ai + 2]) * t;
    let turn = data[bi + 3] - data[ai + 3];
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    out.yaw = data[ai + 3] + turn * t;
    const kinds = (a * this.trafficCount + agent) * 2;
    out.type = this.trafficKinds[kinds];
    out.variant = this.trafficKinds[kinds + 1];
    return true;
  }
}

function blendQuaternion(data: Float32Array, a: number, b: number, blend: number, out: { x: number; y: number; z: number; w: number }): void {
  const dot = data[a] * data[b] + data[a + 1] * data[b + 1] + data[a + 2] * data[b + 2] + data[a + 3] * data[b + 3];
  const sign = dot < 0 ? -1 : 1;
  const x = data[a] + (data[b] * sign - data[a]) * blend;
  const y = data[a + 1] + (data[b + 1] * sign - data[a + 1]) * blend;
  const z = data[a + 2] + (data[b + 2] * sign - data[a + 2]) * blend;
  const w = data[a + 3] + (data[b + 3] * sign - data[a + 3]) * blend;
  const length = Math.hypot(x, y, z, w) || 1;
  out.x = x / length;
  out.y = y / length;
  out.z = z / length;
  out.w = w / length;
}
