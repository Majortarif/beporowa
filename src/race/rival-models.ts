/**
 * The rivals' cars, built from code: eight original bodies from one lofting kit.
 * No real car's shape is copied. All face +Z and are centred on the physics body.
 */

import { BufferAttribute, BufferGeometry, CanvasTexture } from 'three';
import type { RivalModel } from '../config/rivals';
import { RIVALS } from '../config/rivals';
import { worldText } from '../i18n';
import { ModelBuilder, type UvRect } from '../render/model-builder';
import { FONT_STRONG, makeCanvas, toTexture } from '../render/painted-textures';

/** Ground under the car, in the body's own coordinates. */
const GROUND = -0.62;
const GLASS = 0x10161c;
const TRIM = 0x181b20;

export interface Station {
  z: number;
  /** Half width at the bottom and at the top of the section. */
  bottom: number;
  top: number;
  /** Heights above the ground. */
  low: number;
  high: number;
}

export interface BodyShape {
  length: number;
  width: number;
  /** Lower body, nose to tail. */
  body: Station[];
  /** Cabin, windscreen to rear window. */
  cabin: Station[];
  /** Height of the roof panel, and where it starts and stops. */
  roofFront: number;
  roofBack: number;
  roofHeight: number;
  spoiler?: { z: number; y: number; width: number };
  scoop?: boolean;
  bed?: boolean;
  fins?: boolean;
  splitter?: boolean;
  bullBar?: boolean;
}

function station(z: number, bottom: number, top: number, low: number, high: number): Station {
  return { z, bottom, top, low, high };
}

