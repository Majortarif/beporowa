/**
 * What makes the two districts feel like Dhaka: tangled cables, hanging Bangla boards, tea stalls,
 * spice and fabric stalls, the monument, the toll plaza, billboards, lamps and barricades.
 */

import {
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  ShaderMaterial,
  SphereGeometry,
  type Scene,
  type Vector3,
} from 'three';
import { CITY } from '../../config/city-tuning';
import { TUNING, type QualityPreset } from '../../config/tuning';
import { createRng } from '../../core/math';
import { createSample } from '../../core/polyline';
import type { PhysicsWorld } from '../../physics/physics-world';
import { enableReflection } from '../../render/planar-reflection';
import { ModelBuilder, useBakedGlow } from '../../render/model-builder';
import { LampField, type LampSpec } from '../lamp-field';
import { buildSignAtlas, type SignRect } from '../sign-atlas';
import { SIGN_KEYS } from '../sign-keys';
import { TOLL_X, TOLL_Z, districtAt } from './city-map';
import type { Frontage, Occupancy } from './city-buildings';
import { QuadBatch } from './quad-batch';
import type { RoadNetwork } from './road-network';
import { buildShopAtlas } from './shop-atlas';

export interface StallSpot {
  x: number;
  y: number;
  z: number;
  /** Direction the stall faces. */
  faceYaw: number;
  isTea: boolean;
}

export class CityProps {
  readonly stalls: StallSpot[] = [];
  /** Pedestrians stand around these. */
  readonly gatherings: StallSpot[] = [];
  readonly lamps: LampField;
  private readonly cableMaterial: ShaderMaterial | null;
  private time = 0;

