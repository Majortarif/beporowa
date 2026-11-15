/**
 * Original low-poly traffic, built from code. Every model faces +Z with its wheels on y = 0.
 * Rickshaw panels and bus sides use hand-painted art from one canvas atlas.
 */

import type { BufferGeometry, CanvasTexture } from 'three';
import { createRng } from '../core/math';
import { worldText } from '../i18n';
import {
  FONT_DISPLAY,
  FONT_STRONG,
  PAINT,
  drawFlower,
  drawLeaf,
  drawMotifBand,
  makeCanvas,
  paintGrain,
  toTexture,
} from '../render/painted-textures';
import { ModelBuilder, type UvRect } from '../render/model-builder';

const ATLAS_SIZE = 1024;
const PANEL = 256;
const STRIP = 256;

/** Canvas y runs down and texture v runs up. */
function rect(x: number, y: number, width: number, height: number): UvRect {
  return [x / ATLAS_SIZE, 1 - (y + height) / ATLAS_SIZE, (x + width) / ATLAS_SIZE, 1 - y / ATLAS_SIZE];
}

export const ART = {
  panelBoat: rect(0, 0, PANEL, PANEL),
  panelFlowers: rect(PANEL, 0, PANEL, PANEL),
  panelCinema: rect(PANEL * 2, 0, PANEL, PANEL),
  panelTiger: rect(PANEL * 3, 0, PANEL, PANEL),
  busSideA: rect(0, PANEL, ATLAS_SIZE, STRIP),
  busSideB: rect(0, PANEL + STRIP, ATLAS_SIZE, STRIP),
};

function panelBackground(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, seed: number): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, PANEL, PANEL);
  ctx.save();
  ctx.translate(x, y);
  paintGrain(ctx, PANEL, PANEL, seed, 0.14);
  ctx.restore();
}

function panelFrame(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 12;
  ctx.strokeRect(x + 8, y + 8, PANEL - 16, PANEL - 16);
  for (const [cx, cy] of [[x + 26, y + 26], [x + PANEL - 26, y + 26], [x + 26, y + PANEL - 26], [x + PANEL - 26, y + PANEL - 26]] as const) {
    drawFlower(ctx, cx, cy, 18, PAINT.tomato, PAINT.marigold, PAINT.tin);
  }
}

