/** Crows wheeling over the rooftops by day, dark against the sky. One draw call, moved by the shader. */

import { BufferAttribute, Color, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, ShaderMaterial, Vector3, type Scene } from 'three';

const BIRDS = 26;

export class BirdFlock {
  private readonly mesh: Mesh;
  private readonly material: ShaderMaterial;
  private clock = 0;

  constructor(scene: Scene) {
    // Two triangles sharing the body, flapped from the middle by the vertex shader.
    const geometry = new InstancedBufferGeometry();
    const positions = new Float32Array([0, 0, 0.32, -0.75, 0, 0, 0, 0, -0.32, 0, 0, 0.32, 0.75, 0, 0, 0, 0, -0.32]);
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const seeds = new Float32Array(BIRDS * 3);
    for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
    geometry.setAttribute('iSeed', new InstancedBufferAttribute(seeds, 3));
    geometry.instanceCount = BIRDS;
    this.material = new ShaderMaterial({
      uniforms: {
        uCentre: { value: new Vector3() },
        uClock: { value: 0 },
        uColour: { value: new Color(0x14161a) },
        uAlpha: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iSeed;
        uniform vec3 uCentre;
        uniform float uClock;
        void main() {
          float angle = uClock * (0.1 + iSeed.x * 0.09) + iSeed.y * 6.28;
          float radius = 26.0 + iSeed.z * 34.0;
          vec3 at = vec3(cos(angle) * radius, 34.0 + iSeed.x * 16.0 + sin(angle * 2.0) * 3.0, sin(angle) * radius);
          // Each bird faces along its circle, and beats its wings.
          float heading = -angle;
          float flap = sin(uClock * (8.0 + iSeed.z * 4.0) + iSeed.y * 30.0) * abs(position.x) * 0.55;
          vec3 local = vec3(position.x, flap, position.z);
          vec3 world = vec3(local.x * cos(heading) + local.z * sin(heading), local.y, -local.x * sin(heading) + local.z * cos(heading));
          gl_Position = projectionMatrix * viewMatrix * vec4(uCentre + at + world * 1.1, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColour;
        uniform float uAlpha;
        void main() {
          gl_FragColor = vec4(uColour, uAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      side: 2,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /** @param amount how many are up, from 0 to 1. They stay in out of the rain and the dark. */
  update(dt: number, amount: number, centreX: number, centreZ: number): void {
    this.mesh.visible = amount > 0.02;
    if (!this.mesh.visible) return;
    this.clock += dt;
    const uniforms = this.material.uniforms;
    uniforms.uClock.value = this.clock;
    uniforms.uAlpha.value = amount;
    uniforms.uCentre.value.set(centreX, 0, centreZ);
  }
}
