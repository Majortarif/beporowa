/**
 * The painted tin-sign HUD, drawn with HTML and SVG so the browser shapes Bangla text.
 * Needle and bars move every frame through transforms; text updates at a lower rate.
 */

import { TUNING } from '../config/tuning';
import { clamp01 } from '../core/math';
import { applyI18n, formatInteger, formatLapTime, formatNumber, formatOrdinal, localizeDigits, onI18nChange, t } from '../i18n';
import type { LapTimer } from '../race/lap-timer';
import type { DriftScorer } from '../vehicle/drift-scorer';
import type { VehicleTelemetry } from '../vehicle/vehicle-controller';
import { flowerSvg } from './ornaments';

function polar(radius: number, degrees: number): [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [120 + Math.cos(radians) * radius, 120 + Math.sin(radians) * radius];
}

function arcPath(radius: number, startDeg: number, endDeg: number): string {
  const [x0, y0] = polar(radius, startDeg);
  const [x1, y1] = polar(radius, endDeg);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${radius} ${radius} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

function setText(element: HTMLElement | SVGElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly needle: SVGGElement;
  private readonly rpmArc: SVGPathElement;
  private readonly speedText: HTMLElement;
  private readonly gearText: HTMLElement;
  private readonly nitroFill: HTMLElement;
  private readonly nitroPlate: HTMLElement;
  private readonly lapLabel: HTMLElement;
  private readonly timeText: HTMLElement;
  private readonly bestText: HTMLElement;
  private readonly lapNote: HTMLElement;
  private readonly driftLive: HTMLElement;
  private readonly driftPoints: HTMLElement;
  private readonly driftMultiplier: HTMLElement;
  private readonly callout: HTMLElement;
  private readonly calloutMain: HTMLElement;
  private readonly calloutSub: HTMLElement;
  private readonly wrongWay: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly dialLabels: SVGTextElement[] = [];
  private textTimer = 0;
  private calloutTimer = 0;
  private hintTimer = 0;
  private lastLap: LapTimer | null = null;
  private lastTelemetry: VehicleTelemetry | null = null;

  constructor(parent: HTMLElement) {
    const hud = TUNING.hud;
    this.root = document.createElement('div');
    this.root.className = 'hud';

    const start = hud.dialStartDeg;
    const end = hud.dialEndDeg;
    const redlineStart = start + (end - start) * 0.86;
    let ticks = '';
    let labels = '';
    for (let kmh = 0; kmh <= hud.dialMaxKmh; kmh += hud.dialLabelStep / 2) {
      const angle = start + (kmh / hud.dialMaxKmh) * (end - start);
      const major = kmh % hud.dialLabelStep === 0;
      const [x0, y0] = polar(major ? 88 : 92, angle);
      const [x1, y1] = polar(99, angle);
      ticks += `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="#1b1410" stroke-width="${major ? 3.4 : 1.6}"/>`;
      if (major) {
        const [lx, ly] = polar(72, angle);
        labels += `<text class="dial-label" data-kmh="${kmh}" x="${lx.toFixed(2)}" y="${(ly + 5).toFixed(2)}"></text>`;
      }
    }

    this.root.innerHTML = `
      <div class="hud-lap plate plate-indigo">
        <div class="hud-lap-row"><span class="hud-lap-label"></span><span class="hud-lap-time"></span></div>
        <div class="hud-lap-row hud-lap-best"><span data-i18n="hud.best"></span><span class="hud-best-time"></span></div>
        <div class="hud-lap-note" data-i18n="hud.invalidLap"></div>
      </div>

      <div class="hud-center">
        <div class="hud-drift-live plate plate-marigold">
          <span data-i18n="hud.drift"></span>
          <strong class="hud-drift-points"></strong>
          <span class="hud-drift-multiplier"></span>
        </div>
        <div class="hud-callout">
          <div class="hud-callout-main"></div>
          <div class="hud-callout-sub"></div>
        </div>
        <div class="hud-wrong-way plate plate-tomato" data-i18n="hud.wrongWay"></div>
      </div>

      <div class="hud-hint plate plate-tin" data-i18n="controls.hint"></div>

      <div class="hud-cluster">
        <div class="hud-dial">
          <svg viewBox="0 0 240 240" aria-hidden="true">
            <circle cx="120" cy="120" r="118" fill="#1b1410"/>
            <circle cx="120" cy="120" r="112" fill="#d8402b"/>
            <circle cx="120" cy="120" r="103" fill="#efe3c8"/>
            <path d="${arcPath(109, redlineStart, end)}" fill="none" stroke="#f2a20c" stroke-width="5"/>
            <path class="hud-rpm-arc" d="${arcPath(109, start, end)}" fill="none" stroke="#1b1410" stroke-width="5" pathLength="100" stroke-dasharray="0 100"/>
            ${ticks}
            ${labels}
            <g class="hud-needle">
              <path d="M117 128 L120 30 L123 128Z" fill="#d8402b" stroke="#1b1410" stroke-width="1"/>
            </g>
            <circle cx="120" cy="120" r="12" fill="#1b1410"/>
            <circle cx="120" cy="120" r="6" fill="#f2a20c"/>
          </svg>
          <div class="hud-speed-box">
            <div class="hud-speed"></div>
            <div class="hud-unit" data-i18n="hud.speedUnit"></div>
          </div>
          <div class="hud-gear"><span class="hud-gear-value"></span></div>
          <div class="hud-dial-flower">${flowerSvg('#f2a20c', '#d8402b', '#efe3c8')}</div>
        </div>
        <div class="hud-nitro plate plate-soot">
          <span class="hud-nitro-label" data-i18n="hud.nitro"></span>
          <div class="hud-nitro-track"><div class="hud-nitro-fill"></div></div>
        </div>
      </div>`;
    parent.appendChild(this.root);
    applyI18n(this.root);

    const q = <T extends Element>(selector: string): T => this.root.querySelector(selector) as T;
    this.needle = q('.hud-needle');
    this.rpmArc = q('.hud-rpm-arc');
    this.speedText = q('.hud-speed');
    this.gearText = q('.hud-gear-value');
    this.nitroFill = q('.hud-nitro-fill');
    this.nitroPlate = q('.hud-nitro');
    this.lapLabel = q('.hud-lap-label');
    this.timeText = q('.hud-lap-time');
    this.bestText = q('.hud-best-time');
    this.lapNote = q('.hud-lap-note');
    this.driftLive = q('.hud-drift-live');
    this.driftPoints = q('.hud-drift-points');
    this.driftMultiplier = q('.hud-drift-multiplier');
    this.callout = q('.hud-callout');
    this.calloutMain = q('.hud-callout-main');
    this.calloutSub = q('.hud-callout-sub');
    this.wrongWay = q('.hud-wrong-way');
    this.hint = q('.hud-hint');
    this.root.querySelectorAll<SVGTextElement>('.dial-label').forEach((label) => this.dialLabels.push(label));

    this.refreshDialLabels();
    onI18nChange(() => {
      this.refreshDialLabels();
      if (this.lastTelemetry) this.updateText(this.lastTelemetry, this.lastLap);
    });
  }

  private refreshDialLabels(): void {
    for (const label of this.dialLabels) {
      label.textContent = localizeDigits(label.dataset.kmh as string);
    }
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }

  /** Shows the control hint for a while at the start of a drive. */
  showHint(key = 'controls.hint'): void {
    this.hintTimer = TUNING.hud.hintSeconds;
    this.hint.dataset.i18n = key;
    this.hint.textContent = t(key);
    this.hint.classList.add('is-visible');
  }

  /** The city has no laps, so its own plate replaces the lap timer. */
  setCityMode(city: boolean): void {
    this.root.classList.toggle('is-city', city);
  }

  showNearMiss(squeeze: boolean, points: number): void {
    this.showCallout(t(squeeze ? 'city.squeeze' : 'city.nearMiss'), t('hud.points', { count: points }), TUNING.hud.driftPopupSeconds, squeeze ? 'tier-3' : 'tier-0');
  }

  showDriftEnd(points: number, tier: number): void {
    this.showCallout(t(`drift.tier${tier}`), t('hud.points', { count: points }), TUNING.hud.driftPopupSeconds, `tier-${tier}`);
  }

  showLap(timeMs: number, isBest: boolean, lap: number): void {
    const main = isBest ? t('hud.newBest') : t('hud.lapDone', { ordinal: formatOrdinal(lap), time: formatLapTime(timeMs) });
    const sub = isBest ? t('hud.lapDone', { ordinal: formatOrdinal(lap), time: formatLapTime(timeMs) }) : '';
    this.showCallout(main, sub, TUNING.hud.lapPopupSeconds, isBest ? 'tier-3' : 'tier-1');
  }

  showToast(key: string): void {
    this.showCallout(t(key), '', TUNING.hud.driftPopupSeconds, 'tier-0');
  }

  /** The same short message, for words already looked up. */
  showText(text: string): void {
    this.showCallout(text, '', TUNING.hud.driftPopupSeconds, 'tier-0');
  }

  private showCallout(main: string, sub: string, seconds: number, className: string): void {
    this.calloutMain.textContent = main;
    this.calloutSub.textContent = sub;
    this.callout.className = `hud-callout is-visible ${className}`;
    // Restarting the CSS animation needs a reflow between removing and adding the class.
    void this.callout.offsetWidth;
    this.calloutTimer = seconds;
  }

  /** The city has no lap to time; everything else on the HUD is the same. */
  updateCity(dt: number, telemetry: VehicleTelemetry, drift: DriftScorer): void {
    this.update(dt, telemetry, null, drift);
  }

  update(dt: number, telemetry: VehicleTelemetry, lap: LapTimer | null, drift: DriftScorer): void {
    this.lastTelemetry = telemetry;
    this.lastLap = lap;
    const hud = TUNING.hud;
    const engine = TUNING.vehicle.engine;

    const speedFraction = clamp01(telemetry.speedKmh / hud.dialMaxKmh);
    const angle = hud.dialStartDeg + speedFraction * (hud.dialEndDeg - hud.dialStartDeg);
    this.needle.style.transform = `rotate(${angle.toFixed(2)}deg)`;

    const rpmFraction = clamp01((telemetry.rpm - engine.idleRpm) / (engine.redlineRpm - engine.idleRpm));
    this.rpmArc.setAttribute('stroke-dasharray', `${(rpmFraction * 100).toFixed(1)} 100`);

    const nitroFraction = telemetry.nitro / TUNING.vehicle.nitro.capacity;
    this.nitroFill.style.transform = `scaleX(${nitroFraction.toFixed(3)})`;
    this.nitroPlate.classList.toggle('is-burning', telemetry.nitroActive);
    this.nitroPlate.classList.toggle('is-low', nitroFraction < hud.nitroLowFraction);

    this.textTimer -= dt;
    if (this.textTimer <= 0) {
      this.textTimer = 1 / hud.textHz;
      this.updateText(telemetry, lap);
      this.updateDriftLive(drift);
    }

    if (this.calloutTimer > 0) {
      this.calloutTimer -= dt;
      if (this.calloutTimer <= 0) this.callout.classList.remove('is-visible');
    }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.hint.classList.remove('is-visible');
    }
    this.wrongWay.classList.toggle('is-visible', lap?.wrongWay ?? false);
  }

  private updateText(telemetry: VehicleTelemetry, lap: LapTimer | null): void {
    setText(this.speedText, formatInteger(telemetry.speedKmh));
    setText(this.gearText, telemetry.reversing ? t('hud.reverseGear') : formatInteger(telemetry.gear));
    if (!lap) return;
    setText(this.lapLabel, t('hud.lap', { lap: localizeDigits(String(lap.currentLap)) }));
    setText(this.timeText, lap.hasStarted ? formatLapTime(lap.currentMs) : t('hud.noTime'));
    setText(this.bestText, lap.bestMs === null ? t('hud.noTime') : formatLapTime(lap.bestMs));
    this.lapNote.classList.toggle('is-visible', !lap.valid);
  }

  private updateDriftLive(drift: DriftScorer): void {
    const showing = drift.active && drift.points > 20;
    this.driftLive.classList.toggle('is-visible', showing);
    if (showing) {
      setText(this.driftPoints, formatNumber(Math.round(drift.points)));
      setText(this.driftMultiplier, t('hud.multiplier', { value: localizeDigits(drift.multiplier.toFixed(1)) }));
    }
  }
}