export const SHAPES: Record<RivalModel, BodyShape> = {
  // A cheeky little hatch, tall and short.
  hatch: {
    length: 3.8,
    width: 1.72,
    body: [station(1.9, 0.62, 0.62, 0.36, 0.72), station(1.5, 0.84, 0.82, 0.3, 0.86), station(0, 0.86, 0.84, 0.28, 0.92), station(-1.5, 0.84, 0.8, 0.3, 0.96), station(-1.9, 0.72, 0.68, 0.38, 0.92)],
    cabin: [station(0.82, 0.8, 0.66, 0.9, 1.42), station(-0.2, 0.8, 0.68, 0.92, 1.5), station(-1.72, 0.78, 0.66, 0.92, 1.42)],
    roofFront: 0.4,
    roofBack: -1.55,
    roofHeight: 1.52,
  },
  // A sharp, flat-nosed wedge.
  wedge: {
    length: 4.2,
    width: 1.8,
    body: [station(2.1, 0.74, 0.7, 0.3, 0.46), station(1.3, 0.88, 0.84, 0.26, 0.68), station(0, 0.9, 0.86, 0.26, 0.82), station(-1.6, 0.9, 0.84, 0.28, 0.86), station(-2.1, 0.82, 0.76, 0.36, 0.84)],
    cabin: [station(0.7, 0.82, 0.58, 0.72, 1.16), station(-0.5, 0.82, 0.6, 0.8, 1.22), station(-1.6, 0.8, 0.62, 0.82, 1.02)],
    roofFront: 0.18,
    roofBack: -1.05,
    roofHeight: 1.24,
    spoiler: { z: -1.98, y: 1.02, width: 1.62 },
  },
  // A sensible three-box family car, with more under it than it looks.
  saloon: {
    length: 4.4,
    width: 1.78,
    body: [station(2.2, 0.72, 0.68, 0.32, 0.64), station(1.6, 0.88, 0.84, 0.28, 0.8), station(0, 0.9, 0.86, 0.28, 0.88), station(-1.7, 0.88, 0.84, 0.3, 0.92), station(-2.2, 0.78, 0.72, 0.4, 0.88)],
    cabin: [station(1, 0.82, 0.66, 0.84, 1.34), station(-0.4, 0.82, 0.68, 0.88, 1.4), station(-1.3, 0.82, 0.68, 0.88, 1.32)],
    roofFront: 0.5,
    roofBack: -0.95,
    roofHeight: 1.42,
  },
  // A work truck, with a bed and a bar to push with.
  pickup: {
    length: 4.5,
    width: 1.86,
    body: [station(2.25, 0.76, 0.74, 0.38, 0.82), station(1.5, 0.92, 0.9, 0.34, 0.98), station(0, 0.93, 0.92, 0.34, 1), station(-2.25, 0.92, 0.9, 0.36, 1.02)],
    cabin: [station(1.1, 0.84, 0.72, 0.98, 1.56), station(0.2, 0.84, 0.74, 1, 1.62), station(-0.4, 0.84, 0.74, 1, 1.58)],
    roofFront: 0.72,
    roofBack: -0.36,
    roofHeight: 1.64,
    bed: true,
    bullBar: true,
  },
  // A low two-door with a long sweep to its roof.
  coupe: {
    length: 4.3,
    width: 1.84,
    body: [station(2.15, 0.76, 0.72, 0.28, 0.5), station(1.4, 0.92, 0.88, 0.24, 0.72), station(0, 0.92, 0.86, 0.24, 0.8), station(-1.5, 0.94, 0.88, 0.26, 0.84), station(-2.15, 0.84, 0.76, 0.34, 0.78)],
    cabin: [station(0.72, 0.82, 0.54, 0.74, 1.12), station(-0.3, 0.82, 0.58, 0.78, 1.2), station(-1.7, 0.84, 0.66, 0.82, 0.92)],
    roofFront: 0.26,
    roofBack: -0.9,
    roofHeight: 1.22,
  },
  // Long nose, low roof, and a wide tail: built for straights.
  grand: {
    length: 4.7,
    width: 1.9,
    body: [station(2.35, 0.78, 0.74, 0.26, 0.52), station(1.5, 0.94, 0.9, 0.22, 0.74), station(0, 0.95, 0.88, 0.22, 0.78), station(-1.7, 0.98, 0.92, 0.24, 0.86), station(-2.35, 0.9, 0.82, 0.32, 0.84)],
    cabin: [station(0.3, 0.84, 0.56, 0.74, 1.08), station(-0.8, 0.84, 0.6, 0.76, 1.14), station(-1.95, 0.86, 0.68, 0.82, 0.94)],
    roofFront: -0.1,
    roofBack: -1.3,
    roofHeight: 1.16,
    spoiler: { z: -2.28, y: 1.06, width: 1.78 },
  },
  // Wide shoulders, a raised hood and a stripe down the middle.
  muscle: {
    length: 4.55,
    width: 1.96,
    body: [station(2.27, 0.84, 0.8, 0.32, 0.66), station(1.5, 0.98, 0.94, 0.28, 0.9), station(0, 0.98, 0.92, 0.28, 0.94), station(-1.6, 1, 0.94, 0.3, 0.98), station(-2.27, 0.92, 0.86, 0.38, 0.96)],
    cabin: [station(0.5, 0.86, 0.62, 0.92, 1.28), station(-0.6, 0.86, 0.64, 0.94, 1.34), station(-1.6, 0.88, 0.7, 0.96, 1.12)],
    roofFront: 0.05,
    roofBack: -1.1,
    roofHeight: 1.36,
    scoop: true,
    spoiler: { z: -2.2, y: 1.12, width: 1.8 },
  },
  // জাহান's car: hardly a road car at all.
  proto: {
    length: 4.7,
    width: 2,
    body: [station(2.35, 0.9, 0.84, 0.2, 0.38), station(1.2, 1, 0.92, 0.18, 0.58), station(0, 0.98, 0.84, 0.18, 0.66), station(-1.6, 1.02, 0.92, 0.2, 0.82), station(-2.35, 0.98, 0.9, 0.3, 0.84)],
    cabin: [station(0.85, 0.66, 0.42, 0.56, 1.02), station(-0.2, 0.68, 0.46, 0.62, 1.1), station(-1.4, 0.66, 0.5, 0.72, 0.9)],
    roofFront: 0.3,
    roofBack: -0.75,
    roofHeight: 1.12,
    spoiler: { z: -2.3, y: 1.22, width: 2 },
    fins: true,
    splitter: true,
  },
};

