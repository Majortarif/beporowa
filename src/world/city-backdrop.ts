/**
 * Everything behind the road: sky, ground, the drift yard, buildings with lit windows,
 * rooftop water tanks, and the far skyline that gives the sense of a megacity.
 */

import {
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnvKind } from '../config/atmosphere';
import { TUNING, type QualityPreset } from '../config/tuning';
import { createRng } from '../core/math';
import type { PhysicsWorld, SurfaceKind } from '../physics/physics-world';
import { worldText } from '../i18n';
import { FONT_DISPLAY, PAINT, makeCanvas, toTexture } from '../render/painted-textures';
import { enableReflection, makeWet, type WetUniforms } from '../render/planar-reflection';
import type { TrackPath } from './track-path';

const SKY_LOOKS: Readonly<Record<EnvKind, { top: number; mid: number; horizon: number; sun: readonly [number, number, number]; sunAmount: number; clouds: number; daylight: number }>> = {
  night: { top: TUNING.world.colors.skyTop, mid: TUNING.world.colors.skyMid, horizon: TUNING.world.colors.skyHorizon, sun: [0, -1, 0], sunAmount: 0, clouds: 0, daylight: 0 },
  dusk: { top: 0x1a2448, mid: 0x6a4060, horizon: 0xe06030, sun: [-0.8, 0.12, 0.3], sunAmount: 1, clouds: 0.3, daylight: 0.25 },
  day: { top: 0x2f78c8, mid: 0x7fbce8, horizon: 0xe0e4d8, sun: [0.2, 0.9, 0.3], sunAmount: 1, clouds: 0.25, daylight: 1 },
  storm: { top: 0x4c545c, mid: 0x6c747c, horizon: 0x8c9090, sun: [0, 1, 0], sunAmount: 0, clouds: 1, daylight: 0.5 },
};

/**
 * Sky dome: by default the original dark teal overhead with sodium-orange city haze at the horizon.
 * The atmosphere changes its colours, and adds the sun, the moon, stars and clouds where the preset allows.
 */
