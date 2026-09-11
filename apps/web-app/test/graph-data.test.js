import test from 'node:test';
import assert from 'node:assert/strict';

function computeTwoHopNeighborhood(focalId, links) {
  const neighborhood = new Set([focalId]);

  // 1-hop
  links.forEach((l) => {
    if (l.from === focalId) neighborhood.add(l.to);
    if (l.to === focalId) neighborhood.add(l.from);
  });

  // 2-hop
  const oneHopList = Array.from(neighborhood);
  links.forEach((l) => {
    if (oneHopList.includes(l.from)) neighborhood.add(l.to);
    if (oneHopList.includes(l.to)) neighborhood.add(l.from);
  });

  return Array.from(neighborhood);
}

test('Web App Graph Data: extracts accurate 2-hop neighborhood subset', () => {
  const links = [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' },
    { from: 'C', to: 'D' }, // 3-hop from A
    { from: 'A', to: 'E' },
    { from: 'X', to: 'Y' }, // disconnected
  ];

  const neighborhoodFromA = computeTwoHopNeighborhood('A', links);

  // A, B (1-hop), E (1-hop), C (2-hop) should be included
  assert.ok(neighborhoodFromA.includes('A'));
  assert.ok(neighborhoodFromA.includes('B'));
  assert.ok(neighborhoodFromA.includes('E'));
  assert.ok(neighborhoodFromA.includes('C'));

  // D (3-hop) and X, Y (disconnected) should NOT be in 2-hop neighborhood
  assert.equal(neighborhoodFromA.includes('D'), false);
  assert.equal(neighborhoodFromA.includes('X'), false);
  assert.equal(neighborhoodFromA.includes('Y'), false);
});
