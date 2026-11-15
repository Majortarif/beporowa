/**
 * Draws the road network and builds its colliders. Ground-level streets all lie on one flat
 * floor collider; only the flyover and ramps need their own surfaces.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { RoadKind } from '../../config/city-tuning';
import type { QualityPreset } from '../../config/tuning';
import { createSample } from '../../core/polyline';
import type { PhysicsWorld } from '../../physics/physics-world';
import { GLOW_REGISTRY } from '../../render/atmosphere-uniforms';
import { makeWet, type WetUniforms } from '../../render/planar-reflection';
import { ModelBuilder, useBakedGlow } from '../../render/model-builder';
import { BARRIER_TOP, computeElevatedGeometry, type ElevatedGeometry } from './elevated-geometry';
import { RIVER_Z } from './city-map';
import { CITY_ROAD_TILE, createCityRoadTexture, createCityRoughnessTexture, createFloorTexture, createJunctionTexture } from './road-paint';
import type { RoadEdge, RoadNetwork } from './road-network';

/** Layers on the flat floor, kept just under the physics surface at y = 0. */
const FLOOR_Y = -0.03;
const ROAD_Y = -0.015;
const JUNCTION_Y = -0.008;
const ZEBRA_Y = -0.003;
const ROAD_KINDS: readonly RoadKind[] = ['lane', 'street', 'avenue', 'deck', 'ramp'];

function ribbonGeometry(edges: readonly RoadEdge[], groundY: number | null): BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const edge of edges) {
    vertexCount += edge.center.count * 2;
    indexCount += (edge.center.count - 1) * 6;
  }
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices = new Uint32Array(indexCount);
  const sample = createSample();
  let vertex = 0;
  let index = 0;
  for (const edge of edges) {
    const line = edge.center;
    const half = edge.spec.halfWidth;
    for (let i = 0; i < line.count; i++) {
      const s = i * line.spacing;
      line.sample(s, sample);
      const y = groundY ?? sample.y;
      positions.set(
        [
          sample.x + sample.tz * half, y, sample.z - sample.tx * half,
          sample.x - sample.tz * half, y, sample.z + sample.tx * half,
        ],
        vertex * 3,
      );
      const v = s / CITY_ROAD_TILE;
      uvs.set([0, v, 1, v], vertex * 2);
      if (i < line.count - 1) {
        indices.set([vertex, vertex + 1, vertex + 2, vertex + 1, vertex + 3, vertex + 2], index);
        index += 6;
      }
      vertex += 2;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function roadMaterial(kind: RoadKind, preset: QualityPreset, roughness: ReturnType<typeof createCityRoughnessTexture>, wet: WetUniforms | null, layer: number): MeshStandardMaterial {
  const material = new MeshStandardMaterial({
    map: createCityRoadTexture(kind, preset.anisotropy),
    roughnessMap: roughness,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 1.1,
    polygonOffset: true,
    polygonOffsetFactor: -layer,
    polygonOffsetUnits: -layer,
  });
  makeWet(material, wet);
  return material;
}

/** Girders under the deck, painted barriers on it, and pillars below it. */
function buildFlyoverStructure(scene: Scene, network: RoadNetwork, elevated: ElevatedGeometry, physics: PhysicsWorld): void {
  const sample = createSample();
  const girderDepth = 1.25;

  // Side and bottom faces of the deck, following each elevated road.
  const girderPositions: number[] = [];
  const girderIndices: number[] = [];
  for (const edge of network.edges) {
    if (!edge.elevated) continue;
    const line = edge.center;
    const half = edge.spec.halfWidth;
    const base = girderPositions.length / 3;
    for (let i = 0; i < line.count; i++) {
      line.sample(i * line.spacing, sample);
      const lx = sample.x + sample.tz * half;
      const lz = sample.z - sample.tx * half;
      const rx = sample.x - sample.tz * half;
      const rz = sample.z + sample.tx * half;
      const lower = Math.max(0, sample.y - girderDepth);
      girderPositions.push(lx, sample.y, lz, lx, lower, lz, rx, lower, rz, rx, sample.y, rz);
    }
    for (let i = 0; i < line.count - 1; i++) {
      const a = base + i * 4;
      const b = a + 4;
      girderIndices.push(a, b, a + 1, a + 1, b, b + 1);
      girderIndices.push(a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
      girderIndices.push(a + 2, b + 2, a + 3, a + 3, b + 2, b + 3);
    }
  }
  const girderGeometry = new BufferGeometry();
  girderGeometry.setAttribute('position', new BufferAttribute(new Float32Array(girderPositions), 3));
  girderGeometry.setIndex(girderIndices);
  girderGeometry.computeVertexNormals();
  const concrete = new MeshStandardMaterial({ color: 0x6d6a64, roughness: 0.92, side: 2 });
  const girders = new Mesh(girderGeometry, concrete);
  girders.frustumCulled = false;
  scene.add(girders);

  // Junction undersides and the visible barriers.
  const structure = new ModelBuilder();
  for (const node of network.nodes) {
    if (!node.elevated) continue;
    structure.add(new CircleGeometry(node.radius, 20), 0x5c5953, node.x, node.y - girderDepth, node.z, { rotX: Math.PI / 2 });
  }
  elevated.barriers.forEach((barrier, index) => {
    const height = BARRIER_TOP;
    const stripe = index % 2 === 0 ? 0x8b8780 : 0xd9b23a;
    structure.box(0.45, height, barrier.halfLength * 2, barrier.x, barrier.roadY + height / 2, barrier.z, stripe, { rotY: barrier.yaw });
    // Where the road is low the barrier continues down as a plain wall.
    const below = barrier.roadY - Math.max(0, barrier.y - barrier.halfHeight);
    if (below > 0.05) {
      structure.box(0.42, below, barrier.halfLength * 2, barrier.x, barrier.roadY - below / 2, barrier.z, 0x56534d, { rotY: barrier.yaw });
    }
    physics.addFixedCuboid(0.3, barrier.halfHeight, barrier.halfLength, barrier.x, barrier.y, barrier.z, 'road', barrier.yaw);
  });
  for (const pillar of elevated.pillars) {
    const height = pillar.topY - girderDepth;
    structure.box(1.5, height, 2.3, pillar.x, height / 2, pillar.z, 0x77736c, { rotY: pillar.yaw });
    structure.box(9, 0.9, 2.3, pillar.x, height - 0.45, pillar.z, 0x6c6962, { rotY: pillar.yaw });
    physics.addFixedCuboid(0.8, height / 2, 1.2, pillar.x, height / 2, pillar.z, 'road', pillar.yaw);
  }
  const mesh = new Mesh(structure.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })));
  mesh.frustumCulled = false;
  scene.add(mesh);
}

