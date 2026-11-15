/**
 * A race course built from a list of map nodes: a smoothed driving line that keeps to the
 * left carriageway on wide roads, goes around roundabouts, and knows its own gates and corners.
 * No rendering here, so tests can drive real courses headless.
 */

import { RACE } from '../config/race-tuning';
import { Polyline, createSample } from '../core/polyline';
import type { RoadNetwork } from '../world/city/road-network';
import { TOLL_X, TOLL_Z } from '../world/city/city-map';
import { CITY } from '../config/city-tuning';

export interface CourseGate {
  /** Distance past the start line at which this gate is reached. */
  progress: number;
  x: number;
  y: number;
  z: number;
  tx: number;
  tz: number;
  /** Half the road's width at the gate. */
  halfWidth: number;
}

export interface CourseCorner {
  x: number;
  y: number;
  z: number;
  /** The way the board faces, toward oncoming drivers. */
  yaw: number;
  /** 1 means the road turns left, -1 right. */
  turn: number;
}

export interface GridPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

interface RawPoint {
  x: number;
  y: number;
  z: number;
  /** Left of travel, from the road's centre to the middle of the side being driven. */
  offset: number;
  /** Half the width of the side being driven. */
  half: number;
  /** Half the width of the whole road. */
  roadHalf: number;
  lane: number;
  inNode: number;
}

function smoothAxis(values: number[], radius: number, passes: number, wrap: boolean): void {
  const count = values.length;
  const copy = new Array<number>(count);
  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < count; i++) {
      let sum = 0;
      let weight = 0;
      for (let j = -radius; j <= radius; j++) {
        let k = i + j;
        if (wrap) k = (k + count) % count;
        else k = Math.max(0, Math.min(count - 1, k));
        sum += values[k];
        weight++;
      }
      copy[i] = sum / weight;
    }
    for (let i = 0; i < count; i++) values[i] = copy[i];
  }
}

/** Expands a list of waypoints into adjacent nodes, finding the road between any that do not touch. */
export function expandRoute(network: RoadNetwork, ids: readonly string[]): number[] {
  const route: number[] = [network.nodeIndex(ids[0])];
  for (let i = 1; i < ids.length; i++) {
    const from = route[route.length - 1];
    const to = network.nodeIndex(ids[i]);
    if (network.edgeBetween(from, to)) {
      route.push(to);
      continue;
    }
    const path = network.findRoute(from, to);
    if (path.length < 2) throw new Error(`No road from ${ids[i - 1]} to ${ids[i]}`);
    for (let j = 1; j < path.length; j++) route.push(path[j]);
  }
  return route;
}

export class RaceCourse {
  /** The driving line. */
  readonly line: Polyline;
  readonly loop: boolean;
  /** Distance along the line of the start line. */
  readonly startS: number;
  /** Distance from the start line to the finish, or one lap. */
  readonly lapLength: number;
  readonly gates: CourseGate[] = [];
  readonly corners: CourseCorner[] = [];
  readonly offsets: Float32Array;
  readonly halfWidths: Float32Array;
  readonly roadHalf: Float32Array;
  readonly isLane: Uint8Array;
  readonly inNode: Uint8Array;
  /** Set by locate(): how far from the line the car was. */
  lastDistance = 0;

  private readonly sample = createSample();

  constructor(
    network: RoadNetwork,
    route: readonly number[],
    loop: boolean,
  ) {
    this.loop = loop;
    const raw = this.collectRaw(network, route, loop);
    const built = this.smoothAndOffset(raw, loop);
    this.line = built.line;
    this.offsets = built.offsets;
    this.halfWidths = built.halfWidths;
    this.roadHalf = built.roadHalf;
    this.isLane = built.isLane;
    this.inNode = built.inNode;

    const config = RACE.course;
    if (loop) {
      this.startS = 0;
      this.lapLength = this.line.length;
    } else {
      this.startS = config.runUp;
      this.lapLength = this.line.length - config.runUp - config.finishInset;
    }
    this.placeGates();
    this.findCorners();
  }

  /** Builds a course from map node ids. */
  static fromNodes(network: RoadNetwork, ids: readonly string[], loop: boolean): RaceCourse {
    return new RaceCourse(network, expandRoute(network, ids), loop);
  }

