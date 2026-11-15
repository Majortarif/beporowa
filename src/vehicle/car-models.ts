/**
 * Builds the player's car, whichever one is chosen. বুলবুলি has its own model. The others share
 * a lofting kit with the rivals' cars, and রিকশা রকেট is its own glorious thing.
 * All of them hand the animation rig the same set of parts.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CarDef, LiveryDef } from '../config/cars';
import { TUNING, type QualityPreset } from '../config/tuning';
import { ModelBuilder, useBakedGlow } from '../render/model-builder';
import { LiveryPainter } from '../render/livery-painter';
import { createPlateCanvas, createRadialCanvas, toTexture } from '../render/painted-textures';
import { SHAPES, type Station } from '../race/rival-models';
import { buildBulbuliBody, buildWheelGeometries, type WheelVisual } from './bulbuli-model';

/** Ground under the car, in the body's own coordinates. */
const GROUND = -0.62;
const WHEEL_REST_Y = -0.337;
const PIVOT_Y = -0.2;

/** What the animation rig needs from any car, plus what the garage needs to repaint it. */
export interface CarVisual {
  readonly root: Group;
  readonly bodyPivot: Group;
  readonly wheels: WheelVisual[];
  readonly headlightMaterial: MeshBasicMaterial;
  readonly tailMaterial: MeshBasicMaterial;
  readonly reverseMaterial: MeshBasicMaterial;
  readonly indicatorLeft: MeshBasicMaterial;
  readonly indicatorRight: MeshBasicMaterial;
  readonly underglow: Mesh;
  readonly blobShadow: Mesh;
  readonly flames: { outer: Mesh; inner: Mesh }[];
  /** Changes the paint, at once. */
  applyLivery(livery: LiveryDef): void;
  /** Frees the GPU's memory, when the car is swapped for another. */
  dispose(): void;
}

/** How much of the texture's height a car's side takes, so that every body shows the sill and band. */
const SIDE_SHARE = 0.75;

/** How a body's sides fit the texture. Its height decides how art is squeezed. */
function sideFit(stations: readonly Station[]): { low: number; verticalScale: number } {
  const low = Math.min(...stations.map((item) => item.low));
  const high = Math.max(...stations.map((item) => item.high));
  return { low, verticalScale: SIDE_SHARE / (high - low) };
}

/** Lofts a closed body through its stations, with a side-view texture across it. */
function paintedLoft(stations: readonly Station[], fit = sideFit(stations)): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    // The car's right side reads the texture the other way, or a picture on the door would be backwards.
    const rightSide = a[0] <= 0 && b[0] <= 0 && c[0] <= 0 && d[0] <= 0;
    for (const p of [a, b, c, a, c, d]) {
      positions.push(p[0], p[1], p[2]);
      const u = (2 - p[2]) / 4;
      uvs.push(rightSide ? 1 - u : u, (p[1] - GROUND - fit.low) * fit.verticalScale);
    }
  };
  const y = (value: number): number => GROUND + value;
  for (let i = 0; i + 1 < stations.length; i++) {
    const f = stations[i];
    const r = stations[i + 1];
    quad([f.bottom, y(f.low), f.z], [r.bottom, y(r.low), r.z], [r.top, y(r.high), r.z], [f.top, y(f.high), f.z]);
    quad([-f.bottom, y(f.low), f.z], [-f.top, y(f.high), f.z], [-r.top, y(r.high), r.z], [-r.bottom, y(r.low), r.z]);
    quad([f.top, y(f.high), f.z], [r.top, y(r.high), r.z], [-r.top, y(r.high), r.z], [-f.top, y(f.high), f.z]);
    quad([f.bottom, y(f.low), f.z], [-f.bottom, y(f.low), f.z], [-r.bottom, y(r.low), r.z], [r.bottom, y(r.low), r.z]);
  }
  const front = stations[0];
  const back = stations[stations.length - 1];
  quad([front.bottom, y(front.low), front.z], [front.top, y(front.high), front.z], [-front.top, y(front.high), front.z], [-front.bottom, y(front.low), front.z]);
  quad([back.bottom, y(back.low), back.z], [-back.bottom, y(back.low), back.z], [-back.top, y(back.high), back.z], [back.top, y(back.high), back.z]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.computeVertexNormals();
  return geometry;
}

