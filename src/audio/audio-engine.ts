/**
 * Fully procedural car audio through Web Audio: no sample files, nothing copyrighted.
 * The context can only start after a user gesture, so start() is called from the Start button.
 */

import { POLICE } from '../config/police-tuning';
import { TUNING } from '../config/tuning';
import { clamp, clamp01 } from '../core/math';
import type { VehicleTelemetry } from '../vehicle/vehicle-controller';

interface EngineVoice {
  firing: OscillatorNode;
  sub: OscillatorNode;
  buzz: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  intakeGain: GainNode;
  intakeFilter: BiquadFilterNode;
}

function gain0(node: GainNode | null, now: number): void {
  node?.gain.setTargetAtTime(0, now, 0.08);
}

export class AudioEngine {
  context: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: EngineVoice | null = null;
  private tyreGain: GainNode | null = null;
  private tyreFilter: BiquadFilterNode | null = null;
  private windGain: GainNode | null = null;
  private nitroGain: GainNode | null = null;
  private turboGain: GainNode | null = null;
  private turboOsc: OscillatorNode | null = null;
  private hornGain: GainNode | null = null;
  private ambienceGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private volume = 1;
  private shiftDip = 0;
  private slowFilter: BiquadFilterNode | null = null;
  private sirenGain: GainNode | null = null;
  private sirenPan: StereoPannerNode | null = null;
  private heliGain: GainNode | null = null;
  private heliPan: StereoPannerNode | null = null;
  private droneGain: GainNode | null = null;
  private dronePan: StereoPannerNode | null = null;
  private rivalGain: GainNode | null = null;
  private rivalPan: StereoPannerNode | null = null;
  private rivalOsc: OscillatorNode | null = null;
  private rainGain: GainNode | null = null;
  private hissGain: GainNode | null = null;
  private waterGain: GainNode | null = null;

  /** Where anything else that makes sound should connect. */
  get output(): GainNode | null {
    return this.master;
  }

  /** Creates the audio graph. Safe to call again: it only resumes after the first time. */
  start(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    this.context = context;

    const master = context.createGain();
    master.gain.value = TUNING.audio.masterVolume * this.volume;
    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -16;
    compressor.ratio.value = 4;
    // During দম the whole world goes muffled through this filter.
    const slowFilter = context.createBiquadFilter();
    slowFilter.type = 'lowpass';
    slowFilter.frequency.value = 20000;
    slowFilter.Q.value = 0.5;
    this.slowFilter = slowFilter;
    master.connect(slowFilter).connect(compressor).connect(context.destination);
    this.master = master;

    this.noiseBuffer = this.createNoiseBuffer(context);
    this.engine = this.createEngineVoice(context, master);
    this.createLoops(context, master);
    this.createHorn(context, master);
    void context.resume();
  }

  /** Silences everything while the game is paused or the tab is hidden. */
  setSuspended(suspended: boolean): void {
    if (!this.context) return;
    if (suspended) void this.context.suspend();
    else void this.context.resume();
  }

