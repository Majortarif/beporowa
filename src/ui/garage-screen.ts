/**
 * The garage's panels, beside the live car: choosing and buying a car, parts with the dyno graph,
 * রিকশা আর্ট, and repairs. The car itself is drawn by the game, behind this.
 */

import { CAR_BY_ID, CARS, LIVERY_ARTS, LIVERY_BANDS, LIVERY_COLOURS, LIVERY_GLOWS, PARTS, PART_KINDS, PART_LEVEL_NEEDS, SLOGAN_CHOICES, SLOGAN_MAX_LENGTH, type CarDef, type LiveryDef, type PartKind } from '../config/cars';
import { formatInteger, formatNumber, onI18nChange, t, tList } from '../i18n';
import { dynoCurve, dynoSpeeds } from '../garage/dyno-curve';
import { checkSlogan } from '../garage/slogan-filter';
import { carLock, displayRating, isOwned, levelFor, partCost, partLock, repairCost, statsWithParts } from '../progression/economy';
import type { CareerData } from '../save/career';
import { DynoChart, type DynoSeries } from './dyno-chart';

export type GarageTab = 'cars' | 'parts' | 'paint';

export interface GarageActions {
  /** Shows a car on the lift, without changing anything yet. */
  preview(carId: string): void;
  buyCar(carId: string): void;
  selectCar(carId: string): void;
  buyPart(kind: PartKind): void;
  setLivery(patch: Partial<LiveryDef>): void;
  resetLivery(): void;
  repair(): void;
  /** Points the camera at the part of the car being worked on. */
  view(view: 'side' | 'rear' | 'front'): void;
  /** Lets the camera drift around the car again. */
  orbit(): void;
  /** Turns the camera by a drag across the empty part of the screen. */
  drag(pixels: number): void;
  close(): void;
}

const METERS: ReadonlyArray<keyof CarDef['stats']> = ['power', 'topSpeed', 'grip', 'brake', 'nitro', 'steer'];

export class GarageScreen {
  readonly element: HTMLElement;
  private readonly body: HTMLElement;
  private readonly money: HTMLElement;
  private readonly title: HTMLElement;
  private readonly tabs = new Map<GarageTab, HTMLButtonElement>();
  private readonly dyno = new DynoChart();
  private career: CareerData | null = null;
  private tab: GarageTab = 'cars';
  private previewId = 'bulbuli';
  private sloganMessage = '';

