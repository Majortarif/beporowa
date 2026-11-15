/** Collects textured quads into one mesh, so hundreds of painted boards cost one draw call. */

import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial, type Texture } from 'three';
import { GLOW_REGISTRY } from '../../render/atmosphere-uniforms';
import type { SignRect } from '../sign-atlas';

export class QuadBatch {
  private readonly positions: number[] = [];
  private readonly uvs: number[] = [];
  private readonly indices: number[] = [];

  /**
   * Adds an upright quad that faces along faceYaw (rotation about +Y; 0 faces +Z).
   * It reads correctly to someone looking at it from the front.
   */
  addUpright(rect: SignRect, x: number, y: number, z: number, faceYaw: number, width: number, height: number): void {
    // Looking at the face, its right-hand side is +X rotated by the yaw.
    const rightX = Math.cos(faceYaw);
    const rightZ = -Math.sin(faceYaw);
    const base = this.positions.length / 3;
    for (const [cx, cy, u, v] of [
      [-1, -1, rect.u0, rect.v0],
      [1, -1, rect.u1, rect.v0],
      [1, 1, rect.u1, rect.v1],
      [-1, 1, rect.u0, rect.v1],
    ] as const) {
      this.positions.push(x + (rightX * cx * width) / 2, y + (cy * height) / 2, z + (rightZ * cx * width) / 2);
      this.uvs.push(u, v);
    }
    this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  build(texture: Texture, brightness = 1.3): Mesh {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setIndex(this.indices);
    const material = new MeshBasicMaterial({ map: texture, color: new Color(brightness, brightness * 0.97, brightness * 0.9) });
    // Unlit paint, so its brightness has to follow the hour by hand.
    GLOW_REGISTRY.boards.push({ color: material.color, base: material.color.clone() });
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    return mesh;
  }
}
