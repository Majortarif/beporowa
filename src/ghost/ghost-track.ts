/**
 * A ghost: one run of a race, kept as a few numbers per sample, so it can be raced again later,
 * saved on this machine, or sent to the leaderboard. Pure numbers with no drawing, so it runs
 * headless in tests and on the server.
 */

/** x, y, z, qx, qy, qz, qw and progress along the course, per sample. */
export const GHOST_STRIDE = 8;

/** Positions are stored to a tenth of a metre, progress to half a metre. */
const POSITION_STEP = 0.1;
const PROGRESS_STEP = 0.5;
const ROTATION_SCALE = 32767;
const INT16_MAX = 32767;

export interface GhostTrack {
  eventId: string;
  carId: string;
  /** The race time this run finished in. */
  timeMs: number;
  /** Samples per second. */
  hz: number;
  count: number;
  /** count × GHOST_STRIDE numbers. */
  frames: Float32Array;
}

export interface GhostPose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  progress: number;
}

export function createGhostPose(): GhostPose {
  return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, progress: 0 };
}

/** Writes samples at exact moments, however the steps fall: each one is blended from the steps either side. */
export class GhostRecorder {
  private frames = new Float32Array(0);
  private capacity = 0;
  private count = 0;
  private hz = 12;
  private eventId = '';
  private carId = '';
  private previousTime = -1;
  private readonly previous = new Float32Array(GHOST_STRIDE);
  private readonly current = new Float32Array(GHOST_STRIDE);
  /** Set when the run went on longer than a ghost may hold. */
  private overflow = false;
  active = false;

  begin(eventId: string, carId: string, hz: number, maxSeconds: number): void {
    const capacity = Math.ceil(maxSeconds * hz) + 2;
    if (this.frames.length < capacity * GHOST_STRIDE) this.frames = new Float32Array(capacity * GHOST_STRIDE);
    this.capacity = capacity;
    this.count = 0;
    this.hz = hz;
    this.eventId = eventId;
    this.carId = carId;
    this.previousTime = -1;
    this.overflow = false;
    this.active = true;
  }

  get sampleCount(): number {
    return this.count;
  }

  /**
   * Offers the car as it is at a moment of the race clock.
   * @param time seconds since the start, rising step by step
   */
  record(time: number, x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number, progress: number): void {
    if (!this.active) return;
    const now = this.current;
    now[0] = x;
    now[1] = y;
    now[2] = z;
    // Keep each rotation on the same side as the last, so blending never takes the long way round.
    const before = this.previous;
    const flip = this.previousTime >= 0 && before[3] * qx + before[4] * qy + before[5] * qz + before[6] * qw < 0 ? -1 : 1;
    now[3] = qx * flip;
    now[4] = qy * flip;
    now[5] = qz * flip;
    now[6] = qw * flip;
    now[7] = progress;

    if (this.previousTime < 0) {
      // The very first offer is the start line: it is sample zero whatever the clock says.
      this.write(now, now, 0);
      this.previous.set(now);
      this.previousTime = time;
      return;
    }
    const interval = 1 / this.hz;
    while (this.count < this.capacity) {
      const due = this.count * interval;
      if (due > time) break;
      const span = time - this.previousTime;
      const share = span > 1e-6 ? Math.min(1, Math.max(0, (due - this.previousTime) / span)) : 1;
      this.write(this.previous, now, share);
    }
    if (this.count >= this.capacity && time > (this.capacity - 1) * interval) this.overflow = true;
    this.previous.set(now);
    this.previousTime = time;
  }

  private write(from: Float32Array, to: Float32Array, share: number): void {
    const base = this.count * GHOST_STRIDE;
    for (let i = 0; i < GHOST_STRIDE; i++) this.frames[base + i] = from[i] + (to[i] - from[i]) * share;
    normaliseRotation(this.frames, base);
    this.count++;
  }

  /** Stops recording. @returns the finished ghost, or null if the run was too long or too short to keep */
  finish(timeMs: number): GhostTrack | null {
    this.active = false;
    if (this.overflow || this.count < 3 || !(timeMs > 0)) return null;
    return {
      eventId: this.eventId,
      carId: this.carId,
      timeMs: Math.round(timeMs),
      hz: this.hz,
      count: this.count,
      frames: this.frames.slice(0, this.count * GHOST_STRIDE),
    };
  }

