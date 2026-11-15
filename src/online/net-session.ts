/**
 * One WebSocket to the friends relay: rooms, who is in them, and each other's cars.
 * Every message is checked on the way in, as it comes from someone else's machine.
 */

import { RELAY } from '../config/online';

export interface RoomPeer {
  id: number;
  name: string;
  car: string;
  spectator: boolean;
  finishMs: number | null;
}

export type NetStatus = 'off' | 'connecting' | 'open' | 'closed' | 'failed';

/** x, y, z, qx, qy, qz, qw, speed, progress. */
export type CarState = [number, number, number, number, number, number, number, number, number];

/** Where the relay lives: set at build time, or in development from ?relay= on the address. */
export function relayUrl(): string {
  const fromBuild = (import.meta.env.VITE_RELAY_URL as string | undefined) ?? '';
  if (import.meta.env.DEV) {
    try {
      const fromPage = new URLSearchParams(window.location.search).get('relay');
      if (fromPage && /^wss?:\/\//.test(fromPage)) return fromPage;
    } catch {
      // No page address, as in tests.
    }
  }
  return fromBuild;
}

function isPeer(value: unknown): value is RoomPeer {
  const peer = value as RoomPeer;
  return (
    typeof peer === 'object' &&
    peer !== null &&
    Number.isInteger(peer.id) &&
    typeof peer.name === 'string' &&
    peer.name.length <= 64 &&
    typeof peer.car === 'string' &&
    typeof peer.spectator === 'boolean' &&
    (peer.finishMs === null || typeof peer.finishMs === 'number')
  );
}

export class NetSession {
  status: NetStatus = 'off';
  myId = 0;
  roomCode: string | null = null;
  hostId = 0;
  roomEvent: string | null = null;
  peers: RoomPeer[] = [];

  onStatus: ((status: NetStatus) => void) | null = null;
  onRoster: (() => void) | null = null;
  onGo: ((eventId: string, inMs: number) => void) | null = null;
  onState: ((id: number, state: CarState) => void) | null = null;
  onFinish: ((id: number, ms: number) => void) | null = null;
  onLeft: ((id: number) => void) | null = null;
  onError: ((code: string) => void) | null = null;

  private socket: WebSocket | null = null;
  private lastSend = 0;
  private name = '';
  private car = 'bulbuli';

  get isHost(): boolean {
    return this.roomCode !== null && this.hostId === this.myId;
  }

  get me(): RoomPeer | undefined {
    return this.peers.find((peer) => peer.id === this.myId);
  }

  private setStatus(status: NetStatus): void {
    this.status = status;
    this.onStatus?.(status);
  }

  /** Opens the connection. @returns false if it could not be opened in time */
  connect(url: string, name: string, car: string): Promise<boolean> {
    this.close();
    this.name = name;
    this.car = car;
    if (!url) {
      this.setStatus('failed');
      return Promise.resolve(false);
    }
    this.setStatus('connecting');
    return new Promise((resolve) => {
      let settled = false;
      const finish = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const timer = setTimeout(() => {
        this.close();
        this.setStatus('failed');
        finish(false);
      }, RELAY.connectTimeoutMs);
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        this.setStatus('failed');
        finish(false);
        return;
      }
      this.socket = socket;
      socket.addEventListener('open', () => {
        this.setStatus('open');
        this.send({ t: 'hello', name: this.name, car: this.car });
        finish(true);
      });
      socket.addEventListener('message', (event) => this.receive(event.data));
      socket.addEventListener('close', () => {
        if (this.socket !== socket) return;
        this.socket = null;
        this.roomCode = null;
        this.peers = [];
        this.setStatus(settled ? 'closed' : 'failed');
        this.onRoster?.();
        finish(false);
      });
      socket.addEventListener('error', () => finish(false));
    });
  }

  private send(message: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private receive(data: unknown): void {
    if (typeof data !== 'string' || data.length > RELAY.maxMessageBytes * 4) return;
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    switch (message.t) {
      case 'welcome':
        if (Number.isInteger(message.id)) this.myId = message.id as number;
        break;
      case 'joined':
        if (typeof message.code === 'string') this.roomCode = message.code;
        break;
      case 'roster': {
        if (!Array.isArray(message.peers)) return;
        this.peers = message.peers.filter(isPeer).slice(0, RELAY.maxRacers + RELAY.maxSpectators);
        this.hostId = Number.isInteger(message.host) ? (message.host as number) : 0;
        this.roomCode = typeof message.code === 'string' ? message.code : this.roomCode;
        this.roomEvent = typeof message.eventId === 'string' ? message.eventId : null;
        this.onRoster?.();
        break;
      }
      case 'go':
        if (typeof message.eventId === 'string' && typeof message.inMs === 'number') this.onGo?.(message.eventId, Math.max(0, Math.min(15000, message.inMs)));
        break;
      case 'state': {
        const state = message.s;
        if (!Number.isInteger(message.id) || !Array.isArray(state) || state.length !== 9 || !state.every((value) => typeof value === 'number' && Number.isFinite(value))) return;
        this.onState?.(message.id as number, state as CarState);
        break;
      }
      case 'finish':
        if (Number.isInteger(message.id) && typeof message.ms === 'number') this.onFinish?.(message.id as number, message.ms);
        break;
      case 'left':
        if (Number.isInteger(message.id)) this.onLeft?.(message.id as number);
        break;
      case 'error':
        if (typeof message.code === 'string') this.onError?.(message.code);
        break;
      default:
    }
  }

  createRoom(): void {
    this.send({ t: 'create' });
  }

  joinRoom(code: string, spectate: boolean): void {
    this.send({ t: 'join', code: code.trim().toUpperCase(), spectate });
  }

  leaveRoom(): void {
    this.send({ t: 'leave' });
    this.roomCode = null;
    this.peers = [];
    this.onRoster?.();
  }

  startRace(eventId: string): void {
    this.send({ t: 'start', eventId });
  }

  /** Says where this car is, no more often than the relay wants. */
  sendState(nowMs: number, state: CarState): void {
    if (!this.roomCode || nowMs - this.lastSend < 1000 / RELAY.sendHz) return;
    this.lastSend = nowMs;
    // Rounded, to keep messages small: centimetres and four places of rotation are plenty.
    const rounded = state.map((value, index) => (index < 3 || index > 6 ? Math.round(value * 100) / 100 : Math.round(value * 10000) / 10000));
    this.send({ t: 'state', s: rounded });
  }

  sendFinish(ms: number): void {
    this.send({ t: 'finish', ms: Math.round(ms) });
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.roomCode = null;
    this.peers = [];
    if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    if (this.status !== 'off') this.setStatus('off');
  }
}