  constructor(
    scene: Scene,
    network: RoadNetwork,
    physics: PhysicsWorld,
    preset: QualityPreset,
    occupancy: Occupancy,
    frontages: readonly Frontage[],
  ) {
    this.lamps = new LampField(scene, physics, preset, this.layOutLamps(network));
    this.cableMaterial = this.buildCables(scene, network);

    const builder = new ModelBuilder();
    const shops = buildShopAtlas(preset.anisotropy);
    const shopBoards = new QuadBatch();
    this.buildShopBoards(frontages, shops.rects, builder, shopBoards);
    this.buildStalls(network, physics, builder, shopBoards, shops.rectByKey);
    this.buildMonument(network, physics, builder);
    this.buildBarricades(network, physics, builder);
    this.buildTollPlaza(physics, builder);

    const boardsMesh = shopBoards.build(shops.texture, 1.25);
    enableReflection(boardsMesh);
    scene.add(boardsMesh);

    const atlas = buildSignAtlas(preset.anisotropy);
    const billboards = new QuadBatch();
    this.buildBillboards(network, physics, occupancy, builder, billboards, atlas.rects);
    this.buildClosedSigns(network, billboards, atlas.rects);
    this.buildTollSign(billboards, atlas.rects);
    const billboardMesh = billboards.build(atlas.texture, 1.5);
    enableReflection(billboardMesh);
    scene.add(billboardMesh);

    const props = new Mesh(builder.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 })));
    props.frustumCulled = false;
    scene.add(props);
  }

  private layOutLamps(network: RoadNetwork): LampSpec[] {
    const config = CITY.props;
    const lamps: LampSpec[] = [];
    const sample = createSample();
    for (const edge of network.edges) {
      const line = edge.center;
      const elevated = edge.elevated;
      const spacing = elevated ? config.deckLampSpacing : edge.kind === 'lane' ? config.laneLampSpacing : config.avenueLampSpacing;
      const baseHeight = edge.kind === 'lane' ? 6.2 : 8.4;
      let side = edge.index % 2 === 0 ? 1 : -1;
      for (let s = spacing / 2; s < line.length; s += spacing) {
        line.sample(s, sample);
        if (elevated && sample.y < 1) continue;
        const offset = edge.spec.halfWidth + (elevated ? 0.3 : edge.kind === 'lane' ? 0.25 : 1.2);
        const x = sample.x + sample.tz * offset * side;
        const z = sample.z - sample.tx * offset * side;
        // Lamps on a road under the flyover must fit below its girders.
        const underDeck = !elevated && this.isUnderDeck(network, x, z);
        lamps.push({
          x,
          y: elevated ? sample.y : 0,
          z,
          armX: -sample.tz * side,
          armZ: sample.tx * side,
          height: underDeck ? config.lampHeightUnderDeck : baseHeight,
          roadY: elevated ? sample.y : 0,
          poolYaw: Math.atan2(sample.tx, sample.tz),
          solid: !elevated,
        });
        side = -side;
      }
    }
    return lamps;
  }

  private isUnderDeck(network: RoadNetwork, x: number, z: number): boolean {
    const hit = network.nearestRoad(x, z, CITY.network.deckHeight);
    return network.edges[hit.edge].elevated && hit.distance < network.edges[hit.edge].spec.halfWidth + 3;
  }

  /** Tangled wires over the old town, sagging between poles, with a slow sway in the shader. */
  private buildCables(scene: Scene, network: RoadNetwork): ShaderMaterial | null {
    const config = CITY.props;
    const random = createRng(TUNING.world.seed + 50);
    const positions: number[] = [];
    const sways: number[] = [];
    const poles = new ModelBuilder();
    const sample = createSample();

    const addWire = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, sag: number): void => {
      const segments = 8;
      let px = ax;
      let py = ay;
      let pz = az;
      let pSway = 0;
      for (let i = 1; i <= segments; i++) {
        const t = i / segments;
        const droop = 4 * t * (1 - t);
        const x = ax + (bx - ax) * t;
        const y = ay + (by - ay) * t - sag * droop;
        const z = az + (bz - az) * t;
        positions.push(px, py, pz, x, y, z);
        sways.push(pSway, droop);
        px = x;
        py = y;
        pz = z;
        pSway = droop;
      }
    };

    for (const edge of network.edges) {
      if (edge.kind !== 'lane' && !(edge.kind === 'street' && districtAt(edge.center.points[0], edge.center.points[2]) === 'puranTola')) continue;
      const line = edge.center;
      const offset = edge.spec.halfWidth + 0.15;
      let previous: [number, number][] | null = null;
      for (let s = 6; s < line.length - 4; s += config.cablePoleSpacing) {
        line.sample(s, sample);
        const left: [number, number] = [sample.x + sample.tz * offset, sample.z - sample.tx * offset];
        const right: [number, number] = [sample.x - sample.tz * offset, sample.z + sample.tx * offset];
        const height = 6.6 + random() * 1.2;
        poles.cylinderY(0.1, height, left[0], height / 2, left[1], 0x2a2622, 5);
        poles.cylinderY(0.1, height, right[0], height / 2, right[1], 0x2a2622, 5);
        if (previous) {
          const wires = 3 + Math.floor(random() * 5);
          for (let w = 0; w < wires; w++) {
            const fromSide = previous[random() < 0.5 ? 0 : 1];
            const toSide = random() < 0.5 ? left : right;
            addWire(
              fromSide[0], height - random() * 1.4, fromSide[1],
              toSide[0], height - random() * 1.4, toSide[1],
              0.45 + random() * 0.9,
            );
          }
        }
        // A few wires also hop straight across the lane.
        addWire(left[0], height - 0.6, left[1], right[0], height - 0.9, right[1], 0.5);
        previous = [left, right];
      }
    }
    if (positions.length === 0) return null;

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute('aSway', new BufferAttribute(new Float32Array(sways), 1));
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute float aSway;
        uniform float uTime;
        varying float vDistance;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 1.1 + position.z * 0.3) * aSway * 0.07;
          p.z += cos(uTime * 0.9 + position.x * 0.3) * aSway * 0.07;
          vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
          vDistance = length(viewPosition.xyz);
          gl_Position = projectionMatrix * viewPosition;
        }`,
      fragmentShader: /* glsl */ `
        varying float vDistance;
        void main() {
          gl_FragColor = vec4(0.03, 0.025, 0.02, 1.0 - smoothstep(120.0, 240.0, vDistance));
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    const cables = new LineSegments(geometry, material);
    cables.frustumCulled = false;
    scene.add(cables);

    const poleMesh = new Mesh(poles.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })));
    poleMesh.frustumCulled = false;
    scene.add(poleMesh);
    return material;
  }

  /** Painted boards on old-town walls, and small ones that hang out over the lane. */
  private buildShopBoards(
    frontages: readonly Frontage[],
    rects: ReadonlyArray<SignRect>,
    builder: ModelBuilder,
    boards: QuadBatch,
  ): void {
    const random = createRng(TUNING.world.seed + 51);
    for (const front of frontages) {
      if (!front.oldTown || random() > CITY.props.shopSignChance) continue;
      const rect = rects[Math.floor(random() * rects.length)];
      const faceX = Math.sin(front.faceYaw);
      const faceZ = Math.cos(front.faceYaw);
      const width = Math.min(front.width * 0.84, 7);
      const height = width / 4;
      const y = 3 + random() * 0.5;
      // Flat on the wall, just proud of it.
      boards.addUpright(rect, front.x + faceX * 0.07, y, front.z + faceZ * 0.07, front.faceYaw, width, height);

      // Lit shopfront under the board.
      const shutterWidth = width * 0.9;
      const lit = random() < 0.68;
      builder.box(shutterWidth, 2.4, 0.1, front.x + faceX * 0.03, 1.2, front.z + faceZ * 0.03, lit ? 0x2c2218 : 0x56504a, {
        rotY: front.faceYaw,
        glow: lit ? [1.1, 0.72, 0.34] : undefined,
      });

      // Every other shop also hangs a small board out over the road, readable along the lane.
      if (random() < 0.55) {
        const hang = 1.1;
        const alongX = Math.cos(front.faceYaw);
        const alongZ = -Math.sin(front.faceYaw);
        const offsetAlong = (random() - 0.5) * width * 0.7;
        const x = front.x + faceX * (hang + 0.1) + alongX * offsetAlong;
        const z = front.z + faceZ * (hang + 0.1) + alongZ * offsetAlong;
        const hangRect = rects[Math.floor(random() * rects.length)];
        const hangWidth = 2.3;
        const hangHeight = hangWidth / 4;
        const hangY = 4.2 + random() * 1.3;
        boards.addUpright(hangRect, x, hangY, z, front.faceYaw + Math.PI / 2, hangWidth, hangHeight);
        boards.addUpright(hangRect, x, hangY, z, front.faceYaw - Math.PI / 2, hangWidth, hangHeight);
        builder.box(0.05, 0.05, hang * 2, x - faceX * 0.1, hangY + hangHeight / 2 + 0.03, z - faceZ * 0.1, 0x1a1612, { rotY: front.faceYaw });
      }
    }
  }

  private buildStalls(
    network: RoadNetwork,
    physics: PhysicsWorld,
    builder: ModelBuilder,
    boards: QuadBatch,
    shops: ReadonlyMap<string, SignRect>,
  ): void {
    const config = CITY.props;
    const random = createRng(TUNING.world.seed + 52);
    const sample = createSample();
    const canopies = [0xd8402b, 0x0f7f7a, 0xf2a20c, 0x1d2a5b, 0xc2185b];
    const spices = [0xc8501e, 0xe0a81c, 0x7a3f1a, 0xb02a1a, 0x8a9a2a];
    const fabrics = [0xc2185b, 0x0f7f7a, 0xf2a20c, 0x5fa52f, 0xd8402b, 0x3a4a9b];

    for (const edge of network.edges) {
      if (edge.elevated || districtAt(edge.center.points[0], edge.center.points[2]) !== 'puranTola') continue;
      if (edge.kind === 'lane' && random() > 0.8) continue;
      const line = edge.center;
      for (let s = 12 + random() * 10; s < line.length - 10; s += config.stallSpacing * (0.7 + random() * 0.8)) {
        if (random() > config.stallChance) continue;
        const side = random() < 0.5 ? 1 : -1;
        line.sample(s, sample);
        const offset = edge.spec.halfWidth + (edge.kind === 'lane' ? 0.1 : 1.1);
        const x = sample.x + sample.tz * offset * side;
        const z = sample.z - sample.tx * offset * side;
        const faceYaw = Math.atan2(-sample.tz * side, sample.tx * side);
        const kindRoll = random();
        const isTea = kindRoll < 0.4;
        const faceX = Math.sin(faceYaw);
        const faceZ = Math.cos(faceYaw);
        const alongX = Math.cos(faceYaw);
        const alongZ = -Math.sin(faceYaw);
        const at = (front: number, along: number): [number, number] => [
          x + faceX * front + alongX * along,
          z + faceZ * front + alongZ * along,
        ];

        // Table and canopy on four posts.
        builder.box(2.6, 0.85, 1, x, 0.43, z, 0x4a3524, { rotY: faceYaw });
        for (const [front, along] of [[0.45, 1.25], [0.45, -1.25], [-0.45, 1.25], [-0.45, -1.25]] as const) {
          const [px, pz] = at(front, along);
          builder.box(0.07, 2.4, 0.07, px, 1.2, pz, 0x2a2018);
        }
        builder.box(3, 0.09, 1.7, x, 2.44, z, canopies[Math.floor(random() * canopies.length)], { rotY: faceYaw, rotX: 0 });
        const [bulbX, bulbZ] = at(0.25, 0);
        builder.add(new SphereGeometry(0.1, 6, 5), 0xffffff, bulbX, 2.2, bulbZ, { glow: [5, 3.4, 1.6] });
        physics.addFixedCuboid(0.55, 0.6, 1.35, x, 0.6, z, 'road', faceYaw + Math.PI / 2);

        if (isTea) {
          // Kettle and glasses, plus a bench where the adda happens.
          const [kx, kz] = at(0.1, -0.7);
          builder.add(new CylinderGeometry(0.2, 0.26, 0.42, 8), 0xc9c4b2, kx, 1.06, kz);
          const [gx, gz] = at(0.15, 0.4);
          for (let g = 0; g < 5; g++) builder.cylinderY(0.04, 0.1, gx + g * 0.11 * alongX, 0.92, gz + g * 0.11 * alongZ, 0xe8e0c8, 6);
          const [bx, bz] = at(1.5, 0);
          builder.box(2, 0.45, 0.4, bx, 0.23, bz, 0x5a3e24, { rotY: faceYaw });
          this.stalls.push({ x: kx, y: 1.3, z: kz, faceYaw, isTea: true });
          const tea = shops.get('sign.shop.tea');
          if (tea) boards.addUpright(tea, x + faceX * 0.86, 2.68, z + faceZ * 0.86, faceYaw, 2.4, 0.6);
        } else if (kindRoll < 0.7) {
          // Spice mounds.
          for (let m = 0; m < 5; m++) {
            const [mx, mz] = at(0.1, -1 + m * 0.5);
            builder.cone(0.2, 0.26, mx, 1, mz, spices[m % spices.length], 7);
          }
        } else {
          // Fabric hung from the canopy.
          for (let f = 0; f < 6; f++) {
            const [fx, fz] = at(0.55, -1.2 + f * 0.48);
            builder.box(0.42, 1.25, 0.03, fx, 1.72, fz, fabrics[Math.floor(random() * fabrics.length)], { rotY: faceYaw });
          }
        }
        // People gather on the road side of the stall.
        const [gatherX, gatherZ] = at(1.7, 0);
        this.gatherings.push({ x: gatherX, y: 0, z: gatherZ, faceYaw: faceYaw + Math.PI, isTea });
      }
    }
  }

  /** ময়ূরপঙ্খী চত্বর: a peacock-prowed boat raised on a pedestal, ringed with light. */
  private buildMonument(network: RoadNetwork, physics: PhysicsWorld, builder: ModelBuilder): void {
    const node = network.nodes.find((candidate) => candidate.roundabout);
    if (!node) return;
    const island = CITY.network.roundaboutIslandRadius;
    builder.add(new CylinderGeometry(island, island + 0.5, 0.6, 32), 0x6a6358, node.x, 0.3, node.z);
    builder.add(new CylinderGeometry(island - 1, island - 1, 0.2, 32), 0x3f6a34, node.x, 0.68, node.z);
    builder.add(new CylinderGeometry(island + 0.1, island + 0.1, 0.1, 32, 1, true), 0xffffff, node.x, 0.62, node.z, { glow: [3.2, 1.9, 0.5] });
    builder.add(new CylinderGeometry(3.2, 4.6, 5, 8), 0x8a8074, node.x, 3.2, node.z);

    const hullY = 6.8;
    const hullColor = 0xd8402b;
    // Hull as a chain of tapering boxes.
    for (let i = -5; i <= 5; i++) {
      const fraction = Math.abs(i) / 5;
      const width = 2.7 * (1 - fraction * fraction * 0.75);
      const rise = fraction * fraction * 1.3;
      builder.box(width, 1 + rise * 0.3, 1.25, node.x, hullY + rise, node.z + i * 1.05, i % 2 === 0 ? hullColor : 0xf2a20c);
    }
    // Peacock prow: a curved neck, a head, and a fan of tail plumes at the stern.
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      builder.box(0.55 - t * 0.2, 0.75, 0.6, node.x, hullY + 1.5 + t * 3.2, node.z + 5.6 + Math.sin(t * 1.6) * 1.1, 0x0f7f7a);
    }
    builder.add(new SphereGeometry(0.46, 8, 6), 0x0f7f7a, node.x, hullY + 5, node.z + 6.7);
    builder.cone(0.16, 0.7, node.x, hullY + 5, node.z + 7.3, 0xf2a20c, 6, { rotX: Math.PI / 2 });
    for (let i = -4; i <= 4; i++) {
      const angle = (i / 4) * 0.85;
      builder.box(0.24, 3.4, 0.14, node.x + Math.sin(angle) * 1.7, hullY + 2.5 + Math.cos(angle) * 1.2, node.z - 5.8, i % 2 === 0 ? 0x0f7f7a : 0x5fa52f, {
        rotZ: -angle,
        glow: i === 0 ? [0.4, 0.8, 0.5] : undefined,
      });
    }
    // Floodlights at the foot of the pedestal.
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      builder.box(0.5, 0.25, 0.5, node.x + Math.cos(angle) * 5.6, 0.95, node.z + Math.sin(angle) * 5.6, 0xffffff, { glow: [5, 3.6, 1.8] });
    }
    physics.addFixedCuboid(island * 0.72, 3, island * 0.72, node.x, 3, node.z, 'road', Math.PI / 4);
    physics.addFixedCuboid(island * 0.72, 3, island * 0.72, node.x, 3, node.z, 'road', 0);
  }

  /** Painted barriers on roads that lead to districts not built yet. */
  private buildBarricades(network: RoadNetwork, physics: PhysicsWorld, builder: ModelBuilder): void {
    for (const node of network.nodes) {
      if (!node.closedSign || node.legs.length === 0) continue;
      const leg = node.legs[0];
      const half = network.edges[leg.edge].spec.halfWidth + 1.4;
      const acrossX = -leg.awayZ;
      const acrossZ = leg.awayX;
      const yaw = Math.atan2(acrossX, acrossZ);
      builder.box(0.5, 1.1, half * 2, node.x, 0.55, node.z, 0xd9b23a, { rotY: yaw });
      for (let i = -3; i <= 3; i++) {
        const x = node.x + acrossX * (i / 3) * (half - 0.4);
        const z = node.z + acrossZ * (i / 3) * (half - 0.4);
        builder.box(0.54, 0.34, 0.5, x, 0.55, z, 0x141210, { rotY: yaw });
        if (i % 3 === 0) builder.add(new SphereGeometry(0.14, 6, 5), 0xffffff, x, 1.26, z, { glow: [5, 2.2, 0.2] });
      }
      physics.addFixedCuboid(0.4, 0.8, half, node.x, 0.8, node.z, 'road', yaw);
    }
  }

  private buildClosedSigns(network: RoadNetwork, boards: QuadBatch, rects: ReadonlyMap<string, SignRect>): void {
    const rect = rects.get('sign.closed');
    if (!rect) return;
    for (const node of network.nodes) {
      if (!node.closedSign || node.legs.length === 0) continue;
      const leg = node.legs[0];
      boards.addUpright(rect, node.x + leg.awayX * 0.35, 2.4, node.z + leg.awayZ * 0.35, Math.atan2(leg.awayX, leg.awayZ), 6, 1.5);
    }
  }

  /** Booths and a gantry on the flyover's southern side. */
  private buildTollPlaza(physics: PhysicsWorld, builder: ModelBuilder): void {
    const y = CITY.network.deckHeight;
    const half = CITY.roads.deck.halfWidth;
    // A slim booth on the centre line: both inner lanes must still clear it, even with a bus.
    builder.box(3, 2.6, 0.5, TOLL_X, y + 1.3, TOLL_Z, 0x3c5f6e);
    builder.box(3.6, 0.3, 0.9, TOLL_X, y + 2.75, TOLL_Z, 0xf2a20c);
    builder.box(2.4, 1, 0.56, TOLL_X, y + 1.6, TOLL_Z, 0x241a10, { glow: [1.6, 1.15, 0.6] });
    physics.addFixedCuboid(1.5, 1.4, 0.26, TOLL_X, y + 1.4, TOLL_Z, 'road');
    for (const side of [1, -1]) {
      builder.box(0.5, 7, 0.5, TOLL_X, y + 3.5, TOLL_Z + side * (half + 0.6), 0x23272b);
    }
    builder.box(0.7, 1, half * 2 + 1.6, TOLL_X, y + 6.8, TOLL_Z, 0x23272b);
  }

  private buildTollSign(boards: QuadBatch, rects: ReadonlyMap<string, SignRect>): void {
    const rect = rects.get('sign.toll');
    if (!rect) return;
    const y = CITY.network.deckHeight + 6.8;
    const width = CITY.roads.deck.halfWidth * 2 - 1;
    // Reads for traffic both ways.
    boards.addUpright(rect, TOLL_X - 0.4, y, TOLL_Z, -Math.PI / 2, width, width / 4);
    boards.addUpright(rect, TOLL_X + 0.4, y, TOLL_Z, Math.PI / 2, width, width / 4);
  }

  private buildBillboards(
    network: RoadNetwork,
    physics: PhysicsWorld,
    occupancy: Occupancy,
    builder: ModelBuilder,
    boards: QuadBatch,
    rects: ReadonlyMap<string, SignRect>,
  ): void {
    const config = CITY.props;
    const sample = createSample();
    let signIndex = 0;
    for (const edge of network.edges) {
      if (edge.kind !== 'avenue') continue;
      const line = edge.center;
      for (let s = config.billboardSpacing / 2; s < line.length - 20; s += config.billboardSpacing) {
        line.sample(s, sample);
        const side = signIndex % 2 === 0 ? 1 : -1;
        const offset = edge.spec.halfWidth + 3.2;
        const x = sample.x + sample.tz * offset * side;
        const z = sample.z - sample.tx * offset * side;
        signIndex++;
        if (!occupancy.isFree(x, z, 0, 0.6, 0.6)) continue;
        const key = SIGN_KEYS[1 + (signIndex % (SIGN_KEYS.length - 1))];
        const rect = rects.get(key);
        if (!rect) continue;
        const faceYaw = Math.atan2(-sample.tx, -sample.tz) + side * -0.3;
        const width = 12;
        const height = 3;
        const top = 16.5;
        const faceX = Math.sin(faceYaw);
        const faceZ = Math.cos(faceYaw);
        boards.addUpright(rect, x + faceX * 0.2, top - height / 2, z + faceZ * 0.2, faceYaw, width, height);
        builder.box(width + 0.4, height + 0.4, 0.25, x, top - height / 2, z, 0x17181a, { rotY: faceYaw });
        builder.box(0.7, top - height, 0.7, x, (top - height) / 2, z, 0x23272b);
        physics.addFixedCuboid(0.4, (top - height) / 2, 0.4, x, (top - height) / 2, z, 'road');
        occupancy.markCircle(x, z, 2);
      }
    }
  }

  update(dt: number, carPosition: Vector3): void {
    this.time += dt;
    this.lamps.update(carPosition);
    if (this.cableMaterial) this.cableMaterial.uniforms.uTime.value = this.time;
  }
}

