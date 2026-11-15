/** The police radio: turns pursuit events into Bangla lines, spaced out so it never babbles. */

import { POLICE } from '../config/police-tuning';
import type { EventBus, RadioCategory } from '../core/events';
import { tList } from '../i18n';

/** These cut through whatever is being said. */
const URGENT: ReadonlySet<RadioCategory> = new Set<RadioCategory>(['pursuitStart', 'chief', 'escape', 'bust', 'trap']);

export class PoliceRadio {
  private readonly cooldowns = new Map<RadioCategory, number>();
  private readonly lastLine = new Map<RadioCategory, number>();
  private pending: RadioCategory | null = null;
  private gap = 0;

  constructor(
    bus: EventBus,
    private readonly speak: (line: string, category: RadioCategory) => void,
    private readonly place: () => string,
  ) {
    bus.on('policeRadio', ({ category }) => this.request(category));
  }

  private request(category: RadioCategory): void {
    if ((this.cooldowns.get(category) ?? 0) > 0) return;
    if (this.pending && URGENT.has(this.pending) && !URGENT.has(category)) return;
    this.pending = category;
    if (URGENT.has(category)) this.gap = 0;
  }

  update(dt: number): void {
    this.gap -= dt;
    for (const [category, remaining] of this.cooldowns) {
      if (remaining > 0) this.cooldowns.set(category, remaining - dt);
    }
    if (!this.pending || this.gap > 0) return;
    const category = this.pending;
    this.pending = null;
    const lines = tList(`police.radio.${category}`);
    if (lines.length === 0) return;
    // Never the same line twice in a row.
    let index = Math.floor(Math.random() * lines.length);
    if (lines.length > 1 && index === this.lastLine.get(category)) index = (index + 1) % lines.length;
    this.lastLine.set(category, index);
    this.gap = POLICE.radio.minGapSeconds;
    this.cooldowns.set(category, POLICE.radio.categoryCooldownSeconds);
    this.speak(lines[index].replace('{place}', this.place()), category);
  }

  clear(): void {
    this.pending = null;
    this.cooldowns.clear();
    this.gap = 0;
  }
}
