/**
 * Turns the authored map into everything the game needs: road centre lines, node sizes,
 * traffic lanes with connectors, a routing graph and spatial lookups.
 * No rendering or DOM here, so tests can use the real network.
 */

import { CatmullRomCurve3, Vector3 } from 'three';
import { CITY, type RoadKind, type RoadKindSpec } from '../../config/city-tuning';
import { smoothstep } from '../../core/math';
import { Polyline, createSample, type PolylineSample } from '../../core/polyline';
import { DECK_HEIGHT, EDGES, NODES, type MapEdge, type MapNode } from './city-map';

export interface Leg {
  edge: number;
  /** Unit direction from the node out along the road. */
  awayX: number;
  awayZ: number;
  angle: number;
  /** Legs that share a green light have the same group. */
  signalGroup: number;
}

export interface RoadNode {
  index: number;
  id: string;
  x: number;
  y: number;
  z: number;
  radius: number;
  elevated: boolean;
  roundabout: boolean;
  closedSign: string | null;
  legs: Leg[];
  signalized: boolean;
  signalGroups: number;
  /** How many vehicles may be inside at once when there is no signal. */
  capacity: number;
  /** Vehicles currently on this node's connectors. Kept up to date by the traffic system. */
  occupancy: number;
}

export interface RoadEdge {
  index: number;
  kind: RoadKind;
  spec: RoadKindSpec;
  a: number;
  b: number;
  /** Full centre line, node to node. */
  full: Polyline;
  /** Centre line between the node discs: the visible road. */
  center: Polyline;
  /** How far along the full line the visible road starts. */
  trimStart: number;
  elevated: boolean;
  jam: boolean;
  lanes: number[];
}

export interface Lane {
  id: number;
  line: Polyline;
  /** Edge this lane belongs to, or -1 for a connector inside a node. */
  edge: number;
  /** Node this connector crosses, or the node this lane ends at. */
  node: number;
  isConnector: boolean;
  kind: RoadKind;
  /** 0 is the inner lane. */
  index: number;
  laneWidth: number;
  speedLimit: number;
  jam: boolean;
  signalGroup: number;
  next: number[];
  /** Turn weight of each entry in next: going straight is more likely. */
  nextWeights: number[];
  /** Vehicles on this lane, furthest ahead first. Owned by the traffic system. */
  agents: number[];
}

export interface RouteNeighbor {
  node: number;
  edge: number;
  length: number;
}

export interface RoadHit {
  edge: number;
  /** Distance along the edge's visible centre line. */
  s: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  distance: number;
}

interface SpatialEntry {
  edge: number;
  s: number;
}

function curvedEdgeRaw(a: MapNode, b: MapNode, edge: MapEdge, ay: number, by: number): number[] {
  const points = [new Vector3(a.x, 0, a.z)];
  for (const [x, z] of edge.via ?? []) points.push(new Vector3(x, 0, z));
  points.push(new Vector3(b.x, 0, b.z));
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  curve.arcLengthDivisions = Math.max(200, points.length * 80);
  const divisions = Math.max(2, Math.ceil(curve.getLength() / CITY.network.edgeSampleSpacing));
  const spaced = curve.getSpacedPoints(divisions);
  const raw: number[] = [];
  spaced.forEach((point, i) => {
    const y = ay + (by - ay) * smoothstep(0, 1, i / divisions);
    raw.push(point.x, y, point.z);
  });
  return raw;
}

/** Copies a stretch of a polyline, optionally reversed, optionally offset to the driver's left. */
function extractStretch(line: Polyline, from: number, to: number, reversed: boolean, leftOffset: number, spacing: number): Polyline {
  const sample = createSample();
  const steps = Math.max(2, Math.ceil(Math.abs(to - from) / spacing));
  const raw = new Float32Array((steps + 1) * 3);
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    const s = reversed ? to + (from - to) * fraction : from + (to - from) * fraction;
    line.sample(s, sample);
    const tx = reversed ? -sample.tx : sample.tx;
    const tz = reversed ? -sample.tz : sample.tz;
    // Left of travel is (tz, -tx) with +Z forward and +X to the left.
    raw[i * 3] = sample.x + tz * leftOffset;
    raw[i * 3 + 1] = sample.y;
    raw[i * 3 + 2] = sample.z - tx * leftOffset;
  }
  return new Polyline(raw, spacing);
}

