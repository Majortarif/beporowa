/**
 * The optional banter writer's rules: which lines may be asked for, the brief the model gets,
 * and the checks every line must pass before a player sees it. Shared by the Netlify Function,
 * the dev server and the tests. The model itself is handed in, so tests never call it.
 */

import { BANTER } from '../config/online';
import { RIVALS } from '../config/rivals';
import { checkSlogan } from '../garage/slogan-filter';
import bn from '../i18n/bn.json';
import en from '../i18n/en.json';
import type { KeyValueStore } from './leaderboard-core';

export type BanterKind = 'taunt' | 'radio';

/** What a rival can say a fresh line about. */
export const TAUNT_TOPICS = ['passed', 'passing', 'bump', 'provoked', 'finishFirst'] as const;
/** What the DJ can say a fresh line about. Topics that name places or adverts stay written by hand. */
export const RADIO_TOPICS = ['heat1', 'heat3', 'heat5', 'escaped', 'busted', 'raceWin', 'raceLose', 'crash', 'rainStart', 'rainStop', 'fogStart', 'fogStop', 'blackoutStart', 'blackoutEnd', 'dawn', 'dusk', 'night', 'banter'] as const;

export interface BanterRequest {
  kind: BanterKind;
  topic: string;
  rivalId?: string;
  locale: 'bn' | 'en';
}

/** The brief for one line. */
export interface BanterPrompt {
  system: string;
  user: string;
}

/** Writes one line from a brief. @returns the line, or null if the model would not or could not */
export type BanterWriter = (prompt: BanterPrompt) => Promise<string | null>;

export interface BanterDeps {
  store: KeyValueStore;
  now(): number;
  clientIp: string;
  /** Null when no key is set: the endpoint then says it is not set up. */
  write: BanterWriter | null;
  salt?: string;
}

/** Words that pull a line toward religion or politics, which this game leaves alone. */
const OFF_LIMITS = ['আল্লাহ', 'ভগবান', 'ঈশ্বর', 'নামাজ', 'পূজা', 'মসজিদ', 'মন্দির', 'হিন্দু', 'মুসলিম', 'বৌদ্ধ', 'খ্রিস্টান', 'আওয়ামী', 'বিএনপি', 'জামায়াত', 'নির্বাচন', 'মন্ত্রী', 'সরকার', 'হাসিনা', 'খালেদা', 'মোদি', 'allah', 'god', 'temple', 'mosque', 'hindu', 'muslim', 'election', 'minister', 'government', 'party'];

type Dictionary = Record<string, unknown>;

function lookup(root: Dictionary, path: string): unknown {
  let node: unknown = root;
  for (const part of path.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Dictionary)[part];
  }
  return node;
}

function examples(locale: 'bn' | 'en', path: string): string[] {
  const value = lookup((locale === 'bn' ? bn : en) as Dictionary, path);
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === 'string').slice(0, 3) : [];
}

/** Checks a request. @returns the request, or null if it asks for something not on offer */
export function parseBanterRequest(raw: unknown): BanterRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const request = raw as Partial<BanterRequest>;
  if (request.locale !== 'bn' && request.locale !== 'en') return null;
  if (request.kind === 'taunt') {
    if (!(TAUNT_TOPICS as readonly string[]).includes(request.topic ?? '')) return null;
    if (!RIVALS.some((rival) => rival.id === request.rivalId)) return null;
    return { kind: 'taunt', topic: request.topic as string, rivalId: request.rivalId, locale: request.locale };
  }
  if (request.kind === 'radio') {
    if (!(RADIO_TOPICS as readonly string[]).includes(request.topic ?? '')) return null;
    return { kind: 'radio', topic: request.topic as string, locale: request.locale };
  }
  return null;
}

const SITUATIONS: Readonly<Record<string, string>> = {
  passed: 'the player has just overtaken this rival',
  passing: 'this rival has just overtaken the player',
  bump: 'the player has just bumped this rival’s car',
  provoked: 'the player has just honked twice at this rival to wind them up',
  finishFirst: 'this rival has just crossed the finish line ahead of the player',
  heat1: 'the police have just started chasing the player',
  heat3: 'the chase has grown to three stars',
  heat5: 'the chase is at five stars, the whole special unit is out',
  escaped: 'the player has just shaken off the police',
  busted: 'the police have just stopped the player’s car (nobody is hurt; it is a fine)',
  raceWin: 'the player has just won a race',
  raceLose: 'the player has just lost a race',
  crash: 'the player has just hit something hard (nobody is hurt)',
  rainStart: 'monsoon rain has just started',
  rainStop: 'the rain has just stopped',
  fogStart: 'thick fog is rolling in',
  fogStop: 'the fog is lifting',
  blackoutStart: 'the power has just gone out across the area (load-shedding)',
  blackoutEnd: 'the power has just come back',
  dawn: 'it is first light',
  dusk: 'the sun is setting',
  night: 'night has fallen',
  banter: 'a quiet stretch of driving, time for a little chat',
};

