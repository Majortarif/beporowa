import type { QualityName } from '../config/tuning';

/** True when this browser can run the game at all. */
export function supportsWebGL2(): boolean {
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

export interface GpuFacts {
  /** The renderer string the browser shares, lower case. Often hidden: then empty. */
  renderer: string;
  mobile: boolean;
  /** Gigabytes, as the browser rounds them, or 0 if not told. */
  memory: number;
  cores: number;
}

/**
 * A starting preset from what the browser says about the machine. Dynamic resolution
 * fine-tunes from there while driving. Pure, so tests can feed it any machine.
 */
export function classifyGpu(facts: GpuFacts): QualityName {
  const name = facts.renderer;
  if (/swiftshader|llvmpipe|software|basic render|microsoft basic/.test(name)) return 'low';
  if (facts.mobile) {
    // Newer phone GPUs cope with the middle preset; everything else stays low.
    if (/apple gpu|adreno \(tm\) (7[3-9]\d|8\d\d)|mali-g(7[1-9]|[89]\d|7\d\d)|immortalis/.test(name) && facts.memory >= 6) return 'medium';
    return 'low';
  }
  const weakMachine = (facts.memory > 0 && facts.memory <= 4) || (facts.cores > 0 && facts.cores <= 2);
  if (/rtx [3-5]0[7-9]0|rtx a[4-9]000|radeon rx [6-9][7-9]\d\d|apple m[1-9] (pro|max|ultra)/.test(name) && !weakMachine) return 'ultra';
  if (/rtx|gtx 1[06-9]|radeon rx|radeon pro|arc\(tm\) a|arc a\d|apple m[1-9]|radeon 7[6-9]0m|radeon 8[0-9]0m/.test(name)) return weakMachine ? 'medium' : 'high';
  // Everything else, built-in laptop graphics included, starts in the middle and lets dynamic
  // resolution take it down; only a machine that says it is short of memory or cores starts low.
  return weakMachine ? 'low' : 'medium';
}

/** Picks a starting preset for this machine. */
export function detectQuality(): QualityName {
  let renderer = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && info) renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)).toLowerCase();
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    return 'low';
  }
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 0;
  return classifyGpu({ renderer, mobile, memory, cores: navigator.hardwareConcurrency ?? 0 });
}
