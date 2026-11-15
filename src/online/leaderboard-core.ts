/**
 * The leaderboard's rules, shared by the Netlify Function, the dev server and the tests.
 * It knows nothing of where data lives: a store is handed in. Every request is treated as
 * hostile until checked. A browser game can never be made cheat-proof; these checks only make
 * an honest board hard to spoil by accident or with a quick edit.
 */

import { CHALLENGE_BY_ID } from '../config/challenges';
import { LEADERBOARD } from '../config/online';
import { EVENT_BY_ID, TAKEDOWN_START, type RaceEventDef } from '../config/race-events';
import { checkSlogan, visibleLength } from '../garage/slogan-filter';
import { challengeDay, challengeWeek, dailyChallengeFor, previousDay, weeklyChallengeFor } from '../challenges/challenge-calendar';
import { decodeGhost, ghostDuration, ghostTopSpeed, type GhostPacket } from '../ghost/ghost-track';
import { NODES } from '../world/city/city-map';
import { GHOST } from '../config/extras';

/** Somewhere to keep JSON by key. Netlify Blobs in production, a Map in tests and on the dev server. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();

  async get(key: string): Promise<unknown> {
    const raw = this.data.get(key);
    return raw === undefined ? null : JSON.parse(raw);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.data.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export interface LeaderboardDeps {
  store: KeyValueStore;
  now(): number;
  /** The caller's address. Only a salted hash of it is ever kept. */
  clientIp: string;
  salt?: string;
}

export type BoardOrder = 'time' | 'score';

/** A board, worked out from its key. */
export interface BoardSpec {
  key: string;
  order: BoardOrder;
  /** The event run on it, if any. */
  event: RaceEventDef | null;
  /** A time board on an event must carry a ghost, as proof the run happened. */
  needsGhost: boolean;
  /** The shortest and longest value the board accepts. */
  min: number;
  max: number;
}

export interface PublicEntry {
  id: string;
  rank: number;
  name: string;
  value: number;
  carId: string;
  ghost: boolean;
  at: number;
}

interface StoredEntry {
  id: string;
  /** A salted hash of the player's install id, so one player holds one place. */
  who: string;
  name: string;
  value: number;
  carId: string;
  ghost: boolean;
  at: number;
}

interface StoredBoard {
  entries: StoredEntry[];
}

export interface Submission {
  board: string;
  name: string;
  value: number;
  carId: string;
  clientId: string;
  ghost?: GhostPacket;
}

const BOARD_PATTERN = /^(event):([A-Za-z0-9]{1,32})$|^(daily):(\d{4}-\d{2}-\d{2}):([A-Za-z0-9]{1,32})$|^(weekly):(\d{4}-W\d{2}):([A-Za-z0-9]{1,32})$/;
const CAR_PATTERN = /^[a-z0-9]{1,24}$/;
const CLIENT_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

/** The least distance a race could cover: straight lines between its nodes, lap after lap. */
export function straightLineDistance(event: RaceEventDef): number {
  const ids = event.course?.nodes ?? event.gates ?? TAKEDOWN_START;
  let total = 0;
  for (let i = 1; i < ids.length; i++) {
    const a = NODES.find((node) => node.id === ids[i - 1]);
    const b = NODES.find((node) => node.id === ids[i]);
    if (a && b) total += Math.hypot(b.x - a.x, b.z - a.z);
  }
  return total * (event.course ? (event.laps ?? 1) : 1);
}

function startNode(event: RaceEventDef): { x: number; z: number } | null {
  const id = (event.course?.nodes ?? event.gates ?? TAKEDOWN_START)[0];
  return NODES.find((node) => node.id === id) ?? null;
}

function timeBoundsFor(event: RaceEventDef): { min: number; max: number } {
  const floor = ((straightLineDistance(event) * LEADERBOARD.straightLineShare) / LEADERBOARD.maxAverageSpeed) * 1000;
  return { min: Math.max(LEADERBOARD.minRunMs, Math.round(floor)), max: GHOST.maxSeconds * 1000 };
}

/**
 * Reads a board key, checking that the board can exist right now.
 * @returns the board, or null for any key that is not a real board today
 */
