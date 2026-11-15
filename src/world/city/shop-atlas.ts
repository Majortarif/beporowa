/**
 * Small painted shop boards for পুরানটোলা, baked into one atlas.
 * Canvas 2D shapes the Bangla conjuncts, and one atlas keeps every board in one draw call.
 */

import { CanvasTexture } from 'three';
import { createRng } from '../../core/math';
import { worldText } from '../../i18n';
import { FONT_DISPLAY, FONT_STRONG, PAINT, drawFlower, makeCanvas, paintGrain, toTexture } from '../../render/painted-textures';
import type { SignRect } from '../sign-atlas';

export const SHOP_KEYS: readonly string[] = [
  'sign.shop.store', 'sign.shop.tailor', 'sign.shop.tea', 'sign.shop.spice', 'sign.shop.saree',
  'sign.shop.biryani', 'sign.shop.paan', 'sign.shop.library', 'sign.shop.hardware', 'sign.shop.electric',
  'sign.shop.jilapi', 'sign.shop.pharmacy', 'sign.shop.kantha', 'sign.shop.mobile', 'sign.shop.salon',
  'sign.shop.rosgolla', 'sign.shop.sweets', 'sign.shop.studio', 'sign.shop.market', 'sign.shop.fabric',
];

const COLUMNS = 4;
const ROWS = 12;
const SLOT_WIDTH = 512;
const SLOT_HEIGHT = 128;

const STYLES: ReadonlyArray<readonly [string, string, string]> = [
  [PAINT.marigold, PAINT.tomato, PAINT.soot],
  [PAINT.teal, PAINT.tin, PAINT.soot],
  [PAINT.tin, PAINT.indigo, PAINT.marigold],
  [PAINT.tomato, PAINT.tin, PAINT.soot],
  [PAINT.indigo, PAINT.marigold, PAINT.soot],
  [PAINT.rani, PAINT.tin, PAINT.soot],
  [PAINT.parrot, PAINT.soot, PAINT.tin],
  [PAINT.soot, PAINT.marigold, PAINT.tomato],
];

export interface ShopAtlas {
  texture: CanvasTexture;
  rects: SignRect[];
  rectByKey: Map<string, SignRect>;
}

export function buildShopAtlas(anisotropy: number): ShopAtlas {
  const { canvas, ctx } = makeCanvas(SLOT_WIDTH * COLUMNS, SLOT_HEIGHT * ROWS);
  const random = createRng(4133);
  const rects: SignRect[] = [];
  const rectByKey = new Map<string, SignRect>();
  const total = COLUMNS * ROWS;
  for (let i = 0; i < total; i++) {
    const key = SHOP_KEYS[i % SHOP_KEYS.length];
    const [background, text, shade] = STYLES[Math.floor(random() * STYLES.length)];
    const x = (i % COLUMNS) * SLOT_WIDTH;
    const y = Math.floor(i / COLUMNS) * SLOT_HEIGHT;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, SLOT_WIDTH, SLOT_HEIGHT);
    ctx.clip();
    ctx.fillStyle = background;
    ctx.fillRect(x, y, SLOT_WIDTH, SLOT_HEIGHT);
    ctx.save();
    ctx.translate(x, y);
    paintGrain(ctx, SLOT_WIDTH, SLOT_HEIGHT, 300 + i, 0.14);
    ctx.restore();
    ctx.strokeStyle = shade;
    ctx.lineWidth = 7;
    ctx.strokeRect(x + 6, y + 6, SLOT_WIDTH - 12, SLOT_HEIGHT - 12);
    drawFlower(ctx, x + 40, y + SLOT_HEIGHT / 2, 26, text, background, PAINT.marigold);
    const display = random() < 0.5;
    ctx.font = display ? `62px ${FONT_DISPLAY}` : `800 54px ${FONT_STRONG}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const label = worldText(key);
    const centerX = x + SLOT_WIDTH / 2 + 26;
    ctx.fillStyle = shade;
    ctx.fillText(label, centerX + 3, y + SLOT_HEIGHT / 2 + 7, SLOT_WIDTH - 104);
    ctx.fillStyle = text;
    ctx.fillText(label, centerX, y + SLOT_HEIGHT / 2 + 4, SLOT_WIDTH - 104);
    ctx.restore();
    const rect: SignRect = {
      u0: x / canvas.width,
      u1: (x + SLOT_WIDTH) / canvas.width,
      v0: 1 - (y + SLOT_HEIGHT) / canvas.height,
      v1: 1 - y / canvas.height,
    };
    rects.push(rect);
    if (!rectByKey.has(key)) rectByKey.set(key, rect);
  }
  return { texture: toTexture(canvas, anisotropy), rects, rectByKey };
}
