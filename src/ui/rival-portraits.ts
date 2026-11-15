/**
 * Painted portraits of the rivals, in the style of a cinema hoarding. All invented faces,
 * drawn once with Canvas 2D and then used as ordinary images in the HUD and menus.
 */

import { NPC_PORTRAITS, type NpcId } from '../config/achievements';
import { RIVAL_BY_ID, type RivalPortrait } from '../config/rivals';
import { PAINT, drawFlower, makeCanvas, paintGrain } from '../render/painted-textures';

const SIZE = 256;
const cache = new Map<string, string>();

function shade(hex: string, amount: number): string {
  const value = parseInt(hex.slice(1), 16);
  const clamp = (n: number): number => Math.max(0, Math.min(255, Math.round(n)));
  const r = clamp(((value >> 16) & 255) * amount);
  const g = clamp(((value >> 8) & 255) * amount);
  const b = clamp((value & 255) * amount);
  return `rgb(${r},${g},${b})`;
}

function paintHair(ctx: CanvasRenderingContext2D, portrait: RivalPortrait, cx: number, cy: number): void {
  ctx.fillStyle = portrait.hair;
  const style = portrait.hairStyle;
  // Behind the head first.
  if (style === 1 || style === 7) {
    ctx.beginPath();
    ctx.moveTo(cx - 56, cy - 28);
    ctx.quadraticCurveTo(cx - 74, cy + 56, cx - 52, cy + 92);
    ctx.lineTo(cx + 52, cy + 92);
    ctx.quadraticCurveTo(cx + 74, cy + 56, cx + 56, cy - 28);
    ctx.closePath();
    ctx.fill();
  }
  if (style === 2) {
    ctx.beginPath();
    ctx.arc(cx, cy - 74, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  if (style === 8) {
    ctx.beginPath();
    ctx.ellipse(cx + 52, cy + 24, 15, 54, 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintHairTop(ctx: CanvasRenderingContext2D, portrait: RivalPortrait, cx: number, cy: number): void {
  ctx.fillStyle = portrait.hair;
  const style = portrait.hairStyle;
  ctx.beginPath();
  ctx.ellipse(cx, cy - 26, 52, 34, 0, Math.PI, 0);
  ctx.fill();
  if (style === 3) {
    // A cap with a peak.
    ctx.fillStyle = shade(portrait.shirt, 0.8);
    ctx.beginPath();
    ctx.ellipse(cx, cy - 34, 54, 34, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(cx - 58, cy - 38, 116, 10);
    ctx.beginPath();
    ctx.ellipse(cx + 22, cy - 28, 44, 9, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === 4) {
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.arc(cx + i * 16, cy - 42 - (3 - Math.abs(i)) * 5, 15, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === 5) {
    for (let i = -3; i <= 3; i++) {
      ctx.beginPath();
      ctx.moveTo(cx + i * 15 - 11, cy - 44);
      ctx.lineTo(cx + i * 17, cy - 76 - (3 - Math.abs(i)) * 3);
      ctx.lineTo(cx + i * 15 + 11, cy - 44);
      ctx.closePath();
      ctx.fill();
    }
  } else if (style === 6) {
    ctx.beginPath();
    ctx.moveTo(cx - 50, cy - 26);
    ctx.quadraticCurveTo(cx - 20, cy - 70, cx + 52, cy - 44);
    ctx.quadraticCurveTo(cx + 10, cy - 46, cx - 50, cy - 26);
    ctx.fill();
  } else if (style === 1 || style === 7 || style === 2 || style === 8) {
    // A centre parting, falling either side of the forehead.
    ctx.beginPath();
    ctx.moveTo(cx, cy - 56);
    ctx.quadraticCurveTo(cx - 40, cy - 40, cx - 50, cy - 8);
    ctx.lineTo(cx - 56, cy - 34);
    ctx.quadraticCurveTo(cx - 40, cy - 64, cx, cy - 62);
    ctx.quadraticCurveTo(cx + 40, cy - 64, cx + 56, cy - 34);
    ctx.lineTo(cx + 50, cy - 8);
    ctx.quadraticCurveTo(cx + 40, cy - 40, cx, cy - 56);
    ctx.fill();
  }
}

function paintFace(ctx: CanvasRenderingContext2D, portrait: RivalPortrait): void {
  const cx = SIZE / 2;
  const cy = 112;

  ctx.fillStyle = portrait.backdrop;
  ctx.fillRect(0, 0, SIZE, SIZE);
  paintGrain(ctx, SIZE, SIZE, cx + portrait.hairStyle * 13, 0.16);
  // Painted rays behind the head, as on a hoarding.
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = PAINT.tin;
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * 240, cy + Math.sin(angle) * 240);
    ctx.lineTo(cx + Math.cos(angle + 0.2) * 240, cy + Math.sin(angle + 0.2) * 240);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  paintHair(ctx, portrait, cx, cy);

  // Shoulders.
  ctx.fillStyle = portrait.shirt;
  ctx.beginPath();
  ctx.moveTo(cx - 104, SIZE);
  ctx.quadraticCurveTo(cx - 92, 186, cx - 30, 176);
  ctx.lineTo(cx + 30, 176);
  ctx.quadraticCurveTo(cx + 92, 186, cx + 104, SIZE);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = shade(portrait.shirt, 0.72);
  ctx.beginPath();
  ctx.moveTo(cx - 22, 176);
  ctx.lineTo(cx, 214);
  ctx.lineTo(cx + 22, 176);
  ctx.closePath();
  ctx.fill();

  // Neck and head, with a shadow side painted in flat, as a sign painter would.
  ctx.fillStyle = shade(portrait.skin, 0.82);
  ctx.fillRect(cx - 22, 150, 44, 34);
  ctx.fillStyle = portrait.skin;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 50, 62, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = shade(portrait.skin, 0.84);
  ctx.beginPath();
  ctx.ellipse(cx + 20, cy + 6, 30, 56, 0, -1.2, 1.2);
  ctx.fill();

  // Brows, eyes, nose, mouth.
  ctx.strokeStyle = '#1b1410';
  ctx.lineCap = 'round';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(cx - 34, cy - 18);
  ctx.lineTo(cx - 12, cy - 22);
  ctx.moveTo(cx + 12, cy - 22);
  ctx.lineTo(cx + 34, cy - 18);
  ctx.stroke();
  for (const side of [-1, 1]) {
    ctx.fillStyle = '#efe3c8';
    ctx.beginPath();
    ctx.ellipse(cx + side * 22, cy - 6, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b1410';
    ctx.beginPath();
    ctx.arc(cx + side * 22, cy - 6, 4.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = shade(portrait.skin, 0.62);
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(cx - 2, cy - 2);
  ctx.quadraticCurveTo(cx - 7, cy + 16, cx + 5, cy + 18);
  ctx.stroke();
  ctx.strokeStyle = '#6a2a22';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - 17, cy + 34);
  ctx.quadraticCurveTo(cx, cy + 40, cx + 17, cy + 32);
  ctx.stroke();

  if (portrait.moustache) {
    ctx.fillStyle = portrait.hair;
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy + 30);
    ctx.quadraticCurveTo(cx, cy + 16, cx + 24, cy + 30);
    ctx.quadraticCurveTo(cx, cy + 26, cx - 24, cy + 30);
    ctx.fill();
  }
  if (portrait.beard) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = portrait.hair;
    ctx.beginPath();
    ctx.moveTo(cx - 44, cy + 22);
    ctx.quadraticCurveTo(cx, cy + 96, cx + 44, cy + 22);
    ctx.quadraticCurveTo(cx, cy + 58, cx - 44, cy + 22);
    ctx.fill();
    ctx.restore();
  }
  if (portrait.glasses) {
    ctx.strokeStyle = '#1b1410';
    ctx.lineWidth = 4;
    for (const side of [-1, 1]) {
      ctx.strokeRect(cx + side * 22 - 15, cy - 15, 30, 19);
    }
    ctx.beginPath();
    ctx.moveTo(cx - 7, cy - 8);
    ctx.lineTo(cx + 7, cy - 8);
    ctx.stroke();
  }
  paintHairTop(ctx, portrait, cx, cy);
  if (portrait.earring) {
    ctx.fillStyle = PAINT.marigold;
    ctx.beginPath();
    ctx.arc(cx - 50, cy + 14, 5.5, 0, Math.PI * 2);
    ctx.arc(cx + 50, cy + 14, 5.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // A rickshaw-painter's frame.
  ctx.strokeStyle = PAINT.soot;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, SIZE - 10, SIZE - 10);
  ctx.strokeStyle = PAINT.tin;
  ctx.lineWidth = 3;
  ctx.strokeRect(13, 13, SIZE - 26, SIZE - 26);
  drawFlower(ctx, 24, 24, 16, PAINT.tomato, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, SIZE - 24, 24, 16, PAINT.tomato, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, 24, SIZE - 24, 16, PAINT.tomato, PAINT.marigold, PAINT.tin);
  drawFlower(ctx, SIZE - 24, SIZE - 24, 16, PAINT.tomato, PAINT.marigold, PAINT.tin);
}

/** Someone at a tea stall, painted the same way. */
export function npcPortraitUrl(id: NpcId): string {
  const key = `npc:${id}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  paintFace(ctx, NPC_PORTRAITS[id]);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** A rival's portrait, as an image address. */
export function rivalPortraitUrl(id: string): string {
  const cached = cache.get(id);
  if (cached) return cached;
  const rival = RIVAL_BY_ID.get(id);
  if (!rival) return '';
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  paintFace(ctx, rival.portrait);
  const url = canvas.toDataURL('image/png');
  cache.set(id, url);
  return url;
}
