/**
 * The test road's centre line as a closed spline, sampled at even spacing.
 * No rendering code here, so tests can check the layout and lap logic headless.
 */

import { CatmullRomCurve3, Vector3 } from 'three';

/** x, elevation, z in metres. Long straight, sweepers, a chicane, two hairpins. */
const CONTROL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [0, 0, 220],
  [0, 1.5, 450],
  [0, 3.5, 650],
  [6, 1.5, 830],
  [60, 0, 980],
  [190, 0, 1080],
  [350, 1, 1090],
  [480, 2, 1000],
  [530, 2, 860],
  [490, 1, 720],
  [395, 0, 650],
  [335, 0, 560],
  [390, 0.5, 470],
  [500, 1.2, 420],
  [590, 1, 320],
  [590, 0, 190],
  [550, 0, 110],
  [480, 0, 95],
  [430, 0, 150],
  [420, 0, 250],
  [340, 0, 310],
  [240, 0, 290],
  [190, 0, 180],
  [190, 0, 20],
  [170, 0, -110],
  [110, 0, -190],
  [30, 0, -170],
  [0, 0, -90],
];

export class TrackPath {
  readonly count: number;
  readonly length: number;
  readonly spacing: number;
  /** x, y, z per sample. */
  readonly positions: Float32Array;
  /** Unit tangent per sample. */
  readonly tangents: Float32Array;
  /** Unit vector to the left of travel per sample. */
  readonly sides: Float32Array;

  constructor(targetSpacing: number) {
    const curve = new CatmullRomCurve3(
      CONTROL_POINTS.map(([x, y, z]) => new Vector3(x, y, z)),
      true,
      'centripetal',
    );
    curve.arcLengthDivisions = 4000;
    const curveLength = curve.getLength();
    this.count = Math.round(curveLength / targetSpacing);
    this.length = curveLength;
    this.spacing = curveLength / this.count;
    this.positions = new Float32Array(this.count * 3);
    this.tangents = new Float32Array(this.count * 3);
    this.sides = new Float32Array(this.count * 3);

    const points = curve.getSpacedPoints(this.count);
    for (let i = 0; i < this.count; i++) {
      const p = points[i];
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
    }
    const tangent = new Vector3();
    const side = new Vector3();
    const up = new Vector3(0, 1, 0);
    for (let i = 0; i < this.count; i++) {
      const next = (i + 1) % this.count;
      const previous = (i - 1 + this.count) % this.count;
      tangent
        .set(
          this.positions[next * 3] - this.positions[previous * 3],
          this.positions[next * 3 + 1] - this.positions[previous * 3 + 1],
          this.positions[next * 3 + 2] - this.positions[previous * 3 + 2],
        )
        .normalize();
      side.crossVectors(up, tangent).normalize();
      this.tangents.set([tangent.x, tangent.y, tangent.z], i * 3);
      this.sides.set([side.x, side.y, side.z], i * 3);
    }
  }

  wrap(index: number): number {
    return ((index % this.count) + this.count) % this.count;
  }

  x(i: number): number {
    return this.positions[i * 3];
  }
  y(i: number): number {
    return this.positions[i * 3 + 1];
  }
  z(i: number): number {
    return this.positions[i * 3 + 2];
  }

  /** Rotation about +Y that makes +Z face along the track. */
  yaw(i: number): number {
    return Math.atan2(this.tangents[i * 3], this.tangents[i * 3 + 2]);
  }

  /** Closest sample searched outward from a hint. Allocation-free for per-step use. */
  nearestIndex(x: number, z: number, hint: number, window: number): number {
    let best = hint;
    let bestDistance = Infinity;
    for (let offset = -window; offset <= window; offset++) {
      const i = this.wrap(hint + offset);
      const dx = this.positions[i * 3] - x;
      const dz = this.positions[i * 3 + 2] - z;
      const distance = dx * dx + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /** Full search, for after a teleport or when the car has wandered off. */
  nearestIndexGlobal(x: number, z: number): number {
    return this.nearestIndex(x, z, 0, Math.ceil(this.count / 2));
  }

  /** Horizontal distance to the centre line from a sample, measured at the nearest sample. */
  distanceToSample(i: number, x: number, z: number): number {
    return Math.hypot(this.positions[i * 3] - x, this.positions[i * 3 + 2] - z);
  }

  /** Tightest corner radius on the track, in metres. */
  minCornerRadius(): number {
    let minimum = Infinity;
    for (let i = 0; i < this.count; i++) {
      const a = this.wrap(i - 2);
      const b = this.wrap(i + 2);
      const cos = this.tangents[a * 3] * this.tangents[b * 3] + this.tangents[a * 3 + 2] * this.tangents[b * 3 + 2];
      const angle = Math.acos(Math.min(1, Math.max(-1, cos)));
      if (angle > 0.001) minimum = Math.min(minimum, (4 * this.spacing) / angle);
    }
    return minimum;
  }

  /** Smallest gap between two parts of the road that are far apart along its length. */
  minSelfClearance(minSeparationMetres: number): number {
    const skip = Math.ceil(minSeparationMetres / this.spacing);
    let minimum = Infinity;
    for (let i = 0; i < this.count; i += 2) {
      for (let j = i + skip; j < this.count; j += 2) {
        const wrapped = Math.min(j - i, this.count - (j - i));
        if (wrapped < skip) continue;
        minimum = Math.min(minimum, Math.hypot(this.x(i) - this.x(j), this.z(i) - this.z(j)));
      }
    }
    return minimum;
  }

  /** Bounding box of the centre line. */
  bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < this.count; i++) {
      minX = Math.min(minX, this.x(i));
      maxX = Math.max(maxX, this.x(i));
      minZ = Math.min(minZ, this.z(i));
      maxZ = Math.max(maxZ, this.z(i));
    }
    return { minX, maxX, minZ, maxZ };
  }
}
