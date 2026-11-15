/**
 * The player's whole game: place in the Ring, money, cars, what has been done.
 * Kept in IndexedDB with a schema number, so old saves can be brought forward.
 * If IndexedDB is not available it falls back to localStorage, then to memory for this visit.
 */

import type { StatKey } from '../config/achievements';
import { CAR_BY_ID, PART_KINDS, type LiveryDef, type PartKind } from '../config/cars';
import { PROGRESS } from '../config/progression';
import { createMemory, type MemoryData } from '../race/rival-memory';

const LEGACY_KEY = 'beporowa:v1:career';
const FALLBACK_KEY = 'beporowa:v2:save';
const DB_NAME = 'beporowa';
const STORE = 'save';
const RECORD = 'main';

export const SAVE_SCHEMA = 3;

export interface EventRecord {
  /** 0 none, 1 bronze, 2 silver, 3 gold. */
  medal: number;
  bestMs: number | null;
  bestScore: number | null;
  completed: boolean;
}

export interface OwnedCar {
  parts: Record<PartKind, number>;
  livery: LiveryDef;
}

export interface SavePose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface ActiveJob {
  id: string;
  /** The count the job's stat stood at when it began. */
  startValue: number;
  /** Seconds left, for jobs on a clock. */
  secondsLeft: number;
}

/** One challenge on one day or week. */
export interface ChallengeRecord {
  done: boolean;
  /** Best time in ms, or best points, whichever the challenge ranks by. */
  best: number | null;
  attempts: number;
}

export interface SeasonState {
  id: string;
  xp: number;
  /** Tiers whose reward has been collected. */
  claimed: number[];
}

export interface CareerData {
  schema: number;
  /** Reputation. Earned by racing, and sets the player's level. */
  ringPoints: number;
  /** Lowest rank beaten so far. 11 means nobody yet. */
  rank: number;
  events: Record<string, EventRecord>;
  memory: MemoryData;
  /** Every event and car open, for anyone who only wants to see them. */
  freePlay: boolean;
  /** The ring's story has been told. */
  introSeen: boolean;
  /** The last rival has been beaten. */
  champion: boolean;

  cash: number;
  cars: Record<string, OwnedCar>;
  selectedCar: string;
  /** 100 is perfect. Crashes wear it down. */
  condition: number;
  achievements: Record<string, boolean>;
  stats: Partial<Record<StatKey, number>>;
  daily: { lastDay: string | null; streak: number };
  job: ActiveJob | null;
  jobsDone: string[];
  /** Rumours heard, as rivalId:index. */
  clues: string[];
  /** Where the last cup of tea was drunk. The car starts there next time. */
  checkpoint: SavePose | null;
  /** Free roam with no police and no pressure. */
  addaMode: boolean;
  /** Daily and weekly challenges, keyed as day:id or week:id. Old ones are pruned. */
  challenges: Record<string, ChallengeRecord>;
  season: SeasonState;
  /** Kept for good, whatever season it is. */
  unlocks: { colours: string[]; glows: string[]; stamps: string[] };
}

export function defaultParts(): Record<PartKind, number> {
  const parts = {} as Record<PartKind, number>;
  for (const kind of PART_KINDS) parts[kind] = 0;
  return parts;
}

export function newOwnedCar(carId: string): OwnedCar {
  const car = CAR_BY_ID.get(carId);
  if (!car) throw new Error(`No such car: ${carId}`);
  return { parts: defaultParts(), livery: { ...car.livery } };
}

export function createCareer(): CareerData {
  return {
    schema: SAVE_SCHEMA,
    ringPoints: 0,
    rank: 11,
    events: {},
    memory: createMemory(),
    freePlay: false,
    introSeen: false,
    champion: false,
    cash: PROGRESS.startCash,
    cars: { bulbuli: newOwnedCar('bulbuli') },
    selectedCar: 'bulbuli',
    condition: 100,
    achievements: {},
    stats: {},
    daily: { lastDay: null, streak: 0 },
    job: null,
    jobsDone: [],
    clues: [],
    checkpoint: null,
    addaMode: false,
    challenges: {},
    season: { id: '', xp: 0, claimed: [] },
    unlocks: { colours: [], glows: [], stamps: [] },
  };
}

