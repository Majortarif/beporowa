/**
 * Racing friends: the relay connection, the lobby, everyone starting together, each other's
 * cars on the road, and watching a race without driving in it.
 */

import { Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { QualityPreset } from '../config/tuning';
import type { FinishedRun, RaceStartOptions } from '../game/race-director';
import { checkSlogan } from '../garage/slogan-filter';
import { formatLapTime, t } from '../i18n';
import { getSettings, updateSettings } from '../save/settings';
import { FriendsScreen } from '../ui/friends-screen';
import type { ResultExtra, ResultRow } from '../ui/race-results';
import type { VehicleController } from '../vehicle/vehicle-controller';
import { NetSession, relayUrl, type CarState } from './net-session';
import { RemoteCars } from './remote-cars';

export interface FriendsHost {
  startEvent(eventId: string, options: RaceStartOptions): void;
  /** Leaves the board and drives. */
  closeScreen(): void;
  enterSpectate(): void;
  leaveSpectate(): void;
  racing(): boolean;
  /** Raced, and the results board is showing. */
  showingResults(): boolean;
  setResultRows(rows: ResultRow[]): void;
  toast(text: string): void;
  carId(): string;
  /** The race's progress along its course, for friends' gaps. */
  progress(): number;
  defaultName(): string;
}

export class FriendsDirector {
  readonly net = new NetSession();
  readonly screen: FriendsScreen;
  readonly remote: RemoteCars;
  private message = '';
  private spectating = false;
  private targetIndex = 0;
  private readonly state: CarState = [0, 0, 0, 0, 0, 0, 1, 0, 0];
  private readonly spectateBar: HTMLElement;
  private readonly cameraGoal = new Vector3();
  private readonly lookGoal = new Vector3();
  private readonly look = new Vector3();
  private cameraPlaced = false;

  constructor(
    scene: Scene,
    preset: QualityPreset,
    uiRoot: HTMLElement,
    private readonly car: VehicleController,
    private readonly host: FriendsHost,
  ) {
    this.remote = new RemoteCars(scene, preset, uiRoot);
    this.screen = new FriendsScreen({
      connectAndCreate: (name) => void this.connectThen(name, () => this.net.createRoom()),
      connectAndJoin: (name, code, spectate) => {
        if (!/^[A-Z0-9]{4}$/.test(code.trim().toUpperCase())) {
          this.say(t('friends.badCode'));
          return;
        }
        void this.connectThen(name, () => this.net.joinRoom(code, spectate));
      },
      start: (eventId) => this.net.startRace(eventId),
      leave: () => {
        this.net.leaveRoom();
        this.net.close();
        this.remote.clear();
        this.refresh();
      },
      close: () => this.host.closeScreen(),
    });
    this.spectateBar = document.createElement('div');
    this.spectateBar.className = 'spectate-bar plate plate-indigo';
    this.spectateBar.innerHTML = `
      <button type="button" class="plaque plaque-soot" data-action="prev" aria-label=""></button>
      <span class="spectate-name" aria-live="polite"></span>
      <button type="button" class="plaque plaque-soot" data-action="next" aria-label=""></button>
      <button type="button" class="plaque plaque-tomato" data-action="stop"></button>`;
    uiRoot.appendChild(this.spectateBar);
    this.spectateBar.querySelector('[data-action="prev"]')?.addEventListener('click', () => this.cycleTarget(-1));
    this.spectateBar.querySelector('[data-action="next"]')?.addEventListener('click', () => this.cycleTarget(1));
    this.spectateBar.querySelector('[data-action="stop"]')?.addEventListener('click', () => this.host.leaveSpectate());
    this.bindNet();
  }

  get configured(): boolean {
    return relayUrl() !== '';
  }

  get inRoom(): boolean {
    return this.net.roomCode !== null;
  }

  get isSpectating(): boolean {
    return this.spectating;
  }

  private say(text: string): void {
    this.message = text;
    this.refresh();
  }

  private async connectThen(rawName: string, then: () => void): Promise<void> {
    const name = rawName.trim() || this.host.defaultName();
    if (checkSlogan(name) === 'rude') {
      this.say(t('friends.rudeName'));
      return;
    }
    updateSettings({ onlineName: rawName.trim() });
    this.message = '';
    if (this.net.status !== 'open') {
      const ok = await this.net.connect(relayUrl(), name, this.host.carId());
      if (!ok) {
        this.say(t('friends.status.failed'));
        return;
      }
    }
    then();
  }

  private bindNet(): void {
    const net = this.net;
    net.onStatus = () => this.refresh();
    net.onRoster = () => {
      this.remote.setRoster(net.peers, net.myId);
      this.refresh();
      if (this.host.showingResults()) this.host.setResultRows(this.resultRows());
      if (this.spectating && this.remote.ids.length === 0) this.host.leaveSpectate();
    };
    net.onState = (id, state) => this.remote.push(id, state, performance.now());
    net.onLeft = (id) => this.remote.remove(id);
    net.onError = (code) => this.say(t(`friends.error.${code}`));
    net.onGo = (eventId, inMs) => this.onGo(eventId, inMs);
  }

  private onGo(eventId: string, inMs: number): void {
    const me = this.net.me;
    if (me?.spectator) {
      this.targetIndex = 0;
      this.host.enterSpectate();
      return;
    }
    this.host.startEvent(eventId, { kind: 'friend', ghost: { kind: 'none' }, startAtMs: performance.now() + inMs });
  }

  /** Puts the friends board up to date. */
  refresh(): void {
    const net = this.net;
    this.screen.show({
      configured: this.configured,
      status: net.status,
      code: net.roomCode,
      myId: net.myId,
      hostId: net.hostId,
      peers: net.peers,
      message: this.message,
      name: getSettings().onlineName,
    });
  }

  /** A friend race is over: tell the others, and show everyone's times as they arrive. */
  onRunFinished(run: FinishedRun): ResultExtra | null {
    if (run.kind !== 'friend') return null;
    if (run.outcome.failure === 'none') this.net.sendFinish(run.outcome.timeMs);
    return { subtitle: t('friends.resultsTitle'), ghostBattle: false };
  }

  resultRows(): ResultRow[] {
    const rows = this.net.peers
      .filter((peer) => !peer.spectator)
      .map((peer) => ({ name: peer.name, isPlayer: peer.id === this.net.myId, time: peer.finishMs !== null ? formatLapTime(peer.finishMs) : t('race.result.stillRacing'), ms: peer.finishMs ?? Infinity }));
    rows.sort((a, b) => a.ms - b.ms);
    return rows.map(({ name, isPlayer, time }) => ({ name, isPlayer, time }));
  }

  /** Runs once per rendered frame: sends this car, draws the others. */
  frame(nowMs: number, camera: PerspectiveCamera, width: number, height: number, driving: boolean): void {
    if (!this.inRoom) return;
    if (driving && !this.spectating) {
      const body = this.car.body;
      const p = body.translation();
      const q = body.rotation();
      const s = this.state;
      s[0] = p.x;
      s[1] = p.y;
      s[2] = p.z;
      s[3] = q.x;
      s[4] = q.y;
      s[5] = q.z;
      s[6] = q.w;
      s[7] = this.car.telemetry.speed;
      s[8] = this.host.racing() ? this.host.progress() : 0;
      this.net.sendState(nowMs, s);
    }
    this.remote.frame(nowMs, camera, width, height, true);
  }

  // ---------- Watching ----------

  startSpectating(): void {
    this.spectating = true;
    this.cameraPlaced = false;
    this.spectateBar.classList.add('is-visible');
    this.updateSpectateBar();
  }

  stopSpectating(): void {
    this.spectating = false;
    this.spectateBar.classList.remove('is-visible');
  }

  private cycleTarget(step: number): void {
    const count = this.remote.ids.length;
    if (count === 0) return;
    this.targetIndex = (this.targetIndex + step + count) % count;
    this.cameraPlaced = false;
    this.updateSpectateBar();
  }

  private updateSpectateBar(): void {
    const id = this.remote.ids[this.targetIndex];
    const name = id !== undefined ? this.remote.nameOf(id) : '';
    (this.spectateBar.querySelector('.spectate-name') as HTMLElement).textContent = t('friends.watching', { name });
    (this.spectateBar.querySelector('[data-action="prev"]') as HTMLElement).textContent = '‹';
    (this.spectateBar.querySelector('[data-action="next"]') as HTMLElement).textContent = '›';
    this.spectateBar.querySelector('[data-action="prev"]')?.setAttribute('aria-label', t('friends.prev'));
    this.spectateBar.querySelector('[data-action="next"]')?.setAttribute('aria-label', t('friends.next'));
    (this.spectateBar.querySelector('[data-action="stop"]') as HTMLElement).textContent = t('friends.stopWatching');
  }

  /** Keys while watching: left and right switch cars. */
  spectateKey(step: number): void {
    if (this.spectating && step !== 0) this.cycleTarget(step);
  }

  /** A chase camera on the friend being watched. */
  updateSpectateCamera(dt: number, camera: PerspectiveCamera): void {
    const id = this.remote.ids[Math.min(this.targetIndex, this.remote.ids.length - 1)];
    const pose = id !== undefined ? this.remote.pose(id) : null;
    if (!pose) return;
    const fx = 2 * (pose.qx * pose.qz + pose.qw * pose.qy);
    const fz = 1 - 2 * (pose.qx * pose.qx + pose.qy * pose.qy);
    const length = Math.hypot(fx, fz) || 1;
    this.cameraGoal.set(pose.x - (fx / length) * 7.5, pose.y + 2.8, pose.z - (fz / length) * 7.5);
    this.lookGoal.set(pose.x + (fx / length) * 4, pose.y + 0.9, pose.z + (fz / length) * 4);
    if (!this.cameraPlaced) {
      camera.position.copy(this.cameraGoal);
      this.look.copy(this.lookGoal);
      this.cameraPlaced = true;
    } else {
      const follow = 1 - Math.exp(-dt * 5);
      camera.position.lerp(this.cameraGoal, follow);
      this.look.lerp(this.lookGoal, 1 - Math.exp(-dt * 9));
    }
    camera.lookAt(this.look);
  }
}
