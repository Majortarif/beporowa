/** Builds the road and its shoulders from the track path: visuals and colliders from one source. */

import { BufferAttribute, BufferGeometry, Mesh, MeshStandardMaterial, RepeatWrapping, type CanvasTexture } from 'three';
import { TUNING, type QualityPreset } from '../config/tuning';
import { createRng } from '../core/math';
import type { PhysicsWorld } from '../physics/physics-world';
import { PAINT, makeCanvas, toTexture } from '../render/painted-textures';
import { makeWet, type WetUniforms } from '../render/planar-reflection';
import { computeRoadGeometry } from './road-geometry';
import type { TrackPath } from './track-path';

/** Asphalt with worn lane paint. V repeats every 24 m, so patterns must wrap at the tile edge. */
function createRoadTextures(anisotropy: number): { color: CanvasTexture; roughness: CanvasTexture } {
  const width = 512;
  const height = 1024;
  const random = createRng(TUNING.world.seed);
  const { canvas: colorCanvas, ctx: color } = makeCanvas(width, height);
  const { canvas: roughCanvas, ctx: rough } = makeCanvas(width / 2, height / 2);

  color.fillStyle = '#1d1c1e';
  color.fillRect(0, 0, width, height);
  for (let i = 0; i < 22000; i++) {
    const shade = 18 + random() * 34;
    color.fillStyle = `rgba(${shade},${shade},${shade + 2},0.55)`;
    color.fillRect(random() * width, random() * height, 1 + random() * 2.2, 1 + random() * 2.2);
  }

  // Roughness: green channel. Low values are wet and mirror-like.
  const wet = TUNING.world.roadWetness;
  const baseRough = Math.round((1 - wet * 0.62) * 255);
  rough.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`;
  rough.fillRect(0, 0, width / 2, height / 2);
  for (let i = 0; i < 900; i++) {
    const value = baseRough + (random() - 0.5) * 70;
    rough.fillStyle = `rgba(${value},${value},${value},0.5)`;
    rough.fillRect(random() * (width / 2), random() * (height / 2), 2 + random() * 12, 2 + random() * 12);
  }

  // Tar stains and thin puddles with soft edges, kept inside the tile so nothing crosses the wrap.
  const softPatch = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radiusX: number,
    radiusY: number,
    rgb: string,
    alpha: number,
  ): void => {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(radiusX, radiusY);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, `rgba(${rgb},${alpha})`);
    gradient.addColorStop(0.55, `rgba(${rgb},${alpha * 0.7})`);
    gradient.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  };
  for (let i = 0; i < 26; i++) {
    const radiusX = 14 + random() * 52;
    const radiusY = 30 + random() * 120;
    const px = radiusX + random() * (width - radiusX * 2);
    const py = radiusY + random() * (height - radiusY * 2);
    softPatch(color, px, py, radiusX, radiusY, '10,10,12', 0.26);
    if (i % 2 === 0) {
      const puddle = Math.round((1 - wet) * 90);
      softPatch(rough, px / 2, py / 2, radiusX / 2.4, radiusY / 2.4, `${puddle},${puddle},${puddle}`, 0.7);
    }
  }

  // Worn lane paint. The road is 12 m wide with three lanes and yellow edges.
  const paintDash = (x: number, y: number, w: number, h: number, paint: string): void => {
    color.fillStyle = paint;
    color.fillRect(x, y, w, h);
    color.fillStyle = 'rgba(29,28,30,0.33)';
    for (let i = 0; i < h / 7; i++) {
      color.fillRect(x + random() * w, y + random() * h, 1 + random() * 3, 2 + random() * 9);
    }
    rough.fillStyle = 'rgb(120,120,120)';
    rough.fillRect(x / 2, y / 2, w / 2, h / 2);
  };
  const lineWidth = 9;
  for (const edge of [14, width - 14 - lineWidth]) paintDash(edge, 0, lineWidth, height, PAINT.marigold);
  for (const lane of [width / 3, (width * 2) / 3]) {
    for (let y = 0; y < height; y += height / 2) {
      paintDash(lane - lineWidth / 2, y + height * 0.06, lineWidth, height * 0.24, '#d8d2c0');
    }
  }

  const colorTexture = toTexture(colorCanvas, anisotropy, true);
  const roughTexture = toTexture(roughCanvas, anisotropy, true);
  roughTexture.colorSpace = '';
  roughTexture.wrapS = RepeatWrapping;
  return { color: colorTexture, roughness: roughTexture };
}

/** Packed earth for the shoulders. */
function createDirtTexture(anisotropy: number): CanvasTexture {
  const size = 256;
  const random = createRng(TUNING.world.seed + 1);
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = '#2a2018';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 5000; i++) {
    const shade = random();
    ctx.fillStyle = `rgba(${28 + shade * 40},${22 + shade * 26},${14 + shade * 16},0.6)`;
    ctx.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 3);
  }
  return toTexture(canvas, anisotropy, true);
}

export interface RoadBuild {
  road: Mesh;
  shoulders: Mesh;
  dirtTexture: CanvasTexture;
  roadMaterial: MeshStandardMaterial;
}

export function buildRoad(
  track: TrackPath,
  physics: PhysicsWorld,
  preset: QualityPreset,
  wetUniforms: WetUniforms | null,
): RoadBuild {
  const { roadPositions, roadUvs, roadIndices, shoulderPositions, shoulderUvs, shoulderIndices } = computeRoadGeometry(track);

  physics.addFixedTrimesh(roadPositions, roadIndices, 'road');
  physics.addFixedTrimesh(shoulderPositions, shoulderIndices, 'shoulder');

  const textures = createRoadTextures(preset.anisotropy);
  const roadMaterial = new MeshStandardMaterial({
    map: textures.color,
    roughnessMap: textures.roughness,
    roughness: 1,
    metalness: 0,
    envMapIntensity: 1.1,
  });
  if (wetUniforms) makeWet(roadMaterial, wetUniforms);

  const roadGeometry = new BufferGeometry();
  roadGeometry.setAttribute('position', new BufferAttribute(roadPositions, 3));
  roadGeometry.setAttribute('uv', new BufferAttribute(roadUvs, 2));
  roadGeometry.setIndex(new BufferAttribute(roadIndices, 1));
  roadGeometry.computeVertexNormals();
  const road = new Mesh(roadGeometry, roadMaterial);
  road.receiveShadow = preset.shadows;
  road.frustumCulled = false;

  const dirtTexture = createDirtTexture(preset.anisotropy);
  const shoulderGeometry = new BufferGeometry();
  shoulderGeometry.setAttribute('position', new BufferAttribute(shoulderPositions, 3));
  shoulderGeometry.setAttribute('uv', new BufferAttribute(shoulderUvs, 2));
  shoulderGeometry.setIndex(new BufferAttribute(shoulderIndices, 1));
  shoulderGeometry.computeVertexNormals();
  const shoulders = new Mesh(
    shoulderGeometry,
    new MeshStandardMaterial({ map: dirtTexture, roughness: 0.96, metalness: 0 }),
  );
  shoulders.frustumCulled = false;
  shoulders.receiveShadow = preset.shadows;

  return { road, shoulders, dirtTexture, roadMaterial };
}
