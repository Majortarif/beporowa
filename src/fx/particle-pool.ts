/**
 * Allocation-free camera-facing particles drawn in one instanced call.
 * Dead particles are swapped out so only live ones are uploaded.
 */

import {
  AdditiveBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

const VERTEX = /* glsl */ `
attribute vec3 iPosition;
attribute vec2 iSizeAlpha;
attribute vec3 iColor;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vUv = uv;
  vAlpha = iSizeAlpha.y;
  vColor = iColor;
  vec4 viewPosition = viewMatrix * vec4(iPosition, 1.0);
  viewPosition.xy += position.xy * iSizeAlpha.x;
  gl_Position = projectionMatrix * viewPosition;
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
varying float vAlpha;
varying vec3 vColor;
void main() {
  float distanceToCentre = length(vUv - 0.5) * 2.0;
  float soft = max(1.0 - distanceToCentre, 0.0);
  float alpha = soft * soft * vAlpha;
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(vColor, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface ParticleSpawn {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  startSize: number;
  endSize: number;
  opacity: number;
  r: number;
  g: number;
  b: number;
}

export class ParticlePool {
  readonly mesh: Mesh;
  private readonly geometry: InstancedBufferGeometry;
  private readonly positions: Float32Array;
  private readonly sizeAlpha: Float32Array;
  private readonly colors: Float32Array;
  private readonly velocity: Float32Array;
  /** age, life, startSize, endSize, opacity */
  private readonly state: Float32Array;
  private alive = 0;

  constructor(
    private readonly capacity: number,
    additive: boolean,
    private readonly gravity: number,
    private readonly drag: number,
    private readonly rise: number,
  ) {
    const quad = new PlaneGeometry(1, 1);
    this.geometry = new InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));

    this.positions = new Float32Array(capacity * 3);
    this.sizeAlpha = new Float32Array(capacity * 2);
    this.colors = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.state = new Float32Array(capacity * 5);
    this.geometry.setAttribute('iPosition', new InstancedBufferAttribute(this.positions, 3));
    this.geometry.setAttribute('iSizeAlpha', new InstancedBufferAttribute(this.sizeAlpha, 2));
    this.geometry.setAttribute('iColor', new InstancedBufferAttribute(this.colors, 3));
    this.geometry.instanceCount = 0;

    const material = new ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  spawn(p: ParticleSpawn): void {
    if (this.alive >= this.capacity) return;
    const i = this.alive++;
    this.positions[i * 3] = p.x;
    this.positions[i * 3 + 1] = p.y;
    this.positions[i * 3 + 2] = p.z;
    this.velocity[i * 3] = p.vx;
    this.velocity[i * 3 + 1] = p.vy;
    this.velocity[i * 3 + 2] = p.vz;
    this.colors[i * 3] = p.r;
    this.colors[i * 3 + 1] = p.g;
    this.colors[i * 3 + 2] = p.b;
    this.state[i * 5] = 0;
    this.state[i * 5 + 1] = p.life;
    this.state[i * 5 + 2] = p.startSize;
    this.state[i * 5 + 3] = p.endSize;
    this.state[i * 5 + 4] = p.opacity;
    this.sizeAlpha[i * 2] = p.startSize;
    this.sizeAlpha[i * 2 + 1] = 0;
  }

  update(dt: number): void {
    const { positions, velocity, state, sizeAlpha, colors } = this;
    const dragFactor = Math.exp(-this.drag * dt);
    for (let i = this.alive - 1; i >= 0; i--) {
      const age = state[i * 5] + dt;
      const life = state[i * 5 + 1];
      if (age >= life) {
        const last = --this.alive;
        if (i !== last) {
          for (let k = 0; k < 3; k++) {
            positions[i * 3 + k] = positions[last * 3 + k];
            velocity[i * 3 + k] = velocity[last * 3 + k];
            colors[i * 3 + k] = colors[last * 3 + k];
          }
          for (let k = 0; k < 5; k++) state[i * 5 + k] = state[last * 5 + k];
          sizeAlpha[i * 2] = sizeAlpha[last * 2];
          sizeAlpha[i * 2 + 1] = sizeAlpha[last * 2 + 1];
        }
        continue;
      }
      state[i * 5] = age;
      velocity[i * 3] *= dragFactor;
      velocity[i * 3 + 1] = velocity[i * 3 + 1] * dragFactor - this.gravity * dt + this.rise * dt;
      velocity[i * 3 + 2] *= dragFactor;
      positions[i * 3] += velocity[i * 3] * dt;
      positions[i * 3 + 1] += velocity[i * 3 + 1] * dt;
      positions[i * 3 + 2] += velocity[i * 3 + 2] * dt;
      const t = age / life;
      sizeAlpha[i * 2] = state[i * 5 + 2] + (state[i * 5 + 3] - state[i * 5 + 2]) * t;
      // Fade in fast, fade out slow, so a puff never pops.
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      sizeAlpha[i * 2 + 1] = state[i * 5 + 4] * fade;
    }
    this.geometry.instanceCount = this.alive;
    this.geometry.getAttribute('iPosition').needsUpdate = true;
    this.geometry.getAttribute('iSizeAlpha').needsUpdate = true;
    this.geometry.getAttribute('iColor').needsUpdate = true;
  }

  clear(): void {
    this.alive = 0;
    this.geometry.instanceCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}
