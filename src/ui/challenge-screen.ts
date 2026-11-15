/**
 * The চ্যালেঞ্জ board: today's and this week's challenge with the word of the day, the
 * leaderboard for whichever is chosen, and the free season pass. All text from i18n keys.
 */

import { onI18nChange, t } from '../i18n';
import { flowerSvg } from './ornaments';

export type CardSlot = 'daily' | 'weekly';

export interface ChallengeCardView {
  slot: CardSlot;
  mode: string;
  title: string;
  sky: string;
  brief: string;
  goal: string;
  reward: string;
  status: string;
  done: boolean;
  /** A roam challenge from this card is running now. */
  running: boolean;
}

export interface BoardRowView {
  id: string;
  rank: string;
  name: string;
  value: string;
  car: string;
  ghost: boolean;
}

export interface BoardView {
  slot: CardSlot;
  title: string;
  rows: BoardRowView[];
  note: string;
  /** Rows can be raced as ghosts. */
  ghosts: boolean;
}

export interface TierView {
  tier: number;
  label: string;
  reward: string;
  state: 'locked' | 'claimable' | 'claimed';
}

export interface SeasonView {
  title: string;
  days: string;
  xpText: string;
  share: number;
  tiers: TierView[];
  stamps: string;
}

export interface ChallengeScreenView {
  word: string;
  cards: ChallengeCardView[];
  board: BoardView | null;
  season: SeasonView;
  friends: boolean;
}

export interface ChallengeScreenActions {
  start(slot: CardSlot): void;
  giveUp(): void;
  showBoard(slot: CardSlot): void;
  raceGhost(slot: CardSlot, entryId: string, name: string): void;
  claim(tier: number): void;
  friends(): void;
  close(): void;
}

export class ChallengeScreen {
  readonly element: HTMLElement;
  private view: ChallengeScreenView | null = null;

  constructor(private readonly actions: ChallengeScreenActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-challenges';
    this.element.innerHTML = `
      <div class="board board-menu board-wide board-challenges">
        <div class="board-corner board-corner-tl">${flowerSvg('#d8402b', '#f2a20c', '#efe3c8')}</div>
        <div class="board-corner board-corner-tr">${flowerSvg('#0f7f7a', '#efe3c8', '#f2a20c')}</div>
        <h2 class="menu-title" data-t="challenge.title"></h2>
        <p class="challenge-word"></p>
        <div class="challenge-cards"></div>
        <section class="challenge-board" aria-live="polite">
          <h3 class="challenge-board-title"></h3>
          <ol class="challenge-board-list"></ol>
          <p class="challenge-board-note"></p>
        </section>
        <section class="season">
          <div class="season-head"><h3 class="season-title"></h3><span class="season-days"></span></div>
          <div class="season-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
          <p class="season-xp"></p>
          <ol class="season-tiers"></ol>
          <p class="season-stamps"></p>
        </section>
        <div class="challenge-footer">
          <button type="button" class="plaque plaque-teal" data-action="friends" data-t="friends.title"></button>
          <button type="button" class="plaque plaque-indigo" data-action="back" data-t="settings.back"></button>
        </div>
      </div>`;
    this.element.querySelector('[data-action="friends"]')?.addEventListener('click', () => this.actions.friends());
    this.element.querySelector('[data-action="back"]')?.addEventListener('click', () => this.actions.close());
    onI18nChange(() => this.render());
  }

  show(view: ChallengeScreenView): void {
    this.view = view;
    this.render();
  }

  private render(): void {
    this.element.querySelectorAll<HTMLElement>('[data-t]').forEach((element) => {
      element.textContent = t(element.dataset.t as string);
    });
    const view = this.view;
    if (!view) return;
    (this.element.querySelector('.challenge-word') as HTMLElement).textContent = view.word;
    (this.element.querySelector('[data-action="friends"]') as HTMLElement).hidden = !view.friends;
    this.renderCards(view.cards);
    this.renderBoard(view.board);
    this.renderSeason(view.season);
  }