export function createSky(look: EnvKind = 'night', detail = false): Mesh {
  const start = SKY_LOOKS[look];
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    defines: detail ? { SKY_DETAIL: '' } : {},
    uniforms: {
      uTop: { value: new Color(start.top) },
      uMid: { value: new Color(start.mid) },
      uHorizon: { value: new Color(start.horizon) },
      uSunDir: { value: new Vector3(start.sun[0], start.sun[1], start.sun[2]) },
      uSunAmount: { value: start.sunAmount },
      uMoonAmount: { value: 0 },
      uStars: { value: 0 },
      uClouds: { value: start.clouds },
      uDaylight: { value: start.daylight },
      uFlash: { value: 0 },
      uClock: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uTop;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform float uSunAmount;
      uniform float uMoonAmount;
      uniform float uStars;
      uniform float uClouds;
      uniform float uDaylight;
      uniform float uFlash;
      uniform float uClock;
      varying vec3 vDirection;
      #ifdef SKY_DETAIL
      float skyHash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float skyNoise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(skyHash(i), skyHash(i + vec2(1.0, 0.0)), u.x), mix(skyHash(i + vec2(0.0, 1.0)), skyHash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float skyClouds(vec2 p) {
        return skyNoise(p) * 0.55 + skyNoise(p * 2.1 + 3.7) * 0.3 + skyNoise(p * 4.3 + 9.1) * 0.15;
      }
      #endif
      void main() {
        vec3 direction = normalize(vDirection);
        float h = clamp(direction.y, -0.05, 1.0);
        vec3 color = mix(uMid, uTop, smoothstep(0.1, 0.6, h));
        color = mix(color, uHorizon, pow(1.0 - smoothstep(-0.02, 0.2, h), 1.7));

        float toSun = max(0.0, dot(direction, uSunDir));
        color += vec3(1.0, 0.78, 0.5) * pow(toSun, 9.0) * 0.28 * uSunAmount;
        color += vec3(1.0, 0.93, 0.8) * pow(toSun, 900.0) * 7.0 * uSunAmount;

        #ifdef SKY_DETAIL
        if (uStars > 0.01 && direction.y > 0.0) {
          vec2 cell = floor(direction.xz / (direction.y + 0.35) * 190.0);
          float star = step(0.9965, skyHash(cell));
          color += vec3(0.9, 0.92, 1.0) * star * uStars * smoothstep(0.08, 0.4, direction.y) * 0.5;
        }
        if (uMoonAmount > 0.01) {
          float toMoon = max(0.0, dot(direction, normalize(vec3(-0.43, 0.62, -0.28))));
          color += vec3(0.92, 0.94, 1.0) * smoothstep(0.99955, 0.9997, toMoon) * 1.6 * uMoonAmount;
          color += vec3(0.5, 0.58, 0.72) * pow(toMoon, 300.0) * 0.14 * uMoonAmount;
        }
        if (direction.y > 0.0 && uClouds > 0.02) {
          vec2 place = direction.xz / (direction.y + 0.28) * 1.6 + vec2(uClock * 0.006, uClock * 0.002);
          float shape = skyClouds(place);
          float cover = smoothstep(0.72 - uClouds * 0.55, 0.92 - uClouds * 0.4, shape) * smoothstep(0.0, 0.16, direction.y);
          vec3 lit = mix(vec3(0.05, 0.05, 0.07) + uHorizon * 0.12, vec3(0.92, 0.92, 0.9), uDaylight * (1.0 - uClouds * 0.55));
          color = mix(color, lit, cover * (0.45 + uClouds * 0.5));
          color += vec3(0.75, 0.8, 1.0) * uFlash * cover * 1.6;
        }
        #endif
        color += vec3(0.5, 0.55, 0.72) * uFlash * 0.42;
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const sky = new Mesh(new SphereGeometry(3000, 24, 12), material);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  enableReflection(sky);
  return sky;
}

/** A repeating facade: rows of windows, some lit. Returns colour and emissive maps. */
export function createFacadeTextures(anisotropy: number): { map: CanvasTexture; emissive: CanvasTexture } {
  const size = 512;
  const cells = 8;
  const cell = size / cells;
  const random = createRng(TUNING.world.seed + 2);
  const { canvas, ctx } = makeCanvas(size, size);
  const { canvas: glowCanvas, ctx: glow } = makeCanvas(size, size);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  glow.fillStyle = '#000000';
  glow.fillRect(0, 0, size, size);
  const warm = ['#ffb765', '#ffd28e', '#ff9a4a', '#f7e0b0', '#9fd7c8'];
  for (let row = 0; row < cells; row++) {
    for (let column = 0; column < cells; column++) {
      const x = column * cell + cell * 0.2;
      const y = row * cell + cell * 0.2;
      const w = cell * 0.6;
      const h = cell * 0.6;
      ctx.fillStyle = '#2b2a2c';
      ctx.fillRect(x, y, w, h);
      if (random() < 0.34) {
        const color = warm[Math.floor(random() * warm.length)];
        const level = random() < 0.3 ? 0.5 : 1;
        glow.globalAlpha = level;
        glow.fillStyle = color;
        glow.fillRect(x, y, w, h);
        glow.globalAlpha = 1;
      }
    }
  }
  return {
    map: toTexture(canvas, anisotropy, true),
    emissive: toTexture(glowCanvas, anisotropy, true),
  };
}

const FLOOR_HEIGHT = 3.3;
const COLUMN_WIDTH = 3;
const FACADE_CELLS = 8;

/** A box with UVs in window units, so windows stay the same size on every building. */
export function buildingGeometry(
  width: number,
  height: number,
  depth: number,
  color: Color,
  uOffset: number,
  vOffset: number,
  windowScale = 1,
): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth).toNonIndexed();
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  const colors = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const nx = normal.getX(i);
    const ny = normal.getY(i);
    const along = Math.abs(nx) > 0.5 ? position.getZ(i) : position.getX(i);
    if (Math.abs(ny) > 0.5) {
      // Roofs point at the gap between windows, so they stay unlit.
      uv.setXY(i, 0.005, 0.005);
    } else {
      uv.setXY(
        i,
        (along + width) / (COLUMN_WIDTH * FACADE_CELLS * windowScale) + uOffset,
        (position.getY(i) + height / 2) / (FLOOR_HEIGHT * FACADE_CELLS * windowScale) + vOffset,
      );
    }
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  return geometry;
}

export function waterTankGeometry(x: number, y: number, z: number): BufferGeometry {
  const tank = new CylinderGeometry(1.05, 1.05, 1.5, 8).toNonIndexed();
  tank.translate(x, y + 0.75, z);
  const count = tank.getAttribute('position').count;
  const uv = tank.getAttribute('uv');
  for (let i = 0; i < count; i++) uv.setXY(i, 0.005, 0.005);
  const colors = new Float32Array(count * 3);
  colors.fill(0.07);
  tank.setAttribute('color', new BufferAttribute(colors, 3));
  return tank;
}

const BUILDING_TINTS = [0x8a6a52, 0x7b5e5e, 0x5f6f73, 0x8c7c5c, 0x6e6a64, 0x8e5a44, 0x4f6a60];

export function createBuildings(scene: Scene, track: TrackPath, physics: PhysicsWorld, preset: QualityPreset): void {
  const world = TUNING.world;
  const random = createRng(world.seed + 3);
  const textures = createFacadeTextures(preset.anisotropy);
  const parts: BufferGeometry[] = [];
  const count = Math.round(world.buildingCount * preset.buildingDensity);
  const plaza = world.plaza;
  const tint = new Color();
  const placed: { x: number; z: number; radius: number }[] = [];

  let attempts = 0;
  while (placed.length < count && attempts < count * 30) {
    attempts++;
    const i = Math.floor(random() * track.count);
    const side = random() < 0.5 ? 1 : -1;
    const offset = world.buildingMinOffset + random() * (world.buildingMaxOffset - world.buildingMinOffset);
    const width = 10 + random() * 16;
    const depth = 10 + random() * 16;
    const radius = Math.hypot(width, depth) / 2;
    const x = track.x(i) + track.sides[i * 3] * side * (offset + radius);
    const z = track.z(i) + track.sides[i * 3 + 2] * side * (offset + radius);

    // Must clear the whole road, not just the sample it grew from.
    let clear = true;
    for (let s = 0; s < track.count; s += 3) {
      if (Math.hypot(track.x(s) - x, track.z(s) - z) < world.buildingMinOffset + radius) {
        clear = false;
        break;
      }
    }
    if (!clear) continue;
    if (Math.abs(x - plaza.centerX) < plaza.halfX + radius + 6 && Math.abs(z - plaza.centerZ) < plaza.halfZ + radius + 6) continue;
    if (placed.some((b) => Math.hypot(b.x - x, b.z - z) < b.radius + radius + 2)) continue;

    placed.push({ x, z, radius });
    const floors = 3 + Math.floor(random() * random() * 14);
    const height = floors * FLOOR_HEIGHT;
    tint.setHex(BUILDING_TINTS[Math.floor(random() * BUILDING_TINTS.length)]);
    const geometry = buildingGeometry(
      width,
      height,
      depth,
      tint,
      Math.floor(random() * FACADE_CELLS) / FACADE_CELLS,
      Math.floor(random() * FACADE_CELLS) / FACADE_CELLS,
    );
    geometry.translate(x, world.groundY + height / 2, z);
    parts.push(geometry);
    physics.addFixedCuboid(width / 2, height / 2, depth / 2, x, world.groundY + height / 2, z);

    // Rooftop water tanks, a detail of every Dhaka skyline.
    const tanks = 1 + Math.floor(random() * 2);
    for (let t = 0; t < tanks; t++) {
      parts.push(
        waterTankGeometry(
          x + (random() - 0.5) * (width - 3),
          world.groundY + height,
          z + (random() - 0.5) * (depth - 3),
        ),
      );
    }
  }

  // Far skyline: bigger boxes that exist only as silhouettes and windows in the haze.
  const center = track.bounds();
  const centerX = (center.minX + center.maxX) / 2;
  const centerZ = (center.minZ + center.maxZ) / 2;
  const skylineCount = Math.round(world.skylineCount * preset.buildingDensity);
  for (let i = 0; i < skylineCount; i++) {
    const angle = (i / skylineCount) * Math.PI * 2 + random() * 0.03;
    const radius = world.skylineMinRadius + random() * (world.skylineMaxRadius - world.skylineMinRadius);
    const width = 40 + random() * 70;
    const depth = 40 + random() * 70;
    const height = 40 + random() * random() * 170;
    tint.setHex(0x3b3a3e);
    // Real-size windows would shimmer at this distance, so far buildings get big soft ones.
    const geometry = buildingGeometry(width, height, depth, tint, random(), random(), 5);
    geometry.translate(centerX + Math.cos(angle) * radius, height / 2, centerZ + Math.sin(angle) * radius);
    parts.push(geometry);
  }

  const material = new MeshStandardMaterial({
    map: textures.map,
    emissiveMap: textures.emissive,
    emissive: new Color(1, 1, 1),
    emissiveIntensity: 1.5,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
  });
  const mesh = new Mesh(mergeGeometries(parts), material);
  mesh.frustumCulled = false;
  enableReflection(mesh);
  scene.add(mesh);
}

/** Paved practice yard with painted circles and a Bangla name on the ground. */
function createPlazaMaterial(preset: QualityPreset, wetUniforms: WetUniforms | null, roadRoughness: MeshStandardMaterial): MeshStandardMaterial {
  const size = 1024;
  const random = createRng(TUNING.world.seed + 4);
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#1b1b1d';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 26000; i++) {
    const shade = 16 + random() * 30;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.5)`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 2, 1 + random() * 2);
  }
  ctx.lineWidth = 7;
  ctx.strokeStyle = PAINT.marigold;
  for (const [x, y, r] of [
    [size * 0.3, size * 0.3, size * 0.17],
    [size * 0.7, size * 0.7, size * 0.17],
  ] as const) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = PAINT.tin;
  ctx.setLineDash([26, 26]);
  ctx.strokeRect(36, 36, size - 72, size - 72);
  ctx.setLineDash([]);
  ctx.save();
  ctx.translate(size * 0.5, size * 0.5);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `120px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAINT.tomato;
  ctx.fillText(worldText('sign.plaza'), 0, 0);
  ctx.restore();

  const material = new MeshStandardMaterial({
    map: toTexture(canvas, preset.anisotropy),
    roughness: 0.42,
    metalness: 0,
  });
  // Reuses the road's roughness map when reflections are on, because the wet shader reads it.
  if (wetUniforms && roadRoughness.roughnessMap) {
    material.roughnessMap = roadRoughness.roughnessMap;
    material.roughness = 1;
    makeWet(material, wetUniforms);
  }
  return material;
}

