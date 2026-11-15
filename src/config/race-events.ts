/**
 * Every event in দ্য রিং. Each rival's tier has a warm-up to finish, then the rival's own race.
 * Courses are lists of map nodes. Names and briefs live in the language files under race.event.
 */

export type RaceMode =
  | 'circuit'
  | 'sprint'
  | 'drift'
  | 'drag'
  | 'timeTrial'
  | 'takedown'
  | 'delivery'
  | 'checkpointRush'
  | 'riverDock'
  | 'flyoverLoop'
  | 'bazaarMaze'
  | 'boss';

export const RACE_MODES: readonly RaceMode[] = ['circuit', 'sprint', 'drift', 'drag', 'timeTrial', 'takedown', 'delivery', 'checkpointRush', 'riverDock', 'flyoverLoop', 'bazaarMaze', 'boss'];

export interface RaceEventDef {
  id: string;
  mode: RaceMode;
  /** Rank of the rival whose tier this belongs to. */
  tier: number;
  /** Set on the race that decides the rival's rank. */
  rivalRace?: string;
  /** Other rivals in the race. */
  rivals: readonly string[];
  /** How many of the crew join in. Lower presets may field fewer. */
  crew: number;
  /** 0 is the weakest crew and 1 the strongest. */
  crewSkill: number;
  /** A fixed route, as map nodes. */
  course?: { nodes: readonly string[]; loop: boolean };
  laps?: number;
  /** Free-routed gates, as map nodes, in order. */
  gates?: readonly string[];
  /** Seconds on the clock at the start. */
  timeLimit?: number;
  /** Seconds added at each gate. */
  gateBonus?: number;
  /**
   * Gold, silver and bronze. Seconds for time trials, seconds left on the clock for delivery,
   * checkpoint rush and takedown, and points for drifting. Position races give a medal by place.
   */
  medals?: readonly [number, number, number];
  /** Share of normal traffic. */
  traffic: number;
  /** Ring points for gold. */
  points: number;
  /** Takedown: how many cars to stop. */
  targets?: number;
  /** Boss: fractions of the course where a new leg begins. */
  legs?: readonly number[];
  /** Insists on this weather, with the water already up on the low roads. */
  weather?: 'monsoon';
  /** Boss: the police join at this leg, wanting this many stars. */
  police?: { leg: number; stars: number };
}

