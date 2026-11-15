/**
 * The dyno graph: engine power against road speed, for the car as it left the factory, as it is
 * now, and with the next part in place. One axis, thin lines, and a crosshair that reads values.
 */

import { formatInteger, t } from '../i18n';

export interface DynoSeries {
  /** Key for the name, under garage.dyno. */
  key: 'stock' | 'now' | 'next';
  /** Power in horsepower at each speed sample. */
  values: readonly number[];
}

/** Checked with the palette validator against this chart's dark surface. */
const COLOURS: Readonly<Record<DynoSeries['key'], string>> = { stock: '#4f86e0', now: '#c0800a', next: '#d9487e' };
const WIDTH = 420;
const HEIGHT = 200;
const LEFT = 40;
const RIGHT = 54;
const TOP = 12;
const BOTTOM = 26;
const SVG = 'http://www.w3.org/2000/svg';

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string | number>): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

export class DynoChart {
  readonly element: HTMLElement;
  private readonly svg: SVGSVGElement;
  private readonly legend: HTMLElement;
  private readonly tip: HTMLElement;
  private speeds: readonly number[] = [];
  private series: readonly DynoSeries[] = [];
  private maxY = 1;
  private crosshair: SVGLineElement | null = null;
  private readonly table: HTMLElement;
  private cursor = 0;

