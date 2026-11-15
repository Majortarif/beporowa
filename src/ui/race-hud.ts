/** The race HUD: place, laps and clock, the big countdown, standings, rival talk and name plates. */

import { Vector3, type PerspectiveCamera } from 'three';
import { RACE } from '../config/race-tuning';
import { banter } from '../online/banter-client';
import { clamp } from '../core/math';
import { formatInteger, formatLapTime, formatNumber, formatOrdinal, localizeDigits, onI18nChange, t, tList } from '../i18n';
import type { RaceSession, TauntKind } from '../race/race-session';
import type { RacerAgent } from '../race/racer-agent';
import { rivalPortraitUrl } from './rival-portraits';

const ARROW = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4 42 30H30v14H18V30H6Z" fill="currentColor" stroke="#1b1410" stroke-width="3" stroke-linejoin="round"/></svg>';
const NAME_PLATES = 4;

/** A crew member's name, from the list in the language files. */
export function crewName(index: number): string {
  const names = tList('race.crew');
  return names.length > 0 ? names[index % names.length] : '';
}

export function agentName(agent: RacerAgent): string {
  return agent.rivalId ? t(`rival.${agent.rivalId}.nick`) : crewName(agent.crewIndex);
}

export class RaceHud {
  readonly root: HTMLElement;
  private readonly top: HTMLElement;
  private readonly placeNumber: HTMLElement;
  private readonly placeOf: HTMLElement;
  private readonly lineA: HTMLElement;
  private readonly lineB: HTMLElement;
  private readonly lineC: HTMLElement;
  private readonly meter: HTMLElement;
  private readonly meterFill: HTMLElement;
  private readonly standings: HTMLElement;
  private readonly arrow: HTMLElement;
  private readonly arrowIcon: HTMLElement;
  private readonly arrowText: HTMLElement;
  private readonly count: HTMLElement;
  private readonly note: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly taunt: HTMLElement;
  private readonly tauntFace: HTMLImageElement;
  private readonly tauntName: HTMLElement;
  private readonly tauntLine: HTMLElement;
  private readonly prompt: HTMLButtonElement;
  private readonly phone: HTMLElement;
  private readonly phoneFrom: HTMLElement;
  private readonly phoneText: HTMLElement;
  private readonly plates: HTMLElement[] = [];
  private readonly projected = new Vector3();

