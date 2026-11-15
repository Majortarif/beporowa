/**
 * Photo mode's panel: the camera, the hour, a look, a rickshaw-art frame and Bangla captions you can
 * drag about. What you see is what gets saved, drawn again with Canvas 2D at the full resolution.
 */

import { SLOGAN_MAX_LENGTH } from '../config/cars';
import { checkSlogan } from '../garage/slogan-filter';
import { onI18nChange, t, tList, worldText } from '../i18n';
import { PHOTO_FRAMES, paintCaption, paintPhotoFrame, paintSignature, type PhotoFrame } from '../render/photo-frames';
import { makeCanvas } from '../render/painted-textures';

export type PhotoLook = 'plain' | 'rickshaw' | 'cinema' | 'monsoon' | 'old';
export const PHOTO_LOOKS: readonly PhotoLook[] = ['plain', 'rickshaw', 'cinema', 'monsoon', 'old'];

export interface PhotoValues {
  distance: number;
  height: number;
  roll: number;
  fov: number;
  blur: number;
  time: number;
}

export interface PhotoActions {
  /** A slider moved. */
  change(values: PhotoValues): void;
  setLook(look: PhotoLook): void;
  /** Turns the camera by a drag across the picture. */
  drag(dx: number, dy: number): void;
  /** Draws one fresh frame, and hands back the finished canvas to copy from. */
  renderNow(): HTMLCanvasElement;
  /** A photo was saved. */
  saved(): void;
  close(): void;
}

interface Slider {
  key: keyof PhotoValues;
  min: number;
  max: number;
  step: number;
}

const SLIDERS: readonly Slider[] = [
  { key: 'distance', min: 3, max: 22, step: 0.1 },
  { key: 'height', min: -0.12, max: 1.2, step: 0.01 },
  { key: 'roll', min: -0.5, max: 0.5, step: 0.01 },
  { key: 'fov', min: 18, max: 85, step: 1 },
  { key: 'blur', min: 0, max: 1, step: 0.01 },
  { key: 'time', min: 0, max: 1, step: 0.005 },
];

const CAPTION_SIZE = 0.05;

export class PhotoScreen {
  readonly element: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly stage: HTMLElement;
  private readonly frameCanvas: HTMLCanvasElement;
  private readonly message: HTMLElement;
  private values: PhotoValues = { distance: 7, height: 0.2, roll: 0, fov: 42, blur: 0, time: 0 };
  private frame: PhotoFrame = 'none';
  private look: PhotoLook = 'plain';
  private hasEffects = true;

  constructor(private readonly actions: PhotoActions) {
    this.element = document.createElement('section');
    this.element.className = 'screen screen-photo';
    this.element.innerHTML = `
      <canvas class="photo-frame"></canvas>
      <div class="photo-stage"></div>
      <div class="photo-panel board"></div>
      <button type="button" class="plaque plaque-soot photo-show"></button>`;
    this.panel = this.element.querySelector('.photo-panel') as HTMLElement;
    this.stage = this.element.querySelector('.photo-stage') as HTMLElement;
    this.frameCanvas = this.element.querySelector('.photo-frame') as HTMLCanvasElement;
    this.message = document.createElement('p');
    this.message.className = 'photo-message';
    this.message.setAttribute('role', 'status');
    (this.element.querySelector('.photo-show') as HTMLElement).addEventListener('click', () => this.setHidden(false));
    this.bindDrag();
    window.addEventListener('resize', () => this.drawFrame());
    onI18nChange(() => this.render());
  }

