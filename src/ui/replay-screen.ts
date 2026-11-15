/** The replay's controls: play, speed, which camera, jump along the film, take a photo, or leave. */

import { onI18nChange, t } from '../i18n';
import { SHOT_KINDS, type CameraChoice } from '../replay/replay-director';

export interface ReplayActions {
  togglePlay(): boolean;
  setSpeed(speed: number): void;
  setCamera(camera: CameraChoice): void;
  seek(share: number): void;
  photo(): void;
  close(): void;
}

const SPEEDS: readonly number[] = [0.5, 1, 2];

export class ReplayScreen {
  readonly element: HTMLElement;
  private readonly bar: HTMLInputElement;
  private readonly play: HTMLButtonElement;
  private readonly controls: HTMLElement;
  private speed = 1;
  private camera: CameraChoice = 'auto';
  private isPlaying = true;
  private dragging = false;
  private idle = 0;

  constructor(private readonly actions: ReplayActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-replay';
    this.element.innerHTML = `
      <div class="replay-letterbox replay-letterbox-top"></div>
      <div class="replay-letterbox replay-letterbox-bottom"></div>
      <div class="replay-stamp"></div>
      <div class="replay-controls">
        <input class="volume replay-bar" type="range" min="0" max="1" step="0.001" value="0" />
        <div class="replay-row">
          <button type="button" class="plaque plaque-tomato replay-play"></button>
          <div class="paint-choices replay-speeds"></div>
          <div class="paint-choices replay-cameras"></div>
          <button type="button" class="plaque plaque-teal replay-photo"></button>
          <button type="button" class="plaque plaque-soot replay-close"></button>
        </div>
      </div>`;
    this.bar = this.element.querySelector('.replay-bar') as HTMLInputElement;
    this.play = this.element.querySelector('.replay-play') as HTMLButtonElement;
    this.controls = this.element.querySelector('.replay-controls') as HTMLElement;
    this.play.addEventListener('click', () => {
      this.isPlaying = this.actions.togglePlay();
      this.render();
    });
    (this.element.querySelector('.replay-photo') as HTMLElement).addEventListener('click', () => this.actions.photo());
    (this.element.querySelector('.replay-close') as HTMLElement).addEventListener('click', () => this.actions.close());
    this.bar.addEventListener('pointerdown', () => {
      this.dragging = true;
    });
    this.bar.addEventListener('pointerup', () => {
      this.dragging = false;
    });
    this.bar.addEventListener('input', () => this.actions.seek(Number(this.bar.value)));
    // Any movement brings the controls back.
    for (const type of ['pointermove', 'pointerdown', 'keydown'] as const) {
      this.element.addEventListener(type, () => this.wake());
    }
    onI18nChange(() => this.render());
  }

  show(): void {
    this.speed = 1;
    this.camera = 'auto';
    this.isPlaying = true;
    this.wake();
    this.render();
  }

  private wake(): void {
    this.idle = 0;
    this.controls.classList.remove('is-idle');
  }

  /** Moves the bar along with the film, and lets the controls fade after a while. */
  setProgress(share: number, dt: number): void {
    if (!this.dragging) this.bar.value = String(share);
    this.idle += dt;
    if (this.idle > 4) this.controls.classList.add('is-idle');
  }

  private render(): void {
    (this.element.querySelector('.replay-stamp') as HTMLElement).textContent = t('replay.stamp');
    this.play.textContent = t(this.isPlaying ? 'replay.pause' : 'replay.play');
    this.bar.setAttribute('aria-label', t('replay.seek'));
    (this.element.querySelector('.replay-photo') as HTMLElement).textContent = t('replay.photo');
    (this.element.querySelector('.replay-close') as HTMLElement).textContent = t('replay.close');
    const speeds = this.controls.querySelector('.replay-speeds') as HTMLElement;
    speeds.replaceChildren();
    for (const speed of SPEEDS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segment';
      button.textContent = t(`replay.speed.${String(speed).replace('.', '_')}`);
      button.setAttribute('aria-pressed', String(speed === this.speed));
      button.addEventListener('click', () => {
        this.speed = speed;
        this.actions.setSpeed(speed);
        this.render();
      });
      speeds.appendChild(button);
    }
    const cameras = this.controls.querySelector('.replay-cameras') as HTMLElement;
    cameras.replaceChildren();
    for (const camera of ['auto', ...SHOT_KINDS] as CameraChoice[]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segment';
      button.textContent = t(`replay.camera.${camera}`);
      button.setAttribute('aria-pressed', String(camera === this.camera));
      button.addEventListener('click', () => {
        this.camera = camera;
        this.actions.setCamera(camera);
        this.render();
      });
      cameras.appendChild(button);
    }
  }
}
