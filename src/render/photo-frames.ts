/** Rickshaw-art borders and painted captions for photo mode, drawn with Canvas 2D so Bangla shapes correctly. */

import { FONT_DISPLAY, PAINT, drawFlower, drawLeaf, drawMotifBand, paintGrain } from './painted-textures';

export type PhotoFrame = 'none' | 'flowers' | 'chain' | 'waves' | 'cinema';

export const PHOTO_FRAMES: readonly PhotoFrame[] = ['none', 'flowers', 'chain', 'waves', 'cinema'];

function strips(ctx: CanvasRenderingContext2D, width: number, height: number, band: number, paint: (x: number, y: number, w: number, h: number) => void): void {
  paint(0, 0, width, band);
  paint(0, height - band, width, band);
  // The sides are drawn across, then turned upright.
  ctx.save();
  ctx.translate(band, band);
  ctx.rotate(Math.PI / 2);
  paint(0, 0, height - band * 2, band);
  ctx.restore();
  ctx.save();
  ctx.translate(width, band);
  ctx.rotate(Math.PI / 2);
  paint(0, 0, height - band * 2, band);
  ctx.restore();
}

/** Draws a frame over a whole picture. */
export function paintPhotoFrame(ctx: CanvasRenderingContext2D, width: number, height: number, frame: PhotoFrame): void {
  if (frame === 'none') return;
  const band = Math.round(Math.min(width, height) * 0.075);
  switch (frame) {
    case 'flowers':
      strips(ctx, width, height, band, (x, y, w, h) => drawMotifBand(ctx, x, y, w, h, 7, PAINT.indigo));
      break;
    case 'chain':
      strips(ctx, width, height, band, (x, y, w, h) => {
        ctx.fillStyle = PAINT.soot;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = PAINT.marigold;
        ctx.lineWidth = Math.max(3, h * 0.08);
        const step = h * 0.62;
        for (let at = x; at < x + w + step; at += step) {
          ctx.beginPath();
          ctx.ellipse(at, y + h / 2, step * 0.62, h * 0.26, 0, 0, Math.PI * 2);
          ctx.stroke();
        }
      });
      break;
    case 'waves':
      strips(ctx, width, height, band, (x, y, w, h) => {
        ctx.fillStyle = PAINT.teal;
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = PAINT.tin;
        ctx.lineWidth = Math.max(2, h * 0.05);
        const step = h * 0.5;
        for (let row = 0; row < 3; row++) {
          const rowY = y + h * (0.24 + row * 0.26);
          ctx.beginPath();
          for (let at = x - step + (row * step) / 2; at < x + w + step; at += step) {
            ctx.moveTo(at, rowY);
            ctx.quadraticCurveTo(at + step / 2, rowY - h * 0.16, at + step, rowY);
          }
          ctx.stroke();
        }
      });
      break;
    case 'cinema': {
      // A cinema hoarding: a thick painted board with flowers in each corner.
      ctx.fillStyle = PAINT.tomato;
      ctx.fillRect(0, 0, width, band);
      ctx.fillRect(0, height - band, width, band);
      ctx.fillRect(0, 0, band, height);
      ctx.fillRect(width - band, 0, band, height);
      ctx.strokeStyle = PAINT.marigold;
      ctx.lineWidth = Math.max(3, band * 0.12);
      ctx.strokeRect(band * 0.3, band * 0.3, width - band * 0.6, height - band * 0.6);
      ctx.strokeStyle = PAINT.soot;
      ctx.lineWidth = Math.max(2, band * 0.06);
      ctx.strokeRect(band, band, width - band * 2, height - band * 2);
      for (const [x, y] of [[band * 0.75, band * 0.75], [width - band * 0.75, band * 0.75], [band * 0.75, height - band * 0.75], [width - band * 0.75, height - band * 0.75]] as const) {
        drawLeaf(ctx, x, y, band * 0.8, 0.6, PAINT.parrot);
        drawFlower(ctx, x, y, band * 0.62, PAINT.marigold, PAINT.tin, PAINT.indigo);
      }
      break;
    }
  }
}

/** A painted caption, as the player sees it on screen and as it goes into the picture. */
export function paintCaption(ctx: CanvasRenderingContext2D, text: string, centreX: number, centreY: number, size: number): void {
  ctx.save();
  ctx.font = `${size}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const textWidth = ctx.measureText(text).width;
  const width = textWidth + size * 1.1;
  const height = size * 1.55;
  ctx.translate(centreX, centreY);
  ctx.rotate(-0.02);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(-width / 2 + size * 0.12, -height / 2 + size * 0.12, width, height);
  ctx.fillStyle = PAINT.tin;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.save();
  ctx.translate(-width / 2, -height / 2);
  paintGrain(ctx, width, height, text.length + 3, 0.12);
  ctx.restore();
  ctx.strokeStyle = PAINT.soot;
  ctx.lineWidth = Math.max(2, size * 0.07);
  ctx.strokeRect(-width / 2, -height / 2, width, height);
  ctx.fillStyle = PAINT.soot;
  ctx.fillText(text, size * 0.03, size * 0.09);
  ctx.fillStyle = PAINT.tomato;
  ctx.fillText(text, 0, size * 0.05);
  ctx.restore();
}

/** The game's name in the corner of a saved photo. */
export function paintSignature(ctx: CanvasRenderingContext2D, name: string, width: number, height: number): void {
  const size = Math.round(Math.min(width, height) * 0.035);
  ctx.save();
  ctx.font = `${size}px ${FONT_DISPLAY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const x = width - size * 3.2;
  const y = height - size * 2.8;
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.fillText(name, x + size * 0.06, y + size * 0.06);
  ctx.fillStyle = PAINT.tin;
  ctx.fillText(name, x, y);
  ctx.restore();
}