export function parseBoard(key: string, now: number): BoardSpec | null {
  const match = BOARD_PATTERN.exec(key);
  if (!match) return null;
  if (match[1] === 'event') {
    const event = EVENT_BY_ID.get(match[2]);
    if (!event || GHOST.skipModes.includes(event.mode)) return null;
    return { key, order: 'time', event, needsGhost: true, ...timeBoundsFor(event) };
  }
  const daily = match[3] === 'daily';
  const period = daily ? match[4] : match[7];
  const id = daily ? match[5] : match[8];
  const date = new Date(now);
  // Today's and yesterday's boards stay open, so a run started just before midnight still lands.
  if (daily) {
    const today = challengeDay(date);
    if (period !== today && period !== previousDay(today)) return null;
    if (dailyChallengeFor(period).id !== id) return null;
  } else {
    const thisWeek = challengeWeek(date);
    const lastWeek = challengeWeek(new Date(now - 7 * 86400000));
    if (period !== thisWeek && period !== lastWeek) return null;
    if (weeklyChallengeFor(period).id !== id) return null;
  }
  const def = CHALLENGE_BY_ID.get(id);
  if (!def || def.rank === 'none') return null;
  const event = def.eventId ? (EVENT_BY_ID.get(def.eventId) ?? null) : null;
  if (def.rank === 'score') return { key, order: 'score', event, needsGhost: false, min: 1, max: LEADERBOARD.maxScore };
  if (event) return { key, order: 'time', event, needsGhost: true, ...timeBoundsFor(event) };
  // The escape is timed from the call to the getaway, with no ghost to show.
  const limit = def.goal.kind === 'escape' ? def.goal.seconds : 300;
  return { key, order: 'time', event: null, needsGhost: false, min: 10000, max: (limit + 60) * 1000 };
}

