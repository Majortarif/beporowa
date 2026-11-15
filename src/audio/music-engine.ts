/**
 * The band: plays what music-patterns writes, through Web Audio voices made from scratch. Dhol,
 * tabla, ektara and bansuri here are synth approximations, not samples, and no tune is borrowed.
 */

import { STEPS_PER_BAR, SCALES, buildSection, degreeToMidi, midiToFrequency, type BarPattern, type LayerName, type Mood, type MusicMix } from './music-patterns';

const SECTION_BARS = 8;
const LOOKAHEAD = 0.24;
const SWUNG: ReadonlySet<Mood> = new Set<Mood>(['adda', 'cruise', 'rain', 'blackout']);
const LAYERS: readonly LayerName[] = ['drums', 'dhol', 'tabla', 'cowbell', 'bass', 'ektara', 'bansuri', 'pad', 'crackle'];

export class MusicEngine {
  private context: AudioContext | null = null;
  private bus: GainNode | null = null;
  private duckGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private echo: GainNode | null = null;
  private readonly layers = new Map<LayerName, GainNode>();
  private noise: AudioBuffer | null = null;
  private shaper: WaveShaperNode | null = null;
  private volume = 0.7;
  private enabled = true;
  private mix: MusicMix | null = null;
  private pending: MusicMix | null = null;
  private section: BarPattern[] = [];
  private barIndex = 0;
  private step = 0;
  private nextStepTime = 0;
  private seed = 17;
  private lastBansuri = 0;
  private duckTimer = 0;

