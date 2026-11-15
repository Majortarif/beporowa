/**
 * Rain as one draw call for the falling streaks and one for the splashes on the road. Every drop is
 * placed by the vertex shader, wrapped around the camera, so the CPU does nothing but pass a clock.
 */

import { AdditiveBlending, Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NormalBlending, PlaneGeometry, ShaderMaterial, Vector3, type Scene } from 'three';
import { ATMOSPHERE } from '../config/atmosphere';

function randomSeeds(count: number): Float32Array {
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  return seeds;
}

export class RainSystem {
  private readonly streaks: Mesh;
  private readonly splashes: Mesh;
  private readonly streakMaterial: ShaderMaterial;
  private readonly splashMaterial: ShaderMaterial;
  private clock = 0;
  private readonly fall = new Vector3();

  constructor(scene: Scene, count: number) {
    const config = ATMOSPHERE.rain;
    const quad = new PlaneGeometry(1, 1);
    const streakGeometry = new InstancedBufferGeometry();
    streakGeometry.index = quad.index;
    streakGeometry.setAttribute('position', quad.getAttribute('position'));
    streakGeometry.setAttribute('uv', quad.getAttribute('uv'));
    streakGeometry.setAttribute('iSeed', new InstancedBufferAttribute(randomSeeds(count), 3));
    streakGeometry.instanceCount = count;
    this.streakMaterial = new ShaderMaterial({
      uniforms: {
        uCentre: { value: new Vector3() },
        uFall: { value: new Vector3(0, -config.fallSpeed, 0) },
        uClock: { value: 0 },
        uBox: { value: config.boxSize },
        uLength: { value: config.streakLength },
        uWidth: { value: config.width },
        uAlpha: { value: 0 },
        uColour: { value: new Color(0.62, 0.68, 0.74) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iSeed;
        uniform vec3 uCentre;
        uniform vec3 uFall;
        uniform float uClock;
        uniform float uBox;
        uniform float uLength;
        uniform float uWidth;
        varying float vFade;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // Every drop falls through a box that follows the camera, wrapping at the edges.
          vec3 moved = iSeed * uBox + uFall * uClock * (0.8 + iSeed.y * 0.4);
          vec3 inBox = mod(moved - uCentre, uBox) - uBox * 0.5;
          vec3 world = uCentre + inBox;
          vec3 direction = normalize(uFall);
          vec3 toCamera = normalize(cameraPosition - world);
          vec3 side = normalize(cross(direction, toCamera));
          float distanceToEdge = 1.0 - length(inBox) / (uBox * 0.62);
          vFade = clamp(distanceToEdge * 3.0, 0.0, 1.0);
          world += direction * position.y * uLength + side * position.x * uWidth;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        uniform vec3 uColour;
        varying float vFade;
        varying vec2 vUv;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float along = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
          gl_FragColor = vec4(uColour, across * along * vFade * uAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
    });
    this.streaks = new Mesh(streakGeometry, this.streakMaterial);
    this.streaks.frustumCulled = false;
    this.streaks.renderOrder = 8;
    this.streaks.visible = false;
    scene.add(this.streaks);

    const splashCount = Math.round(count * 0.32);
    const splashGeometry = new InstancedBufferGeometry();
    splashGeometry.index = quad.index;
    splashGeometry.setAttribute('position', quad.getAttribute('position'));
    splashGeometry.setAttribute('uv', quad.getAttribute('uv'));
    splashGeometry.setAttribute('iSeed', new InstancedBufferAttribute(randomSeeds(splashCount), 3));
    splashGeometry.instanceCount = splashCount;
    this.splashMaterial = new ShaderMaterial({
      uniforms: {
        uCentre: { value: new Vector3() },
        uClock: { value: 0 },
        uBox: { value: 26 },
        uAlpha: { value: 0 },
        uGround: { value: 0 },
        uColour: { value: new Color(0.7, 0.76, 0.82) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iSeed;
        uniform vec3 uCentre;
        uniform float uClock;
        uniform float uBox;
        uniform float uGround;
        varying float vLife;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          float life = fract(uClock * (1.6 + iSeed.z * 1.8) + iSeed.z * 13.0);
          vLife = life;
          // A new spot each time round, so drops do not keep landing in the same place.
          float round = floor(uClock * (1.6 + iSeed.z * 1.8) + iSeed.z * 13.0);
          vec2 spot = fract(iSeed.xy + vec2(round * 0.37, round * 0.61));
          vec2 inBox = mod(spot * uBox - uCentre.xz, uBox) - uBox * 0.5;
          vec3 world = vec3(uCentre.x + inBox.x, uGround + 0.04, uCentre.z + inBox.y);
          float size = 0.08 + life * 0.26;
          world.x += position.x * size;
          world.z += position.y * size;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        uniform vec3 uColour;
        varying float vLife;
        varying vec2 vUv;
        void main() {
          float r = length(vUv - 0.5) * 2.0;
          float ring = smoothstep(0.45, 0.8, r) * (1.0 - smoothstep(0.8, 1.0, r));
          gl_FragColor = vec4(uColour, ring * (1.0 - vLife) * uAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: 2,
    });
    this.splashes = new Mesh(splashGeometry, this.splashMaterial);
    this.splashes.frustumCulled = false;
    this.splashes.renderOrder = 3;
    this.splashes.visible = false;
    scene.add(this.splashes);
  }

  /**
   * @param amount how hard it is raining, from 0 to 1
   * @param sheltered how far the camera is under a roof, from 0 to 1
   */
  update(dt: number, amount: number, sheltered: number, cameraPosition: Vector3, groundY: number, carVx: number, carVz: number, daylight: number): void {
    const visible = amount * (1 - sheltered);
    this.streaks.visible = visible > 0.01;
    this.splashes.visible = visible > 0.01;
    if (!this.streaks.visible) return;
    this.clock += dt;
    const config = ATMOSPHERE.rain;
    // Drops tilt toward you as you drive into them.
    this.fall.set(-carVx * 0.75, -config.fallSpeed, -carVz * 0.75);
    const streak = this.streakMaterial.uniforms;
    streak.uCentre.value.copy(cameraPosition);
    streak.uFall.value.copy(this.fall);
    streak.uClock.value = this.clock % 1000;
    streak.uAlpha.value = visible * (0.3 + daylight * 0.12);
    const splash = this.splashMaterial.uniforms;
    splash.uCentre.value.copy(cameraPosition);
    splash.uClock.value = this.clock % 1000;
    splash.uAlpha.value = visible * 0.5;
    splash.uGround.value = groundY;
  }
}
