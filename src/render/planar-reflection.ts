/**
 * Wet-road reflection: renders the bright parts of the world mirrored in the road plane
 * into a small texture, and the road shader smears it vertically like real wet asphalt.
 * Only meshes on REFLECT_LAYER are drawn, so this stays a handful of draw calls.
 */

import {
  HalfFloatType,
  LinearFilter,
  Matrix4,
  PerspectiveCamera,
  Vector3,
  WebGLRenderTarget,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { ATMOS } from './atmosphere-uniforms';

export const REFLECT_LAYER = 1;

const NORMAL = new Vector3(0, 1, 0);

/** Shared with every wet material. */
export interface WetUniforms {
  tReflect: { value: Texture | null };
  uReflectMatrix: { value: Matrix4 };
  uReflectStrength: { value: number };
}

export function enableReflection(object: Object3D): void {
  object.traverse((child) => child.layers.enable(REFLECT_LAYER));
}

export class PlanarReflection {
  readonly uniforms: WetUniforms;
  private readonly target: WebGLRenderTarget;
  private readonly virtualCamera = new PerspectiveCamera();
  private readonly cameraPosition = new Vector3();
  private readonly planePoint = new Vector3();
  private readonly view = new Vector3();
  private readonly lookAtPosition = new Vector3();
  private readonly targetPoint = new Vector3();
  private readonly rotation = new Matrix4();
  private frame = 0;

  constructor(
    private readonly scale: number,
    private readonly everyNFrames: number,
    strength: number,
  ) {
    this.target = new WebGLRenderTarget(4, 4, {
      type: HalfFloatType,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      depthBuffer: true,
    });
    this.virtualCamera.layers.set(REFLECT_LAYER);
    this.uniforms = {
      tReflect: { value: this.target.texture },
      uReflectMatrix: { value: new Matrix4() },
      uReflectStrength: { value: strength },
    };
  }

  setSize(width: number, height: number): void {
    this.target.setSize(Math.max(4, Math.round(width * this.scale)), Math.max(4, Math.round(height * this.scale)));
  }

  render(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, planeY: number): void {
    this.frame++;
    if (this.frame % this.everyNFrames !== 0) return;

    camera.updateMatrixWorld();
    this.cameraPosition.setFromMatrixPosition(camera.matrixWorld);
    if (this.cameraPosition.y <= planeY) return;
    this.rotation.extractRotation(camera.matrixWorld);
    this.planePoint.set(this.cameraPosition.x, planeY, this.cameraPosition.z);

    // Mirror the camera position in the plane.
    this.view.subVectors(this.planePoint, this.cameraPosition);
    this.view.reflect(NORMAL).negate();
    this.view.add(this.planePoint);

    // Mirror the point the camera looks at.
    this.lookAtPosition.set(0, 0, -1).applyMatrix4(this.rotation).add(this.cameraPosition);
    this.targetPoint.subVectors(this.planePoint, this.lookAtPosition);
    this.targetPoint.reflect(NORMAL).negate();
    this.targetPoint.add(this.planePoint);

    const virtual = this.virtualCamera;
    virtual.position.copy(this.view);
    virtual.up.set(0, 1, 0).applyMatrix4(this.rotation).reflect(NORMAL);
    virtual.lookAt(this.targetPoint);
    virtual.near = camera.near;
    virtual.far = camera.far;
    virtual.updateMatrixWorld();
    virtual.projectionMatrix.copy(camera.projectionMatrix);

    // Clip space to UV, multiplied by the mirrored view-projection.
    const matrix = this.uniforms.uReflectMatrix.value;
    matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    matrix.multiply(virtual.projectionMatrix);
    matrix.multiply(virtual.matrixWorldInverse);

    const previousTarget = renderer.getRenderTarget();
    const previousShadow = renderer.shadowMap.autoUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, virtual);
    renderer.setRenderTarget(previousTarget);
    renderer.shadowMap.autoUpdate = previousShadow;
  }

  dispose(): void {
    this.target.dispose();
  }
}

/**
 * Teaches a road material about the weather: how wet it is, puddles, rain rings and, when the
 * quality preset allows it, the mirrored street. Without a reflection it still darkens and shines.
 */
