/** Typed event bus: simulation code emits, presentation systems listen. */

export interface GameEvents {
  impact: { strength: number; x: number; y: number; z: number };
  gearChange: { gear: number; up: boolean };
  backfire: Record<string, never>;
  driftEnd: { points: number; tier: number };
  lapComplete: { timeMs: number; isBest: boolean; lap: number };
  nitroStart: Record<string, never>;
  carReset: Record<string, never>;
  nearMiss: { squeeze: boolean; points: number; nitro: number };
  trafficHit: { agent: number; strength: number; x: number; y: number; z: number; soft: boolean };
  hornPattern: { kind: HornPattern };
  pursuitPhase: { phase: 'calm' | 'pursuit' | 'evading'; previous: 'calm' | 'pursuit' | 'evading' };
  heatLevel: { stars: number; previous: number };
  pursuitEscaped: { stars: number; seconds: number; points: number };
  pursuitBusted: { stars: number; seconds: number; fine: number };
  policeRadio: { category: RadioCategory };
  trapSprung: { x: number; y: number; z: number; stunned: number; kind: string };
  spikeHit: Record<string, never>;
  policeContact: { x: number; y: number; z: number; pit: boolean };
  raceCountdown: { step: number };
  raceStarted: Record<string, never>;
  raceLaunch: { perfect: boolean };
  raceShift: { perfect: boolean };
  raceGate: { index: number };
  raceLap: { lap: number; seconds: number; last: boolean };
  raceLeg: { leg: number };
  raceFinished: { completed: boolean };
  targetHit: { x: number; y: number; z: number; strength: number };
  targetDown: { x: number; y: number; z: number; left: number };
  cargoHit: { cargo: number };
  potholeHit: { x: number; y: number; z: number };
}

export type RadioCategory =
  | 'pursuitStart'
  | 'heatUp'
  | 'chief'
  | 'lost'
  | 'found'
  | 'boxIn'
  | 'pit'
  | 'roadblock'
  | 'spike'
  | 'drone'
  | 'heli'
  | 'trap'
  | 'horn'
  | 'escape'
  | 'bust';

export type HornPattern = 'tap' | 'double' | 'triple' | 'long';

type Listener<T> = (payload: T) => void;

export class EventBus {
  private listeners = new Map<keyof GameEvents, Listener<never>[]>();

  on<K extends keyof GameEvents>(type: K, listener: Listener<GameEvents[K]>): () => void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener as Listener<never>);
    this.listeners.set(type, list);
    return () => {
      const index = list.indexOf(listener as Listener<never>);
      if (index >= 0) list.splice(index, 1);
    };
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const list = this.listeners.get(type);
    if (!list) return;
    for (const listener of list) (listener as Listener<GameEvents[K]>)(payload);
  }
}
