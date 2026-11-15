/** Windows go dark wherever the power is out, by a test of distance in the shader. */

import type { MeshStandardMaterial } from 'three';
import { ATMOS, BLACKOUT_GLSL } from './atmosphere-uniforms';

export function applyBlackout(material: MeshStandardMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBlackout = ATMOS.uBlackout;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vPowerXZ;`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        vPowerXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec4 uBlackout;
        varying vec2 vPowerXZ;
        ${BLACKOUT_GLSL}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= powerAt(vPowerXZ, uBlackout);`,
      );
  };
}
