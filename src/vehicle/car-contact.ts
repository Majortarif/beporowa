/** Separating-axis test between two cars' footprints on the ground. */

export interface CarFootprint {
  x: number;
  z: number;
  fx: number;
  fz: number;
}

const HALF_LENGTH = 2.05;
const HALF_WIDTH = 0.95;

export function carsTouch(a: CarFootprint, b: CarFootprint): boolean {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  const axes = [b.fx, b.fz, b.fz, -b.fx, a.fx, a.fz, a.fz, -a.fx];
  for (let i = 0; i < 8; i += 2) {
    const nx = axes[i];
    const nz = axes[i + 1];
    const distance = Math.abs(dx * nx + dz * nz);
    const extentB = HALF_LENGTH * Math.abs(b.fx * nx + b.fz * nz) + HALF_WIDTH * Math.abs(b.fz * nx - b.fx * nz);
    const extentA = HALF_LENGTH * Math.abs(a.fx * nx + a.fz * nz) + HALF_WIDTH * Math.abs(a.fz * nx - a.fx * nz);
    if (distance > extentA + extentB) return false;
  }
  return true;
}
