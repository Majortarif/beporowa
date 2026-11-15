/**
 * The city drawn once onto a big canvas. The round minimap crops and rotates it around the
 * player at a low rate, and the full map screen shows all of it.
 */

import { CITY } from '../config/city-tuning';
import { createSample } from '../core/polyline';
import { t } from '../i18n';
import { FONT_DISPLAY, PAINT, makeCanvas } from '../render/painted-textures';
import { DISTRICT_NAME_KEYS, RIVER_Z, type DistrictId } from '../world/city/city-map';
import { markerColours } from './accessibility';

/** Each kind of marker has its own shape, so none of them depends on colour alone. */
function markerPath(ctx: CanvasRenderingContext2D, shape: 'diamond' | 'square' | 'triangle' | 'circle', x: number, y: number, size: number): void {
  ctx.beginPath();
  switch (shape) {
    case 'diamond':
      ctx.moveTo(x, y - size * 1.25);
      ctx.lineTo(x + size, y);
      ctx.lineTo(x, y + size * 1.25);
      ctx.lineTo(x - size, y);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(x - size * 0.9, y - size * 0.9, size * 1.8, size * 1.8);
      break;
    case 'triangle':
      ctx.moveTo(x, y - size * 1.2);
      ctx.lineTo(x + size * 1.1, y + size * 0.85);
      ctx.lineTo(x - size * 1.1, y + size * 0.85);
      ctx.closePath();
      break;
    case 'circle':
      ctx.arc(x, y, size, 0, Math.PI * 2);
      break;
  }
}
import type { RoadNetwork } from '../world/city/road-network';

const LABEL_POINTS: ReadonlyArray<readonly [DistrictId, number, number]> = [
  ['puranTola', -310, 340],
  ['uralganj', 130, -600],
  ['kajalGhat', -420, 770],
];

export class MapPainter {
  readonly canvas: HTMLCanvasElement;
  readonly scale: number;
  readonly originX: number;
  readonly originZ: number;

  constructor(private readonly network: RoadNetwork) {
    const config = CITY.minimap;
    const bounds = network.bounds;
    this.scale = config.pixelsPerMetre;
    this.originX = bounds.minX - config.fullMapPadding;
    this.originZ = bounds.minZ - config.fullMapPadding;
    const width = (bounds.maxX - bounds.minX + config.fullMapPadding * 2) * this.scale;
    const height = (bounds.maxZ - bounds.minZ + config.fullMapPadding * 2) * this.scale;
    const { canvas, ctx } = makeCanvas(Math.ceil(width), Math.ceil(height));
    this.canvas = canvas;
    this.paint(ctx);
  }

  toMapX(x: number): number {
    return (x - this.originX) * this.scale;
  }

  toMapY(z: number): number {
    return (z - this.originZ) * this.scale;
  }

