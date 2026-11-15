/**
 * কাজলঘাট: the river port. Container stacks, gantry cranes, moored launches and country boats,
 * with the কাজলগঙ্গা behind them. All built from code, and every solid thing has a collider.
 */

import { ATMOS } from '../../render/atmosphere-uniforms';
import {
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import { TUNING, type QualityPreset } from '../../config/tuning';
import { createRng } from '../../core/math';
import { worldText } from '../../i18n';
import type { PhysicsWorld } from '../../physics/physics-world';
import { ModelBuilder, useBakedGlow, useSelfLitGlow } from '../../render/model-builder';
import { FONT_DISPLAY, PAINT, drawFlower, makeCanvas, paintGrain, toTexture } from '../../render/painted-textures';
import { enableReflection } from '../../render/planar-reflection';
import { DOCK_AREA, RIVER_Z } from './city-map';
import type { Occupancy } from './city-buildings';
import { createRoadHit, type RoadNetwork } from './road-network';

const CONTAINER_LENGTH = 12;
const CONTAINER_WIDTH = 2.5;
const CONTAINER_HEIGHT = 2.6;
const CONTAINER_TINTS = [0xb5472a, 0x1f6f78, 0x2f5f8a, 0xd9a312, 0x6a7a2f, 0x8a3a3a, 0x3a3f46];

const matrix = new Matrix4();
const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3(1, 1, 1);
const up = new Vector3(0, 1, 0);

/** Reserves the port's ground, so that no building goes up on it. */
export function reserveDockGround(occupancy: Occupancy): void {
  const area = DOCK_AREA;
  occupancy.mark((area.minX + area.maxX) / 2, (area.minZ + area.maxZ) / 2, 0, (area.maxX - area.minX) / 2, (area.maxZ - area.minZ) / 2);
}

function containerGeometry(): BufferGeometry {
  // Ribbed sides, so a stack does not look like plain boxes.
  const builder = new ModelBuilder();
  builder.box(CONTAINER_WIDTH, CONTAINER_HEIGHT, CONTAINER_LENGTH, 0, CONTAINER_HEIGHT / 2, 0, 0xffffff);
  for (let i = -5; i <= 5; i++) {
    builder.box(CONTAINER_WIDTH + 0.08, CONTAINER_HEIGHT - 0.3, 0.16, 0, CONTAINER_HEIGHT / 2, i * 1.08, 0xdddddd);
  }
  builder.box(CONTAINER_WIDTH + 0.05, CONTAINER_HEIGHT + 0.05, 0.1, 0, CONTAINER_HEIGHT / 2, CONTAINER_LENGTH / 2, 0x999999);
  return builder.build();
}

function buildCrane(builder: ModelBuilder, physics: PhysicsWorld, x: number, z: number, random: () => number): void {
  const yellow = 0xd9a312;
  const dark = 0x2a2d33;
  const span = 16;
  const height = 24;
  const legs = [[-span / 2, -5], [span / 2, -5], [-span / 2, 5], [span / 2, 5]] as const;
  for (const [a, b] of legs) {
    builder.box(0.9, height, 0.9, x + a, height / 2, z + b, yellow);
    physics.addFixedCuboid(0.5, height / 2, 0.5, x + a, height / 2, z + b, 'road');
  }
  // Bracing between the legs.
  for (const side of [-1, 1]) {
    builder.box(span, 0.6, 0.6, x, height * 0.45, z + side * 5, yellow);
    builder.box(0.6, 0.6, 10, x + side * (span / 2), height * 0.7, z, yellow);
  }
  // The boom reaches out over the water.
  builder.box(2.2, 1.4, 62, x, height + 1, z + 12, yellow);
  builder.box(span + 1.4, 2.2, 3, x, height, z, dark);
  builder.box(4, 3.4, 4, x, height + 3.2, z - 8, 0x3c5f6e);
  builder.box(3.6, 0.9, 3.7, x, height + 3.6, z - 8, 0x241a10, { glow: [1.9, 1.5, 0.8] });
  // Hanging spreader, somewhere along the boom, with a load on some.
  const along = z + 10 + random() * 26;
  builder.box(0.14, height - 9, 0.14, x - 0.7, (height + 9) / 2, along, dark);
  builder.box(0.14, height - 9, 0.14, x + 0.7, (height + 9) / 2, along, dark);
  builder.box(3, 0.4, 13, x, 8.8, along, yellow);
  if (random() < 0.7) builder.box(CONTAINER_WIDTH, CONTAINER_HEIGHT, CONTAINER_LENGTH, x, 7.2, along, CONTAINER_TINTS[Math.floor(random() * CONTAINER_TINTS.length)]);
  // Warning lamps along the top.
  for (const offset of [-12, 8, 28, 42]) {
    builder.box(0.3, 0.3, 0.3, x, height + 2, z + offset, 0xff3020, { glow: [5, 0.5, 0.25] });
  }
}

/** A three-deck river launch with a painted band, in the style of the ones on the southern routes. */
function launchGeometry(): BufferGeometry {
  const b = new ModelBuilder();
  const white = 0xe9e4d8;
  const length = 46;
  const beam = 9;
  // Hull, tapered at the bow by stepped boxes.
  b.box(beam, 3.4, length - 10, 0, 1.7, 0, 0x7a1d1d);
  b.box(beam * 0.74, 3.4, 5, 0, 1.7, length / 2 - 7.5, 0x7a1d1d);
  b.box(beam * 0.42, 3.4, 5, 0, 1.7, length / 2 - 2.5, 0x7a1d1d);
  b.box(beam + 0.1, 0.5, length - 10, 0, 3.2, 0, 0xefe3c8);
  // Decks, with lit windows along each side.
  for (let deck = 0; deck < 3; deck++) {
    const y = 4 + deck * 2.7;
    const deckLength = length - 12 - deck * 6;
    b.box(beam - 0.8 - deck * 0.4, 2.5, deckLength, 0, y + 1.1, -deck * 1.5, white);
    b.box(beam - 0.2 - deck * 0.4, 0.2, deckLength + 1, 0, y + 2.4, -deck * 1.5, deck === 1 ? 0xd8402b : 0x0f7f7a);
    for (const side of [-1, 1]) {
      for (let i = -6; i <= 6; i++) {
        const z = -deck * 1.5 + i * 2.6;
        if (Math.abs(z + deck * 1.5) > deckLength / 2 - 1) continue;
        const lit = (i * 7 + deck * 3 + side) % 5 !== 0;
        const x = side * ((beam - 0.8 - deck * 0.4) / 2 + 0.03);
        b.box(0.06, 1.1, 1.6, x, y + 1.2, z, 0x241a10, lit ? { glow: [2.2, 1.7, 0.85] } : undefined);
      }
    }
  }
  // Wheelhouse and funnel.
  b.box(5, 2.2, 5, 0, 13, 8, 0x3c5f6e);
  b.box(5.1, 1, 5.1, 0, 13.3, 8, 0x241a10, { glow: [2.4, 2, 1.2] });
  b.add(new CylinderGeometry(0.8, 0.9, 4.5, 10), 0x1b1410, 0, 13, -3);
  b.box(0.3, 0.3, 0.3, 0, 15.2, 8, 0xff3020, { glow: [5, 0.4, 0.2] });
  return b.build();
}

/** A wooden country boat with a curved roof. */
function boatGeometry(): BufferGeometry {
  const b = new ModelBuilder();
  b.box(1.9, 0.7, 7, 0, 0.3, 0, 0x4a3524);
  b.box(1.2, 0.7, 2, 0, 0.5, 4, 0x4a3524);
  b.box(1.2, 0.7, 2, 0, 0.5, -4, 0x4a3524);
  b.add(new CylinderGeometry(1, 1, 3.4, 8, 1, false, 0, Math.PI), 0x8a6a3a, 0, 0.8, -0.4, { rotX: Math.PI / 2 });
  b.box(0.1, 0.1, 0.1, 0, 1.9, 1.5, 0xffc060, { glow: [2.5, 1.6, 0.6] });
  return b.build();
}

function signTexture(anisotropy: number): ReturnType<typeof toTexture> {
  const { canvas, ctx } = makeCanvas(1024, 256);
  ctx.fillStyle = PAINT.teal;
  ctx.fillRect(0, 0, 1024, 256);
  paintGrain(ctx, 1024, 256, 77, 0.16);
  ctx.strokeStyle = PAINT.marigold;
  ctx.lineWidth = 12;
  ctx.strokeRect(10, 10, 1004, 236);
  drawFlower(ctx, 90, 128, 58, PAINT.tomato, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, 934, 128, 58, PAINT.tomato, PAINT.marigold, PAINT.tin);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `130px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAINT.soot;
  ctx.fillText(worldText('sign.dock'), 517, 139, 700);
  ctx.fillStyle = PAINT.tin;
  ctx.fillText(worldText('sign.dock'), 512, 134, 700);
  return toTexture(canvas, anisotropy);
}

const WATER_VERTEX = /* glsl */ `
  varying vec3 vWorld;
  varying float vDistance;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vec4 view = viewMatrix * world;
    vDistance = length(view.xyz);
    gl_Position = projectionMatrix * view;
  }`;

const WATER_FRAGMENT = /* glsl */ `
  uniform float uTime;
  uniform vec3 uFog;
  uniform float uFogDensity;
  uniform float uAmbient;
  uniform vec3 uAmbientColor;
  uniform float uRain;
  varying vec3 vWorld;
  varying float vDistance;
  float ripple(vec2 p) {
    return sin(p.x * 0.31 + uTime * 0.9) * 0.5
      + sin(p.y * 0.47 - uTime * 0.7 + p.x * 0.11) * 0.35
      + sin((p.x + p.y) * 0.83 + uTime * 1.6) * 0.15;
  }
  void main() {
    float a = ripple(vWorld.xz);
    float b = ripple(vWorld.xz * 2.3 + 17.0);
    // Neon from the bank falls across the water in long, broken streaks.
    float streak = pow(0.5 + 0.5 * sin(vWorld.x * 0.13 + a * 0.8), 14.0);
    float fromBank = exp(-(vWorld.z - ${RIVER_Z.toFixed(1)}) * 0.012);
    vec3 warm = vec3(0.9, 0.42, 0.12) * streak * fromBank * (0.5 + 0.5 * b);
    float moon = pow(max(0.0, 0.5 + 0.5 * (a * 0.6 + b * 0.4)), 7.0);
    vec3 daylit = uAmbientColor * (uAmbient - 0.72) * vec3(0.05, 0.12, 0.14);
    vec3 color = vec3(0.012, 0.045, 0.06) + daylit + (vec3(0.05, 0.09, 0.12) + daylit) * moon + warm * 0.55 * clamp(1.8 - uAmbient, 0.0, 1.0);
    // Rain breaks the surface up into a thousand small points of light.
    color += vec3(0.08, 0.1, 0.12) * uRain * pow(max(0.0, sin(vWorld.x * 7.3 + uTime * 11.0) * sin(vWorld.z * 6.1 - uTime * 9.0)), 12.0);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDistance * vDistance);
    gl_FragColor = vec4(mix(color, uFog, fog), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class RiverDock {
  private readonly water: ShaderMaterial;
  private readonly launches: InstancedMesh;
  private readonly boats: InstancedMesh;
  private readonly launchPoses: { x: number; z: number; yaw: number; speed: number }[] = [];
  private readonly boatPoses: { x: number; z: number; yaw: number; phase: number }[] = [];
  private time = 0;

  constructor(scene: Scene, network: RoadNetwork, physics: PhysicsWorld, preset: QualityPreset) {
    const random = createRng(TUNING.world.seed + 80);
    const builder = new ModelBuilder();
    const area = DOCK_AREA;

    this.placeContainers(scene, network, physics, random);

    // The quay: a low wall along the whole bank, with bollards on the port's stretch.
    const quayLength = 3400;
    builder.box(quayLength, 1, 1.2, 0, 0.5, RIVER_Z - 0.4, 0x56544f);
    builder.box(quayLength, 0.14, 1.5, 0, 1.06, RIVER_Z - 0.4, 0xd9a312);
    for (let x = area.minX; x < area.maxX; x += 18) {
      builder.add(new CylinderGeometry(0.28, 0.36, 1, 8), 0x20242a, x, 0.5, RIVER_Z - 1.6);
    }
    // Concrete apron between the road and the water.
    builder.box(area.maxX - area.minX, 0.04, 58, (area.minX + area.maxX) / 2, 0.02, RIVER_Z - 29, 0x3a3a38);

    for (const x of [-620, -420, -220]) buildCrane(builder, physics, x, RIVER_Z - 16, random);

    // A barge tied up at the quay, with containers on it.
    for (let i = 0; i < 2; i++) {
      const bargeX = -520 + i * 220;
      builder.box(60, 2.6, 16, bargeX, 0.8, RIVER_Z + 14, 0x33363a);
      for (let c = 0; c < 4; c++) {
        builder.box(CONTAINER_LENGTH, CONTAINER_HEIGHT, CONTAINER_WIDTH, bargeX - 20 + c * 13, 3.4, RIVER_Z + 10, CONTAINER_TINTS[(c + i * 3) % CONTAINER_TINTS.length]);
        if (c % 2 === 0) builder.box(CONTAINER_LENGTH, CONTAINER_HEIGHT, CONTAINER_WIDTH, bargeX - 20 + c * 13, 3.4, RIVER_Z + 16, CONTAINER_TINTS[(c + i * 2 + 1) % CONTAINER_TINTS.length]);
      }
    }

    const dockMesh = new Mesh(builder.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.12 })));
    dockMesh.frustumCulled = false;
    scene.add(dockMesh);

    // The painted sign over the yard's road.
    const sign = new ModelBuilder();
    sign.box(0.5, 8, 0.5, -412, 4, 640, 0x2a2d33);
    sign.box(0.5, 8, 0.5, -360, 4, 640, 0x2a2d33);
    const signBoard = new ModelBuilder();
    signBoard.panel(50, 12.5, -386, 13, 640.3, 0xffffff, { uv: [0, 0, 1, 1], glow: [1, 1, 1] });
    signBoard.panel(50, 12.5, -386, 13, 639.7, 0xffffff, { rotY: Math.PI, uv: [0, 0, 1, 1], glow: [1, 1, 1] });
    const supports = new Mesh(sign.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
    supports.frustumCulled = false;
    scene.add(supports);
    const board = new Mesh(signBoard.build(), useSelfLitGlow(new MeshStandardMaterial({ map: signTexture(preset.anisotropy), vertexColors: true, roughness: 0.7 })));
    board.frustumCulled = false;
    enableReflection(board);
    scene.add(board);

    // The river itself.
    this.water = new ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFog: ATMOS.uFogColor,
        uFogDensity: ATMOS.uFogDensity,
        uAmbient: ATMOS.uAmbient,
        uAmbientColor: ATMOS.uAmbientColor,
        uRain: ATMOS.uRain,
      },
      vertexShader: WATER_VERTEX,
      fragmentShader: WATER_FRAGMENT,
    });
    const water = new Mesh(new PlaneGeometry(9000, 3000), this.water);
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, 0.08, RIVER_Z + 1500);
    water.frustumCulled = false;
    scene.add(water);

    const hullMaterial = useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.05 }));
    this.launchPoses.push(
      { x: -760, z: RIVER_Z + 62, yaw: Math.PI / 2, speed: 0 },
      { x: -180, z: RIVER_Z + 58, yaw: Math.PI / 2, speed: 0 },
      { x: 600, z: RIVER_Z + 150, yaw: -Math.PI / 2, speed: -3.2 },
      { x: -1200, z: RIVER_Z + 220, yaw: Math.PI / 2, speed: 2.6 },
    );
    this.launches = new InstancedMesh(launchGeometry(), hullMaterial, this.launchPoses.length);
    this.launches.frustumCulled = false;
    scene.add(this.launches);

    for (let i = 0; i < 9; i++) {
      this.boatPoses.push({
        x: area.minX - 80 + random() * 900,
        z: RIVER_Z + 30 + random() * 90,
        yaw: random() * Math.PI * 2,
        phase: random() * 6,
      });
    }
    this.boats = new InstancedMesh(boatGeometry(), hullMaterial, this.boatPoses.length);
    this.boats.frustumCulled = false;
    scene.add(this.boats);
    this.update(0);
  }

  private placeContainers(scene: Scene, network: RoadNetwork, physics: PhysicsWorld, random: () => number): void {
    const hit = createRoadHit();
    const area = DOCK_AREA;
    const places: { x: number; z: number; yaw: number; level: number; tint: number }[] = [];
    // Rows of stacks, with aisles between them, kept well off the roads.
    const clear = (x: number, z: number): boolean => {
      const road = network.nearestRoad(x, z, 0, hit);
      return road.distance - network.edges[road.edge].spec.halfWidth > 11;
    };
    for (let x = area.minX + 26; x < area.maxX - 12; x += 17) {
      for (let z = area.minZ + 18; z < RIVER_Z - 8; z += 20) {
        if (!clear(x, z) || random() < 0.2) continue;
        // Keep the crane legs and the quay edge free.
        if (z > RIVER_Z - 34) continue;
        const stack = 1 + Math.floor(random() * random() * 4);
        for (let level = 0; level < stack; level++) {
          places.push({ x, z, yaw: 0, level, tint: CONTAINER_TINTS[Math.floor(random() * CONTAINER_TINTS.length)] });
        }
        physics.addFixedCuboid(CONTAINER_WIDTH / 2, (stack * CONTAINER_HEIGHT) / 2, CONTAINER_LENGTH / 2, x, (stack * CONTAINER_HEIGHT) / 2, z, 'road');
      }
    }
    const mesh = new InstancedMesh(containerGeometry(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.25 })), Math.max(1, places.length));
    mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(Math.max(1, places.length) * 3), 3);
    const color = new Color();
    places.forEach((place, index) => {
      position.set(place.x, place.level * CONTAINER_HEIGHT, place.z);
      matrix.compose(position, quaternion.identity(), scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.setHex(place.tint));
    });
    mesh.frustumCulled = false;
    scene.add(mesh);
  }

  update(dt: number): void {
    this.time += dt;
    this.water.uniforms.uTime.value = this.time;
    this.launchPoses.forEach((launch, index) => {
      launch.x += launch.speed * dt;
      if (launch.x > 1500) launch.x = -1500;
      if (launch.x < -1500) launch.x = 1500;
      position.set(launch.x, Math.sin(this.time * 0.5 + index) * 0.1, launch.z);
      quaternion.setFromAxisAngle(up, launch.yaw);
      matrix.compose(position, quaternion, scale);
      this.launches.setMatrixAt(index, matrix);
    });
    this.launches.instanceMatrix.needsUpdate = true;
    this.boatPoses.forEach((boat, index) => {
      position.set(boat.x, 0.1 + Math.sin(this.time * 0.8 + boat.phase) * 0.08, boat.z);
      quaternion.setFromAxisAngle(up, boat.yaw + Math.sin(this.time * 0.2 + boat.phase) * 0.08);
      matrix.compose(position, quaternion, scale);
      this.boats.setMatrixAt(index, matrix);
    });
    this.boats.instanceMatrix.needsUpdate = true;
  }
}