  setVolume(volume: number): void {
    this.volume = clamp01(volume);
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(TUNING.audio.masterVolume * this.volume, this.context.currentTime, 0.02);
    }
  }

  update(telemetry: VehicleTelemetry, horn: boolean): void {
    const context = this.context;
    if (!context || !this.engine) return;
    const config = TUNING.audio;
    const now = context.currentTime;
    const smoothing = config.engine.smoothing;
    const engineConfig = TUNING.vehicle.engine;

    const rpmFraction = clamp01((telemetry.rpm - engineConfig.idleRpm) / (engineConfig.redlineRpm - engineConfig.idleRpm));
    const load = telemetry.reversing ? telemetry.brake : telemetry.throttle;
    const frequency = (telemetry.rpm / 60) * config.engine.pulsesPerRev;

    const engine = this.engine;
    engine.firing.frequency.setTargetAtTime(frequency, now, smoothing);
    engine.sub.frequency.setTargetAtTime(frequency * 0.5, now, smoothing);
    engine.buzz.frequency.setTargetAtTime(frequency * 1.502, now, smoothing);

    const cutoff = config.engine.filterMinHz + (config.engine.filterMaxHz - config.engine.filterMinHz) * rpmFraction * (0.32 + 0.68 * load);
    engine.filter.frequency.setTargetAtTime(cutoff, now, smoothing);

    if (this.shiftDip > 0) this.shiftDip -= 1 / 60;
    const dip = this.shiftDip > 0 ? 0.42 : 1;
    const gain = (config.engine.idleGain + (config.engine.fullGain - config.engine.idleGain) * (0.25 * rpmFraction + 0.75 * load)) * dip;
    engine.gain.gain.setTargetAtTime(gain, now, smoothing);
    engine.intakeGain.gain.setTargetAtTime(config.engine.intakeGain * load * (0.35 + rpmFraction), now, 0.05);
    engine.intakeFilter.frequency.setTargetAtTime(500 + rpmFraction * 2600, now, 0.05);

    if (this.tyreGain && this.tyreFilter) {
      const slip = clamp(telemetry.maxSlip - 0.2, 0, 1);
      this.tyreGain.gain.setTargetAtTime(config.tyreGain * slip, now, 0.04);
      this.tyreFilter.frequency.setTargetAtTime(config.tyreFilterHz + slip * 420, now, 0.05);
    }
    if (this.windGain) {
      const speedFraction = clamp01(telemetry.speed / 65);
      this.windGain.gain.setTargetAtTime(config.windGain * speedFraction * speedFraction, now, 0.15);
    }
    if (this.nitroGain) {
      this.nitroGain.gain.setTargetAtTime(telemetry.nitroActive ? config.nitroGain : 0, now, 0.05);
    }
    if (this.turboGain && this.turboOsc) {
      this.turboGain.gain.setTargetAtTime(config.turboGain * load * rpmFraction, now, 0.12);
      this.turboOsc.frequency.setTargetAtTime(config.turboWhistleHz * (0.4 + 0.6 * rpmFraction), now, 0.12);
    }
    if (this.hornGain) {
      this.hornGain.gain.setTargetAtTime(horn ? config.hornGain : 0, now, 0.012);
    }
  }

  onGearChange(): void {
    this.shiftDip = TUNING.vehicle.engine.shiftTime;
  }

  playBackfire(): void {
    this.playNoiseBurst(TUNING.audio.backfireGain, 0.09, 'bandpass', 420, 1.4);
  }

  playImpact(strength: number): void {
    const gain = TUNING.audio.impactGain * clamp01(strength);
    this.playNoiseBurst(gain, 0.22, 'lowpass', 900, 0.8);
    this.playNoiseBurst(gain * 0.35, 0.09, 'bandpass', 3400, 4);
  }

  playNitroStart(): void {
    this.playNoiseBurst(TUNING.audio.nitroGain * 0.8, 0.2, 'bandpass', 1500, 0.9);
  }

  /** The hum of a busy city under everything else. */
  setCityAmbience(level: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    if (!this.ambienceGain) {
      const source = this.createNoiseSource(context);
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      filter.Q.value = 0.3;
      this.ambienceGain = context.createGain();
      this.ambienceGain.gain.value = 0;
      source.connect(filter).connect(this.ambienceGain).connect(this.master);
      source.start();
    }
    this.ambienceGain.gain.setTargetAtTime(level, context.currentTime, 0.4);
  }

  /** A short horn from somewhere in traffic. Pan -1 is left, 1 is right. */
  playDistantHorn(gain: number, pan: number, pitch: number, seconds: number): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const now = context.currentTime;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 900 * pitch;
    filter.Q.value = 0.9;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(gain, now + 0.015);
    envelope.gain.setValueAtTime(gain, now + seconds);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + seconds + 0.05);
    filter.connect(envelope).connect(panner).connect(this.master);
    for (const frequency of [370 * pitch, 466 * pitch]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      oscillator.connect(filter);
      oscillator.start(now);
      oscillator.stop(now + seconds + 0.08);
    }
  }

  /** A rickshaw bell: two quick metallic rings. */
  playBell(gain: number, pan: number): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);
    const start = context.currentTime;
    for (const delay of [0, 0.16]) {
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(gain, start + delay);
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.22);
      envelope.connect(panner);
      for (const frequency of [2350, 3520]) {
        const oscillator = context.createOscillator();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        oscillator.connect(envelope);
        oscillator.start(start + delay);
        oscillator.stop(start + delay + 0.24);
      }
    }
  }

  /** How muffled everything sounds: 0 is normal, 1 is holding your breath. */
  setSlowMotion(amount: number): void {
    if (!this.context || !this.slowFilter) return;
    const frequency = 20000 * Math.pow(650 / 20000, clamp01(amount));
    this.slowFilter.frequency.setTargetAtTime(frequency, this.context.currentTime, 0.04);
  }

  /** Builds the pursuit's looping sounds the first time they are needed. */
  private createPoliceVoices(context: AudioContext, destination: AudioNode): void {
    // Siren: two notes, swapped by a slow square wave. Original tones, no recording.
    const sirenFilter = context.createBiquadFilter();
    sirenFilter.type = 'bandpass';
    sirenFilter.frequency.value = 1150;
    sirenFilter.Q.value = 0.8;
    const sirenPan = context.createStereoPanner();
    const sirenGain = context.createGain();
    sirenGain.gain.value = 0;
    sirenFilter.connect(sirenGain).connect(sirenPan).connect(destination);
    const swap = context.createOscillator();
    swap.type = 'square';
    swap.frequency.value = 0.92;
    for (const [base, depth] of [[780, 170], [1172, 255]] as const) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = base;
      const swing = context.createGain();
      swing.gain.value = depth;
      swap.connect(swing).connect(oscillator.frequency);
      oscillator.connect(sirenFilter);
      oscillator.start();
    }
    swap.start();
    this.sirenGain = sirenGain;
    this.sirenPan = sirenPan;

    // Rotor: low noise, chopped by a fast wave.
    const rotorFilter = context.createBiquadFilter();
    rotorFilter.type = 'lowpass';
    rotorFilter.frequency.value = 340;
    const rotorChop = context.createGain();
    rotorChop.gain.value = 0.55;
    const chop = context.createOscillator();
    chop.type = 'sine';
    chop.frequency.value = 13;
    const chopDepth = context.createGain();
    chopDepth.gain.value = 0.45;
    chop.connect(chopDepth).connect(rotorChop.gain);
    const heliPan = context.createStereoPanner();
    const heliGain = context.createGain();
    heliGain.gain.value = 0;
    const rotorNoise = this.createNoiseSource(context);
    rotorNoise.connect(rotorFilter).connect(rotorChop).connect(heliGain).connect(heliPan).connect(destination);
    rotorNoise.start();
    chop.start();
    this.heliGain = heliGain;
    this.heliPan = heliPan;

    // Drone: a thin, nagging whine.
    const dronePan = context.createStereoPanner();
    const droneGain = context.createGain();
    droneGain.gain.value = 0;
    const droneFilter = context.createBiquadFilter();
    droneFilter.type = 'bandpass';
    droneFilter.frequency.value = 760;
    droneFilter.Q.value = 2;
    droneFilter.connect(droneGain).connect(dronePan).connect(destination);
    for (const frequency of [212, 216.5]) {
      const oscillator = context.createOscillator();
      oscillator.type = 'sawtooth';
      oscillator.frequency.value = frequency;
      oscillator.connect(droneFilter);
      oscillator.start();
    }
    this.droneGain = droneGain;
    this.dronePan = dronePan;
  }

  /** Levels from 0 to 1 and pans from -1 to 1, for the siren, the rotor and the drone. */
  updatePursuitSounds(siren: number, sirenPan: number, heli: number, heliPan: number, drone: number, dronePan: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    if (!this.sirenGain) {
      if (siren <= 0 && heli <= 0 && drone <= 0) return;
      this.createPoliceVoices(context, this.master);
    }
    const now = context.currentTime;
    const config = POLICE.audio;
    this.sirenGain?.gain.setTargetAtTime(siren * config.sirenGain, now, 0.08);
    this.sirenPan?.pan.setTargetAtTime(sirenPan, now, 0.08);
    this.heliGain?.gain.setTargetAtTime(heli * config.heliGain, now, 0.12);
    this.heliPan?.pan.setTargetAtTime(heliPan, now, 0.12);
    this.droneGain?.gain.setTargetAtTime(drone * config.droneGain, now, 0.12);
    this.dronePan?.pan.setTargetAtTime(dronePan, now, 0.12);
  }

  /** A click of static and a short tone, before a radio line. */
  playRadioBlip(): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const gain = POLICE.audio.radioGain;
    this.playNoiseBurst(gain * 0.7, 0.07, 'highpass', 2600, 0.6);
    const now = context.currentTime;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(gain * 0.55, now + 0.02);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 0.13);
    const oscillator = context.createOscillator();
    oscillator.type = 'square';
    oscillator.frequency.value = 1520;
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(now + 0.02);
    oscillator.stop(now + 0.14);
  }

  /** Air rushing out of a torn tyre. */
  playSpikeHit(): void {
    this.playNoiseBurst(0.3, 0.14, 'bandpass', 620, 1);
    this.playNoiseBurst(0.22, 1.1, 'highpass', 3200, 0.5);
  }

  /** Bamboo, drums and water coming down. */
  playClatter(): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    this.playNoiseBurst(0.42, 0.3, 'lowpass', 520, 0.7);
    for (let i = 0; i < 6; i++) {
      const delay = 0.08 + i * 0.09 + Math.random() * 0.05;
      window.setTimeout(() => this.playNoiseBurst(0.2 - i * 0.02, 0.09, 'bandpass', 800 + Math.random() * 1600, 2.4), delay * 1000);
    }
  }

  private playTone(frequency: number, seconds: number, gain: number, type: OscillatorType, delay = 0): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const start = context.currentTime + delay;
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(gain, start + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + seconds);
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.value = frequency;
    oscillator.connect(envelope).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + seconds + 0.02);
  }

  /** The start lights: a short note for each count, and a long high one for GO. */
  playCountdown(go: boolean): void {
    if (go) {
      this.playTone(880, 0.75, 0.2, 'square');
      this.playTone(1320, 0.75, 0.1, 'square');
    } else {
      this.playTone(440, 0.22, 0.16, 'square');
    }
  }

  /** Through a gate: two rising notes, like a rickshaw bell in a hurry. */
  playGate(): void {
    this.playTone(1560, 0.14, 0.09, 'triangle');
    this.playTone(2080, 0.2, 0.09, 'triangle', 0.07);
  }

  /** A crowd, made of noise that swells and fades. */
  playCheer(): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const source = this.createNoiseSource(context);
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1500;
    filter.Q.value = 0.5;
    const envelope = context.createGain();
    const now = context.currentTime;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.09, now + 0.8);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 3.4);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(now, Math.random());
    source.stop(now + 3.5);
  }

  /** A fanfare of horns for a win, and a low note for anything else. */
  playFinish(won: boolean): void {
    if (won) {
      [523, 659, 784, 1047].forEach((frequency, index) => this.playTone(frequency, 0.34, 0.13, 'square', index * 0.12));
      this.playCheer();
    } else {
      this.playTone(220, 0.7, 0.14, 'sawtooth');
      this.playTone(165, 0.9, 0.12, 'sawtooth', 0.22);
    }
  }

  /** The nearest rival's engine, passing from one side to the other. */
  updateRivalEngine(level: number, pan: number, rpm: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    if (!this.rivalGain) {
      if (level <= 0) return;
      const filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1400;
      this.rivalGain = context.createGain();
      this.rivalGain.gain.value = 0;
      this.rivalPan = context.createStereoPanner();
      this.rivalOsc = context.createOscillator();
      this.rivalOsc.type = 'sawtooth';
      this.rivalOsc.connect(filter).connect(this.rivalGain).connect(this.rivalPan).connect(this.master);
      this.rivalOsc.start();
    }
    const now = context.currentTime;
    this.rivalGain.gain.setTargetAtTime(level * 0.07, now, 0.08);
    this.rivalPan?.pan.setTargetAtTime(pan, now, 0.08);
    this.rivalOsc?.frequency.setTargetAtTime(70 + rpm * 190, now, 0.06);
  }

  /** A sharp breath in as দম begins, and out as it ends. */
  playBreath(starting: boolean): void {
    this.playNoiseBurst(0.1, starting ? 0.3 : 0.42, 'bandpass', starting ? 1500 : 620, 0.8);
  }

  /** The engine and tyres fall silent, when the car is parked and the driver has gone for tea. */
  quietCar(): void {
    const context = this.context;
    if (!context || !this.engine) return;
    const now = context.currentTime;
    for (const gain of [this.engine.gain, this.engine.intakeGain, this.tyreGain, this.windGain, this.nitroGain, this.turboGain, this.hornGain, this.hissGain, this.waterGain]) {
      gain?.gain.setTargetAtTime(0, now, 0.08);
    }
    gain0(this.sirenGain, now);
    gain0(this.heliGain, now);
    gain0(this.droneGain, now);
    gain0(this.rivalGain, now);
  }

  private makeLoop(context: AudioContext, type: BiquadFilterType, frequency: number, q: number): GainNode {
    const source = this.createNoiseSource(context);
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = context.createGain();
    gain.gain.value = 0;
    source.connect(filter).connect(gain).connect(this.master as GainNode);
    source.start();
    return gain;
  }

  /** Rain on everything, and the hiss of tyres on a wet road. */
  updateWeather(rain: number, wetness: number, speedShare: number): void {
    const context = this.context;
    if (!context || !this.master) return;
    if (!this.rainGain) {
      this.rainGain = this.makeLoop(context, 'highpass', 1500, 0.4);
      this.hissGain = this.makeLoop(context, 'bandpass', 2600, 0.7);
      this.waterGain = this.makeLoop(context, 'bandpass', 620, 0.9);
    }
    const now = context.currentTime;
    this.rainGain.gain.setTargetAtTime(rain * rain * 0.17, now, 0.6);
    this.hissGain?.gain.setTargetAtTime(wetness * speedShare * 0.11, now, 0.12);
  }

  /** Water rushing under the car in a flood. */
  setWaterRush(level: number): void {
    if (this.context) this.waterGain?.gain.setTargetAtTime(level * 0.32, this.context.currentTime, 0.1);
  }

  /** A long roll of thunder, some way off. */
  playThunder(delay: number, strength: number): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const at = context.currentTime + delay;
    const source = this.createNoiseSource(context);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(420, at);
    filter.frequency.exponentialRampToValueAtTime(70, at + 3.2);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(0.55 * strength, at + 0.18);
    envelope.gain.exponentialRampToValueAtTime(0.18 * strength, at + 1.1);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 4);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(at, Math.random());
    source.stop(at + 4.1);
  }

  /** A wave thrown up from under the wheels. */
  playSplash(strength: number): void {
    this.playNoiseBurst(0.26 * clamp01(strength), 0.5, 'bandpass', 1100, 0.6);
  }

  /** A hidden hole in the road. */
  playPothole(): void {
    this.playNoiseBurst(0.5, 0.16, 'lowpass', 280, 1);
    this.playTone(62, 0.2, 0.36, 'sine');
    this.playNoiseBurst(0.2, 0.42, 'bandpass', 900, 0.6);
  }

  /** Coins on a counter. */
  playCash(): void {
    [1980, 2640, 3160].forEach((frequency, index) => this.playTone(frequency, 0.13, 0.06, 'triangle', index * 0.065));
  }

  /** A brush across tin. */
  playPaint(): void {
    this.playNoiseBurst(0.07, 0.16, 'bandpass', 3200, 1.2);
  }

  /** A camera's shutter. */
  playShutter(): void {
    this.playNoiseBurst(0.22, 0.04, 'highpass', 3000, 0.7);
    window.setTimeout(() => this.playNoiseBurst(0.2, 0.05, 'highpass', 2200, 0.7), 80);
  }

  /** A thin stream of tea going into a glass. */
  playTeaPour(seconds: number): void {
    this.playNoiseBurst(0.05, seconds, 'bandpass', 2100, 3);
  }

  /** A quick run of notes from a bird somewhere above. */
  playBird(pan: number, gain: number): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);
    const base = 2400 + Math.random() * 1600;
    const notes = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      const at = context.currentTime + i * 0.13 + Math.random() * 0.03;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(gain, at + 0.015);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.1);
      envelope.connect(panner);
      const oscillator = context.createOscillator();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(base * (1 + Math.random() * 0.2), at);
      oscillator.frequency.exponentialRampToValueAtTime(base * (0.8 + Math.random() * 0.5), at + 0.09);
      oscillator.connect(envelope);
      oscillator.start(at);
      oscillator.stop(at + 0.12);
    }
  }

  /** A cricket, somewhere in the dark. */
  playInsect(pan: number, gain: number): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const panner = context.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.master);
    const base = 4300 + Math.random() * 700;
    for (let i = 0; i < 3; i++) {
      const at = context.currentTime + i * 0.055;
      const envelope = context.createGain();
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(gain, at + 0.008);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
      envelope.connect(panner);
      const oscillator = context.createOscillator();
      oscillator.frequency.value = base;
      oscillator.connect(envelope);
      oscillator.start(at);
      oscillator.stop(at + 0.05);
    }
  }

  private createNoiseBuffer(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  private createNoiseSource(context: AudioContext): AudioBufferSourceNode {
    const source = context.createBufferSource();
    source.buffer = this.noiseBuffer;
    source.loop = true;
    return source;
  }

  private createEngineVoice(context: AudioContext, destination: AudioNode): EngineVoice {
    const config = TUNING.audio.engine;
    const firing = context.createOscillator();
    firing.type = 'sawtooth';
    const sub = context.createOscillator();
    sub.type = 'square';
    const buzz = context.createOscillator();
    buzz.type = 'sawtooth';

    const subGain = context.createGain();
    subGain.gain.value = config.subGain;
    const buzzGain = context.createGain();
    buzzGain.gain.value = config.buzzGain;

    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.6;

    const shaper = context.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;

    const gain = context.createGain();
    gain.gain.value = 0;

    firing.connect(filter);
    sub.connect(subGain).connect(filter);
    buzz.connect(buzzGain).connect(filter);
    filter.connect(shaper).connect(gain).connect(destination);

    const intake = this.createNoiseSource(context);
    const intakeFilter = context.createBiquadFilter();
    intakeFilter.type = 'bandpass';
    intakeFilter.Q.value = 0.8;
    const intakeGain = context.createGain();
    intakeGain.gain.value = 0;
    intake.connect(intakeFilter).connect(intakeGain).connect(destination);

    firing.start();
    sub.start();
    buzz.start();
    intake.start();
    return { firing, sub, buzz, filter, gain, intakeGain, intakeFilter };
  }

  private createLoops(context: AudioContext, destination: AudioNode): void {
    const makeNoiseLoop = (type: BiquadFilterType, frequency: number, q: number): { gain: GainNode; filter: BiquadFilterNode } => {
      const source = this.createNoiseSource(context);
      const filter = context.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = q;
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(destination);
      source.start();
      return { gain, filter };
    };

    const tyre = makeNoiseLoop('bandpass', TUNING.audio.tyreFilterHz, 5);
    this.tyreGain = tyre.gain;
    this.tyreFilter = tyre.filter;
    this.windGain = makeNoiseLoop('lowpass', 720, 0.4).gain;
    this.nitroGain = makeNoiseLoop('bandpass', 1900, 0.7).gain;

    const turbo = context.createOscillator();
    turbo.type = 'sine';
    const turboGain = context.createGain();
    turboGain.gain.value = 0;
    turbo.connect(turboGain).connect(destination);
    turbo.start();
    this.turboOsc = turbo;
    this.turboGain = turboGain;
  }

  private createHorn(context: AudioContext, destination: AudioNode): void {
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.7;
    const gain = context.createGain();
    gain.gain.value = 0;
    filter.connect(gain).connect(destination);
    for (const frequency of TUNING.audio.hornFrequencies) {
      const oscillator = context.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.value = frequency;
      oscillator.connect(filter);
      oscillator.start();
    }
    this.hornGain = gain;
  }

  private playNoiseBurst(gain: number, duration: number, type: BiquadFilterType, frequency: number, q: number): void {
    const context = this.context;
    if (!context || !this.master || context.state !== 'running') return;
    const source = this.createNoiseSource(context);
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const envelope = context.createGain();
    const now = context.currentTime;
    envelope.gain.setValueAtTime(gain, now);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    source.connect(filter).connect(envelope).connect(this.master);
    source.start(now, Math.random());
    source.stop(now + duration + 0.02);
  }
}
