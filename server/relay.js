/**
 * বেপরোয়া's friends relay: rooms with a short code, where each player's car is passed on to the
 * others. Every client drives its own car and only says where it is, so the server keeps no
 * world and runs no physics; it just checks and forwards small messages.
 *
 * Run it anywhere Node 20+ runs:  node server/relay.js   (PORT sets the port, default 8787)
 * Netlify cannot host it: a long-lived WebSocket needs a process that stays up, such as a small
 * VPS, Fly.io, Render or Railway. Point the game at it with VITE_RELAY_URL=wss://your-host at build time.
 */

import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

export const RELAY_LIMITS = {
  maxRacers: 6,
  maxSpectators: 8,
  codeAlphabet: 'ACDEFHJKMNPRTUVWXY34679',
  codeLength: 4,
  maxMessageBytes: 2048,
  maxMessagesPerSecond: 40,
  countdownSeconds: 6,
  emptyRoomMs: 120000,
  nameMax: 24,
};

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,40}$/;

/**
 * @typedef {{ id: number, socket: import('ws').WebSocket, name: string, car: string, spectator: boolean, room: Room | null, budget: number, finishMs: number | null }} Peer
 * @typedef {{ code: string, host: number, peers: Map<number, Peer>, eventId: string | null, startsAt: number, emptySince: number }} Room
 */

/** @param {string} raw */
function cleanName(raw) {
  if (typeof raw !== 'string') return '';
  return Array.from(raw.normalize('NFC').replace(/[\u0000-\u001f\u007f​-‍⁠﻿]/g, '').replace(/\s+/g, ' ').trim())
    .slice(0, RELAY_LIMITS.nameMax)
    .join('');
}

/**
 * Starts a relay.
 * @param {{ port?: number, now?: () => number }} [options]
 * @returns {Promise<{ port: number, close: () => Promise<void>, rooms: Map<string, Room> }>}
 */
