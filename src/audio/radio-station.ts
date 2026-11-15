/**
 * রেডিও ঝড় and its host, আরজে টুনটুনি: decides what she says and when, so that she never babbles
 * over herself, and the big moments cut in. No sound or screen here, so it can be tested headless.
 */

export type RadioTopic =
  | 'welcome'
  | 'heat1'
  | 'heat3'
  | 'heat5'
  | 'escaped'
  | 'busted'
  | 'raceWin'
  | 'raceLose'
  | 'crash'
  | 'levelUp'
  | 'rainStart'
  | 'rainStop'
  | 'fogStart'
  | 'fogStop'
  | 'blackoutStart'
  | 'blackoutEnd'
  | 'dawn'
  | 'morning'
  | 'dusk'
  | 'night'
  | 'flood'
  | 'report'
  | 'advert'
  | 'banter'
  | 'song';

/** Higher goes first, and anything from 2 up can cut a quiet stretch short. */
const PRIORITY: Readonly<Record<RadioTopic, number>> = {
  welcome: 2,
  heat1: 2,
  heat3: 3,
  heat5: 3,
  escaped: 3,
  busted: 3,
  raceWin: 3,
  raceLose: 3,
  crash: 1,
  levelUp: 2,
  rainStart: 2,
  rainStop: 2,
  fogStart: 2,
  fogStop: 1,
  blackoutStart: 3,
  blackoutEnd: 2,
  dawn: 2,
  morning: 1,
  dusk: 2,
  night: 1,
  flood: 2,
  report: 1,
  advert: 0,
  banter: 0,
  song: 0,
};

export const RADIO_TIMING = {
  /** Silence after a line ends, before anything but an urgent line. */
  minGap: 7,
  /** Quiet between her filler, in seconds. */
  fillerEvery: [38, 72] as const,
  /** How long before the same topic may come up again. */
  topicCooldown: 45,
  crashCooldown: 90,
  /** Seconds a line of this many characters stays up. */
  secondsPerCharacter: 0.068,
  minSeconds: 3.4,
};

const FILLERS: readonly RadioTopic[] = ['banter', 'report', 'advert', 'song', 'banter', 'report'];

export interface RadioLine {
  topic: RadioTopic;
  /** Which of the topic's lines. */
  index: number;
  seconds: number;
}

export class RadioStation {
  /** Whether she may speak at all. Silent during a countdown, or with the radio set to music only. */
  talking = true;
  private queue: RadioTopic | null = null;
  private busy = 0;
  private gap = 2;
  private filler: number;
  private fillerCursor = 0;
  private readonly cooldowns = new Map<RadioTopic, number>();
  private readonly last = new Map<RadioTopic, number>();

  constructor(
    /** How many lines each topic has. */
    private readonly countFor: (topic: RadioTopic) => number,
    /** How long a line would stay up. */
    private readonly lengthOf: (topic: RadioTopic, index: number) => number,
    private readonly random: () => number = Math.random,
  ) {
    this.filler = RADIO_TIMING.fillerEvery[0];
  }

  /** Asks for a topic. The most important request wins, and the rest are forgotten. */
  request(topic: RadioTopic): void {
    if (!this.talking || (this.cooldowns.get(topic) ?? 0) > 0) return;
    if (this.queue && PRIORITY[this.queue] > PRIORITY[topic]) return;
    this.queue = topic;
  }

  /** Moves on. @returns a line to say now, if it is time for one */
  update(dt: number): RadioLine | null {
    for (const [topic, remaining] of this.cooldowns) {
      if (remaining > 0) this.cooldowns.set(topic, remaining - dt);
    }
    if (this.busy > 0) {
      this.busy -= dt;
      return null;
    }
    this.gap -= dt;
    this.filler -= dt;
    if (!this.talking) {
      this.queue = null;
      return null;
    }
    if (!this.queue && this.filler <= 0) {
      this.queue = FILLERS[this.fillerCursor % FILLERS.length];
      this.fillerCursor++;
    }
    if (!this.queue) return null;
    // Only the big moments may cut the quiet short.
    if (this.gap > 0 && PRIORITY[this.queue] < 3) return null;
    const topic = this.queue;
    this.queue = null;
    return this.speak(topic);
  }

  private speak(topic: RadioTopic): RadioLine | null {
    const count = this.countFor(topic);
    if (count === 0) return null;
    let index = Math.floor(this.random() * count);
    if (count > 1 && index === this.last.get(topic)) index = (index + 1) % count;
    this.last.set(topic, index);
    const seconds = Math.max(RADIO_TIMING.minSeconds, this.lengthOf(topic, index) * RADIO_TIMING.secondsPerCharacter);
    this.busy = seconds;
    this.gap = RADIO_TIMING.minGap;
    const [low, high] = RADIO_TIMING.fillerEvery;
    this.filler = seconds + low + this.random() * (high - low);
    this.cooldowns.set(topic, topic === 'crash' ? RADIO_TIMING.crashCooldown : RADIO_TIMING.topicCooldown);
    return { topic, index, seconds };
  }

  /** Clears anything waiting, for example when a race begins. */
  hush(): void {
    this.queue = null;
    this.gap = Math.max(this.gap, RADIO_TIMING.minGap);
  }
}