/** Brings any old save up to the current shape. Unknown junk gives a fresh start. */
export function migrateSave(raw: unknown): CareerData {
  const fresh = createCareer();
  if (typeof raw !== 'object' || raw === null) return fresh;
  const saved = raw as Partial<CareerData>;
  // Schema 1 was the Ring alone, with nothing about money or cars.
  const merged: CareerData = {
    ...fresh,
    ...saved,
    schema: SAVE_SCHEMA,
    memory: { ...createMemory(), ...saved.memory },
    daily: { ...fresh.daily, ...saved.daily },
    cars: { ...fresh.cars, ...saved.cars },
    challenges: { ...saved.challenges },
    season: { ...fresh.season, ...saved.season },
    unlocks: { ...fresh.unlocks, ...saved.unlocks },
  };
  // A car saved before a part or a paint option existed gets the missing pieces.
  for (const [id, car] of Object.entries(merged.cars)) {
    const def = CAR_BY_ID.get(id);
    if (!def) {
      delete merged.cars[id];
      continue;
    }
    merged.cars[id] = { parts: { ...defaultParts(), ...car.parts }, livery: { ...def.livery, ...car.livery } };
  }
  if (!merged.cars[merged.selectedCar]) merged.selectedCar = 'bulbuli';
  // Someone who already climbed the Ring before money existed is paid for it, once.
  if (saved.schema === undefined) merged.cash = fresh.cash + (saved.ringPoints ?? 0) * PROGRESS.raceCashPerPoint;
  return merged;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDatabase(): Promise<unknown> {
  if (typeof indexedDB === 'undefined') return null;
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(RECORD);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeDatabase(value: CareerData): Promise<void> {
  if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, RECORD);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function readLocal(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let current: CareerData = createCareer();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Loads the save, from wherever it is. Call once at start, before the game is built. */
export async function loadCareer(): Promise<CareerData> {
  let raw: unknown = null;
  try {
    raw = await readDatabase();
  } catch {
    raw = null;
  }
  raw = raw ?? readLocal(FALLBACK_KEY) ?? readLocal(LEGACY_KEY);
  current = migrateSave(raw);
  return current;
}

export function getCareer(): CareerData {
  return current;
}

async function writeNow(): Promise<void> {
  const snapshot = JSON.parse(JSON.stringify(current)) as CareerData;
  try {
    await writeDatabase(snapshot);
  } catch {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(snapshot));
    } catch {
      // Without storage the game still lasts until the page closes.
    }
  }
}

/** Saves soon. Many changes in a row become a single write. */
export function saveCareer(): void {
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeNow();
  }, 400);
}

/** Saves at once, for when the page might be going away. */
export function flushCareer(): void {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  void writeNow();
}

/** Starts again from nothing, for the board's reset button. */
export function resetCareer(): CareerData {
  current = createCareer();
  void clearExtras();
  try {
    localStorage.removeItem(LEGACY_KEY);
    localStorage.removeItem(FALLBACK_KEY);
  } catch {
    // Nothing to clear.
  }
  saveCareer();
  return current;
}

// ---------- Other records beside the career: ghosts and the like ----------

const EXTRA_FALLBACK = 'beporowa:v2:extra:';

/** Reads a record kept beside the career, such as a ghost. @returns null if there is none */
export async function readExtra(key: string): Promise<unknown> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const database = await openDatabase();
      const value = await new Promise<unknown>((resolve, reject) => {
        const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(`extra:${key}`);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
      if (value !== null) return value;
    }
  } catch {
    // Fall through to localStorage.
  }
  return readLocal(EXTRA_FALLBACK + key);
}

/** Keeps a record beside the career. Failure is quiet: these records are nice to have, never needed. */
export async function writeExtra(key: string, value: unknown): Promise<void> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(value, `extra:${key}`);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    try {
      localStorage.setItem(EXTRA_FALLBACK + key, JSON.stringify(value));
    } catch {
      // Without storage the record lasts until the page closes.
    }
  }
}

/** Forgets every record kept beside the career, for a full reset. */
export async function clearExtras(): Promise<void> {
  try {
    if (typeof indexedDB !== 'undefined') {
      const database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE, 'readwrite');
        transaction.objectStore(STORE).delete(IDBKeyRange.bound('extra:', 'extra:￿'));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    }
  } catch {
    // Nothing to clear.
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key?.startsWith(EXTRA_FALLBACK)) localStorage.removeItem(key);
    }
  } catch {
    // Nothing to clear.
  }
}
