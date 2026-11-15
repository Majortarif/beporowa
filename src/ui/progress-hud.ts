/** The side job in hand, an earned achievement, the offer to stop somewhere, and the আড্ডা badge. */

import { formatInteger, formatNumber, onI18nChange, t } from '../i18n';

const ACHIEVEMENT_SECONDS = 5;
const LEVEL_SECONDS = 3.4;

export class ProgressHud {
  readonly root: HTMLElement;
  /** Fires when the player taps the plate that offers a stop. */
  onPrompt: (() => void) | null = null;
  private readonly job: HTMLElement;
  private readonly jobGoal: HTMLElement;
  private readonly jobMeter: HTMLElement;
  private readonly jobMeterFill: HTMLElement;
  private readonly jobClock: HTMLElement;
  private readonly toast: HTMLElement;
  private readonly toastLabel: HTMLElement;
  private readonly toastTitle: HTMLElement;
  private readonly toastMoney: HTMLElement;
  private readonly level: HTMLElement;
  private readonly prompt: HTMLButtonElement;
  private readonly badge: HTMLElement;
  private readonly queue: Array<{ title: string; cash: number }> = [];
  private toastTimer = 0;
  private levelTimer = 0;
  private promptKey: string | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'progress-layer';
    this.root.innerHTML = `
      <div class="hud-job plate plate-tin">
        <strong class="hud-job-label"></strong>
        <p class="hud-job-goal"></p>
        <div class="hud-job-meter"><i></i></div>
        <span class="hud-job-clock"></span>
      </div>
      <div class="hud-ach plate plate-indigo" role="status">
        <span class="hud-ach-label"></span>
        <strong class="hud-ach-title"></strong>
        <span class="hud-ach-money"></span>
      </div>
      <div class="hud-level plate plate-marigold" role="status"></div>
      <div class="hud-adda plate plate-soot"></div>
      <button type="button" class="stop-prompt plate plate-marigold"></button>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(selector: string): T => this.root.querySelector(selector) as T;
    this.job = q('.hud-job');
    this.jobGoal = q('.hud-job-goal');
    this.jobMeter = q('.hud-job-meter');
    this.jobMeterFill = q('.hud-job-meter i');
    this.jobClock = q('.hud-job-clock');
    this.toast = q('.hud-ach');
    this.toastLabel = q('.hud-ach-label');
    this.toastTitle = q('.hud-ach-title');
    this.toastMoney = q('.hud-ach-money');
    this.level = q('.hud-level');
    this.prompt = q('.stop-prompt');
    this.badge = q('.hud-adda');
    this.prompt.addEventListener('click', () => this.onPrompt?.());
    this.refreshWords();
    onI18nChange(() => this.refreshWords());
  }

  private refreshWords(): void {
    (this.root.querySelector('.hud-job-label') as HTMLElement).textContent = t('adda.jobPlate');
    this.badge.textContent = t('adda.badge');
    if (this.promptKey) this.prompt.textContent = t(this.promptKey);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }

  setAddaMode(on: boolean): void {
    this.badge.classList.toggle('is-visible', on);
  }

  /** Shows the job in hand, or hides the plate when there is none. */
  showJob(goal: string | null, share: number | null, secondsLeft: number | null): void {
    this.job.classList.toggle('is-visible', goal !== null);
    if (goal === null) return;
    this.jobGoal.textContent = goal;
    this.jobMeter.classList.toggle('is-visible', share !== null);
    if (share !== null) this.jobMeterFill.style.width = `${Math.round(share * 100)}%`;
    this.jobClock.textContent = secondsLeft !== null ? t('adda.jobSeconds', { seconds: formatInteger(Math.ceil(secondsLeft)) }) : '';
    this.jobClock.classList.toggle('is-urgent', secondsLeft !== null && secondsLeft < 15);
  }

  /** Offers a stop. The key names the words on the plate. */
  setPrompt(key: string | null): void {
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.prompt.classList.toggle('is-visible', key !== null);
    if (key) this.prompt.textContent = t(key);
  }

  /** Announces an achievement. Several at once take turns. */
  showAchievement(title: string, cash: number): void {
    this.queue.push({ title, cash });
  }

  showLevelUp(level: number, bonus: number): void {
    this.level.textContent = t('adda.levelUp', { level: formatInteger(level), cash: formatNumber(bonus) });
    this.level.classList.remove('is-visible');
    void this.level.offsetWidth;
    this.level.classList.add('is-visible');
    this.levelTimer = LEVEL_SECONDS;
  }

  update(dt: number): void {
    if (this.levelTimer > 0) {
      this.levelTimer -= dt;
      if (this.levelTimer <= 0) this.level.classList.remove('is-visible');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toast.classList.remove('is-visible');
      return;
    }
    const next = this.queue.shift();
    if (!next) return;
    this.toastLabel.textContent = t('adda.achievement');
    this.toastTitle.textContent = next.title;
    this.toastMoney.textContent = t('hud.money', { cash: formatNumber(next.cash) });
    this.toast.classList.add('is-visible');
    this.toastTimer = ACHIEVEMENT_SECONDS;
  }
}
