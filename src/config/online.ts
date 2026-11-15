/**
 * Numbers for everything that talks to a server: the leaderboard, the friends' relay, and the
 * optional banter writer. Plain values only, because the server-side code reads them too.
 */

export const LEADERBOARD = {
  endpoint: '/api/leaderboard',
  /** The game gives up on the server after this long, and shows what it has on this machine. */
  timeoutMs: 6000,
  /** Entries kept per board. */
  keep: 50,
  /** The top few keep their ghosts for others to race. */
  ghostsKept: 10,
  /** Shown per board on the screen. */
  shown: 10,
  /** Visible characters in a name. */
  nameMax: 16,
  /** Posts allowed from one connection per window. */
  rateWindowMs: 60000,
  rateMax: 10,
  /** No car in the game averages more than this over a whole route, in metres per second. */
  maxAverageSpeed: 62,
  /**
   * A race's least distance is taken as this share of the straight lines between its nodes,
   * because the road's curves cut a little off every corner.
   */
  straightLineShare: 0.8,
  /** Between two ghost samples, nothing moves faster than this, in metres per second. */
  maxSampleSpeed: 105,
  /** The shortest run any board will take. */
  minRunMs: 8000,
  /** The ghost must start this close to the event's first node. */
  startRadius: 140,
  /** The most drift points a run can plausibly make. */
  maxScore: 400000,
  /** A request body larger than this is refused before it is read. */
  maxBodyBytes: 160000,
} as const;

export const RELAY = {
  /** Messages per second each player sends about their car. */
  sendHz: 15,
  maxRacers: 6,
  maxSpectators: 8,
  /** A room code: four letters and digits that cannot be mistaken for each other. */
  codeAlphabet: 'ACDEFHJKMNPRTUVWXY34679',
  codeLength: 4,
  /** Bytes; anything larger is dropped. */
  maxMessageBytes: 2048,
  /** Messages per second one connection may send before being cut off. */
  maxMessagesPerSecond: 40,
  /** Seconds of countdown after the host starts a race. */
  countdownSeconds: 6,
  /** An empty room is forgotten after this many ms. */
  emptyRoomMs: 120000,
  connectTimeoutMs: 6000,
} as const;

export const BANTER = {
  endpoint: '/api/banter',
  /** The game waits this long for a fresh line, then uses a written one. */
  timeoutMs: 4500,
  /** A line longer than this, in characters, is thrown away. */
  maxChars: 140,
  /** Requests from one connection per window. */
  rateWindowMs: 60000,
  rateMax: 12,
  /** The most lines the whole site writes in one day, so a bill can never run away. */
  dailyCap: 600,
  /** How many fresh lines are kept ready per topic. */
  prefetch: 1,
} as const;
