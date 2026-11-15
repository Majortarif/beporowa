/**
 * Everything a race adds to the world: rival cars, gates, the start and finish, corner boards,
 * the crowd, and the flags that mark where races begin. It only reads the race, and never changes it.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Material,
  type Scene,
} from 'three';
import { RACE } from '../config/race-tuning';
import { RIVALS } from '../config/rivals';
import { TUNING, type QualityPreset } from '../config/tuning';
import { worldText } from '../i18n';
import { FigureBatch } from '../pedestrians/pedestrian-render';
import { ModelBuilder, useBakedGlow, useSelfLitGlow, type UvRect } from '../render/model-builder';
import { FONT_DISPLAY, PAINT, createRadialCanvas, drawFlower, makeCanvas, paintGrain, toTexture } from '../render/painted-textures';
import { enableReflection } from '../render/planar-reflection';
import { buildPoliceWheel } from '../police/police-models';
import type { RaceCourse } from './race-course';
import type { RaceSession } from './race-session';
import { buildRivalCar, createRivalAtlas } from './rival-models';

const position = new Vector3();
const offset = new Vector3();
const quaternion = new Quaternion();
const previous = new Quaternion();
const steerQ = new Quaternion();
const spinQ = new Quaternion();
const matrix = new Matrix4();
const unit = new Vector3(1, 1, 1);
const scaled = new Vector3();
const axisX = new Vector3(1, 0, 0);
const axisY = new Vector3(0, 1, 0);
const color = new Color();

const ATLAS_SIZE = 1024;

function rect(x: number, y: number, width: number, height: number): UvRect {
  return [x / ATLAS_SIZE, 1 - (y + height) / ATLAS_SIZE, (x + width) / ATLAS_SIZE, 1 - y / ATLAS_SIZE];
}

const ART = {
  start: rect(0, 0, 1024, 180),
  finish: rect(0, 184, 1024, 180),
  chevron: rect(0, 370, 256, 256),
  checker: rect(260, 370, 256, 32),
  flag: rect(520, 370, 256, 170),
  flagRival: rect(780, 370, 244, 170),
};

function paintBanner(ctx: CanvasRenderingContext2D, y: number, text: string, base: string, ink: string, edge: string): void {
  ctx.fillStyle = base;
  ctx.fillRect(0, y, ATLAS_SIZE, 180);
  ctx.save();
  ctx.translate(0, y);
  paintGrain(ctx, ATLAS_SIZE, 180, y + 13, 0.14);
  ctx.strokeStyle = edge;
  ctx.lineWidth = 10;
  ctx.strokeRect(8, 8, ATLAS_SIZE - 16, 164);
  drawFlower(ctx, 90, 90, 56, PAINT.tomato, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, ATLAS_SIZE - 90, 90, 56, PAINT.tomato, PAINT.marigold, PAINT.tin);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `122px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAINT.soot;
  ctx.fillText(text, ATLAS_SIZE / 2 + 5, 96, 720);
  ctx.fillStyle = ink;
  ctx.fillText(text, ATLAS_SIZE / 2, 91, 720);
  ctx.restore();
}

/** Painted banners, corner boards and flags for the race world. */
function createRaceAtlas(anisotropy: number): ReturnType<typeof toTexture> {
  const { canvas, ctx } = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  paintBanner(ctx, 0, worldText('sign.ring'), PAINT.indigo, PAINT.marigold, PAINT.marigold);
  paintBanner(ctx, 184, worldText('sign.finish'), PAINT.tomato, PAINT.tin, PAINT.soot);

  // A corner board: arrows pointing left. Flipped for right-hand bends.
  ctx.fillStyle = PAINT.soot;
  ctx.fillRect(0, 370, 256, 256);
  ctx.fillStyle = PAINT.marigold;
  for (let i = 0; i < 2; i++) {
    const x = 34 + i * 96;
    ctx.beginPath();
    ctx.moveTo(x + 70, 410);
    ctx.lineTo(x + 100, 410);
    ctx.lineTo(x + 40, 498);
    ctx.lineTo(x + 100, 586);
    ctx.lineTo(x + 70, 586);
    ctx.lineTo(x + 10, 498);
    ctx.closePath();
    ctx.fill();
  }

  // Start line squares.
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 16; col++) {
      ctx.fillStyle = (row + col) % 2 === 0 ? '#e9e4d8' : '#1b1410';
      ctx.fillRect(260 + col * 16, 370 + row * 16, 16, 16);
    }
  }

  // Race flags: marigold for an event, tomato for a rival's.
  const flag = (x: number, base: string): void => {
    ctx.fillStyle = base;
    ctx.fillRect(x, 370, 240, 170);
    ctx.save();
    ctx.translate(x, 370);
    drawFlower(ctx, 120, 85, 62, PAINT.teal, PAINT.tin, PAINT.indigo);
    ctx.restore();
  };
  flag(520, PAINT.marigold);
  flag(780, PAINT.tomato);
  // The very corner stays white, so plain parts can use it.
  return toTexture(canvas, anisotropy);
}

