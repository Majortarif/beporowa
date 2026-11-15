/** The arrest screen: what it cost, then back onto the road. */

import { applyI18n, formatNumber, onI18nChange, t } from '../i18n';
import { flowerSvg } from './ornaments';

export class BustedScreen {
  readonly element: HTMLElement;
  private readonly facts: HTMLElement;
  private stars = 0;
  private seconds = 0;
  private fine = 0;

  constructor(onContinue: () => void) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-busted';
    this.element.innerHTML = `
      <div class="board board-menu board-busted">
        <div class="board-corner board-corner-tl">${flowerSvg('#d8402b', '#f2a20c', '#efe3c8')}</div>
        <div class="board-corner board-corner-tr">${flowerSvg('#0f7f7a', '#efe3c8', '#f2a20c')}</div>
        <h2 class="menu-title busted-title" data-i18n="police.busted.title"></h2>
        <p class="busted-subtitle" data-i18n="police.busted.subtitle"></p>
        <dl class="busted-facts"></dl>
        <button type="button" class="plaque plaque-tomato plaque-big" data-action="continue" data-i18n="police.busted.continue"></button>
      </div>`;
    this.facts = this.element.querySelector('.busted-facts') as HTMLElement;
    this.element.querySelector('[data-action="continue"]')?.addEventListener('click', onContinue);
    applyI18n(this.element);
    onI18nChange(() => this.refresh());
  }

  show(stars: number, seconds: number, fine: number): void {
    this.stars = stars;
    this.seconds = seconds;
    this.fine = fine;
    this.refresh();
  }

  private refresh(): void {
    const rows: Array<[string, string]> = [
      [t('police.busted.heat'), t('police.busted.stars', { stars: formatNumber(this.stars) })],
      [t('police.busted.time'), t('police.busted.seconds', { seconds: formatNumber(Math.round(this.seconds)) })],
      [t('police.busted.fine'), t('police.busted.fineAmount', { fine: formatNumber(this.fine) })],
    ];
    this.facts.replaceChildren();
    for (const [label, value] of rows) {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      this.facts.append(term, detail);
    }
  }
}
