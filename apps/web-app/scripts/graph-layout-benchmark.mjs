// Opt-in benchmark for the knowledge graph layout (NFR-11): a 2,000-node vault.
//
//   node scripts/graph-layout-benchmark.mjs        (from apps/web-app)
//
// Runs the same d3-force configuration as components/graph/KnowledgeGraph.tsx outside a browser and
// reports the cost of one simulation step and the time for the layout to settle. It measures layout
// computation only: canvas drawing needs a real, visible browser and is not covered here.
import * as d3 from 'd3';

const NODES = Number(process.env.GRAPH_NODES || 2000);
const LINKS = Number(process.env.GRAPH_LINKS || Math.round(NODES * 1.5));
const FRAME_BUDGET_MS = 1000 / 60;
// GRAPH_LEGACY=1 measures the settings used for small graphs (and for every graph before the change)
const LARGE = NODES > 600 && process.env.GRAPH_LEGACY !== '1';

let seed = 42;
const random = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const nodes = Array.from({ length: NODES }, (_, i) => ({ id: `n${i}` }));
const links = [];
for (let i = 0; i < LINKS; i++) {
  // A few hubs and many leaves, like a real vault
  const source = random() < 0.3 ? Math.floor(random() * 40) : Math.floor(random() * NODES);
  const target = Math.floor(random() * NODES);
  if (source !== target) links.push({ source: `n${source}`, target: `n${target}` });
}
const degreeById = new Map();
for (const link of links) {
  degreeById.set(link.source, (degreeById.get(link.source) || 0) + 1);
  degreeById.set(link.target, (degreeById.get(link.target) || 0) + 1);
}

const simulation = d3
  .forceSimulation(nodes)
  .force('link', d3.forceLink(links).id((d) => d.id).distance(80))
  // Above 600 nodes the component uses a coarser, distance-limited repulsion and a faster decay
  .force('charge', LARGE
    ? d3.forceManyBody().strength((d) => -150 - Math.min(8, degreeById.get(d.id) || 0) * 12).theta(1.2).distanceMax(600)
    : d3.forceManyBody().strength((d) => -150 - Math.min(8, degreeById.get(d.id) || 0) * 12))
  .force('center', d3.forceCenter(640, 400))
  .force('collide', d3.forceCollide().radius((d) => Math.min(12, 6 + Math.sqrt(Math.min(8, degreeById.get(d.id) || 0)) * 2) + 14))
  .alphaDecay(LARGE ? 0.05 : 0.028)
  .stop();

const ticks = [];
const started = performance.now();
while (simulation.alpha() > simulation.alphaMin()) {
  const tickStart = performance.now();
  simulation.tick();
  ticks.push(performance.now() - tickStart);
}
const total = performance.now() - started;
const sorted = [...ticks].sort((a, b) => a - b);
const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
const mean = ticks.reduce((a, b) => a + b, 0) / ticks.length;

console.log(`graph layout: ${NODES} nodes, ${links.length} links, ${ticks.length} steps`);
console.log(`one step: mean ${mean.toFixed(1)} ms, p95 ${at(0.95).toFixed(1)} ms, max ${sorted[sorted.length - 1].toFixed(1)} ms (60 fps leaves ${FRAME_BUDGET_MS.toFixed(1)} ms per frame for layout and drawing together)`);
console.log(`layout computation to settle: ${(total / 1000).toFixed(2)} s; first 60 steps (the visible unfolding): ${(ticks.slice(0, 60).reduce((a, b) => a + b, 0) / 1000).toFixed(2)} s`);
// A large graph is not animated step by step: the steps run in slices between frames, so what the
// user waits for is the settle time, and frames are only needed again once the layout stands still.
const settlesInTime = total < 3000;
console.log(`settings: ${LARGE ? 'large-graph' : 'small-graph'}; settles within 3 s of computation: ${settlesInTime ? 'YES' : 'NO'}`);
process.exit(settlesInTime ? 0 : 1);
