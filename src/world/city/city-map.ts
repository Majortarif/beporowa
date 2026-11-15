/**
 * The hand-authored map of বর্ষাবাদ for Phase 2: পুরানটোলা in the south-west,
 * উড়ালগঞ্জ in the north, joined at the ময়ূরপঙ্খী চত্বর roundabout at the origin.
 *
 * Top-down convention: +X is east, +Z is south, so north is -Z.
 * Traffic drives on the left, as in Bangladesh.
 */

import { CITY, type RoadKind } from '../../config/city-tuning';

export interface MapNode {
  id: string;
  x: number;
  z: number;
  /** Elevated nodes stand on the flyover. */
  elevated?: boolean;
  roundabout?: boolean;
  /** i18n key of the sign on a closed road, for districts not built yet. */
  closedSign?: string;
}

export interface MapEdge {
  a: string;
  b: string;
  kind: RoadKind;
  /** Extra points that bend the road. */
  via?: ReadonlyArray<readonly [number, number]>;
  /** Permanent congestion, shown in red on the map. */
  jam?: boolean;
}

export type DistrictId = 'puranTola' | 'uralganj' | 'kajalGhat';

export const DISTRICT_NAME_KEYS: Record<DistrictId, string> = {
  puranTola: 'city.district.puranTola',
  uralganj: 'city.district.uralganj',
  kajalGhat: 'city.district.kajalGhat',
};

/** Where the land ends and the কাজলগঙ্গা begins. */
export const RIVER_Z = 950;

/** The container port south of the old town. */
export const DOCK_AREA = { minX: -790, maxX: -90, minZ: 640, maxZ: RIVER_Z };

/** Old town is everything south of the east-west link and west of the Jhilpar road, down to the port. */
export function districtAt(x: number, z: number): DistrictId {
  if (z > 636 && x < -60) return 'kajalGhat';
  return z > 24 && x < 130 ? 'puranTola' : 'uralganj';
}

export const CLOSED_SIGN = 'sign.closed';

export const NODES: readonly MapNode[] = [
  // Monument roundabout
  { id: 'R', x: 0, z: 0, roundabout: true },

  // উড়ালগঞ্জ avenues
  { id: 'a1', x: -260, z: -200 }, { id: 'a2', x: 0, z: -200 }, { id: 'a3', x: 260, z: -200 }, { id: 'a4', x: 520, z: -200 },
  { id: 'b1', x: -260, z: -460 }, { id: 'b2', x: 0, z: -460 }, { id: 'b3', x: 260, z: -460 }, { id: 'b4', x: 520, z: -460 },
  { id: 'c1', x: -260, z: -760 }, { id: 'c2', x: 0, z: -760 }, { id: 'c3', x: 260, z: -760 }, { id: 'c4', x: 520, z: -760 },

  // Links around the grid
  { id: 'W1', x: -260, z: -60 }, { id: 'E1', x: 140, z: -30 }, { id: 'E2', x: 260, z: -60 }, { id: 'S3', x: 520, z: -60 },
  { id: 'L1', x: -420, z: -460 }, { id: 'N1', x: 260, z: -900 }, { id: 'K1', x: 770, z: -105 },

  // Flyover junctions and the ground ends of its ramps
  { id: 'dSW', x: -190, z: -200, elevated: true }, { id: 'dSE', x: 450, z: -200, elevated: true },
  { id: 'dNE', x: 520, z: -690, elevated: true }, { id: 'dNW', x: -190, z: -760, elevated: true },
  { id: 'g1', x: -420, z: -140 }, { id: 'g2', x: 680, z: -140 }, { id: 'g3', x: 580, z: -920 }, { id: 'g4', x: -420, z: -820 },

  // পুরানটোলা
  { id: 'B1', x: -110, z: 130 }, { id: 'B2', x: -230, z: 230 }, { id: 'B3', x: -370, z: 330 }, { id: 'B4', x: -520, z: 420 },
  { id: 'A1', x: -200, z: 60 }, { id: 'A2', x: -330, z: 140 }, { id: 'A3', x: -470, z: 230 }, { id: 'A4', x: -610, z: 320 },
  { id: 'C1', x: -40, z: 260 }, { id: 'C2', x: -140, z: 360 }, { id: 'C3', x: -280, z: 460 }, { id: 'C4', x: -430, z: 560 },
  { id: 'F1', x: 70, z: 390 }, { id: 'F2', x: -30, z: 500 }, { id: 'F3', x: -170, z: 600 },
  { id: 'Q1', x: 170, z: 210 },

  // Roads to districts that come in later phases end at a barricade
  { id: 'xKach', x: 880, z: -70, closedSign: CLOSED_SIGN },
  { id: 'xSuto', x: -580, z: -460, closedSign: CLOSED_SIGN },
  { id: 'xNorth', x: 640, z: -1040, closedSign: CLOSED_SIGN },
  { id: 'xJhil', x: 330, z: 230, closedSign: CLOSED_SIGN },
  { id: 'xWest', x: -700, z: 270, closedSign: CLOSED_SIGN },

  // কাজলঘাট: the river port
  { id: 'G1', x: -520, z: 660 }, { id: 'G2', x: -250, z: 700 },
  { id: 'D1', x: -640, z: 790 }, { id: 'D2', x: -440, z: 890 }, { id: 'D3', x: -210, z: 880 },
];