export function makeWet(material: import('three').MeshStandardMaterial, uniforms: WetUniforms | null): void {
  if (uniforms) material.defines = { ...(material.defines ?? {}), USE_WET_REFLECTION: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWetness = ATMOS.uWetness;
    shader.uniforms.uRain = ATMOS.uRain;
    shader.uniforms.uPuddles = ATMOS.uPuddles;
    shader.uniforms.uClockWet = ATMOS.uTime;
    if (uniforms) {
      shader.uniforms.tReflect = uniforms.tReflect;
      shader.uniforms.uReflectMatrix = uniforms.uReflectMatrix;
      shader.uniforms.uReflectStrength = uniforms.uReflectStrength;
    }
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vWetXZ;
        #ifdef USE_WET_REFLECTION
        uniform mat4 uReflectMatrix;
        varying vec4 vReflectUv;
        #endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vWetXZ = (modelMatrix * vec4(transformed, 1.0)).xz;
        #ifdef USE_WET_REFLECTION
        vReflectUv = uReflectMatrix * modelMatrix * vec4(transformed, 1.0);
        #endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uWetness;
        uniform float uRain;
        uniform float uPuddles;
        uniform float uClockWet;
        varying vec2 vWetXZ;
        #ifdef USE_WET_REFLECTION
        uniform sampler2D tReflect;
        uniform float uReflectStrength;
        varying vec4 vReflectUv;
        #endif
        vec2 wetHash(vec2 p) {
          vec3 a = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          a += dot(a, a.yzx + 33.33);
          return fract((a.xx + a.yz) * a.zy);
        }
        float wetNoise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          float a = wetHash(i).x;
          float b = wetHash(i + vec2(1.0, 0.0)).x;
          float c = wetHash(i + vec2(0.0, 1.0)).x;
          float d = wetHash(i + vec2(1.0, 1.0)).x;
          return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
        }
        vec2 wetRings(vec2 p, float t) {
          vec2 total = vec2(0.0);
          vec2 cell = floor(p);
          vec2 f = p - cell;
          for (int j = -1; j <= 0; j++) {
            for (int i = -1; i <= 0; i++) {
              vec2 offset = vec2(float(i), float(j));
              vec2 h = wetHash(cell + offset);
              float phase = fract(t * (0.8 + h.x * 0.7) + h.y);
              vec2 d = f - offset - h;
              float r = length(d);
              float wave = sin((r - phase * 1.2) * 26.0) * (1.0 - phase) * smoothstep(0.3, 0.0, abs(r - phase * 1.2));
              total += d / (r + 0.001) * wave;
            }
          }
          return total;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        // Puddles lie in the dips, wherever two scales of noise agree.
        float wetPuddle = 0.0;
        if (uPuddles > 0.01) {
          float dips = wetNoise(vWetXZ * 0.13) * 0.65 + wetNoise(vWetXZ * 0.41) * 0.35;
          wetPuddle = smoothstep(0.66 - uPuddles * 0.2, 0.72 - uPuddles * 0.2, dips);
        }
        // The roughness map was painted for a wet road, so a dry one simply loses its shine.
        roughnessFactor = mix(min(1.0, roughnessFactor * mix(2.2, 1.0, uWetness) + (1.0 - uWetness) * 0.14), 0.05, wetPuddle);
        diffuseColor.rgb *= mix(1.3, 1.0, uWetness) * (1.0 - wetPuddle * 0.42);
        vec2 wetRipple = vec2(0.0);
        float wetNear = 1.0 - smoothstep(10.0, 44.0, length(vViewPosition));
        if (uRain > 0.01 && wetNear > 0.0) wetRipple = wetRings(vWetXZ * 0.95, uClockWet) * uRain * wetNear;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          #ifdef USE_WET_REFLECTION
          vec2 reflectUv = vReflectUv.xy / vReflectUv.w;
          // Rough patches bend the reflection a little, so edges break up like real wet asphalt.
          reflectUv.x += (roughnessFactor - 0.4) * 0.016;
          reflectUv += wetRipple * 0.018;
          float wetness = 1.0 - clamp(roughnessFactor * 1.35, 0.0, 1.0);
          float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float fresnel = mix(0.2, 1.0, pow(1.0 - facing, 3.0));
          // Smear along screen height: this is what turns a lamp into a long wet streak.
          vec3 reflected = texture2D(tReflect, reflectUv).rgb * 0.26;
          reflected += texture2D(tReflect, reflectUv + vec2(0.0, 0.009)).rgb * 0.2;
          reflected += texture2D(tReflect, reflectUv - vec2(0.0, 0.009)).rgb * 0.2;
          reflected += texture2D(tReflect, reflectUv + vec2(0.0, 0.021)).rgb * 0.17;
          reflected += texture2D(tReflect, reflectUv - vec2(0.0, 0.021)).rgb * 0.17;
          outgoingLight += reflected * fresnel * wetness * uReflectStrength * mix(0.12, 1.0, uWetness) * (1.0 + wetPuddle * 0.6);
          #endif
          // Each ring catches a little of whatever light is around.
          outgoingLight += outgoingLight * dot(wetRipple, wetRipple) * 2.2;
        }
        #include <opaque_fragment>`,
      );
  };
}
