/** The খাতা: level, money, the job in hand, and every achievement under its proverb. */

import { ACHIEVEMENTS, JOB_BY_ID, type StatKey } from '../config/achievements';
import { PROGRESS } from '../config/progression';
import { formatInteger, formatNumber, onI18nChange, t } from '../i18n';
import { levelFor, levelShare, repForLevel } from '../progression/economy';
import type { CareerData } from '../save/career';
import { flowerSvg } from './ornaments';

export interface LedgerActions {
  close(): void;
  dropJob(): void;
}

const SHOWN_STATS: readonly StatKey[] = ['raceWins', 'rivalsBeaten', 'escapes', 'busts', 'teas', 'kilometres'];

export class LedgerScreen {
  readonly element: HTMLElement;
  private readonly summary: HTMLElement;
  private readonly list: HTMLElement;
  private career: CareerData | null = null;

  constructor(private readonly actions: LedgerActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-ledger';
    this.element.innerHTML = `
      <div class="board board-menu board-wide board-ledger">
        <div class="board-corner board-corner-tl">${flowerSvg('#d8402b', '#f2a20c', '#efe3c8')}</div>
        <div class="board-corner board-corner-tr">${flowerSvg('#0f7f7a', '#efe3c8', '#f2a20c')}</div>
        <h2 class="menu-title ledger-title"></h2>
        <div class="ledger-scroll">
          <div class="ledger-summary"></div>
          <h3 class="ledger-heading"></h3>
          <ul class="ledger-list"></ul>
        </div>
        <button type="button" class="plaque plaque-indigo" data-action="close"></button>
      </div>`;
    this.summary = this.element.querySelector('.ledger-summary') as HTMLElement;
    this.list = this.element.querySelector('.ledger-list') as HTMLElement;
    this.element.querySelector('[data-action="close"]')?.addEventListener('click', () => actions.close());
    onI18nChange(() => this.render());
  }

  show(career: CareerData): void {
    this.career = career;
    this.render();
  }

  private render(): void {
    const career = this.career;
    if (!career) return;
    (this.element.querySelector('.ledger-title') as HTMLElement).textContent = t('ledger.title');
    (this.element.querySelector('[data-action="close"]') as HTMLElement).textContent = t('ledger.close');
    this.renderSummary(career);
    this.renderAchievements(career);
  }

  private renderSummary(career: CareerData): void {
    const level = levelFor(career.ringPoints);
    this.summary.replaceChildren();

    const head = document.createElement('p');
    head.className = 'ledger-level';
    head.textContent = t('ledger.level', { level: formatInteger(level) });
    const bar = document.createElement('div');
    bar.className = 'ledger-bar';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round(levelShare(career.ringPoints) * 100)}%`;
    bar.appendChild(fill);
    const toNext = document.createElement('p');
    toNext.className = 'ledger-note';
    toNext.textContent = level >= PROGRESS.levelCap ? t('ledger.topLevel') : t('ledger.rep', { rep: formatNumber(career.ringPoints), next: formatNumber(repForLevel(level + 1)) });
    this.summary.append(head, bar, toNext);

    const facts = document.createElement('dl');
    facts.className = 'ledger-facts';
    const add = (label: string, value: string): void => {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      facts.append(term, detail);
    };
    add(t('ledger.cash'), t('hud.money', { cash: formatNumber(career.cash) }));
    add(t('ledger.condition'), `${formatInteger(career.condition)}%`);
    add(t('ledger.streak'), t('ledger.days', { days: formatInteger(career.daily.streak) }));
    for (const key of SHOWN_STATS) add(t(`ledger.stat.${key}`), formatInteger(career.stats[key] ?? 0));
    this.summary.appendChild(facts);

    const job = career.job ? JOB_BY_ID.get(career.job.id) : undefined;
    const jobRow = document.createElement('div');
    jobRow.className = 'ledger-job';
    const jobText = document.createElement('p');
    jobText.textContent = job ? t(`adda.job.${job.id}.goal`) : t('ledger.noJob');
    jobRow.appendChild(jobText);
    if (job) {
      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'plaque plaque-soot';
      drop.textContent = t('ledger.drop');
      drop.addEventListener('click', () => {
        this.actions.dropJob();
        this.render();
      });
      jobRow.appendChild(drop);
    }
    this.summary.appendChild(jobRow);
  }

  private renderAchievements(career: CareerData): void {
    const earned = ACHIEVEMENTS.filter((achievement) => career.achievements[achievement.id]).length;
    (this.element.querySelector('.ledger-heading') as HTMLElement).textContent = t('ledger.achievements', { done: formatInteger(earned), total: formatInteger(ACHIEVEMENTS.length) });
    this.list.replaceChildren();
    for (const achievement of ACHIEVEMENTS) {
      const done = career.achievements[achievement.id] === true;
      const item = document.createElement('li');
      item.className = 'ledger-item';
      item.classList.toggle('is-earned', done);
      const title = document.createElement('strong');
      title.textContent = t(`ach.${achievement.id}.title`);
      const desc = document.createElement('span');
      const have = Math.min(career.stats[achievement.stat] ?? 0, achievement.target);
      desc.textContent = done ? t(`ach.${achievement.id}.desc`) : `${t(`ach.${achievement.id}.desc`)} (${formatInteger(have)}/${formatInteger(achievement.target)})`;
      const pay = document.createElement('em');
      pay.textContent = t('hud.money', { cash: formatNumber(achievement.cash) });
      item.append(title, desc, pay);
      this.list.appendChild(item);
    }
  }
}