  private strokeEdge(ctx: CanvasRenderingContext2D, edgeIndex: number): void {
    const line = this.network.edges[edgeIndex].full;
    const sample = createSample();
    ctx.beginPath();
    for (let i = 0; i < line.count; i++) {
      line.sample(i * line.spacing, sample);
      const x = this.toMapX(sample.x);
      const y = this.toMapY(sample.z);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  private paint(ctx: CanvasRenderingContext2D): void {
    const network = this.network;
    const { canvas } = ctx;
    ctx.fillStyle = '#231a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // The river along the south.
    ctx.fillStyle = '#123a44';
    ctx.fillRect(0, this.toMapY(RIVER_Z), canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Ground roads first, widest underneath, so the flyover draws over them.
    const widths: Record<string, number> = { lane: 4.6, street: 6.6, avenue: 10, ramp: 5.2, deck: 7 };
    for (const kind of ['lane', 'street', 'avenue'] as const) {
      ctx.strokeStyle = kind === 'lane' ? '#8e8064' : kind === 'street' ? '#b4a684' : '#d6c9a6';
      ctx.lineWidth = widths[kind];
      for (const edge of network.edges) if (edge.kind === kind && !edge.jam) this.strokeEdge(ctx, edge.index);
    }
    ctx.strokeStyle = PAINT.tomato;
    ctx.lineWidth = 8;
    for (const edge of network.edges) if (edge.jam) this.strokeEdge(ctx, edge.index);
    for (const kind of ['ramp', 'deck'] as const) {
      ctx.strokeStyle = PAINT.marigold;
      ctx.lineWidth = widths[kind];
      for (const edge of network.edges) if (edge.kind === kind) this.strokeEdge(ctx, edge.index);
    }

    // The monument, and each closed road.
    for (const node of network.nodes) {
      const x = this.toMapX(node.x);
      const y = this.toMapY(node.z);
      if (node.roundabout) {
        ctx.fillStyle = PAINT.teal;
        ctx.strokeStyle = PAINT.tin;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (node.closedSign) {
        ctx.fillStyle = PAINT.tomato;
        ctx.fillRect(x - 7, y - 3, 14, 6);
      }
    }
  }

  /** Marks hiding spots and traps on the map for good. */
  paintSpots(
    garages: ReadonlyArray<{ x: number; z: number }>,
    teaStalls: ReadonlyArray<{ x: number; z: number }>,
    traps: ReadonlyArray<{ x: number; z: number }>,
    workshop: { x: number; z: number } | null = null,
    floods: ReadonlyArray<{ x: number; z: number; yaw: number; halfLength: number; halfWidth: number }> = [],
  ): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = PAINT.soot;
    // Low roads are drawn a little blue, so a careful driver can plan around them in the rain.
    ctx.fillStyle = 'rgba(70, 150, 190, 0.55)';
    for (const flood of floods) {
      ctx.beginPath();
      ctx.ellipse(this.toMapX(flood.x), this.toMapY(flood.z), flood.halfWidth * this.scale * 1.3, flood.halfLength * this.scale, -flood.yaw, 0, Math.PI * 2);
      ctx.fill();
    }
    if (workshop) {
      // ওস্তাদ's workshop stands out from the car parks, with a red plate.
      const x = this.toMapX(workshop.x);
      const y = this.toMapY(workshop.z);
      ctx.fillStyle = PAINT.tomato;
      ctx.fillRect(x - 14, y - 14, 28, 28);
      ctx.strokeRect(x - 14, y - 14, 28, 28);
      ctx.strokeStyle = PAINT.tin;
      ctx.beginPath();
      ctx.moveTo(x - 7, y + 7);
      ctx.lineTo(x + 6, y - 6);
      ctx.moveTo(x + 2, y - 8);
      ctx.lineTo(x + 8, y - 2);
      ctx.stroke();
      ctx.strokeStyle = PAINT.soot;
    }
    ctx.fillStyle = PAINT.marigold;
    for (const stall of teaStalls) {
      ctx.beginPath();
      ctx.arc(this.toMapX(stall.x), this.toMapY(stall.z), 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = PAINT.tomato;
    for (const trap of traps) {
      const x = this.toMapX(trap.x);
      const y = this.toMapY(trap.z);
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 7.5, y + 6);
      ctx.lineTo(x - 7.5, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = PAINT.teal;
    for (const garage of garages) {
      const x = this.toMapX(garage.x);
      const y = this.toMapY(garage.z);
      ctx.fillRect(x - 11, y - 11, 22, 22);
      ctx.strokeRect(x - 11, y - 11, 22, 22);
    }
    ctx.restore();
  }

  /** The full map adds names, which the rotating minimap cannot show legibly. */
  paintLabels(ctx: CanvasRenderingContext2D, scale: number, fontPixels: number): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [district, x, z] of LABEL_POINTS) {
      ctx.font = `${fontPixels}px ${FONT_DISPLAY}`;
      const label = t(DISTRICT_NAME_KEYS[district]);
      const px = this.toMapX(x) * scale;
      const py = this.toMapY(z) * scale;
      ctx.fillStyle = PAINT.soot;
      ctx.fillText(label, px + 2, py + 2);
      ctx.fillStyle = PAINT.tin;
      ctx.fillText(label, px, py);
    }
    ctx.restore();
  }

  /** Draws the route line in map pixels, on an already transformed context. */
  strokeRoute(ctx: CanvasRenderingContext2D, points: readonly number[], width: number): void {
    if (points.length < 4) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = width + 3;
    ctx.strokeStyle = PAINT.soot;
    this.traceRoute(ctx, points);
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = '#6fe0c8';
    this.traceRoute(ctx, points);
    ctx.stroke();
    ctx.restore();
  }

  private traceRoute(ctx: CanvasRenderingContext2D, points: readonly number[]): void {
    ctx.beginPath();
    for (let i = 0; i + 1 < points.length; i += 2) {
      const x = this.toMapX(points[i]);
      const y = this.toMapY(points[i + 1]);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
}

/** The round map on the HUD: the world turns so that the player always points up. */
export class Minimap {
  readonly root: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size = 208;
  private timer = 0;
  private police: Float32Array | null = null;
  private policeCount = 0;
  private heliX: number | null = null;
  private heliZ = 0;
  private flash = false;
  private racers: Float32Array | null = null;
  private racerCount = 0;
  private friends: Float32Array | null = null;
  private friendCount = 0;

  constructor(parent: HTMLElement, private readonly painter: MapPainter) {
    this.root = document.createElement('div');
    this.root.className = 'hud-minimap';
    const canvas = document.createElement('canvas');
    canvas.width = this.size;
    canvas.height = this.size;
    canvas.className = 'hud-minimap-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    this.root.appendChild(canvas);
    parent.appendChild(this.root);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas is not available');
    this.ctx = ctx;
  }

  /** Police positions as x, z pairs, drawn on the next refresh. */
  setPolice(points: Float32Array, count: number, heliX: number | null, heliZ: number): void {
    this.police = points;
    this.policeCount = count;
    this.heliX = heliX;
    this.heliZ = heliZ;
  }

  /** Other racers as x, z pairs, drawn on the next refresh. */
  setRacers(points: Float32Array, count: number): void {
    this.racers = points;
    this.racerCount = count;
  }

  /** Friends' cars as x, z pairs, drawn on the next refresh. */
  setFriends(points: Float32Array, count: number): void {
    this.friends = points;
    this.friendCount = count;
  }

  update(dt: number, x: number, z: number, headingX: number, headingZ: number, route: readonly number[], destinationX: number | null, destinationZ: number | null): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1 / CITY.minimap.refreshHz;

    const ctx = this.ctx;
    const painter = this.painter;
    const half = this.size / 2;
    const zoom = this.size / (CITY.minimap.viewMetres * painter.scale);
    const heading = Math.atan2(headingX, -headingZ);

    ctx.save();
    ctx.clearRect(0, 0, this.size, this.size);
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#231a14';
    ctx.fillRect(0, 0, this.size, this.size);
    ctx.translate(half, half + 26);
    ctx.scale(zoom, zoom);
    ctx.rotate(-heading);
    ctx.translate(-painter.toMapX(x), -painter.toMapY(z));
    ctx.drawImage(painter.canvas, 0, 0);
    painter.strokeRoute(ctx, route, 6);
    const colours = markerColours();
    if (destinationX !== null && destinationZ !== null) {
      // A target: a ring with a dot in it.
      const tx = painter.toMapX(destinationX);
      const ty = painter.toMapY(destinationZ);
      ctx.lineWidth = 7;
      ctx.strokeStyle = PAINT.soot;
      markerPath(ctx, 'circle', tx, ty, 12);
      ctx.stroke();
      ctx.lineWidth = 4;
      ctx.strokeStyle = colours.destination;
      markerPath(ctx, 'circle', tx, ty, 12);
      ctx.stroke();
      ctx.fillStyle = colours.destination;
      markerPath(ctx, 'circle', tx, ty, 4.5);
      ctx.fill();
    }
    this.flash = !this.flash;
    if (this.racers) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = PAINT.soot;
      ctx.fillStyle = colours.racer;
      for (let i = 0; i < this.racerCount; i++) {
        markerPath(ctx, 'diamond', painter.toMapX(this.racers[i * 2]), painter.toMapY(this.racers[i * 2 + 1]), 9);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.friends) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = PAINT.soot;
      ctx.fillStyle = colours.friend;
      for (let i = 0; i < this.friendCount; i++) {
        markerPath(ctx, 'triangle', painter.toMapX(this.friends[i * 2]), painter.toMapY(this.friends[i * 2 + 1]), 10);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.police) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = PAINT.soot;
      for (let i = 0; i < this.policeCount; i++) {
        ctx.fillStyle = (i % 2 === 0) === this.flash ? colours.policeA : colours.policeB;
        markerPath(ctx, 'square', painter.toMapX(this.police[i * 2]), painter.toMapY(this.police[i * 2 + 1]), 9);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.heliX !== null) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = this.flash ? PAINT.tomato : PAINT.tin;
      ctx.beginPath();
      ctx.arc(painter.toMapX(this.heliX), painter.toMapY(this.heliZ), 20, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    // The player's arrow always points up.
    ctx.save();
    ctx.translate(half, half + 26);
    ctx.fillStyle = PAINT.tin;
    ctx.strokeStyle = PAINT.soot;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(8.5, 9);
    ctx.lineTo(0, 5);
    ctx.lineTo(-8.5, 9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

