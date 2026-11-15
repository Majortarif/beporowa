/**
 * Builds low-poly models from primitives with per-part colour, baked glow and optional art UVs.
 * Everything merges into one geometry, so a whole vehicle or stall is one draw call.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type MeshStandardMaterial,
} from 'three';
import { ATMOS } from './atmosphere-uniforms';

export type UvRect = readonly [number, number, number, number];

export interface PartOptions {
  /** Colour added on top of lighting, can exceed 1 to bloom. */
  glow?: readonly [number, number, number];
  /** Maps the part's 0..1 UV into this rectangle of an atlas. */
  uv?: UvRect;
  rotX?: number;
  rotY?: number;
  rotZ?: number;
}

const scratchColor = new Color();
const scratchMatrix = new Matrix4();
const scratchEuler = new Euler();
const scratchQuaternion = new Quaternion();
const scratchPosition = new Vector3();
const UNIT_SCALE = new Vector3(1, 1, 1);

/** UV for parts that take only their vertex colour. Point it at a white area of any atlas. */
export const PLAIN_UV: UvRect = [0.002, 0.002, 0.004, 0.004];

export class ModelBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];
  private readonly glows: number[] = [];

  /** Adds any geometry at a position with the given options. */
  add(geometry: BufferGeometry, color: number, x: number, y: number, z: number, options: PartOptions = {}): this {
    scratchEuler.set(options.rotX ?? 0, options.rotY ?? 0, options.rotZ ?? 0);
    scratchQuaternion.setFromEuler(scratchEuler);
    scratchPosition.set(x, y, z);
    scratchMatrix.compose(scratchPosition, scratchQuaternion, UNIT_SCALE);
    const source = geometry.index ? geometry.toNonIndexed() : geometry;
    source.applyMatrix4(scratchMatrix);

    const position = source.getAttribute('position');
    const normal = source.getAttribute('normal');
    const uv = source.getAttribute('uv');
    scratchColor.setHex(color);
    const glow = options.glow ?? [0, 0, 0];
    const rect = options.uv ?? PLAIN_UV;
    for (let i = 0; i < position.count; i++) {
      this.positions.push(position.getX(i), position.getY(i), position.getZ(i));
      this.normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      this.uvs.push(rect[0] + (rect[2] - rect[0]) * uv.getX(i), rect[1] + (rect[3] - rect[1]) * uv.getY(i));
      this.colors.push(scratchColor.r, scratchColor.g, scratchColor.b);
      this.glows.push(glow[0], glow[1], glow[2]);
    }
    return this;
  }

  box(width: number, height: number, depth: number, x: number, y: number, z: number, color: number, options?: PartOptions): this {
    return this.add(new BoxGeometry(width, height, depth), color, x, y, z, options);
  }

  /** A flat painted panel. It faces +Z before rotation. */
  panel(width: number, height: number, x: number, y: number, z: number, color: number, options?: PartOptions): this {
    return this.add(new PlaneGeometry(width, height), color, x, y, z, options);
  }

  /** A wheel-like cylinder with its axis along X. */
  cylinderX(radius: number, width: number, x: number, y: number, z: number, color: number, segments = 10, options: PartOptions = {}): this {
    return this.add(new CylinderGeometry(radius, radius, width, segments), color, x, y, z, { ...options, rotZ: Math.PI / 2 });
  }

  /** An upright cylinder. */
  cylinderY(radius: number, height: number, x: number, y: number, z: number, color: number, segments = 8, options?: PartOptions): this {
    return this.add(new CylinderGeometry(radius, radius, height, segments), color, x, y, z, options);
  }

  cone(radius: number, height: number, x: number, y: number, z: number, color: number, segments = 8, options?: PartOptions): this {
    return this.add(new ConeGeometry(radius, height, segments), color, x, y, z, options);
  }

  get isEmpty(): boolean {
    return this.positions.length === 0;
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(this.positions), 3));
    geometry.setAttribute('normal', new BufferAttribute(new Float32Array(this.normals), 3));
    geometry.setAttribute('uv', new BufferAttribute(new Float32Array(this.uvs), 2));
    geometry.setAttribute('color', new BufferAttribute(new Float32Array(this.colors), 3));
    geometry.setAttribute('aGlow', new BufferAttribute(new Float32Array(this.glows), 3));
    return geometry;
  }
}

/** The same, for painted boards: the glow takes the paint's colour, so the art stays readable at night. */
export function useSelfLitGlow<T extends MeshStandardMaterial>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aGlow;
        varying vec3 vGlow;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlow = aGlow;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGlow;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow * diffuseColor.rgb * uSelfGlow;`,
      )
      .replace(
        'varying vec3 vGlow;',
        `varying vec3 vGlow;
        uniform float uSelfGlow;`,
      );
    shader.uniforms.uSelfGlow = ATMOS.uSelfGlow;
  };
  return material;
}

/** Teaches a MeshStandardMaterial to add the model's baked glow, so lamps need no extra draw call. */
export function useBakedGlow<T extends MeshStandardMaterial>(material: T): T {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aGlow;
        varying vec3 vGlow;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        vGlow = aGlow;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vGlow;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += vGlow * uBakedGlow;`,
      )
      .replace(
        'varying vec3 vGlow;',
        `varying vec3 vGlow;
        uniform float uBakedGlow;`,
      );
    shader.uniforms.uBakedGlow = ATMOS.uBakedGlow;
  };
  return material;
}

