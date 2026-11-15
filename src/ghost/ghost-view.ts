/**
 * Draws a car that is not really there: a ghost from an earlier run, or a friend's car sent over
 * the network. Neither has a body in the physics world, so nothing can be hit or pushed by it.
 */

import { AdditiveBlending, Color, Mesh, MeshBasicMaterial, type Material, type Scene } from 'three';
import { CAR_BY_ID, type LiveryDef } from '../config/cars';
import { GHOST } from '../config/extras';
import type { QualityPreset } from '../config/tuning';
import { createCarVisual, type CarVisual } from '../vehicle/car-models';

export type CarViewLook = 'ghost' | 'solid';

const WHEEL_RADIUS = 0.33;

export class GhostCarView {
  readonly visual: CarVisual;
  private readonly ghostMaterial: MeshBasicMaterial | null = null;
  private lastX = 0;
  private lastZ = 0;
  private wheelAngle = 0;
  private placed = false;

  constructor(
    private readonly scene: Scene,
    carId: string,
    preset: QualityPreset,
    readonly look: CarViewLook,
    livery?: LiveryDef,
    colour: string = GHOST.colour,
  ) {
    const car = CAR_BY_ID.get(carId) ?? CAR_BY_ID.get('bulbuli');
    if (!car) throw new Error('No car to draw');
    this.visual = createCarVisual(car, livery ?? car.livery, preset);
    const visual = this.visual;
    visual.blobShadow.visible = look === 'solid';
    visual.underglow.visible = false;
    for (const flame of visual.flames) {
      flame.outer.visible = false;
      flame.inner.visible = false;
    }
    if (look === 'ghost') {
      // One see-through glow for the whole car: it reads as "not really there" at a glance.
      this.ghostMaterial = new MeshBasicMaterial({
        color: new Color(colour),
        transparent: true,
        opacity: GHOST.opacity,
        depthWrite: false,
        blending: AdditiveBlending,
      });
      const ghost = this.ghostMaterial;
      visual.root.traverse((object) => {
        if (object instanceof Mesh && object !== visual.blobShadow && object !== visual.underglow) {
          object.material = ghost as Material;
          object.castShadow = false;
          object.renderOrder = 5;
        }
      });
    }
    visual.root.visible = false;
    scene.add(visual.root);
  }

  setVisible(visible: boolean): void {
    this.visual.root.visible = visible;
    if (!visible) this.placed = false;
  }

  /** Puts the car where it is now, rolling its wheels by how far it went. */
  setPose(x: number, y: number, z: number, qx: number, qy: number, qz: number, qw: number): void {
    const root = this.visual.root;
    root.position.set(x, y, z);
    root.quaternion.set(qx, qy, qz, qw);
    if (this.placed) {
      // Forward is +Z in the car's frame.
      const fx = 2 * (qx * qz + qw * qy);
      const fz = 1 - 2 * (qx * qx + qy * qy);
      const moved = (x - this.lastX) * fx + (z - this.lastZ) * fz;
      if (Math.abs(moved) < 20) this.wheelAngle += moved / WHEEL_RADIUS;
    }
    this.placed = true;
    this.lastX = x;
    this.lastZ = z;
    for (const wheel of this.visual.wheels) wheel.spin.rotation.x = this.wheelAngle;
  }

  /** Fades a ghost as the camera comes close, so it never hides the road ahead. */
  setNearness(distance: number): void {
    if (!this.ghostMaterial) return;
    const share = Math.min(1, Math.max(0, (distance - GHOST.fadeNear) / (GHOST.fadeFar - GHOST.fadeNear)));
    this.ghostMaterial.opacity = GHOST.nearOpacity + (GHOST.opacity - GHOST.nearOpacity) * share;
  }

  dispose(): void {
    this.scene.remove(this.visual.root);
    this.visual.dispose();
    this.ghostMaterial?.dispose();
  }
}
