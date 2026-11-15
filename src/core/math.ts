/** Small allocation-free math helpers used on hot paths. */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

/** Moves toward the target by at most maxDelta. */
export function moveToward(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

/** Frame-rate independent exponential smoothing factor. */
export function dampFactor(stiffness: number, dt: number): number {
  return 1 - Math.exp(-stiffness * dt);
}

export function damp(current: number, target: number, stiffness: number, dt: number): number {
  return current + (target - current) * dampFactor(stiffness, dt);
}

/** Smallest signed difference between two angles, in radians. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** Deterministic seeded PRNG (mulberry32). */
export function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Cheap smooth 1D noise in the range -1 to 1, used for camera shake and flicker. */
export function noise1D(x: number): number {
  return (Math.sin(x) + Math.sin(x * 2.137 + 1.3) * 0.5 + Math.sin(x * 4.71 + 4.1) * 0.25) / 1.75;
}
