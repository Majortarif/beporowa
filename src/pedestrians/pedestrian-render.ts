/**
 * Low-detail people in one instanced draw. Limbs swing in the vertex shader,
 * so a crowd costs almost nothing on the CPU.
 */

import { ATMOS } from '../render/atmosphere-uniforms';
import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { PedestrianSystem } from './pedestrian-system';

/** Body parts of one figure. Part id drives the shader: 0 torso, 1 and 2 legs, 3 and 4 arms, 5 head, 6 hair. */
function buildFigure(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, part: number, pivotY: number): void => {
    const box = new BoxGeometry(w, h, d).toNonIndexed();
    box.translate(x, y, z);
    const count = box.getAttribute('position').count;
    box.setAttribute('aPart', new BufferAttribute(new Float32Array(count).fill(part), 1));
    box.setAttribute('aPivot', new BufferAttribute(new Float32Array(count).fill(pivotY), 1));
    box.deleteAttribute('uv');
    parts.push(box);
  };
  add(0.36, 0.58, 0.2, 0, 1.12, 0, 0, 0);
  add(0.16, 0.82, 0.18, 0.11, 0.42, 0, 1, 0.82);
  add(0.16, 0.82, 0.18, -0.11, 0.42, 0, 2, 0.82);
  add(0.09, 0.58, 0.11, 0.24, 1.12, 0, 3, 1.38);
  add(0.09, 0.58, 0.11, -0.24, 1.12, 0, 4, 1.38);
  add(0.17, 0.2, 0.18, 0, 1.54, 0.01, 5, 0);
  add(0.19, 0.08, 0.2, 0, 1.66, -0.005, 6, 0);
  return mergeGeometries(parts);
}

const SHIRTS = [0xefe3c8, 0xd8402b, 0x0f7f7a, 0x3b5f8a, 0xf2a20c, 0xc2185b, 0x5fa52f, 0x8a8a84, 0xffffff, 0x7a4a8a];
const LOWER = [0x2a3346, 0x3a2f28, 0x20262c, 0x4d6b4a, 0x6a2f3a, 0x2f4d6a, 0x8a6a3a];
const SKIN = [0xc08a60, 0xa97850, 0x8a5e3e, 0x9c6a48];

/** A crowd in one instanced draw. Limbs swing in the vertex shader, so it costs almost nothing. */
export class FigureBatch {
  private readonly geometry: InstancedBufferGeometry;
  private readonly positions: Float32Array;
  private readonly anim: Float32Array;
  private readonly shirts: Float32Array;
  private readonly lowers: Float32Array;
  private readonly skins: Float32Array;
  private readonly palette = {
    shirt: SHIRTS.map((hex) => new Color(hex)),
    lower: LOWER.map((hex) => new Color(hex)),
    skin: SKIN.map((hex) => new Color(hex)),
  };

