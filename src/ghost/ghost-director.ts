/**
 * Ghosts in a race: records every run, keeps the best one for each event on this machine,
 * and shows a ghost to race against, with the gap to it, live.
 */

import type { PerspectiveCamera, Scene } from 'three';
import { GHOST, MARKER_COLOURS } from '../config/extras';
import type { RaceEventDef } from '../config/race-events';
import type { QualityPreset } from '../config/tuning';
import { localizeDigits, t } from '../i18n';
import type { RaceSession } from '../race/race-session';
import { getCareer, readExtra, writeExtra } from '../save/career';
import { getSettings } from '../save/settings';
import { CarTags } from '../ui/car-tags';
import type { VehicleController } from '../vehicle/vehicle-controller';
import { GhostCarView } from './ghost-view';
import { GhostRecorder, createGhostPose, decodeGhost, encodeGhost, ghostTimeAtProgress, sampleGhost, type GhostTrack } from './ghost-track';

/** Which ghost to race against. */
export type GhostChoice = { kind: 'best' } | { kind: 'none' } | { kind: 'track'; track: GhostTrack; label: string };

export interface GhostOutcome {
  /** The run just finished, if it could be kept. */
  track: GhostTrack | null;
  /** It beat the best ghost this machine had for the event. */
  newBest: boolean;
  /** The time of the ghost raced against, if there was one. */
  ghostMs: number | null;
}

/** Whether an event keeps ghosts at all. */
export function eventKeepsGhost(event: RaceEventDef): boolean {
  return !GHOST.skipModes.includes(event.mode);
}

function storageKey(eventId: string): string {
  return `ghost:${eventId}`;
}

/** The best run this machine has kept for an event. */
export async function loadBestGhost(eventId: string): Promise<GhostTrack | null> {
  const raw = await readExtra(storageKey(eventId));
  return decodeGhost(raw, Math.ceil(GHOST.maxSeconds * 30) + 2);
}

export class GhostDirector {
  private readonly recorder = new GhostRecorder();
  private readonly pose = createGhostPose();
  private readonly tags: CarTags;
  private readonly gap: HTMLElement;
  private view: GhostCarView | null = null;
  private track: GhostTrack | null = null;
  private label = '';
  private best: GhostTrack | null = null;
  private event: RaceEventDef | null = null;
  /** Bumped at each new race, so a slow load for an old race is thrown away. */
  private generation = 0;
  private finished = false;
  private gapTimer = 0;

  constructor(
    private readonly scene: Scene,
    private readonly preset: QualityPreset,
    private readonly car: VehicleController,
    uiRoot: HTMLElement,
  ) {
    this.tags = new CarTags(uiRoot);
    this.gap = document.createElement('div');
    this.gap.className = 'ghost-gap plate plate-soot';
    this.gap.setAttribute('aria-live', 'off');
    uiRoot.appendChild(this.gap);
  }

  /** Gets ready for a race, finding whichever ghost was asked for. */
  prepare(event: RaceEventDef, choice: GhostChoice): void {
    this.clear();
    const generation = ++this.generation;
    this.event = event;
    this.finished = false;
    if (!eventKeepsGhost(event)) return;
    void loadBestGhost(event.id).then((best) => {
      if (generation !== this.generation) return;
      this.best = best;
      if (choice.kind === 'best' && best && getSettings().ghosts) this.show(best, t('ghost.tagBest'));
    });
    if (choice.kind === 'track') this.show(choice.track, choice.label);
  }

  private show(track: GhostTrack, label: string): void {
    this.view?.dispose();
    this.track = track;
    this.label = label;
    this.view = new GhostCarView(this.scene, track.carId, this.preset, 'ghost', undefined, MARKER_COLOURS[getSettings().colourVision].ghost);
  }

  /** The ghost being raced against, if any. */
  get rivalGhost(): GhostTrack | null {
    return this.track;
  }

  /** Records the player, after each physics step. */
  postStep(session: RaceSession): void {
    const event = this.event;
    if (!event || !eventKeepsGhost(event) || this.finished) return;
    if (session.phase === 'running' && !this.recorder.active) {
      this.recorder.begin(event.id, this.carId(), GHOST.hz, GHOST.maxSeconds);
    }
    if (!this.recorder.active) return;
    if (session.phase !== 'running') return;
    const body = this.car.body;
    const p = body.translation();
    const q = body.rotation();
    this.recorder.record(session.elapsed, p.x, p.y, p.z, q.x, q.y, q.z, q.w, session.progress);
  }

  private carId(): string {
    return getCareer().selectedCar;
  }

  /**
   * The race is over: keep the run if it was the best yet.
   * @param keepAsBest only a clean, full run may replace the best ghost
   */
  finish(timeMs: number, keepAsBest: boolean): GhostOutcome {
    this.finished = true;
    const track = this.recorder.active ? this.recorder.finish(timeMs) : null;
    const ghostMs = this.track?.timeMs ?? null;
    let newBest = false;
    if (track && keepAsBest && (!this.best || track.timeMs < this.best.timeMs)) {
      newBest = true;
      this.best = track;
      const packet = encodeGhost(track);
      if (packet) void writeExtra(storageKey(track.eventId), packet);
    }
    return { track, newBest, ghostMs };
  }

  /**
   * How far ahead (negative) or behind (positive) the player is, in seconds.
   * @returns null where it cannot be told
   */
  gapSeconds(session: RaceSession): number | null {
    const track = this.track;
    if (!track || session.raceFamily !== 'route' || session.phase !== 'running') return null;
    const ghostAt = ghostTimeAtProgress(track, session.progress);
    if (ghostAt === null) return null;
    return session.elapsed - ghostAt;
  }

  /** Moves the ghost along and labels it. Runs once per rendered frame. */
  frame(dt: number, session: RaceSession, alpha: number, camera: PerspectiveCamera, width: number, height: number): void {
    const track = this.track;
    const view = this.view;
    this.tags.begin();
    if (!track || !view || !session.isActive || !getSettings().ghosts) {
      view?.setVisible(false);
      this.tags.end();
      this.gap.classList.remove('is-visible');
      return;
    }
    // The player's car is drawn between its last two steps, so the ghost is drawn at the same moment.
    const running = session.phase === 'running' || session.phase === 'finishing' || session.phase === 'done';
    const time = running ? Math.max(0, session.elapsed - (1 - alpha) / 60) : 0;
    sampleGhost(track, time, this.pose);
    view.setVisible(true);
    view.setPose(this.pose.x, this.pose.y, this.pose.z, this.pose.qx, this.pose.qy, this.pose.qz, this.pose.qw);
    const distance = camera.position.distanceTo(view.visual.root.position);
    view.setNearness(distance);
    if (distance < GHOST.tagReach) this.tags.add(this.label, 'ghost', this.pose.x, this.pose.y, this.pose.z, camera, width, height);
    this.tags.end();

    this.gapTimer -= dt;
    if (this.gapTimer > 0) return;
    this.gapTimer = 0.25;
    const gap = this.gapSeconds(session);
    this.gap.classList.toggle('is-visible', gap !== null);
    if (gap === null) return;
    const ahead = gap < 0;
    this.gap.dataset.state = ahead ? 'ahead' : 'behind';
    this.gap.textContent = t(ahead ? 'ghost.gapAhead' : 'ghost.gapBehind', { seconds: localizeDigits(Math.abs(gap).toFixed(1)) });
  }

  /** Puts the ghost away. */
  clear(): void {
    this.recorder.cancel();
    this.view?.dispose();
    this.view = null;
    this.track = null;
    this.event = null;
    this.tags.clear();
    this.gap.classList.remove('is-visible');
  }
}
