/** রেডিও ঝড় on the dashboard: what the DJ is saying, and which song has just come on. */

import { onI18nChange, t } from '../i18n';

export class RadioHud {
  readonly root: HTMLElement;
  private readonly line: HTMLElement;
  private readonly song: HTMLElement;
  private lineTimer = 0;
  private songTimer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'radio-layer';
    this.root.innerHTML = `
      <div class="radio-plate plate plate-soot subtitle" role="status">
        <span class="radio-call"></span>
        <p class="radio-line"></p>
        <span class="ai-tag" hidden></span>
      </div>
      <div class="radio-song plate plate-indigo"></div>`;
    parent.appendChild(this.root);
    this.line = this.root.querySelector('.radio-plate') as HTMLElement;
    this.song = this.root.querySelector('.radio-song') as HTMLElement;
    this.refreshCall();
    onI18nChange(() => this.refreshCall());
  }

  private refreshCall(): void {
    (this.root.querySelector('.radio-call') as HTMLElement).textContent = t('radio.call');
    (this.root.querySelector('.ai-tag') as HTMLElement).textContent = t('banter.tag');
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }

  /** @param fresh the line was written live, and is marked so */
  say(text: string, seconds: number, fresh = false): void {
    (this.root.querySelector('.radio-line') as HTMLElement).textContent = text;
    (this.root.querySelector('.ai-tag') as HTMLElement).hidden = !fresh;
    this.line.classList.add('is-visible');
    this.lineTimer = seconds;
  }

  showSong(title: string): void {
    this.song.textContent = t('radio.playing', { title });
    this.song.classList.add('is-visible');
    this.songTimer = 5;
  }

  update(dt: number): void {
    if (this.lineTimer > 0) {
      this.lineTimer -= dt;
      if (this.lineTimer <= 0) this.line.classList.remove('is-visible');
    }
    if (this.songTimer > 0) {
      this.songTimer -= dt;
      if (this.songTimer <= 0) this.song.classList.remove('is-visible');
    }
  }

  clear(): void {
    this.lineTimer = 0;
    this.songTimer = 0;
    this.line.classList.remove('is-visible');
    this.song.classList.remove('is-visible');
  }
}
