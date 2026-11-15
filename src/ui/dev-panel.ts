/**
 * Live tuning panel (` key): sliders edit TUNING directly and take effect at once.
 * Labels are config paths on purpose, because this is a developer tool, not game text.
 */

import { DEV_PANEL_SLIDERS, TUNING } from '../config/tuning';
import { applyI18n, t } from '../i18n';
import type { FrameStats } from '../render/render-pipeline';
import type { VehicleTelemetry } from '../vehicle/vehicle-controller';

function resolve(path: string): { parent: Record<string, number>; key: string } {
  const parts = path.split('.');
  let node: unknown = TUNING;
  for (const part of parts.slice(0, -1)) node = (node as Record<string, unknown>)[part];
  return { parent: node as Record<string, number>, key: parts[parts.length - 1] };
}

export class DevPanel {
  readonly root: HTMLElement;
  private readonly stats: HTMLElement;
  private readonly defaults = new Map<string, number>();
  private readonly inputs = new Map<string, { input: HTMLInputElement; output: HTMLElement }>();
  private visible = false;
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('aside');
    this.root.className = 'dev-panel';
    this.root.innerHTML = `
      <header class="dev-header">
        <strong data-i18n="dev.title"></strong>
        <button type="button" class="dev-button" data-action="close" data-i18n="dev.close"></button>
      </header>
      <pre class="dev-stats"></pre>
      <div class="dev-actions">
        <button type="button" class="dev-button" data-action="copy" data-i18n="dev.copy"></button>
        <button type="button" class="dev-button" data-action="reset" data-i18n="dev.reset"></button>
      </div>
      <div class="dev-sliders"></div>`;
    parent.appendChild(this.root);
    applyI18n(this.root);
    this.stats = this.root.querySelector('.dev-stats') as HTMLElement;

    const list = this.root.querySelector('.dev-sliders') as HTMLElement;
    for (const [path, min, max, step] of DEV_PANEL_SLIDERS) {
      const { parent: holder, key } = resolve(path);
      this.defaults.set(path, holder[key]);
      const row = document.createElement('label');
      row.className = 'dev-row';
      const name = document.createElement('span');
      name.textContent = path.replace('vehicle.', '');
      const output = document.createElement('output');
      output.textContent = String(holder[key]);
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.value = String(holder[key]);
      input.addEventListener('input', () => {
        holder[key] = Number(input.value);
        output.textContent = input.value;
      });
      row.append(name, output, input);
      list.appendChild(row);
      this.inputs.set(path, { input, output });
    }

    this.root.querySelector('[data-action="close"]')?.addEventListener('click', () => this.toggle());
    this.root.querySelector('[data-action="reset"]')?.addEventListener('click', () => this.resetAll());
    this.root.querySelector('[data-action="copy"]')?.addEventListener('click', (event) => {
      void this.copyChanges(event.currentTarget as HTMLButtonElement);
    });
  }

  toggle(): void {
    this.visible = !this.visible;
    this.root.classList.toggle('is-visible', this.visible);
  }

  private resetAll(): void {
    for (const [path, value] of this.defaults) {
      const { parent, key } = resolve(path);
      parent[key] = value;
      const entry = this.inputs.get(path);
      if (entry) {
        entry.input.value = String(value);
        entry.output.textContent = String(value);
      }
    }
  }

  /** Copies only the values that differ from the file, ready to paste back into tuning.ts. */
  private async copyChanges(button: HTMLButtonElement): Promise<void> {
    const changes: Record<string, number> = {};
    for (const [path, value] of this.defaults) {
      const { parent, key } = resolve(path);
      if (parent[key] !== value) changes[path] = parent[key];
    }
    try {
      await navigator.clipboard.writeText(JSON.stringify(changes, null, 2));
      button.textContent = t('dev.copied');
      window.setTimeout(() => {
        button.textContent = t('dev.copy');
      }, 1200);
    } catch {
      console.info('Tuning changes:', changes);
    }
  }

  update(dt: number, telemetry: VehicleTelemetry, frame: FrameStats): void {
    if (!this.visible) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.12;
    this.stats.textContent = [
      `fps ${frame.fps.toFixed(0)}  res ${frame.resolutionScale.toFixed(2)}`,
      `draws ${frame.drawCalls}  tris ${(frame.triangles / 1000).toFixed(0)}k`,
      `speed ${telemetry.speedKmh.toFixed(1)} km/h  gear ${telemetry.gear}  rpm ${telemetry.rpm.toFixed(0)}`,
      `slip ${telemetry.slipAngleDeg.toFixed(1)} deg  rear ${telemetry.rearSlipDeg.toFixed(1)} deg`,
      `drift ${telemetry.drifting}  wheels ${telemetry.groundedWheels}`,
      `lat ${telemetry.lateralAccel.toFixed(1)}  long ${telemetry.longitudinalAccel.toFixed(1)} m/s2`,
      `steer ${telemetry.steerInput.toFixed(2)}  angle ${((telemetry.steerAngle * 180) / Math.PI).toFixed(1)} deg`,
    ].join('\n');
  }
}
