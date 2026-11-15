/**
 * Banks of mist drifting past the camera, for foggy mornings and heavy rain. True volumetric fog is
 * too heavy for a mid-range laptop in a browser, so this is soft layered sheets: one draw call.
 */

import { Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, PlaneGeometry, ShaderMaterial, Vector3, type Scene } from 'three';
import { ATMOSPHERE } from '../config/atmosphere';

export class MistBanks {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private clock = 0;

  constructor(scene: Scene, count: number) {
    const quad = new PlaneGeometry(1, 1);
    const geometry = new InstancedBufferGeometry();
    geometry.index = quad.index;
    geometry.setAttribute('position', quad.getAttribute('position'));
    geometry.setAttribute('uv', quad.getAttribute('uv'));
    const seeds = new Float32Array(count * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    geometry.setAttribute('iSeed', new InstancedBufferAttribute(seeds, 3));
    geometry.instanceCount = count;
    this.material = new ShaderMaterial({
      uniforms: {
        uCentre: { value: new Vector3() },
        uClock: { value: 0 },
        uBox: { value: ATMOSPHERE.mist.boxSize },
        uSize: { value: ATMOSPHERE.mist.size },
        uGround: { value: 0 },
        uAlpha: { value: 0 },
        uColour: { value: new Color() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iSeed;
        uniform vec3 uCentre;
        uniform float uClock;
        uniform float uBox;
        uniform float uSize;
        uniform float uGround;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        void main() {
          vUv = uv;
          vSeed = iSeed.z;
          // Slowly on the wind, wrapped around the camera.
          vec2 moved = iSeed.xy * uBox + vec2(uClock * (0.7 + iSeed.z), uClock * 0.3);
          vec2 inBox = mod(moved - uCentre.xz, uBox) - uBox * 0.5;
          vec3 world = vec3(uCentre.x + inBox.x, uGround + 3.5 + iSeed.z * 5.0, uCentre.z + inBox.y);
          vec4 view = viewMatrix * vec4(world, 1.0);
          float size = uSize * (0.7 + iSeed.y * 0.7);
          view.xy += position.xy * vec2(size, size * 0.42);
          float distanceToCamera = length(view.xyz);
          // Thins out close up, so you drive through it rather than into a wall.
          vFade = smoothstep(4.0, 26.0, distanceToCamera) * (1.0 - smoothstep(uBox * 0.34, uBox * 0.5, length(inBox)));
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAlpha;
        uniform vec3 uColour;
        varying vec2 vUv;
        varying float vFade;
        varying float vSeed;
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          float soft = max(0.0, 1.0 - dot(p, p));
          soft = soft * soft;
          // Two slow ripples break up what would otherwise be a clean oval.
          soft *= 0.72 + 0.28 * sin(p.x * 5.0 + vSeed * 20.0) * sin(p.y * 7.0 + vSeed * 9.0);
          gl_FragColor = vec4(uColour, soft * vFade * uAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt: number, amount: number, cameraPosition: Vector3, groundY: number, colour: Color): void {
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    this.clock += dt;
    const uniforms = this.material.uniforms;
    uniforms.uCentre.value.copy(cameraPosition);
    uniforms.uClock.value = this.clock % 3000;
    uniforms.uGround.value = groundY;
    uniforms.uAlpha.value = amount * 0.2;
    uniforms.uColour.value.copy(colour);
  }
}
