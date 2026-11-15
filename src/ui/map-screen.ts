/** The full city map, with the places the GPS can take you. */

import { applyI18n, onI18nChange, t } from '../i18n';
import { PAINT } from '../render/painted-textures';
import { POINTS_OF_INTEREST } from '../world/city/city-map';
import type { RoadNetwork } from '../world/city/road-network';
import type { MapPainter } from './minimap';
import { flowerSvg } from './ornaments';

export interface MapScreenActions {
  choose(poiId: string): void;
  clearRoute(): void;
  close(): void;
}

export class MapScreen {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly scale: number;
  private playerX = 0;
  private playerZ = 0;
  private headingX = 0;
  private headingZ = 1;
  private route: readonly number[] = [];
  private destination = -1;
  private flags: ReadonlyArray<{ x: number; z: number; rival: boolean }> = [];

  constructor(
    private readonly painter: MapPainter,
    private readonly network: RoadNetwork,
    actions: MapScreenActions,
  ) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-map';
    const places = POINTS_OF_INTEREST.map(
      (poi) => `<button type="button" class="plaque plaque-indigo map-place" data-poi="${poi.id}" data-i18n="${poi.nameKey}"></button>`,
    ).join('');
    this.element.innerHTML = `
      <div class="board board-map">
        <div class="board-corner board-corner-tl">${flowerSvg('#d8402b', '#f2a20c', '#efe3c8')}</div>
        <canvas class="map-canvas" aria-hidden="true"></canvas>
        <div class="map-side">
          <h2 class="menu-title" data-i18n="city.map.title"></h2>
          <p class="map-hint" data-i18n="city.map.hint"></p>
          <div class="map-places">${places}</div>
          <ul class="map-legend">
            <li><i class="map-swatch map-swatch-garage"></i><span data-i18n="city.map.legendGarage"></span></li>
            <li><i class="map-swatch map-swatch-tea"></i><span data-i18n="city.map.legendTea"></span></li>
            <li><i class="map-swatch map-swatch-trap"></i><span data-i18n="city.map.legendTrap"></span></li>
            <li><i class="map-swatch map-swatch-flag"></i><span data-i18n="city.map.legendFlag"></span></li>
          </ul>
          <button type="button" class="plaque plaque-soot" data-action="clear" data-i18n="city.map.clear"></button>
          <button type="button" class="plaque plaque-tomato" data-action="close" data-i18n="city.map.close"></button>
        </div>
      </div>`;
    this.canvas = this.element.querySelector('.map-canvas') as HTMLCanvasElement;
    const maxSide = 640;
    this.scale = Math.min(maxSide / painter.canvas.width, maxSide / painter.canvas.height);
    this.canvas.width = Math.round(painter.canvas.width * this.scale);
    this.canvas.height = Math.round(painter.canvas.height * this.scale);
    applyI18n(this.element);

    this.element.querySelectorAll<HTMLButtonElement>('[data-poi]').forEach((button) => {
      button.addEventListener('click', () => actions.choose(button.dataset.poi as string));
    });
    this.element.querySelector('[data-action="clear"]')?.addEventListener('click', () => actions.clearRoute());
    this.element.querySelector('[data-action="close"]')?.addEventListener('click', () => actions.close());
    onI18nChange(() => this.draw());
  }

  /** Where races begin. */
  setFlags(flags: ReadonlyArray<{ x: number; z: number; rival: boolean }>): void {
    this.flags = flags;
  }

  /** Redraws with the current player position and route. */
  show(playerX: number, playerZ: number, headingX: number, headingZ: number, route: readonly number[], destination: number): void {
    this.playerX = playerX;
    this.playerZ = playerZ;
    this.headingX = headingX;
    this.headingZ = headingZ;
    this.route = route;
    this.destination = destination;
    this.draw();
  }

  private draw(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const painter = this.painter;
    const scale = this.scale;
    ctx.save();
    ctx.scale(scale, scale);
    ctx.drawImage(painter.canvas, 0, 0);
    painter.strokeRoute(ctx, this.route, 7);
    ctx.restore();
    painter.paintLabels(ctx, scale, 30);

    // Every destination gets a dot, and the chosen one a bigger one.
    for (const poi of POINTS_OF_INTEREST) {
      const node = this.network.nodes[this.network.nodeIndex(poi.node)];
      const chosen = node.index === this.destination;
      ctx.fillStyle = chosen ? '#6fe0c8' : PAINT.tin;
      ctx.strokeStyle = PAINT.soot;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(painter.toMapX(node.x) * scale, painter.toMapY(node.z) * scale, chosen ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    for (const flag of this.flags) {
      const x = painter.toMapX(flag.x) * scale;
      const y = painter.toMapY(flag.z) * scale;
      ctx.fillStyle = PAINT.soot;
      ctx.fillRect(x - 1, y - 12, 2.5, 13);
      ctx.fillStyle = flag.rival ? PAINT.tomato : PAINT.marigold;
      ctx.beginPath();
      ctx.moveTo(x + 1, y - 13);
      ctx.lineTo(x + 11, y - 9);
      ctx.lineTo(x + 1, y - 5);
      ctx.closePath();
      ctx.fill();
    }

    // The player, pointing the way the car faces.
    const px = painter.toMapX(this.playerX) * scale;
    const py = painter.toMapY(this.playerZ) * scale;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.atan2(this.headingX, -this.headingZ));
    ctx.fillStyle = PAINT.tomato;
    ctx.strokeStyle = PAINT.tin;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(8, 8);
    ctx.lineTo(0, 4);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** The name of a place, for the GPS plate. */
export function placeName(poiId: string): string {
  const poi = POINTS_OF_INTEREST.find((candidate) => candidate.id === poiId);
  return poi ? t(poi.nameKey) : '';
}