export class RoadNetwork {
  readonly nodes: RoadNode[] = [];
  readonly edges: RoadEdge[] = [];
  readonly lanes: Lane[] = [];
  readonly neighbors: RouteNeighbor[][] = [];
  readonly bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  /** Lanes marked as jam zones, used to concentrate traffic there. */
  readonly jamLanes: number[] = [];
  /** Road lanes without connectors, used to spawn traffic. */
  readonly roadLanes: number[] = [];
  private readonly nodeById = new Map<string, number>();
  private readonly spatial = new Map<number, SpatialEntry[]>();
  private readonly sample = createSample();

  constructor() {
    this.buildNodes();
    this.buildEdges();
    this.sizeNodes();
    this.trimEdges();
    this.assignSignals();
    this.buildLanes();
    this.buildConnectors();
    this.buildSpatialIndex();
  }

  nodeIndex(id: string): number {
    const index = this.nodeById.get(id);
    if (index === undefined) throw new Error(`Unknown map node: ${id}`);
    return index;
  }

  private buildNodes(): void {
    NODES.forEach((node, index) => {
      this.nodeById.set(node.id, index);
      this.nodes.push({
        index,
        id: node.id,
        x: node.x,
        y: node.elevated ? DECK_HEIGHT : 0,
        z: node.z,
        radius: 0,
        elevated: node.elevated ?? false,
        roundabout: node.roundabout ?? false,
        closedSign: node.closedSign ?? null,
        legs: [],
        signalized: false,
        signalGroups: 0,
        capacity: 3,
        occupancy: 0,
      });
      this.neighbors.push([]);
      this.bounds.minX = Math.min(this.bounds.minX, node.x);
      this.bounds.maxX = Math.max(this.bounds.maxX, node.x);
      this.bounds.minZ = Math.min(this.bounds.minZ, node.z);
      this.bounds.maxZ = Math.max(this.bounds.maxZ, node.z);
    });
  }

  private buildEdges(): void {
    const sample = createSample();
    EDGES.forEach((edge, index) => {
      const a = this.nodeIndex(edge.a);
      const b = this.nodeIndex(edge.b);
      const nodeA = this.nodes[a];
      const nodeB = this.nodes[b];
      const raw = curvedEdgeRaw(NODES[a], NODES[b], edge, nodeA.y, nodeB.y);
      const full = new Polyline(raw, CITY.network.edgeSampleSpacing);
      const elevated = edge.kind === 'deck' || edge.kind === 'ramp';
      this.edges.push({
        index,
        kind: edge.kind,
        spec: CITY.roads[edge.kind],
        a,
        b,
        full,
        center: full,
        trimStart: 0,
        elevated,
        jam: edge.jam ?? false,
        lanes: [],
      });
      full.sample(0, sample);
      this.addLeg(nodeA, index, sample.tx, sample.tz);
      full.sample(full.length, sample);
      this.addLeg(nodeB, index, -sample.tx, -sample.tz);
      this.neighbors[a].push({ node: b, edge: index, length: full.length });
      this.neighbors[b].push({ node: a, edge: index, length: full.length });
    });
  }

  private addLeg(node: RoadNode, edge: number, awayX: number, awayZ: number): void {
    node.legs.push({ edge, awayX, awayZ, angle: Math.atan2(awayZ, awayX), signalGroup: 0 });
  }

  private sizeNodes(): void {
    const config = CITY.network;
    for (const node of this.nodes) {
      let widest = 0;
      for (const leg of node.legs) widest = Math.max(widest, this.edges[leg.edge].spec.halfWidth);
      if (node.roundabout) {
        node.radius = config.roundaboutRadius;
      } else if (node.legs.length <= 2 && this.legsContinue(node)) {
        node.radius = widest * config.continuationRadiusScale + 1;
      } else {
        node.radius = widest * config.nodeRadiusScale + config.nodeRadiusPadding;
      }
    }
  }

  /** True when a two-legged node is just the road carrying on, not a sharp corner. */
  private legsContinue(node: RoadNode): boolean {
    if (node.legs.length < 2) return true;
    const [a, b] = node.legs;
    return a.awayX * b.awayX + a.awayZ * b.awayZ < -0.7;
  }

  private trimEdges(): void {
    for (const edge of this.edges) {
      const start = this.nodes[edge.a].radius;
      const end = edge.full.length - this.nodes[edge.b].radius;
      edge.trimStart = start;
      edge.center = extractStretch(edge.full, start, Math.max(end, start + 1), false, 0, CITY.network.edgeSampleSpacing);
    }
  }