  private collectRaw(network: RoadNetwork, route: readonly number[], loop: boolean): RawPoint[] {
    const points: RawPoint[] = [];
    const sample = createSample();
    const ring = CITY.network.roundaboutRingRadius;
    for (let i = 0; i + 1 < route.length; i++) {
      const from = route[i];
      const to = route[i + 1];
      const edge = network.edgeBetween(from, to);
      if (!edge) throw new Error(`Nodes ${network.nodes[from].id} and ${network.nodes[to].id} are not joined`);
      const forward = edge.a === from;
      const spec = edge.spec;
      // Wide roads have a median, so a car belongs on its own side.
      const offset = spec.lanes >= 2 ? spec.median / 2 + (spec.laneWidth * spec.lanes) / 2 : 0;
      const half = spec.lanes >= 2 ? (spec.laneWidth * spec.lanes) / 2 : spec.halfWidth - 0.4;
      const step = 4;
      const steps = Math.max(2, Math.ceil(edge.full.length / step));
      const nodeFrom = network.nodes[from];
      const nodeTo = network.nodes[to];
      for (let k = 0; k <= steps; k++) {
        if (k === 0 && points.length > 0) continue;
        const s = (k / steps) * edge.full.length;
        edge.full.sample(forward ? s : edge.full.length - s, sample);
        const nearFrom = Math.hypot(sample.x - nodeFrom.x, sample.z - nodeFrom.z);
        const nearTo = Math.hypot(sample.x - nodeTo.x, sample.z - nodeTo.z);
        // Never drive through the monument: leave the road at the ring.
        if ((nodeFrom.roundabout && nearFrom < ring) || (nodeTo.roundabout && nearTo < ring)) continue;
        points.push({
          x: sample.x,
          y: sample.y,
          z: sample.z,
          offset,
          half,
          roadHalf: spec.halfWidth,
          lane: edge.kind === 'lane' ? 1 : 0,
          inNode: nearFrom < nodeFrom.radius + 7 || nearTo < nodeTo.radius + 7 ? 1 : 0,
        });
      }
      if (nodeTo.roundabout && i + 2 < route.length) this.appendRing(points, network, nodeTo.index, route[i + 2]);
    }
    if (loop && points.length > 2) {
      // The first and last points are the same node, so one goes.
      const first = points[0];
      const last = points[points.length - 1];
      if (Math.hypot(first.x - last.x, first.z - last.z) < 4) points.pop();
      this.rotateToStart(points);
    }
    return points;
  }

  /** Goes round a roundabout the way traffic does: clockwise, by increasing angle. */
  private appendRing(points: RawPoint[], network: RoadNetwork, nodeIndex: number, nextIndex: number): void {
    const node = network.nodes[nodeIndex];
    const edge = network.edgeBetween(nodeIndex, nextIndex);
    if (!edge || points.length === 0) return;
    const sample = createSample();
    const ring = CITY.network.roundaboutRingRadius;
    const last = points[points.length - 1];
    const startAngle = Math.atan2(last.z - node.z, last.x - node.x);
    const forward = edge.a === nodeIndex;
    edge.full.sample(forward ? ring + 2 : edge.full.length - ring - 2, sample);
    let endAngle = Math.atan2(sample.z - node.z, sample.x - node.x);
    while (endAngle < startAngle) endAngle += Math.PI * 2;
    const arc = (endAngle - startAngle) * ring;
    const steps = Math.max(2, Math.ceil(arc / 4));
    for (let k = 1; k < steps; k++) {
      const angle = startAngle + ((endAngle - startAngle) * k) / steps;
      points.push({
        x: node.x + Math.cos(angle) * ring,
        y: node.y,
        z: node.z + Math.sin(angle) * ring,
        offset: 0,
        half: 5,
        roadHalf: 7,
        lane: 0,
        inNode: 1,
      });
    }
  }

  /** A loop's line starts a little past its first node, so the grid is on a straight piece of road. */
  private rotateToStart(points: RawPoint[]): void {
    let shift = Math.round(RACE.course.loopStartOffset / 4);
    // Keep walking if that still lands in a junction.
    let guard = 0;
    while (points[shift % points.length].inNode && guard < points.length) {
      shift++;
      guard++;
    }
    const head = points.splice(0, shift % points.length);
    points.push(...head);
  }