  /** Joins the sound graph. It can only happen after a click or a key press. */
  attach(context: AudioContext, destination: AudioNode): void {
    if (this.context) return;
    this.context = context;
    const bus = context.createGain();
    bus.gain.value = this.enabled ? this.volume : 0;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 12000;
    filter.Q.value = 0.4;
    const duck = context.createGain();
    duck.connect(filter).connect(bus).connect(destination);
    this.bus = bus;
    this.filter = filter;
    this.duckGain = duck;

    // One echo, for the flute and the single string: all the reverb this city needs.
    const delay = context.createDelay(1);
    delay.delayTime.value = 0.31;
    const feedback = context.createGain();
    feedback.gain.value = 0.34;
    const echo = context.createGain();
    echo.gain.value = 0.3;
    const damp = context.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 2200;
    echo.connect(delay).connect(damp).connect(feedback).connect(delay);
    damp.connect(duck);
    this.echo = echo;

    for (const name of LAYERS) {
      const gain = context.createGain();
      gain.gain.value = 0;
      gain.connect(duck);
      this.layers.set(name, gain);
    }

    // Everything bassy goes through a little drive, which is most of what makes an 808 an 808.
    const shaper = context.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.2);
    }
    shaper.curve = curve;
    shaper.connect(this.layers.get('bass') as GainNode);
    this.shaper = shaper;

    this.noise = this.makeNoise(context);
    this.startCrackle(context);
    this.nextStepTime = context.currentTime + 0.1;
  }

  private makeNoise(context: AudioContext): AudioBuffer {
    const buffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** A worn record: mostly silence, with a pop here and there. */
  private startCrackle(context: AudioContext): void {
    const buffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < 130; i++) {
      const at = Math.floor(Math.random() * (data.length - 80));
      const size = 0.08 + Math.random() * 0.3;
      for (let k = 0; k < 40; k++) data[at + k] += (Math.random() * 2 - 1) * size * (1 - k / 40);
    }
    for (let i = 0; i < data.length; i++) data[i] += (Math.random() * 2 - 1) * 0.004;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 900;
    const gain = context.createGain();
    gain.gain.value = 0.16;
    source.connect(filter).connect(gain).connect(this.layers.get('crackle') as GainNode);
    source.start();
  }

  setVolume(volume: number): void {
    this.volume = volume;
    this.applyVolume();
  }

  /** Turns the music on or off altogether, from the radio's setting. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.applyVolume();
  }

  private applyVolume(): void {
    if (this.bus && this.context) this.bus.gain.setTargetAtTime(this.enabled ? this.volume : 0, this.context.currentTime, 0.2);
  }

  /** Turns the band down while the DJ talks. */
  duck(seconds: number): void {
    this.duckTimer = seconds;
    if (this.duckGain && this.context) this.duckGain.gain.setTargetAtTime(0.36, this.context.currentTime, 0.18);
  }

  /** Says what should be playing. A change of mood waits for the next bar line. */
  setMix(mix: MusicMix): void {
    if (!this.mix) {
      this.mix = mix;
      this.loadSection(mix);
      this.applyLayers(mix);
      return;
    }
    if (mix.mood !== this.mix.mood) {
      this.pending = mix;
      return;
    }
    this.mix.layers = mix.layers;
    this.mix.filterHz = mix.filterHz;
    this.applyLayers(mix);
  }

  private applyLayers(mix: MusicMix): void {
    const context = this.context;
    if (!context) return;
    const now = context.currentTime;
    for (const name of LAYERS) this.layers.get(name)?.gain.setTargetAtTime(mix.layers[name], now, 0.6);
    this.filter?.frequency.setTargetAtTime(mix.filterHz, now, 0.6);
  }

  private loadSection(mix: MusicMix): void {
    this.seed = (this.seed * 31 + 7) % 100003;
    this.section = buildSection(mix.mood, this.seed, SECTION_BARS, SCALES[mix.scale].length);
    this.barIndex = 0;
  }

  /** Schedules whatever falls due soon. Call once per rendered frame. */
  update(dt: number): void {
    const context = this.context;
    if (!context || !this.mix) return;
    if (this.duckTimer > 0) {
      this.duckTimer -= dt;
      if (this.duckTimer <= 0 && this.duckGain) this.duckGain.gain.setTargetAtTime(1, context.currentTime, 0.5);
    }
    if (context.state !== 'running' || !this.enabled) return;
    const now = context.currentTime;
    // After a long stall, carry on from now rather than playing everything that was missed.
    if (this.nextStepTime < now - 0.05) this.nextStepTime = now + 0.02;
    while (this.nextStepTime < now + LOOKAHEAD) this.playStep();
  }

  private playStep(): void {
    const mix = this.mix as MusicMix;
    const bar = this.section[this.barIndex];
    const stepLength = 60 / mix.tempo / 4;
    const scale = SCALES[mix.scale];
    const swing = SWUNG.has(mix.mood) && this.step % 2 === 1 ? stepLength * 0.2 : 0;
    const at = this.nextStepTime + swing;
    const step = this.step;

    if (step === 0) this.playPad(at, stepLength * STEPS_PER_BAR, bar.chord, scale, mix.tonic);
    if (bar.kick[step] > 0) this.playKick(at, bar.kick[step]);
    if (bar.snare[step] > 0) this.playSnare(at, bar.snare[step]);
    if (bar.hat[step] > 0) this.playHat(at, bar.hat[step]);
    if (bar.dholLow[step] > 0) this.playDholLow(at, bar.dholLow[step]);
    if (bar.dholHigh[step] > 0) this.playDholHigh(at, bar.dholHigh[step]);
    if (bar.tablaNa[step] > 0) this.playTablaNa(at, bar.tablaNa[step]);
    if (bar.tablaGe[step] > 0) this.playTablaGe(at, bar.tablaGe[step]);
    const cowbell = bar.cowbell[step];
    if (cowbell !== null) this.playCowbell(at, degreeToMidi(scale, mix.tonic + 24, cowbell));
    const bass = bar.bass[step];
    if (bass !== null) this.playBass(at, degreeToMidi(scale, mix.tonic - 12, bass), mix.mood === 'pursuit' ? stepLength * 5 : stepLength * 3);
    const ektara = bar.ektara[step];
    if (ektara !== null) this.playEktara(at, degreeToMidi(scale, mix.tonic + 12, ektara));
    const bansuri = bar.bansuri[step];
    if (bansuri !== null) this.playBansuri(at, degreeToMidi(scale, mix.tonic + 24, bansuri), stepLength * 3.5);

    this.nextStepTime += stepLength;
    this.step++;
    if (this.step < STEPS_PER_BAR) return;
    this.step = 0;
    this.barIndex++;
    // New moods come in on the bar, so that nothing ever lurches.
    if (this.pending) {
      this.mix = this.pending;
      this.pending = null;
      this.loadSection(this.mix);
      this.applyLayers(this.mix);
    } else if (this.barIndex >= this.section.length) {
      this.loadSection(mix);
    }
  }

  private envelope(destination: AudioNode, at: number, peak: number, attack: number, release: number): GainNode {
    const context = this.context as AudioContext;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    gain.connect(destination);
    return gain;
  }

  private tone(type: OscillatorType, frequency: number, at: number, seconds: number, destination: AudioNode, bendTo?: number, bendTime?: number): void {
    const context = this.context as AudioContext;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    if (bendTo !== undefined) oscillator.frequency.exponentialRampToValueAtTime(bendTo, at + (bendTime ?? seconds));
    oscillator.connect(destination);
    oscillator.start(at);
    oscillator.stop(at + seconds + 0.02);
  }

  private burst(at: number, seconds: number, type: BiquadFilterType, frequency: number, q: number, destination: AudioNode): void {
    const context = this.context as AudioContext;
    const source = context.createBufferSource();
    source.buffer = this.noise;
    const filter = context.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    source.connect(filter).connect(destination);
    source.start(at, Math.random() * 0.8);
    source.stop(at + seconds + 0.02);
  }

  private layer(name: LayerName): GainNode {
    return this.layers.get(name) as GainNode;
  }

  private playKick(at: number, strength: number): void {
    const body = this.envelope(this.layer('drums'), at, 0.72 * strength, 0.003, 0.2);
    this.tone('sine', 128, at, 0.24, body, 44, 0.12);
  }

  private playSnare(at: number, strength: number): void {
    this.burst(at, 0.15, 'bandpass', 1850, 0.8, this.envelope(this.layer('drums'), at, 0.42 * strength, 0.002, 0.13));
    this.tone('triangle', 196, at, 0.1, this.envelope(this.layer('drums'), at, 0.2 * strength, 0.002, 0.08));
  }

  private playHat(at: number, strength: number): void {
    this.burst(at, 0.05, 'highpass', 7600, 0.7, this.envelope(this.layer('drums'), at, 0.2 * strength, 0.001, 0.04));
  }

  /** The dhol's big left side: a thud, with the skin ringing a little. */
  private playDholLow(at: number, strength: number): void {
    const gain = this.envelope(this.layer('dhol'), at, 0.72 * strength, 0.003, 0.26);
    this.tone('sine', 104, at, 0.3, gain, 66, 0.1);
    this.burst(at, 0.04, 'lowpass', 900, 0.5, this.envelope(this.layer('dhol'), at, 0.26 * strength, 0.001, 0.035));
  }

  /** The dhol's cane side: a sharp slap. */
  private playDholHigh(at: number, strength: number): void {
    this.burst(at, 0.07, 'bandpass', 2300, 1.6, this.envelope(this.layer('dhol'), at, 0.42 * strength, 0.001, 0.06));
    this.tone('triangle', 410, at, 0.07, this.envelope(this.layer('dhol'), at, 0.2 * strength, 0.001, 0.06));
  }

  /** The tabla's small drum: a ringing tap. */
  private playTablaNa(at: number, strength: number): void {
    const gain = this.envelope(this.layer('tabla'), at, 0.4 * strength, 0.001, 0.13);
    this.tone('sine', 588, at, 0.16, gain);
    this.tone('sine', 1180, at, 0.08, this.envelope(this.layer('tabla'), at, 0.12 * strength, 0.001, 0.06));
    this.burst(at, 0.02, 'highpass', 3000, 0.5, this.envelope(this.layer('tabla'), at, 0.1 * strength, 0.001, 0.015));
  }

  /** The tabla's big drum: low, with the pitch sliding up under the palm. */
  private playTablaGe(at: number, strength: number): void {
    const gain = this.envelope(this.layer('tabla'), at, 0.56 * strength, 0.003, 0.34);
    this.tone('sine', 92, at, 0.38, gain, 138, 0.26);
  }

  private playCowbell(at: number, note: number): void {
    const context = this.context as AudioContext;
    const frequency = midiToFrequency(note);
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = frequency * 1.3;
    filter.Q.value = 2;
    filter.connect(this.envelope(this.layer('cowbell'), at, 0.42, 0.002, 0.16));
    this.tone('square', frequency, at, 0.18, filter);
    this.tone('square', frequency * 1.482, at, 0.18, filter);
  }

  private playBass(at: number, note: number, seconds: number): void {
    const gain = this.envelope(this.shaper as AudioNode, at, 0.62, 0.006, seconds);
    this.tone('sine', midiToFrequency(note), at, seconds + 0.02, gain);
  }

  /** One plucked string: bright at first, then quickly dull. */
  private playEktara(at: number, note: number): void {
    const context = this.context as AudioContext;
    const frequency = midiToFrequency(note);
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(3000, at);
    filter.frequency.exponentialRampToValueAtTime(420, at + 0.5);
    const body = this.envelope(this.layer('ektara'), at, 0.34, 0.002, 0.74);
    filter.connect(body);
    if (this.echo) {
      const send = context.createGain();
      send.gain.value = 0.4;
      body.connect(send).connect(this.echo);
    }
    this.tone('sawtooth', frequency, at, 0.8, filter);
    this.tone('triangle', frequency * 1.003, at, 0.8, filter);
  }

  /** A breathy flute that slides into each note and only wavers once it has settled. */
  private playBansuri(at: number, note: number, seconds: number): void {
    const context = this.context as AudioContext;
    const frequency = midiToFrequency(note);
    const from = this.lastBansuri > 0 && Math.abs(this.lastBansuri / frequency - 1) < 0.5 ? this.lastBansuri : frequency * 0.97;
    this.lastBansuri = frequency;
    const body = this.envelope(this.layer('bansuri'), at, 0.28, 0.09, seconds);
    if (this.echo) {
      const send = context.createGain();
      send.gain.value = 0.6;
      body.connect(send).connect(this.echo);
    }
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(from, at);
    oscillator.frequency.exponentialRampToValueAtTime(frequency, at + 0.08);
    const vibrato = context.createOscillator();
    vibrato.frequency.value = 5.2;
    const depth = context.createGain();
    depth.gain.setValueAtTime(0, at);
    depth.gain.linearRampToValueAtTime(frequency * 0.008, at + 0.32);
    vibrato.connect(depth).connect(oscillator.frequency);
    oscillator.connect(body);
    const end = at + seconds + 0.12;
    oscillator.start(at);
    oscillator.stop(end);
    vibrato.start(at);
    vibrato.stop(end);
    this.burst(at, seconds, 'bandpass', Math.min(5000, frequency * 2.2), 3.4, this.envelope(this.layer('bansuri'), at, 0.05, 0.08, seconds));
  }

  /** A slow reed organ under everything, a little out of tune with itself, as a harmonium is. */
  private playPad(at: number, seconds: number, chord: readonly number[], scale: readonly number[], tonic: number): void {
    const layer = this.layer('pad');
    if (layer.gain.value < 0.01) return;
    const context = this.context as AudioContext;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 880;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.11, at + 0.5);
    gain.gain.setValueAtTime(0.11, at + Math.max(0.5, seconds - 0.4));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 0.2);
    filter.connect(gain).connect(layer);
    for (const degree of chord) {
      const frequency = midiToFrequency(degreeToMidi(scale, tonic + 12, degree));
      this.tone('sawtooth', frequency, at, seconds + 0.25, filter);
      this.tone('sawtooth', frequency * 1.004, at, seconds + 0.25, filter);
    }
  }
}