function box(width: number, height: number, depth: number, x: number, y: number, z: number): BufferGeometry {
  const geometry = new BoxGeometry(width, height, depth);
  geometry.translate(x, y, z);
  return geometry;
}

function emissive(hex: number): MeshBasicMaterial {
  return new MeshBasicMaterial({ color: hex, toneMapped: false });
}

interface Shared {
  root: Group;
  bodyPivot: Group;
  body: Group;
  painter: LiveryPainter;
  paint: MeshStandardMaterial;
  roof: MeshStandardMaterial;
  rim: MeshStandardMaterial;
  trim: MeshStandardMaterial;
  glass: MeshStandardMaterial;
  dark: MeshStandardMaterial;
  headlight: MeshBasicMaterial;
  tail: MeshBasicMaterial;
  reverse: MeshBasicMaterial;
  indicatorLeft: MeshBasicMaterial;
  indicatorRight: MeshBasicMaterial;
  disposables: Array<{ dispose(): void }>;
}

function startCar(preset: QualityPreset, verticalScale = 1): Shared {
  const root = new Group();
  const bodyPivot = new Group();
  bodyPivot.position.y = PIVOT_Y;
  root.add(bodyPivot);
  const body = new Group();
  body.position.y = -PIVOT_Y;
  bodyPivot.add(body);
  const painter = new LiveryPainter(preset.anisotropy, verticalScale);
  const PaintClass = preset.clearcoatPaint ? MeshPhysicalMaterial : MeshStandardMaterial;
  const paint = new PaintClass({ map: painter.body, roughness: 0.36, metalness: 0.08 });
  if (paint instanceof MeshPhysicalMaterial) {
    paint.clearcoat = 0.85;
    paint.clearcoatRoughness = 0.18;
  }
  return {
    root,
    bodyPivot,
    body,
    painter,
    paint,
    roof: new MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.42, metalness: 0.05 }),
    rim: new MeshStandardMaterial({ color: 0xf2a20c, roughness: 0.34, metalness: 0.65 }),
    trim: new MeshStandardMaterial({ color: 0x14100d, roughness: 0.55, metalness: 0.3 }),
    glass: new MeshStandardMaterial({ color: 0x0b1416, roughness: 0.08, metalness: 0.75 }),
    dark: new MeshStandardMaterial({ color: 0x050505, roughness: 0.9 }),
    headlight: emissive(0xffffff),
    tail: emissive(0xff2010),
    reverse: emissive(0x332f2a),
    indicatorLeft: emissive(0x4a2c00),
    indicatorRight: emissive(0x4a2c00),
    disposables: [],
  };
}

function addMesh(shared: Shared, geometry: BufferGeometry, material: Material, parent: Group = shared.body): Mesh {
  const mesh = new Mesh(geometry, material);
  parent.add(mesh);
  shared.disposables.push(geometry);
  return mesh;
}

/** Four wheels. Wheels stay outside the roll pivot, so the body visibly moves over them. */
function addWheels(shared: Shared, frontHalf: number = TUNING.vehicle.wheels.trackHalf, rearHalf: number = frontHalf): WheelVisual[] {
  const geometry = buildWheelGeometries();
  const tyreMaterial = new MeshStandardMaterial({ color: 0x0c0c0c, roughness: 0.92 });
  const { frontAxleZ, rearAxleZ } = TUNING.vehicle.wheels;
  const wheels: WheelVisual[] = [];
  for (const [isFront, isLeft] of [[true, true], [true, false], [false, true], [false, false]] as const) {
    const steer = new Group();
    const half = isFront ? frontHalf : rearHalf;
    steer.position.set(isLeft ? half : -half, WHEEL_REST_Y, isFront ? frontAxleZ : rearAxleZ);
    const spin = new Group();
    steer.add(spin);
    spin.add(new Mesh(geometry.tyre, tyreMaterial));
    spin.add(new Mesh(geometry.rim, shared.rim));
    shared.root.add(steer);
    wheels.push({ steer, spin });
  }
  shared.disposables.push(geometry.tyre, geometry.rim, tyreMaterial);
  return wheels;
}