/** The brief for one line: who speaks, what just happened, and the rules every line keeps. */
export function buildPrompt(request: BanterRequest): BanterPrompt {
  const language = request.locale === 'bn' ? 'colloquial Bangla in Bengali script, the way young people in Dhaka speak, with no English words and no Latin letters' : 'casual English';
  const system = [
    'You write single lines of dialogue for বেপরোয়া (Beporowa), an original arcade street-racing game set in বর্ষাবাদ, a made-up city inspired by Dhaka.',
    'The tone is playful swagger, like friendly rivals ribbing each other. It is a game: nobody is ever hurt, and the police are a fictional, slightly comic unit.',
    `Write in ${language}.`,
    'Rules for every line: one sentence, at most 14 words. No swearing, slurs, insults about looks, family, gender, religion, caste, region or any group. No religion or politics. No real people, real companies, brands or real car names. No real places other than the made-up city. Never encourage dangerous driving in real life, drink or drugs.',
    'Reply with the line alone: no quotation marks, no explanation, no translation.',
  ].join('\n');
  let speaker: string;
  let path: string;
  if (request.kind === 'taunt' && request.rivalId) {
    const english = lookup(en as Dictionary, `rival.${request.rivalId}`) as Dictionary | undefined;
    const nick = lookup((request.locale === 'bn' ? bn : en) as Dictionary, `rival.${request.rivalId}.nick`);
    speaker = `The speaker is the rival racer "${String(nick ?? '')}". Their driving: ${String(english?.style ?? '')}. Their story: ${String(english?.bio ?? '')}. They are talking to the player.`;
    path = `rival.${request.rivalId}.${request.topic}`;
  } else {
    speaker = 'The speaker is RJ Tuntuni, the cheerful late-night host of the pirate-style station Radio Jhor, talking to everyone driving around the city tonight.';
    path = `radio.lines.${request.topic}`;
  }
  const shown = examples(request.locale, path);
  const user = [
    speaker,
    `What just happened: ${SITUATIONS[request.topic] ?? request.topic}.`,
    shown.length > 0 ? `Lines already written for this moment, to match in voice but not to repeat:\n${shown.map((line) => `- ${line}`).join('\n')}` : '',
    'Write one new line.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system, user };
}

/**
 * Checks a line the model wrote. The brief asks for a clean line, and this makes sure of it.
 * @returns the line, tidied, or null if it must not be shown
 */
export function cleanLine(raw: string | null, locale: 'bn' | 'en'): string | null {
  if (!raw) return null;
  const first = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? '';
  const line = first.replace(/^[-–—•*"'“”‘’«»]+|["'“”‘’«»]+$/g, '').trim();
  if (line.length < 2 || line.length > BANTER.maxChars) return null;
  if (locale === 'bn' && (!/[ঀ-৿]/.test(line) || /[A-Za-z]/.test(line))) return null;
  if (checkSlogan(line.slice(0, 200)) === 'rude') return null;
  const lower = line.toLowerCase();
  if (OFF_LIMITS.some((word) => (/^[a-z]+$/.test(word) ? new RegExp(`\\b${word}\\b`).test(lower) : lower.includes(word)))) return null;
  return line;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
}

/** Answers one request for a line. */
export async function handleBanter(request: Request, deps: BanterDeps): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (!deps.write) return json({ error: 'notConfigured' }, 503);
  const text = await request.text();
  if (text.length > 2000) return json({ error: 'tooLarge' }, 413);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return json({ error: 'badJson' }, 400);
  }
  const parsed = parseBanterRequest(raw);
  if (!parsed) return json({ error: 'badRequest' }, 400);

  const now = deps.now();
  const who = await sha256(`${deps.salt ?? ''}|banter|${deps.clientIp}`);
  const rateKey = `banter-rate/${who}`;
  const recent = ((await deps.store.get(rateKey)) as number[] | null)?.filter((time) => now - time < BANTER.rateWindowMs) ?? [];
  if (recent.length >= BANTER.rateMax) return json({ error: 'slowDown' }, 429);
  const dayKey = `banter-day/${new Date(now).toISOString().slice(0, 10)}`;
  const used = Number((await deps.store.get(dayKey)) ?? 0);
  if (used >= BANTER.dailyCap) return json({ error: 'dailyCap' }, 429);
  recent.push(now);
  await deps.store.set(rateKey, recent);
  await deps.store.set(dayKey, used + 1);

  let line: string | null = null;
  try {
    line = cleanLine(await deps.write(buildPrompt(parsed)), parsed.locale);
  } catch {
    line = null;
  }
  return line ? json({ text: line }) : json({ error: 'noLine' }, 502);
}