  /** Dragging the picture itself turns the camera. */
  private bindDrag(): void {
    let lastX: number | null = null;
    let lastY = 0;
    const stage = this.stage;
    stage.addEventListener('pointerdown', (event) => {
      if (event.target !== stage) return;
      lastX = event.clientX;
      lastY = event.clientY;
      stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove', (event) => {
      if (lastX === null) return;
      this.actions.drag(event.clientX - lastX, event.clientY - lastY);
      lastX = event.clientX;
      lastY = event.clientY;
    });
    const release = (): void => {
      lastX = null;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
  }

  show(values: PhotoValues, hasEffects: boolean): void {
    this.values = { ...values };
    this.hasEffects = hasEffects;
    this.frame = 'none';
    this.look = 'plain';
    this.stage.replaceChildren();
    this.setHidden(false);
    this.render();
    this.drawFrame();
  }

  /** Follows a drag, so that the sliders never lie. */
  setValues(values: Partial<PhotoValues>): void {
    Object.assign(this.values, values);
    for (const slider of SLIDERS) {
      const input = this.panel.querySelector<HTMLInputElement>(`[data-slider="${slider.key}"]`);
      if (input) input.value = String(this.values[slider.key]);
    }
  }

  private setHidden(hidden: boolean): void {
    this.panel.classList.toggle('is-hidden', hidden);
    (this.element.querySelector('.photo-show') as HTMLElement).classList.toggle('is-visible', hidden);
    (this.element.querySelector('.photo-show') as HTMLElement).textContent = t('photo.showPanel');
  }

  private drawFrame(): void {
    const canvas = this.frameCanvas;
    const bounds = this.element.getBoundingClientRect();
    if (bounds.width === 0) return;
    canvas.width = Math.round(bounds.width);
    canvas.height = Math.round(bounds.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    paintPhotoFrame(ctx, canvas.width, canvas.height, this.frame);
  }

  private render(): void {
    const panel = this.panel;
    panel.replaceChildren();
    const title = document.createElement('h2');
    title.className = 'menu-title photo-title';
    title.textContent = t('photo.title');
    panel.appendChild(title);
    const body = document.createElement('div');
    body.className = 'photo-body';
    panel.appendChild(body);

    for (const slider of SLIDERS) {
      if (slider.key === 'blur' && !this.hasEffects) continue;
      const row = document.createElement('label');
      row.className = 'photo-slider';
      const name = document.createElement('span');
      name.textContent = t(`photo.slider.${slider.key}`);
      const input = document.createElement('input');
      input.type = 'range';
      input.className = 'volume';
      input.dataset.slider = slider.key;
      input.min = String(slider.min);
      input.max = String(slider.max);
      input.step = String(slider.step);
      input.value = String(this.values[slider.key]);
      input.addEventListener('input', () => {
        this.values[slider.key] = Number(input.value);
        this.actions.change(this.values);
      });
      row.append(name, input);
      body.appendChild(row);
    }

    const chips = <T extends string>(labelKey: string, keyPrefix: string, options: readonly T[], selected: T, apply: (value: T) => void): void => {
      const label = document.createElement('p');
      label.className = 'paint-label';
      label.textContent = t(labelKey);
      const row = document.createElement('div');
      row.className = 'paint-choices';
      for (const option of options) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'segment';
        button.textContent = t(`${keyPrefix}.${option}`);
        button.setAttribute('aria-pressed', String(selected === option));
        button.addEventListener('click', () => {
          apply(option);
          this.render();
        });
        row.appendChild(button);
      }
      body.append(label, row);
    };
    if (this.hasEffects) {
      chips('photo.lookLabel', 'photo.look', PHOTO_LOOKS, this.look, (look) => {
        this.look = look;
        this.actions.setLook(look);
      });
    }
    chips('photo.frameLabel', 'photo.frame', PHOTO_FRAMES, this.frame, (frame) => {
      this.frame = frame;
      this.drawFrame();
    });

    // Captions: ready-made, or your own words through the same filter as the car's tail.
    const captionLabel = document.createElement('p');
    captionLabel.className = 'paint-label';
    captionLabel.textContent = t('photo.captionLabel');
    const captions = document.createElement('div');
    captions.className = 'paint-choices';
    for (const line of tList('photo.captions')) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'segment';
      button.textContent = line;
      button.addEventListener('click', () => this.addSticker(line));
      captions.appendChild(button);
    }
    const custom = document.createElement('div');
    custom.className = 'photo-custom';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'paint-input';
    input.maxLength = SLOGAN_MAX_LENGTH * 3;
    input.placeholder = t('photo.captionHint');
    input.setAttribute('aria-label', t('photo.captionLabel'));
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'plaque plaque-teal';
    add.textContent = t('photo.captionAdd');
    add.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      const problem = checkSlogan(text);
      if (problem !== 'none') {
        this.message.textContent = t(problem === 'rude' ? 'garage.sloganRude' : 'garage.sloganLong', { max: String(SLOGAN_MAX_LENGTH) });
        return;
      }
      this.message.textContent = '';
      this.addSticker(text);
      input.value = '';
    });
    custom.append(input, add);
    body.append(captionLabel, captions, custom, this.message);

    const actions = document.createElement('div');
    actions.className = 'photo-actions';
    const shoot = document.createElement('button');
    shoot.type = 'button';
    shoot.className = 'plaque plaque-tomato plaque-big';
    shoot.textContent = t('photo.shoot');
    shoot.addEventListener('click', () => this.capture());
    const hide = document.createElement('button');
    hide.type = 'button';
    hide.className = 'plaque plaque-indigo';
    hide.textContent = t('photo.hidePanel');
    hide.addEventListener('click', () => this.setHidden(true));
    const leave = document.createElement('button');
    leave.type = 'button';
    leave.className = 'plaque plaque-soot';
    leave.textContent = t('photo.close');
    leave.addEventListener('click', () => this.actions.close());
    actions.append(shoot, hide, leave);
    panel.appendChild(actions);
  }

  private addSticker(text: string): void {
    const sticker = document.createElement('div');
    sticker.className = 'photo-sticker';
    sticker.tabIndex = 0;
    sticker.setAttribute('role', 'button');
    sticker.setAttribute('aria-label', t('photo.stickerHelp', { text }));
    sticker.dataset.text = text;
    const words = document.createElement('span');
    words.textContent = text;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'photo-sticker-x';
    remove.textContent = '×';
    remove.setAttribute('aria-label', t('photo.stickerRemove'));
    remove.addEventListener('click', () => sticker.remove());
    sticker.append(words, remove);
    const count = this.stage.childElementCount;
    sticker.style.left = `${30 + (count % 4) * 10}%`;
    sticker.style.top = `${70 - (count % 4) * 8}%`;
    sticker.style.fontSize = `${Math.round(this.element.getBoundingClientRect().height * CAPTION_SIZE)}px`;
    this.bindSticker(sticker);
    this.stage.appendChild(sticker);
  }

  private bindSticker(sticker: HTMLElement): void {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;
    sticker.addEventListener('pointerdown', (event) => {
      if ((event.target as HTMLElement).classList.contains('photo-sticker-x')) return;
      dragging = true;
      const bounds = sticker.getBoundingClientRect();
      offsetX = event.clientX - (bounds.left + bounds.width / 2);
      offsetY = event.clientY - (bounds.top + bounds.height / 2);
      sticker.setPointerCapture(event.pointerId);
    });
    sticker.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const stage = this.stage.getBoundingClientRect();
      sticker.style.left = `${((event.clientX - offsetX - stage.left) / stage.width) * 100}%`;
      sticker.style.top = `${((event.clientY - offsetY - stage.top) / stage.height) * 100}%`;
    });
    const release = (): void => {
      dragging = false;
    };
    sticker.addEventListener('pointerup', release);
    sticker.addEventListener('pointercancel', release);
    // Arrow keys move it too, for anyone without a mouse.
    sticker.addEventListener('keydown', (event) => {
      const step = event.key.startsWith('Arrow') ? 1.5 : 0;
      if (step === 0) {
        if (event.key === 'Delete' || event.key === 'Backspace') sticker.remove();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const left = parseFloat(sticker.style.left);
      const top = parseFloat(sticker.style.top);
      if (event.key === 'ArrowLeft') sticker.style.left = `${left - step}%`;
      if (event.key === 'ArrowRight') sticker.style.left = `${left + step}%`;
      if (event.key === 'ArrowUp') sticker.style.top = `${top - step}%`;
      if (event.key === 'ArrowDown') sticker.style.top = `${top + step}%`;
    });
  }

  /** Puts it all together at the renderer's own resolution, and saves it. */
  private capture(): void {
    const source = this.actions.renderNow();
    const { canvas, ctx } = makeCanvas(source.width, source.height);
    ctx.drawImage(source, 0, 0);
    paintPhotoFrame(ctx, canvas.width, canvas.height, this.frame);
    const stage = this.stage.getBoundingClientRect();
    for (const sticker of Array.from(this.stage.children) as HTMLElement[]) {
      const bounds = sticker.getBoundingClientRect();
      const x = ((bounds.left + bounds.width / 2 - stage.left) / stage.width) * canvas.width;
      const y = ((bounds.top + bounds.height / 2 - stage.top) / stage.height) * canvas.height;
      paintCaption(ctx, sticker.dataset.text ?? '', x, y, canvas.height * CAPTION_SIZE);
    }
    paintSignature(ctx, worldText('app.name'), canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        this.message.textContent = t('photo.failed');
        return;
      }
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `beporowa-${Date.now()}.png`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 4000);
      this.message.textContent = t('photo.done');
      this.actions.saved();
    }, 'image/png');
  }
}
