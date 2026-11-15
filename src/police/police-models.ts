/**
 * The বিশেষ ধাওয়া ইউনিট fleet, built from code: a squat sedan with a push bar and a painted side,
 * the helicopter and the drone. All of it is invented, with no real force's livery or insignia.
 */

import { BufferGeometry, CanvasTexture, CylinderGeometry } from 'three';
import { worldText } from '../i18n';
import { ModelBuilder, type UvRect } from '../render/model-builder';
import { FONT_DISPLAY, FONT_STRONG, PAINT, drawFlower, makeCanvas, paintGrain, toTexture } from '../render/painted-textures';

const ATLAS_WIDTH = 512;
const ATLAS_HEIGHT = 256;
/** Ground under the car, in the body's own coordinates. */
const GROUND = -0.62;

function rect(x: number, y: number, width: number, height: number): UvRect {
  return [x / ATLAS_WIDTH, 1 - (y + height) / ATLAS_HEIGHT, (x + width) / ATLAS_WIDTH, 1 - y / ATLAS_HEIGHT];
}

const ART = {
  side: rect(0, 0, 512, 110),
  back: rect(0, 112, 256, 62),
  heli: rect(256, 112, 256, 62),
};

/** Painted lettering, in the same hand as the rest of the city. */
export function createPoliceAtlas(anisotropy: number): CanvasTexture {
  const { canvas, ctx } = makeCanvas(ATLAS_WIDTH, ATLAS_HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);

  // Side: a tomato and indigo band, with the unit's name.
  ctx.fillStyle = PAINT.tin;
  ctx.fillRect(0, 0, 512, 110);
  ctx.save();
  paintGrain(ctx, 512, 110, 83, 0.1);
  ctx.restore();
  ctx.fillStyle = PAINT.tomato;
  ctx.fillRect(0, 76, 512, 22);
  ctx.fillStyle = PAINT.indigo;
  ctx.fillRect(0, 98, 512, 12);
  drawFlower(ctx, 40, 38, 24, PAINT.tomato, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, 472, 38, 24, PAINT.tomato, PAINT.marigold, PAINT.tin);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 44px ${FONT_STRONG}`;
  ctx.fillStyle = PAINT.indigo;
  ctx.fillText(worldText('sign.policeUnit'), 256, 40, 370);

  // Back and helicopter belly.
  ctx.fillStyle = PAINT.indigo;
  ctx.fillRect(0, 112, 256, 62);
  ctx.font = `44px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAINT.marigold;
  ctx.fillText(worldText('sign.policeShort'), 128, 142, 230);
  ctx.fillStyle = PAINT.tin;
  ctx.fillRect(256, 112, 256, 62);
  ctx.font = `800 34px ${FONT_STRONG}`;
  ctx.fillStyle = PAINT.indigo;
  ctx.fillText(worldText('sign.policeUnit'), 384, 143, 236);

  return toTexture(canvas, anisotropy);
}

const WHITE = 0xffffff;
const TRIM = 0x20242a;
const GLASS = 0x141b21;

/** Faces +Z, centred on the physics body. The instance colour tints the paint by heat level. */
export function buildPoliceCar(): BufferGeometry {
  const b = new ModelBuilder();
  const g = GROUND;
  // A low, wide body, with a raised bonnet and boot.
  b.box(1.84, 0.5, 4.16, 0, g + 0.56, 0, WHITE);
  b.box(1.74, 0.16, 1.26, 0, g + 0.88, 1.42, WHITE);
  b.box(1.74, 0.14, 0.96, 0, g + 0.87, -1.6, WHITE);
  // Cabin glass, then the roof.
  b.box(1.6, 0.52, 2.02, 0, g + 1.1, -0.2, GLASS);
  b.box(1.62, 0.07, 1.64, 0, g + 1.4, -0.26, WHITE);
  // Pillars break up the glass.
  for (const side of [-1, 1]) {
    b.box(0.09, 0.5, 0.1, side * 0.78, g + 1.1, 0.78, WHITE);
    b.box(0.09, 0.5, 0.12, side * 0.78, g + 1.1, -0.22, WHITE);
    b.box(0.09, 0.5, 0.14, side * 0.78, g + 1.1, -1.16, WHITE);
  }
  // Bumpers, and a heavy push bar that gives the car its outline.
  b.box(1.9, 0.24, 0.2, 0, g + 0.44, 2.12, TRIM);
  b.box(1.9, 0.24, 0.2, 0, g + 0.44, -2.12, TRIM);
  for (const y of [0.56, 0.86]) b.box(1.36, 0.08, 0.08, 0, g + y, 2.3, 0x2b2f35);
  for (const x of [-0.6, 0.6]) b.box(0.08, 0.52, 0.08, x, g + 0.7, 2.28, 0x2b2f35);
  // Wheel wells.
  for (const side of [-1, 1]) {
    for (const z of [1.33, -1.33]) b.box(0.04, 0.54, 0.86, side * 0.92, g + 0.42, z, 0x0b0c0e);
  }
  // Lamps.
  for (const side of [-1, 1]) {
    b.box(0.46, 0.14, 0.04, side * 0.6, g + 0.76, 2.06, 0xffffff, { glow: [3.2, 3, 2.4] });
    b.box(0.5, 0.14, 0.04, side * 0.58, g + 0.76, -2.06, 0xff4030, { glow: [3, 0.28, 0.18] });
  }
  // Painted sides and the back.
  b.panel(3.0, 0.42, 0.925, g + 0.58, 0, WHITE, { rotY: Math.PI / 2, uv: ART.side });
  b.panel(3.0, 0.42, -0.925, g + 0.58, 0, WHITE, { rotY: -Math.PI / 2, uv: ART.side });
  b.panel(1.2, 0.3, 0, g + 0.56, -2.09, WHITE, { rotY: Math.PI, uv: ART.back });
  // The light bar's mount.
  b.box(1.24, 0.08, 0.34, 0, g + 1.47, -0.1, TRIM);
  return b.build();
}

