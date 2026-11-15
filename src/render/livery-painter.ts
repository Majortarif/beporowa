/**
 * Paints a car's রিকশা আর্ট from a livery description, onto canvases that become its textures.
 * The body's texture is a side view: U runs nose to tail, V runs sill to roof. One metre along
 * the car is half as many pixels as one metre up it, so art is squeezed to look square on the car.
 */

import { CanvasTexture } from 'three';
import type { LiveryArt, LiveryBand, LiveryDef } from '../config/cars';
import { worldText } from '../i18n';
import { paintBird, paintBoat, paintCinema, paintFlowers, paintTiger } from '../traffic/traffic-models';
import { FONT_DISPLAY, PAINT, drawFlower, drawMotifBand, makeCanvas, paintGrain, toTexture } from './painted-textures';

const WIDTH = 1024;
const HEIGHT = 512;
const PANEL = 256;

function paintBand(ctx: CanvasRenderingContext2D, band: LiveryBand, y: number, height: number, accent: string): void {
  switch (band) {
    case 'flowers':
      drawMotifBand(ctx, 0, y, WIDTH, height, 7, PAINT.indigo);
      break;
    case 'chain': {
      // The painted chain that runs along a truck's side.
      ctx.fillStyle = PAINT.soot;
      ctx.fillRect(0, y, WIDTH, height);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 8;
      const step = 44;
      for (let x = 0; x < WIDTH + step; x += step) {
        ctx.beginPath();
        ctx.ellipse(x, y + height / 2, step * 0.62, height * 0.26, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = PAINT.tin;
      ctx.fillRect(0, y, WIDTH, 6);
      ctx.fillRect(0, y + height - 6, WIDTH, 6);
      break;
    }
    case 'waves': {
      // River waves in rows, as painted on a launch's side.
      ctx.fillStyle = PAINT.teal;
      ctx.fillRect(0, y, WIDTH, height);
      ctx.strokeStyle = PAINT.tin;
      ctx.lineWidth = 6;
      for (let row = 0; row < 3; row++) {
        const rowY = y + height * (0.24 + row * 0.26);
        ctx.beginPath();
        for (let x = -40 + row * 18; x < WIDTH + 40; x += 40) {
          ctx.moveTo(x, rowY);
          ctx.quadraticCurveTo(x + 20, rowY - 14, x + 40, rowY);
        }
        ctx.stroke();
      }
      break;
    }
    case 'none':
      break;
  }
}

function paintArt(ctx: CanvasRenderingContext2D, art: LiveryArt, centerX: number, top: number, height: number, verticalScale: number): void {
  if (art === 'none') return;
  const scaleY = height / PANEL;
  // Narrower in pixels than it is tall, so that it looks square on the car.
  const scaleX = scaleY / (2 * verticalScale);
  ctx.save();
  ctx.translate(centerX - (PANEL * scaleX) / 2, top);
  ctx.scale(scaleX, scaleY);
  switch (art) {
    case 'flowers':
      paintFlowers(ctx, 0, 0);
      break;
    case 'boat':
      paintBoat(ctx, 0, 0);
      break;
    case 'cinema':
      paintCinema(ctx, 0, 0);
      break;
    case 'tiger':
      paintTiger(ctx, 0, 0);
      break;
    case 'bird':
      paintBird(ctx, 0, 0);
      break;
  }
  ctx.restore();
}

/** One car's paint, ready to be changed at any time. */
export class LiveryPainter {
  readonly body: CanvasTexture;
  readonly slogan: CanvasTexture;
  private readonly bodyCtx: CanvasRenderingContext2D;
  private readonly sloganCtx: CanvasRenderingContext2D;

  /** @param verticalScale how much this car squeezes its sides into the texture; বুলবুলি is 1 */
  constructor(
    anisotropy: number,
    private readonly verticalScale = 1,
  ) {
    const body = makeCanvas(WIDTH, HEIGHT);
    const slogan = makeCanvas(512, 128);
    this.bodyCtx = body.ctx;
    this.sloganCtx = slogan.ctx;
    this.body = toTexture(body.canvas, anisotropy);
    this.slogan = toTexture(slogan.canvas, anisotropy);
  }

  /** Repaints everything from a description. */
  paint(livery: LiveryDef): void {
    this.paintBody(livery);
    this.paintSlogan(livery);
  }

  private paintBody(livery: LiveryDef): void {
    const ctx = this.bodyCtx;
    ctx.fillStyle = livery.base;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    paintGrain(ctx, WIDTH, HEIGHT, 11, 0.09);
    // The bottom of the texture is the sill.
    ctx.fillStyle = livery.rocker;
    ctx.fillRect(0, HEIGHT - 54, WIDTH, 54);
    ctx.fillStyle = livery.accent;
    ctx.fillRect(0, HEIGHT - 122, WIDTH, 68);
    paintBand(ctx, livery.band, HEIGHT - 232, 110, livery.accent);
    if (livery.band !== 'none') {
      ctx.fillStyle = PAINT.marigold;
      ctx.fillRect(0, HEIGHT - 250, WIDTH, 10);
    }
    paintArt(ctx, livery.art, WIDTH * 0.5, HEIGHT - 372, 270, this.verticalScale);
    this.body.needsUpdate = true;
  }

  private paintSlogan(livery: LiveryDef): void {
    const ctx = this.sloganCtx;
    const words = livery.slogan.trim() || worldText('sign.slogan');
    ctx.fillStyle = PAINT.indigo;
    ctx.fillRect(0, 0, 512, 128);
    drawFlower(ctx, 40, 64, 32, PAINT.marigold, PAINT.tomato, PAINT.tin);
    drawFlower(ctx, 472, 64, 32, PAINT.marigold, PAINT.tomato, PAINT.tin);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `68px ${FONT_DISPLAY}`;
    ctx.fillStyle = PAINT.tomato;
    ctx.fillText(words, 259, 70, 376);
    ctx.fillStyle = PAINT.tin;
    ctx.fillText(words, 256, 66, 376);
    this.slogan.needsUpdate = true;
  }

  dispose(): void {
    this.body.dispose();
    this.slogan.dispose();
  }
}
