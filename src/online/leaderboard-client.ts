/**
 * Talks to the leaderboard. Every call gives up after a few seconds and says so, so a slow or
 * missing server never holds the game up: the board then shows what this machine knows.
 */

import { GHOST } from '../config/extras';
import { LEADERBOARD } from '../config/online';
import { decodeGhost, encodeGhost, type GhostTrack } from '../ghost/ghost-track';
import { getSettings } from '../save/settings';
import type { PublicEntry } from './leaderboard-core';

const CLIENT_KEY = 'beporowa:v1:clientId';

export interface BoardView {
  board: string;
  order: 'time' | 'score';
  entries: PublicEntry[];
  total: number;
}

export type Answer<T> = { ok: true; value: T } | { ok: false; reason: 'offline' | 'refused'; code?: string };

/** A random id for this install, so one player holds one place on each board. Never personal. */
export function clientId(): string {
  try {
    const saved = localStorage.getItem(CLIENT_KEY);
    if (saved && /^[A-Za-z0-9-]{8,64}$/.test(saved)) return saved;
    const fresh = crypto.randomUUID();
    localStorage.setItem(CLIENT_KEY, fresh);
    return fresh;
  } catch {
    return 'guest-0000-0000';
  }
}

async function call(url: string, init?: RequestInit): Promise<Answer<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEADERBOARD.timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) return { ok: false, reason: response.status === 404 && !body?.error ? 'offline' : 'refused', code: body?.error };
    return { ok: true, value: body };
  } catch {
    return { ok: false, reason: 'offline' };
  } finally {
    clearTimeout(timer);
  }
}

export class LeaderboardClient {
  constructor(private readonly endpoint: string = LEADERBOARD.endpoint) {}

  async board(board: string): Promise<Answer<BoardView>> {
    const answer = await call(`${this.endpoint}?board=${encodeURIComponent(board)}`);
    if (!answer.ok) return answer;
    const value = answer.value as BoardView;
    return Array.isArray(value?.entries) ? { ok: true, value } : { ok: false, reason: 'offline' };
  }

  async ghost(board: string, entryId: string): Promise<GhostTrack | null> {
    const answer = await call(`${this.endpoint}?board=${encodeURIComponent(board)}&ghost=${encodeURIComponent(entryId)}`);
    return answer.ok ? decodeGhost(answer.value, Math.ceil(GHOST.maxSeconds * 30) + 2) : null;
  }

  /** Sends a run. @returns the board as it now stands, with this run's place */
  async submit(board: string, score: number, carId: string, ghost: GhostTrack | null, name: string): Promise<Answer<BoardView & { rank: number | null; improved: boolean }>> {
    const packet = ghost ? encodeGhost(ghost) : null;
    const answer = await call(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ board, value: Math.round(score), carId, clientId: clientId(), name, ghost: packet ?? undefined }),
    });
    if (!answer.ok) return answer;
    const value = answer.value as (BoardView & { rank: number | null; improved: boolean }) | null;
    // A host without the function answers with the page itself, which is no board at all.
    return value && Array.isArray(value.entries) ? { ok: true, value } : { ok: false, reason: 'offline' };
  }
}

/** The name shown online: the one the player chose, or a plain one made from this install. */
export function onlineName(fallback: (digits: string) => string): string {
  const chosen = getSettings().onlineName.trim();
  if (chosen) return chosen;
  const digits = String(parseInt(clientId().replace(/[^0-9a-f]/gi, '').slice(0, 6) || '0', 16) % 10000).padStart(4, '0');
  return fallback(digits);
}
