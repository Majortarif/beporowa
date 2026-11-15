/**
 * The last look at every frame: colour grading for the hour and the weather, a flash of lightning,
 * a shimmer over a hot road, the sun's lens flare, film grain, and the looks in photo mode.
 */

import { Effect } from 'postprocessing';
import { Uniform, Vector3 } from 'three';

const FRAGMENT = /* glsl */ `
uniform vec3 uTint;
uniform float uSaturation;
uniform float uContrast;
uniform float uFlash;
uniform float uGrain;
uniform float uHaze;
uniform float uHorizon;
uniform float uClock;
uniform float uAspect;
uniform vec3 uFlare;
uniform float uSepia;

void mainUv(inout vec2 uv) {
  if (uHaze > 0.001) {
    // Hot air bends the light just over the road, below where it meets the distance.
    float band = smoothstep(uHorizon - 0.03, uHorizon - 0.1, uv.y) * smoothstep(uHorizon - 0.34, uHorizon - 0.14, uv.y);
    uv.x += sin(uv.y * 190.0 + uClock * 6.5) * 0.0009 * uHaze * band;
    uv.y += sin(uv.x * 160.0 + uClock * 4.5) * 0.0005 * uHaze * band;
  }
}

float flareSpot(vec2 uv, vec2 centre, float radius) {
  vec2 d = (uv - centre) * vec2(uAspect, 1.0);
  return smoothstep(radius, radius * 0.25, length(d));
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 color = inputColor.rgb;

  if (uFlare.z > 0.001) {
    vec2 sun = uFlare.xy;
    vec2 d = (uv - sun) * vec2(uAspect, 1.0);
    float glow = pow(max(0.0, 1.0 - length(d) * 1.35), 5.0);
    float streak = exp(-abs(d.y) * 48.0) * pow(max(0.0, 1.0 - abs(d.x) * 0.9), 3.0);
    vec3 flare = vec3(1.0, 0.86, 0.62) * (glow * 0.85 + streak * 0.28);
    // Ghosts on the far side of the middle of the picture.
    vec2 axis = vec2(0.5) - sun;
    flare += vec3(0.32, 0.5, 0.7) * flareSpot(uv, sun + axis * 1.45, 0.07) * 0.2;
    flare += vec3(0.75, 0.42, 0.2) * flareSpot(uv, sun + axis * 1.85, 0.12) * 0.13;
    flare += vec3(0.4, 0.72, 0.5) * flareSpot(uv, sun + axis * 0.62, 0.04) * 0.2;
    color += flare * uFlare.z;
  }

  color *= uTint;
  float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(grey), color, uSaturation);
  if (uSepia > 0.001) color = mix(color, grey * vec3(1.12, 0.96, 0.72), uSepia);
  color = (color - 0.5) * uContrast + 0.5;
  color += vec3(0.62, 0.7, 0.9) * uFlash;

  if (uGrain > 0.001) {
    float noise = fract(sin(dot(uv * (uClock + 3.1), vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) * uGrain;
  }
  outputColor = vec4(color, inputColor.a);
}
`;

export class AtmosphereEffect extends Effect {
  constructor() {
    super('AtmosphereEffect', FRAGMENT, {
      uniforms: new Map<string, Uniform>([
        ['uTint', new Uniform(new Vector3(1, 1, 1))],
        ['uSaturation', new Uniform(1)],
        ['uContrast', new Uniform(1)],
        ['uFlash', new Uniform(0)],
        ['uGrain', new Uniform(0)],
        ['uHaze', new Uniform(0)],
        ['uHorizon', new Uniform(0.5)],
        ['uClock', new Uniform(0)],
        ['uAspect', new Uniform(1.7)],
        ['uFlare', new Uniform(new Vector3())],
        ['uSepia', new Uniform(0)],
      ]),
    });
  }

  private value(name: string): Uniform {
    return this.uniforms.get(name) as Uniform;
  }

  setGrade(r: number, g: number, b: number, saturation: number, contrast: number, sepia: number): void {
    (this.value('uTint').value as Vector3).set(r, g, b);
    this.value('uSaturation').value = saturation;
    this.value('uContrast').value = contrast;
    this.value('uSepia').value = sepia;
  }

  setMoment(clock: number, flash: number, haze: number, horizon: number, grain: number, aspect: number): void {
    this.value('uClock').value = clock;
    this.value('uFlash').value = flash;
    this.value('uHaze').value = haze;
    this.value('uHorizon').value = horizon;
    this.value('uGrain').value = grain;
    this.value('uAspect').value = aspect;
  }

  setFlare(x: number, y: number, strength: number): void {
    (this.value('uFlare').value as Vector3).set(x, y, strength);
  }
}
