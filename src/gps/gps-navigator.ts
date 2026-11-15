/**
 * Turn-by-turn directions over the road graph. Re-routes when you leave the path.
 * No rendering here, so tests can drive it headless.
 */

import { CITY } from '../config/city-tuning';
import { createSample } from '../core/polyline';
import { createRoadHit, type RoadNetwork } from '../world/city/road-network';

export type TurnKind = 'straight' | 'left' | 'right' | 'uturn' | 'arrive' | 'turnAround';

export interface GpsInstruction {
  turn: TurnKind;
  /** Metres to the turn. */
  distance: number;
  /** Metres to the destination. */
  remaining: number;
}

export class GpsNavigator {
  /** Node indices from the next node to the destination. */
  route: number[] = [];
  /** Flat x, z values of the route, for drawing on the map. */
  routePoints: number[] = [];
  destination = -1;
  readonly instruction: GpsInstruction = { turn: 'straight', distance: 0, remaining: 0 };
  arrived = false;

  private readonly hit = createRoadHit();
  private readonly sample = createSample();
  private repathTimer = 0;
  private headingX = 0;
  private headingZ = 0;
  private fromX = 0;
  private fromZ = 0;

  constructor(private readonly network: RoadNetwork) {}

  get isActive(): boolean {
    return this.destination >= 0;
  }

  /** Starts navigating to a node. Returns false if no route exists. */
  setDestination(node: number, x: number, y: number, z: number, headingX = 0, headingZ = 0): boolean {
    this.destination = node;
    this.arrived = false;
    this.headingX = headingX;
    this.headingZ = headingZ;
    const ok = this.plan(x, y, z);
    if (!ok) this.clear();
    return ok;
  }

  clear(): void {
    this.destination = -1;
    this.route = [];
    this.routePoints = [];
    this.arrived = false;
  }

  /** Plans from whichever end of the current road is on the way to the destination. */
  private plan(x: number, y: number, z: number): boolean {
    const network = this.network;
    const hit = network.nearestRoad(x, z, y, this.hit);
    const edge = network.edges[hit.edge];
    const distanceToA = hit.s;
    const distanceToB = edge.center.length - hit.s;
    const routeA = network.findRoute(edge.a, this.destination);
    const routeB = network.findRoute(edge.b, this.destination);
    if (routeA.length === 0 && routeB.length === 0) return false;
    // Turning round on the spot costs time, so the end of the road ahead is favoured.
    const penalty = (node: number): number => {
      const target = network.nodes[node];
      return (target.x - x) * this.headingX + (target.z - z) * this.headingZ < 0 ? CITY.gps.turnAroundPenalty : 0;
    };
    const costA = this.routeLength(routeA) + distanceToA + penalty(edge.a);
    const costB = this.routeLength(routeB) + distanceToB + penalty(edge.b);
    this.route = costA <= costB ? routeA : routeB;
    this.fromX = x;
    this.fromZ = z;
    this.buildRoutePoints();
    return true;
  }