  private assignSignals(): void {
    const unsignaled = CITY.signals.unsignaledCapacity;
    for (const node of this.nodes) {
      const kinds = node.legs.map((leg) => this.edges[leg.edge].kind);
      const hasAvenue = kinds.includes('avenue');
      const wideLegs = kinds.filter((kind) => kind === 'avenue' || kind === 'street').length;
      node.signalized = !node.elevated && !node.roundabout && node.legs.length >= 3 && (hasAvenue || wideLegs >= 3);

      if (node.roundabout) node.capacity = unsignaled.roundabout;
      else if (node.elevated) node.capacity = unsignaled.deck;
      else if (kinds.includes('street')) node.capacity = unsignaled.street;
      else node.capacity = unsignaled.lane;

      if (!node.signalized) continue;
      // Roads that face each other go green together.
      let group = 0;
      const assigned = new Array<boolean>(node.legs.length).fill(false);
      for (let i = 0; i < node.legs.length; i++) {
        if (assigned[i]) continue;
        assigned[i] = true;
        node.legs[i].signalGroup = group;
        for (let j = i + 1; j < node.legs.length; j++) {
          if (assigned[j]) continue;
          const dot = node.legs[i].awayX * node.legs[j].awayX + node.legs[i].awayZ * node.legs[j].awayZ;
          if (dot < -0.8) {
            assigned[j] = true;
            node.legs[j].signalGroup = group;
            break;
          }
        }
        group++;
      }
      node.signalGroups = group;
    }
  }

  private addLane(lane: Omit<Lane, 'id' | 'agents' | 'next' | 'nextWeights'>): Lane {
    const created: Lane = { ...lane, id: this.lanes.length, next: [], nextWeights: [], agents: [] };
    this.lanes.push(created);
    return created;
  }

  private buildLanes(): void {
    const spacing = CITY.network.laneSampleSpacing;
    for (const edge of this.edges) {
      const { spec } = edge;
      for (const forward of [true, false]) {
        const endNode = forward ? edge.b : edge.a;
        const leg = this.nodes[endNode].legs.find((candidate) => candidate.edge === edge.index);
        for (let i = 0; i < spec.lanes; i++) {
          const offset = spec.median / 2 + spec.laneWidth * (i + 0.5);
          const line = extractStretch(edge.center, 0, edge.center.length, !forward, offset, spacing);
          const lane = this.addLane({
            line,
            edge: edge.index,
            node: endNode,
            isConnector: false,
            kind: edge.kind,
            index: i,
            laneWidth: spec.laneWidth,
            speedLimit: spec.speedLimit,
            jam: edge.jam,
            signalGroup: leg?.signalGroup ?? 0,
          });
          edge.lanes.push(lane.id);
          this.roadLanes.push(lane.id);
          if (edge.jam) this.jamLanes.push(lane.id);
        }
      }
    }
  }

  private lanesLeaving(node: RoadNode, edgeIndex: number): Lane[] {
    const edge = this.edges[edgeIndex];
    return edge.lanes.map((id) => this.lanes[id]).filter((lane) => lane.node !== node.index || (edge.a === edge.b));
  }

  private buildConnectors(): void {
    const config = CITY.network;
    const straightLimit = (config.straightAngleDeg * Math.PI) / 180;
    const startSample = createSample();
    const endSample = createSample();
    const roadLaneCount = this.lanes.length;

    for (let laneId = 0; laneId < roadLaneCount; laneId++) {
      const from = this.lanes[laneId];
      const node = this.nodes[from.node];
      from.line.sample(from.line.length, endSample);

      const otherLegs = node.legs.filter((leg) => leg.edge !== from.edge);
      // A closed road or dead end turns traffic around.
      const legs = otherLegs.length > 0 ? otherLegs : node.legs;

      // First pass follows lane discipline. The second covers a lane that discipline left with
      // no way out, such as the inner lane at a bend that only turns left.
      for (const strict of [true, false]) {
        if (from.next.length > 0) break;
        for (const leg of legs) {
          const outgoing = this.lanesLeaving(node, leg.edge);
          const fromSpec = CITY.roads[from.kind];
          for (const to of outgoing) {
            to.line.sample(0, startSample);
            const dot = endSample.tx * startSample.tx + endSample.tz * startSample.tz;
            const cross = endSample.tx * startSample.tz - endSample.tz * startSample.tx;
            const angle = Math.atan2(cross, dot);
            const isStraight = Math.abs(angle) < straightLimit;
            // With +Z forward and +X left, a negative cross product is a left turn.
            const isLeft = cross < 0 && !isStraight;
            const toSpec = CITY.roads[to.kind];
            if (node.roundabout) {
              if (to.index !== toSpec.lanes - 1) continue;
            } else if (strict) {
              const fromOuter = from.index === fromSpec.lanes - 1;
              const toOuter = to.index === toSpec.lanes - 1;
              if (isStraight) {
                if (Math.min(from.index, toSpec.lanes - 1) !== to.index) continue;
              } else if (isLeft) {
                // Left-hand traffic: the left turn is the short one, from the outer lane.
                if (!fromOuter || !toOuter) continue;
              } else if (from.index !== 0 || to.index !== 0) {
                continue;
              }
            } else if (Math.min(from.index, toSpec.lanes - 1) !== to.index) {
              continue;
            }
            const connector = this.createConnector(from, to, node, startSample, endSample);
            from.next.push(connector.id);
            from.nextWeights.push(isStraight ? CITY.traffic.turnStraightWeight : 1);
          }
        }
      }
    }
  }

