/** Lamp posts, painted Bangla signs and the start gate placed along the track. */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Vector3,
  type Scene,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { TUNING, type QualityPreset } from '../config/tuning';
import type { PhysicsWorld } from '../physics/physics-world';
import { enableReflection } from '../render/planar-reflection';
import { LampField, type LampSpec } from './lamp-field';
import { buildSignAtlas, type SignRect } from './sign-atlas';
import { SIGN_KEYS } from './sign-keys';
import type { TrackPath } from './track-path';

export class StreetProps {
  private readonly lamps: LampField;

  constructor(scene: Scene, track: TrackPath, physics: PhysicsWorld, preset: QualityPreset) {
    this.lamps = this.buildLamps(scene, track, physics, preset);
    this.buildSigns(scene, track, physics, preset);
  }

  private buildLamps(scene: Scene, track: TrackPath, physics: PhysicsWorld, preset: QualityPreset): LampField {
    const world = TUNING.world;
    const everySamples = Math.max(1, Math.round(world.lampSpacing / track.spacing));
    const count = Math.floor(track.count / everySamples);
    const halfRoad = world.roadHalfWidth;
    const lamps: LampSpec[] = [];

    for (let n = 0; n < count; n++) {
      const i = n * everySamples;
      const side = n % 2 === 0 ? 1 : -1;
      const sx = track.sides[i * 3] * side;
      const sz = track.sides[i * 3 + 2] * side;
      const roadY = track.y(i);
      const drop = roadY - world.groundY;
      const shoulder = world.shoulderBaseWidth + drop * world.shoulderPerHeight;
      const outOnShoulder = (world.lampOffset - halfRoad) / shoulder;
      lamps.push({
        x: track.x(i) + sx * world.lampOffset,
        y: roadY - drop * outOnShoulder,
        z: track.z(i) + sz * world.lampOffset,
        // Arms reach over the road.
        armX: -sx,
        armZ: -sz,
        height: world.lampHeight,
        roadY,
        poolYaw: track.yaw(i),
        solid: true,
      });
    }
    return new LampField(scene, physics, preset, lamps);
  }

