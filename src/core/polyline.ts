/** A 3D polyline resampled to even spacing, so any distance lookup is O(1) and allocation-free. */

export interface PolylineSample {
  x: number;
  y: number;
  z: number;
  /** Unit tangent in the ground plane. */
  tx: number;
  tz: number;
}

export function createSample(): PolylineSample {
  return { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
}

export class Polyline {
  readonly points: Float32Array;
  readonly tangents: Float32Array;
  readonly count: number;
  readonly length: number;
  readonly spacing: number;

  /** @param raw flat x, y, z values of at least two points */
  constructor(raw: ArrayLike<number>, targetSpacing: number) {
    const rawCount = Math.floor(raw.length / 3);
    const cumulative = new Float32Array(rawCount);
    for (let i = 1; i < rawCount; i++) {
      const dx = raw[i * 3] - raw[(i - 1) * 3];
      const dy = raw[i * 3 + 1] - raw[(i - 1) * 3 + 1];
      const dz = raw[i * 3 + 2] - raw[(i - 1) * 3 + 2];
      cumulative[i] = cumulative[i - 1] + Math.hypot(dx, dy, dz);
    }
    this.length = Math.max(cumulative[rawCount - 1], 0.001);
    this.count = Math.max(2, Math.ceil(this.length / targetSpacing) + 1);
    this.spacing = this.length / (this.count - 1);
    this.points = new Float32Array(this.count * 3);
    this.tangents = new Float32Array(this.count * 2);

    let segment = 0;
    for (let i = 0; i < this.count; i++) {
      const s = i * this.spacing;
      while (segment < rawCount - 2 && cumulative[segment + 1] < s) segment++;
      const segmentLength = Math.max(cumulative[segment + 1] - cumulative[segment], 1e-5);
      const t = Math.min(1, Math.max(0, (s - cumulative[segment]) / segmentLength));
      for (let axis = 0; axis < 3; axis++) {
        this.points[i * 3 + axis] = raw[segment * 3 + axis] + (raw[(segment + 1) * 3 + axis] - raw[segment * 3 + axis]) * t;
      }
    }
    for (let i = 0; i < this.count; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(this.count - 1, i + 1);
      const dx = this.points[b * 3] - this.points[a * 3];
      const dz = this.points[b * 3 + 2] - this.points[a * 3 + 2];
      const length = Math.hypot(dx, dz) || 1;
      this.tangents[i * 2] = dx / length;
      this.tangents[i * 2 + 1] = dz / length;
    }
  }

  /** Position and tangent at a distance along the line. Values outside the range are clamped. */
  sample(s: number, out: PolylineSample): PolylineSample {
    const clamped = s <= 0 ? 0 : s >= this.length ? this.length : s;
    const scaled = clamped / this.spacing;
    let index = Math.floor(scaled);
    if (index >= this.count - 1) index = this.count - 2;
    const t = scaled - index;
    const p = this.points;
    out.x = p[index * 3] + (p[(index + 1) * 3] - p[index * 3]) * t;
    out.y = p[index * 3 + 1] + (p[(index + 1) * 3 + 1] - p[index * 3 + 1]) * t;
    out.z = p[index * 3 + 2] + (p[(index + 1) * 3 + 2] - p[index * 3 + 2]) * t;
    const tx = this.tangents[index * 2] + (this.tangents[(index + 1) * 2] - this.tangents[index * 2]) * t;
    const tz = this.tangents[index * 2 + 1] + (this.tangents[(index + 1) * 2 + 1] - this.tangents[index * 2 + 1]) * t;
    const length = Math.hypot(tx, tz) || 1;
    out.tx = tx / length;
    out.tz = tz / length;
    return out;
  }

  /** Position of the sample nearest to a point; returns the distance along the line. */
  nearestDistance(x: number, z: number): number {
    let best = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < this.count; i++) {
      const dx = this.points[i * 3] - x;
      const dz = this.points[i * 3 + 2] - z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best * this.spacing;
  }
}
