/** Draws the traps and their falling pieces, with one instanced mesh per piece shape. */

import { CylinderGeometry, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3, type BufferGeometry, type Scene } from 'three';
import { ModelBuilder, useBakedGlow } from '../render/model-builder';
import { PIECE_SIZE, type PieceShape, type TrapSystem } from './trap-system';

const position = new Vector3();
const quaternion = new Quaternion();
const scale = new Vector3();
const matrix = new Matrix4();

function poleGeometry(): BufferGeometry {
  // Knots along the bamboo, so it does not read as a pipe.
  const builder = new ModelBuilder();
  builder.add(new CylinderGeometry(PIECE_SIZE.POLE_RADIUS, PIECE_SIZE.POLE_RADIUS * 1.15, PIECE_SIZE.POLE_LENGTH, 6), 0xb79a55, 0, 0, 0);
  for (const y of [-2, -0.7, 0.6, 1.9]) {
    builder.add(new CylinderGeometry(PIECE_SIZE.POLE_RADIUS * 1.22, PIECE_SIZE.POLE_RADIUS * 1.22, 0.05, 6), 0x7d6431, 0, y, 0);
  }
  return builder.build();
}

function drumGeometry(): BufferGeometry {
  const builder = new ModelBuilder();
  const { DRUM_RADIUS: r, DRUM_HEIGHT: h } = PIECE_SIZE;
  builder.add(new CylinderGeometry(r, r, h, 12), 0x1f6f78, 0, 0, 0);
  builder.add(new CylinderGeometry(r * 1.03, r * 1.03, 0.05, 12), 0x113f45, 0, h * 0.2, 0);
  builder.add(new CylinderGeometry(r * 1.03, r * 1.03, 0.05, 12), 0x113f45, 0, -h * 0.2, 0);
  builder.add(new CylinderGeometry(r * 1.01, r * 1.01, h * 0.22, 12), 0xd8402b, 0, 0, 0);
  return builder.build();
}

function tankGeometry(): BufferGeometry {
  const builder = new ModelBuilder();
  const { TANK_RADIUS: r, TANK_HEIGHT: h } = PIECE_SIZE;
  builder.add(new CylinderGeometry(r * 0.94, r, h, 14), 0x1c1d20, 0, 0, 0);
  builder.add(new CylinderGeometry(r * 0.3, r * 0.3, 0.14, 10), 0x2c2d31, 0, h / 2 + 0.07, 0);
  for (const y of [-h * 0.25, h * 0.15]) builder.add(new CylinderGeometry(r * 1.0, r * 1.0, 0.06, 14), 0x2a2b2f, 0, y, 0);
  return builder.build();
}

export class TrapRender {
  private readonly meshes: Record<PieceShape, InstancedMesh>;
  private readonly counts: Record<PieceShape, number> = { pole: 0, drum: 0, tank: 0 };
  private revision = -1;
  private hadDebris = false;

  constructor(scene: Scene, private readonly system: TrapSystem) {
    const capacity: Record<PieceShape, number> = { pole: 0, drum: 0, tank: 0 };
    for (const trap of system.traps) for (const piece of trap.pieces) capacity[piece.shape]++;
    for (const piece of system.debris) capacity[piece.shape]++;
    const material = useBakedGlow(new MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.06 }));
    const make = (geometry: BufferGeometry, shape: PieceShape): InstancedMesh => {
      const mesh = new InstancedMesh(geometry, material, Math.max(1, capacity[shape]));
      mesh.frustumCulled = false;
      mesh.count = 0;
      scene.add(mesh);
      return mesh;
    };
    this.meshes = { pole: make(poleGeometry(), 'pole'), drum: make(drumGeometry(), 'drum'), tank: make(tankGeometry(), 'tank') };
  }

  update(): void {
    const system = this.system;
    const hasDebris = system.debris.some((piece) => piece.active);
    if (!hasDebris && !this.hadDebris && this.revision === system.revision) return;
    this.hadDebris = hasDebris;
    this.revision = system.revision;
    const counts = this.counts;
    counts.pole = 0;
    counts.drum = 0;
    counts.tank = 0;

    for (const trap of system.traps) {
      if (!trap.armed) continue;
      for (const piece of trap.pieces) {
        position.set(piece.x, piece.y, piece.z);
        quaternion.set(piece.qx, piece.qy, piece.qz, piece.qw);
        scale.setScalar(1);
        matrix.compose(position, quaternion, scale);
        this.meshes[piece.shape].setMatrixAt(counts[piece.shape]++, matrix);
      }
    }
    for (const piece of system.debris) {
      if (!piece.active) continue;
      const t = piece.body.translation();
      const r = piece.body.rotation();
      position.set(t.x, t.y, t.z);
      quaternion.set(r.x, r.y, r.z, r.w);
      // Shrinks away in its last moments rather than vanishing all at once.
      scale.setScalar(Math.min(1, piece.life * 2.5));
      matrix.compose(position, quaternion, scale);
      this.meshes[piece.shape].setMatrixAt(counts[piece.shape]++, matrix);
    }
    for (const shape of ['pole', 'drum', 'tank'] as const) {
      const mesh = this.meshes[shape];
      mesh.count = counts[shape];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