  cancel(): void {
    this.active = false;
  }
}

function normaliseRotation(frames: Float32Array, base: number): void {
  const length = Math.hypot(frames[base + 3], frames[base + 4], frames[base + 5], frames[base + 6]) || 1;
  frames[base + 3] /= length;
  frames[base + 4] /= length;
  frames[base + 5] /= length;
  frames[base + 6] /= length;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

/** Seconds from the first sample to the last. */
export function ghostDuration(track: GhostTrack): number {
  return track.count > 1 ? (track.count - 1) / track.hz : 0;
}

/**
 * Where the ghost is at a moment of its run.
 * @returns false once the run is over, with the pose left at the finish
 */
export function sampleGhost(track: GhostTrack, seconds: number, out: GhostPose): boolean {
  const frames = track.frames;
  const last = track.count - 1;
  const position = Math.max(0, seconds) * track.hz;
  const index = Math.floor(position);
  if (index >= last) {
    readFrame(frames, last, out);
    return seconds <= ghostDuration(track) + 1e-6;
  }
  const t = position - index;
  const i0 = Math.max(0, index - 1) * GHOST_STRIDE;
  const i1 = index * GHOST_STRIDE;
  const i2 = (index + 1) * GHOST_STRIDE;
  const i3 = Math.min(last, index + 2) * GHOST_STRIDE;
  out.x = catmullRom(frames[i0], frames[i1], frames[i2], frames[i3], t);
  out.y = catmullRom(frames[i0 + 1], frames[i1 + 1], frames[i2 + 1], frames[i3 + 1], t);
  out.z = catmullRom(frames[i0 + 2], frames[i1 + 2], frames[i2 + 2], frames[i3 + 2], t);
  // Neighbouring rotations are close, so a normalised blend is as good as a slerp here.
  let dot = 0;
  for (let k = 3; k < 7; k++) dot += frames[i1 + k] * frames[i2 + k];
  const sign = dot < 0 ? -1 : 1;
  const qx = frames[i1 + 3] + (frames[i2 + 3] * sign - frames[i1 + 3]) * t;
  const qy = frames[i1 + 4] + (frames[i2 + 4] * sign - frames[i1 + 4]) * t;
  const qz = frames[i1 + 5] + (frames[i2 + 5] * sign - frames[i1 + 5]) * t;
  const qw = frames[i1 + 6] + (frames[i2 + 6] * sign - frames[i1 + 6]) * t;
  const length = Math.hypot(qx, qy, qz, qw) || 1;
  out.qx = qx / length;
  out.qy = qy / length;
  out.qz = qz / length;
  out.qw = qw / length;
  out.progress = frames[i1 + 7] + (frames[i2 + 7] - frames[i1 + 7]) * t;
  return true;
}

function readFrame(frames: Float32Array, index: number, out: GhostPose): void {
  const base = index * GHOST_STRIDE;
  out.x = frames[base];
  out.y = frames[base + 1];
  out.z = frames[base + 2];
  out.qx = frames[base + 3];
  out.qy = frames[base + 4];
  out.qz = frames[base + 5];
  out.qw = frames[base + 6];
  out.progress = frames[base + 7];
}

/**
 * When the ghost first got as far along the course as this, for the gap shown in a race.
 * @returns seconds into its run, or null if it never got that far
 */
export function ghostTimeAtProgress(track: GhostTrack, progress: number): number | null {
  const frames = track.frames;
  const count = track.count;
  if (count < 2 || frames[(count - 1) * GHOST_STRIDE + 7] < progress) return null;
  if (frames[7] >= progress) return 0;
  // Progress rises along a run, near enough, so a halving search finds the crossing.
  let low = 0;
  let high = count - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (frames[middle * GHOST_STRIDE + 7] >= progress) high = middle;
    else low = middle;
  }
  const a = frames[low * GHOST_STRIDE + 7];
  const b = frames[high * GHOST_STRIDE + 7];
  const share = b > a ? (progress - a) / (b - a) : 1;
  return (low + share) / track.hz;
}