/** Lofts a closed body through its stations. */
function loft(stations: readonly Station[]): BufferGeometry {
  const positions: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[]): void => {
    positions.push(...a, ...b, ...c, ...a, ...c, ...d);
  };
  for (let i = 0; i + 1 < stations.length; i++) {
    const f = stations[i];
    const r = stations[i + 1];
    const y = (value: number): number => GROUND + value;
    // Each side, the top and the bottom.
    quad([f.bottom, y(f.low), f.z], [r.bottom, y(r.low), r.z], [r.top, y(r.high), r.z], [f.top, y(f.high), f.z]);
    quad([-f.bottom, y(f.low), f.z], [-f.top, y(f.high), f.z], [-r.top, y(r.high), r.z], [-r.bottom, y(r.low), r.z]);
    quad([f.top, y(f.high), f.z], [r.top, y(r.high), r.z], [-r.top, y(r.high), r.z], [-f.top, y(f.high), f.z]);
    quad([f.bottom, y(f.low), f.z], [-f.bottom, y(f.low), f.z], [-r.bottom, y(r.low), r.z], [r.bottom, y(r.low), r.z]);
  }
  const front = stations[0];
  const back = stations[stations.length - 1];
  const y = (value: number): number => GROUND + value;
  quad([front.bottom, y(front.low), front.z], [front.top, y(front.high), front.z], [-front.top, y(front.high), front.z], [-front.bottom, y(front.low), front.z]);
  quad([back.bottom, y(back.low), back.z], [-back.bottom, y(back.low), back.z], [-back.top, y(back.high), back.z], [back.top, y(back.high), back.z]);
  const geometry = new BufferGeometry();
  const count = positions.length / 3;
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  geometry.computeVertexNormals();
  return geometry;
}

const ATLAS_WIDTH = 512;
const ROW_HEIGHT = 64;
const ROWS = RIVALS.length;
const ATLAS_HEIGHT = ROW_HEIGHT * (ROWS + 1);

function rowRect(row: number): UvRect {
  const top = 1 - (row * ROW_HEIGHT) / ATLAS_HEIGHT;
  return [0, top - ROW_HEIGHT / ATLAS_HEIGHT, 1, top];
}