  private buildSigns(scene: Scene, track: TrackPath, physics: PhysicsWorld, preset: QualityPreset): void {
    const world = TUNING.world;
    const atlas = buildSignAtlas(preset.anisotropy);
    const everySamples = Math.round(world.signSpacing / track.spacing);
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    const frames: BufferGeometry[] = [];
    const corner = new Vector3();
    const right = new Vector3();
    const center = new Vector3();

    const addPanel = (rect: SignRect, panelCenter: Vector3, faceYaw: number, width: number, height: number): void => {
      right.set(Math.cos(faceYaw), 0, -Math.sin(faceYaw));
      const base = positions.length / 3;
      for (const [cx, cy, u, v] of [
        [-1, -1, rect.u0, rect.v0],
        [1, -1, rect.u1, rect.v0],
        [1, 1, rect.u1, rect.v1],
        [-1, 1, rect.u0, rect.v1],
      ] as const) {
        corner.copy(panelCenter).addScaledVector(right, (cx * width) / 2);
        corner.y += (cy * height) / 2;
        positions.push(corner.x, corner.y, corner.z);
        uvs.push(u, v);
      }
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };

    const addFrame = (x: number, z: number, topY: number, groundY: number, faceYaw: number, width: number, height: number): void => {
      const backing = new BoxGeometry(width + 0.3, height + 0.3, 0.2);
      backing.rotateY(faceYaw);
      backing.translate(x - Math.sin(faceYaw) * 0.14, topY - height / 2, z - Math.cos(faceYaw) * 0.14);
      frames.push(backing.toNonIndexed());
      for (const offset of [-width * 0.36, width * 0.36]) {
        const postHeight = topY - height / 2 - groundY;
        const post = new BoxGeometry(0.28, postHeight, 0.28);
        const postX = x + Math.cos(faceYaw) * offset;
        const postZ = z - Math.sin(faceYaw) * offset;
        post.translate(postX, groundY + postHeight / 2, postZ);
        frames.push(post.toNonIndexed());
        physics.addFixedCuboid(0.18, postHeight / 2, 0.18, postX, groundY + postHeight / 2, postZ);
      }
    };

    // Roadside signs, angled toward the driver.
    let signIndex = 1;
    for (let i = everySamples; i < track.count - everySamples / 2; i += everySamples) {
      const side = signIndex % 2 === 0 ? 1 : -1;
      const sx = track.sides[i * 3] * side;
      const sz = track.sides[i * 3 + 2] * side;
      const drop = track.y(i) - world.groundY;
      const offset = Math.max(world.signOffset, world.roadHalfWidth + world.shoulderBaseWidth + drop * world.shoulderPerHeight + 1);
      const x = track.x(i) + sx * offset;
      const z = track.z(i) + sz * offset;
      const faceYaw = track.yaw(i) + Math.PI + side * -0.32;
      const key = SIGN_KEYS[1 + (signIndex % (SIGN_KEYS.length - 1))];
      const width = 11;
      const height = 2.75;
      const topY = world.groundY + 8.6;
      center.set(x, topY - height / 2, z);
      addFrame(x, z, topY, world.groundY, faceYaw, width, height);
      const rect = atlas.rects.get(key);
      if (rect) addPanel(rect, center, faceYaw, width, height);
      signIndex++;
    }

    // Start gate over the road.
    const start = 0;
    const gateYaw = track.yaw(start) + Math.PI;
    const gateX = track.x(start);
    const gateZ = track.z(start);
    const gateWidth = 15;
    const gateHeight = 3.1;
    const gateTop = track.y(start) + 8.2;
    center.set(gateX, gateTop - gateHeight / 2, gateZ);
    const gateRect = atlas.rects.get('sign.track');
    if (gateRect) addPanel(gateRect, center, gateYaw, gateWidth, gateHeight);
    const gateBacking = new BoxGeometry(gateWidth + 0.4, gateHeight + 0.4, 0.3);
    gateBacking.rotateY(gateYaw);
    gateBacking.translate(gateX - Math.sin(gateYaw) * 0.2, gateTop - gateHeight / 2, gateZ - Math.cos(gateYaw) * 0.2);
    frames.push(gateBacking.toNonIndexed());
    const postOffset = world.roadHalfWidth + 1.6;
    for (const direction of [1, -1]) {
      const postX = gateX + track.sides[start * 3] * postOffset * direction;
      const postZ = gateZ + track.sides[start * 3 + 2] * postOffset * direction;
      const postHeight = gateTop - gateHeight / 2 - world.groundY;
      const post = new BoxGeometry(0.42, postHeight, 0.42);
      post.translate(postX, world.groundY + postHeight / 2, postZ);
      frames.push(post.toNonIndexed());
      physics.addFixedCuboid(0.26, postHeight / 2, 0.26, postX, world.groundY + postHeight / 2, postZ);
    }

    const panelGeometry = new BufferGeometry();
    panelGeometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    panelGeometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    panelGeometry.setIndex(indices);
    // Painted boards under their own small floodlight read as self-lit.
    const panels = new Mesh(
      panelGeometry,
      new MeshBasicMaterial({ map: atlas.texture, color: new Color(1.5, 1.45, 1.35) }),
    );
    panels.frustumCulled = false;
    enableReflection(panels);

    const frameMesh = new Mesh(
      mergeGeometries(frames),
      new MeshStandardMaterial({ color: 0x17181a, roughness: 0.7, metalness: 0.3 }),
    );
    frameMesh.frustumCulled = false;
    scene.add(panels, frameMesh);
  }

  update(carPosition: Vector3): void {
    this.lamps.update(carPosition);
  }
}