export function startRelay(options = {}) {
  const now = options.now ?? (() => Date.now());
  /** @type {Map<string, Room>} */
  const rooms = new Map();
  /** @type {Set<Peer>} */
  const everyone = new Set();
  let nextId = 1;

  const http = createServer((request, response) => {
    // A plain GET answers, so hosts can check the relay is up.
    response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    response.end(request.url === '/health' ? 'ok' : 'beporowa relay');
  });
  const wss = new WebSocketServer({ server: http, maxPayload: RELAY_LIMITS.maxMessageBytes });

  /** @param {Peer} peer @param {unknown} message */
  function send(peer, message) {
    if (peer.socket.readyState === 1) peer.socket.send(JSON.stringify(message));
  }

  /** @param {Room} room @param {unknown} message @param {number} [except] */
  function broadcast(room, message, except) {
    const text = JSON.stringify(message);
    for (const peer of room.peers.values()) {
      if (peer.id !== except && peer.socket.readyState === 1) peer.socket.send(text);
    }
  }

  /** @param {Room} room */
  function roster(room) {
    return {
      t: 'roster',
      code: room.code,
      host: room.host,
      eventId: room.eventId,
      peers: [...room.peers.values()].map((peer) => ({ id: peer.id, name: peer.name, car: peer.car, spectator: peer.spectator, finishMs: peer.finishMs })),
    };
  }

  function newCode() {
    const { codeAlphabet, codeLength } = RELAY_LIMITS;
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < codeLength; i++) code += codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)];
      if (!rooms.has(code)) return code;
    }
    return null;
  }

  /** @param {Peer} peer */
  function leave(peer) {
    const room = peer.room;
    if (!room) return;
    room.peers.delete(peer.id);
    peer.room = null;
    if (room.peers.size === 0) {
      room.emptySince = now();
      return;
    }
    // If the host goes, the longest-standing racer takes over.
    if (room.host === peer.id) {
      const next = [...room.peers.values()].find((other) => !other.spectator) ?? [...room.peers.values()][0];
      room.host = next.id;
    }
    broadcast(room, { t: 'left', id: peer.id });
    broadcast(room, roster(room));
  }

  /** @param {Peer} peer @param {Room} room @param {boolean} spectator */
  function join(peer, room, spectator) {
    const racers = [...room.peers.values()].filter((other) => !other.spectator).length;
    const watchers = room.peers.size - racers;
    if (!spectator && racers >= RELAY_LIMITS.maxRacers) return send(peer, { t: 'error', code: 'roomFull' });
    if (spectator && watchers >= RELAY_LIMITS.maxSpectators) return send(peer, { t: 'error', code: 'roomFull' });
    leave(peer);
    peer.spectator = spectator;
    peer.finishMs = null;
    peer.room = room;
    room.peers.set(peer.id, peer);
    room.emptySince = 0;
    send(peer, { t: 'joined', id: peer.id, code: room.code });
    broadcast(room, roster(room));
  }

  /** @param {Peer} peer @param {any} message */
  function handle(peer, message) {
    if (typeof message !== 'object' || message === null || typeof message.t !== 'string') return;
    const room = peer.room;
    switch (message.t) {
      case 'hello': {
        peer.name = cleanName(message.name) || `#${peer.id}`;
        peer.car = typeof message.car === 'string' && ID_PATTERN.test(message.car) ? message.car : 'bulbuli';
        if (room) broadcast(room, roster(room));
        return;
      }
      case 'create': {
        const code = newCode();
        if (!code) return send(peer, { t: 'error', code: 'busy' });
        /** @type {Room} */
        const fresh = { code, host: peer.id, peers: new Map(), eventId: null, startsAt: 0, emptySince: 0 };
        rooms.set(code, fresh);
        join(peer, fresh, false);
        return;
      }
      case 'join': {
        const code = typeof message.code === 'string' ? message.code.toUpperCase() : '';
        const target = rooms.get(code);
        if (!target) return send(peer, { t: 'error', code: 'noRoom' });
        join(peer, target, message.spectate === true);
        return;
      }
      case 'leave':
        leave(peer);
        return;
      case 'start': {
        if (!room || room.host !== peer.id) return send(peer, { t: 'error', code: 'notHost' });
        if (typeof message.eventId !== 'string' || !ID_PATTERN.test(message.eventId)) return;
        room.eventId = message.eventId;
        room.startsAt = now() + RELAY_LIMITS.countdownSeconds * 1000;
        for (const other of room.peers.values()) other.finishMs = null;
        broadcast(room, { t: 'go', eventId: room.eventId, inMs: RELAY_LIMITS.countdownSeconds * 1000 });
        broadcast(room, roster(room));
        return;
      }
      case 'state': {
        // A car's place: [x, y, z, qx, qy, qz, qw, speed, progress], passed straight on.
        if (!room || peer.spectator || !Array.isArray(message.s) || message.s.length !== 9) return;
        if (!message.s.every((value) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) < 1e6)) return;
        broadcast(room, { t: 'state', id: peer.id, s: message.s }, peer.id);
        return;
      }
      case 'finish': {
        if (!room || peer.spectator || peer.finishMs !== null) return;
        const ms = message.ms;
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0 || ms > 3600000) return;
        peer.finishMs = Math.round(ms);
        broadcast(room, { t: 'finish', id: peer.id, ms: peer.finishMs });
        broadcast(room, roster(room));
        return;
      }
      default:
    }
  }

  wss.on('connection', (socket) => {
    /** @type {Peer} */
    const peer = { id: nextId++, socket, name: '', car: 'bulbuli', spectator: false, room: null, budget: RELAY_LIMITS.maxMessagesPerSecond, finishMs: null };
    peer.name = `#${peer.id}`;
    everyone.add(peer);
    socket.on('message', (data, isBinary) => {
      // A connection that floods is cut off rather than slowing everyone else down.
      if (--peer.budget < 0) {
        socket.close(1008, 'too many messages');
        return;
      }
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch {
        return;
      }
      handle(peer, message);
    });
    socket.on('close', () => {
      leave(peer);
      everyone.delete(peer);
    });
    socket.on('error', () => leave(peer));
    send(peer, { t: 'welcome', id: peer.id, v: 1 });
  });

  // Once a second: refill every message budget, and forget rooms that have stood empty a while.
  const ticker = setInterval(() => {
    for (const peer of everyone) peer.budget = RELAY_LIMITS.maxMessagesPerSecond;
    for (const room of rooms.values()) {
      if (room.peers.size === 0 && room.emptySince > 0 && now() - room.emptySince > RELAY_LIMITS.emptyRoomMs) rooms.delete(room.code);
    }
  }, 1000);

  return new Promise((resolve) => {
    http.listen(options.port ?? 0, () => {
      const address = http.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      resolve({
        port,
        rooms,
        close: () =>
          new Promise((done) => {
            clearInterval(ticker);
            for (const client of wss.clients) client.terminate();
            wss.close(() => http.close(() => done(undefined)));
          }),
      });
    });
  });
}

// Run directly: start on PORT.
const invokedDirectly = typeof process !== 'undefined' && process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, '/').replace(/^(?=[A-Za-z]:)/, '/')}`).href;
if (invokedDirectly) {
  const port = Number(process.env.PORT ?? 8787);
  startRelay({ port }).then(({ port: actual }) => console.log(`beporowa relay listening on ${actual}`));
}
