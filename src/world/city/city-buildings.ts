/**
 * Places buildings along the streets and fills the blocks behind them.
 * An occupancy grid keeps every building clear of roads, flyover and other buildings.
 * Geometry merges by map cell, so the camera frustum can cull whole blocks.
 */

import { GLOW_REGISTRY } from '../../render/atmosphere-uniforms';
import { applyBlackout } from '../../render/blackout';
import { BufferGeometry, Color, Mesh, MeshStandardMaterial, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CITY } from '../../config/city-tuning';
import { TUNING, type QualityPreset } from '../../config/tuning';
import { createRng } from '../../core/math';
import { createSample } from '../../core/polyline';
import type { PhysicsWorld } from '../../physics/physics-world';
import { enableReflection } from '../../render/planar-reflection';
import { buildingGeometry, createFacadeTextures, waterTankGeometry } from '../city-backdrop';
import { districtAt } from './city-map';
import type { RoadNetwork } from './road-network';

const FLOOR_HEIGHT = 3.3;

/** Warm, sun-faded paint for old town walls. */
const OLD_TINTS = [0xc8835a, 0xb9a06a, 0x8fa59a, 0xc47a7a, 0xa8b48a, 0xd0b48a, 0x8a9cb4, 0xb56a4a, 0x9c8fb0, 0xcfc4a4];
const MODERN_TINTS = [0x6a7078, 0x7c7468, 0x5a6670, 0x8a8478, 0x4f5a62, 0x6c6a72];

/** A rough top-down map of what is already taken. */
export class Occupancy {
  private readonly grid: Uint8Array;
  private readonly columns: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minZ: number;
  private readonly cell = CITY.buildings.occupancyCell;

  constructor(minX: number, maxX: number, minZ: number, maxZ: number) {
    this.minX = minX;
    this.minZ = minZ;
    this.columns = Math.ceil((maxX - minX) / this.cell);
    this.rows = Math.ceil((maxZ - minZ) / this.cell);
    this.grid = new Uint8Array(this.columns * this.rows);
  }

  private key(x: number, z: number): number {
    const column = Math.floor((x - this.minX) / this.cell);
    const row = Math.floor((z - this.minZ) / this.cell);
    if (column < 0 || row < 0 || column >= this.columns || row >= this.rows) return -1;
    return row * this.columns + column;
  }

  markCircle(x: number, z: number, radius: number): void {
    for (let dx = -radius; dx <= radius; dx += this.cell / 2) {
      for (let dz = -radius; dz <= radius; dz += this.cell / 2) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const key = this.key(x + dx, z + dz);
        if (key >= 0) this.grid[key] = 1;
      }
    }
  }

  private forRect(x: number, z: number, yaw: number, halfX: number, halfZ: number, visit: (key: number) => boolean): boolean {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const step = this.cell / 2;
    for (let a = -halfX; a <= halfX + 0.001; a += step) {
      for (let b = -halfZ; b <= halfZ + 0.001; b += step) {
        const key = this.key(x + a * cos + b * sin, z - a * sin + b * cos);
        if (key < 0) return false;
        if (!visit(key)) return false;
      }
    }
    return true;
  }

  isFree(x: number, z: number, yaw: number, halfX: number, halfZ: number): boolean {
    return this.forRect(x, z, yaw, halfX, halfZ, (key) => this.grid[key] === 0);
  }

  mark(x: number, z: number, yaw: number, halfX: number, halfZ: number): void {
    this.forRect(x, z, yaw, halfX, halfZ, (key) => {
      this.grid[key] = 1;
      return true;
    });
  }
}

/** Marks the ground under every road, with room for pavements. */
export function buildRoadOccupancy(network: RoadNetwork): Occupancy {
  const bounds = network.bounds;
  const padding = 90;
  const occupancy = new Occupancy(bounds.minX - padding, bounds.maxX + padding, bounds.minZ - padding, bounds.maxZ + padding);
  const sample = createSample();
  // Each margin stays under the setback used for buildings on that kind of road.
  const margins: Record<string, number> = { lane: 0.2, street: 1.4, avenue: 3.4, deck: 2.5, ramp: 2.5 };
  for (const edge of network.edges) {
    const radius = edge.spec.halfWidth + margins[edge.kind];
    for (let s = 0; s <= edge.full.length; s += 2) {
      edge.full.sample(s, sample);
      occupancy.markCircle(sample.x, sample.z, radius);
    }
  }
  for (const node of network.nodes) occupancy.markCircle(node.x, node.z, node.radius + 3);
  return occupancy;
}

/** A building's street face, so other systems can hang signs on it. */
export interface Frontage {
  x: number;
  z: number;
  /** Direction the wall faces, toward the road. */
  faceYaw: number;
  width: number;
  floors: number;
  oldTown: boolean;
}

export interface BuildingResult {
  frontages: Frontage[];
  count: number;
}

