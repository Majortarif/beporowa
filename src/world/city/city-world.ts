/** Assembles the Phase 2 city: map, roads, buildings, props, sky and lights. */

import { BufferGeometry, Color, DirectionalLight, FogExp2, HemisphereLight, Mesh, MeshStandardMaterial, type Scene, type Vector3 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNING, type QualityPreset } from '../../config/tuning';
import { createRng } from '../../core/math';
import type { PhysicsWorld } from '../../physics/physics-world';
import { GLOW_REGISTRY } from '../../render/atmosphere-uniforms';
import { REFLECT_LAYER, enableReflection, type WetUniforms } from '../../render/planar-reflection';
import type { SpawnPose } from '../../vehicle/vehicle-controller';
import { buildingGeometry, createFacadeTextures, createSky } from '../city-backdrop';
import { SPAWN_EDGE } from './city-map';
import { buildCityBuildings, buildRoadOccupancy } from './city-buildings';
import { CityProps } from './city-props';
import { buildGarageHome, findGarageHome, type GarageHome } from './garage-building';
import { RiverDock, reserveDockGround } from './river-dock';
import { buildCityBoundary, buildCityRoads } from './city-roads';
import { buildGarages, layOutGarages, type GarageSpot } from './parking-garages';
import { createRoadHit, RoadNetwork } from './road-network';
import { layOutTraps, type Trap } from '../../traps/trap-system';

export class CityWorld {
  readonly network = new RoadNetwork();
  readonly props: CityProps;
  readonly sky: Mesh;
  readonly moon: DirectionalLight;
  readonly hemisphere: HemisphereLight;
  readonly buildingCount: number;
  readonly garages: GarageSpot[];
  /** ওস্তাদ's own workshop, where the garage screens happen. */
  readonly garageHome: GarageHome;
  readonly traps: Trap[];
  readonly dock: RiverDock;
  private readonly hit = createRoadHit();

  constructor(scene: Scene, physics: PhysicsWorld, preset: QualityPreset, wet: WetUniforms | null) {
    const world = TUNING.world;
    const colors = world.colors;

    scene.fog = new FogExp2(new Color(colors.fog).getHex(), world.fogDensity);
    this.sky = createSky('night', preset.skyDetail);
    scene.add(this.sky);

    this.hemisphere = new HemisphereLight(colors.hemisphereSky, colors.hemisphereGround, world.hemisphereIntensity);
    this.hemisphere.layers.enable(REFLECT_LAYER);
    scene.add(this.hemisphere);

    this.moon = new DirectionalLight(colors.moon, world.moonIntensity);
    this.moon.position.set(-60, 120, -40);
    this.moon.layers.enable(REFLECT_LAYER);
    if (preset.shadows) {
      this.moon.castShadow = true;
      this.moon.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      const camera = this.moon.shadow.camera;
      camera.left = -30;
      camera.right = 30;
      camera.top = 30;
      camera.bottom = -30;
      camera.near = 10;
      camera.far = 260;
      this.moon.shadow.bias = -0.0006;
    }
    scene.add(this.moon, this.moon.target);

    buildCityRoads(scene, this.network, physics, preset, wet);
    buildCityBoundary(scene, this.network, physics);
    const occupancy = buildRoadOccupancy(this.network);
    // These claim their ground first, so that no building stands in the way.
    reserveDockGround(occupancy);
    this.garageHome = findGarageHome(this.network, occupancy);
    buildGarageHome(scene, physics, this.garageHome, preset.anisotropy);
    this.garages = layOutGarages(this.network, occupancy);
    buildGarages(scene, physics, this.garages, preset.anisotropy);
    this.traps = layOutTraps(this.network, occupancy);
    const buildings = buildCityBuildings(scene, this.network, physics, preset, occupancy);
    this.buildingCount = buildings.count;
    this.props = new CityProps(scene, this.network, physics, preset, occupancy, buildings.frontages);
    this.dock = new RiverDock(scene, this.network, physics, preset);
    this.buildSkyline(scene, preset);
  }

  /** Big far-off blocks, so the city seems to go on past the edge of the map. */
  private buildSkyline(scene: Scene, preset: QualityPreset): void {
    const world = TUNING.world;
    const bounds = this.network.bounds;
    const random = createRng(world.seed + 60);
    const parts: BufferGeometry[] = [];
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    const reach = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ) / 2;
    const tint = new Color(0x3b3a3e);
    const count = Math.round(world.skylineCount * preset.buildingDensity);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + random() * 0.03;
      const radius = reach + 300 + random() * 500;
      const width = 40 + random() * 70;
      const depth = 40 + random() * 70;
      const height = 40 + random() * random() * 170;
      const geometry = buildingGeometry(width, height, depth, tint, random(), random(), 5);
      geometry.translate(centerX + Math.cos(angle) * radius, height / 2, centerZ + Math.sin(angle) * radius);
      parts.push(geometry);
    }
    const textures = createFacadeTextures(preset.anisotropy);
    const skylineMaterial = new MeshStandardMaterial({
      map: textures.map,
      emissiveMap: textures.emissive,
      emissive: new Color(1, 1, 1),
      emissiveIntensity: 1.5,
      vertexColors: true,
      roughness: 0.88,
    });
    GLOW_REGISTRY.windows.push(skylineMaterial);
    const skyline = new Mesh(mergeGeometries(parts), skylineMaterial);
    skyline.frustumCulled = false;
    enableReflection(skyline);
    scene.add(skyline);
  }

  /** Where a drive begins: on the bazaar road, facing the monument. */
  spawnPose(): SpawnPose {
    const network = this.network;
    const a = network.nodeIndex(SPAWN_EDGE.a);
    const b = network.nodeIndex(SPAWN_EDGE.b);
    const edge = network.edgeBetween(a, b);
    if (!edge) throw new Error('Spawn road is missing');
    // Lanes run in both directions; take the one heading toward the monument.
    const laneId = edge.lanes.find((id) => network.lanes[id].node === a) ?? edge.lanes[0];
    const line = network.lanes[laneId].line;
    const s = line.length * SPAWN_EDGE.fractionFromB;
    const point = { x: 0, y: 0, z: 0, tx: 0, tz: 1 };
    line.sample(s, point);
    return { position: { x: point.x, y: point.y + 0.8, z: point.z }, yaw: Math.atan2(point.tx, point.tz) };
  }

  /** The nearest road point, at about the car's height, facing along the car's way. */
  resetPose(x: number, y: number, z: number, headingX: number, headingZ: number): SpawnPose {
    const hit = this.network.nearestRoad(x, z, y, this.hit);
    const forward = hit.tx * headingX + hit.tz * headingZ >= 0 ? 1 : -1;
    return {
      position: { x: hit.x, y: hit.y + 0.8, z: hit.z },
      yaw: Math.atan2(hit.tx * forward, hit.tz * forward),
    };
  }

  update(dt: number, carPosition: Vector3, cameraPosition: Vector3): void {
    this.sky.position.copy(cameraPosition);
    this.props.update(dt, carPosition);
    this.dock.update(dt);
  }
}