/** A village river at sunset, a favourite rickshaw painter's scene. */
export function paintBoat(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  const horizon = y + PANEL * 0.56;
  ctx.fillStyle = PAINT.marigold;
  ctx.fillRect(x, y, PANEL, PANEL * 0.56);
  ctx.fillStyle = PAINT.tomato;
  ctx.beginPath();
  ctx.arc(x + PANEL * 0.66, horizon, 44, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = PAINT.teal;
  ctx.fillRect(x, horizon, PANEL, PANEL * 0.44);
  ctx.fillStyle = PAINT.parrot;
  ctx.beginPath();
  ctx.moveTo(x, horizon);
  ctx.quadraticCurveTo(x + 70, horizon - 36, x + 130, horizon);
  ctx.fill();
  ctx.fillStyle = PAINT.soot;
  ctx.beginPath();
  ctx.moveTo(x + 56, horizon + 34);
  ctx.quadraticCurveTo(x + 128, horizon + 78, x + 204, horizon + 30);
  ctx.quadraticCurveTo(x + 128, horizon + 46, x + 56, horizon + 34);
  ctx.fill();
  ctx.fillStyle = PAINT.tin;
  ctx.beginPath();
  ctx.moveTo(x + 124, horizon + 36);
  ctx.lineTo(x + 124, horizon - 62);
  ctx.lineTo(x + 180, horizon + 18);
  ctx.fill();
  panelFrame(ctx, x, y, PAINT.indigo);
}

export function paintFlowers(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  panelBackground(ctx, x, y, PAINT.indigo, 71);
  const cx = x + PANEL / 2;
  const cy = y + PANEL / 2;
  for (let i = 0; i < 8; i++) drawLeaf(ctx, cx, cy, 104, (i / 8) * Math.PI * 2, i % 2 === 0 ? PAINT.parrot : PAINT.teal);
  drawFlower(ctx, cx, cy, 66, PAINT.rani, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, cx - 72, cy - 66, 26, PAINT.marigold, PAINT.tin, PAINT.tomato);
  drawFlower(ctx, cx + 72, cy + 66, 26, PAINT.marigold, PAINT.tin, PAINT.tomato);
  panelFrame(ctx, x, y, PAINT.tomato);
}

/** A cinema billboard for a film that does not exist. The face is invented and stylised. */
export function paintCinema(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  panelBackground(ctx, x, y, PAINT.rani, 72);
  const cx = x + PANEL / 2;
  ctx.fillStyle = PAINT.soot;
  ctx.beginPath();
  ctx.ellipse(cx, y + 78, 44, 46, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = '#d99a6c';
  ctx.beginPath();
  ctx.ellipse(cx, y + 92, 37, 46, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAINT.soot;
  ctx.fillRect(cx - 24, y + 80, 15, 5);
  ctx.fillRect(cx + 9, y + 80, 15, 5);
  ctx.fillRect(cx - 16, y + 114, 32, 6);
  ctx.fillStyle = PAINT.teal;
  ctx.beginPath();
  ctx.moveTo(cx - 76, y + 186);
  ctx.quadraticCurveTo(cx, y + 118, cx + 76, y + 186);
  ctx.fill();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `50px ${FONT_DISPLAY}`;
  ctx.fillStyle = PAINT.soot;
  ctx.fillText(worldText('sign.film'), cx + 3, y + 208, PANEL - 44);
  ctx.fillStyle = PAINT.marigold;
  ctx.fillText(worldText('sign.film'), cx, y + 205, PANEL - 44);
  panelFrame(ctx, x, y, PAINT.marigold);
}

export function paintTiger(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  panelBackground(ctx, x, y, PAINT.parrot, 73);
  const cx = x + PANEL / 2;
  const cy = y + PANEL / 2 + 8;
  ctx.fillStyle = PAINT.marigold;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 72, 66, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(cx + side * 54, cy - 58, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAINT.soot;
    ctx.fillRect(cx + side * 30 - 10, cy - 16, 20, 9);
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cx + side * (56 + i * 2) - 12, cy + i * 18 - 22, 24, 6);
    }
    ctx.fillStyle = PAINT.marigold;
  }
  ctx.fillStyle = PAINT.tin;
  ctx.beginPath();
  ctx.ellipse(cx, cy + 28, 34, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAINT.soot;
  ctx.beginPath();
  ctx.moveTo(cx - 12, cy + 12);
  ctx.lineTo(cx + 12, cy + 12);
  ctx.lineTo(cx, cy + 26);
  ctx.fill();
  ctx.fillRect(cx - 2, cy - 54, 4, 26);
  ctx.fillRect(cx - 18, cy - 48, 4, 18);
  ctx.fillRect(cx + 14, cy - 48, 4, 18);
  panelFrame(ctx, x, y, PAINT.tomato);
}

/** A doyel on a flowering branch, the country's own bird, in the painter's flat enamel. */
export function paintBird(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  panelBackground(ctx, x, y, PAINT.teal, 74);
  const cx = x + PANEL / 2;
  const cy = y + PANEL / 2;
  // The branch, with leaves and a flower on it.
  ctx.strokeStyle = PAINT.soot;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(x + 30, cy + 74);
  ctx.quadraticCurveTo(cx, cy + 50, x + PANEL - 30, cy + 62);
  ctx.stroke();
  drawLeaf(ctx, cx - 56, cy + 62, 44, 0.9, PAINT.parrot);
  drawLeaf(ctx, cx + 50, cy + 56, 44, 0.7, PAINT.parrot);
  drawLeaf(ctx, cx + 14, cy + 54, 38, 1.5, PAINT.parrot);
  drawFlower(ctx, cx + 76, cy + 42, 22, PAINT.rani, PAINT.marigold, PAINT.tin);
  // Body, wing and a long tail held up, as a doyel holds it.
  ctx.fillStyle = PAINT.soot;
  ctx.beginPath();
  ctx.moveTo(cx - 38, cy + 2);
  ctx.quadraticCurveTo(cx - 8, cy - 46, cx + 34, cy - 26);
  ctx.quadraticCurveTo(cx + 44, cy + 14, cx + 6, cy + 44);
  ctx.quadraticCurveTo(cx - 26, cy + 34, cx - 38, cy + 2);
  ctx.fill();
  ctx.fillStyle = PAINT.tin;
  ctx.beginPath();
  ctx.moveTo(cx - 28, cy + 8);
  ctx.quadraticCurveTo(cx - 4, cy - 2, cx + 10, cy + 42);
  ctx.quadraticCurveTo(cx - 20, cy + 32, cx - 28, cy + 8);
  ctx.fill();
  ctx.fillStyle = PAINT.soot;
  ctx.beginPath();
  ctx.moveTo(cx + 28, cy - 18);
  ctx.lineTo(cx + 74, cy - 84);
  ctx.lineTo(cx + 88, cy - 76);
  ctx.lineTo(cx + 38, cy + 2);
  ctx.fill();
  ctx.fillStyle = PAINT.tin;
  ctx.beginPath();
  ctx.moveTo(cx + 62, cy - 56);
  ctx.lineTo(cx + 74, cy - 84);
  ctx.lineTo(cx + 88, cy - 76);
  ctx.lineTo(cx + 72, cy - 50);
  ctx.fill();
  // Head, an eye and a beak.
  ctx.fillStyle = PAINT.soot;
  ctx.beginPath();
  ctx.arc(cx - 28, cy - 16, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAINT.marigold;
  ctx.beginPath();
  ctx.moveTo(cx - 48, cy - 24);
  ctx.lineTo(cx - 76, cy - 14);
  ctx.lineTo(cx - 48, cy - 8);
  ctx.fill();
  ctx.fillStyle = PAINT.tin;
  ctx.beginPath();
  ctx.arc(cx - 34, cy - 20, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PAINT.tomato;
  ctx.beginPath();
  ctx.arc(cx - 34, cy - 20, 3, 0, Math.PI * 2);
  ctx.fill();
  panelFrame(ctx, x, y, PAINT.marigold);
}

/** Truck-art bus side, with honest dents and rust. */
function paintBusSide(ctx: CanvasRenderingContext2D, y: number, base: string, band: string, seed: number): void {
  const random = createRng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, y, ATLAS_SIZE, STRIP);
  ctx.save();
  ctx.translate(0, y);
  paintGrain(ctx, ATLAS_SIZE, STRIP, seed, 0.16);
  ctx.restore();
  drawMotifBand(ctx, 0, y + STRIP - 72, ATLAS_SIZE, 58, seed + 1, band);
  ctx.fillStyle = PAINT.marigold;
  ctx.fillRect(0, y + STRIP - 84, ATLAS_SIZE, 8);
  ctx.fillStyle = band;
  ctx.fillRect(0, y + 6, ATLAS_SIZE, 22);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 62px ${FONT_STRONG}`;
  ctx.fillStyle = PAINT.soot;
  ctx.fillText(worldText('sign.busName'), ATLAS_SIZE * 0.5 + 3, y + 112, ATLAS_SIZE * 0.8);
  ctx.fillStyle = band;
  ctx.fillText(worldText('sign.busName'), ATLAS_SIZE * 0.5, y + 108, ATLAS_SIZE * 0.8);
  // Scrapes, because no bus in this city has stayed unscratched for long.
  for (let i = 0; i < 26; i++) {
    const dx = random() * ATLAS_SIZE;
    const dy = y + random() * STRIP;
    ctx.fillStyle = `rgba(30,22,16,${0.15 + random() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(dx, dy, 8 + random() * 34, 3 + random() * 12, random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function createTrafficAtlas(anisotropy: number): CanvasTexture {
  const { canvas, ctx } = makeCanvas(ATLAS_SIZE, ATLAS_SIZE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
  paintBoat(ctx, 0, 0);
  paintFlowers(ctx, PANEL, 0);
  paintCinema(ctx, PANEL * 2, 0);
  paintTiger(ctx, PANEL * 3, 0);
  paintBusSide(ctx, PANEL, '#e8dcc0', PAINT.tomato, 201);
  paintBusSide(ctx, PANEL + STRIP, '#5ea89a', PAINT.indigo, 202);
  return toTexture(canvas, anisotropy);
}

const TYRE = 0x101010;
const DARK = 0x1b1612;
const GLASS = 0x0d1518;
const SKIN = 0x9c6a48;
const HEAD_GLOW: readonly [number, number, number] = [6, 5.2, 3.6];
const TAIL_GLOW: readonly [number, number, number] = [3.4, 0.25, 0.1];

function rider(builder: ModelBuilder, y: number, z: number, shirt: number): void {
  builder.box(0.38, 0.55, 0.26, 0, y + 0.28, z, shirt);
  builder.box(0.2, 0.2, 0.2, 0, y + 0.68, z + 0.02, SKIN);
}

/** হাতে আঁকা রিকশা: pedal cab with a folding hood and a painted back panel. */
export function buildRickshaw(panel: UvRect): BufferGeometry {
  const b = new ModelBuilder();
  // Wheels.
  b.cylinderX(0.33, 0.06, 0, 0.33, 1.05, TYRE, 12);
  b.cylinderX(0.33, 0.06, 0.56, 0.33, -0.72, TYRE, 12);
  b.cylinderX(0.33, 0.06, -0.56, 0.33, -0.72, TYRE, 12);
  b.cylinderX(0.1, 0.1, 0, 0.33, 1.05, 0xd9d4c6, 8);
  b.cylinderX(0.1, 0.1, 0.56, 0.33, -0.72, 0xd9d4c6, 8);
  b.cylinderX(0.1, 0.1, -0.56, 0.33, -0.72, 0xd9d4c6, 8);
  // Frame from front fork to the axle.
  b.box(0.07, 0.07, 1.7, 0, 0.5, 0.2, 0xc2185b);
  b.box(1.16, 0.07, 0.08, 0, 0.36, -0.72, 0xc2185b);
  b.box(0.07, 0.75, 0.07, 0, 0.75, 0.92, 0xd8402b);
  b.box(0.6, 0.05, 0.05, 0, 1.12, 0.92, 0xd9d4c6);
  // The puller, on his small saddle.
  b.box(0.2, 0.06, 0.3, 0, 0.96, 0.42, DARK);
  rider(b, 0.98, 0.42, 0xefe3c8);
  b.box(0.22, 0.42, 0.14, 0, 0.72, 0.5, 0x2c4a7a);
  // Passenger seat: a bench painted in rickshaw colours.
  b.box(1.02, 0.2, 0.58, 0, 0.8, -0.5, 0xd8402b);
  b.box(1.02, 0.5, 0.12, 0, 1.12, -0.78, 0xf2a20c);
  b.box(1.04, 0.32, 0.72, 0, 0.56, -0.5, 0x0f7f7a);
  // Folding hood: an arc of painted ribs.
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const angle = t * 1.25;
    const y = 1.32 + Math.sin(angle) * 0.62;
    const z = -0.84 + (1 - Math.cos(angle)) * 0.82;
    b.box(1.08, 0.06, 0.26, 0, y, z, i % 2 === 0 ? 0xc2185b : 0xf2a20c, { rotX: -angle * 0.8 });
  }
  // Hand-painted back panel, and little strips on the hood sides.
  b.panel(0.92, 0.78, 0, 0.84, -0.86, 0xffffff, { uv: panel, rotY: Math.PI });
  for (const side of [1, -1]) {
    b.box(0.03, 0.42, 0.54, side * 0.53, 1.22, -0.52, side > 0 ? 0xc2185b : 0x0f7f7a);
    // Tassels.
    b.box(0.03, 0.26, 0.03, side * 0.5, 1.18, -0.05, 0xf2a20c);
  }
  b.box(0.08, 0.08, 0.05, 0, 0.92, 1.0, 0xffffff, { glow: [3.5, 3, 2] });
  b.box(0.12, 0.05, 0.03, 0, 0.35, -0.92, 0xffffff, { glow: [2.4, 0.2, 0.1] });
  return b.build();
}

/** সিএনজি-style three-wheeler, with its own design. */
export function buildCng(): BufferGeometry {
  const b = new ModelBuilder();
  b.cylinderX(0.25, 0.12, 0, 0.25, 1.08, TYRE, 10);
  b.cylinderX(0.25, 0.12, 0.62, 0.25, -0.82, TYRE, 10);
  b.cylinderX(0.25, 0.12, -0.62, 0.25, -0.82, TYRE, 10);
  // Tintable body and cab.
  b.box(1.32, 0.56, 2.5, 0, 0.62, -0.12, 0xffffff);
  b.box(1.1, 0.42, 0.6, 0, 0.9, 1.0, 0xffffff);
  b.box(1.36, 0.1, 2.3, 0, 1.68, -0.2, 0xffffff);
  b.box(1.34, 0.08, 2.5, 0, 0.92, -0.12, 0xf2a20c);
  // Windscreen and rear glass.
  b.box(1.06, 0.62, 0.05, 0, 1.36, 0.82, GLASS, { rotX: -0.18 });
  b.box(1.1, 0.5, 0.05, 0, 1.4, -1.28, GLASS);
  // Roof posts and the side cage that keeps this city's bags inside.
  for (const side of [1, -1]) {
    for (const z of [0.82, -0.2, -1.28]) b.box(0.05, 0.74, 0.05, side * 0.64, 1.3, z, DARK);
    for (const h of [1.14, 1.32, 1.5]) b.box(0.03, 0.03, 2.1, side * 0.65, h, -0.22, 0x3a3a38);
  }
  b.box(0.2, 0.14, 0.04, 0, 0.82, 1.32, 0xffffff, { glow: HEAD_GLOW });
  for (const side of [1, -1]) b.box(0.18, 0.12, 0.03, side * 0.48, 0.74, -1.38, 0xffffff, { glow: TAIL_GLOW });
  return b.build();
}

export function buildBike(): BufferGeometry {
  const b = new ModelBuilder();
  b.cylinderX(0.3, 0.1, 0, 0.3, 0.74, TYRE, 12);
  b.cylinderX(0.3, 0.12, 0, 0.3, -0.72, TYRE, 12);
  b.box(0.24, 0.3, 0.62, 0, 0.72, 0.12, 0xffffff);
  b.box(0.2, 0.14, 0.72, 0, 0.82, -0.36, DARK);
  b.box(0.06, 0.62, 0.06, 0, 0.72, 0.62, 0x3a3a38, { rotX: 0.3 });
  b.box(0.62, 0.04, 0.04, 0, 1.08, 0.5, 0x3a3a38);
  rider(b, 0.88, -0.18, 0xd9d4c6);
  b.box(0.3, 0.44, 0.16, 0, 0.62, -0.1, 0x22303a);
  b.box(0.16, 0.14, 0.04, 0, 0.94, 0.7, 0xffffff, { glow: HEAD_GLOW });
  b.box(0.12, 0.07, 0.03, 0, 0.8, -0.74, 0xffffff, { glow: TAIL_GLOW });
  return b.build();
}

function wheels(b: ModelBuilder, trackHalf: number, radius: number, width: number, axles: readonly number[]): void {
  for (const z of axles) {
    for (const side of [1, -1]) {
      b.cylinderX(radius, width, side * trackHalf, radius, z, TYRE, 12);
      b.cylinderX(radius * 0.55, width + 0.02, side * trackHalf, radius, z, 0x8a8a84, 8);
    }
  }
}

export function buildCar(): BufferGeometry {
  const b = new ModelBuilder();
  wheels(b, 0.76, 0.31, 0.22, [1.32, -1.28]);
  b.box(1.76, 0.5, 4.1, 0, 0.6, 0, 0xffffff);
  b.box(1.5, 0.08, 1.2, 0, 0.87, 1.34, 0xffffff);
  b.box(1.5, 0.48, 2, 0, 1.08, -0.3, GLASS);
  b.box(1.42, 0.05, 1.72, 0, 1.33, -0.34, 0xffffff);
  for (const side of [1, -1]) {
    b.box(0.34, 0.12, 0.05, side * 0.56, 0.68, 2.05, 0xffffff, { glow: HEAD_GLOW });
    b.box(0.36, 0.12, 0.05, side * 0.58, 0.72, -2.05, 0xffffff, { glow: TAIL_GLOW });
  }
  return b.build();
}

export function buildPickup(): BufferGeometry {
  const b = new ModelBuilder();
  wheels(b, 0.82, 0.36, 0.26, [1.6, -1.45]);
  b.box(1.92, 0.56, 4.9, 0, 0.74, 0, 0xffffff);
  b.box(1.72, 0.66, 1.5, 0, 1.3, 0.92, 0xffffff);
  b.box(1.66, 0.42, 1.54, 0, 1.36, 0.92, GLASS);
  // An open bed, usually full of sacks.
  b.box(1.72, 0.1, 2.3, 0, 1.08, -1.24, 0x2a2622);
  for (const side of [1, -1]) b.box(0.08, 0.34, 2.3, side * 0.92, 1.2, -1.24, 0xffffff);
  b.box(1.72, 0.34, 0.08, 0, 1.2, -2.42, 0xffffff);
  b.box(1.1, 0.42, 1.2, 0, 1.3, -1.2, 0x8d7a56);
  for (const side of [1, -1]) {
    b.box(0.34, 0.14, 0.05, side * 0.66, 0.84, 2.46, 0xffffff, { glow: HEAD_GLOW });
    b.box(0.26, 0.14, 0.05, side * 0.72, 0.86, -2.47, 0xffffff, { glow: TAIL_GLOW });
  }
  return b.build();
}

/** ট্রাক-আর্ট city bus, scratched and lit from inside. */
export function buildBus(side: UvRect): BufferGeometry {
  const b = new ModelBuilder();
  wheels(b, 1.08, 0.48, 0.32, [3.3, -3]);
  const length = 10.1;
  const halfWidth = 1.24;
  b.box(halfWidth * 2, 0.42, length, 0, 0.72, 0, 0x3a3128);
  b.box(halfWidth * 2, 1.14, length, 0, 1.5, 0, 0xffffff);
  b.box(halfWidth * 2 - 0.02, 0.8, length - 0.12, 0, 2.47, 0, 0xffffff);
  b.box(halfWidth * 2, 0.16, length, 0, 2.95, 0, 0xf2a20c);
  b.box(1.7, 0.16, 5.2, 0, 3.1, -0.8, 0x4a4a46);
  // Painted truck-art on both sides, under the window line.
  b.panel(length - 0.2, 1.14, halfWidth + 0.012, 1.5, 0, 0xffffff, { uv: side, rotY: Math.PI / 2 });
  b.panel(length - 0.2, 1.14, -halfWidth - 0.012, 1.5, 0, 0xffffff, { uv: side, rotY: -Math.PI / 2 });
  // Warm interior light through a run of windows.
  for (const sideSign of [1, -1]) {
    for (let i = 0; i < 7; i++) {
      const z = -4.2 + i * 1.3;
      b.box(0.04, 0.6, 1.08, sideSign * (halfWidth + 0.01), 2.46, z, 0x201810, { glow: [0.62, 0.42, 0.22] });
    }
  }
  b.box(2.1, 0.9, 0.05, 0, 2.3, length / 2 + 0.01, GLASS);
  b.box(2, 0.7, 0.05, 0, 2.42, -length / 2 - 0.01, 0x201810, { glow: [0.5, 0.34, 0.18] });
  for (const sideSign of [1, -1]) {
    b.box(0.36, 0.2, 0.05, sideSign * 0.84, 0.98, length / 2 + 0.01, 0xffffff, { glow: HEAD_GLOW });
    b.box(0.3, 0.26, 0.05, sideSign * 0.9, 1.06, -length / 2 - 0.01, 0xffffff, { glow: TAIL_GLOW });
  }
  return b.build();
}
