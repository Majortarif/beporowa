/**
 * Everything you hear besides the car: the band, the radio and the weather. It listens to the game,
 * tells the band what to play, and tells আরজে টুনটুনি what to talk about.
 */

import { speakRadioLine, stopRadioVoice } from '../audio/radio-voice';
import type { AudioEngine } from '../audio/audio-engine';
import { MusicEngine } from '../audio/music-engine';
import { chooseMix, type Mood, type MusicContext } from '../audio/music-patterns';
import { RadioStation, type RadioTopic } from '../audio/radio-station';
import { VoiceLines } from '../audio/voice-lines';
import { clamp01 } from '../core/math';
import type { EventBus } from '../core/events';
import { tList, t } from '../i18n';
import { getSettings, updateSettings, type RadioMode } from '../save/settings';
import { RadioHud } from '../ui/radio-hud';
import { banter } from '../online/banter-client';

/** DJ moments worth having a fresh line ready for, when live lines are on. */
const WARM_TOPICS = ['heat1', 'heat3', 'escaped', 'busted', 'crash', 'raceWin', 'raceLose', 'rainStart', 'night', 'banter'];
import type { AtmosphereEvent } from '../world/atmosphere/atmosphere-director';
import type { AtmosphereFrame } from '../world/atmosphere/atmosphere-director';

const ATMOSPHERE_TOPICS: Partial<Record<AtmosphereEvent, RadioTopic>> = {
  rainStart: 'rainStart',
  rainStop: 'rainStop',
  fogStart: 'fogStart',
  fogStop: 'fogStop',
  blackoutStart: 'blackoutStart',
  blackoutEnd: 'blackoutEnd',
  dawn: 'dawn',
  morning: 'morning',
  dusk: 'dusk',
  night: 'night',
};

const MODES: readonly RadioMode[] = ['full', 'music', 'off'];

export interface SoundFacts {
  /** A place for the weather and jam report. */
  floodPlace(): string;
  jamPlace(): string;
  weatherWord(): string;
  clockWords(): string;
}

export class SoundDirector {
  readonly music = new MusicEngine();
  readonly hud: RadioHud;
  private readonly station: RadioStation;
  private readonly voices = new VoiceLines();
  private lastMood: Mood | null = null;
  private welcomed = false;
  private floodSaid = false;
  private birdTimer = 3;
  private insectTimer = 2;
  private songIndex = 0;

  constructor(
    bus: EventBus,
    uiRoot: HTMLElement,
    private readonly audio: AudioEngine,
    private readonly facts: SoundFacts,
  ) {
    this.hud = new RadioHud(uiRoot);
    this.station = new RadioStation(
      (topic) => tList(`radio.lines.${topic}`).length,
      (topic, index) => (tList(`radio.lines.${topic}`)[index] ?? '').length,
    );
    void this.voices.load();
    this.applyMode();
    this.music.setVolume(getSettings().musicVolume);

    bus.on('heatLevel', ({ stars, previous }) => {
      if (stars <= previous) return;
      if (stars >= 5) this.station.request('heat5');
      else if (stars >= 3) this.station.request('heat3');
      else if (previous === 0) this.station.request('heat1');
    });
    bus.on('pursuitEscaped', () => this.station.request('escaped'));
    bus.on('pursuitBusted', () => this.station.request('busted'));
    bus.on('raceFinished', ({ completed }) => this.station.request(completed ? 'raceWin' : 'raceLose'));
    bus.on('impact', ({ strength }) => {
      if (strength > 0.55) this.station.request('crash');
    });
  }

  /** Words about whatever the sky has just done. */
  onAtmosphere(event: AtmosphereEvent): void {
    const topic = ATMOSPHERE_TOPICS[event];
    if (topic) this.station.request(topic);
    if (event === 'lightning') this.audio.playThunder(0.4 + Math.random() * 1.8, 0.5 + Math.random() * 0.5);
    if (event === 'rainStop') this.floodSaid = false;
  }

  onLevelUp(): void {
    this.station.request('levelUp');
  }

  /** The first gesture has opened the sound, so the band can join. */
  connect(): void {
    const context = this.audio.context;
    const output = this.audio.output;
    if (context && output) this.music.attach(context, output);
  }

  setMusicVolume(volume: number): void {
    this.music.setVolume(volume);
  }

