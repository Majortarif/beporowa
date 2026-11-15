/** Draws traffic with one instanced mesh per vehicle model, and the traffic lights. */

import {
  Color,
  CylinderGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Scene,
} from 'three';
import type { QualityPreset } from '../config/tuning';
import { ModelBuilder, useBakedGlow } from '../render/model-builder';
import { enableReflection } from '../render/planar-reflection';
import type { RoadNetwork } from '../world/city/road-network';
import type { SignalState } from './signal-controller';
import { ART, buildBike, buildBus, buildCar, buildCng, buildPickup, buildRickshaw, createTrafficAtlas } from './traffic-models';
import { TRAFFIC_TYPES, type TrafficSystem } from './traffic-system';

const scratchColor = new Color();
const scratchMatrix = new Matrix4();
const scratchQuaternion = new Quaternion();
const scratchPosition = new Vector3();
const UNIT = new Vector3(1, 1, 1);

interface Batch {
  mesh: InstancedMesh;
  count: number;
}

export class TrafficRender {
  /** During a replay, positions come from the film and not from any live crash debris. */
  replaying = false;
  /** Index by traffic type, then by variant. */
  private readonly batches: Batch[][] = [];

  constructor(scene: Scene, private readonly traffic: TrafficSystem, preset: QualityPreset) {
    const atlas = createTrafficAtlas(preset.anisotropy);
    const material = useBakedGlow(new MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.58, metalness: 0.08 }));

    const models: Record<(typeof TRAFFIC_TYPES)[number], BufferGeometry[]> = {
      rickshaw: [buildRickshaw(ART.panelBoat), buildRickshaw(ART.panelFlowers), buildRickshaw(ART.panelCinema), buildRickshaw(ART.panelTiger)],
      cng: [buildCng()],
      bike: [buildBike()],
      car: [buildCar()],
      pickup: [buildPickup()],
      bus: [buildBus(ART.busSideA), buildBus(ART.busSideB)],
    };
    for (const type of TRAFFIC_TYPES) {
      const variants = models[type].map((geometry) => {
        const mesh = new InstancedMesh(geometry, material, traffic.capacity);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(traffic.capacity * 3), 3);
        if (preset.trafficReflections) enableReflection(mesh);
        scene.add(mesh);
        return { mesh, count: 0 };
      });
      this.batches.push(variants);
    }
  }

  /**
   * @param back how far behind the latest physics state the frame is, in seconds,
   * so traffic stays in step with the interpolated player car
   */
  update(back: number): void {
    const traffic = this.traffic;
    for (const variants of this.batches) for (const batch of variants) batch.count = 0;

    for (let agent = 0; agent < traffic.capacity; agent++) {
      if (!traffic.alive[agent]) continue;
      const variants = this.batches[traffic.type[agent]];
      const batch = variants[traffic.variant[agent] % variants.length];
      const index = batch.count++;
      const matrices = batch.mesh.instanceMatrix.array as Float32Array;
      const body = this.replaying ? null : traffic.knockedBody(agent);
      if (body) {
        const t = body.translation();
        const r = body.rotation();
        scratchPosition.set(t.x, t.y, t.z);
        scratchQuaternion.set(r.x, r.y, r.z, r.w);
        scratchMatrix.compose(scratchPosition, scratchQuaternion, UNIT);
        scratchMatrix.toArray(matrices, index * 16);
      } else {
        const yaw = traffic.yaw[agent];
        const c = Math.cos(yaw);
        const s = Math.sin(yaw);
        const distance = traffic.v[agent] * back;
        const base = index * 16;
        matrices[base] = c;
        matrices[base + 1] = 0;
        matrices[base + 2] = -s;
        matrices[base + 3] = 0;
        matrices[base + 4] = 0;
        matrices[base + 5] = 1;
        matrices[base + 6] = 0;
        matrices[base + 7] = 0;
        matrices[base + 8] = s;
        matrices[base + 9] = 0;
        matrices[base + 10] = c;
        matrices[base + 11] = 0;
        matrices[base + 12] = traffic.x[agent] - traffic.tx[agent] * distance;
        matrices[base + 13] = traffic.y[agent];
        matrices[base + 14] = traffic.z[agent] - traffic.tz[agent] * distance;
        matrices[base + 15] = 1;
      }
      scratchColor.setHex(traffic.tint[agent]);
      const colors = batch.mesh.instanceColor?.array as Float32Array;
      colors[index * 3] = scratchColor.r;
      colors[index * 3 + 1] = scratchColor.g;
      colors[index * 3 + 2] = scratchColor.b;
    }

    for (const variants of this.batches) {
      for (const batch of variants) {
        batch.mesh.count = batch.count;
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}

const LAMP_RED = new Color(5, 0.28, 0.14);
const LAMP_AMBER = new Color(5, 2.6, 0.3);
const LAMP_GREEN = new Color(0.3, 4.4, 1.5);
const LAMP_OFF = new Color(0.05, 0.04, 0.03);

interface SignalHead {
  node: number;
  group: number;
  lamps: number;
  state: SignalState | null;
}

/** Poles and three-lamp heads at signalled junctions. Lamps change colour only when the phase does. */
export class TrafficLightsRender {
  private readonly lamps: InstancedMesh;
  private readonly heads: SignalHead[] = [];

  constructor(scene: Scene, private readonly network: RoadNetwork, private readonly traffic: TrafficSystem) {
    const builder = new ModelBuilder();
    const matrix = new Matrix4();
    const position = new Vector3();
    const lampPositions: Vector3[] = [];
    const up = 4.3;

    for (const node of network.nodes) {
      if (!node.signalized) continue;
      for (const leg of node.legs) {
        const edge = network.edges[leg.edge];
        // Traffic approaches against the leg's away direction and drives on its own left.
        const approachX = -leg.awayX;
        const approachZ = -leg.awayZ;
        const leftX = approachZ;
        const leftZ = -approachX;
        const out = node.radius + 1;
        const x = node.x + leg.awayX * out + leftX * (edge.spec.halfWidth + 0.8);
        const z = node.z + leg.awayZ * out + leftZ * (edge.spec.halfWidth + 0.8);
        builder.add(new CylinderGeometry(0.08, 0.1, up, 6), 0x1e2023, x, up / 2, z);
        const faceYaw = Math.atan2(leg.awayX, leg.awayZ);
        builder.box(0.42, 1.16, 0.2, x, up + 0.45, z, 0x101112, { rotY: faceYaw });
        this.heads.push({ node: node.index, group: leg.signalGroup, lamps: lampPositions.length, state: null });
        for (let i = 0; i < 3; i++) {
          lampPositions.push(new Vector3(x + leg.awayX * 0.12, up + 0.82 - i * 0.37, z + leg.awayZ * 0.12));
        }
      }
    }

    if (!builder.isEmpty) {
      const poles = new Mesh(builder.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 })));
      poles.frustumCulled = false;
      scene.add(poles);
    }

    this.lamps = new InstancedMesh(new SphereGeometry(0.15, 8, 6), new MeshBasicMaterial({ toneMapped: false }), Math.max(1, lampPositions.length));
    lampPositions.forEach((lamp, index) => {
      position.copy(lamp);
      matrix.compose(position, scratchQuaternion.identity(), UNIT);
      this.lamps.setMatrixAt(index, matrix);
      this.lamps.setColorAt(index, LAMP_OFF);
    });
    this.lamps.count = lampPositions.length;
    this.lamps.frustumCulled = false;
    enableReflection(this.lamps);
    scene.add(this.lamps);
  }

  update(): void {
    let changed = false;
    for (const head of this.heads) {
      const state = this.traffic.signals.stateFor(this.network.nodes[head.node], head.group);
      if (state === head.state) continue;
      head.state = state;
      changed = true;
      this.lamps.setColorAt(head.lamps, state === 'red' ? LAMP_RED : LAMP_OFF);
      this.lamps.setColorAt(head.lamps + 1, state === 'amber' ? LAMP_AMBER : LAMP_OFF);
      this.lamps.setColorAt(head.lamps + 2, state === 'green' ? LAMP_GREEN : LAMP_OFF);
    }
    if (changed && this.lamps.instanceColor) this.lamps.instanceColor.needsUpdate = true;
  }
}