export const EDGES: readonly MapEdge[] = [
  // Grid rows
  { a: 'a1', b: 'a2', kind: 'avenue' }, { a: 'a2', b: 'a3', kind: 'avenue' }, { a: 'a3', b: 'a4', kind: 'avenue' },
  { a: 'b1', b: 'b2', kind: 'street' }, { a: 'b2', b: 'b3', kind: 'street' }, { a: 'b3', b: 'b4', kind: 'street' },
  { a: 'c1', b: 'c2', kind: 'avenue' }, { a: 'c2', b: 'c3', kind: 'avenue' }, { a: 'c3', b: 'c4', kind: 'avenue' },

  // Grid columns
  { a: 'a1', b: 'b1', kind: 'avenue' }, { a: 'b1', b: 'c1', kind: 'avenue' },
  { a: 'a2', b: 'b2', kind: 'avenue', jam: true }, { a: 'b2', b: 'c2', kind: 'avenue' },
  { a: 'a3', b: 'b3', kind: 'street' }, { a: 'b3', b: 'c3', kind: 'street' },
  { a: 'a4', b: 'b4', kind: 'avenue' }, { a: 'b4', b: 'c4', kind: 'avenue' },

  // Into the grid from the south
  { a: 'R', b: 'a2', kind: 'avenue' },
  { a: 'W1', b: 'a1', kind: 'avenue' }, { a: 'E2', b: 'a3', kind: 'street' }, { a: 'S3', b: 'a4', kind: 'avenue' },
  { a: 'R', b: 'W1', kind: 'street', via: [[-130, -44]] },
  { a: 'R', b: 'E1', kind: 'street', via: [[70, -6]] },
  { a: 'E1', b: 'E2', kind: 'street' }, { a: 'E2', b: 'S3', kind: 'street' },
  // A ramp's road carries straight on from its foot, then curves back into town, so nobody needs a U-turn.
  { a: 'g1', b: 'W1', kind: 'street', via: [[-484, -116], [-492, -70], [-430, -42], [-340, -48]] },
  { a: 'g2', b: 'K1', kind: 'street' },
  { a: 'K1', b: 'xKach', kind: 'street' },
  { a: 'K1', b: 'S3', kind: 'street', via: [[762, -48], [650, -36]] },
  { a: 'b1', b: 'L1', kind: 'street' }, { a: 'L1', b: 'xSuto', kind: 'street' }, { a: 'L1', b: 'g4', kind: 'street' },
  { a: 'c3', b: 'N1', kind: 'street' }, { a: 'N1', b: 'g3', kind: 'street', via: [[420, -928]] },
  { a: 'g3', b: 'xNorth', kind: 'street' },

  // The flyover loop, on columns above the avenues
  { a: 'dSW', b: 'dSE', kind: 'deck' },
  { a: 'dSE', b: 'dNE', kind: 'deck', via: [[500, -215], [520, -265], [520, -480]] },
  { a: 'dNE', b: 'dNW', kind: 'deck', via: [[505, -740], [455, -760], [130, -760]] },
  { a: 'dNW', b: 'dSW', kind: 'deck', via: [[-240, -745], [-260, -695], [-260, -480], [-260, -265], [-245, -215]] },

  // Ramps leave each flyover junction at a shallow angle
  { a: 'dSW', b: 'g1', kind: 'ramp', via: [[-300, -172]] },
  { a: 'dSE', b: 'g2', kind: 'ramp', via: [[560, -172]] },
  { a: 'dNE', b: 'g3', kind: 'ramp', via: [[545, -800]] },
  { a: 'dNW', b: 'g4', kind: 'ramp', via: [[-300, -788]] },

  // পুরানটোলা bazaar road
  { a: 'R', b: 'B1', kind: 'street', via: [[-46, 66]] },
  { a: 'B1', b: 'B2', kind: 'street', jam: true, via: [[-170, 176]] },
  { a: 'B2', b: 'B3', kind: 'street', jam: true, via: [[-298, 288]] },
  { a: 'B3', b: 'B4', kind: 'street', via: [[-446, 368]] },
  { a: 'W1', b: 'A1', kind: 'street', via: [[-246, 2]] },

  // পুরানটোলা alleys: bent on purpose, so nothing looks like a grid
  { a: 'A1', b: 'A2', kind: 'lane', via: [[-258, 92]] },
  { a: 'A2', b: 'A3', kind: 'lane', via: [[-406, 172]] },
  { a: 'A3', b: 'A4', kind: 'lane', via: [[-530, 290]] },
  { a: 'A4', b: 'xWest', kind: 'lane' },
  { a: 'C1', b: 'C2', kind: 'lane', via: [[-96, 298]] },
  { a: 'C2', b: 'C3', kind: 'lane', via: [[-200, 420]] },
  { a: 'C3', b: 'C4', kind: 'lane', via: [[-360, 498]] },
  { a: 'C4', b: 'G1', kind: 'lane' },
  { a: 'F1', b: 'F2', kind: 'lane', via: [[28, 452]] },
  { a: 'F2', b: 'F3', kind: 'lane', via: [[-110, 540]] },
  { a: 'F3', b: 'G2', kind: 'lane' },
  { a: 'A1', b: 'B1', kind: 'lane', via: [[-142, 104]] },
  { a: 'A2', b: 'B2', kind: 'lane', via: [[-290, 196]] },
  { a: 'A3', b: 'B3', kind: 'lane', via: [[-428, 290]] },
  { a: 'A4', b: 'B4', kind: 'lane', via: [[-574, 386]] },
  { a: 'B1', b: 'C1', kind: 'lane', via: [[-58, 188]] },
  { a: 'B2', b: 'C2', kind: 'lane', via: [[-196, 306]] },
  { a: 'B3', b: 'C3', kind: 'lane', via: [[-310, 398]] },
  { a: 'B4', b: 'C4', kind: 'lane', via: [[-486, 500]] },
  { a: 'C1', b: 'F1', kind: 'lane', via: [[28, 318]] },
  { a: 'C2', b: 'F2', kind: 'lane', via: [[-78, 436]] },
  { a: 'C3', b: 'F3', kind: 'lane', via: [[-214, 526]] },
  { a: 'F1', b: 'Q1', kind: 'lane', via: [[136, 306]] },
  { a: 'Q1', b: 'E1', kind: 'street', via: [[150, 90]] },
  { a: 'Q1', b: 'xJhil', kind: 'street' },

  // কাজলঘাট: a loop around the container yard, with the long quay road along the river
  { a: 'G1', b: 'D1', kind: 'street', via: [[-604, 712]] },
  { a: 'D1', b: 'D2', kind: 'avenue', via: [[-560, 862]] },
  { a: 'D2', b: 'D3', kind: 'avenue', via: [[-326, 904]] },
  { a: 'D3', b: 'G2', kind: 'street', via: [[-172, 790]] },
  { a: 'G2', b: 'G1', kind: 'street', via: [[-384, 664]] },
];

