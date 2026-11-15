/**
 * The water standing on flooded roads: one quad per low spot, drawn with soft edges, the wet-road
 * reflection, and rain rings. The physics reads the same zones from the flood field.
 */

import { Color, InstancedMesh, Matrix4, PlaneGeometry, Quaternion, ShaderMaterial, Vector3, type Scene } from 'three';
import { ATMOSPHERE } from '../config/atmosphere';
import { ATMOS } from '../render/atmosphere-uniforms';
import type { WetUniforms } from '../render/planar-reflection';
import type { FloodZone } from '../world/atmosphere/flood-field';

export class FloodWater {
  private readonly mesh: InstancedMesh;

  constructor(scene: Scene, zones: readonly FloodZone[], wet: WetUniforms | null) {
    const geometry = new PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2);
    const material = new ShaderMaterial({
      defines: wet ? { USE_REFLECT: '' } : {},
      uniforms: {
        uTime: ATMOS.uTime,
        uRain: ATMOS.uRain,
        uFlood: ATMOS.uFlood,
        uFogColor: ATMOS.uFogColor,
        uFogDensity: ATMOS.uFogDensity,
        uAmbient: ATMOS.uAmbient,
        uAmbientColor: ATMOS.uAmbientColor,
        uDepth: { value: ATMOSPHERE.floodDepth },
        uMud: { value: new Color(0x3c3220) },
        tReflect: wet ? wet.tReflect : { value: null },
        uReflectMatrix: wet ? wet.uReflectMatrix : { value: new Matrix4() },
      },
      vertexShader: /* glsl */ `
        uniform mat4 uReflectMatrix;
        uniform float uFlood;
        uniform float uDepth;
        varying vec2 vLocal;
        varying vec3 vWorld;
        varying vec4 vReflectUv;
        varying float vDistance;
        void main() {
          vLocal = position.xz;
          vec4 world = instanceMatrix * vec4(position, 1.0);
          world.y = 0.012 + uFlood * uDepth * 0.72;
          vWorld = world.xyz;
          vReflectUv = uReflectMatrix * world;
          vec4 view = viewMatrix * world;
          vDistance = length(view.xyz);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uRain;
        uniform float uFlood;
        uniform vec3 uFogColor;
        uniform float uFogDensity;
        uniform float uAmbient;
        uniform vec3 uAmbientColor;
        uniform vec3 uMud;
        #ifdef USE_REFLECT
        uniform sampler2D tReflect;
        #endif
        varying vec2 vLocal;
        varying vec3 vWorld;
        varying vec4 vReflectUv;
        varying float vDistance;
        vec2 hash22(vec2 p) {
          vec3 a = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
          a += dot(a, a.yzx + 33.33);
          return fract((a.xx + a.yz) * a.zy);
        }
        vec2 rings(vec2 p, float t) {
          vec2 total = vec2(0.0);
          vec2 cell = floor(p);
          vec2 f = p - cell;
          for (int j = -1; j <= 0; j++) {
            for (int i = -1; i <= 0; i++) {
              vec2 offset = vec2(float(i), float(j));
              vec2 h = hash22(cell + offset);
              float phase = fract(t * (0.7 + h.x * 0.6) + h.y);
              vec2 d = f - offset - h;
              float r = length(d);
              float wave = sin((r - phase * 1.3) * 26.0) * (1.0 - phase) * smoothstep(0.32, 0.0, abs(r - phase * 1.3));
              total += d / (r + 0.001) * wave;
            }
          }
          return total;
        }
        void main() {
          // Soft, uneven edges, so the water looks poured rather than cut out.
          float edge = dot(vLocal, vLocal);
          float wobble = sin(vWorld.x * 0.55) * 0.08 + sin(vWorld.z * 0.47 + vWorld.x * 0.2) * 0.08;
          float shape = 1.0 - smoothstep(0.62 * uFlood + wobble, 0.92 * uFlood + wobble, edge);
          if (shape < 0.004) discard;
          vec2 wave = vec2(sin(vWorld.z * 1.4 + uTime * 1.3), cos(vWorld.x * 1.2 - uTime * 1.1)) * 0.012;
          wave += rings(vWorld.xz * 1.1, uTime) * uRain * 0.03;
          float fresnel = mix(0.42, 1.0, pow(1.0 - clamp(vWorld.y / max(vDistance, 1.0) * 6.0, 0.0, 1.0), 2.0));
          vec3 colour = uMud * uAmbient * uAmbientColor * 0.55;
          #ifdef USE_REFLECT
          vec2 uv = vReflectUv.xy / vReflectUv.w + wave;
          vec3 reflected = texture2D(tReflect, uv).rgb * 0.4 + texture2D(tReflect, uv + vec2(0.0, 0.012)).rgb * 0.3 + texture2D(tReflect, uv - vec2(0.0, 0.012)).rgb * 0.3;
          colour += reflected * fresnel * 1.2;
          #else
          colour += uAmbient * uAmbientColor * 0.12 * fresnel;
          #endif
          float glint = pow(max(0.0, length(wave) * 18.0), 3.0);
          colour += vec3(0.5, 0.55, 0.6) * glint * 0.12 * uAmbient;
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDistance * vDistance);
          gl_FragColor = vec4(mix(colour, uFogColor, fog), shape * 0.86);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });
    this.mesh = new InstancedMesh(geometry, material, Math.max(1, zones.length));
    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const position = new Vector3();
    const scale = new Vector3();
    const up = new Vector3(0, 1, 0);
    zones.forEach((zone, index) => {
      rotation.setFromAxisAngle(up, zone.yaw);
      position.set(zone.x, 0, zone.z);
      scale.set(zone.halfWidth, 1, zone.halfLength);
      matrix.compose(position, rotation, scale);
      this.mesh.setMatrixAt(index, matrix);
    });
    this.mesh.count = zones.length;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(level: number): void {
    this.mesh.visible = level > 0.02;
  }
}
