/**
 * Renderer, post-processing and dynamic resolution.
 * All of it sits behind this class, so a WebGPU path can replace it later.
 * Honest note: custom GLSL (wet road, particles) would still have to be ported to TSL then.
 */

import { BloomEffect, ChromaticAberrationEffect, DepthOfFieldEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';
import {
  ACESFilmicToneMapping,
  Color,
  HalfFloatType,
  NoToneMapping,
  PCFSoftShadowMap,
  PerspectiveCamera,
  SRGBColorSpace,
  Vector2,
  WebGLRenderer,
  type Scene,
} from 'three';
import { TUNING, type QualityPreset } from '../config/tuning';
import { clamp } from '../core/math';
import { AtmosphereEffect } from './atmosphere-effect';
import { PlanarReflection } from './planar-reflection';

export interface FrameStats {
  fps: number;
  drawCalls: number;
  triangles: number;
  resolutionScale: number;
}

export class RenderPipeline {
  readonly renderer: WebGLRenderer;
  readonly reflection: PlanarReflection | null;
  readonly stats: FrameStats = { fps: 0, drawCalls: 0, triangles: 0, resolutionScale: 1 };

  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
  private atmosphere: AtmosphereEffect | null = null;
  private dofPass: EffectPass | null = null;
  private dof: DepthOfFieldEffect | null = null;
  private readonly baseExposure: number = TUNING.render.toneMappingExposure;
  private chromatic: ChromaticAberrationEffect | null = null;
  private readonly chromaticOffset = new Vector2();
  private resolutionScale = 1;
  private accumulatedTime = 0;
  private accumulatedFrames = 0;
  private calmTime = 0;
  private probeWait = TUNING.render.dynamicProbeSeconds;
  private justProbed = false;
  private sizeDirty = false;
  private width = 1;
  private height = 1;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly camera: PerspectiveCamera,
    private readonly preset: QualityPreset,
  ) {
    const render = TUNING.render;
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: !preset.bloom,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color(TUNING.world.colors.fog));
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = preset.shadows;
    this.renderer.shadowMap.type = PCFSoftShadowMap;

    this.reflection =
      preset.reflectionScale > 0
        ? new PlanarReflection(preset.reflectionScale, preset.reflectionEveryNFrames, TUNING.world.reflectionStrength)
        : null;

    if (preset.bloom) {
      this.renderer.toneMapping = NoToneMapping;
      this.composer = new EffectComposer(this.renderer, {
        frameBufferType: HalfFloatType,
        multisampling: preset.multisampling,
      });
      this.composer.addPass(new RenderPass(scene, camera));
      const bloom = new BloomEffect({
        intensity: render.bloomIntensity,
        luminanceThreshold: render.bloomThreshold,
        luminanceSmoothing: render.bloomSmoothing,
        mipmapBlur: true,
        radius: render.bloomRadius,
      });
      const vignette = new VignetteEffect({ darkness: render.vignetteDarkness, offset: render.vignetteOffset });
      const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
      this.bloom = bloom;
      this.atmosphere = new AtmosphereEffect();
      this.composer.addPass(new EffectPass(camera, bloom, vignette, toneMapping, this.atmosphere));
      if (preset.chromaticAberration) {
        this.chromatic = new ChromaticAberrationEffect({
          offset: this.chromaticOffset,
          radialModulation: true,
          modulationOffset: 0.35,
        });
        this.composer.addPass(new EffectPass(camera, this.chromatic));
      }
    } else {
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = render.toneMappingExposure;
    }
  }

  /** Whether this preset can grade, blur or filter a picture at all. */
  get hasEffects(): boolean {
    return this.atmosphere !== null;
  }

  setClearColor(color: Color): void {
    this.renderer.setClearColor(color);
  }

  /** The look of the hour and the weather. */
  setAtmosphere(r: number, g: number, b: number, saturation: number, contrast: number, sepia: number, bloom: number, bloomThreshold: number): void {
    if (this.atmosphere) this.atmosphere.setGrade(r, g, b, saturation, contrast, sepia);
    if (this.bloom) {
      this.bloom.intensity = bloom * (TUNING.render.bloomIntensity / 0.85);
      this.bloom.luminanceMaterial.threshold = bloomThreshold;
    }
  }

  setAtmosphereMoment(clock: number, flash: number, haze: number, horizon: number, grain: number, aspect: number): void {
    this.atmosphere?.setMoment(clock, flash, haze, horizon, grain, aspect);
    // Without the effect, lightning can still brighten the whole frame.
    if (!this.atmosphere) this.renderer.toneMappingExposure = this.baseExposure + flash * 2;
  }

  setFlare(x: number, y: number, strength: number): void {
    this.atmosphere?.setFlare(x, y, strength);
  }

  /**
   * Depth of field for photo mode. Made the first time it is asked for, because it needs a depth
   * texture and nobody driving should pay for that.
   * @param focus distance to keep sharp, in metres
   * @param blur from 0, which turns it off, to 1
   */
  setPhotoFocus(focus: number, blur: number): void {
    if (!this.composer) return;
    if (blur <= 0.001) {
      if (this.dofPass) this.dofPass.enabled = false;
      return;
    }
    if (!this.dof) {
      this.dof = new DepthOfFieldEffect(this.camera, { worldFocusDistance: focus, worldFocusRange: 6, bokehScale: 3, height: 480 });
      this.dofPass = new EffectPass(this.camera, this.dof);
      this.composer.addPass(this.dofPass, 1);
      this.composer.setSize(this.width, this.height, false);
    }
    if (this.dofPass) this.dofPass.enabled = true;
    this.dof.cocMaterial.worldFocusDistance = focus;
    this.dof.cocMaterial.worldFocusRange = 2 + (1 - blur) * 14;
    this.dof.bokehScale = 1 + blur * 4;
  }

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.applySize();
  }

  private applySize(): void {
    const devicePixelRatio = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio);
    const pixelRatio = devicePixelRatio * this.resolutionScale;
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.composer?.setSize(this.width, this.height, false);
    this.reflection?.setSize(this.width * pixelRatio, this.height * pixelRatio);
  }

  /**
   * Lowers resolution before frame rate suffers. A vsynced game cannot report spare headroom,
   * so after a calm stretch it tries one step up, and backs off for longer if that step fails.
   */
  private updateDynamicResolution(frameDt: number): void {
    const render = TUNING.render;
    this.accumulatedTime += frameDt;
    this.accumulatedFrames++;
    if (this.accumulatedTime < render.dynamicCheckSeconds) return;
    const average = this.accumulatedTime / this.accumulatedFrames;
    this.stats.fps = 1 / average;
    const elapsed = this.accumulatedTime;
    this.accumulatedTime = 0;
    this.accumulatedFrames = 0;

    const budget = 1 / this.preset.targetFps;
    let next = this.resolutionScale;
    if (average > budget * render.dynamicDownMargin) {
      next -= render.dynamicStep;
      this.calmTime = 0;
      if (this.justProbed) {
        this.probeWait = Math.min(this.probeWait * render.dynamicProbeBackoff, render.dynamicProbeMaxSeconds);
      }
    } else {
      this.calmTime += elapsed;
      if (this.calmTime >= this.probeWait && this.resolutionScale < 1) {
        next += render.dynamicStep;
        this.calmTime = 0;
      }
    }
    next = clamp(next, this.preset.minResolutionScale, 1);
    this.justProbed = next > this.resolutionScale;
    if (Math.abs(next - this.resolutionScale) > 0.001) {
      this.resolutionScale = next;
      this.stats.resolutionScale = next;
      // Resizing clears the canvas, so it waits until just before the next frame is drawn.
      this.sizeDirty = true;
    }
  }

  render(frameDt: number, nitroAmount: number, reflectionPlaneY: number, dynamicResolution: boolean): void {
    if (this.sizeDirty) {
      this.sizeDirty = false;
      this.applySize();
    }
    this.renderer.info.reset();
    this.reflection?.render(this.renderer, this.scene, this.camera, reflectionPlaneY);
    if (this.composer) {
      if (this.chromatic) {
        const offset = TUNING.render.chromaticNitro * nitroAmount;
        this.chromaticOffset.set(offset, offset * 0.6);
      }
      this.composer.render(frameDt);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    this.stats.drawCalls = this.renderer.info.render.calls;
    this.stats.triangles = this.renderer.info.render.triangles;
    if (dynamicResolution) this.updateDynamicResolution(frameDt);
  }
}
