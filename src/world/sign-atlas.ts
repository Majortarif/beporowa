/**
 * All in-world Bangla signs are baked once into one texture atlas.
 * Canvas 2D shapes the conjuncts (যুক্তাক্ষর) correctly, and one atlas means one draw call.
 * Fonts must be loaded before this runs: see boot/font-gate.ts.
 */

import { CanvasTexture } from 'three';
import { worldText } from '../i18n';
import {
  FONT_DISPLAY,
  FONT_STRONG,
  PAINT,
  drawFlower,
  drawLeaf,
  makeCanvas,
  paintGrain,
  toTexture,
} from '../render/painted-textures';

export interface SignRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

interface SignStyle {
  key: string;
  background: string;
  text: string;
  shade: string;
  flower: [string, string];
  display: boolean;
}

const SIGNS: SignStyle[] = [
  { key: 'sign.track', background: PAINT.tomato, text: PAINT.tin, shade: PAINT.soot, flower: [PAINT.marigold, PAINT.tin], display: true },
  { key: 'sign.garage', background: PAINT.teal, text: PAINT.tin, shade: PAINT.soot, flower: [PAINT.marigold, PAINT.tomato], display: true },
  { key: 'sign.tea', background: PAINT.marigold, text: PAINT.tomato, shade: PAINT.soot, flower: [PAINT.tomato, PAINT.tin], display: true },
  { key: 'sign.kacchi', background: PAINT.indigo, text: PAINT.marigold, shade: PAINT.soot, flower: [PAINT.rani, PAINT.tin], display: false },
  { key: 'sign.launch', background: PAINT.tin, text: PAINT.indigo, shade: PAINT.marigold, flower: [PAINT.teal, PAINT.parrot], display: false },
  { key: 'sign.coaching', background: PAINT.parrot, text: PAINT.soot, shade: PAINT.tin, flower: [PAINT.tin, PAINT.marigold], display: false },
  { key: 'sign.hotel', background: PAINT.rani, text: PAINT.tin, shade: PAINT.soot, flower: [PAINT.marigold, PAINT.tin], display: true },
  { key: 'sign.motors', background: PAINT.soot, text: PAINT.marigold, shade: PAINT.tomato, flower: [PAINT.tomato, PAINT.marigold], display: false },
  { key: 'sign.radio', background: PAINT.tomato, text: PAINT.marigold, shade: PAINT.soot, flower: [PAINT.tin, PAINT.marigold], display: true },
  { key: 'sign.sweets', background: PAINT.tin, text: PAINT.rani, shade: PAINT.marigold, flower: [PAINT.rani, PAINT.marigold], display: true },
  { key: 'sign.turn', background: PAINT.marigold, text: PAINT.soot, shade: PAINT.tin, flower: [PAINT.soot, PAINT.tomato], display: false },
  { key: 'sign.closed', background: PAINT.soot, text: PAINT.marigold, shade: PAINT.tomato, flower: [PAINT.marigold, PAINT.soot], display: false },
  { key: 'sign.toll', background: PAINT.teal, text: PAINT.tin, shade: PAINT.soot, flower: [PAINT.marigold, PAINT.tin], display: false },
];

const SLOT_WIDTH = 1024;
const SLOT_HEIGHT = 256;
const COLUMNS = 2;
const ROWS = 7;

function drawSign(ctx: CanvasRenderingContext2D, x: number, y: number, style: SignStyle, seed: number): void {
  const w = SLOT_WIDTH;
  const h = SLOT_HEIGHT;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.fillStyle = style.background;
  ctx.fillRect(x, y, w, h);
  ctx.save();
  ctx.translate(x, y);
  paintGrain(ctx, w, h, seed, 0.12);
  ctx.restore();

  // Painted double border.
  ctx.strokeStyle = style.shade;
  ctx.lineWidth = 12;
  ctx.strokeRect(x + 12, y + 12, w - 24, h - 24);
  ctx.strokeStyle = style.text;
  ctx.lineWidth = 4;
  ctx.strokeRect(x + 28, y + 28, w - 56, h - 56);

  // Corner flowers and leaves, the rickshaw-painter signature.
  for (const flowerX of [x + 92, x + w - 92]) {
    const direction = flowerX < x + w / 2 ? 1 : -1;
    drawLeaf(ctx, flowerX, y + h / 2, 92, direction > 0 ? -0.7 : Math.PI + 0.7, PAINT.parrot);
    drawLeaf(ctx, flowerX, y + h / 2, 92, direction > 0 ? 0.7 : Math.PI - 0.7, PAINT.parrot);
    drawFlower(ctx, flowerX, y + h / 2, 58, style.flower[0], style.flower[1], PAINT.marigold);
  }

  // Lettering with a hard offset shade, no blur, like a sign painter's drop shadow.
  const text = worldText(style.key);
  const size = style.display ? 118 : 96;
  ctx.font = style.display ? `${size}px ${FONT_DISPLAY}` : `800 ${size}px ${FONT_STRONG}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxWidth = w - 340;
  ctx.fillStyle = style.shade;
  ctx.fillText(text, x + w / 2 + 5, y + h / 2 + 11, maxWidth);
  ctx.fillStyle = style.text;
  ctx.fillText(text, x + w / 2, y + h / 2 + 5, maxWidth);
  ctx.restore();
}

export interface SignAtlas {
  texture: CanvasTexture;
  rects: Map<string, SignRect>;
}

export function buildSignAtlas(anisotropy: number): SignAtlas {
  const { canvas, ctx } = makeCanvas(SLOT_WIDTH * COLUMNS, SLOT_HEIGHT * ROWS);
  const rects = new Map<string, SignRect>();
  SIGNS.forEach((style, index) => {
    const column = index % COLUMNS;
    const row = Math.floor(index / COLUMNS);
    const x = column * SLOT_WIDTH;
    const y = row * SLOT_HEIGHT;
    drawSign(ctx, x, y, style, 100 + index);
    rects.set(style.key, {
      u0: x / canvas.width,
      u1: (x + SLOT_WIDTH) / canvas.width,
      v0: 1 - (y + SLOT_HEIGHT) / canvas.height,
      v1: 1 - y / canvas.height,
    });
  });
  return { texture: toTexture(canvas, anisotropy), rects };
}
