/** Street lamps as instanced meshes, with fake light pools and one real light that follows the car. */

import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  CylinderGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNING, type QualityPreset } from '../config/tuning';
import { smoothstep } from '../core/math';
import type { PhysicsWorld } from '../physics/physics-world';
import { ATMOS, BLACKOUT_GLSL } from '../render/atmosphere-uniforms';
import { enableReflection } from '../render/planar-reflection';

export interface LampSpec {
  /** Foot of the pole. */
  x: number;
  y: number;
  z: number;
  /** Unit direction the arm reaches, over the road. */
  armX: number;
  armZ: number;
  height: number;
  /** Height of the road surface under the lamp. */
  roadY: number;
  /** Rotates the light pool to follow the road. */
  poolYaw: number;
  /** Collider on the pole. Lamps on a flyover barrier do not need one. */
  solid: boolean;
}

const ARM_LENGTH = 2.45;
const UP = new Vector3(0, 1, 0);

/** Pools of sodium light on the road. Fades with distance in the shader, since fog breaks additive blending. */
function createLightPools(lamps: readonly LampSpec[]): InstancedMesh {
  const material = new ShaderMaterial({
    vertexShader: /* glsl */ `
      uniform vec4 uBlackout;
      varying vec2 vUv;
      varying float vDistance;
      varying float vPower;
      ${BLACKOUT_GLSL}
      void main() {
        vUv = uv;
        vPower = powerAt((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz, uBlackout);
        vec4 viewPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        vDistance = length(viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLampGlow;
      varying vec2 vUv;
      varying float vDistance;
      varying float vPower;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float pool = pow(max(1.0 - d, 0.0), 1.7);
        float fade = exp(-vDistance * 0.0032);
        gl_FragColor = vec4(uColor * pool * fade * uLampGlow * vPower, 1.0);
        #include <colorspace_fragment>
      }`,
    uniforms: { uColor: { value: new Color(TUNING.world.colors.sodium).multiplyScalar(0.2) }, uLampGlow: ATMOS.uLampGlow, uBlackout: ATMOS.uBlackout },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const geometry = new PlaneGeometry(1, 1);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new InstancedMesh(geometry, material, lamps.length);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3(19, 1, 27);
  lamps.forEach((lamp, index) => {
    rotation.setFromAxisAngle(UP, lamp.poolYaw);
    position.set(lamp.x + lamp.armX * ARM_LENGTH, lamp.roadY + 0.035, lamp.z + lamp.armZ * ARM_LENGTH);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  return mesh;
}

/** A cone of light under a lamp, seen only when the air has something in it to catch the light. */
function createLightShafts(lamps: readonly LampSpec[]): InstancedMesh {
  const cone = new CylinderGeometry(0.12, 3.4, 1, 10, 1, true);
  cone.translate(0, -0.5, 0);
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(TUNING.world.colors.sodium) },
      uLampGlow: ATMOS.uLampGlow,
      uBlackout: ATMOS.uBlackout,
      uAir: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform vec4 uBlackout;
      varying float vAlong;
      varying float vFacing;
      varying float vFade;
      ${BLACKOUT_GLSL}
      void main() {
        vAlong = -position.y;
        vec4 world = instanceMatrix * vec4(position, 1.0);
        vec3 worldNormal = normalize(mat3(instanceMatrix) * normal);
        vec3 toCamera = normalize(cameraPosition - world.xyz);
        // Strongest through the middle of the cone, and gone at its outline.
        vFacing = pow(abs(dot(worldNormal, toCamera)), 2.0);
        vec4 view = viewMatrix * world;
        float away = length(view.xyz);
        vFade = powerAt((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz, uBlackout) * (1.0 - smoothstep(60.0, 170.0, away));
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLampGlow;
      uniform float uAir;
      varying float vAlong;
      varying float vFacing;
      varying float vFade;
      void main() {
        float falloff = 1.0 - vAlong;
        gl_FragColor = vec4(uColor * falloff * falloff * vFacing * vFade * uLampGlow * uAir, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: 2,
  });
  const mesh = new InstancedMesh(cone, material, lamps.length);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  const scale = new Vector3();
  lamps.forEach((lamp, index) => {
    position.set(lamp.x + lamp.armX * ARM_LENGTH, lamp.y + lamp.height * 0.97, lamp.z + lamp.armZ * ARM_LENGTH);
    scale.set(1, Math.max(1, lamp.height * 0.97 - (lamp.roadY - lamp.y)), 1);
    matrix.compose(position, rotation, scale);
    mesh.setMatrixAt(index, matrix);
  });
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.visible = false;
  return mesh;
}

/** The glare a lamp throws across the lens: wide and flat, more so in rain. One draw call. */
function createGlare(lamps: readonly LampSpec[]): InstancedMesh {
  const quad = new PlaneGeometry(1, 1);
  const material = new ShaderMaterial({
    uniforms: {
      uColor: { value: new Color(TUNING.world.colors.sodium) },
      uLampGlow: ATMOS.uLampGlow,
      uBlackout: ATMOS.uBlackout,
      uAir: { value: 0 },
    },
    vertexShader: /* glsl */ `
      uniform vec4 uBlackout;
      uniform float uAir;
      varying vec2 vUv;
      varying float vFade;
      ${BLACKOUT_GLSL}
      void main() {
        vUv = uv;
        vec4 centre = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vec4 view = viewMatrix * centre;
        float away = length(view.xyz);
        vFade = powerAt(centre.xz, uBlackout) * smoothstep(6.0, 20.0, away) * (1.0 - smoothstep(110.0, 240.0, away));
        // Pulled sideways, as a wet lens stretches a bright point.
        view.xy += position.xy * vec2(9.0 + uAir * 7.0, 2.4);
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uLampGlow;
      uniform float uAir;
      varying vec2 vUv;
      varying float vFade;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float streak = exp(-abs(p.y) * 12.0) * (1.0 - abs(p.x));
        float spot = pow(max(0.0, 1.0 - length(p * vec2(3.2, 1.0))), 3.0);
        gl_FragColor = vec4(uColor * (streak * (0.12 + uAir * 0.2) + spot * 0.4) * vFade * uLampGlow, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: AdditiveBlending,
  });
  const mesh = new InstancedMesh(quad, material, lamps.length);
  const matrix = new Matrix4();
  const rotation = new Quaternion();
  const position = new Vector3();
  lamps.forEach((lamp, index) => {
    position.set(lamp.x + lamp.armX * ARM_LENGTH, lamp.y + lamp.height * 0.97, lamp.z + lamp.armZ * ARM_LENGTH);
    matrix.compose(position, rotation, new Vector3(1, 1, 1));
    mesh.setMatrixAt(index, matrix);
  });
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  return mesh;
}

export class LampField {
  private readonly heads: Vector3[] = [];
  private readonly light: PointLight | null = null;
  private readonly headMaterial: MeshBasicMaterial;
  private readonly shafts: InstancedMesh | null = null;
  private readonly glare: InstancedMesh | null = null;

  constructor(scene: Scene, physics: PhysicsWorld, preset: QualityPreset, lamps: readonly LampSpec[]) {
    // Built for a unit height so one geometry fits every lamp through instance scale.
    const pole = new CylinderGeometry(0.09, 0.14, 1, 6);
    pole.translate(0, 0.5, 0);
    const arm = new BoxGeometry(0.08, 0.009, 2.7);
    arm.translate(0, 0.992, 1.3);
    const poleGeometry = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()]);
    const poles = new InstancedMesh(
      poleGeometry,
      new MeshStandardMaterial({ color: 0x23272b, roughness: 0.62, metalness: 0.5 }),
      lamps.length,
    );
    const headGeometry = new BoxGeometry(0.34, 0.012, 0.8);
    headGeometry.translate(0, 0.982, ARM_LENGTH);
    this.headMaterial = new MeshBasicMaterial({ color: new Color(TUNING.world.colors.sodium).multiplyScalar(4.5), toneMapped: false });
    // A lamp with no power shows as a dark box, whatever the hour.
    this.headMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uLampGlow = ATMOS.uLampGlow;
      shader.uniforms.uBlackout = ATMOS.uBlackout;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform vec4 uBlackout;
          varying float vPower;
          ${BLACKOUT_GLSL}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vPower = powerAt((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz, uBlackout);`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform float uLampGlow;
          varying float vPower;`)
        .replace('#include <opaque_fragment>', `outgoingLight = mix(vec3(0.03), outgoingLight, uLampGlow * vPower);
          #include <opaque_fragment>`);
    };
    const heads = new InstancedMesh(headGeometry, this.headMaterial, lamps.length);

    const matrix = new Matrix4();
    const rotation = new Quaternion();
    const position = new Vector3();
    const scale = new Vector3();
    lamps.forEach((lamp, index) => {
      position.set(lamp.x, lamp.y, lamp.z);
      rotation.setFromAxisAngle(UP, Math.atan2(lamp.armX, lamp.armZ));
      scale.set(1, lamp.height, 1);
      matrix.compose(position, rotation, scale);
      poles.setMatrixAt(index, matrix);
      heads.setMatrixAt(index, matrix);
      this.heads.push(
        new Vector3(lamp.x + lamp.armX * ARM_LENGTH, lamp.y + lamp.height * 0.98, lamp.z + lamp.armZ * ARM_LENGTH),
      );
      if (lamp.solid) physics.addFixedCuboid(0.16, lamp.height / 2, 0.16, lamp.x, lamp.y + lamp.height / 2, lamp.z);
    });
    poles.frustumCulled = false;
    heads.frustumCulled = false;
    poles.castShadow = preset.shadows;
    enableReflection(heads);
    scene.add(poles, heads, createLightPools(lamps));

    if (preset.headlightSpot) {
      this.light = new PointLight(TUNING.world.colors.sodium, 0, 34, 1.5);
      scene.add(this.light);
    }
    if (preset.lampShafts) {
      this.shafts = createLightShafts(lamps);
      this.glare = createGlare(lamps);
      scene.add(this.shafts, this.glare);
    }
  }

  /** How much there is in the air for light to catch: rain, mist or haze. */
  setAir(amount: number): void {
    if (!this.shafts || !this.glare) return;
    const shaftMaterial = this.shafts.material as ShaderMaterial;
    shaftMaterial.uniforms.uAir.value = amount * 0.34;
    (this.glare.material as ShaderMaterial).uniforms.uAir.value = amount;
    this.shafts.visible = amount > 0.04 && ATMOS.uLampGlow.value > 0.02;
    this.glare.visible = ATMOS.uLampGlow.value > 0.02;
  }

  /** The nearest lamp lights the car for real, fading to nothing before it hands over to the next one. */
  update(carPosition: Vector3): void {
    const light = this.light;
    if (!light || this.heads.length === 0) return;
    let nearest = this.heads[0];
    let best = Infinity;
    for (const lamp of this.heads) {
      const dx = lamp.x - carPosition.x;
      const dz = lamp.z - carPosition.z;
      const distance = dx * dx + dz * dz;
      if (distance < best) {
        best = distance;
        nearest = lamp;
      }
    }
    light.position.copy(nearest);
    const blackout = ATMOS.uBlackout.value;
    const powered = blackout.w < 0.5 || Math.hypot(nearest.x - blackout.x, nearest.z - blackout.y) > blackout.z ? 1 : 0;
    light.intensity = 85 * (1 - smoothstep(7, 19, Math.sqrt(best))) * ATMOS.uLampGlow.value * powered;
  }
}