  constructor(scene: Scene, capacity: number) {
    const figure = buildFigure();
    this.geometry = new InstancedBufferGeometry();
    this.geometry.setAttribute('position', figure.getAttribute('position'));
    this.geometry.setAttribute('normal', figure.getAttribute('normal'));
    this.geometry.setAttribute('aPart', figure.getAttribute('aPart'));
    this.geometry.setAttribute('aPivot', figure.getAttribute('aPivot'));
    this.positions = new Float32Array(capacity * 4);
    this.anim = new Float32Array(capacity * 2);
    this.shirts = new Float32Array(capacity * 3);
    this.lowers = new Float32Array(capacity * 3);
    this.skins = new Float32Array(capacity * 3);
    this.geometry.setAttribute('iPose', new InstancedBufferAttribute(this.positions, 4));
    this.geometry.setAttribute('iAnim', new InstancedBufferAttribute(this.anim, 2));
    this.geometry.setAttribute('iShirt', new InstancedBufferAttribute(this.shirts, 3));
    this.geometry.setAttribute('iLower', new InstancedBufferAttribute(this.lowers, 3));
    this.geometry.setAttribute('iSkin', new InstancedBufferAttribute(this.skins, 3));
    this.geometry.instanceCount = 0;

    const material = new ShaderMaterial({
      uniforms: {
        uFog: ATMOS.uFogColor,
        uFogDensity: ATMOS.uFogDensity,
        uAmbient: ATMOS.uAmbient,
      },
      vertexShader: /* glsl */ `
        attribute float aPart;
        attribute float aPivot;
        attribute vec4 iPose;
        attribute vec2 iAnim;
        attribute vec3 iShirt;
        attribute vec3 iLower;
        attribute vec3 iSkin;
        varying vec3 vColor;
        varying float vLight;
        varying float vDistance;
        void main() {
          vec3 p = position;
          float swing = sin(iAnim.x) * 0.62 * iAnim.y;
          // Legs and arms swing about the hip and the shoulder, in opposite pairs.
          if (aPart > 0.5 && aPart < 4.5) {
            float direction = (aPart < 1.5 || aPart > 3.5) ? 1.0 : -1.0;
            float angle = swing * direction;
            float c = cos(angle);
            float s = sin(angle);
            float y = p.y - aPivot;
            p.y = aPivot + y * c - p.z * s;
            p.z = y * s + p.z * c;
          }
          // A walking body bobs a little.
          p.y += abs(sin(iAnim.x)) * 0.03 * iAnim.y;
          float c = cos(iPose.w);
          float s = sin(iPose.w);
          vec3 world = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + iPose.xyz;
          vec3 n = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z);
          vLight = 0.5 + 0.34 * n.y + 0.16 * abs(n.x);
          vColor = aPart < 0.5 ? iShirt : (aPart < 2.5 ? iLower : iSkin);
          if (aPart > 2.5 && aPart < 4.5) vColor = iShirt;
          if (aPart > 5.5) vColor = vec3(0.025, 0.02, 0.02);
          vec4 viewPosition = viewMatrix * vec4(world, 1.0);
          vDistance = length(viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFog;
        uniform float uFogDensity;
        uniform float uAmbient;
        varying vec3 vColor;
        varying float vLight;
        varying float vDistance;
        void main() {
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDistance * vDistance);
          vec3 color = mix(vColor * vLight * 0.9 * uAmbient, uFog, fog);
          gl_FragColor = vec4(color, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new Mesh(this.geometry, material);
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  /** Sets one person. @param look picks the clothes and skin, from a small number */
  set(index: number, x: number, y: number, z: number, yaw: number, phase: number, swing: number, look: number): void {
    const base = index * 4;
    this.positions[base] = x;
    this.positions[base + 1] = y;
    this.positions[base + 2] = z;
    this.positions[base + 3] = yaw;
    this.anim[index * 2] = phase;
    this.anim[index * 2 + 1] = swing;
    const shirt = this.palette.shirt[look % SHIRTS.length];
    const lower = this.palette.lower[(look >> 2) % LOWER.length];
    const skin = this.palette.skin[(look >> 4) % SKIN.length];
    this.shirts[index * 3] = shirt.r;
    this.shirts[index * 3 + 1] = shirt.g;
    this.shirts[index * 3 + 2] = shirt.b;
    this.lowers[index * 3] = lower.r;
    this.lowers[index * 3 + 1] = lower.g;
    this.lowers[index * 3 + 2] = lower.b;
    this.skins[index * 3] = skin.r;
    this.skins[index * 3 + 1] = skin.g;
    this.skins[index * 3 + 2] = skin.b;
  }

  setPhase(index: number, phase: number): void {
    this.anim[index * 2] = phase;
  }

  /** Sends everything to the GPU, and draws this many people. */
  flush(count: number): void {
    this.geometry.instanceCount = count;
    for (const name of ['iPose', 'iAnim', 'iShirt', 'iLower', 'iSkin']) this.geometry.getAttribute(name).needsUpdate = true;
  }

  /** Sends only the animation, for a crowd that stays where it is. */
  flushAnimation(): void {
    this.geometry.getAttribute('iAnim').needsUpdate = true;
  }
}

export class PedestrianRender {
  private readonly batch: FigureBatch;

  constructor(scene: Scene, private readonly people: PedestrianSystem) {
    this.batch = new FigureBatch(scene, people.capacity);
  }

  update(): void {
    const people = this.people;
    let count = 0;
    for (let i = 0; i < people.capacity; i++) {
      if (!people.alive[i]) continue;
      this.batch.set(count, people.x[i], people.y[i], people.z[i], people.yaw[i], people.phase[i], people.swing[i], people.look[i]);
      count++;
    }
    this.batch.flush(count);
  }
}
