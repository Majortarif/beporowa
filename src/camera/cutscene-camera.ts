/**
 * The camera work before a race: a low flight along the grid, a slow orbit around the rival's car,
 * then down behind the player. It moves the same camera the game uses, then hands it back.
 */

import { type PerspectiveCamera, Vector3 } from 'three';
import { RACE } from '../config/race-tuning';
import { smoothstep } from '../core/math';

export interface CutsceneAnchors {
  /** The player's car. */
  playerX: number;
  playerY: number;
  playerZ: number;
  /** Which way the grid faces. */
  fx: number;
  fz: number;
  /** The rival's car, when there is one. */
  rivalX: number;
  rivalY: number;
  rivalZ: number;
  hasRival: boolean;
}

type ShotKind = 'fly' | 'rival' | 'settle';

interface Shot {
  kind: ShotKind;
  seconds: number;
}

const fromPos = new Vector3();
const toPos = new Vector3();
const lookAt = new Vector3();

export class CutsceneCamera {
  active = false;
  /** Fires when the rival shot starts, so the words can begin. */
  onRivalShot: (() => void) | null = null;
  private readonly anchors: CutsceneAnchors = { playerX: 0, playerY: 0, playerZ: 0, fx: 0, fz: 1, rivalX: 0, rivalY: 0, rivalZ: 0, hasRival: false };
  private shots: Shot[] = [];
  private index = 0;
  private shotTime = 0;
  private reduceMotion = false;
  private onDone: (() => void) | null = null;

  setReduceMotion(value: boolean): void {
    this.reduceMotion = value;
  }

  /** Starts the camera work. */
  begin(anchors: CutsceneAnchors, onDone: () => void): void {
    Object.assign(this.anchors, anchors);
    this.onDone = onDone;
    const config = RACE.cutscene;
    this.shots = [{ kind: 'fly', seconds: config.flySeconds }];
    if (anchors.hasRival) this.shots.push({ kind: 'rival', seconds: config.rivalSeconds });
    this.shots.push({ kind: 'settle', seconds: config.settleSeconds });
    this.index = 0;
    this.shotTime = 0;
    this.active = true;
    if (this.shots[0].kind === 'rival') this.onRivalShot?.();
  }

  /** Jumps to the end. */
  skip(): void {
    if (!this.active) return;
    this.finish();
  }

  private finish(): void {
    this.active = false;
    const done = this.onDone;
    this.onDone = null;
    done?.();
  }

  /** The name of the shot being shown. */
  get shotName(): ShotKind | null {
    return this.active ? this.shots[this.index].kind : null;
  }

  /** Moves the camera for this frame. */
  update(dt: number, camera: PerspectiveCamera): void {
    if (!this.active) return;
    const shot = this.shots[this.index];
    this.shotTime += dt;
    const t = Math.min(1, this.shotTime / shot.seconds);
    const eased = this.reduceMotion ? 1 : smoothstep(0, 1, t);
    const a = this.anchors;
    const config = RACE.cutscene;
    // Left of the grid is (fz, -fx).
    const leftX = a.fz;
    const leftZ = -a.fx;
    let fov: number = config.wideFov;

    if (shot.kind === 'fly') {
      fromPos.set(a.playerX + a.fx * 70 + leftX * 6, a.playerY + 7, a.playerZ + a.fz * 70 + leftZ * 6);
      toPos.set(a.playerX + a.fx * 18 - leftX * 3, a.playerY + 1.5, a.playerZ + a.fz * 18 - leftZ * 3);
      camera.position.lerpVectors(fromPos, toPos, eased);
      lookAt.set(a.playerX, a.playerY + 0.6, a.playerZ);
    } else if (shot.kind === 'rival') {
      const angle = 2.2 + (this.reduceMotion ? 0 : this.shotTime * config.orbitSpeed);
      const radius = config.orbitRadius;
      // Angle zero is straight ahead of the car.
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      camera.position.set(a.rivalX + (a.fx * cos + leftX * sin) * radius, a.rivalY + config.orbitHeight, a.rivalZ + (a.fz * cos + leftZ * sin) * radius);
      lookAt.set(a.rivalX, a.rivalY + 0.35, a.rivalZ);
      fov = config.closeFov;
    } else {
      fromPos.set(a.playerX + leftX * 7 + a.fx * 2, a.playerY + 2.4, a.playerZ + leftZ * 7 + a.fz * 2);
      toPos.set(a.playerX - a.fx * 6, a.playerY + 1.7, a.playerZ - a.fz * 6);
      camera.position.lerpVectors(fromPos, toPos, eased);
      lookAt.set(a.playerX + a.fx * 6, a.playerY + 0.8, a.playerZ + a.fz * 6);
    }
    camera.lookAt(lookAt);
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    if (t >= 1) {
      this.index++;
      this.shotTime = 0;
      if (this.index >= this.shots.length) {
        this.finish();
      } else if (this.shots[this.index].kind === 'rival') {
        this.onRivalShot?.();
      }
    }
  }
}
