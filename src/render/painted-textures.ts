/**
 * Procedural hand-painted textures: rickshaw-art motifs drawn with Canvas 2D.
 * Canvas text goes through the browser's text shaper, so Bangla conjuncts render correctly.
 * Never use bitmap fonts or SDF text for Bangla in this project.
 */

import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
import { createRng } from '../core/math';
import { worldText } from '../i18n';

/** The enamel paint palette shared with the UI. */
export const PAINT = {
  soot: '#1b1410',
  tin: '#efe3c8',
  tomato: '#d8402b',
  marigold: '#f2a20c',
  teal: '#0f7f7a',
  parrot: '#5fa52f',
  rani: '#c2185b',
  indigo: '#1d2a5b',
};

export const FONT_DISPLAY = 'Galada, "Noto Sans Bengali", sans-serif';
export const FONT_STRONG = '"Anek Bangla", "Noto Sans Bengali", sans-serif';
export const FONT_BODY = '"Hind Siliguri", "Noto Sans Bengali", sans-serif';

export function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return { canvas, ctx };
}

export function toTexture(canvas: HTMLCanvasElement, anisotropy = 4, repeat = false): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = anisotropy;
  if (repeat) {
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
  }
  return texture;
}

/** Faint brush streaks and speckle so flat enamel looks painted by hand. */
export function paintGrain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  seed: number,
  strength = 0.06,
): void {
  const random = createRng(seed);
  ctx.save();
  for (let i = 0; i < (width * height) / 900; i++) {
    const x = random() * width;
    const y = random() * height;
    const length = 8 + random() * 40;
    ctx.strokeStyle = random() > 0.5 ? `rgba(255,255,255,${strength * random()})` : `rgba(0,0,0,${strength * random()})`;
    ctx.lineWidth = 0.6 + random() * 1.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + length, y + (random() - 0.5) * 3);
    ctx.stroke();
  }
  ctx.restore();
}

/** A shapla-style flower: layered petals around a dark-rimmed centre. */
export function drawFlower(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  petal: string,
  petalInner: string,
  center: string,
): void {
  const petals = 8;
  ctx.save();
  ctx.translate(x, y);
  for (let layer = 0; layer < 2; layer++) {
    const r = layer === 0 ? radius : radius * 0.66;
    ctx.fillStyle = layer === 0 ? petal : petalInner;
    for (let i = 0; i < petals; i++) {
      ctx.save();
      ctx.rotate(((i + (layer ? 0.5 : 0)) / petals) * Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(r * 0.42, r * 0.5, 0, r);
      ctx.quadraticCurveTo(-r * 0.42, r * 0.5, 0, 0);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.fillStyle = PAINT.soot;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = center;
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.17, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A pointed leaf, used to fill the gaps between flowers. */
export function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  length: number,
  angle: number,
  color: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(length * 0.5, length * 0.34, length, 0);
  ctx.quadraticCurveTo(length * 0.5, -length * 0.34, 0, 0);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = Math.max(1, length * 0.03);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(length * 0.9, 0);
  ctx.stroke();
  ctx.restore();
}

/** A band of flowers and leaves, the signature rickshaw panel border. */
export function drawMotifBand(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
  background: string,
): void {
  const random = createRng(seed);
  ctx.fillStyle = background;
  ctx.fillRect(x, y, width, height);
  const flowerRadius = height * 0.4;
  const step = flowerRadius * 2.7;
  const palette = [
    [PAINT.tin, PAINT.marigold],
    [PAINT.marigold, PAINT.tomato],
    [PAINT.rani, PAINT.tin],
    [PAINT.tomato, PAINT.marigold],
  ];
  let index = 0;
  for (let cx = x + step * 0.5; cx < x + width; cx += step) {
    const cy = y + height / 2;
    drawLeaf(ctx, cx + flowerRadius * 0.7, cy, step * 0.42, -0.5 - random() * 0.3, PAINT.parrot);
    drawLeaf(ctx, cx + flowerRadius * 0.7, cy, step * 0.42, 0.5 + random() * 0.3, PAINT.parrot);
    const [petal, inner] = palette[index % palette.length];
    drawFlower(ctx, cx, cy, flowerRadius, petal, inner, PAINT.marigold);
    index++;
  }
  ctx.strokeStyle = PAINT.tin;
  ctx.lineWidth = Math.max(2, height * 0.05);
  ctx.beginPath();
  ctx.moveTo(x, y + ctx.lineWidth / 2);
  ctx.lineTo(x + width, y + ctx.lineWidth / 2);
  ctx.moveTo(x, y + height - ctx.lineWidth / 2);
  ctx.lineTo(x + width, y + height - ctx.lineWidth / 2);
  ctx.stroke();
}

export function createPlateCanvas(): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(512, 128);
  ctx.fillStyle = '#f4efe2';
  ctx.fillRect(0, 0, 512, 128);
  ctx.strokeStyle = PAINT.soot;
  ctx.lineWidth = 8;
  ctx.strokeRect(6, 6, 500, 116);
  ctx.fillStyle = PAINT.soot;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 46px ${FONT_BODY}`;
  ctx.fillText(worldText('sign.plate'), 256, 68, 480);
  return canvas;
}

/** Soft round glow, used for the blob shadow, underglow and lamp pools. */
export function createRadialCanvas(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)'): HTMLCanvasElement {
  const { canvas, ctx } = makeCanvas(size, size);
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