/** Cleans a name, or says why it cannot be used. */
export function cleanName(raw: unknown): { name: string } | { error: string } {
  if (typeof raw !== 'string') return { error: 'badName' };
  // Control characters and zero-width marks go; runs of space become one.
  const name = raw.normalize('NFC').replace(/[\u0000-\u001f\u007f​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length === 0) return { error: 'badName' };
  if (visibleLength(name) > LEADERBOARD.nameMax) return { error: 'longName' };
  if (checkSlogan(name) === 'rude') return { error: 'rudeName' };
  return { name };
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storeKey(board: string): string {
  return `board/${board.replace(/:/g, '/')}`;
}

function ghostKey(board: string, entryId: string): string {
  return `ghost/${board.replace(/:/g, '/')}/${entryId}`;
}

function sortEntries(entries: StoredEntry[], order: BoardOrder): void {
  entries.sort((a, b) => (order === 'time' ? a.value - b.value : b.value - a.value) || a.at - b.at);
}

function toPublic(entries: readonly StoredEntry[], count: number): PublicEntry[] {
  return entries.slice(0, count).map((entry, index) => ({ id: entry.id, rank: index + 1, name: entry.name, value: entry.value, carId: entry.carId, ghost: entry.ghost, at: entry.at }));
}

async function readBoard(store: KeyValueStore, board: string): Promise<StoredEntry[]> {
  const raw = (await store.get(storeKey(board))) as StoredBoard | null;
  return raw && Array.isArray(raw.entries) ? raw.entries : [];
}

/** Checks a submission against its board. @returns an error code, or null if it looks honest */
export function checkSubmission(spec: BoardSpec, submission: Submission): string | null {
  const { value, carId, ghost } = submission;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < spec.min || value > spec.max) return 'implausible';
  if (typeof carId !== 'string' || !CAR_PATTERN.test(carId)) return 'badCar';
  if (!spec.needsGhost) return null;
  if (!ghost) return 'noGhost';
  const track = decodeGhost(ghost, Math.ceil(GHOST.maxSeconds * 30) + 2);
  const event = spec.event;
  if (!track || !event || track.eventId !== event.id || track.carId !== carId) return 'badGhost';
  if (Math.abs(track.timeMs - value) > 100) return 'badGhost';
  if (Math.abs(ghostDuration(track) - value / 1000) > 0.5 + 1 / track.hz) return 'badGhost';
  if (ghostTopSpeed(track) > LEADERBOARD.maxSampleSpeed) return 'implausible';
  const start = startNode(event);
  if (start && Math.hypot(track.frames[0] - start.x, track.frames[2] - start.z) > LEADERBOARD.startRadius) return 'badGhost';
  return null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Lets a connection through, or not, keeping only a hash of who it was. */
async function allowPost(deps: LeaderboardDeps): Promise<boolean> {
  const who = await sha256(`${deps.salt ?? ''}|ip|${deps.clientIp}`);
  const key = `rate/${who}`;
  const now = deps.now();
  const raw = (await deps.store.get(key)) as number[] | null;
  const recent = (Array.isArray(raw) ? raw : []).filter((time) => typeof time === 'number' && now - time < LEADERBOARD.rateWindowMs);
  if (recent.length >= LEADERBOARD.rateMax) return false;
  recent.push(now);
  await deps.store.set(key, recent);
  return true;
}

/** Answers one request: GET a board or a ghost, or POST a run. */
export async function handleLeaderboard(request: Request, deps: LeaderboardDeps): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET') {
    const board = url.searchParams.get('board') ?? '';
    const spec = parseBoard(board, deps.now());
    if (!spec) return json({ error: 'noBoard' }, 404);
    const ghostId = url.searchParams.get('ghost');
    if (ghostId !== null) {
      if (!/^[a-z0-9]{6,24}$/.test(ghostId)) return json({ error: 'noGhost' }, 404);
      const packet = await deps.store.get(ghostKey(board, ghostId));
      return packet ? json(packet) : json({ error: 'noGhost' }, 404);
    }
    const entries = await readBoard(deps.store, board);
    return json({ board, order: spec.order, entries: toPublic(entries, LEADERBOARD.shown), total: entries.length });
  }
  if (request.method !== 'POST') return json({ error: 'method' }, 405);

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (declared > LEADERBOARD.maxBodyBytes) return json({ error: 'tooLarge' }, 413);
  const text = await request.text();
  if (text.length > LEADERBOARD.maxBodyBytes) return json({ error: 'tooLarge' }, 413);
  let submission: Submission;
  try {
    submission = JSON.parse(text) as Submission;
  } catch {
    return json({ error: 'badJson' }, 400);
  }
  if (typeof submission !== 'object' || submission === null || typeof submission.board !== 'string') return json({ error: 'noBoard' }, 404);
  const spec = parseBoard(submission.board, deps.now());
  if (!spec) return json({ error: 'noBoard' }, 404);
  if (typeof submission.clientId !== 'string' || !CLIENT_PATTERN.test(submission.clientId)) return json({ error: 'badClient' }, 400);
  const named = cleanName(submission.name);
  if ('error' in named) return json({ error: named.error }, 400);
  const problem = checkSubmission(spec, submission);
  if (problem) return json({ error: problem }, 422);
  if (!(await allowPost(deps))) return json({ error: 'slowDown' }, 429);

  const who = await sha256(`${deps.salt ?? ''}|client|${submission.clientId}`);
  const entries = await readBoard(deps.store, submission.board);
  const mine = entries.find((entry) => entry.who === who);
  const better = !mine || (spec.order === 'time' ? submission.value < mine.value : submission.value > mine.value);
  let entryId = mine?.id ?? '';
  if (better) {
    if (mine) {
      entries.splice(entries.indexOf(mine), 1);
      if (mine.ghost) await deps.store.delete(ghostKey(submission.board, mine.id));
    }
    entryId = (await sha256(`${who}|${deps.now()}|${Math.random()}`)).slice(0, 12);
    entries.push({ id: entryId, who, name: named.name, value: submission.value, carId: submission.carId, ghost: false, at: deps.now() });
    sortEntries(entries, spec.order);
    // Only the top few keep a ghost, and the board keeps only so many places.
    const rank = entries.findIndex((entry) => entry.id === entryId);
    if (rank >= 0 && rank < LEADERBOARD.ghostsKept && submission.ghost) {
      await deps.store.set(ghostKey(submission.board, entryId), submission.ghost);
      entries[rank].ghost = true;
    }
    for (let i = LEADERBOARD.ghostsKept; i < entries.length; i++) {
      if (entries[i].ghost) {
        entries[i].ghost = false;
        await deps.store.delete(ghostKey(submission.board, entries[i].id));
      }
    }
    for (const dropped of entries.splice(LEADERBOARD.keep)) {
      if (dropped.ghost) await deps.store.delete(ghostKey(submission.board, dropped.id));
    }
    await deps.store.set(storeKey(submission.board), { entries } satisfies StoredBoard);
  }
  const index = entries.findIndex((entry) => entry.id === entryId);
  return json({ ok: true, improved: better, rank: index >= 0 ? index + 1 : null, entries: toPublic(entries, LEADERBOARD.shown), total: entries.length });
}