  /** Turns the radio to its next setting. @returns the words for what it is now on */
  cycleMode(): string {
    const next = MODES[(MODES.indexOf(getSettings().radioMode) + 1) % MODES.length];
    updateSettings({ radioMode: next });
    this.applyMode();
    return t(`radio.mode.${next}`);
  }

  applyMode(): void {
    const mode = getSettings().radioMode;
    this.music.setEnabled(mode !== 'off');
    this.station.talking = mode === 'full';
    if (mode !== 'full') {
      this.hud.clear();
      stopRadioVoice();
    }
  }

  /** The race's countdown is no moment for a DJ. */
  hush(): void {
    this.station.hush();
  }

  /**
   * Runs once per rendered frame.
   * @param talkingAllowed she stays quiet during a cutscene or a countdown
   */
  frame(dt: number, context: MusicContext, frame: AtmosphereFrame | null, speedShare: number, talkingAllowed: boolean): void {
    // However the sound got started, by mouse, key or pad, the band joins as soon as it can.
    this.connect();
    if (!this.welcomed && context.scene !== 'menu') {
      this.welcomed = true;
      this.station.request('welcome');
      banter.warmRadio(WARM_TOPICS);
    }
    const mix = chooseMix(context);
    this.music.setMix(mix);
    this.music.update(dt);
    if (mix.mood !== this.lastMood) {
      this.lastMood = mix.mood;
      if (getSettings().radioMode !== 'off' && context.scene !== 'menu') {
        const titles = tList(`radio.songs.${mix.mood}`);
        if (titles.length > 0) this.hud.showSong(titles[this.songIndex++ % titles.length]);
      }
    }

    const wasTalking = this.station.talking;
    this.station.talking = wasTalking && talkingAllowed;
    const line = this.station.update(dt);
    this.station.talking = wasTalking;
    if (line) this.say(line.topic, line.index, line.seconds);
    this.hud.update(dt);

    if (frame) {
      if (frame.flood > 0.5 && !this.floodSaid) {
        this.floodSaid = true;
        this.station.request('flood');
      }
      this.audio.updateWeather(frame.rain, frame.wetness, speedShare);
      this.updateWildlife(dt, frame);
    }
  }

  private say(topic: RadioTopic, index: number, seconds: number): void {
    const fresh = banter.takeRadio(topic);
    if (fresh) {
      // A line written live has no recording, so only the subtitle, and the browser's voice if wanted.
      this.hud.say(fresh, seconds, true);
      this.music.duck(seconds);
      this.audio.playRadioBlip();
      if (getSettings().radioVoice) speakRadioLine(fresh);
      return;
    }
    const lines = tList(`radio.lines.${topic}`);
    const text = (lines[index] ?? '')
      .replace('{place}', this.facts.floodPlace())
      .replace('{jam}', this.facts.jamPlace())
      .replace('{weather}', this.facts.weatherWord())
      .replace('{time}', this.facts.clockWords());
    const key = `radio.lines.${topic}.${index}`;
    const recorded = this.voices.seconds(key);
    const shown = recorded ?? seconds;
    this.hud.say(text, shown);
    this.music.duck(shown);
    this.audio.playRadioBlip();
    const context = this.audio.context;
    const output = this.audio.output;
    if (context && output && this.voices.has(key)) void this.voices.play(key, context, output);
    else if (getSettings().radioVoice) speakRadioLine(text);
  }

  /** Birds at first light, insects after dark, none of them in a downpour. */
  private updateWildlife(dt: number, frame: AtmosphereFrame): void {
    const clear = clamp01(1 - frame.rain * 2);
    if (clear <= 0) return;
    this.birdTimer -= dt;
    const morning = frame.time > 0.24 && frame.time < 0.42;
    if (this.birdTimer <= 0) {
      this.birdTimer = (morning ? 1.2 : 7) + Math.random() * (morning ? 3 : 14);
      if (frame.daylight > 0.25) this.audio.playBird(Math.random() * 1.6 - 0.8, (morning ? 0.06 : 0.03) * clear);
    }
    this.insectTimer -= dt;
    if (this.insectTimer <= 0) {
      this.insectTimer = 0.5 + Math.random() * 1.4;
      if (frame.daylight < 0.1) this.audio.playInsect(Math.random() * 1.6 - 0.8, 0.014 * clear);
    }
  }
}