/** The fastest the ghost ever moved between two samples, in metres per second. */
export function ghostTopSpeed(track: GhostTrack): number {
  const frames = track.frames;
  let best = 0;
  for (let i = 1; i < track.count; i++) {
    const a = (i - 1) * GHOST_STRIDE;
    const b = i * GHOST_STRIDE;
    const distance = Math.hypot(frames[b] - frames[a], frames[b + 1] - frames[a + 1], frames[b + 2] - frames[a + 2]);
    best = Math.max(best, distance * track.hz);
  }
  return best;
}

// ---------- Sending a ghost over the wire ----------

/** A ghost as plain JSON: header fields, then every number packed into base64. */
export interface GhostPacket {
  v: 1;
  /** Event id. */
  e: string;
  /** Car id. */
  c: string;
  /** Race time, ms. */
  t: number;
  /** Samples per second. */
  h: number;
  /** How many samples. */
  n: number;
  /** Where positions are measured from. */
  o: [number, number, number];
  /** Int16 samples, little-endian, in base64. */
  d: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array | null {
  try {
    const binary = atob(text);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** @returns the packet, or null if the run strays too far to pack */
export function encodeGhost(track: GhostTrack): GhostPacket | null {
  const frames = track.frames;
  const ox = Math.round(frames[0]);
  const oy = Math.round(frames[1]);
  const oz = Math.round(frames[2]);
  const values = new Int16Array(track.count * GHOST_STRIDE);
  for (let i = 0; i < track.count; i++) {
    const base = i * GHOST_STRIDE;
    const packed = [
      (frames[base] - ox) / POSITION_STEP,
      (frames[base + 1] - oy) / POSITION_STEP,
      (frames[base + 2] - oz) / POSITION_STEP,
      frames[base + 3] * ROTATION_SCALE,
      frames[base + 4] * ROTATION_SCALE,
      frames[base + 5] * ROTATION_SCALE,
      frames[base + 6] * ROTATION_SCALE,
      frames[base + 7] / PROGRESS_STEP,
    ];
    for (let k = 0; k < GHOST_STRIDE; k++) {
      const value = Math.round(packed[k]);
      if (!Number.isFinite(value) || Math.abs(value) > INT16_MAX) return null;
      values[base + k] = value;
    }
  }
  const bytes = new Uint8Array(values.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < values.length; i++) view.setInt16(i * 2, values[i], true);
  return { v: 1, e: track.eventId, c: track.carId, t: track.timeMs, h: track.hz, n: track.count, o: [ox, oy, oz], d: toBase64(bytes) };
}

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

/**
 * Reads a packet back, checking everything, because packets come from the network.
 * @param maxSamples the most samples a packet may claim
 * @returns the ghost, or null if anything is wrong with it
 */
export function decodeGhost(raw: unknown, maxSamples: number): GhostTrack | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const packet = raw as Partial<GhostPacket>;
  const { e, c, t, h, n, o, d } = packet;
  if (packet.v !== 1 || typeof e !== 'string' || typeof c !== 'string' || !ID_PATTERN.test(e) || !ID_PATTERN.test(c)) return null;
  if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) return null;
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 4 || h > 30) return null;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 3 || n > maxSamples) return null;
  if (!Array.isArray(o) || o.length !== 3 || !o.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 100000)) return null;
  if (typeof d !== 'string') return null;
  const bytes = fromBase64(d);
  if (!bytes || bytes.length !== n * GHOST_STRIDE * 2) return null;
  const view = new DataView(bytes.buffer);
  const frames = new Float32Array(n * GHOST_STRIDE);
  for (let i = 0; i < n; i++) {
    const base = i * GHOST_STRIDE;
    const read = (k: number): number => view.getInt16((base + k) * 2, true);
    frames[base] = read(0) * POSITION_STEP + o[0];
    frames[base + 1] = read(1) * POSITION_STEP + o[1];
    frames[base + 2] = read(2) * POSITION_STEP + o[2];
    frames[base + 3] = read(3) / ROTATION_SCALE;
    frames[base + 4] = read(4) / ROTATION_SCALE;
    frames[base + 5] = read(5) / ROTATION_SCALE;
    frames[base + 6] = read(6) / ROTATION_SCALE;
    frames[base + 7] = read(7) * PROGRESS_STEP;
    normaliseRotation(frames, base);
  }
  return { eventId: e, carId: c, timeMs: Math.round(t), hz: h, count: n, frames };
}
