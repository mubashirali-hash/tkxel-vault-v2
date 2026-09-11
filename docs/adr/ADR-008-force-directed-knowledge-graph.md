# ADR-008: 2D Force-Directed Knowledge Graph Rendering via D3.js and HTML5 Canvas

## Status
Accepted

## Context
A defining capability of the Open Context Hub is visual knowledge graph exploration (`FR-13`, `FR-14`, `NFR-11`):
1. Enterprise knowledge graphs grow rapidly to thousands of interconnected documents, client profiles, decisions, and meetings.
2. The renderer must achieve **60fps interactive navigation** and render **2,000+ nodes in under 3.0 seconds** (`NFR-11`).
3. SVG-based DOM node rendering degrades severely beyond 500 nodes due to thousands of DOM elements triggering reflows.
4. The user must be able to switch between the **Global Vault Graph** and a **Local 2-Hop Neighborhood Graph** focused around the currently open document (`FR-14`).

## Decision
We implement the knowledge graph engine using **D3.js force simulation combined with HTML5 Canvas hardware-accelerated rendering**:
1. **Simulation Engine:** `d3-force` computes the physics simulation (repulsion, link attraction, center centering, and collision avoidance) offscreen.
2. **Rendering Layer:** Rendered to a high-DPI HTML5 `<canvas>` element instead of individual SVG DOM elements. Canvas handles thousands of nodes and links simultaneously with zero DOM reflow overhead.
3. **Color-Coding:** Nodes are color-coded by page type:
   - `decision`: Emerald green (`#10b981`)
   - `meeting`: Purple (`#a855f7`)
   - `project`: Electric blue (`#3b82f6`)
   - `client`: Amber (`#f59e0b`)
   - `person`: Rose (`#f43f5e`)
   - `note` / other: Slate cyan (`#06b6d4`)
4. **Local Neighborhood Extraction:** A specialized graph sub-algorithm extracts the 1-hop and 2-hop connected graph subset dynamically when viewing a specific document.

## Consequences
- **Positive:** Exceeds the 2,000-node 60fps benchmark with fluid zooming and panning.
- **Positive:** Responsive hit-testing allows tooltips and click-to-open document transitions.
- **Negative:** Canvas requires manual hit detection algorithms (distance-based point picking) instead of native CSS `:hover` handlers.
