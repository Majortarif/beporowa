/**
 * Friends' cars, drawn from the places they send. Each is shown a little in the past and
 * blended between messages, so it glides instead of jumping. They have no body: you drive
 * through them, and they through you, so nobody's game decides anyone else's crash.
 */

import type { PerspectiveCamera, Scene } from 'three';
import { GHOST, MARKER_COLOURS } from '../config/extras';
import type { QualityPreset } from '../config/tuning';
import { GhostCarView } from '../ghost/ghost-view';
import { getSettings } from '../save/settings';
import { CarTags } from '../ui/car-tags';
import type { CarState, RoomPeer } from './net-session';

interface Snapshot {
  at: number;
  s: CarState;
}

interface RemoteCar {
  id: number;
  name: string;
  car: string;
  view: GhostCarView;
  snapshots: Snapshot[];
  /** The pose last drawn. */
  pose: CarState;
  seen: boolean;
}

export interface RemotePose {
  x: number;
  y: number;
  z: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  speed: number;
  progress: number;
}

const MAX_SNAPSHOTS = 10;

export class RemoteCars {
  private readonly cars = new Map<number, RemoteCar>();
  private readonly tags: CarTags;

  constructor(
    private readonly scene: Scene,
    private readonly preset: QualityPreset,
    uiRoot: HTMLElement,
  ) {
    this.tags = new CarTags(uiRoot);
  }

  /** Keeps a car for every racer in the room but this player. */
  setRoster(peers: readonly RoomPeer[], myId: number): void {
    const wanted = new Set<number>();
    for (const peer of peers) {
      if (peer.spectator || peer.id === myId) continue;
      wanted.add(peer.id);
      const existing = this.cars.get(peer.id);
      if (existing && existing.car === peer.car) {
        existing.name = peer.name;
        continue;
      }
      existing?.view.dispose();
      const view = new GhostCarView(this.scene, peer.car, this.preset, 'ghost', undefined, MARKER_COLOURS[getSettings().colourVision].friend);
      this.cars.set(peer.id, { id: peer.id, name: peer.name, car: peer.car, view, snapshots: [], pose: [0, 0, 0, 0, 0, 0, 1, 0, 0], seen: false });
    }
    for (const id of [...this.cars.keys()]) if (!wanted.has(id)) this.remove(id);
  }

  push(id: number, state: CarState, nowMs: number): void {
    const car = this.cars.get(id);
    if (!car) return;
    car.snapshots.push({ at: nowMs, s: state });
    if (car.snapshots.length > MAX_SNAPSHOTS) car.snapshots.shift();
  }

  remove(id: number): void {
    const car = this.cars.get(id);
    if (!car) return;
    car.view.dispose();
    this.cars.delete(id);
  }

  get ids(): number[] {
    return [...this.cars.keys()];
  }

  nameOf(id: number): string {
    return this.cars.get(id)?.name ?? '';
  }

  /** Where a friend's car is drawn now. */
  pose(id: number): RemotePose | null {
    const car = this.cars.get(id);
    if (!car || !car.seen) return null;
    const [x, y, z, qx, qy, qz, qw, speed, progress] = car.pose;
    return { x, y, z, qx, qy, qz, qw, speed, progress };
  }

  /** Places every car for this frame, and their name plates. */
  frame(nowMs: number, camera: PerspectiveCamera, width: number, height: number, showTags: boolean): void {
    const at = nowMs - GHOST.remoteDelaySeconds * 1000;
    this.tags.begin();
    for (const car of this.cars.values()) {
      const shots = car.snapshots;
      if (shots.length === 0) {
        car.view.setVisible(false);
        continue;
      }
      // Find the two messages either side of the moment drawn; past the newest, hold the newest.
      let index = shots.length - 1;
      while (index > 0 && shots[index - 1].at > at) index--;
      const b = shots[index];
      const a = index > 0 ? shots[index - 1] : b;
      const span = b.at - a.at;
      const share = span > 0 ? Math.min(1, Math.max(0, (at - a.at) / span)) : 1;
      const pose = car.pose;
      for (let i = 0; i < 9; i++) pose[i] = a.s[i] + (b.s[i] - a.s[i]) * share;
      let dot = 0;
      for (let i = 3; i < 7; i++) dot += a.s[i] * b.s[i];
      if (dot < 0) for (let i = 3; i < 7; i++) pose[i] = a.s[i] + (-b.s[i] - a.s[i]) * share;
      const length = Math.hypot(pose[3], pose[4], pose[5], pose[6]) || 1;
      for (let i = 3; i < 7; i++) pose[i] /= length;
      car.seen = true;
      // A car silent for seconds has gone: hide it until it speaks again.
      const silent = nowMs - b.at > 4000;
      car.view.setVisible(!silent);
      if (silent) continue;
      car.view.setPose(pose[0], pose[1], pose[2], pose[3], pose[4], pose[5], pose[6]);
      const distance = camera.position.distanceTo(car.view.visual.root.position);
      car.view.setNearness(distance);
      if (showTags && distance < GHOST.tagReach * 2) this.tags.add(car.name, 'friend', pose[0], pose[1], pose[2], camera, width, height);
    }
    this.tags.end();
  }

  /** Friends' places for the minimap, as x, z pairs. @returns how many */
  mapPoints(out: Float32Array): number {
    let count = 0;
    for (const car of this.cars.values()) {
      if (!car.seen || count * 2 + 1 >= out.length) continue;
      out[count * 2] = car.pose[0];
      out[count * 2 + 1] = car.pose[2];
      count++;
    }
    return count;
  }

  clear(): void {
    for (const id of [...this.cars.keys()]) this.remove(id);
    this.tags.clear();
  }
}