const PLAIN: UvRect = [0.002, 0.002, 0.004, 0.004];

function gatePoleGeometry(): BufferGeometry {
  const b = new ModelBuilder();
  b.add(new CylinderGeometry(0.11, 0.14, 7.4, 6), 0xb79a55, 0, 3.7, 0, { uv: PLAIN });
  // Marigold garlands climbing the bamboo.
  for (let i = 0; i < 7; i++) {
    b.add(new SphereGeometry(0.17, 6, 4), i % 2 === 0 ? 0xf2a20c : 0xd8402b, Math.sin(i * 1.7) * 0.15, 1 + i * 0.9, Math.cos(i * 1.7) * 0.15, { uv: PLAIN, glow: [0.9, 0.9, 0.9] });
  }
  return b.build();
}

function gateBarGeometry(): BufferGeometry {
  // Spans x from -1 to 1, then gets stretched to the road's width.
  const b = new ModelBuilder();
  b.box(2, 0.16, 0.16, 0, 7.2, 0, 0xb79a55, { uv: PLAIN });
  for (let i = -10; i <= 10; i++) {
    const x = i / 10;
    const sag = 0.5 * (1 - x * x);
    b.box(0.03, 0.3, 0.3, x, 6.85 - sag, 0, i % 2 === 0 ? 0xf2a20c : 0xc2185b, { uv: PLAIN, glow: [0.9, 0.9, 0.9] });
  }
  return b.build();
}

function flagGeometry(rivalFlag: boolean): BufferGeometry {
  const b = new ModelBuilder();
  b.add(new CylinderGeometry(0.1, 0.14, 8, 6), 0x20242a, 0, 4, 0, { uv: PLAIN });
  b.panel(3.4, 2.4, 1.75, 6.7, 0, 0xffffff, { uv: rivalFlag ? ART.flagRival : ART.flag, glow: [1.1, 1.1, 1.1] });
  b.panel(3.4, 2.4, 1.75, 6.7, -0.01, 0xffffff, { rotY: Math.PI, uv: rivalFlag ? ART.flagRival : ART.flag, glow: [1.1, 1.1, 1.1] });
  return b.build();
}

function additive(colorHex: number, opacity: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: colorHex, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });
}

export interface RaceFlag {
  id: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  rival: boolean;
}

export class RaceRender {
  private readonly scene: Scene;
  private readonly bodyMaterial: Material;
  private readonly bodyCache = new Map<string, BufferGeometry>();
  private readonly bodies: Mesh[] = [];
  private readonly wheels: InstancedMesh;
  private readonly glows: InstancedMesh;
  private readonly flares: InstancedMesh;
  private readonly gatePoles: InstancedMesh;
  private readonly gateBars: InstancedMesh;
  private readonly gateStrips: InstancedMesh;
  private readonly chevrons: InstancedMesh;
  private readonly markers: InstancedMesh;
  private readonly start = new Group();
  private readonly finish = new Group();
  private readonly startLine: Mesh;
  private readonly finishLine: Mesh;
  private readonly lamps: Mesh[] = [];
  private readonly beacon: Mesh;
  private readonly beaconRing: Mesh;
  private readonly crowd: FigureBatch;
  private readonly crowdCount: number;
  private crowdUsed = 0;
  private readonly crowdPhase: Float32Array;
  private readonly flagMeshes: InstancedMesh[];
  private readonly flagRings: InstancedMesh;
  private time = 0;
  private prepared = false;
  private course: RaceCourse | null = null;