export const RACE_EVENTS: readonly RaceEventDef[] = [
  // ---------- ১০: মিঠু "গলিবাজ" ----------
  {
    id: 'goliCircuit',
    mode: 'circuit',
    tier: 10,
    rivals: [],
    crew: 3,
    crewSkill: 0,
    course: { nodes: ['C1', 'C2', 'F2', 'F1', 'C1'], loop: true },
    laps: 3,
    traffic: 0.45,
    points: 150,
  },
  {
    id: 'mishtiDelivery',
    mode: 'delivery',
    tier: 10,
    rivals: [],
    crew: 0,
    crewSkill: 0,
    gates: ['B3', 'A2', 'A1', 'C1', 'F1'],
    timeLimit: 118,
    gateBonus: 4,
    medals: [50, 30, 8],
    traffic: 0.8,
    points: 150,
  },
  {
    id: 'bazaarMaze',
    mode: 'bazaarMaze',
    tier: 10,
    rivalRace: 'mithu',
    rivals: ['mithu'],
    crew: 1,
    crewSkill: 0,
    gates: ['B2', 'A3', 'B4', 'C3', 'F3', 'F2', 'F1', 'C1'],
    traffic: 0.6,
    points: 250,
  },

  // ---------- ৯: সাদিয়া "সুতো" ----------
  {
    id: 'avenueTrial',
    mode: 'timeTrial',
    tier: 9,
    rivals: [],
    crew: 0,
    crewSkill: 0,
    course: { nodes: ['a1', 'a2', 'a3', 'b3', 'b2', 'b1', 'a1'], loop: true },
    laps: 1,
    medals: [56, 66, 82],
    traffic: 0.45,
    points: 200,
  },
  {
    id: 'sutoSprint',
    mode: 'sprint',
    tier: 9,
    rivalRace: 'sadia',
    rivals: ['sadia'],
    crew: 2,
    crewSkill: 0.15,
    course: { nodes: ['a2', 'b2', 'c2', 'c3', 'b3', 'a3', 'E2', 'S3'], loop: false },
    traffic: 0.55,
    points: 300,
  },

  // ---------- ৮: বাদল "বর্ষা" ----------
  {
    id: 'cityRush',
    mode: 'checkpointRush',
    tier: 8,
    rivals: [],
    crew: 0,
    crewSkill: 0,
    gates: ['a2', 'a3', 'b3', 'c3', 'c2', 'b2', 'b1', 'a1'],
    timeLimit: 26,
    gateBonus: 14,
    medals: [36, 22, 8],
    traffic: 0.7,
    points: 220,
  },
  {
    id: 'barshaCircuit',
    mode: 'circuit',
    tier: 8,
    rivalRace: 'badal',
    rivals: ['badal'],
    crew: 3,
    crewSkill: 0.3,
    course: { nodes: ['a1', 'a2', 'R', 'W1', 'a1'], loop: true },
    laps: 3,
    traffic: 0.55,
    points: 340,
  },

  {
    // বর্ষা রাশ: run through the low roads while they are under water.
    id: 'borshaRush',
    mode: 'sprint',
    tier: 8,
    rivals: [],
    crew: 4,
    crewSkill: 0.25,
    course: { nodes: ['B4', 'B3', 'B2', 'B1', 'R', 'a2', 'a3'], loop: false },
    traffic: 0.3,
    points: 320,
    weather: 'monsoon',
  },

  // ---------- ৭: জিসান "ধাক্কা" ----------
  {
    id: 'firstTakedown',
    mode: 'takedown',
    tier: 7,
    rivals: [],
    crew: 0,
    crewSkill: 0.3,
    targets: 3,
    timeLimit: 130,
    medals: [70, 40, 8],
    traffic: 0.4,
    points: 260,
  },
  {
    id: 'dhakkaCircuit',
    mode: 'circuit',
    tier: 7,
    rivalRace: 'jisan',
    rivals: ['jisan'],
    crew: 3,
    crewSkill: 0.4,
    course: { nodes: ['b1', 'c1', 'c2', 'b2', 'b1'], loop: true },
    laps: 3,
    traffic: 0.5,
    points: 380,
  },

  // ---------- ৬: পাপড়ি "স্লিপ" ----------
  {
    id: 'driftBlock',
    mode: 'drift',
    tier: 6,
    rivals: [],
    crew: 0,
    crewSkill: 0,
    course: { nodes: ['b1', 'b2', 'c2', 'c1', 'b1'], loop: true },
    timeLimit: 80,
    medals: [9000, 5500, 2500],
    traffic: 0.15,
    points: 280,
  },
  {
    id: 'slipBattle',
    mode: 'drift',
    tier: 6,
    rivalRace: 'papri',
    rivals: ['papri'],
    crew: 0,
    crewSkill: 0,
    course: { nodes: ['a2', 'a3', 'b3', 'b2', 'a2'], loop: true },
    timeLimit: 90,
    medals: [10500, 8000, 8000],
    traffic: 0.12,
    points: 420,
  },

  // ---------- ৫: তানভীর "কাচ" ----------
  {
    id: 'kachDrag',
    mode: 'drag',
    tier: 5,
    rivals: [],
    crew: 1,
    crewSkill: 0.6,
    course: { nodes: ['c1', 'c2', 'c3', 'c4'], loop: false },
    traffic: 0,
    points: 300,
  },
  {
    id: 'flyoverLoop',
    mode: 'flyoverLoop',
    tier: 5,
    rivalRace: 'tanvir',
    rivals: ['tanvir'],
    crew: 3,
    crewSkill: 0.5,
    course: { nodes: ['dSW', 'dSE', 'dNE', 'dNW', 'dSW'], loop: true },
    laps: 2,
    traffic: 0.55,
    points: 450,
  },

  // ---------- ৪: রুবেল "ক্রেন" ----------
  {
    id: 'ghatRun',
    mode: 'sprint',
    tier: 4,
    rivals: [],
    crew: 3,
    crewSkill: 0.6,
    course: { nodes: ['B2', 'C2', 'C3', 'C4', 'G1', 'D1', 'D2', 'D3'], loop: false },
    traffic: 0.55,
    points: 340,
  },
  {
    id: 'riverDock',
    mode: 'riverDock',
    tier: 4,
    rivalRace: 'rubel',
    rivals: ['rubel'],
    crew: 3,
    crewSkill: 0.65,
    course: { nodes: ['D1', 'D2', 'D3', 'G2', 'G1', 'D1'], loop: true },
    laps: 3,
    traffic: 0.25,
    points: 480,
  },

  {
    // বর্ষা রাশ: the whole flooded south of the city, against the clock.
    id: 'jolpothRush',
    mode: 'checkpointRush',
    tier: 4,
    rivals: [],
    crew: 0,
    crewSkill: 0,
    gates: ['A3', 'A2', 'A1', 'B1', 'B2', 'C1', 'F1', 'F2'],
    timeLimit: 30,
    gateBonus: 15,
    medals: [36, 22, 8],
    traffic: 0.35,
    points: 560,
    weather: 'monsoon',
  },

  // ---------- ৩: নীলা "কুয়াশা" ----------
  {
    id: 'nightDelivery',
    mode: 'delivery',
    tier: 3,
    rivals: [],
    crew: 0,
    crewSkill: 0,
    gates: ['c4', 'b3', 'a2', 'W1', 'B2', 'C3', 'G2'],
    timeLimit: 205,
    gateBonus: 3,
    medals: [75, 45, 10],
    traffic: 0.9,
    points: 380,
  },
  {
    id: 'kuashaSprint',
    mode: 'sprint',
    tier: 3,
    rivalRace: 'nila',
    rivals: ['nila'],
    crew: 2,
    crewSkill: 0.7,
    course: { nodes: ['c4', 'b4', 'a4', 'a3', 'a2', 'a1', 'W1', 'A1', 'B1', 'B2', 'B3'], loop: false },
    traffic: 1,
    points: 520,
  },

  // ---------- ২: শাওন "মিটার" ----------
  {
    id: 'bigTakedown',
    mode: 'takedown',
    tier: 2,
    rivals: [],
    crew: 0,
    crewSkill: 0.8,
    targets: 5,
    timeLimit: 170,
    medals: [75, 40, 8],
    traffic: 0.5,
    points: 420,
  },
  {
    id: 'meterCircuit',
    mode: 'circuit',
    tier: 2,
    rivalRace: 'shaon',
    rivals: ['shaon'],
    crew: 4,
    crewSkill: 0.85,
    course: { nodes: ['a2', 'b2', 'c2', 'c3', 'b3', 'a3', 'a2'], loop: true },
    laps: 3,
    traffic: 0.55,
    points: 560,
  },

  // ---------- ১: জাহান "কালবৈশাখী" ----------
  {
    id: 'allCityRush',
    mode: 'checkpointRush',
    tier: 1,
    rivals: [],
    crew: 0,
    crewSkill: 0,
    gates: ['b3', 'c3', 'c4', 'b4', 'a4', 'S3', 'E1', 'Q1', 'F1', 'C1', 'C2', 'C3'],
    timeLimit: 24,
    gateBonus: 13,
    medals: [36, 20, 6],
    traffic: 0.8,
    points: 500,
  },
  {
    id: 'kalbaishakhi',
    mode: 'boss',
    tier: 1,
    rivalRace: 'jahan',
    rivals: ['jahan'],
    crew: 0,
    crewSkill: 1,
    course: { nodes: ['dSE', 'dNE', 'dNW', 'dSW', 'g1', 'W1', 'A1', 'A2', 'A3', 'B3', 'C3', 'C4', 'G1', 'D1', 'D2', 'D3'], loop: false },
    legs: [0.42, 0.72],
    police: { leg: 1, stars: 3 },
    traffic: 0.7,
    points: 900,
  },
];

export const EVENT_BY_ID: ReadonlyMap<string, RaceEventDef> = new Map(RACE_EVENTS.map((event) => [event.id, event]));

/** Node areas a takedown's cars run around in. */
export const TAKEDOWN_NODES: readonly string[] = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'c1', 'c2', 'c3', 'c4'];

/** Where a takedown starts. */
export const TAKEDOWN_START: readonly string[] = ['b2', 'b3'];