/** Where the flashing lamps sit, in the car's coordinates. */
export const LAMP_OFFSETS = [
  { x: 0.34, y: GROUND + 1.56, z: -0.1 },
  { x: -0.34, y: GROUND + 1.56, z: -0.1 },
] as const;

export function buildPoliceWheel(radius: number): BufferGeometry {
  const b = new ModelBuilder();
  b.cylinderX(radius, 0.25, 0, 0, 0, 0x101114, 12);
  b.cylinderX(radius * 0.55, 0.27, 0, 0, 0, 0x8c9198, 8);
  return b.build();
}

/** A metal bar with teeth, spanning x from -1 to 1. Scaled to the road's width where it lies. */
export function buildSpikeStrip(): BufferGeometry {
  const b = new ModelBuilder();
  b.box(2, 0.04, 0.46, 0, 0.03, 0, 0x24272b);
  for (let i = -8; i <= 8; i++) {
    for (const z of [-0.14, 0.14]) {
      b.cone(0.035, 0.17, (i / 8) * 0.96, 0.13, z + (i % 2) * 0.05, 0xc8ccd0, 4);
    }
  }
  return b.build();
}

/** Faces +Z. About twelve metres nose to tail. */
export function buildHelicopterBody(): BufferGeometry {
  const b = new ModelBuilder();
  b.box(1.9, 1.7, 3.8, 0, 0, 0.5, PAINT_INDIGO);
  b.box(1.6, 1.1, 1.3, 0, -0.1, 2.9, GLASS);
  b.box(1.5, 0.3, 1.2, 0, 0.75, 2.5, PAINT_INDIGO);
  b.box(0.42, 0.42, 5.8, 0, 0.32, -4, PAINT_INDIGO);
  b.box(0.1, 1.5, 0.8, 0, 1, -6.7, PAINT_TOMATO);
  b.box(1.6, 0.08, 0.5, 0, 0.45, -6, PAINT_TOMATO);
  b.box(0.9, 0.3, 0.9, 0, 1.05, 0.2, 0x2a2d33);
  for (const side of [-1, 1]) {
    b.box(0.09, 0.09, 3.4, side * 1.1, -1.5, 0.6, 0x1a1c20);
    b.box(0.07, 0.7, 0.07, side * 1, -1.15, 1.5, 0x1a1c20);
    b.box(0.07, 0.7, 0.07, side * 1, -1.15, -0.3, 0x1a1c20);
    b.panel(3.2, 0.78, side * 0.96, 0.1, 0.5, WHITE, { rotY: (side * Math.PI) / 2, uv: ART.heli });
  }
  b.box(0.14, 0.14, 0.14, 0, -0.9, 2.5, 0xffffff, { glow: [4, 3.6, 2.8] });
  b.box(0.1, 0.1, 0.1, 0.1, 1.76, -6.9, 0xff4030, { glow: [5, 0.4, 0.25] });
  return b.build();
}

const PAINT_INDIGO = 0x26336d;
const PAINT_TOMATO = 0xd8402b;

export function buildRotor(): BufferGeometry {
  const b = new ModelBuilder();
  b.add(new CylinderGeometry(0.16, 0.16, 0.3, 8), 0x1a1c20, 0, 0, 0);
  b.box(13, 0.05, 0.28, 0, 0.14, 0, 0x2a2d33);
  b.box(0.28, 0.05, 13, 0, 0.14, 0, 0x2a2d33);
  return b.build();
}

export function buildTailRotor(): BufferGeometry {
  const b = new ModelBuilder();
  b.box(0.05, 2.2, 0.16, 0, 0, 0, 0x2a2d33);
  b.box(0.05, 0.16, 2.2, 0, 0, 0, 0x2a2d33);
  return b.build();
}

/** A small four-armed quadcopter, big enough to read against the night sky. */
export function buildDrone(): BufferGeometry {
  const b = new ModelBuilder();
  b.box(0.7, 0.2, 0.7, 0, 0, 0, 0x2a2d33);
  b.box(0.4, 0.14, 0.4, 0, -0.17, 0.05, 0x14161a);
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    b.box(0.1, 0.05, 1.1, x * 0.36, 0, z * 0.36, 0x1e2024, { rotY: (x * z * Math.PI) / 4 });
    b.add(new CylinderGeometry(0.42, 0.42, 0.03, 12), 0x3a3d43, x * 0.72, 0.1, z * 0.72);
  }
  return b.build();
}
