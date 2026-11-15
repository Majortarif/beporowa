/** Name plates over cars that are not really there: ghosts and friends. Drawn in HTML so Bangla shapes correctly. */

import { Vector3, type PerspectiveCamera } from 'three';

export type CarTagKind = 'ghost' | 'friend' | 'leader';

const MAX_TAGS = 8;

export class CarTags {
  readonly root: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly texts: string[] = [];
  private readonly projected = new Vector3();
  private used = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'car-tags';
    for (let i = 0; i < MAX_TAGS; i++) {
      const plate = document.createElement('div');
      plate.className = 'car-tag';
      this.root.appendChild(plate);
      this.plates.push(plate);
      this.texts.push('');
    }
    parent.appendChild(this.root);
  }

  /** Starts a new frame of plates. */
  begin(): void {
    this.used = 0;
  }

  /** Shows one plate over a point in the world, if it is on screen. */
  add(text: string, kind: CarTagKind, x: number, y: number, z: number, camera: PerspectiveCamera, width: number, height: number): void {
    if (this.used >= MAX_TAGS) return;
    this.projected.set(x, y + 2.2, z).project(camera);
    if (this.projected.z >= 1 || Math.abs(this.projected.x) > 1.05 || Math.abs(this.projected.y) > 1.05) return;
    const index = this.used++;
    const plate = this.plates[index];
    if (this.texts[index] !== text) {
      this.texts[index] = text;
      plate.textContent = text;
    }
    plate.dataset.kind = kind;
    plate.classList.add('is-visible');
    const left = (this.projected.x * 0.5 + 0.5) * width;
    const top = (-this.projected.y * 0.5 + 0.5) * height;
    plate.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px) translate(-50%, -100%)`;
  }

  /** Hides whichever plates were not used this frame. */
  end(): void {
    for (let i = this.used; i < MAX_TAGS; i++) this.plates[i].classList.remove('is-visible');
  }

  clear(): void {
    this.used = 0;
    this.end();
  }
}
