/** Types for the plain-JavaScript relay, so the TypeScript tests can start it. */

export declare const RELAY_LIMITS: {
  maxRacers: number;
  maxSpectators: number;
  codeAlphabet: string;
  codeLength: number;
  maxMessageBytes: number;
  maxMessagesPerSecond: number;
  countdownSeconds: number;
  emptyRoomMs: number;
  nameMax: number;
};

export interface RelayHandle {
  port: number;
  rooms: Map<string, unknown>;
  close(): Promise<void>;
}

export declare function startRelay(options?: { port?: number; now?: () => number }): Promise<RelayHandle>;
