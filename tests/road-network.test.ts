/** The city map must be drivable and every lane must lead somewhere. Run: npm test */

import { describe, expect, it } from 'vitest';
import { POINTS_OF_INTEREST, districtAt } from '../src/world/city/city-map';
import { RoadNetwork } from '../src/world/city/road-network';
import { createSample } from '../src/core/polyline';

const network = new RoadNetwork();

describe('road network', () => {
  it('has a size that suits two districts', () => {
    const total = network.totalRoadLength();
    const signals = network.nodes.filter((node) => node.signalized).length;
    console.log(`network: ${network.nodes.length} nodes, ${network.edges.length} edges, ${(total / 1000).toFixed(1)} km of road, ${network.lanes.length} lanes, ${signals} signals, ${network.jamLanes.length} jam lanes`);
    expect(total).toBeGreaterThan(12000);
    expect(signals).toBeGreaterThan(5);
    expect(network.jamLanes.length).toBeGreaterThan(0);
  });

  it('every node can reach every other node', () => {
    for (const node of network.nodes) {
      const route = network.findRoute(0, node.index);
      expect(route.length, node.id).toBeGreaterThan(0);
    }
  });

  it('every road lane leads somewhere and no connector dead-ends', () => {
    for (const lane of network.lanes) {
      expect(lane.next.length, `lane ${lane.id} at ${network.nodes[lane.node].id}`).toBeGreaterThan(0);
      expect(lane.nextWeights.length).toBe(lane.next.length);
      expect(lane.line.length).toBeGreaterThan(0.5);
    }
  });

  it('connectors join the lanes they link without a jump', () => {
    const a = createSample();
    const b = createSample();
    for (const lane of network.lanes) {
      if (lane.isConnector) continue;
      for (const connectorId of lane.next) {
        const connector = network.lanes[connectorId];
        lane.line.sample(lane.line.length, a);
        connector.line.sample(0, b);
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.5);
        const target = network.lanes[connector.next[0]];
        connector.line.sample(connector.line.length, a);
        target.line.sample(0, b);
        expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(0.5);
      }
    }
  });

  it('traffic keeps to the left of the road', () => {
    const lane = network.lanes.find((candidate) => !candidate.isConnector && candidate.kind === 'avenue');
    expect(lane).toBeDefined();
    const edge = network.edges[lane!.edge];
    const onLane = createSample();
    const onCenter = createSample();
    lane!.line.sample(lane!.line.length / 2, onLane);
    const s = edge.center.nearestDistance(onLane.x, onLane.z);
    edge.center.sample(s, onCenter);
    // Left of travel is (tz, -tx).
    const leftness = (onLane.x - onCenter.x) * onLane.tz - (onLane.z - onCenter.z) * onLane.tx;
    expect(leftness).toBeGreaterThan(1);
  });

  it('the flyover is high up and its ramps reach the ground', () => {
    for (const edge of network.edges) {
      if (edge.kind === 'deck') {
        expect(network.nodes[edge.a].y).toBe(9);
        expect(network.nodes[edge.b].y).toBe(9);
      }
      if (edge.kind === 'ramp') {
        const ys = [network.nodes[edge.a].y, network.nodes[edge.b].y].sort((p, q) => p - q);
        expect(ys).toEqual([0, 9]);
        expect(edge.full.length).toBeGreaterThan(180);
      }
    }
  });

  it('finds the nearest road, and keeps flyover and ground apart by height', () => {
    const onDeck = network.nearestRoad(100, -200, 9);
    const underDeck = network.nearestRoad(100, -200, 0);
    expect(onDeck.y).toBeGreaterThan(8);
    expect(underDeck.y).toBeLessThan(1);
    expect(underDeck.distance).toBeLessThan(6);
  });

  it('every point of interest exists and has a route from the monument', () => {
    for (const poi of POINTS_OF_INTEREST) {
      expect(network.findRoute(network.nodeIndex('R'), network.nodeIndex(poi.node)).length, poi.id).toBeGreaterThan(0);
    }
  });

  it('knows its two districts', () => {
    expect(districtAt(-300, 300)).toBe('puranTola');
    expect(districtAt(0, -460)).toBe('uralganj');
  });
});
