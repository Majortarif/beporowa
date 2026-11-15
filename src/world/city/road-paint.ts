/** Canvas-painted road surfaces for each kind of city road, and the paved floor around them. */

import type { CanvasTexture } from 'three';
import { CITY, type RoadKind } from '../../config/city-tuning';
import { TUNING } from '../../config/tuning';
import { createRng } from '../../core/math';
import { PAINT, makeCanvas, toTexture } from '../../render/painted-textures';

const WIDTH = 256;
const HEIGHT = 1024;
/** Lane paint repeats every this many metres of road. */
export const CITY_ROAD_TILE = 24;

function softPatch(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rgb: string, alpha: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(rx, ry);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
  gradient.addColorStop(0.55, `rgba(${rgb},${alpha * 0.7})`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(-1, -1, 2, 2);
  ctx.restore();
}

function paintAsphalt(ctx: CanvasRenderingContext2D, seed: number, worn: boolean): void {
  const random = createRng(seed);
  ctx.fillStyle = worn ? '#242120' : '#1d1c1e';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  for (let i = 0; i < 12000; i++) {
    const shade = 18 + random() * 34;
    ctx.fillStyle = `rgba(${shade},${shade},${shade + 2},0.55)`;
    ctx.fillRect(random() * WIDTH, random() * HEIGHT, 1 + random() * 2, 1 + random() * 2);
  }
  for (let i = 0; i < (worn ? 22 : 12); i++) {
    const rx = 10 + random() * 30;
    const ry = 26 + random() * 110;
    softPatch(ctx, rx + random() * (WIDTH - rx * 2), ry + random() * (HEIGHT - ry * 2), rx, ry, '10,10,12', 0.28);
  }
  if (worn) {
    // Old-town roads: patched, cracked, and with a manhole now and then.
    for (let i = 0; i < 10; i++) {
      ctx.strokeStyle = 'rgba(6,6,6,0.75)';
      ctx.lineWidth = 1 + random() * 1.6;
      ctx.beginPath();
      let x = random() * WIDTH;
      let y = random() * (HEIGHT - 240) + 60;
      ctx.moveTo(x, y);
      for (let j = 0; j < 6; j++) {
        x += (random() - 0.5) * 34;
        y += 12 + random() * 26;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#3a3531';
    ctx.beginPath();
    ctx.arc(WIDTH * 0.7, HEIGHT * 0.34, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#141210';
    ctx.lineWidth = 3;
    ctx.stroke();
  }
}

function dashes(ctx: CanvasRenderingContext2D, x: number, width: number, color: string, seed: number): void {
  const random = createRng(seed);
  const period = HEIGHT / 3;
  for (let y = 0; y < HEIGHT; y += period) {
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y + period * 0.15, width, period * 0.42);
    ctx.fillStyle = 'rgba(29,28,30,0.33)';
    for (let i = 0; i < 12; i++) {
      ctx.fillRect(x - width / 2 + random() * width, y + period * 0.15 + random() * period * 0.42, 1 + random() * 2, 2 + random() * 8);
    }
  }
}

function solidLine(ctx: CanvasRenderingContext2D, x: number, width: number, color: string, seed: number): void {
  const random = createRng(seed);
  ctx.fillStyle = color;
  ctx.fillRect(x - width / 2, 0, width, HEIGHT);
  ctx.fillStyle = 'rgba(29,28,30,0.35)';
  for (let i = 0; i < 90; i++) {
    ctx.fillRect(x - width / 2 + random() * width, random() * HEIGHT, 1 + random() * 2, 2 + random() * 10);
  }
}

/** The road's colour texture for one kind. U runs across the road, V along it. */
export function createCityRoadTexture(kind: RoadKind, anisotropy: number): CanvasTexture {
  const spec = CITY.roads[kind];
  const { canvas, ctx } = makeCanvas(WIDTH, HEIGHT);
  const seed = TUNING.world.seed + kind.length * 11;
  paintAsphalt(ctx, seed, kind === 'lane');
  const pixelsPerMetre = WIDTH / (spec.halfWidth * 2);
  const center = WIDTH / 2;
  const lineWidth = Math.max(3, pixelsPerMetre * 0.16);
  const laneX = (i: number, side: number): number => center + side * pixelsPerMetre * (spec.median / 2 + spec.laneWidth * i);

  if (kind === 'lane') {
    // Alleys have no paint at all, only a dark gutter at each side.
    softPatch(ctx, 0, HEIGHT / 2, 24, HEIGHT, '5,5,5', 0.7);
    softPatch(ctx, WIDTH, HEIGHT / 2, 24, HEIGHT, '5,5,5', 0.7);
  } else if (kind === 'street' || kind === 'ramp') {
    dashes(ctx, center, lineWidth, '#d8d2c0', seed + 1);
    const edge = kind === 'ramp' ? PAINT.marigold : '#bdb7a6';
    solidLine(ctx, lineWidth * 1.5, lineWidth, edge, seed + 2);
    solidLine(ctx, WIDTH - lineWidth * 1.5, lineWidth, edge, seed + 3);
  } else if (kind === 'avenue') {
    // A painted median, with lane dashes either side of it.
    const medianWidth = spec.median * pixelsPerMetre;
    ctx.fillStyle = '#2d2a26';
    ctx.fillRect(center - medianWidth / 2, 0, medianWidth, HEIGHT);
    ctx.save();
    ctx.beginPath();
    ctx.rect(center - medianWidth / 2, 0, medianWidth, HEIGHT);
    ctx.clip();
    ctx.strokeStyle = PAINT.marigold;
    ctx.lineWidth = lineWidth;
    const step = HEIGHT / 8;
    for (let y = -step; y < HEIGHT + step; y += step) {
      ctx.beginPath();
      ctx.moveTo(center - medianWidth / 2, y);
      ctx.lineTo(center + medianWidth / 2, y + medianWidth);
      ctx.stroke();
    }
    ctx.restore();
    solidLine(ctx, center - medianWidth / 2, lineWidth, PAINT.marigold, seed + 1);
    solidLine(ctx, center + medianWidth / 2, lineWidth, PAINT.marigold, seed + 2);
    dashes(ctx, laneX(1, 1), lineWidth, '#d8d2c0', seed + 3);
    dashes(ctx, laneX(1, -1), lineWidth, '#d8d2c0', seed + 4);
    solidLine(ctx, lineWidth * 1.5, lineWidth, '#bdb7a6', seed + 5);
    solidLine(ctx, WIDTH - lineWidth * 1.5, lineWidth, '#bdb7a6', seed + 6);
  } else {
    // Flyover: a double yellow centre, lane dashes and white edges.
    solidLine(ctx, center - lineWidth, lineWidth * 0.8, PAINT.marigold, seed + 1);
    solidLine(ctx, center + lineWidth, lineWidth * 0.8, PAINT.marigold, seed + 2);
    dashes(ctx, laneX(1, 1), lineWidth, '#d8d2c0', seed + 3);
    dashes(ctx, laneX(1, -1), lineWidth, '#d8d2c0', seed + 4);
    solidLine(ctx, lineWidth * 1.5, lineWidth, '#d8d2c0', seed + 5);
    solidLine(ctx, WIDTH - lineWidth * 1.5, lineWidth, '#d8d2c0', seed + 6);
  }
  return toTexture(canvas, anisotropy, true);
}

/** Roughness for wet roads, shared by all kinds. Green channel: low values are wet and mirror-like. */
export function createCityRoughnessTexture(anisotropy: number): CanvasTexture {
  const size = 256;
  const random = createRng(TUNING.world.seed + 21);
  const { canvas, ctx } = makeCanvas(size, size * 2);
  const wet = TUNING.world.roadWetness;
  const base = Math.round((1 - wet * 0.62) * 255);
  ctx.fillStyle = `rgb(${base},${base},${base})`;
  ctx.fillRect(0, 0, size, size * 2);
  for (let i = 0; i < 700; i++) {
    const value = base + (random() - 0.5) * 70;
    ctx.fillStyle = `rgba(${value},${value},${value},0.5)`;
    ctx.fillRect(random() * size, random() * size * 2, 2 + random() * 10, 2 + random() * 10);
  }
  const puddle = Math.round((1 - wet) * 90);
  for (let i = 0; i < 14; i++) {
    const rx = 8 + random() * 22;
    const ry = 18 + random() * 54;
    softPatch(ctx, rx + random() * (size - rx * 2), ry + random() * (size * 2 - ry * 2), rx, ry, `${puddle},${puddle},${puddle}`, 0.7);
  }
  const texture = toTexture(canvas, anisotropy, true);
  texture.colorSpace = '';
  return texture;
}

/** The paved floor between roads: worn concrete slabs, packed earth and litter. */
export function createFloorTexture(anisotropy: number): CanvasTexture {
  const size = 512;
  const random = createRng(TUNING.world.seed + 22);
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#39332c';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 16000; i++) {
    const shade = random();
    ctx.fillStyle = `rgba(${40 + shade * 44},${35 + shade * 36},${28 + shade * 28},0.5)`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3);
  }
  ctx.strokeStyle = 'rgba(14,12,10,0.6)';
  ctx.lineWidth = 2;
  const slab = size / 4;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(i * slab, 0);
    ctx.lineTo(i * slab, size);
    ctx.moveTo(0, i * slab);
    ctx.lineTo(size, i * slab);
    ctx.stroke();
  }
  for (let i = 0; i < 18; i++) {
    softPatch(ctx, random() * size, random() * size, 30 + random() * 50, 30 + random() * 50, '20,16,12', 0.3);
  }
  return toTexture(canvas, anisotropy, true);
}

/** Plain asphalt for junction discs. */
export function createJunctionTexture(anisotropy: number): CanvasTexture {
  const { canvas, ctx } = makeCanvas(WIDTH, HEIGHT);
  paintAsphalt(ctx, TUNING.world.seed + 30, false);
  return toTexture(canvas, anisotropy, true);
}