export function buildCityBuildings(
  scene: Scene,
  network: RoadNetwork,
  physics: PhysicsWorld,
  preset: QualityPreset,
  occupancy: Occupancy,
): BuildingResult {
  const config = CITY.buildings;
  const random = createRng(TUNING.world.seed + 40);
  const chunks = new Map<string, BufferGeometry[]>();
  const tint = new Color();
  const frontages: Frontage[] = [];
  let count = 0;

  const pushPart = (geometry: BufferGeometry, x: number, z: number): void => {
    const key = `${Math.floor(x / config.chunkSize)}:${Math.floor(z / config.chunkSize)}`;
    const list = chunks.get(key);
    if (list) list.push(geometry);
    else chunks.set(key, [geometry]);
  };

  /** Builds one box. Local +Z runs along the street, and width is measured along it. */
  const placeBuilding = (x: number, z: number, yaw: number, width: number, depth: number, floors: number, oldTown: boolean): void => {
    const height = floors * FLOOR_HEIGHT + (oldTown ? random() * 0.8 : 0);
    const palette = oldTown ? OLD_TINTS : MODERN_TINTS;
    tint.setHex(palette[Math.floor(random() * palette.length)]);
    const geometry = buildingGeometry(depth, height, width, tint, Math.floor(random() * 8) / 8, Math.floor(random() * 8) / 8);
    geometry.rotateY(yaw);
    geometry.translate(x, height / 2, z);
    pushPart(geometry, x, z);
    physics.addFixedCuboid(depth / 2, height / 2, width / 2, x, height / 2, z, 'road', yaw);
    occupancy.mark(x, z, yaw, depth / 2 + 0.4, width / 2 + 0.4);
    count++;

    if (oldTown || random() < 0.4) {
      const tanks = 1 + Math.floor(random() * 2);
      for (let t = 0; t < tanks; t++) {
        const a = (random() - 0.5) * Math.max(0.5, depth - 3);
        const b = (random() - 0.5) * Math.max(0.5, width - 3);
        pushPart(
          waterTankGeometry(x + a * Math.cos(yaw) + b * Math.sin(yaw), height, z - a * Math.sin(yaw) + b * Math.cos(yaw)),
          x,
          z,
        );
      }
    }
  };

  // Street frontage: buildings shoulder to shoulder along every ground road.
  const sample = createSample();
  for (const edge of network.edges) {
    if (edge.elevated) continue;
    const line = edge.center;
    for (const side of [1, -1]) {
      let s = 4 + random() * 4;
      while (s < line.length - 4) {
        line.sample(s, sample);
        const oldTown = districtAt(sample.x, sample.z) === 'puranTola';
        const style = oldTown ? config.oldTown : config.modern;
        const width = style.widthMin + random() * (style.widthMax - style.widthMin);
        const depth = style.depthMin + random() * (style.depthMax - style.depthMin);
        const skip = random() > preset.buildingDensity && !oldTown;
        line.sample(s + width / 2, sample);
        const offset = edge.spec.halfWidth + style.setback + (edge.kind === 'lane' ? 0 : 1.6) + depth / 2 + 0.6;
        const x = sample.x + sample.tz * offset * side;
        const z = sample.z - sample.tx * offset * side;
        const yaw = Math.atan2(sample.tx, sample.tz);
        if (!skip && occupancy.isFree(x, z, yaw, depth / 2, width / 2)) {
          const span = style.floorsMax - style.floorsMin;
          const floors = style.floorsMin + Math.floor(random() * random() * span);
          placeBuilding(x, z, yaw, width, depth, floors, oldTown);
          frontages.push({
            x: x - sample.tz * (depth / 2) * side,
            z: z + sample.tx * (depth / 2) * side,
            // The wall faces back toward the road.
            faceYaw: Math.atan2(-sample.tz * side, sample.tx * side),
            width,
            floors,
            oldTown,
          });
          s += width + style.gap;
        } else {
          s += 3;
        }
      }
    }
  }

  // Fill the blocks behind the frontage, so streets do not look onto empty ground.
  const bounds = network.bounds;
  const attempts = Math.round(config.fillAttempts * preset.buildingDensity);
  for (let i = 0; i < attempts; i++) {
    const x = bounds.minX - 60 + random() * (bounds.maxX - bounds.minX + 120);
    const z = bounds.minZ - 60 + random() * (bounds.maxZ - bounds.minZ + 120);
    const oldTown = districtAt(x, z) === 'puranTola';
    const style = oldTown ? config.oldTown : config.modern;
    const width = style.widthMin + random() * (style.widthMax - style.widthMin);
    const depth = style.depthMin + random() * (style.depthMax - style.depthMin);
    const yaw = oldTown ? random() * 0.6 - 0.3 + Math.PI * 0.25 : 0;
    if (!occupancy.isFree(x, z, yaw, depth / 2 + config.fillSpacing / 2, width / 2 + config.fillSpacing / 2)) continue;
    const span = style.floorsMax - style.floorsMin;
    placeBuilding(x, z, yaw, width, depth, style.floorsMin + Math.floor(random() * span), oldTown);
  }

  const textures = createFacadeTextures(preset.anisotropy);
  const material = new MeshStandardMaterial({
    map: textures.map,
    emissiveMap: textures.emissive,
    emissive: new Color(1, 1, 1),
    emissiveIntensity: 1.5,
    vertexColors: true,
    roughness: 0.88,
    metalness: 0,
  });
  applyBlackout(material);
  GLOW_REGISTRY.windows.push(material);
  for (const parts of chunks.values()) {
    const mesh = new Mesh(mergeGeometries(parts), material);
    mesh.castShadow = false;
    enableReflection(mesh);
    scene.add(mesh);
  }
  return { frontages, count };
}