  private createConnector(from: Lane, to: Lane, node: RoadNode, start: PolylineSample, end: PolylineSample): Lane {
    const config = CITY.network;
    const raw: number[] = [];
    if (node.roundabout) {
      this.roundaboutPath(node, end, start, raw);
    } else {
      this.bezierPath(node, end, start, raw);
    }
    const line = new Polyline(raw, config.connectorSampleSpacing);
    const dot = end.tx * start.tx + end.tz * start.tz;
    const turnAngle = Math.acos(Math.min(1, Math.max(-1, dot)));
    const radius = turnAngle > 0.1 ? line.length / turnAngle : 200;
    const speedLimit = Math.max(config.connectorMinSpeed, Math.min(from.speedLimit, config.connectorSpeedPerRootRadius * Math.sqrt(radius)));
    const connector = this.addLane({
      line,
      edge: -1,
      node: node.index,
      isConnector: true,
      kind: to.kind,
      index: to.index,
      laneWidth: Math.min(from.laneWidth, to.laneWidth),
      speedLimit,
      jam: false,
      signalGroup: 0,
    });
    connector.next.push(to.id);
    connector.nextWeights.push(1);
    return connector;
  }

  private bezierPath(node: RoadNode, end: PolylineSample, start: PolylineSample, raw: number[]): void {
    const steps = 14;
    // Control point where the two tangents meet, or the node centre when they do not.
    let cx = node.x;
    let cz = node.z;
    const denominator = end.tx * start.tz - end.tz * start.tx;
    if (Math.abs(denominator) > 0.25) {
      const t = ((start.x - end.x) * start.tz - (start.z - end.z) * start.tx) / denominator;
      if (t > 0 && t < node.radius * 3) {
        cx = end.x + end.tx * t;
        cz = end.z + end.tz * t;
      }
    } else if (end.tx * start.tx + end.tz * start.tz > 0) {
      cx = (end.x + start.x) / 2;
      cz = (end.z + start.z) / 2;
    }
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const u = 1 - t;
      raw.push(
        u * u * end.x + 2 * u * t * cx + t * t * start.x,
        end.y + (start.y - end.y) * t,
        u * u * end.z + 2 * u * t * cz + t * t * start.z,
      );
    }
  }

  /** Left-hand traffic circles clockwise as seen from above, which is increasing angle in x-z. */
  private roundaboutPath(node: RoadNode, end: PolylineSample, start: PolylineSample, raw: number[]): void {
    const ring = CITY.network.roundaboutRingRadius;
    const entryAngle = Math.atan2(end.z - node.z, end.x - node.x);
    let exitAngle = Math.atan2(start.z - node.z, start.x - node.x);
    while (exitAngle <= entryAngle + 0.2) exitAngle += Math.PI * 2;
    const entryRadius = Math.hypot(end.x - node.x, end.z - node.z);
    const exitRadius = Math.hypot(start.x - node.x, start.z - node.z);
    const steps = Math.max(10, Math.ceil(((exitAngle - entryAngle) * ring) / 2.5));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = entryAngle + (exitAngle - entryAngle) * t;
      const blendIn = smoothstep(0, 0.22, t);
      const blendOut = smoothstep(0.78, 1, t);
      const radius = entryRadius + (ring - entryRadius) * blendIn + (exitRadius - ring) * blendOut;
      raw.push(node.x + Math.cos(angle) * radius, node.y, node.z + Math.sin(angle) * radius);
    }
  }

  private buildSpatialIndex(): void {
    const sample = this.sample;
    for (const edge of this.edges) {
      const line = edge.center;
      for (let i = 0; i < line.count; i++) {
        const s = i * line.spacing;
        line.sample(s, sample);
        const key = this.spatialKey(sample.x, sample.z);
        let bucket = this.spatial.get(key);
        if (!bucket) {
          bucket = [];
          this.spatial.set(key, bucket);
        }
        bucket.push({ edge: edge.index, s });
      }
    }
  }

  private spatialKey(x: number, z: number): number {
    const cell = CITY.network.spatialCell;
    return (Math.floor(x / cell) + 4096) * 8192 + (Math.floor(z / cell) + 4096);
  }

  /**
   * Nearest visible road point. A known height keeps a car under the flyover from
   * snapping up onto it. Searches outward, so it always finds something.
   */
  nearestRoad(x: number, z: number, y: number | null = null, out: RoadHit = createRoadHit()): RoadHit {
    const cell = CITY.network.spatialCell;
    const cx = Math.floor(x / cell);
    const cz = Math.floor(z / cell);
    const sample = this.sample;
    let best = Infinity;
    for (let ring = 0; ring < 40; ring++) {
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dz = -ring; dz <= ring; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
          const bucket = this.spatial.get((cx + dx + 4096) * 8192 + (cz + dz + 4096));
          if (!bucket) continue;
          for (const entry of bucket) {
            const edge = this.edges[entry.edge];
            edge.center.sample(entry.s, sample);
            const distance = Math.hypot(sample.x - x, sample.z - z);
            const heightPenalty = y === null ? 0 : Math.abs(sample.y - y) * 6;
            const score = distance + heightPenalty;
            if (score < best) {
              best = score;
              out.edge = entry.edge;
              out.s = entry.s;
              out.x = sample.x;
              out.y = sample.y;
              out.z = sample.z;
              out.tx = sample.tx;
              out.tz = sample.tz;
              out.distance = distance;
            }
          }
        }
      }
      // A closer point cannot exist once the rings have gone past the best score.
      if (best < (ring - 1) * cell) break;
    }
    return out;
  }

  /** Shortest route over nodes with A*. Returns node indices, or an empty list. */
  findRoute(fromNode: number, toNode: number): number[] {
    if (fromNode === toNode) return [fromNode];
    const count = this.nodes.length;
    const cost = new Float64Array(count).fill(Infinity);
    const estimate = new Float64Array(count).fill(Infinity);
    const previous = new Int32Array(count).fill(-1);
    const open = new Set<number>([fromNode]);
    const target = this.nodes[toNode];
    const heuristic = (node: number): number => Math.hypot(this.nodes[node].x - target.x, this.nodes[node].z - target.z);
    cost[fromNode] = 0;
    estimate[fromNode] = heuristic(fromNode);
    while (open.size > 0) {
      let current = -1;
      let bestEstimate = Infinity;
      for (const node of open) {
        if (estimate[node] < bestEstimate) {
          bestEstimate = estimate[node];
          current = node;
        }
      }
      if (current === toNode) break;
      open.delete(current);
      for (const neighbor of this.neighbors[current]) {
        const next = cost[current] + neighbor.length;
        if (next < cost[neighbor.node]) {
          cost[neighbor.node] = next;
          previous[neighbor.node] = current;
          estimate[neighbor.node] = next + heuristic(neighbor.node);
          open.add(neighbor.node);
        }
      }
    }
    if (previous[toNode] < 0) return [];
    const route = [toNode];
    while (route[route.length - 1] !== fromNode) route.push(previous[route[route.length - 1]]);
    return route.reverse();
  }

  /** Edge joining two neighbouring nodes. */
  edgeBetween(a: number, b: number): RoadEdge | null {
    const link = this.neighbors[a].find((neighbor) => neighbor.node === b);
    return link ? this.edges[link.edge] : null;
  }

  /** Total lane length, used in tests and to size traffic. */
  totalRoadLength(): number {
    return this.edges.reduce((sum, edge) => sum + edge.center.length, 0);
  }
}

export function createRoadHit(): RoadHit {
  return { edge: 0, s: 0, x: 0, y: 0, z: 0, tx: 0, tz: 1, distance: 0 };
}

/** A seeded pick from a weighted list. */
export function weightedPick(weights: readonly number[], random: number): number {
  let total = 0;
  for (const weight of weights) total += weight;
  let remaining = random * total;
  for (let i = 0; i < weights.length; i++) {
    remaining -= weights[i];
    if (remaining <= 0) return i;
  }
  return weights.length - 1;
}