  private textTimer = 0;
  private bannerTimer = 0;
  private tauntTimer = 0;
  private countTimer = 0;
  private phoneTimer = 0;
  private standingsKey = '';
  /** Fires when the player taps the plate that offers a race. */
  onPrompt: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'race-layer';
    this.root.innerHTML = `
      <div class="race-names"></div>
      <div class="race-top plate plate-soot">
        <div class="race-place"><span class="race-place-number"></span><span class="race-place-of"></span></div>
        <div class="race-lines">
          <div class="race-line race-line-a"></div>
          <div class="race-line race-line-b"></div>
          <div class="race-line race-line-c"></div>
          <div class="race-meter"><i></i></div>
        </div>
      </div>
      <ol class="race-standings plate plate-indigo"></ol>
      <div class="race-arrow plate plate-marigold"><div class="race-arrow-icon">${ARROW}</div><div class="race-arrow-text"></div></div>
      <div class="race-count" aria-live="assertive"></div>
      <div class="race-note plate plate-tomato"></div>
      <div class="race-banner plate plate-marigold"></div>
      <div class="race-taunt plate plate-tin subtitle">
        <img class="race-taunt-face" alt="" />
        <div><strong class="race-taunt-name"></strong><p class="race-taunt-line"></p><span class="ai-tag" hidden></span></div>
      </div>
      <button type="button" class="race-prompt plate plate-marigold"></button>
      <div class="race-phone">
        <div class="race-phone-screen">
          <strong class="race-phone-from"></strong>
          <p class="race-phone-text"></p>
        </div>
      </div>`;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(selector: string): T => this.root.querySelector(selector) as T;
    this.top = q('.race-top');
    this.placeNumber = q('.race-place-number');
    this.placeOf = q('.race-place-of');
    this.lineA = q('.race-line-a');
    this.lineB = q('.race-line-b');
    this.lineC = q('.race-line-c');
    this.meter = q('.race-meter');
    this.meterFill = q('.race-meter i');
    this.standings = q('.race-standings');
    this.arrow = q('.race-arrow');
    this.arrowIcon = q('.race-arrow-icon');
    this.arrowText = q('.race-arrow-text');
    this.count = q('.race-count');
    this.note = q('.race-note');
    this.banner = q('.race-banner');
    this.taunt = q('.race-taunt');
    this.tauntFace = q('.race-taunt-face');
    this.tauntName = q('.race-taunt-name');
    this.tauntLine = q('.race-taunt-line');
    this.prompt = q('.race-prompt');
    this.phone = q('.race-phone');
    this.phoneFrom = q('.race-phone-from');
    this.phoneText = q('.race-phone-text');
    const names = q('.race-names');
    for (let i = 0; i < NAME_PLATES; i++) {
      const plate = document.createElement('div');
      plate.className = 'race-name';
      names.appendChild(plate);
      this.plates.push(plate);
    }
    this.prompt.addEventListener('click', () => this.onPrompt?.());
    onI18nChange(() => {
      this.textTimer = 0;
      this.standingsKey = '';
    });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('is-visible', visible);
  }

  setRacing(racing: boolean): void {
    this.root.classList.toggle('is-racing', racing);
    if (!racing) {
      this.note.classList.remove('is-visible');
      this.banner.classList.remove('is-visible');
      this.taunt.classList.remove('is-visible');
      this.count.classList.remove('is-visible');
      for (const plate of this.plates) plate.classList.remove('is-visible');
    }
  }

  /** Offers a race at a flag, or takes the offer away. */
  setPrompt(text: string | null): void {
    if (text === null) {
      this.prompt.classList.remove('is-visible');
    } else {
      this.prompt.textContent = text;
      this.prompt.classList.add('is-visible');
    }
  }

  showCount(step: number): void {
    const text = step === 0 ? t('race.hud.go') : localizeDigits(String(step));
    this.count.textContent = text;
    this.count.classList.remove('is-visible', 'is-go');
    void this.count.offsetWidth;
    this.count.classList.add('is-visible');
    this.count.classList.toggle('is-go', step === 0);
    this.countTimer = step === 0 ? RACE.countdown.goShowSeconds : RACE.countdown.stepSeconds;
  }

  showBanner(text: string, seconds = 2.4): void {
    this.banner.textContent = text;
    this.banner.classList.remove('is-visible');
    void this.banner.offsetWidth;
    this.banner.classList.add('is-visible');
    this.bannerTimer = seconds;
  }

  /** A rival says something over the race. */
  showTaunt(rivalId: string, kind: TauntKind | 'leg1' | 'leg2'): void {
    const lines = tList(`rival.${rivalId}.${kind}`);
    if (lines.length === 0) return;
    // A line written live, if the player turned that on and one is ready. Otherwise one written by hand.
    const fresh = banter.takeTaunt(rivalId, kind);
    this.tauntFace.src = rivalPortraitUrl(rivalId);
    this.tauntName.textContent = t(`rival.${rivalId}.nick`);
    this.tauntLine.textContent = fresh ?? lines[Math.floor(Math.random() * lines.length)];
    const tag = this.taunt.querySelector('.ai-tag') as HTMLElement;
    tag.textContent = t('banter.tag');
    tag.hidden = fresh === null;
    this.taunt.classList.remove('is-visible');
    void this.taunt.offsetWidth;
    this.taunt.classList.add('is-visible');
    this.tauntTimer = RACE.taunts.showSeconds;
  }

  /** A message arrives on the phone. */
  showPhone(from: string, text: string, seconds = 7): void {
    this.phoneFrom.textContent = from;
    this.phoneText.textContent = text;
    this.phone.classList.remove('is-visible');
    void this.phone.offsetWidth;
    this.phone.classList.add('is-visible');
    this.phoneTimer = seconds;
  }

  update(dt: number, session: RaceSession, camera: PerspectiveCamera, width: number, height: number, playerX: number, playerZ: number): void {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.banner.classList.remove('is-visible');
    }
    if (this.tauntTimer > 0) {
      this.tauntTimer -= dt;
      if (this.tauntTimer <= 0) this.taunt.classList.remove('is-visible');
    }
    if (this.countTimer > 0) {
      this.countTimer -= dt;
      if (this.countTimer <= 0) this.count.classList.remove('is-visible');
    }
    if (this.phoneTimer > 0) {
      this.phoneTimer -= dt;
      if (this.phoneTimer <= 0) this.phone.classList.remove('is-visible');
    }
    if (!session.isActive) return;

    this.textTimer -= dt;
    if (this.textTimer <= 0) {
      this.textTimer = 0.12;
      this.updateText(session);
      this.updateStandings(session);
      this.updateNote(session);
    }
    this.updateArrow(session, camera, playerX, playerZ);
    this.updateNames(session, camera, width, height);
  }

  private updateText(session: RaceSession): void {
    const event = session.event;
    if (!event) return;
    const family = session.raceFamily;
    const showsPlace = family === 'route' || event.mode === 'bazaarMaze';
    this.top.classList.toggle('has-place', showsPlace);
    if (showsPlace) {
      this.placeNumber.textContent = formatOrdinal(session.position);
      this.placeOf.textContent = t('race.hud.of', { total: formatInteger(session.racerCount) });
    }

    let a = '';
    let b = '';
    let c = '';
    let meter: number | null = null;
    const clock = formatLapTime(session.elapsed * 1000);
    const left = formatLapTime(session.timeLeft * 1000);

    switch (family) {
      case 'route':
        if (session.laps > 1) a = t('race.hud.lap', { lap: localizeDigits(String(Math.min(session.lap + 1, session.laps))), laps: localizeDigits(String(session.laps)) });
        else a = t(`race.mode.${event.mode}`);
        b = clock;
        c = this.gapText(session);
        if (event.legs) a = t('race.hud.leg', { leg: localizeDigits(String(session.leg + 1)), legs: localizeDigits(String(event.legs.length + 1)) });
        if (event.mode === 'timeTrial' && event.medals) c = t('race.hud.target', { time: formatLapTime(event.medals[0] * 1000) });
        break;
      case 'gates':
        a = t('race.hud.gates', { done: localizeDigits(String(session.gateIndex)), total: localizeDigits(String(session.gateList.length)) });
        b = session.hasClock ? left : clock;
        if (event.mode === 'delivery') {
          c = t('race.hud.cargo', { cargo: formatInteger(session.cargo) });
          meter = session.cargo / 100;
        } else if (event.mode === 'bazaarMaze') {
          c = this.gapText(session);
        }
        break;
      case 'hunt':
        a = t('race.hud.targets', { left: localizeDigits(String(session.targetsLeft)), total: localizeDigits(String(session.targetsTotal)) });
        b = left;
        {
          const target = this.nearestTarget(session);
          if (target) {
            c = crewName(target.crewIndex);
            meter = clamp(target.health / RACE.takedown.health, 0, 1);
          }
        }
        break;
      case 'drift':
        a = t('race.hud.score', { score: formatNumber(session.score) });
        b = left;
        if (event.rivalRace) c = t('race.hud.rivalScore', { name: t(`rival.${event.rivalRace}.nick`), score: formatNumber(session.rivalScoreNow) });
        else c = t('race.hud.targetScore', { score: formatNumber(session.targetScore) });
        break;
    }
    this.setText(this.lineA, a);
    this.setText(this.lineB, b);
    this.setText(this.lineC, c);
    this.meter.classList.toggle('is-visible', meter !== null);
    if (meter !== null) this.meterFill.style.transform = `scaleX(${meter.toFixed(3)})`;
  }

  private setText(element: HTMLElement, text: string): void {
    if (element.textContent !== text) element.textContent = text;
  }

  private nearestTarget(session: RaceSession): RacerAgent | null {
    let best: RacerAgent | null = null;
    let bestDistance = Infinity;
    for (const agent of session.agents) {
      if (agent.eliminated) continue;
      const distance = Math.hypot(agent.currX - this.playerX, agent.currZ - this.playerZ);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = agent;
      }
    }
    return best;
  }

  private playerX = 0;
  private playerZ = 0;

  /** The gap to whichever rival matters most. */
  private gapText(session: RaceSession): string {
    const event = session.event;
    const id = event?.rivalRace;
    if (!id) return '';
    const rival = session.agents.find((agent) => agent.rivalId === id);
    if (!rival || session.raceFamily !== 'route') return t(`rival.${id}.nick`);
    const gap = rival.progress - session.progress;
    const speed = Math.max(rival.car.telemetry.speed, 8);
    const seconds = Math.abs(gap) / speed;
    return t(gap > 0 ? 'race.hud.gapAhead' : 'race.hud.gapBehind', { name: t(`rival.${id}.nick`), seconds: localizeDigits(seconds.toFixed(1)) });
  }

  private updateStandings(session: RaceSession): void {
    const rows = session.standings;
    const family = session.raceFamily;
    const show = (family === 'route' || session.event?.mode === 'bazaarMaze') && rows.length > 1;
    this.standings.classList.toggle('is-visible', show);
    if (!show) return;
    let key = '';
    for (const row of rows) key += row.agent ? `${row.agent.rivalId ?? row.agent.crewIndex},` : 'p,';
    if (key === this.standingsKey) return;
    this.standingsKey = key;
    this.standings.replaceChildren();
    rows.slice(0, 6).forEach((row, index) => {
      const item = document.createElement('li');
      item.classList.toggle('is-player', row.agent === null);
      item.classList.toggle('is-rival', row.agent?.rivalId != null);
      const place = document.createElement('span');
      place.className = 'race-standing-place';
      place.textContent = formatInteger(index + 1);
      const name = document.createElement('span');
      name.textContent = row.agent ? agentName(row.agent) : t('race.hud.you');
      item.append(place, name);
      this.standings.appendChild(item);
    });
  }

  private updateNote(session: RaceSession): void {
    const note = this.note;
    let key: string | null = null;
    if (session.wrongWay) key = 'race.hud.wrongWay';
    else if (session.offRoute) key = 'race.hud.offRoute';
    else if (session.shiftLight) key = 'race.hud.shift';
    else if (session.event?.mode === 'delivery' && session.isRunning && session.nextGate.valid && this.nearGate(session)) key = 'race.hud.slowDown';
    note.classList.toggle('is-visible', key !== null);
    note.classList.toggle('is-shift', key === 'race.hud.shift');
    if (key) this.setText(note, t(key));
  }

  private nearGate(session: RaceSession): boolean {
    const gate = session.nextGate;
    return Math.hypot(gate.x - this.playerX, gate.z - this.playerZ) < RACE.delivery.radius * 2.6;
  }

  /** Free-routed races: an arrow points straight at the next place, whatever the road does. */
  private updateArrow(session: RaceSession, camera: PerspectiveCamera, playerX: number, playerZ: number): void {
    this.playerX = playerX;
    this.playerZ = playerZ;
    const gate = session.nextGate;
    const show = session.raceFamily === 'gates' && gate.valid && (session.isRunning || session.phase === 'countdown');
    this.arrow.classList.toggle('is-visible', show);
    if (!show) return;
    camera.getWorldDirection(this.projected);
    const heading = Math.atan2(this.projected.x, this.projected.z);
    const to = Math.atan2(gate.x - playerX, gate.z - playerZ);
    // Screen right is the car's negative left, so the angle turns over.
    const relative = heading - to;
    this.arrowIcon.style.transform = `rotate(${relative.toFixed(3)}rad)`;
    const metres = Math.round(Math.hypot(gate.x - playerX, gate.z - playerZ) / 10) * 10;
    this.setText(this.arrowText, t('race.hud.metres', { metres: formatInteger(metres) }));
  }

  /** Small name plates above the rivals near you. */
  private updateNames(session: RaceSession, camera: PerspectiveCamera, width: number, height: number): void {
    let used = 0;
    const reach = 90;
    for (const agent of session.agents) {
      if (used >= NAME_PLATES) break;
      if (!agent.active || agent.eliminated) continue;
      const distance = Math.hypot(agent.currX - this.playerX, agent.currZ - this.playerZ);
      if (distance > reach || distance < 3) continue;
      this.projected.set(agent.currX, agent.currY + 2.1, agent.currZ).project(camera);
      if (this.projected.z >= 1 || Math.abs(this.projected.x) > 1 || Math.abs(this.projected.y) > 1) continue;
      const plate = this.plates[used++];
      this.setText(plate, agentName(agent));
      plate.classList.add('is-visible');
      plate.classList.toggle('is-rival', agent.rivalId !== null);
      const x = (this.projected.x * 0.5 + 0.5) * width;
      const y = (-this.projected.y * 0.5 + 0.5) * height;
      plate.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (let i = used; i < NAME_PLATES; i++) this.plates[i].classList.remove('is-visible');
  }
}
