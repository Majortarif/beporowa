/**
 * Numbers that every weather-aware shader in the world shares. Changing a value here changes the
 * whole city at once, with no per-material work. It starts as the original night, so anything
 * built without a sky to drive it, like the test road, looks exactly as it always did.
 */

import { Color, Vector4 } from 'three';
import { TUNING } from '../config/tuning';

export const ATMOS = {
  uTime: { value: 0 },
  /** 1 is soaked and 0 is bone dry. */
  uWetness: { value: TUNING.world.roadWetness },
  uRain: { value: 0 },
  uPuddles: { value: 0 },
  /** Glow built into models: tubes and small lamps. */
  uBakedGlow: { value: 1 },
  /** Glow on hand-painted boards. */
  uSelfGlow: { value: 1 },
  uLampGlow: { value: 1 },
  uFogColor: { value: new Color(TUNING.world.colors.fog) },
  uFogDensity: { value: TUNING.world.fogDensity },
  /** How strongly the world's flat-lit things are lit: people, water and so on. */
  uAmbient: { value: 1 },
  uAmbientColor: { value: new Color(0xffffff) },
  /** x, z, radius, and whether the power is out at all. */
  uBlackout: { value: new Vector4(0, 0, 0, 0) },
  uFlood: { value: 0 },
  uMist: { value: 0 },
  uFlash: { value: 0 },
};

/** Registers materials whose brightness follows the hour, without any of them needing a shader. */
export const GLOW_REGISTRY = {
  windows: [] as Array<{ emissiveIntensity: number }>,
  /** Painted boards drawn unlit, tinted by a colour that is scaled from here. */
  boards: [] as Array<{ color: Color; base: Color }>,
  ground: [] as Array<{ roughness: number; color: Color; base: Color; baseRoughness: number }>,
};

/** The GLSL that decides whether the power is on at a point in the world. */
export const BLACKOUT_GLSL = /* glsl */ `
  float powerAt(vec2 worldXZ, vec4 blackout) {
    if (blackout.w < 0.5) return 1.0;
    return smoothstep(blackout.z - 34.0, blackout.z, distance(worldXZ, blackout.xy));
  }`;