/** Each rival's nickname, painted on the door. The last row stays white, for parts with no art. */
export function createRivalAtlas(anisotropy: number): CanvasTexture {
  const { canvas, ctx } = makeCanvas(ATLAS_WIDTH, ATLAS_HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  RIVALS.forEach((rival, row) => {
    const y = row * ROW_HEIGHT;
    const stripe = `#${rival.stripe.toString(16).padStart(6, '0')}`;
    const body = `#${rival.body.toString(16).padStart(6, '0')}`;
    ctx.fillStyle = body;
    ctx.fillRect(0, y, ATLAS_WIDTH, ROW_HEIGHT);
    ctx.fillStyle = stripe;
    ctx.fillRect(0, y + ROW_HEIGHT - 8, ATLAS_WIDTH, 8);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 40px ${FONT_STRONG}`;
    ctx.fillStyle = '#1b1410';
    ctx.fillText(worldText(`rival.${rival.id}.nick`), ATLAS_WIDTH / 2 + 2, y + 28, 440);
    ctx.fillStyle = stripe;
    ctx.fillText(worldText(`rival.${rival.id}.nick`), ATLAS_WIDTH / 2, y + 26, 440);
  });
  return toTexture(canvas, anisotropy);
}

/** UV rectangle of plain white, in this atlas. */
const PLAIN: UvRect = [0.01, 0.002, 0.02, 0.01];

export interface CarLook {
  model: RivalModel;
  body: number;
  stripe: number;
  /** Lamps stay off, and the car is hard to see. */
  lightsOff: boolean;
  /** Row of the nickname in the atlas, or -1 for no nickname. */
  nameRow: number;
}

/** Builds one car's body. Wheels are drawn separately. */
export function buildRivalCar(look: CarLook): BufferGeometry {
  const shape = SHAPES[look.model];
  const b = new ModelBuilder();
  const halfLength = shape.length / 2;
  const halfWidth = shape.width / 2;
  const options = { uv: PLAIN };

  b.add(loft(shape.body), look.body, 0, 0, 0, options);
  b.add(loft(shape.cabin), GLASS, 0, 0, 0, options);
  // The roof, in the body's colour, so the cabin reads as a glasshouse.
  b.box(shape.width - 0.54, 0.05, shape.roofFront - shape.roofBack, 0, GROUND + shape.roofHeight, (shape.roofFront + shape.roofBack) / 2, look.body, options);

  // A stripe down the middle, and bumpers in dark trim.
  const hoodTop = shape.body[1].high;
  b.box(0.42, 0.015, 1.3, 0, GROUND + hoodTop + 0.03, shape.body[1].z - 0.2, look.stripe, options);
  b.box(shape.width + 0.04, 0.18, 0.14, 0, GROUND + 0.34, halfLength + 0.03, TRIM, options);
  b.box(shape.width + 0.04, 0.18, 0.14, 0, GROUND + 0.38, -halfLength - 0.03, TRIM, options);

  // Wheel arches.
  for (const side of [-1, 1]) {
    for (const z of [1.33, -1.33]) b.box(0.05, 0.56, 0.88, side * (halfWidth + 0.015), GROUND + 0.42, z, 0x08090b, options);
  }

  // Lamps. A car that runs dark keeps them black.
  const headGlow: [number, number, number] = look.lightsOff ? [0, 0, 0] : [3.4, 3.1, 2.4];
  const tailGlow: [number, number, number] = look.lightsOff ? [0.25, 0.02, 0.02] : [2.4, 0.22, 0.14];
  for (const side of [-1, 1]) {
    b.box(0.38, 0.1, 0.04, side * (halfWidth - 0.34), GROUND + shape.body[0].high - 0.08, halfLength + 0.01, look.lightsOff ? 0x20242a : 0xffffff, { uv: PLAIN, glow: headGlow });
    b.box(0.44, 0.1, 0.04, side * (halfWidth - 0.3), GROUND + shape.body[shape.body.length - 1].high - 0.14, -halfLength - 0.01, 0xff3020, { uv: PLAIN, glow: tailGlow });
  }

  // Nickname on the door, both sides.
  if (look.nameRow >= 0) {
    const rect = rowRect(look.nameRow);
    const y = GROUND + 0.56;
    b.panel(1.7, 0.21, halfWidth + 0.022, y, -0.1, 0xffffff, { rotY: Math.PI / 2, uv: rect });
    b.panel(1.7, 0.21, -halfWidth - 0.022, y, -0.1, 0xffffff, { rotY: -Math.PI / 2, uv: rect });
  }

  if (shape.spoiler) {
    const s = shape.spoiler;
    b.box(s.width, 0.06, 0.34, 0, GROUND + s.y, s.z, look.stripe, options);
    for (const side of [-0.6, 0.6]) b.box(0.06, 0.26, 0.2, side * (s.width / 1.6), GROUND + s.y - 0.14, s.z, TRIM, options);
  }
  if (shape.scoop) {
    b.box(0.5, 0.12, 0.7, 0, GROUND + hoodTop + 0.08, shape.body[1].z - 0.1, TRIM, options);
    b.box(0.24, 0.015, shape.length - 0.6, 0, GROUND + shape.roofHeight + 0.03, 0, look.stripe, options);
  }
  if (shape.bed) {
    b.box(shape.width - 0.3, 0.05, 1.5, 0, GROUND + 1.02, -1.35, 0x1b1410, options);
    b.box(shape.width - 0.2, 0.06, 0.06, 0, GROUND + 1.42, -0.5, 0x2b2f35, options);
    for (const side of [-1, 1]) b.box(0.06, 0.42, 0.06, side * (halfWidth - 0.14), GROUND + 1.21, -0.5, 0x2b2f35, options);
  }
  if (shape.bullBar) {
    for (const y of [0.5, 0.82]) b.box(1.34, 0.08, 0.08, 0, GROUND + y, halfLength + 0.16, 0x2b2f35, options);
    for (const x of [-0.58, 0.58]) b.box(0.08, 0.5, 0.08, x, GROUND + 0.66, halfLength + 0.15, 0x2b2f35, options);
  }
  if (shape.fins) {
    for (const side of [-1, 1]) {
      b.box(0.04, 0.5, 1.5, side * 0.72, GROUND + 0.98, -1.6, look.stripe, options);
      b.box(0.3, 0.3, 1.4, side * (halfWidth - 0.1), GROUND + 0.46, 0.1, TRIM, options);
    }
    b.box(0.03, 0.38, 1.1, 0, GROUND + 1.14, -1.2, look.stripe, options);
  }
  if (shape.splitter) {
    b.box(shape.width + 0.14, 0.04, 0.5, 0, GROUND + 0.16, halfLength - 0.05, look.stripe, options);
  }
  return b.build();
}
