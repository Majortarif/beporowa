/**
 * Skid marks as one ring-buffer mesh: new quads overwrite the oldest,
 * so memory and draw calls stay constant however long you drift.
 */

import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector3 } from 'three';
import { TUNING } from '../config/tuning';

const VERTEX = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha);
  #include <colorspace_fragment>
}`;

interface WheelTrack {
  active: boolean;
  last: Vector3;
  lastLeft: Vector3;
  lastRight: Vector3;
  lastAlpha: number;
}

export class SkidMarks {
  readonly mesh: Mesh;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly alphaAttribute: BufferAttribute;
  private readonly tracks: WheelTrack[];
  private readonly left = new Vector3();
  private readonly right = new Vector3();
  private readonly direction = new Vector3();
  private readonly side = new Vector3();
  private cursor = 0;
  private dirtyFrom = -1;
  private dirtyTo = -1;

  constructor(private readonly maxSegments: number, wheelCount: number) {
    this.positions = new Float32Array(maxSegments * 4 * 3);
    this.alphas = new Float32Array(maxSegments * 4);
    const indices = new Uint32Array(maxSegments * 6);
    for (let i = 0; i < maxSegments; i++) {
      const v = i * 4;
      indices.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const geometry = new BufferGeometry();
    this.positionAttribute = new BufferAttribute(this.positions, 3);
    this.alphaAttribute = new BufferAttribute(this.alphas, 1);
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('aAlpha', this.alphaAttribute);
    geometry.setIndex(new BufferAttribute(indices, 1));

    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uColor: { value: new Color(0x050505) } },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;

    this.tracks = [];
    for (let i = 0; i < wheelCount; i++) {
      this.tracks.push({
        active: false,
        last: new Vector3(),
        lastLeft: new Vector3(),
        lastRight: new Vector3(),
        lastAlpha: 0,
      });
    }
  }

  /** Extends the mark for a wheel. */
  add(wheel: number, point: Vector3, intensity: number): void {
    const config = TUNING.fx.skid;
    const track = this.tracks[wheel];
    const y = point.y + config.heightOffset;
    if (!track.active) {
      track.active = true;
      track.last.set(point.x, y, point.z);
      track.lastLeft.copy(track.last);
      track.lastRight.copy(track.last);
      track.lastAlpha = 0;
      return;
    }
    this.direction.set(point.x - track.last.x, 0, point.z - track.last.z);
    const length = this.direction.length();
    if (length < config.minSegmentLength) return;
    this.direction.divideScalar(length);
    this.side.set(this.direction.z, 0, -this.direction.x).multiplyScalar(config.width / 2);
    this.left.set(point.x + this.side.x, y, point.z + this.side.z);
    this.right.set(point.x - this.side.x, y, point.z - this.side.z);
    const alpha = Math.min(1, intensity) * config.opacity;
    this.writeQuad(track.lastLeft, track.lastRight, this.left, this.right, track.lastAlpha, alpha);
    track.last.set(point.x, y, point.z);
    track.lastLeft.copy(this.left);
    track.lastRight.copy(this.right);
    track.lastAlpha = alpha;
  }

  /** Ends the current mark for a wheel. */
  lift(wheel: number): void {
    this.tracks[wheel].active = false;
  }

  /** Uploads only what changed this frame. */
  flush(): void {
    if (this.dirtyFrom < 0) return;
    const from = this.dirtyFrom * 4;
    const count = (this.dirtyTo - this.dirtyFrom + 1) * 4;
    this.positionAttribute.clearUpdateRanges();
    this.positionAttribute.addUpdateRange(from * 3, count * 3);
    this.positionAttribute.needsUpdate = true;
    this.alphaAttribute.clearUpdateRanges();
    this.alphaAttribute.addUpdateRange(from, count);
    this.alphaAttribute.needsUpdate = true;
    this.dirtyFrom = -1;
    this.dirtyTo = -1;
  }

  clear(): void {
    this.alphas.fill(0);
    this.alphaAttribute.clearUpdateRanges();
    this.alphaAttribute.needsUpdate = true;
    for (const track of this.tracks) track.active = false;
  }

  private writeQuad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, alphaStart: number, alphaEnd: number): void {
    const i = this.cursor;
    const p = this.positions;
    const base = i * 12;
    p[base] = a.x; p[base + 1] = a.y; p[base + 2] = a.z;
    p[base + 3] = b.x; p[base + 4] = b.y; p[base + 5] = b.z;
    p[base + 6] = c.x; p[base + 7] = c.y; p[base + 8] = c.z;
    p[base + 9] = d.x; p[base + 10] = d.y; p[base + 11] = d.z;
    const q = i * 4;
    this.alphas[q] = alphaStart;
    this.alphas[q + 1] = alphaStart;
    this.alphas[q + 2] = alphaEnd;
    this.alphas[q + 3] = alphaEnd;

    // The buffer wraps, so a frame that wraps uploads from the start of the array.
    if (this.dirtyFrom < 0 || i < this.dirtyFrom) this.dirtyFrom = i;
    if (i > this.dirtyTo) this.dirtyTo = i;
    this.cursor = (i + 1) % this.maxSegments;
  }
}
