/** দ্য রিং's Top 10 board: every rival, what they drive, and the races on the way to them. */

import { RIVALS, type RivalDef } from '../config/rivals';
import { formatInteger, formatLapTime, formatNumber, formatOrdinal, onI18nChange, t, tList } from '../i18n';
import { currentTier, eventsOfTier, isCompleted, isTierOpen, lockReason } from '../race/ring-ladder';
import type { CareerData } from '../save/career';
import { flowerSvg } from './ornaments';
import { rivalPortraitUrl } from './rival-portraits';

export interface RingBoardActions {
  startEvent(id: string): void;
  close(): void;
  setFreePlay(value: boolean): void;
  reset(): void;
}

const MEDAL_CLASS = ['', 'medal-bronze', 'medal-silver', 'medal-gold'];

export class RingBoard {
  readonly element: HTMLElement;
  private readonly list: HTMLElement;
  private readonly detail: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly freeButton: HTMLButtonElement;
  private selectedRank = 10;
  private career: CareerData | null = null;
  private blockedReason: string | null = null;
  private justBeaten: number | null = null;
  private resetArmed = false;

  constructor(actions: RingBoardActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-ring';
    this.element.innerHTML = `
      <div class="board board-ring">
        <div class="board-corner board-corner-tl">${flowerSvg('#d8402b', '#f2a20c', '#efe3c8')}</div>
        <div class="board-corner board-corner-tr">${flowerSvg('#0f7f7a', '#efe3c8', '#f2a20c')}</div>
        <header class="ring-head">
          <h2 class="menu-title ring-title"></h2>
          <p class="ring-summary"></p>
        </header>
        <div class="ring-body">
          <ol class="ring-list"></ol>
          <div class="ring-detail"></div>
        </div>
        <footer class="ring-foot">
          <button type="button" class="plaque plaque-tomato" data-action="close"></button>
          <button type="button" class="plaque plaque-soot" data-action="free"></button>
          <button type="button" class="plaque plaque-soot" data-action="reset"></button>
        </footer>
      </div>`;
    this.list = this.element.querySelector('.ring-list') as HTMLElement;
    this.detail = this.element.querySelector('.ring-detail') as HTMLElement;
    this.summary = this.element.querySelector('.ring-summary') as HTMLElement;
    this.freeButton = this.element.querySelector('[data-action="free"]') as HTMLButtonElement;
    this.element.querySelector('[data-action="close"]')?.addEventListener('click', () => actions.close());
    this.freeButton.addEventListener('click', () => {
      if (this.career) actions.setFreePlay(!this.career.freePlay);
      this.render();
    });
    // Wiping a whole career takes two presses.
    const resetButton = this.element.querySelector('[data-action="reset"]') as HTMLButtonElement;
    resetButton.addEventListener('click', () => {
      if (this.resetArmed) {
        this.resetArmed = false;
        actions.reset();
      } else {
        this.resetArmed = true;
      }
      this.render();
    });
    // One listener for all the rows, since the rows are rebuilt whenever anything changes.
    this.list.addEventListener('click', (event) => {
      const row = (event.target as HTMLElement).closest<HTMLElement>('[data-rank]');
      if (!row) return;
      this.selectedRank = Number(row.dataset.rank);
      this.render();
    });
    this.detail.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-event]');
      if (button && !button.hasAttribute('disabled')) actions.startEvent(button.dataset.event as string);
    });
    onI18nChange(() => this.render());
  }

  /** Shows the board for this career. @param blocked why races cannot start right now, if so */
  show(career: CareerData, blocked: string | null, justBeaten: number | null = null): void {
    this.career = career;
    this.resetArmed = false;
    this.blockedReason = blocked;
    this.justBeaten = justBeaten;
    this.selectedRank = currentTier(career);
    if (career.champion) this.selectedRank = 1;
    this.render();
  }

  private render(): void {
    const career = this.career;
    if (!career) return;
    (this.element.querySelector('.ring-title') as HTMLElement).textContent = t('ring.title');
    const rankText = career.rank > 10 ? t('ring.unranked') : t('ring.rank', { rank: formatOrdinal(career.rank) });
    this.summary.textContent = `${rankText} · ${t('ring.points', { points: formatNumber(career.ringPoints) })}`;
    (this.element.querySelector('[data-action="close"]') as HTMLElement).textContent = t('ring.close');
    (this.element.querySelector('[data-action="reset"]') as HTMLElement).textContent = t(this.resetArmed ? 'ring.resetConfirm' : 'ring.reset');
    this.freeButton.textContent = t(career.freePlay ? 'ring.freePlayOn' : 'ring.freePlayOff');

    this.list.replaceChildren();
    for (const rival of RIVALS) this.list.appendChild(this.renderRow(rival, career));
    this.renderDetail(career);
    this.renderClues(career);
  }

  /** What the tea stalls have said about this rival. */
  private renderClues(career: CareerData): void {
    const rival = RIVALS.find((candidate) => candidate.rank === this.selectedRank);
    if (!rival) return;
    const lines = tList(`adda.rumour.${rival.id}`);
    const heard = lines.filter((_line, index) => career.clues.includes(`${rival.id}:${index}`));
    if (heard.length === 0) return;
    const box = document.createElement('div');
    box.className = 'ring-clues';
    const title = document.createElement('strong');
    title.textContent = t('ring.clues');
    box.appendChild(title);
    for (const line of heard) {
      const item = document.createElement('p');
      item.textContent = line;
      box.appendChild(item);
    }
    this.detail.appendChild(box);
  }

  private renderRow(rival: RivalDef, career: CareerData): HTMLElement {
    const beaten = career.rank <= rival.rank;
    const open = isTierOpen(rival.rank, career);
    const item = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ring-row';
    button.dataset.rank = String(rival.rank);
    button.classList.toggle('is-selected', rival.rank === this.selectedRank);
    button.classList.toggle('is-beaten', beaten);
    button.classList.toggle('is-locked', !open && !beaten);
    button.classList.toggle('is-new', rival.rank === this.justBeaten);
    if (rival.rank === currentTier(career) && !beaten) button.classList.add('is-current');

    const rank = document.createElement('span');
    rank.className = 'ring-row-rank';
    rank.textContent = formatInteger(rival.rank);
    const image = document.createElement('img');
    image.className = 'ring-row-face';
    image.alt = '';
    if (open || beaten) image.src = rivalPortraitUrl(rival.id);
    const name = document.createElement('span');
    name.className = 'ring-row-name';
    name.textContent = open || beaten ? t(`rival.${rival.id}.nick`) : t('ring.hidden');
    const stamp = document.createElement('span');
    stamp.className = 'ring-row-stamp';
    stamp.textContent = beaten ? t('ring.beaten') : '';
    button.append(rank, image, name, stamp);
    item.appendChild(button);
    return item;
  }

  private renderDetail(career: CareerData): void {
    const rival = RIVALS.find((candidate) => candidate.rank === this.selectedRank);
    if (!rival) return;
    const open = isTierOpen(rival.rank, career) || career.rank <= rival.rank;
    const detail = this.detail;
    detail.replaceChildren();

    const top = document.createElement('div');
    top.className = 'ring-card';
    const face = document.createElement('img');
    face.className = 'ring-face';
    face.alt = open ? t(`rival.${rival.id}.name`) : '';
    if (open) face.src = rivalPortraitUrl(rival.id);
    else face.classList.add('is-hidden');
    const text = document.createElement('div');
    text.className = 'ring-card-text';
    const heading = document.createElement('h3');
    heading.className = 'ring-name';
    heading.textContent = open ? t(`rival.${rival.id}.name`) : t('ring.hidden');
    text.appendChild(heading);
    if (open) {
      const facts: Array<[string, string]> = [
        [t('ring.car'), t(`rival.${rival.id}.car`)],
        [t('ring.style'), t(`rival.${rival.id}.style`)],
      ];
      const list = document.createElement('dl');
      list.className = 'ring-facts';
      for (const [label, value] of facts) {
        const term = document.createElement('dt');
        term.textContent = label;
        const description = document.createElement('dd');
        description.textContent = value;
        list.append(term, description);
      }
      text.appendChild(list);
      const bio = document.createElement('p');
      bio.className = 'ring-bio';
      bio.textContent = t(`rival.${rival.id}.bio`);
      text.appendChild(bio);
      const lines = tList(`rival.${rival.id}.intro`);
      if (lines.length > 0) {
        const quote = document.createElement('blockquote');
        quote.className = 'ring-quote';
        quote.textContent = lines[0];
        text.appendChild(quote);
      }
    } else {
      const bio = document.createElement('p');
      bio.className = 'ring-bio';
      bio.textContent = t('ring.hiddenBio');
      text.appendChild(bio);
    }
    top.append(face, text);
    detail.appendChild(top);

    if (this.blockedReason) {
      const note = document.createElement('p');
      note.className = 'ring-blocked';
      note.textContent = this.blockedReason;
      detail.appendChild(note);
    }

    const events = document.createElement('ul');
    events.className = 'ring-events';
    for (const event of eventsOfTier(rival.rank)) {
      const reason = lockReason(event, career);
      const record = career.events[event.id];
      const row = document.createElement('li');
      row.className = 'ring-event';
      row.classList.toggle('is-rival', event.rivalRace !== undefined);

      const info = document.createElement('div');
      info.className = 'ring-event-info';
      const name = document.createElement('strong');
      name.textContent = t(`race.event.${event.id}.name`);
      const mode = document.createElement('span');
      mode.className = 'ring-event-mode';
      mode.textContent = t(`race.mode.${event.mode}`);
      const brief = document.createElement('p');
      brief.textContent =
        reason === 'tier' ? t('ring.lockedTier') : reason === 'warmups' ? t('ring.lockedWarmup') : t(`race.event.${event.id}.brief`);
      info.append(name, mode, brief);
      if (record?.bestMs && (event.mode === 'timeTrial' || event.mode === 'drag')) {
        const best = document.createElement('span');
        best.className = 'ring-event-best';
        best.textContent = t('ring.best', { time: formatLapTime(record.bestMs) });
        info.appendChild(best);
      }

      const side = document.createElement('div');
      side.className = 'ring-event-side';
      if (record && record.medal > 0) {
        const medal = document.createElement('span');
        medal.className = `ring-medal ${MEDAL_CLASS[record.medal]}`;
        medal.textContent = t(`race.medal.${record.medal}`);
        side.appendChild(medal);
      } else if (isCompleted(event.id, career)) {
        const done = document.createElement('span');
        done.className = 'ring-medal';
        done.textContent = t('ring.done');
        side.appendChild(done);
      }
      const start = document.createElement('button');
      start.type = 'button';
      start.className = `plaque ${event.rivalRace ? 'plaque-tomato' : 'plaque-teal'} ring-start`;
      start.dataset.event = event.id;
      start.textContent = t('ring.start');
      if (reason !== 'none' || this.blockedReason) start.setAttribute('disabled', '');
      side.appendChild(start);
      row.append(info, side);
      events.appendChild(row);
    }
    detail.appendChild(events);
  }
}
