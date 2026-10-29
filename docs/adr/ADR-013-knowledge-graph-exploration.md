# ADR-013: Knowledge Graph Exploration

## Status

Accepted

## Context

The graph exposed powerful drag, zoom, and link gestures but gave users little explanation of scope, result count, node meaning, or available next actions. Category chips consumed increasing space as custom types grew, technical note identifiers were hard to scan, and clicking a node immediately left the graph.

## Decision

- The graph occupies the full workspace and offers Local neighborhood and Entire vault scopes. Local scope is the active note plus its two-hop neighborhood.
- Stored note titles remain unchanged; underscores and hyphens are humanized only at presentation time.
- Node size is bounded by connection degree. Selection also uses a strong outline, neighboring edges, de-emphasis, and a details inspector so meaning never depends on color alone.
- The inspector exposes type, tags, incoming links, outgoing links, Open note, and Connect actions.
- Search results are keyboard-operable, custom categories use a scalable select control, and all zoom/link actions have named controls.
- Labels reduce automatically on large or zoomed-out graphs. Neighborhood discovery uses linear-time sets, with a synthetic 2,000-node fixture guarding the interaction budget.

## Consequences

Users can explore before navigating away and can perform core graph actions without learning hidden gestures. The toolbar remains compact as custom types grow. Canvas rendering is retained for performance, with accessible HTML search, inspection, opening, and connection alternatives layered above it.

## Guardrails

- Exact titles and wiki-link targets are never rewritten by display humanization.
- Existing drag, pan, zoom, and link creation behavior remains available.
- The required two-hop neighborhood semantics remain unchanged.
- Locked Vault graph data remains unavailable at the application routing and server authorization layers.