  constructor() {
    this.element = document.createElement('figure');
    this.element.className = 'dyno';
    this.svg = svgElement('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', class: 'dyno-svg' });
    this.legend = document.createElement('figcaption');
    this.legend.className = 'dyno-legend';
    this.tip = document.createElement('div');
    this.tip.className = 'dyno-tip';
    // The same numbers, as a table, for anyone who would rather read than hover.
    const details = document.createElement('details');
    details.className = 'dyno-table';
    details.append(document.createElement('summary'), document.createElement('table'));
    this.table = details;
    this.element.append(this.legend, this.svg, this.tip, details);
    this.svg.setAttribute('tabindex', '0');
    this.svg.addEventListener('pointermove', (event) => this.onPointer(event));
    this.svg.addEventListener('pointerdown', (event) => this.onPointer(event));
    this.svg.addEventListener('pointerleave', () => this.hideTip());
    this.svg.addEventListener('focus', () => this.showAt(Math.floor(this.speeds.length / 2)));
    this.svg.addEventListener('blur', () => this.hideTip());
    this.svg.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      this.showAt(this.cursor + (event.key === 'ArrowLeft' ? -1 : 1));
    });
  }

  private xOf(index: number): number {
    return LEFT + (index / (this.speeds.length - 1)) * (WIDTH - LEFT - RIGHT);
  }

  private yOf(value: number): number {
    return HEIGHT - BOTTOM - (value / this.maxY) * (HEIGHT - TOP - BOTTOM);
  }

  /** Draws the graph. @param speeds km/h of each sample, the same for every series */
  draw(speeds: readonly number[], series: readonly DynoSeries[]): void {
    this.speeds = speeds;
    this.series = series;
    const top = Math.max(1, ...series.flatMap((item) => item.values));
    this.maxY = Math.ceil(top / 50) * 50;
    const svg = this.svg;
    svg.replaceChildren();
    svg.setAttribute('aria-label', t('garage.dyno.label'));

    // Hairlines, solid and quiet, behind everything.
    for (let value = 0; value <= this.maxY; value += this.maxY > 300 ? 100 : 50) {
      const y = this.yOf(value);
      svg.appendChild(svgElement('line', { x1: LEFT, x2: WIDTH - RIGHT, y1: y, y2: y, class: 'dyno-grid' }));
      const label = svgElement('text', { x: LEFT - 6, y: y + 4, class: 'dyno-axis', 'text-anchor': 'end' });
      label.textContent = formatInteger(value);
      svg.appendChild(label);
    }
    const last = speeds[speeds.length - 1] ?? 1;
    for (let kmh = 0; kmh <= last; kmh += 50) {
      const x = LEFT + (kmh / last) * (WIDTH - LEFT - RIGHT);
      const label = svgElement('text', { x, y: HEIGHT - 9, class: 'dyno-axis', 'text-anchor': 'middle' });
      label.textContent = formatInteger(kmh);
      svg.appendChild(label);
    }

    this.legend.replaceChildren();
    for (const item of series) {
      const key = document.createElement('span');
      key.className = 'dyno-key';
      const swatch = document.createElement('i');
      swatch.style.background = COLOURS[item.key];
      const name = document.createElement('span');
      name.textContent = t(`garage.dyno.${item.key}`);
      key.append(swatch, name);
      this.legend.appendChild(key);
    }
    const axes = document.createElement('span');
    axes.className = 'dyno-axes';
    axes.textContent = t('garage.dyno.axes');
    this.legend.appendChild(axes);

    for (const item of series) {
      const points = item.values.map((value, index) => `${this.xOf(index).toFixed(1)},${this.yOf(value).toFixed(1)}`).join(' ');
      svg.appendChild(svgElement('polyline', { points, class: 'dyno-line', stroke: COLOURS[item.key] }));
    }
    // The strongest line is labelled at its end, in plain ink, so identity is not colour alone.
    this.labelEnds(series);

    this.crosshair = svgElement('line', { x1: 0, x2: 0, y1: TOP, y2: HEIGHT - BOTTOM, class: 'dyno-cross' });
    this.crosshair.style.display = 'none';
    svg.appendChild(this.crosshair);
    this.hideTip();
    this.fillTable();
  }

  private fillTable(): void {
    (this.table.querySelector('summary') as HTMLElement).textContent = t('garage.dyno.table');
    const table = this.table.querySelector('table') as HTMLElement;
    table.replaceChildren();
    const head = document.createElement('tr');
    for (const text of [t('garage.dyno.speed'), ...this.series.map((item) => t(`garage.dyno.${item.key}`))]) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = text;
      head.appendChild(cell);
    }
    table.appendChild(head);
    for (let i = 3; i < this.speeds.length; i += 4) {
      const row = document.createElement('tr');
      for (const text of [formatInteger(this.speeds[i]), ...this.series.map((item) => formatInteger(item.values[i]))]) {
        const cell = document.createElement('td');
        cell.textContent = text;
        row.appendChild(cell);
      }
      table.appendChild(row);
    }
  }

  private labelEnds(series: readonly DynoSeries[]): void {
    const used: number[] = [];
    for (const item of series) {
      const index = item.values.length - 1;
      let y = this.yOf(item.values[index]) + 4;
      while (used.some((other) => Math.abs(other - y) < 12)) y -= 12;
      used.push(y);
      const label = svgElement('text', { x: WIDTH - RIGHT + 8, y, class: 'dyno-end' });
      label.textContent = t(`garage.dyno.${item.key}`);
      this.svg.appendChild(svgElement('circle', { cx: this.xOf(index), cy: this.yOf(item.values[index]), r: 4, fill: COLOURS[item.key] }));
      this.svg.appendChild(label);
    }
  }

  private onPointer(event: PointerEvent): void {
    if (this.speeds.length < 2) return;
    const bounds = this.svg.getBoundingClientRect();
    if (bounds.width === 0) return;
    const px = ((event.clientX - bounds.left) / bounds.width) * WIDTH;
    const share = (px - LEFT) / (WIDTH - LEFT - RIGHT);
    this.showAt(Math.round(share * (this.speeds.length - 1)));
  }

  /** Puts the crosshair on one sample, and reads out every line there. */
  private showAt(wanted: number): void {
    if (this.speeds.length < 2) return;
    const index = Math.max(0, Math.min(this.speeds.length - 1, wanted));
    this.cursor = index;
    const x = this.xOf(index);
    if (this.crosshair) {
      this.crosshair.setAttribute('x1', String(x));
      this.crosshair.setAttribute('x2', String(x));
      this.crosshair.style.display = '';
    }
    this.tip.replaceChildren();
    const heading = document.createElement('strong');
    heading.textContent = t('garage.dyno.at', { kmh: formatInteger(this.speeds[index]) });
    this.tip.appendChild(heading);
    for (const item of this.series) {
      const row = document.createElement('span');
      const swatch = document.createElement('i');
      swatch.style.background = COLOURS[item.key];
      row.append(swatch, document.createTextNode(`${t(`garage.dyno.${item.key}`)}: ${t('garage.dyno.hp', { hp: formatInteger(item.values[index]) })}`));
      this.tip.appendChild(row);
    }
    this.tip.classList.add('is-visible');
    this.tip.style.left = `${(x / WIDTH) * 100}%`;
  }

  private hideTip(): void {
    this.tip.classList.remove('is-visible');
    if (this.crosshair) this.crosshair.style.display = 'none';
  }
}