  constructor(scene: Scene, private readonly session: RaceSession, preset: QualityPreset) {
    this.scene = scene;
    const carAtlas = createRivalAtlas(preset.anisotropy);
    const atlas = createRaceAtlas(preset.anisotropy);
    this.bodyMaterial = useBakedGlow(new MeshStandardMaterial({ map: carAtlas, vertexColors: true, roughness: 0.34, metalness: 0.22 }));
    const worldMaterial = useSelfLitGlow(new MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.7, side: DoubleSide }));
    const capacity = 9;

    const wheelMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
    this.wheels = new InstancedMesh(buildPoliceWheel(TUNING.vehicle.wheels.radius), wheelMaterial, capacity * 4);
    this.wheels.count = 0;
    this.wheels.frustumCulled = false;
    scene.add(this.wheels);

    const radial = toTexture(createRadialCanvas(128, 'rgba(255,255,255,1)', 'rgba(255,255,255,0)'), 1);
    const flat = new PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.glows = new InstancedMesh(
      flat,
      new MeshBasicMaterial({ map: radial, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }),
      capacity * 3,
    );
    this.glows.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 3 * 3), 3);
    this.glows.count = 0;
    this.glows.frustumCulled = false;
    scene.add(this.glows);

    this.flares = new InstancedMesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({ map: radial, transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide }),
      capacity * 2,
    );
    this.flares.instanceColor = new InstancedBufferAttribute(new Float32Array(capacity * 2 * 3), 3);
    this.flares.count = 0;
    this.flares.frustumCulled = false;
    scene.add(this.flares);

    this.gatePoles = new InstancedMesh(gatePoleGeometry(), worldMaterial, 6);
    this.gateBars = new InstancedMesh(gateBarGeometry(), worldMaterial, 3);
    const strip = new PlaneGeometry(1, 1);
    strip.rotateX(-Math.PI / 2);
    this.gateStrips = new InstancedMesh(strip, additive(0xffb030, 0.5), 3);
    for (const mesh of [this.gatePoles, this.gateBars, this.gateStrips]) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      scene.add(mesh);
    }

    const board = new ModelBuilder();
    board.panel(1.7, 1.7, 0, 2.1, 0, 0xffffff, { uv: ART.chevron, glow: [1.2, 1.2, 1.2] });
    board.box(0.12, 1.4, 0.12, 0, 0.7, -0.05, 0x20242a, { uv: PLAIN });
    this.chevrons = new InstancedMesh(board.build(), worldMaterial, 60);
    this.chevrons.count = 0;
    this.chevrons.frustumCulled = false;
    scene.add(this.chevrons);

    this.markers = new InstancedMesh(new ConeGeometry(0.62, 1.3, 4), additive(0xff5030, 0.92), 8);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    scene.add(this.markers);

    this.buildBanner(this.start, ART.start, worldMaterial, true);
    this.buildBanner(this.finish, ART.finish, worldMaterial, false);
    scene.add(this.start, this.finish);
    this.start.visible = false;
    this.finish.visible = false;

    const checkerPlane = (): Mesh => {
      const b = new ModelBuilder();
      const geometry = new PlaneGeometry(1, 1);
      geometry.rotateX(-Math.PI / 2);
      b.add(geometry, 0xffffff, 0, 0, 0, { uv: ART.checker });
      const mesh = new Mesh(b.build(), useBakedGlow(new MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 })));
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      return mesh;
    };
    this.startLine = checkerPlane();
    this.finishLine = checkerPlane();

    this.beacon = new Mesh(new CylinderGeometry(7, 7, 110, 18, 1, true), additive(0xffa828, 0.22));
    this.beacon.visible = false;
    this.beacon.frustumCulled = false;
    scene.add(this.beacon);
    const ring = new RingGeometry(0.86, 1, 40);
    ring.rotateX(-Math.PI / 2);
    this.beaconRing = new Mesh(ring, additive(0xffb838, 0.7));
    this.beaconRing.visible = false;
    this.beaconRing.frustumCulled = false;
    scene.add(this.beaconRing);

    this.crowdCount = Math.round(RACE.grid.crowdPerSide * 4 * (preset.pedestrians >= 60 ? 1 : 0.5));
    this.crowd = new FigureBatch(scene, Math.max(1, this.crowdCount));
    this.crowdPhase = new Float32Array(Math.max(1, this.crowdCount));

    this.flagMeshes = [
      new InstancedMesh(flagGeometry(false), worldMaterial, 24),
      new InstancedMesh(flagGeometry(true), worldMaterial, 12),
    ];
    for (const mesh of this.flagMeshes) {
      mesh.count = 0;
      mesh.frustumCulled = false;
      enableReflection(mesh);
      scene.add(mesh);
    }
    const flagRing = new RingGeometry(0.82, 1, 32);
    flagRing.rotateX(-Math.PI / 2);
    this.flagRings = new InstancedMesh(flagRing, additive(0xffb030, 0.55), 36);
    this.flagRings.count = 0;
    this.flagRings.frustumCulled = false;
    scene.add(this.flagRings);
  }

  private buildBanner(group: Group, art: UvRect, material: Material, withLamps: boolean): void {
    const b = new ModelBuilder();
    // Spans x from -1 to 1 in the group's own scale. The poles go on separately so that they keep their shape.
    b.panel(2, 2.1, 0, 7.6, 0, 0xffffff, { uv: art, glow: [1.05, 1.05, 1.05] });
    b.panel(2, 2.1, 0, 7.6, -0.02, 0xffffff, { rotY: Math.PI, uv: art, glow: [1.05, 1.05, 1.05] });
    b.box(2, 0.14, 0.14, 0, 6.5, 0, 0x20242a, { uv: PLAIN });
    const board = new Mesh(b.build(), material);
    board.frustumCulled = false;
    board.name = 'board';
    group.add(board);
    const pole = new BoxGeometry(0.26, 8.8, 0.26);
    const poleMaterial = new MeshStandardMaterial({ color: 0x20242a, roughness: 0.7 });
    for (const side of [-1, 1]) {
      const mesh = new Mesh(pole, poleMaterial);
      mesh.position.set(side, 4.4, 0);
      mesh.frustumCulled = false;
      mesh.name = side < 0 ? 'poleLeft' : 'poleRight';
      group.add(mesh);
    }
    if (withLamps) {
      for (let i = 0; i < 3; i++) {
        const lamp = new Mesh(new SphereGeometry(0.3, 10, 8), new MeshBasicMaterial({ color: 0x220806, toneMapped: false }));
        lamp.position.set((i - 1) * 0.9, 6.1, 0.2);
        lamp.frustumCulled = false;
        lamp.name = 'lamp';
        group.add(lamp);
        this.lamps.push(lamp);
        enableReflection(lamp);
      }
    }
  }

  private placeBanner(group: Group, x: number, y: number, z: number, tx: number, tz: number, halfWidth: number): void {
    group.position.set(x, y, z);
    group.rotation.y = Math.atan2(tx, tz);
    const width = halfWidth + 0.7;
    for (const child of group.children) {
      if (child.name === 'board') child.scale.set(width, 1, 1);
      if (child.name === 'poleLeft') child.position.x = -width;
      if (child.name === 'poleRight') child.position.x = width;
    }
    group.visible = true;
  }

  private placeLine(mesh: Mesh, x: number, y: number, z: number, tx: number, tz: number, halfWidth: number): void {
    mesh.position.set(x, y + 0.03, z);
    mesh.rotation.y = Math.atan2(tx, tz);
    mesh.scale.set(halfWidth * 2, 1, 2.6);
    mesh.visible = true;
  }

  /** Dresses the road for this race. */
  prepare(): void {
    const course = this.session.course;
    if (!course) return;
    this.course = course;
    this.prepared = true;
    const session = this.session;
    const family = session.raceFamily;
    this.start.visible = false;
    this.finish.visible = false;
    this.startLine.visible = false;
    this.finishLine.visible = false;
    this.chevrons.count = 0;
    this.lamps.forEach((lamp) => (lamp.material as MeshBasicMaterial).color.setHex(0x220806));

    const startGate = course.startGate;
    if (family === 'route' || family === 'drift' || family === 'gates') {
      this.placeBanner(this.start, startGate.x, startGate.y, startGate.z, startGate.tx, startGate.tz, startGate.halfWidth);
      this.placeLine(this.startLine, startGate.x, startGate.y, startGate.z, startGate.tx, startGate.tz, startGate.halfWidth);
    }
    if ((family === 'route') && !course.loop) {
      const end = course.gates[course.gates.length - 1];
      this.placeBanner(this.finish, end.x, end.y, end.z, end.tx, end.tz, end.halfWidth);
      this.placeLine(this.finishLine, end.x, end.y, end.z, end.tx, end.tz, end.halfWidth);
    }

    // Corner boards, on the outside of each bend.
    if (family === 'route' || family === 'drift') {
      let count = 0;
      for (const corner of course.corners) {
        if (count >= this.chevrons.instanceMatrix.count) break;
        position.set(corner.x, corner.y, corner.z);
        quaternion.setFromAxisAngle(axisY, corner.yaw);
        scaled.set(corner.turn > 0 ? 1 : -1, 1, 1);
        matrix.compose(position, quaternion, scaled);
        this.chevrons.setMatrixAt(count++, matrix);
      }
      this.chevrons.count = count;
      this.chevrons.instanceMatrix.needsUpdate = true;
    }
    this.placeCrowd(startGate.x, startGate.y, startGate.z, startGate.tx, startGate.tz, startGate.halfWidth, family === 'hunt');
  }

  private placeCrowd(x: number, y: number, z: number, tx: number, tz: number, half: number, none: boolean): void {
    const crowd = this.crowd;
    let used = 0;
    const count = none ? 0 : this.crowdCount;
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const row = Math.floor(i / 2);
      const along = -26 + (row * 52) / Math.max(1, Math.floor(count / 2));
      const out = half + 1.6 + ((i * 37) % 7) * 0.45;
      const px = x + tx * along + tz * side * out;
      const pz = z + tz * along - tx * side * out;
      // Everyone faces the road.
      const yaw = Math.atan2(-tz * side, tx * side);
      crowd.set(used, px, y, pz, yaw, i * 0.9, 0.34, (i * 73) & 255);
      this.crowdPhase[used] = i * 0.9;
      used++;
    }
    this.crowdUsed = used;
    crowd.flush(used);
  }

  /** Back to an empty road. */
  clear(): void {
    this.prepared = false;
    this.course = null;
    this.start.visible = false;
    this.finish.visible = false;
    this.startLine.visible = false;
    this.finishLine.visible = false;
    this.beacon.visible = false;
    this.beaconRing.visible = false;
    this.gatePoles.count = 0;
    this.gateBars.count = 0;
    this.gateStrips.count = 0;
    this.chevrons.count = 0;
    this.markers.count = 0;
    this.wheels.count = 0;
    this.glows.count = 0;
    this.flares.count = 0;
    this.crowd.flush(0);
    this.crowdUsed = 0;
    for (const body of this.bodies) body.visible = false;
  }

  /** Lights over the start: one more red on each count, then all green. */
  setStartLamps(step: number): void {
    this.lamps.forEach((lamp, index) => {
      const material = lamp.material as MeshBasicMaterial;
      if (step === 0) material.color.setRGB(0.2, 5.5, 1.1);
      else if (step > 0 && index < 4 - step) material.color.setRGB(6, 0.35, 0.18);
      else material.color.setHex(0x220806);
    });
  }

  /** The flags in the city that mark where races begin. */
  setFlags(flags: readonly RaceFlag[]): void {
    const [plain, rival] = this.flagMeshes;
    let plainCount = 0;
    let rivalCount = 0;
    let ringCount = 0;
    for (const flag of flags) {
      position.set(flag.x, flag.y, flag.z);
      quaternion.setFromAxisAngle(axisY, flag.yaw);
      matrix.compose(position, quaternion, unit);
      if (flag.rival && rivalCount < rival.instanceMatrix.count) rival.setMatrixAt(rivalCount++, matrix);
      else if (plainCount < plain.instanceMatrix.count) plain.setMatrixAt(plainCount++, matrix);
      position.y = flag.y + 0.06;
      scaled.setScalar(RACE.markers.enterRadius);
      matrix.compose(position, quaternion.identity(), scaled);
      this.flagRings.setMatrixAt(ringCount++, matrix);
    }
    plain.count = plainCount;
    rival.count = rivalCount;
    this.flagRings.count = ringCount;
    plain.instanceMatrix.needsUpdate = true;
    rival.instanceMatrix.needsUpdate = true;
    this.flagRings.instanceMatrix.needsUpdate = true;
  }

  setFlagsVisible(visible: boolean): void {
    for (const mesh of this.flagMeshes) mesh.visible = visible;
    this.flagRings.visible = visible;
  }

  private bodyFor(index: number, key: string, build: () => BufferGeometry): Mesh {
    while (this.bodies.length <= index) {
      const mesh = new Mesh(new BufferGeometry(), this.bodyMaterial);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this.bodies.push(mesh);
    }
    const mesh = this.bodies[index];
    let geometry = this.bodyCache.get(key);
    if (!geometry) {
      geometry = build();
      this.bodyCache.set(key, geometry);
    }
    if (mesh.geometry !== geometry) mesh.geometry = geometry;
    return mesh;
  }

  update(alpha: number, dt: number): void {
    this.time += dt;
    this.drawCars(alpha);
    if (!this.prepared) return;
    this.drawGates();
    this.drawCrowd(dt);
  }

  private drawCars(alpha: number): void {
    const session = this.session;
    const agents = session.agents;
    let wheelCount = 0;
    let glowCount = 0;
    let flareCount = 0;
    let markerCount = 0;

    agents.forEach((agent, index) => {
      if (!agent.active) return;
      const look = agent.look;
      const nameRow = agent.rivalId ? RIVALS.findIndex((rival) => rival.id === agent.rivalId) : -1;
      const key = `${look.model}-${look.body}-${look.stripe}-${nameRow}-${look.lightsOff ? 1 : 0}`;
      const body = this.bodyFor(index, key, () => buildRivalCar({ model: look.model, body: look.body, stripe: look.stripe, lightsOff: look.lightsOff, nameRow }));
      position.set(agent.prevX + (agent.currX - agent.prevX) * alpha, agent.prevY + (agent.currY - agent.prevY) * alpha, agent.prevZ + (agent.currZ - agent.prevZ) * alpha);
      previous.set(agent.prevQx, agent.prevQy, agent.prevQz, agent.prevQw);
      quaternion.set(agent.currQx, agent.currQy, agent.currQz, agent.currQw);
      quaternion.slerp(previous, 1 - alpha);
      body.position.copy(position);
      body.quaternion.copy(quaternion);
      body.visible = true;

      const steerAngle = agent.car.telemetry.steerAngle;
      for (const wheel of agent.car.wheels) {
        offset.set(wheel.mountLocal.x, wheel.mountLocal.y - wheel.springLength, wheel.mountLocal.z).applyQuaternion(quaternion).add(position);
        steerQ.setFromAxisAngle(axisY, wheel.isFront ? -steerAngle : 0);
        spinQ.setFromAxisAngle(axisX, wheel.spinAngle);
        previous.copy(quaternion).multiply(steerQ).multiply(spinQ);
        matrix.compose(offset, previous, unit);
        this.wheels.setMatrixAt(wheelCount++, matrix);
      }

      const fx = agent.fx;
      const fz = agent.fz;
      const roadY = position.y - 0.6;
      const yaw = Math.atan2(fx, fz);
      // Light on the road: headlamps ahead, and the car's own colour beneath it.
      if (!look.lightsOff) {
        offset.set(position.x + fx * 8, roadY + 0.05, position.z + fz * 8);
        quaternion.setFromAxisAngle(axisY, yaw);
        scaled.set(6.5, 1, 13);
        matrix.compose(offset, quaternion, scaled);
        this.glows.setMatrixAt(glowCount, matrix);
        color.setRGB(0.22, 0.19, 0.13);
        this.glows.setColorAt(glowCount++, color);
      }
      offset.set(position.x, roadY + 0.04, position.z);
      quaternion.setFromAxisAngle(axisY, yaw);
      scaled.set(4.6, 1, 7);
      matrix.compose(offset, quaternion, scaled);
      this.glows.setMatrixAt(glowCount, matrix);
      color.setHex(look.glow).multiplyScalar(look.lightsOff ? 0.1 : 0.42);
      this.glows.setColorAt(glowCount++, color);

      // Brake lamps flare, and nitro throws a flame.
      const telemetry = agent.car.telemetry;
      if (telemetry.nitroActive) {
        offset.set(position.x - fx * 2.8, position.y - 0.1, position.z - fz * 2.8);
        quaternion.setFromAxisAngle(axisY, yaw);
        scaled.set(1.1, 1.1, 1);
        matrix.compose(offset, quaternion, scaled);
        this.flares.setMatrixAt(flareCount, matrix);
        color.setRGB(0.6, 1.4, 3.2);
        this.flares.setColorAt(flareCount++, color);
      } else if (telemetry.brake > 0.2 && !look.lightsOff) {
        offset.set(position.x - fx * 2.25, position.y + 0.05, position.z - fz * 2.25);
        quaternion.setFromAxisAngle(axisY, yaw);
        scaled.set(2.2, 0.8, 1);
        matrix.compose(offset, quaternion, scaled);
        this.flares.setMatrixAt(flareCount, matrix);
        color.setRGB(2.4, 0.2, 0.1);
        this.flares.setColorAt(flareCount++, color);
      }

      // A takedown target carries a marker, until it is out.
      if (agent.role === 'runner' && !agent.eliminated && markerCount < 8) {
        offset.set(position.x, position.y + 3.4 + Math.sin(this.time * 3 + index) * 0.25, position.z);
        quaternion.setFromAxisAngle(axisX, Math.PI);
        matrix.compose(offset, quaternion, unit);
        this.markers.setMatrixAt(markerCount++, matrix);
      }
    });
    for (let i = agents.length; i < this.bodies.length; i++) this.bodies[i].visible = false;
    this.wheels.count = wheelCount;
    this.glows.count = glowCount;
    this.flares.count = flareCount;
    this.markers.count = markerCount;
    this.wheels.instanceMatrix.needsUpdate = true;
    this.glows.instanceMatrix.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    this.flares.instanceMatrix.needsUpdate = true;
    if (this.flares.instanceColor) this.flares.instanceColor.needsUpdate = true;
    this.markers.instanceMatrix.needsUpdate = true;
  }

  private setGate(index: number, x: number, y: number, z: number, tx: number, tz: number, half: number, next: boolean): void {
    const yaw = Math.atan2(tx, tz);
    quaternion.setFromAxisAngle(axisY, yaw);
    const width = half + 0.6;
    for (const side of [-1, 1]) {
      position.set(x + tz * side * width, y, z - tx * side * width);
      matrix.compose(position, quaternion, unit);
      this.gatePoles.setMatrixAt(index * 2 + (side + 1) / 2, matrix);
    }
    position.set(x, y, z);
    scaled.set(width, 1, 1);
    matrix.compose(position, quaternion, scaled);
    this.gateBars.setMatrixAt(index, matrix);
    position.y = y + 0.05;
    scaled.set(width * 2, 1, next ? 2.2 : 0.8);
    matrix.compose(position, quaternion, scaled);
    this.gateStrips.setMatrixAt(index, matrix);
  }

  private drawGates(): void {
    const session = this.session;
    const course = this.course;
    if (!course) return;
    const family = session.raceFamily;
    let shown = 0;
    if (family === 'route' && session.phase !== 'done') {
      const gates = course.gates;
      for (let i = 0; i < 2; i++) {
        const gate = gates[(session.gateIndex + i) % gates.length];
        const total = gates.length * session.laps;
        if (session.gateIndex + i >= total) break;
        // The last gate of a sprint is the finish banner, so it needs no arch.
        if (!course.loop && gate === gates[gates.length - 1]) continue;
        // The start line of a loop has its banner too.
        if (course.loop && gate === gates[gates.length - 1]) continue;
        this.setGate(shown, gate.x, gate.y, gate.z, gate.tx, gate.tz, gate.halfWidth, i === 0);
        shown++;
      }
    }
    this.gatePoles.count = shown * 2;
    this.gateBars.count = shown;
    this.gateStrips.count = shown;
    this.gatePoles.instanceMatrix.needsUpdate = true;
    this.gateBars.instanceMatrix.needsUpdate = true;
    this.gateStrips.instanceMatrix.needsUpdate = true;

    // Free-routed races mark the next place with a column of light you can see over the rooftops.
    const next = session.nextGate;
    const beacon = (family === 'gates') && next.valid;
    this.beacon.visible = beacon;
    this.beaconRing.visible = beacon;
    if (beacon) {
      this.beacon.position.set(next.x, next.y + 55, next.z);
      this.beaconRing.position.set(next.x, next.y + 0.08, next.z);
      const gate = session.gateList[session.gateIndex];
      this.beaconRing.scale.setScalar(gate ? gate.radius : 15);
      const pulse = 0.18 + Math.sin(this.time * 3.2) * 0.05;
      (this.beacon.material as MeshBasicMaterial).opacity = pulse;
    }
  }

  private drawCrowd(dt: number): void {
    if (this.crowdUsed === 0) return;
    const crowd = this.crowd;
    for (let i = 0; i < this.crowdUsed; i++) {
      this.crowdPhase[i] += dt * (5.5 + (i % 5));
      crowd.setPhase(i, this.crowdPhase[i]);
    }
    crowd.flushAnimation();
  }
}
