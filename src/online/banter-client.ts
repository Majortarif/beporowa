/**
 * Fresh rival and DJ lines, written live, when the player has turned them on.
 * Lines are fetched ahead of time and kept ready, so a taunt never waits on the network:
 * when no fresh line is ready, the game simply uses one written by hand.
 */

import { BANTER } from '../config/online';
import { getLocale } from '../i18n';
import { getSettings } from '../save/settings';
import { RADIO_TOPICS, TAUNT_TOPICS, type BanterRequest } from './banter-core';

type State = 'unknown' | 'working' | 'unavailable';

export class BanterClient {
  private readonly ready = new Map<string, string[]>();
  private readonly queue: BanterRequest[] = [];
  private busy = false;
  private state: State = 'unknown';
  /** Failures in a row; enough of them and the session stops asking. */
  private failures = 0;

  constructor(private readonly endpoint: string = BANTER.endpoint) {}

  get enabled(): boolean {
    return getSettings().aiBanter && this.state !== 'unavailable';
  }

  /** Whether the server said no writer is set up for this site. */
  get unavailable(): boolean {
    return this.state === 'unavailable';
  }

  private static key(request: Pick<BanterRequest, 'kind' | 'topic' | 'rivalId' | 'locale'>): string {
    return `${request.locale}:${request.kind}:${request.rivalId ?? ''}:${request.topic}`;
  }

  /** Gets fresh lines ready for a rival's race. */
  warmRival(rivalId: string): void {
    for (const topic of TAUNT_TOPICS) this.want({ kind: 'taunt', topic, rivalId, locale: getLocale() });
  }

  /** Gets one fresh line ready for each of a few radio moments. */
  warmRadio(topics: readonly string[]): void {
    for (const topic of topics) {
      if ((RADIO_TOPICS as readonly string[]).includes(topic)) this.want({ kind: 'radio', topic, locale: getLocale() });
    }
  }

  /** A fresh rival line, if one is ready. Taking one asks for the next. */
  takeTaunt(rivalId: string, topic: string): string | null {
    if (!(TAUNT_TOPICS as readonly string[]).includes(topic)) return null;
    return this.take({ kind: 'taunt', topic, rivalId, locale: getLocale() });
  }

  /** A fresh DJ line, if one is ready. Taking one asks for the next. */
  takeRadio(topic: string): string | null {
    if (!(RADIO_TOPICS as readonly string[]).includes(topic)) return null;
    return this.take({ kind: 'radio', topic, locale: getLocale() });
  }

  private take(request: BanterRequest): string | null {
    if (!this.enabled) return null;
    const lines = this.ready.get(BanterClient.key(request));
    const line = lines?.shift() ?? null;
    this.want(request);
    return line;
  }

  private want(request: BanterRequest): void {
    if (!this.enabled) return;
    const key = BanterClient.key(request);
    const have = this.ready.get(key)?.length ?? 0;
    const waiting = this.queue.filter((item) => BanterClient.key(item) === key).length;
    if (have + waiting >= BANTER.prefetch) return;
    this.queue.push(request);
    void this.pump();
  }

  /** One request at a time, so the game never floods the server. */
  private async pump(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length > 0 && this.enabled) {
      const request = this.queue.shift() as BanterRequest;
      const line = await this.fetchLine(request);
      if (line) {
        const key = BanterClient.key(request);
        const lines = this.ready.get(key) ?? [];
        lines.push(line);
        this.ready.set(key, lines);
      }
    }
    this.busy = false;
  }

  private async fetchLine(request: BanterRequest): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BANTER.timeoutMs);
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as { text?: string; error?: string } | null;
      if (response.status === 503 || response.status === 404 || (response.ok && !body)) {
        // No writer on this site, or no function at all: stop asking for this visit.
        this.state = 'unavailable';
        this.queue.length = 0;
        return null;
      }
      if (!response.ok || typeof body?.text !== 'string') {
        this.noteFailure();
        return null;
      }
      this.state = 'working';
      this.failures = 0;
      return body.text;
    } catch {
      this.noteFailure();
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private noteFailure(): void {
    this.failures++;
    if (this.failures >= 4) {
      this.state = 'unavailable';
      this.queue.length = 0;
    }
  }

  /** Forgets every ready line, such as when the language changes. */
  clear(): void {
    this.ready.clear();
    this.queue.length = 0;
  }
}

/** The one writer client for the whole game. */
export const banter = new BanterClient();