  private renderCards(cards: readonly ChallengeCardView[]): void {
    const holder = this.element.querySelector('.challenge-cards') as HTMLElement;
    holder.replaceChildren();
    for (const card of cards) {
      const article = document.createElement('article');
      article.className = 'challenge-card';
      article.dataset.slot = card.slot;
      article.classList.toggle('is-done', card.done);
      const head = document.createElement('header');
      const kicker = document.createElement('span');
      kicker.className = 'challenge-kicker';
      kicker.textContent = t(`challenge.slot.${card.slot}`);
      const mode = document.createElement('span');
      mode.className = 'challenge-mode';
      mode.textContent = card.mode;
      head.append(kicker, mode);
      const title = document.createElement('h3');
      title.className = 'challenge-title';
      title.textContent = card.title;
      const lines: Array<[string, string]> = [
        ['challenge-sky', card.sky],
        ['challenge-brief', card.brief],
        ['challenge-goal', card.goal],
        ['challenge-reward', card.reward],
        ['challenge-status', card.status],
      ];
      article.append(head, title);
      for (const [className, text] of lines) {
        if (!text) continue;
        const line = document.createElement('p');
        line.className = className;
        line.textContent = text;
        article.appendChild(line);
      }
      const buttons = document.createElement('div');
      buttons.className = 'challenge-actions';
      const start = document.createElement('button');
      start.type = 'button';
      start.className = card.running ? 'plaque plaque-soot' : 'plaque plaque-tomato';
      start.textContent = t(card.running ? 'challenge.giveUp' : card.done ? 'challenge.again' : 'challenge.start');
      start.addEventListener('click', () => (card.running ? this.actions.giveUp() : this.actions.start(card.slot)));
      const board = document.createElement('button');
      board.type = 'button';
      board.className = 'plaque plaque-indigo';
      board.textContent = t('challenge.board');
      board.addEventListener('click', () => this.actions.showBoard(card.slot));
      buttons.append(start, board);
      article.appendChild(buttons);
      holder.appendChild(article);
    }
  }

  private renderBoard(board: BoardView | null): void {
    const section = this.element.querySelector('.challenge-board') as HTMLElement;
    section.hidden = board === null;
    if (!board) return;
    (section.querySelector('.challenge-board-title') as HTMLElement).textContent = board.title;
    (section.querySelector('.challenge-board-note') as HTMLElement).textContent = board.note;
    const list = section.querySelector('.challenge-board-list') as HTMLElement;
    list.replaceChildren();
    for (const row of board.rows) {
      const item = document.createElement('li');
      const rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = row.rank;
      const name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = row.name;
      const car = document.createElement('span');
      car.className = 'board-car';
      car.textContent = row.car;
      const value = document.createElement('span');
      value.className = 'board-value';
      value.textContent = row.value;
      item.append(rank, name, car, value);
      if (board.ghosts && row.ghost) {
        const race = document.createElement('button');
        race.type = 'button';
        race.className = 'plaque plaque-teal board-ghost';
        race.textContent = t('ghost.raceThis');
        race.setAttribute('aria-label', t('ghost.raceName', { name: row.name }));
        race.addEventListener('click', () => this.actions.raceGhost(board.slot, row.id, row.name));
        item.appendChild(race);
      }
      list.appendChild(item);
    }
  }

  private renderSeason(season: SeasonView): void {
    const q = (selector: string): HTMLElement => this.element.querySelector(selector) as HTMLElement;
    q('.season-title').textContent = season.title;
    q('.season-days').textContent = season.days;
    q('.season-xp').textContent = season.xpText;
    q('.season-stamps').textContent = season.stamps;
    const meter = q('.season-meter');
    meter.setAttribute('aria-valuenow', String(Math.round(season.share * 100)));
    meter.setAttribute('aria-label', season.xpText);
    (meter.querySelector('i') as HTMLElement).style.width = `${(season.share * 100).toFixed(1)}%`;
    const list = q('.season-tiers');
    list.replaceChildren();
    for (const tier of season.tiers) {
      const item = document.createElement('li');
      item.dataset.state = tier.state;
      const number = document.createElement('span');
      number.className = 'tier-number';
      number.textContent = tier.label;
      const reward = document.createElement('span');
      reward.className = 'tier-reward';
      reward.textContent = tier.reward;
      item.append(number, reward);
      if (tier.state === 'claimable') {
        const claim = document.createElement('button');
        claim.type = 'button';
        claim.className = 'plaque plaque-marigold tier-claim';
        claim.textContent = t('season.claim');
        claim.setAttribute('aria-label', t('season.claimTier', { tier: tier.label }));
        claim.addEventListener('click', () => this.actions.claim(tier.tier));
        item.appendChild(claim);
      } else {
        const state = document.createElement('span');
        state.className = 'tier-state';
        state.textContent = t(`season.state.${tier.state}`);
        item.appendChild(state);
      }
      list.appendChild(item);
    }
  }

  focusFirst(): void {
    this.element.querySelector<HTMLElement>('.challenge-card button')?.focus({ preventScroll: true });
  }
}