/** The glow on the road, the soft shadow and the exhaust flames. */
function addEffects(shared: Shared, exhausts: ReadonlyArray<readonly [number, number, number]>, flameMaterialScale = 1): { underglow: Mesh; blobShadow: Mesh; flames: { outer: Mesh; inner: Mesh }[] } {
  const glowTexture = toTexture(createRadialCanvas(128));
  const underglow = new Mesh(
    new PlaneGeometry(3.6, 5.8),
    new MeshBasicMaterial({
      map: glowTexture,
      color: new Color(TUNING.world.colors.underglow),
      transparent: true,
      opacity: TUNING.rig.underglowOpacity,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  underglow.rotation.x = -Math.PI / 2;
  underglow.position.y = GROUND;
  underglow.renderOrder = 2;
  shared.root.add(underglow);

  const shadowTexture = toTexture(createRadialCanvas(128, 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0)'));
  const blobShadow = new Mesh(new PlaneGeometry(3.1, 5.3), new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
  blobShadow.rotation.x = -Math.PI / 2;
  blobShadow.position.y = GROUND - 0.01;
  blobShadow.renderOrder = 1;
  shared.root.add(blobShadow);

  const flameGeometry = new ConeGeometry(1, 1, 8, 1, true);
  flameGeometry.translate(0, -0.5, 0);
  flameGeometry.rotateX(-Math.PI / 2);
  const outerMaterial = new MeshBasicMaterial({ color: new Color(3.4 * flameMaterialScale, 1.15, 0.12), transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  const innerMaterial = new MeshBasicMaterial({ color: new Color(4, 3.1, 1.5), transparent: true, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
  const flames: { outer: Mesh; inner: Mesh }[] = [];
  for (const [x, y, z] of exhausts) {
    addMesh(shared, box(0.09, 0.09, 0.1, x, y, z + 0.05), shared.trim);
    const outer = new Mesh(flameGeometry, outerMaterial);
    outer.position.set(x, y, z);
    outer.visible = false;
    outer.frustumCulled = false;
    const inner = new Mesh(flameGeometry, innerMaterial);
    inner.position.copy(outer.position);
    inner.visible = false;
    inner.frustumCulled = false;
    shared.body.add(outer, inner);
    flames.push({ outer, inner });
  }
  shared.disposables.push(glowTexture, shadowTexture, flameGeometry);
  return { underglow, blobShadow, flames };
}

function addTail(shared: Shared, y: number, z: number, width = 0.72): void {
  // The words on the tail, painted by the player, and the number plate.
  const slogan = new Mesh(new PlaneGeometry(width, width / 4), new MeshStandardMaterial({ map: shared.painter.slogan, roughness: 0.5 }));
  slogan.position.set(0, y, z - 0.004);
  slogan.rotation.y = Math.PI;
  shared.body.add(slogan);
  const plateTexture = toTexture(createPlateCanvas());
  const plate = new Mesh(new PlaneGeometry(0.56, 0.14), new MeshStandardMaterial({ map: plateTexture, roughness: 0.6 }));
  plate.position.set(0, y - width * 0.27, z - 0.004);
  plate.rotation.y = Math.PI;
  shared.body.add(plate);
  shared.disposables.push(plateTexture, slogan.geometry, plate.geometry, slogan.material as Material, plate.material as Material);
}

/** Parts that share a material become one mesh, so that a car costs few draw calls. Flames stay apart, to be switched on and off. */
function mergeBody(shared: Shared): void {
  const groups = new Map<Material, Mesh[]>();
  for (const child of shared.body.children) {
    if (!(child instanceof Mesh) || !child.visible) continue;
    const list = groups.get(child.material as Material);
    if (list) list.push(child);
    else groups.set(child.material as Material, [child]);
  }
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const parts = meshes.map((mesh) => {
      mesh.updateMatrix();
      const part = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      part.applyMatrix4(mesh.matrix);
      return part;
    });
    const merged = mergeGeometries(parts);
    for (const part of parts) part.dispose();
    if (!merged) continue;
    for (const mesh of meshes) {
      shared.body.remove(mesh);
      mesh.geometry.dispose();
    }
    addMesh(shared, merged, material);
  }
}

function finish(shared: Shared, wheels: WheelVisual[], effects: ReturnType<typeof addEffects>, preset: QualityPreset, livery: LiveryDef): CarVisual {
  const { underglow, blobShadow, flames } = effects;
  mergeBody(shared);
  shared.root.traverse((object) => {
    if (object instanceof Mesh && object !== blobShadow && object !== underglow) object.castShadow = preset.shadows;
  });
  const glowMaterial = underglow.material as MeshBasicMaterial;
  const visual: CarVisual = {
    root: shared.root,
    bodyPivot: shared.bodyPivot,
    wheels,
    headlightMaterial: shared.headlight,
    tailMaterial: shared.tail,
    reverseMaterial: shared.reverse,
    indicatorLeft: shared.indicatorLeft,
    indicatorRight: shared.indicatorRight,
    underglow,
    blobShadow,
    flames,
    applyLivery(next: LiveryDef): void {
      shared.painter.paint(next);
      shared.roof.color.set(next.roof);
      shared.rim.color.set(next.rim);
      glowMaterial.color.set(next.glow);
    },
    dispose(): void {
      shared.painter.dispose();
      for (const item of shared.disposables) item.dispose();
      for (const material of [shared.paint, shared.roof, shared.rim, shared.trim, shared.glass, shared.dark, shared.headlight, shared.tail, shared.reverse, shared.indicatorLeft, shared.indicatorRight, glowMaterial, blobShadow.material as Material]) {
        material.dispose();
      }
    },
  };
  visual.applyLivery(livery);
  return visual;
}

function buildBulbuli(preset: QualityPreset, livery: LiveryDef): CarVisual {
  const shared = startCar(preset);
  const parts = buildBulbuliBody();
  addMesh(shared, parts.body, shared.paint);
  addMesh(shared, parts.glass, shared.glass);
  addMesh(shared, parts.roof, shared.roof);
  addMesh(shared, parts.trim, shared.trim);
  addMesh(shared, box(1.5, 0.56, 3.6, 0, -0.17, 0), shared.dark);
  addMesh(shared, box(0.92, 0.17, 0.08, 0, -0.17, 1.965), shared.trim);
  addMesh(shared, box(1.02, 0.035, 0.2, 0, 0.72, -1.03), shared.roof);
  addTail(shared, 0.03, -1.982);
  for (const side of [1, -1]) {
    addMesh(shared, box(0.36, 0.1, 0.1, side * 0.5, 0.045, 1.9), shared.headlight);
    addMesh(shared, box(0.42, 0.11, 0.05, side * 0.56, 0.1, -1.985), shared.tail);
    addMesh(shared, box(0.12, 0.05, 0.05, side * 0.46, 0.02, -1.985), shared.reverse);
    const indicator = side === 1 ? shared.indicatorLeft : shared.indicatorRight;
    addMesh(shared, box(0.11, 0.05, 0.08, side * 0.75, 0.04, 1.84), indicator);
    addMesh(shared, box(0.12, 0.05, 0.05, side * 0.68, 0.02, -1.985), indicator);
  }
  const wheels = addWheels(shared);
  const effects = addEffects(shared, [[0.38, -0.33, -2.01], [-0.38, -0.33, -2.01]]);
  return finish(shared, wheels, effects, preset, livery);
}

/** Any car from the kit: the same bodies the rivals drive, here in paint the player chose. */
function buildKitCar(car: CarDef, preset: QualityPreset, livery: LiveryDef): CarVisual {
  if (car.model === 'bulbuli' || car.model === 'rocket') throw new Error(`${car.model} has no kit body`);
  const shape = SHAPES[car.model];
  const fit = sideFit(shape.body);
  const shared = startCar(preset, fit.verticalScale);
  const half = shape.width / 2;
  const tail = -shape.length / 2;
  const nose = shape.length / 2;
  const g = GROUND;

  addMesh(shared, paintedLoft(shape.body, fit), shared.paint);
  addMesh(shared, paintedLoft(shape.cabin), shared.glass);
  addMesh(shared, box(shape.width - 0.54, 0.05, shape.roofFront - shape.roofBack, 0, g + shape.roofHeight, (shape.roofFront + shape.roofBack) / 2), shared.roof);
  addMesh(shared, box(shape.width + 0.04, 0.18, 0.14, 0, g + 0.34, nose + 0.03), shared.trim);
  addMesh(shared, box(shape.width + 0.04, 0.18, 0.14, 0, g + 0.38, tail - 0.03), shared.trim);
  addMesh(shared, box(shape.width - 0.3, 0.24, shape.length - 0.5, 0, g + 0.28, 0), shared.dark);
  // Dark arches behind the wheels, never taller than the side of the car they are cut into.
  const archTop = Math.min(0.7, shape.body[2].high - 0.04);
  for (const side of [-1, 1]) {
    for (const z of [TUNING.vehicle.wheels.frontAxleZ, TUNING.vehicle.wheels.rearAxleZ]) {
      addMesh(shared, box(0.05, archTop - 0.14, 0.88, side * (half + 0.012), g + (archTop + 0.14) / 2, z), shared.dark);
    }
    const headY = g + shape.body[0].high - 0.08;
    const tailY = g + shape.body[shape.body.length - 1].high - 0.14;
    addMesh(shared, box(0.38, 0.1, 0.05, side * (half - 0.34), headY, nose + 0.01), shared.headlight);
    addMesh(shared, box(0.44, 0.1, 0.05, side * (half - 0.3), tailY, tail - 0.01), shared.tail);
    addMesh(shared, box(0.12, 0.05, 0.05, side * (half - 0.54), tailY - 0.08, tail - 0.01), shared.reverse);
    const indicator = side > 0 ? shared.indicatorLeft : shared.indicatorRight;
    addMesh(shared, box(0.1, 0.05, 0.06, side * (half - 0.1), headY - 0.02, nose - 0.02), indicator);
    addMesh(shared, box(0.1, 0.05, 0.05, side * (half - 0.08), tailY - 0.08, tail - 0.01), indicator);
  }
  // What makes each shape itself: wings, scoops, beds and bars.
  if (shape.spoiler) {
    const s = shape.spoiler;
    addMesh(shared, box(s.width, 0.06, 0.34, 0, g + s.y, s.z), shared.roof);
    for (const side of [-0.6, 0.6]) addMesh(shared, box(0.06, 0.26, 0.2, side * (s.width / 1.6), g + s.y - 0.14, s.z), shared.trim);
  }
  if (shape.scoop) addMesh(shared, box(0.5, 0.12, 0.7, 0, g + shape.body[1].high + 0.08, shape.body[1].z - 0.1), shared.trim);
  if (shape.bed) {
    addMesh(shared, box(shape.width - 0.3, 0.05, 1.5, 0, g + 1.02, -1.35), shared.trim);
    addMesh(shared, box(shape.width - 0.2, 0.06, 0.06, 0, g + 1.42, -0.5), shared.trim);
    for (const side of [-1, 1]) addMesh(shared, box(0.06, 0.42, 0.06, side * (half - 0.14), g + 1.21, -0.5), shared.trim);
  }
  if (shape.bullBar) {
    for (const y of [0.5, 0.82]) addMesh(shared, box(1.34, 0.08, 0.08, 0, g + y, nose + 0.16), shared.trim);
    for (const x of [-0.58, 0.58]) addMesh(shared, box(0.08, 0.5, 0.08, x, g + 0.66, nose + 0.15), shared.trim);
  }
  if (shape.fins) {
    for (const side of [-1, 1]) {
      addMesh(shared, box(0.04, 0.5, 1.5, side * 0.72, g + 0.98, -1.6), shared.roof);
    }
    addMesh(shared, box(0.03, 0.38, 1.1, 0, g + 1.14, -1.2), shared.roof);
  }
  if (shape.splitter) addMesh(shared, box(shape.width + 0.14, 0.04, 0.5, 0, g + 0.16, nose - 0.05), shared.roof);

  addTail(shared, g + shape.body[shape.body.length - 1].high - 0.32, tail - 0.012);
  const wheels = addWheels(shared, Math.max(TUNING.vehicle.wheels.trackHalf, half - 0.02));
  const effects = addEffects(shared, [[0.38, g + 0.3, tail - 0.08], [-0.38, g + 0.3, tail - 0.08]]);
  return finish(shared, wheels, effects, preset, livery);
}

/**
 * রিকশা রকেট: a rickshaw that has met a rocket. A padded bench under a raised hood, handlebars with
 * streamers, a painted box behind and two big tubes either side. It is sold for one taka.
 */
const ROCKET_BODY: readonly Station[] = [
  { z: 2.0, bottom: 0.24, top: 0.2, low: 0.62, high: 0.8 },
  { z: 0.95, bottom: 0.3, top: 0.28, low: 0.6, high: 0.84 },
  { z: 0.35, bottom: 0.82, top: 0.78, low: 0.32, high: 0.88 },
  { z: -1.7, bottom: 0.86, top: 0.82, low: 0.32, high: 0.92 },
  { z: -2.05, bottom: 0.76, top: 0.7, low: 0.38, high: 0.9 },
];

function buildRocket(preset: QualityPreset, livery: LiveryDef): CarVisual {
  const fit = sideFit(ROCKET_BODY);
  const shared = startCar(preset, fit.verticalScale);
  const g = GROUND;

  addMesh(shared, paintedLoft(ROCKET_BODY, fit), shared.paint);
  addMesh(shared, box(1.4, 0.2, 2.3, 0, g + 0.28, -0.85), shared.dark);
  addMesh(shared, box(0.05, 0.56, 0.88, 0.872, g + 0.42, TUNING.vehicle.wheels.rearAxleZ), shared.dark);
  addMesh(shared, box(0.05, 0.56, 0.88, -0.872, g + 0.42, TUNING.vehicle.wheels.rearAxleZ), shared.dark);

  const parts = new ModelBuilder();
  const steel = 0x8c9198;
  const seat = 0xc2185b;
  const brass = 0xd9a312;
  // The bench, in padded rani pink, as is proper, and a saddle for whoever pedals.
  parts.box(1.14, 0.16, 0.76, 0, g + 1.0, -0.32, seat);
  parts.box(1.14, 0.6, 0.14, 0, g + 1.34, -0.74, seat);
  for (let i = -2; i <= 2; i++) parts.box(0.04, 0.56, 0.02, i * 0.22, g + 1.34, -0.66, brass);
  parts.box(0.26, 0.08, 0.34, 0, g + 1.12, 0.62, 0x1b1410);
  parts.box(0.05, 0.3, 0.05, 0, g + 0.96, 0.62, steel);
  // Handlebars and a bell.
  parts.box(0.06, 0.72, 0.06, 0, g + 1.12, 1.3, steel);
  parts.box(0.86, 0.05, 0.05, 0, g + 1.46, 1.28, steel);
  parts.add(new CylinderGeometry(0.05, 0.05, 0.04, 10), brass, 0.3, g + 1.51, 1.28);
  // Streamers from each end of the bars.
  const colours = [0xf2a20c, 0xd8402b, 0x5fa52f, 0xefe3c8];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) parts.box(0.03, 0.4, 0.012, side * (0.4 + i * 0.012), g + 1.25, 1.28 + (i - 1.5) * 0.05, colours[i]);
  }
  // A guard over the two front wheels, which read as one.
  parts.box(0.8, 0.04, 0.9, 0, g + 0.6, TUNING.vehicle.wheels.frontAxleZ, 0x1b1410);
  // Two rocket tubes, with painted noses and fins, either side of the bench.
  for (const side of [-1, 1]) {
    parts.add(new CylinderGeometry(0.2, 0.22, 1.6, 12), 0xc8ccd0, side * 0.82, g + 1.1, -1.2, { rotX: Math.PI / 2 });
    parts.add(new ConeGeometry(0.2, 0.5, 12), 0xd8402b, side * 0.82, g + 1.1, -0.15, { rotX: Math.PI / 2 });
    parts.box(0.03, 0.36, 0.46, side * 1.04, g + 1.14, -1.76, 0xf2a20c);
    parts.box(0.26, 0.03, 0.46, side * 0.82, g + 1.34, -1.76, 0xf2a20c);
    parts.box(0.46, 0.05, 0.05, side * 0.82, g + 0.92, -0.6, 0x1b1410);
    parts.box(0.46, 0.05, 0.05, side * 0.82, g + 0.92, -1.6, 0x1b1410);
  }
  addMesh(shared, parts.build(), useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 })));

  // The raised hood, in the roof colour, with dark ribs over it like the real thing.
  shared.roof.side = DoubleSide;
  const hoodRadius = 0.74;
  const hood = new CylinderGeometry(hoodRadius, hoodRadius, 1.16, 14, 1, true, 0, Math.PI);
  hood.rotateZ(Math.PI / 2);
  const hoodMesh = addMesh(shared, hood, shared.roof);
  hoodMesh.position.set(0, g + 1.02, -0.66);
  hoodMesh.rotation.x = -0.42;
  for (const x of [-0.56, -0.28, 0, 0.28, 0.56]) {
    const rib = new CylinderGeometry(hoodRadius + 0.012, hoodRadius + 0.012, 0.04, 14, 1, true, 0, Math.PI);
    rib.rotateZ(Math.PI / 2);
    rib.translate(x, 0, 0);
    const ribMesh = addMesh(shared, rib, shared.trim);
    ribMesh.position.copy(hoodMesh.position);
    ribMesh.rotation.copy(hoodMesh.rotation);
  }

  addMesh(shared, new CylinderGeometry(0.15, 0.15, 0.08, 14).rotateX(Math.PI / 2).translate(0, g + 1.2, 1.36), shared.headlight);
  for (const side of [-1, 1]) {
    addMesh(shared, box(0.22, 0.1, 0.05, side * 0.36, g + 0.8, -2.07), shared.tail);
    addMesh(shared, box(0.08, 0.05, 0.05, side * 0.18, g + 0.72, -2.07), shared.reverse);
    const indicator = side > 0 ? shared.indicatorLeft : shared.indicatorRight;
    addMesh(shared, box(0.08, 0.05, 0.08, side * 0.5, g + 1.46, 1.28), indicator);
    addMesh(shared, box(0.08, 0.05, 0.05, side * 0.56, g + 0.8, -2.07), indicator);
  }
  addTail(shared, g + 0.62, -2.052, 0.8);

  // The front wheels sit close together, as if there were only one.
  const wheels = addWheels(shared, 0.2, 0.9);
  const effects = addEffects(shared, [[0.82, g + 1.1, -2.02], [-0.82, g + 1.1, -2.02]], 1.2);
  return finish(shared, wheels, effects, preset, livery);
}

/** Builds whichever car is wanted, in the paint given. */
export function createCarVisual(car: CarDef, livery: LiveryDef, preset: QualityPreset): CarVisual {
  if (car.model === 'bulbuli') return buildBulbuli(preset, livery);
  if (car.model === 'rocket') return buildRocket(preset, livery);
  return buildKitCar(car, preset, livery);
}
