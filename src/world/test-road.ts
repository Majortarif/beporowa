/** Assembles the Phase 1 test road: track, road, signs, lamps, city backdrop, lights. */

import { Color, DirectionalLight, FogExp2, HemisphereLight, Scene, type Mesh, type Vector3 } from 'three';
import { TUNING, type QualityPreset } from '../config/tuning';
import type { PhysicsWorld } from '../physics/physics-world';
import { REFLECT_LAYER, type WetUniforms } from '../render/planar-reflection';
import type { SpawnPose } from '../vehicle/vehicle-controller';
import { createBuildings, createGround, createSky } from './city-backdrop';
import { buildRoad } from './road-mesh';
import { StreetProps } from './street-props';
import { TrackPath } from './track-path';

export class TestRoad {
  readonly track: TrackPath;
  readonly sky: Mesh;
  readonly moon: DirectionalLight;
  readonly spawnIndex: number;
  private readonly street: StreetProps;

  constructor(scene: Scene, physics: PhysicsWorld, preset: QualityPreset, wetUniforms: WetUniforms | null) {
    const world = TUNING.world;
    const colors = world.colors;
    this.track = new TrackPath(world.sampleSpacing);

    scene.fog = new FogExp2(new Color(colors.fog).getHex(), world.fogDensity);
    this.sky = createSky();
    scene.add(this.sky);

    const hemisphere = new HemisphereLight(colors.hemisphereSky, colors.hemisphereGround, world.hemisphereIntensity);
    hemisphere.layers.enable(REFLECT_LAYER);
    scene.add(hemisphere);

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

    const road = buildRoad(this.track, physics, preset, wetUniforms);
    scene.add(road.road, road.shoulders);
    createGround(scene, this.track, physics, preset, road.dirtTexture, wetUniforms, road.roadMaterial);
    createBuildings(scene, this.track, physics, preset);
    this.street = new StreetProps(scene, this.track, physics, preset);

    this.spawnIndex = this.track.wrap(-Math.round(world.spawnBehindStartLine / this.track.spacing));
  }

  /** Pose on the road at a track sample, a little above the ground so it can settle. */
  poseAt(index: number): SpawnPose {
    return {
      position: { x: this.track.x(index), y: this.track.y(index) + 0.8, z: this.track.z(index) },
      yaw: this.track.yaw(index),
    };
  }

  /** Per-frame world updates that follow the car and camera. */
  update(carPosition: Vector3, cameraPosition: Vector3): void {
    this.sky.position.copy(cameraPosition);
    this.street.update(carPosition);
    // The shadow frustum follows the car, so one small map stays sharp.
    this.moon.target.position.copy(carPosition);
    this.moon.position.set(carPosition.x - 60, carPosition.y + 120, carPosition.z - 40);
  }
}