  private smoothAndOffset(raw: RawPoint[], loop: boolean): {
    line: Polyline;
    offsets: Float32Array;
    halfWidths: Float32Array;
    roadHalf: Float32Array;
    isLane: Uint8Array;
    inNode: Uint8Array;
  } {
    const config = RACE.course;
    const xs = raw.map((p) => p.x);
    const ys = raw.map((p) => p.y);
    const zs = raw.map((p) => p.z);
    const offsets = raw.map((p) => p.offset);
    const halves = raw.map((p) => p.half);
    smoothAxis(xs, config.smoothRadius, config.smoothPasses, loop);
    smoothAxis(zs, config.smoothRadius, config.smoothPasses, loop);
    smoothAxis(ys, config.smoothRadius, config.smoothPasses, loop);
    smoothAxis(offsets, config.offsetSmoothRadius, config.offsetSmoothPasses, loop);

    // Move sideways onto the driven side, then around anything standing on the road.
    const count = raw.length;
    const flat = new Float32Array((count + (loop ? 1 : 0)) * 3);
    for (let i = 0; i < count; i++) {
      const a = loop ? (i - 1 + count) % count : Math.max(0, i - 1);
      const b = loop ? (i + 1) % count : Math.min(count - 1, i + 1);
      const dx = xs[b] - xs[a];
      const dz = zs[b] - zs[a];
      const length = Math.hypot(dx, dz) || 1;
      const leftX = dz / length;
      const leftZ = -dx / length;
      const obstacle = Math.hypot(xs[i] - TOLL_X, zs[i] - TOLL_Z);
      // The driving line already clears the toll booth on the left side; this keeps a margin when the side is narrow.
      const push = ys[i] > 4 && obstacle < config.obstacleReach ? Math.max(0, config.obstaclePush - offsets[i]) : 0;
      offsets[i] += push;
      flat[i * 3] = xs[i] + leftX * offsets[i];
      flat[i * 3 + 1] = ys[i];
      flat[i * 3 + 2] = zs[i] + leftZ * offsets[i];
    }
    if (loop) {
      flat[count * 3] = flat[0];
      flat[count * 3 + 1] = flat[1];
      flat[count * 3 + 2] = flat[2];
    }
    const line = new Polyline(flat, config.spacing);

    // Attributes follow the same fractions of the raw list.
    const total = line.count;
    const outOffsets = new Float32Array(total);
    const outHalf = new Float32Array(total);
    const outRoad = new Float32Array(total);
    const outLane = new Uint8Array(total);
    const outNode = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      const fraction = i / (total - 1);
      const index = Math.min(count - 1, Math.round(fraction * (count - (loop ? 0 : 1))) % count);
      outOffsets[i] = offsets[index];
      outHalf[i] = halves[index];
      outRoad[i] = raw[index].roadHalf;
      outLane[i] = raw[index].lane;
      outNode[i] = raw[index].inNode;
    }
    return { line, offsets: outOffsets, halfWidths: outHalf, roadHalf: outRoad, isLane: outLane, inNode: outNode };
  }

  private indexAt(s: number): number {
    return Math.max(0, Math.min(this.line.count - 1, Math.round(s / this.line.spacing)));
  }

  /** Distance along the line for a distance past the start line. */
  toLineS(progress: number): number {
    if (!this.loop) return this.startS + progress;
    const length = this.line.length;
    return ((progress % length) + length) % length;
  }

  isLaneAt(progress: number): boolean {
    return this.isLane[this.indexAt(this.toLineS(progress))] === 1;
  }

  private placeGates(): void {
    const config = RACE.course;
    const count = Math.max(config.gateMinimum, Math.round(this.lapLength / config.gateSpacing));
    for (let i = 1; i <= count; i++) {
      let progress = (this.lapLength * i) / count;
      // The last gate is the finish line and stays exactly there.
      if (i < count) {
        let guard = 0;
        while (this.inNode[this.indexAt(this.toLineS(progress))] && guard < 30) {
          progress += this.line.spacing * 2;
          guard++;
        }
      }
      this.gates.push(this.makeGate(Math.min(progress, this.lapLength)));
    }
  }

  private makeGate(progress: number): CourseGate {
    const sample = this.sample;
    this.line.sample(this.toLineS(progress), sample);
    const index = this.indexAt(this.toLineS(progress));
    // The arch spans the whole road, so it stands on the road's centre rather than the driving line.
    const offset = this.offsets[index];
    return {
      progress,
      x: sample.x - sample.tz * offset,
      y: sample.y,
      z: sample.z + sample.tx * offset,
      tx: sample.tx,
      tz: sample.tz,
      halfWidth: this.roadHalf[index],
    };
  }

  /** The gate that marks the finish of a sprint or the start of a lap. */
  get startGate(): CourseGate {
    return this.makeGate(0);
  }

  private findCorners(): void {
    const config = RACE.course;
    const line = this.line;
    const span = config.cornerSpan;
    const a = createSample();
    const b = createSample();
    const c = createSample();
    let lastS = -Infinity;
    for (let s = span; s < line.length - span; s += line.spacing * 2) {
      if (s - lastS < config.cornerSpacing) continue;
      line.sample(s - span / 2, a);
      line.sample(s + span / 2, b);
      const cross = a.tx * b.tz - a.tz * b.tx;
      const dot = a.tx * b.tx + a.tz * b.tz;
      const angle = Math.atan2(cross, dot);
      if (Math.abs(angle) < config.cornerAngle) continue;
      line.sample(s, c);
      // In this frame a negative cross product is a left turn. The board stands on the outside of the bend.
      const turn = angle < 0 ? 1 : -1;
      const outward = -turn;
      const index = this.indexAt(s);
      const reach = this.roadHalf[index] + 1.6;
      const offset = this.offsets[index];
      this.corners.push({
        x: c.x - c.tz * offset + c.tz * outward * reach,
        y: c.y,
        z: c.z + c.tx * offset - c.tx * outward * reach,
        yaw: Math.atan2(-a.tx, -a.tz),
        turn,
      });
      lastS = s;
    }
  }

  /**
   * Finds where a car is on the line, near where it was last time.
   * @returns distance along the line. lastDistance holds how far from the line it is.
   */
  locate(x: number, y: number, z: number, hint: number): number {
    const config = RACE.course;
    const line = this.line;
    const spacing = line.spacing;
    const p = line.points;
    const count = line.count;
    const center = Math.round(hint / spacing);
    const back = Math.round(config.locateBack / spacing);
    const ahead = Math.round(config.locateAhead / spacing);
    let bestIndex = center;
    let best = Infinity;
    for (let k = -back; k <= ahead; k++) {
      let i = center + k;
      if (this.loop) i = ((i % (count - 1)) + (count - 1)) % (count - 1);
      else if (i < 0 || i >= count) continue;
      const dx = p[i * 3] - x;
      const dy = (p[i * 3 + 1] - y) * config.locateHeightWeight;
      const dz = p[i * 3 + 2] - z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < best) {
        best = distance;
        bestIndex = i;
      }
    }
    this.lastDistance = Math.sqrt(best);
    return bestIndex * spacing;
  }

  /** Change in distance between two readings, allowing for a loop's wrap-around. */
  delta(from: number, to: number): number {
    let change = to - from;
    if (this.loop) {
      const length = this.line.length;
      if (change > length / 2) change -= length;
      else if (change < -length / 2) change += length;
    }
    return change;
  }

  /** Starting grid: two cars to a row, behind the start line. */
  gridPose(index: number): GridPose {
    const config = RACE.grid;
    const row = Math.floor(index / 2);
    const back = config.behindLine + row * config.rowSpacing + (index % 2) * 2;
    const s = this.loop ? this.line.length - back : this.startS - back;
    const sample = this.sample;
    this.line.sample(s, sample);
    const half = this.halfWidths[this.indexAt(s)];
    // Keep the whole car well inside the driven side, so nobody starts wedged against a barrier.
    const side = (index % 2 === 0 ? 1 : -1) * Math.min(config.sideOffset, Math.max(0.9, half - 1.7));
    return {
      x: sample.x + sample.tz * side,
      y: sample.y,
      z: sample.z - sample.tx * side,
      yaw: Math.atan2(sample.tx, sample.tz),
    };
  }

  /**
   * A driver's line: leans into corners by inset, with a fixed sideways bias, as flat x, z values.
   * @param distance how much course to cover, starting from behind the start line
   */
  buildDriveLine(inset: number, bias: number, distance: number, spacing: number): number[] {
    const line = this.line;
    const sample = this.sample;
    const steps = Math.max(2, Math.ceil(distance / spacing));
    const startProgress = -RACE.grid.behindLine - RACE.grid.rowSpacing * 5;
    const tx: number[] = [];
    const tz: number[] = [];
    const xs: number[] = [];
    const zs: number[] = [];
    const offsets: number[] = [];
    const room: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const s = this.loop ? this.toLineS(startProgress + i * spacing) : Math.min(line.length, Math.max(0, this.startS + startProgress + i * spacing));
      line.sample(s, sample);
      xs.push(sample.x);
      zs.push(sample.z);
      tx.push(sample.tx);
      tz.push(sample.tz);
      room.push(Math.max(0, this.halfWidths[this.indexAt(s)] - 1.5));
    }
    for (let i = 0; i <= steps; i++) {
      const a = Math.max(0, i - 2);
      const b = Math.min(steps, i + 2);
      const cross = tx[a] * tz[b] - tz[a] * tx[b];
      const dot = tx[a] * tx[b] + tz[a] * tz[b];
      const angle = Math.atan2(cross, dot);
      // Negative means a left turn, so the apex is to the left, which is positive here.
      const lean = Math.max(-1, Math.min(1, -angle / 0.55));
      offsets.push(lean * room[i] * inset);
    }
    smoothAxis(offsets, 3, 3, false);
    const points: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const limit = room[i] + 0.2;
      const total = Math.max(-limit, Math.min(limit, offsets[i] + bias));
      points.push(xs[i] + tz[i] * total, zs[i] - tx[i] * total);
    }
    return points;
  }

  /** Flat x, z of the whole course, for the map. */
  mapPoints(): number[] {
    const points: number[] = [];
    const line = this.line;
    for (let i = 0; i < line.count; i += 4) points.push(line.points[i * 3], line.points[i * 3 + 2]);
    if (this.loop) points.push(line.points[0], line.points[2]);
    return points;
  }
}