/** Painted crossings at signalled junctions. */
function buildCrossings(scene: Scene, network: RoadNetwork): void {
  const parts: BufferGeometry[] = [];
  const stripeWidth = 0.55;
  const stripeLength = 3.2;
  for (const node of network.nodes) {
    if (!node.signalized) continue;
    for (const leg of node.legs) {
      const edge = network.edges[leg.edge];
      const half = edge.spec.halfWidth - 0.6;
      const distance = node.radius + stripeLength / 2 + 0.6;
      const cx = node.x + leg.awayX * distance;
      const cz = node.z + leg.awayZ * distance;
      const yaw = Math.atan2(leg.awayX, leg.awayZ);
      for (let across = -half; across <= half; across += stripeWidth * 2) {
        const stripe = new PlaneGeometry(stripeWidth, stripeLength);
        stripe.rotateX(-Math.PI / 2);
        stripe.translate(across, 0, 0);
        stripe.rotateY(yaw);
        stripe.translate(cx, ZEBRA_Y, cz);
        parts.push(stripe);
      }
    }
  }
  if (parts.length === 0) return;
  const crossings = new Mesh(
    mergeGeometries(parts),
    new MeshStandardMaterial({ color: 0xbfb9a8, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
  );
  crossings.frustumCulled = false;
  scene.add(crossings);
}

export function buildCityRoads(
  scene: Scene,
  network: RoadNetwork,
  physics: PhysicsWorld,
  preset: QualityPreset,
  wet: WetUniforms | null,
): void {
  const bounds = network.bounds;
  const padding = 620;
  const width = bounds.maxX - bounds.minX + padding * 2;
  const depth = bounds.maxZ - bounds.minZ + padding * 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minZ + bounds.maxZ) / 2;

  // The floor everything stands on. Its top is y = 0 for the wheels.
  physics.addFixedCuboid(width / 2, 2, depth / 2, centerX, -2, centerZ, 'road');
  const floorTexture = createFloorTexture(preset.anisotropy);
  floorTexture.wrapS = RepeatWrapping;
  floorTexture.wrapT = RepeatWrapping;
  floorTexture.repeat.set(width / 16, depth / 16);
  const floor = new Mesh(new PlaneGeometry(width, depth), new MeshStandardMaterial({ map: floorTexture, roughness: 0.93, metalness: 0 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(centerX, FLOOR_Y, centerZ);
  floor.receiveShadow = preset.shadows;
  scene.add(floor);
  const floorMaterial = floor.material as MeshStandardMaterial;
  GLOW_REGISTRY.ground.push({ get roughness() { return floorMaterial.roughness; }, set roughness(value: number) { floorMaterial.roughness = value; }, color: floorMaterial.color, base: floorMaterial.color.clone(), baseRoughness: floorMaterial.roughness });

  const roughness = createCityRoughnessTexture(preset.anisotropy);

  // One mesh per road kind, because each has its own lane paint.
  for (const kind of ROAD_KINDS) {
    const edges = network.edges.filter((edge) => edge.kind === kind);
    if (edges.length === 0) continue;
    const elevated = kind === 'deck' || kind === 'ramp';
    const mesh = new Mesh(ribbonGeometry(edges, elevated ? null : ROAD_Y), roadMaterial(kind, preset, roughness, wet, 2));
    mesh.frustumCulled = false;
    mesh.receiveShadow = preset.shadows;
    scene.add(mesh);
  }

  // Junction discs share one material.
  const junctionMaterial = new MeshStandardMaterial({
    map: createJunctionTexture(preset.anisotropy),
    roughnessMap: roughness,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 1.1,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });
  makeWet(junctionMaterial, wet);
  const discs: BufferGeometry[] = [];
  for (const node of network.nodes) {
    const disc = new CircleGeometry(node.radius, node.roundabout ? 48 : 28);
    disc.rotateX(-Math.PI / 2);
    disc.translate(node.x, node.elevated ? node.y + 0.004 : JUNCTION_Y, node.z);
    const position = disc.getAttribute('position');
    const uv = disc.getAttribute('uv');
    for (let i = 0; i < position.count; i++) {
      uv.setXY(i, position.getX(i) / 12, position.getZ(i) / CITY_ROAD_TILE);
    }
    discs.push(disc);
  }
  const junctions = new Mesh(mergeGeometries(discs), junctionMaterial);
  junctions.frustumCulled = false;
  junctions.receiveShadow = preset.shadows;
  scene.add(junctions);

  // Elevated surfaces need real colliders.
  const elevated = computeElevatedGeometry(network);
  for (const surface of elevated.surfaces) physics.addFixedTrimesh(surface.positions, surface.indices, 'road');
  buildFlyoverStructure(scene, network, elevated, physics);
  buildCrossings(scene, network);
}

/** A plain tin fence around the map, so the boundary is something you can see. */
export function buildCityBoundary(scene: Scene, network: RoadNetwork, physics: PhysicsWorld): void {
  const bounds = network.bounds;
  const padding = 110;
  const minX = bounds.minX - padding;
  const maxX = bounds.maxX + padding;
  const minZ = bounds.minZ - padding;
  // The city stops at the river. There is a quay wall there, so the fence stops too.
  const maxZ = RIVER_Z;
  const fenceHeight = 6;
  const parts: BufferGeometry[] = [];
  const addWall = (x: number, z: number, halfX: number, halfZ: number): void => {
    const wall = new BoxGeometry(halfX * 2, fenceHeight, halfZ * 2);
    wall.translate(x, fenceHeight / 2, z);
    parts.push(wall);
    physics.addFixedCuboid(halfX, 12, halfZ, x, 12, z, 'road');
  };
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const lengthX = maxX - minX;
  const lengthZ = maxZ - minZ;
  addWall(centerX, minZ, lengthX / 2, 0.4);
  physics.addFixedCuboid(lengthX / 2, 12, 0.4, centerX, 12, maxZ, 'road');
  addWall(minX, centerZ, 0.4, lengthZ / 2);
  addWall(maxX, centerZ, 0.4, lengthZ / 2);
  const fence = new Mesh(mergeGeometries(parts), new MeshStandardMaterial({ color: 0x3f3a33, roughness: 0.75, metalness: 0.35 }));
  fence.frustumCulled = false;
  scene.add(fence);
}