  constructor(private readonly actions: GarageActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-garage';
    this.element.innerHTML = `
      <div class="garage-panel board">
        <header class="garage-head">
          <h2 class="menu-title garage-title"></h2>
          <p class="garage-money"></p>
        </header>
        <div class="garage-tabs" role="tablist"></div>
        <div class="garage-body"></div>
        <button type="button" class="plaque plaque-tomato garage-exit"></button>
      </div>`;
    this.body = this.element.querySelector('.garage-body') as HTMLElement;
    this.money = this.element.querySelector('.garage-money') as HTMLElement;
    this.title = this.element.querySelector('.garage-title') as HTMLElement;
    const tabRow = this.element.querySelector('.garage-tabs') as HTMLElement;
    for (const tab of ['cars', 'parts', 'paint'] as const) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segment garage-tab';
      button.setAttribute('role', 'tab');
      button.addEventListener('click', () => this.openTab(tab));
      tabRow.appendChild(button);
      this.tabs.set(tab, button);
    }
    (this.element.querySelector('.garage-exit') as HTMLElement).addEventListener('click', () => actions.close());
    this.bindDrag();
    onI18nChange(() => this.render());
  }

  /** Dragging anywhere outside the panel turns the camera. */
  private bindDrag(): void {
    let lastX: number | null = null;
    this.element.addEventListener('pointerdown', (event) => {
      if (event.target !== this.element) return;
      lastX = event.clientX;
      this.element.setPointerCapture(event.pointerId);
    });
    this.element.addEventListener('pointermove', (event) => {
      if (lastX === null) return;
      this.actions.drag(event.clientX - lastX);
      lastX = event.clientX;
    });
    const release = (): void => {
      lastX = null;
    };
    this.element.addEventListener('pointerup', release);
    this.element.addEventListener('pointercancel', release);
  }

  show(career: CareerData): void {
    this.career = career;
    this.previewId = career.selectedCar;
    this.sloganMessage = '';
    this.openTab('cars');
  }

  /** Redraws, after something changed. */
  refresh(): void {
    this.render();
  }

  private openTab(tab: GarageTab): void {
    this.tab = tab;
    if (this.career && tab !== 'cars' && this.previewId !== this.career.selectedCar) {
      this.previewId = this.career.selectedCar;
      this.actions.preview(this.previewId);
    }
    if (tab === 'cars') this.actions.orbit();
    else this.actions.view(tab === 'paint' ? 'side' : 'front');
    this.render();
  }

  private render(): void {
    const career = this.career;
    if (!career) return;
    this.title.textContent = t('garage.title');
    this.money.textContent = t('garage.money', { cash: formatNumber(career.cash), level: formatInteger(levelFor(career.ringPoints)) });
    (this.element.querySelector('.garage-exit') as HTMLElement).textContent = t('garage.exit');
    for (const [tab, button] of this.tabs) {
      button.textContent = t(`garage.tab.${tab}`);
      button.setAttribute('aria-pressed', String(tab === this.tab));
      button.setAttribute('aria-selected', String(tab === this.tab));
    }
    // Rebuilding the panel must not lose the player's place in it.
    const focused = (document.activeElement as HTMLElement | null)?.dataset?.focusKey;
    const scroll = this.body.scrollTop;
    this.body.replaceChildren();
    if (this.tab === 'cars') this.renderCars(career);
    else if (this.tab === 'parts') this.renderParts(career);
    else this.renderPaint(career);
    this.body.scrollTop = scroll;
    if (focused) this.body.querySelector<HTMLElement>(`[data-focus-key="${focused}"]`)?.focus({ preventScroll: true });
  }

  // ---------- Cars ----------

  private renderCars(career: CareerData): void {
    const list = document.createElement('ul');
    list.className = 'garage-cars';
    for (const car of CARS) {
      const locked = car.id === 'rocket' && !career.champion && !career.freePlay && !isOwned(career, car.id);
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'garage-car';
      button.dataset.focusKey = `car:${car.id}`;
      button.classList.toggle('is-selected', car.id === this.previewId);
      button.classList.toggle('is-current', car.id === career.selectedCar);
      const name = document.createElement('strong');
      name.textContent = locked ? t('garage.secretName') : t(`car.${car.id}.name`);
      const kind = document.createElement('span');
      kind.className = 'garage-car-class';
      kind.textContent = t(`garage.class.${car.class}`);
      const state = document.createElement('span');
      state.className = 'garage-car-state';
      state.textContent = isOwned(career, car.id) ? t(car.id === career.selectedCar ? 'garage.driving' : 'garage.owned') : t('garage.price', { cash: formatNumber(car.price) });
      button.append(name, kind, state);
      button.addEventListener('click', () => {
        this.previewId = car.id;
        if (!locked) this.actions.preview(car.id);
        this.render();
      });
      item.appendChild(button);
      list.appendChild(item);
    }
    this.body.appendChild(list);

    const car = CAR_BY_ID.get(this.previewId);
    if (!car) return;
    const locked = car.id === 'rocket' && !career.champion && !career.freePlay && !isOwned(career, car.id);
    const detail = document.createElement('div');
    detail.className = 'garage-detail';
    const blurb = document.createElement('p');
    blurb.className = 'garage-blurb';
    blurb.textContent = locked ? t('garage.secretBlurb') : t(`car.${car.id}.blurb`);
    detail.appendChild(blurb);
    if (!locked) {
      const owned = career.cars[car.id];
      detail.appendChild(this.renderMeters(owned ? statsWithParts(car, owned.parts) : car.stats, car.stats));
    }

    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'plaque plaque-teal garage-action';
    action.dataset.focusKey = 'carAction';
    if (isOwned(career, car.id)) {
      if (car.id === career.selectedCar) {
        action.textContent = t('garage.driving');
        action.disabled = true;
      } else {
        action.textContent = t('garage.drive');
        action.addEventListener('click', () => {
          this.actions.selectCar(car.id);
          this.render();
        });
      }
    } else {
      const lock = carLock(career, car);
      action.textContent = lock === 'rank' ? t(car.id === 'rocket' ? 'garage.needChampion' : 'garage.needRank', { rank: formatInteger(car.needsRank) }) : lock === 'cash' ? t('garage.needCash', { cash: formatNumber(car.price - career.cash) }) : t('garage.buy', { cash: formatNumber(car.price) });
      action.disabled = lock !== 'none';
      action.addEventListener('click', () => {
        this.actions.buyCar(car.id);
        this.render();
      });
    }
    detail.appendChild(action);

    if (career.condition < 99.5) {
      const cost = repairCost(career);
      const repair = document.createElement('button');
      repair.type = 'button';
      repair.className = 'plaque plaque-marigold garage-action';
      repair.textContent = t('garage.repair', { condition: formatInteger(career.condition), cash: formatNumber(cost) });
      repair.disabled = career.cash < cost;
      repair.addEventListener('click', () => {
        this.actions.repair();
        this.render();
      });
      detail.appendChild(repair);
    }
    this.body.appendChild(detail);
  }

  /** Bars for a car's numbers, with a mark where a stock car of its kind stands. */
  private renderMeters(stats: CarDef['stats'], stock: CarDef['stats']): HTMLElement {
    const meters = document.createElement('dl');
    meters.className = 'garage-meters';
    const rating = document.createElement('p');
    rating.className = 'garage-rating';
    rating.textContent = t('garage.rating', { rating: formatInteger(displayRating(stats)) });
    meters.appendChild(rating);
    for (const key of METERS) {
      const term = document.createElement('dt');
      term.textContent = t(`garage.stat.${key}`);
      const value = document.createElement('dd');
      const track = document.createElement('span');
      track.className = 'garage-meter';
      const fill = document.createElement('i');
      // On this scale a stock starter sits at the middle, and the strongest cars fill it.
      fill.style.width = `${Math.min(100, (stats[key] / 2) * 100)}%`;
      const mark = document.createElement('b');
      mark.style.left = `${Math.min(100, (stock[key] / 2) * 100)}%`;
      track.append(fill, mark);
      const number = document.createElement('span');
      number.className = 'garage-meter-value';
      number.textContent = formatInteger(stats[key] * 100);
      value.append(track, number);
      meters.append(term, value);
    }
    return meters;
  }

  // ---------- Parts ----------

  private renderParts(career: CareerData): void {
    const car = CAR_BY_ID.get(career.selectedCar);
    const owned = career.cars[career.selectedCar];
    if (!car || !owned) return;

    const heading = document.createElement('h3');
    heading.className = 'garage-subhead';
    heading.textContent = t('garage.partsFor', { car: t(`car.${car.id}.name`) });
    this.body.appendChild(heading);

    this.drawDyno(car, owned.parts, this.hoveredPart);
    this.body.appendChild(this.dyno.element);

    const list = document.createElement('ul');
    list.className = 'garage-parts';
    for (const kind of PART_KINDS) {
      const level = owned.parts[kind];
      const lock = partLock(career, car, owned, kind);
      const item = document.createElement('li');
      item.className = 'garage-part';
      const info = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = t(`garage.part.${kind}.name`);
      const pips = document.createElement('span');
      pips.className = 'garage-pips';
      for (let i = 1; i <= 3; i++) {
        const pip = document.createElement('i');
        pip.classList.toggle('is-on', i <= level);
        pips.appendChild(pip);
      }
      const effect = document.createElement('p');
      effect.textContent = t(`garage.part.${kind}.desc`);
      info.append(name, pips, effect);
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'plaque plaque-teal garage-part-buy';
      buy.dataset.focusKey = `part:${kind}`;
      const next = level + 1;
      if (lock === 'max') buy.textContent = t('garage.partMax');
      else if (lock === 'level') buy.textContent = t('garage.partLevel', { level: formatInteger(PART_LEVEL_NEEDS[next - 1]) });
      else buy.textContent = t('garage.partBuy', { cash: formatNumber(career.freePlay ? 0 : partCost(car, kind, next)) });
      buy.disabled = lock !== 'none';
      buy.addEventListener('click', () => {
        this.actions.buyPart(kind);
        this.render();
      });
      // Pointing at a part shows on the graph what it would do.
      if (PARTS[kind].effects.power || PARTS[kind].effects.topSpeed) {
        const show = (): void => this.setHovered(kind);
        item.addEventListener('pointerenter', show);
        buy.addEventListener('focus', show);
        item.addEventListener('pointerleave', () => this.setHovered(null));
        buy.addEventListener('blur', () => this.setHovered(null));
      }
      item.append(info, buy);
      list.appendChild(item);
    }
    this.body.appendChild(list);
  }

  private hoveredPart: PartKind | null = null;

  private setHovered(kind: PartKind | null): void {
    if (this.hoveredPart === kind || !this.career) return;
    this.hoveredPart = kind;
    const career = this.career;
    const car = CAR_BY_ID.get(career.selectedCar);
    const owned = career.cars[career.selectedCar];
    // Only the graph changes, so that the row under the pointer stays put.
    if (car && owned) this.drawDyno(car, owned.parts, kind);
  }

  /** Draws stock against now, plus the next level of a part that changes the engine's numbers. */
  private drawDyno(car: CarDef, parts: Readonly<Record<PartKind, number>>, next: PartKind | null): void {
    const now = statsWithParts(car, parts);
    const preview = next && parts[next] < 3 ? statsWithParts(car, { ...parts, [next]: parts[next] + 1 }) : null;
    const speeds = dynoSpeeds([car.stats.topSpeed, now.topSpeed, preview?.topSpeed ?? 0]);
    const series: DynoSeries[] = [
      { key: 'stock', values: dynoCurve(car.stats.power, car.stats.topSpeed, speeds) },
      { key: 'now', values: dynoCurve(now.power, now.topSpeed, speeds) },
    ];
    if (preview) series.push({ key: 'next', values: dynoCurve(preview.power, preview.topSpeed, speeds) });
    this.dyno.draw(speeds, series);
  }

  // ---------- Paint ----------

  private renderPaint(career: CareerData): void {
    const owned = career.cars[career.selectedCar];
    if (!owned) return;
    const livery = owned.livery;
    const heading = document.createElement('h3');
    heading.className = 'garage-subhead';
    heading.textContent = t('garage.paintFor', { car: t(`car.${career.selectedCar}.name`) });
    this.body.appendChild(heading);

    const swatches = (labelKey: string, field: 'base' | 'accent' | 'rocker' | 'roof' | 'rim' | 'glow', colours: readonly string[], view: 'side' | 'rear' | 'front' = 'side'): void => {
      const row = document.createElement('div');
      row.className = 'paint-row';
      const label = document.createElement('span');
      label.className = 'paint-label';
      label.textContent = t(labelKey);
      const group = document.createElement('div');
      group.className = 'paint-swatches';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', t(labelKey));
      for (const [index, colour] of colours.entries()) {
        const swatch = document.createElement('button');
        swatch.type = 'button';
        swatch.className = 'paint-swatch';
        swatch.dataset.focusKey = `swatch:${field}:${index}`;
        swatch.style.background = colour;
        swatch.setAttribute('aria-label', `${t(labelKey)} ${colour}`);
        swatch.setAttribute('aria-pressed', String(livery[field] === colour));
        swatch.addEventListener('click', () => {
          this.actions.view(view);
          this.actions.setLivery({ [field]: colour });
          this.render();
        });
        group.appendChild(swatch);
      }
      row.append(label, group);
      this.body.appendChild(row);
    };
    // Season rewards add their colours after the standard ones, for good.
    const paints = [...LIVERY_COLOURS, ...(this.career?.unlocks.colours ?? []).filter((colour) => !LIVERY_COLOURS.includes(colour))];
    const glows = [...LIVERY_GLOWS, ...(this.career?.unlocks.glows ?? []).filter((colour) => !LIVERY_GLOWS.includes(colour))];
    swatches('garage.paint.base', 'base', paints);
    swatches('garage.paint.accent', 'accent', paints);
    swatches('garage.paint.rocker', 'rocker', paints);
    swatches('garage.paint.roof', 'roof', paints);
    swatches('garage.paint.rim', 'rim', paints);
    swatches('garage.paint.glow', 'glow', glows);

    const choices = (labelKey: string, values: readonly string[], selected: string, keyPrefix: string, apply: (value: string) => void): void => {
      const row = document.createElement('div');
      row.className = 'paint-row';
      const label = document.createElement('span');
      label.className = 'paint-label';
      label.textContent = t(labelKey);
      const group = document.createElement('div');
      group.className = 'paint-choices';
      for (const value of values) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'segment';
        button.dataset.focusKey = `${keyPrefix}:${value}`;
        button.textContent = t(`${keyPrefix}.${value}`);
        button.setAttribute('aria-pressed', String(selected === value));
        button.addEventListener('click', () => {
          apply(value);
          this.render();
        });
        group.appendChild(button);
      }
      row.append(label, group);
      this.body.appendChild(row);
    };
    choices('garage.paint.band', LIVERY_BANDS, livery.band, 'garage.band', (value) => {
      this.actions.view('side');
      this.actions.setLivery({ band: value as LiveryDef['band'] });
    });
    choices('garage.paint.art', LIVERY_ARTS, livery.art, 'garage.art', (value) => {
      this.actions.view('side');
      this.actions.setLivery({ art: value as LiveryDef['art'] });
    });

    // The words on the tail.
    const sloganRow = document.createElement('div');
    sloganRow.className = 'paint-slogan';
    const sloganLabel = document.createElement('label');
    sloganLabel.className = 'paint-label';
    sloganLabel.htmlFor = 'garage-slogan';
    sloganLabel.textContent = t('garage.paint.slogan');
    const input = document.createElement('input');
    input.id = 'garage-slogan';
    input.className = 'paint-input';
    input.type = 'text';
    input.maxLength = SLOGAN_MAX_LENGTH * 3;
    input.value = livery.slogan;
    input.placeholder = t('garage.paint.sloganHint');
    const message = document.createElement('p');
    message.className = 'paint-message';
    message.textContent = this.sloganMessage;
    message.setAttribute('role', 'status');
    input.addEventListener('input', () => {
      const problem = checkSlogan(input.value);
      this.sloganMessage = problem === 'rude' ? t('garage.sloganRude') : problem === 'tooLong' ? t('garage.sloganLong', { max: formatInteger(SLOGAN_MAX_LENGTH) }) : '';
      message.textContent = this.sloganMessage;
      input.setAttribute('aria-invalid', String(problem !== 'none'));
      if (problem === 'none') {
        this.actions.view('rear');
        this.actions.setLivery({ slogan: input.value });
      }
    });
    const presets = document.createElement('div');
    presets.className = 'paint-choices';
    const lines = tList('garage.sloganChoices');
    for (let i = 0; i < Math.min(SLOGAN_CHOICES, lines.length); i++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segment';
      button.textContent = lines[i];
      button.addEventListener('click', () => {
        this.sloganMessage = '';
        this.actions.view('rear');
        this.actions.setLivery({ slogan: lines[i] });
        this.render();
      });
      presets.appendChild(button);
    }
    sloganRow.append(sloganLabel, input, message, presets);
    this.body.appendChild(sloganRow);

    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'plaque plaque-soot garage-action';
    reset.textContent = t('garage.paint.reset');
    reset.addEventListener('click', () => {
      this.actions.resetLivery();
      this.render();
    });
    this.body.appendChild(reset);
  }
}
