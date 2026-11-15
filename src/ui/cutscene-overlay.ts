/**
 * Letterbox, the event's title card, and subtitles. Words appear one whole word at a time,
 * because revealing letter by letter would split Bangla conjuncts apart.
 */

import { RACE } from '../config/race-tuning';
import { t } from '../i18n';
import { rivalPortraitUrl } from './rival-portraits';

export class CutsceneOverlay {
  readonly root: HTMLElement;
  private readonly card: HTMLElement;
  private readonly cardMode: HTMLElement;
  private readonly cardName: HTMLElement;
  private readonly cardRule: HTMLElement;
  private readonly speaker: HTMLElement;
  private readonly speakerFace: HTMLImageElement;
  private readonly speakerName: HTMLElement;
  private readonly speakerNick: HTMLElement;
  private readonly line: HTMLElement;
  private readonly skip: HTMLButtonElement;
  private words: string[] = [];
  private shownWords = 0;
  private wordTimer = 0;
  private queue: string[] = [];
  private holdTimer = 0;
  /** Fires when the skip button is pressed. */
  onSkip: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'cutscene';
    this.root.innerHTML = `
      <div class="cutscene-bar cutscene-bar-top"></div>
      <div class="cutscene-bar cutscene-bar-bottom"></div>
      <div class="cutscene-card plate plate-indigo">
        <span class="cutscene-mode"></span>
        <h2 class="cutscene-name"></h2>
        <p class="cutscene-rule"></p>
      </div>
      <div class="cutscene-speaker plate plate-tin">
        <img class="cutscene-face" alt="" />
        <div class="cutscene-speech">
          <strong class="cutscene-speaker-name"></strong>
          <span class="cutscene-speaker-nick"></span>
          <p class="cutscene-line" aria-live="polite"></p>
        </div>
      </div>
      <button type="button" class="cutscene-skip plaque plaque-soot"></button>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(selector: string): T => this.root.querySelector(selector) as T;
    this.card = q('.cutscene-card');
    this.cardMode = q('.cutscene-mode');
    this.cardName = q('.cutscene-name');
    this.cardRule = q('.cutscene-rule');
    this.speaker = q('.cutscene-speaker');
    this.speakerFace = q('.cutscene-face');
    this.speakerName = q('.cutscene-speaker-name');
    this.speakerNick = q('.cutscene-speaker-nick');
    this.line = q('.cutscene-line');
    this.skip = q('.cutscene-skip');
    this.skip.addEventListener('click', () => this.onSkip?.());
  }

  /** Shows the bars and the event's title card. */
  open(mode: string, name: string, rule: string): void {
    this.cardMode.textContent = mode;
    this.cardName.textContent = name;
    this.cardRule.textContent = rule;
    this.skip.textContent = t('race.hud.skip');
    this.card.classList.add('is-visible');
    this.speaker.classList.remove('is-visible');
    this.root.classList.add('is-open');
  }

  /** The rival takes over from the title card. */
  speak(rivalId: string, lines: readonly string[]): void {
    this.card.classList.remove('is-visible');
    this.speakerFace.src = rivalPortraitUrl(rivalId);
    this.speakerName.textContent = t(`rival.${rivalId}.name`);
    this.speakerNick.textContent = t(`rival.${rivalId}.nick`);
    this.speaker.classList.add('is-visible');
    this.queue = [...lines];
    this.nextLine();
  }

  private nextLine(): void {
    const line = this.queue.shift();
    if (line === undefined) return;
    this.words = line.split(/\s+/);
    this.shownWords = 0;
    this.wordTimer = 0;
    this.holdTimer = 0;
    this.line.textContent = '';
  }

  update(dt: number): void {
    if (this.shownWords < this.words.length) {
      this.wordTimer -= dt;
      if (this.wordTimer <= 0) {
        this.wordTimer = 1 / RACE.cutscene.wordsPerSecond;
        this.shownWords++;
        this.line.textContent = this.words.slice(0, this.shownWords).join(' ');
        if (this.shownWords === this.words.length) this.holdTimer = 0.45;
      }
    } else if (this.queue.length > 0) {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0) this.nextLine();
    }
  }

  close(): void {
    this.root.classList.remove('is-open');
    this.card.classList.remove('is-visible');
    this.speaker.classList.remove('is-visible');
    this.queue = [];
    this.words = [];
    this.shownWords = 0;
  }
}