export interface PointOfInterest {
  id: string;
  nameKey: string;
  node: string;
}

/** Places the GPS can take you. */
export const POINTS_OF_INTEREST: readonly PointOfInterest[] = [
  { id: 'monument', nameKey: 'city.poi.monument', node: 'R' },
  { id: 'bazaar', nameKey: 'city.poi.bazaar', node: 'B3' },
  { id: 'teaLane', nameKey: 'city.poi.teaLane', node: 'A2' },
  { id: 'oldLanes', nameKey: 'city.poi.oldLanes', node: 'C3' },
  { id: 'flyoverWest', nameKey: 'city.poi.flyoverWest', node: 'g1' },
  { id: 'flyoverEast', nameKey: 'city.poi.flyoverEast', node: 'g2' },
  { id: 'toll', nameKey: 'city.poi.toll', node: 'dSE' },
  { id: 'centre', nameKey: 'city.poi.centre', node: 'b2' },
  { id: 'dock', nameKey: 'city.poi.dock', node: 'D2' },
  { id: 'garage', nameKey: 'city.poi.garage', node: 'B1' },
];

/** Where the toll plaza stands on the flyover: x along its southern side. */
export const TOLL_X = 130;
export const TOLL_Z = -200;

export const DECK_HEIGHT = CITY.network.deckHeight;

/** The start of a drive: on the bazaar road, facing the monument. */
export const SPAWN_EDGE = { a: 'R', b: 'B1', fractionFromB: 0.2 };
