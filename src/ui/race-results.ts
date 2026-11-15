/** The results board after a race: how it went, what it was worth, and what the rival has to say. */

import { RIVAL_BY_ID } from '../config/rivals';
import { formatLapTime, formatNumber, formatOrdinal, localizeDigits, t, tList } from '../i18n';
import type { RaceOutcome } from '../race/race-session';
import type { ResultChange } from '../race/ring-ladder';
import { flowerSvg } from './ornaments';
import { rivalPortraitUrl } from './rival-portraits';

export interface ResultActions {
  retry(): void;
  board(): void;
  city(): void;
  replay(): void;
  ghostBattle(): void;
}

/** More for the board to say, for runs outside the Ring: ghosts, challenges, friends. */
export interface ResultExtra {
  title?: string;
  subtitle?: string;
  facts?: Array<[string, string]>;
  /** The run changed nothing in the career, so no points are shown. */
  practice?: boolean;
  /** Offer a race against the ghost. */
  ghostBattle?: boolean;
  /** Words for the board button, when it leads somewhere other than the Ring. */
  boardLabel?: string;
}

export interface ResultRow {
  name: string;
  isPlayer: boolean;
  time: string;
}

const MEDAL_CLASS = ['', 'medal-bronze', 'medal-silver', 'medal-gold'];

export class RaceResults {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly subtitle: HTMLElement;
  private readonly medal: HTMLElement;
  private readonly facts: HTMLElement;
  private readonly table: HTMLElement;
  private readonly say: HTMLElement;
  private readonly sayFace: HTMLImageElement;
  private readonly sayName: HTMLElement;
  private readonly sayLine: HTMLElement;
  private readonly rankUp: HTMLElement;