export function createGround(
  scene: Scene,
  track: TrackPath,
  physics: PhysicsWorld,
  preset: QualityPreset,
  dirtTexture: CanvasTexture,
  wetUniforms: WetUniforms | null,
  roadMaterial: MeshStandardMaterial,
): void {
  const world = TUNING.world;
  const groundTexture = dirtTexture.clone();
  groundTexture.wrapS = RepeatWrapping;
  groundTexture.wrapT = RepeatWrapping;
  groundTexture.repeat.set(220, 220);
  groundTexture.needsUpdate = true;
  const ground = new Mesh(
    new PlaneGeometry(7000, 7000),
    new MeshStandardMaterial({ map: groundTexture, roughness: 1, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = world.groundY;
  ground.receiveShadow = preset.shadows;
  scene.add(ground);
  physics.addFixedCuboid(4000, 2, 4000, 0, world.groundY - 2, 0, 'dirt');

  const plaza = world.plaza;
  const plazaMesh = new Mesh(
    new PlaneGeometry(plaza.halfX * 2, plaza.halfZ * 2),
    createPlazaMaterial(preset, wetUniforms, roadMaterial),
  );
  plazaMesh.rotation.x = -Math.PI / 2;
  plazaMesh.position.set(plaza.centerX, world.groundY + 0.03, plaza.centerZ);
  plazaMesh.receiveShadow = preset.shadows;
  scene.add(plazaMesh);
  physics.surfaceOverride = (x: number, z: number): SurfaceKind | null =>
    Math.abs(x - plaza.centerX) < plaza.halfX && Math.abs(z - plaza.centerZ) < plaza.halfZ ? 'plaza' : null;

  // A plain tin fence around the map, so the boundary is something you can see.
  const bounds = track.bounds();
  const padding = world.boundsPadding;
  const minX = bounds.minX - padding;
  const maxX = bounds.maxX + padding;
  const minZ = bounds.minZ - padding;
  const maxZ = bounds.maxZ + padding;
  const fenceHeight = 5;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const lengthX = maxX - minX;
  const lengthZ = maxZ - minZ;
  const parts: BufferGeometry[] = [];
  const addWall = (x: number, z: number, halfX: number, halfZ: number): void => {
    const wall = new BoxGeometry(halfX * 2, fenceHeight, halfZ * 2);
    wall.translate(x, world.groundY + fenceHeight / 2, z);
    parts.push(wall);
    physics.addFixedCuboid(halfX, 12, halfZ, x, world.groundY + 12, z);
  };
  addWall(centerX, minZ, lengthX / 2, 0.4);
  addWall(centerX, maxZ, lengthX / 2, 0.4);
  addWall(minX, centerZ, 0.4, lengthZ / 2);
  addWall(maxX, centerZ, 0.4, lengthZ / 2);
  const fence = new Mesh(mergeGeometries(parts), new MeshStandardMaterial({ color: 0x3f3a33, roughness: 0.75, metalness: 0.35 }));
  fence.frustumCulled = false;
  scene.add(fence);
}

/** A small emissive-only scene baked into the environment map, so paint and wet road pick up the city glow. */
export function createEnvironmentScene(look: EnvKind = 'night'): Scene {
  const colors = TUNING.world.colors;
  const env = new Scene();
  env.add(createSky(look, false));
  const strip = (color: number, intensity: number, width: number, height: number, position: Vector3): void => {
    const mesh = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: 2 }),
    );
    mesh.position.copy(position);
    mesh.lookAt(0, 0, 0);
    env.add(mesh);
  };
  if (look === 'night' || look === 'dusk') {
    const strength = look === 'night' ? 1 : 0.6;
    strip(colors.sodium, 3 * strength, 800, 90, new Vector3(0, 620, 900));
    strip(colors.sodium, 3 * strength, 800, 90, new Vector3(0, 620, -900));
    strip(0xf2a20c, 1.6 * strength, 700, 160, new Vector3(1200, 110, 0));
    strip(0xd8402b, 1.4 * strength, 700, 160, new Vector3(-1200, 110, 0));
  } else if (look === 'storm') {
    strip(colors.sodium, 0.8, 800, 90, new Vector3(0, 300, 900));
    strip(colors.sodium, 0.8, 800, 90, new Vector3(0, 300, -900));
  }
  return env;
}