  private routeLength(route: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const edge = this.network.edgeBetween(route[i], route[i + 1]);
      total += edge ? edge.full.length : 0;
    }
    return route.length === 0 ? Infinity : total;
  }

  private buildRoutePoints(): void {
    const network = this.network;
    const points: number[] = [this.fromX, this.fromZ];
    for (let i = 0; i < this.route.length; i++) {
      const node = network.nodes[this.route[i]];
      if (i === 0) {
        points.push(node.x, node.z);
        continue;
      }
      const previous = this.route[i - 1];
      const edge = network.edgeBetween(previous, this.route[i]);
      if (!edge) continue;
      const forward = edge.a === previous;
      const line = edge.full;
      const steps = Math.max(2, Math.ceil(line.length / 18));
      for (let step = 1; step <= steps; step++) {
        const s = (step / steps) * line.length;
        line.sample(forward ? s : line.length - s, this.sample);
        points.push(this.sample.x, this.sample.z);
      }
    }
    this.routePoints = points;
  }

  update(dt: number, x: number, y: number, z: number, headingX: number, headingZ: number): void {
    if (!this.isActive || this.route.length === 0) return;
    const config = CITY.gps;
    const network = this.network;
    this.repathTimer -= dt;
    this.headingX = headingX;
    this.headingZ = headingZ;

    // Drop nodes already reached.
    while (this.route.length > 1) {
      const next = network.nodes[this.route[0]];
      if (Math.hypot(next.x - x, next.z - z) < next.radius + 8) {
        this.route.shift();
        this.fromX = x;
        this.fromZ = z;
        this.buildRoutePoints();
      } else {
        break;
      }
    }

    const target = network.nodes[this.destination];
    if (Math.hypot(target.x - x, target.z - z) < config.arriveDistance + target.radius && Math.abs(target.y - y) < 5) {
      this.arrived = true;
    }

    // Off the planned road: plan again from here.
    if (this.repathTimer <= 0 && !this.arrived) {
      const next = network.nodes[this.route[0]];
      const offset = this.distanceToRoute(x, z);
      if (offset > config.offRouteDistance || Math.abs(next.y - y) > 7 + Math.hypot(next.x - x, next.z - z) * 0.1) {
        this.repathTimer = config.repathCooldown;
        this.plan(x, y, z);
      }
    }

    this.updateInstruction(x, z, headingX, headingZ);
  }

  private distanceToRoute(x: number, z: number): number {
    const points = this.routePoints;
    let best = Infinity;
    for (let i = 0; i + 3 < points.length; i += 2) {
      const ax = points[i];
      const az = points[i + 1];
      const bx = points[i + 2];
      const bz = points[i + 3];
      const dx = bx - ax;
      const dz = bz - az;
      const lengthSquared = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
      best = Math.min(best, Math.hypot(ax + dx * t - x, az + dz * t - z));
    }
    return best;
  }

  private updateInstruction(x: number, z: number, headingX: number, headingZ: number): void {
    const network = this.network;
    const instruction = this.instruction;
    const route = this.route;
    let remaining = 0;
    for (let i = 0; i < route.length - 1; i++) {
      const edge = network.edgeBetween(route[i], route[i + 1]);
      remaining += edge ? edge.full.length : 0;
    }
    const first = network.nodes[route[0]];
    const toFirst = Math.hypot(first.x - x, first.z - z);
    instruction.remaining = remaining + toFirst;

    // The next node is behind the car: the first thing to do is turn round.
    if (toFirst > first.radius + 12 && ((first.x - x) * headingX + (first.z - z) * headingZ) / toFirst < -0.3) {
      instruction.turn = 'turnAround';
      instruction.distance = 0;
      return;
    }

    // First point on the way out of the node ahead, compared with the way we arrive.
    let inX = first.x - x;
    let inZ = first.z - z;
    const inLength = Math.hypot(inX, inZ);
    if (inLength < first.radius + 12) {
      inX = headingX;
      inZ = headingZ;
    } else {
      inX /= inLength;
      inZ /= inLength;
    }

    // Find the next real decision: skip nodes where the road simply continues.
    let distance = toFirst;
    for (let i = 0; i < route.length - 1; i++) {
      const node = network.nodes[route[i]];
      const edge = network.edgeBetween(route[i], route[i + 1]);
      if (!edge) break;
      const forward = edge.a === route[i];
      edge.full.sample(forward ? 8 : edge.full.length - 8, this.sample);
      const outLength = Math.hypot(this.sample.x - node.x, this.sample.z - node.z) || 1;
      const outX = (this.sample.x - node.x) / outLength;
      const outZ = (this.sample.z - node.z) / outLength;
      const dot = inX * outX + inZ * outZ;
      const cross = inX * outZ - inZ * outX;
      const isChoice = node.legs.length >= 3;
      if (dot < 0.86 && (isChoice || dot < 0.5)) {
        instruction.distance = distance;
        // With +Z forward and +X left, a negative cross product is a left turn.
        instruction.turn = dot < -0.7 ? 'uturn' : cross < 0 ? 'left' : 'right';
        return;
      }
      // Carry on through this node.
      edge.full.sample(forward ? edge.full.length : 0, this.sample);
      const nextSample = createSample();
      edge.full.sample(forward ? edge.full.length - 1 : 1, nextSample);
      const arriveLength = Math.hypot(this.sample.x - nextSample.x, this.sample.z - nextSample.z) || 1;
      inX = (this.sample.x - nextSample.x) / arriveLength;
      inZ = (this.sample.z - nextSample.z) / arriveLength;
      distance += edge.full.length;
    }
    instruction.distance = instruction.remaining;
    instruction.turn = 'arrive';
  }
}
