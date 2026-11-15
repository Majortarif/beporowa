/** Timing for the traffic lights. Roads facing each other share a green. */

import { CITY } from '../config/city-tuning';
import type { RoadNetwork, RoadNode } from '../world/city/road-network';

export type SignalState = 'green' | 'amber' | 'red';

export class SignalController {
  time = 0;

  constructor(private readonly network: RoadNetwork) {}

  update(dt: number): void {
    this.time += dt;
  }

  /** What a road in the given signal group sees at this node. */
  stateFor(node: RoadNode, group: number): SignalState {
    if (!node.signalized || node.signalGroups === 0) return 'green';
    const { green, amber, allRed } = CITY.signals;
    const phase = green + amber + allRed;
    const cycle = phase * node.signalGroups;
    // Each junction runs on its own offset, so the city does not switch all at once.
    const t = (this.time + node.index * 7.3) % cycle;
    const active = Math.floor(t / phase);
    if (active !== group) return 'red';
    const inPhase = t - active * phase;
    if (inPhase < green) return 'green';
    if (inPhase < green + amber) return 'amber';
    return 'red';
  }

  get nodes(): readonly RoadNode[] {
    return this.network.nodes;
  }
}