  constructor(actions: ResultActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-result';
    this.element.innerHTML = `
      <div class="board board-menu board-result">
        <div class="board-corner board-corner-tl">${flowerSvg('#d8402b', '#f2a20c', '#efe3c8')}</div>
        <div class="board-corner board-corner-tr">${flowerSvg('#0f7f7a', '#efe3c8', '#f2a20c')}</div>
        <h2 class="menu-title result-title"></h2>
        <p class="result-subtitle"></p>
        <div class="result-medal"></div>
        <div class="result-rank"></div>
        <dl class="result-facts"></dl>
        <ol class="result-table"></ol>
        <div class="result-say">
          <img class="result-say-face" alt="" />
          <div><strong class="result-say-name"></strong><p class="result-say-line"></p></div>
        </div>
        <div class="result-actions">
          <button type="button" class="plaque plaque-tomato" data-action="retry"></button>
          <button type="button" class="plaque plaque-teal" data-action="board"></button>
          <button type="button" class="plaque plaque-indigo" data-action="city"></button>
          <button type="button" class="plaque plaque-soot" data-action="replay"></button>
          <button type="button" class="plaque plaque-teal" data-action="ghost"></button>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(selector: string): T => this.element.querySelector(selector) as T;
    this.title = q('.result-title');
    this.subtitle = q('.result-subtitle');
    this.medal = q('.result-medal');
    this.facts = q('.result-facts');
    this.table = q('.result-table');
    this.say = q('.result-say');
    this.sayFace = q('.result-say-face');
    this.sayName = q('.result-say-name');
    this.sayLine = q('.result-say-line');
    this.rankUp = q('.result-rank');
    q('[data-action="retry"]').addEventListener('click', () => actions.retry());
    q('[data-action="board"]').addEventListener('click', () => actions.board());
    q('[data-action="city"]').addEventListener('click', () => actions.city());
    q('[data-action="replay"]').addEventListener('click', () => actions.replay());
    q('[data-action="ghost"]').addEventListener('click', () => actions.ghostBattle());
  }

  show(outcome: RaceOutcome, change: ResultChange, rows: readonly ResultRow[], extra: ResultExtra = {}): void {
    const event = outcome.event;
    const q = (selector: string): HTMLElement => this.element.querySelector(selector) as HTMLElement;
    q('[data-action="retry"]').textContent = t('race.result.retry');
    q('[data-action="board"]').textContent = extra.boardLabel ?? t('race.result.board');
    q('[data-action="city"]').textContent = t('race.result.city');
    q('[data-action="replay"]').textContent = t('race.result.replay');
    const ghostButton = q('[data-action="ghost"]');
    ghostButton.textContent = t('ghost.battle');
    ghostButton.hidden = extra.ghostBattle !== true;

    const titleKey =
      outcome.failure === 'busted'
        ? 'race.result.busted'
        : outcome.failure === 'time'
          ? 'race.result.outOfTime'
          : outcome.failure === 'cargo'
            ? 'race.result.cargoGone'
            : outcome.failure === 'dnf'
              ? 'race.result.dnf'
              : outcome.completed
                ? 'race.result.won'
                : 'race.result.lost';
    this.title.textContent = extra.title ?? t(titleKey);
    this.title.classList.toggle('is-win', outcome.completed);
    this.subtitle.textContent = extra.subtitle ?? t(`race.event.${event.id}.name`);

    this.medal.className = `result-medal ${MEDAL_CLASS[outcome.medal]}`;
    this.medal.textContent = outcome.medal > 0 ? t(`race.medal.${outcome.medal}`) : '';
    this.medal.classList.toggle('is-visible', outcome.medal > 0);

    this.rankUp.classList.toggle('is-visible', change.newRank !== null);
    this.rankUp.textContent = change.newRank !== null ? t(change.champion ? 'race.result.champion' : 'race.result.rankUp', { rank: formatOrdinal(change.newRank) }) : '';

    const facts: Array<[string, string]> = [];
    if (outcome.racers > 1 && outcome.failure === 'none') facts.push([t('race.result.place'), `${formatOrdinal(outcome.position)} / ${localizeDigits(String(outcome.racers))}`]);
    facts.push([t('race.result.time'), formatLapTime(outcome.timeMs)]);
    if (event.mode === 'drift') facts.push([t('race.result.score'), formatNumber(outcome.score)]);
    if (event.timeLimit !== undefined && event.mode !== 'drift') facts.push([t('race.result.timeLeft'), formatLapTime(outcome.timeLeft * 1000)]);
    if (event.mode === 'delivery') facts.push([t('race.result.cargo'), `${localizeDigits(String(Math.round(outcome.cargo)))}%`]);
    if (!extra.practice) facts.push([t('race.result.points'), `+${formatNumber(change.pointsGained)}`]);
    if (change.cashGained > 0) facts.push([t('race.result.cash'), t('hud.money', { cash: formatNumber(change.cashGained) })]);
    if (change.levelUp !== null) facts.push([t('race.result.level'), localizeDigits(String(change.levelUp))]);
    if (extra.facts) facts.push(...extra.facts);
    this.facts.replaceChildren();
    for (const [label, value] of facts) {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      this.facts.append(term, detail);
    }

    this.setRows(rows);

    // The rival has the last word, and a boss win ends with its story.
    const rivalId = extra.practice ? undefined : event.rivalRace;
    const rival = rivalId ? RIVAL_BY_ID.get(rivalId) : undefined;
    this.say.classList.toggle('is-visible', rival !== undefined);
    if (rival) {
      const lines = tList(`rival.${rival.id}.${outcome.rivalBeaten ? 'lose' : 'win'}`);
      this.sayFace.src = rivalPortraitUrl(rival.id);
      this.sayName.textContent = t(`rival.${rival.id}.nick`);
      this.sayLine.textContent = lines.length > 0 ? lines[Math.floor(Math.random() * lines.length)] : '';
    }
    (this.element.querySelector('[data-action="retry"]') as HTMLElement).focus({ preventScroll: true });
  }

  /** The table of who finished where. */
  setRows(rows: readonly ResultRow[]): void {
    this.table.replaceChildren();
    this.table.classList.toggle('is-visible', rows.length > 1);
    rows.slice(0, 8).forEach((row, index) => {
      const item = document.createElement('li');
      item.classList.toggle('is-player', row.isPlayer);
      const place = document.createElement('span');
      place.textContent = localizeDigits(String(index + 1));
      const name = document.createElement('span');
      name.textContent = row.name;
      const time = document.createElement('span');
      time.textContent = row.time;
      item.append(place, name, time);
      this.table.appendChild(item);
    });
  }
}
