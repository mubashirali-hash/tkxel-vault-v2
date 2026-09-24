# ADR-014: Human-Readable Audit Experience

## Status

Accepted

## Context

The audit screen presented event codes, raw identifiers, UTC strings, and serialized metadata in every row. This was useful for forensic review but made routine operational review unnecessarily technical and allowed large event histories to create unbounded tables.

## Decision

- Activity rows lead with plain-language actions, familiar people or resource names when those names are already authorized in the current workspace, concise metadata, and relative local time.
- Exact identifiers, action codes, UTC timestamps, and original metadata remain available in a read-only technical details drawer.
- Denied and security-alert events receive a distinct attention treatment; normal events remain visually quiet.
- Filters cover person, activity, outcome, date, and text search across visible people, resources, and action descriptions.
- Results paginate in groups of 25, and CSV copy explains that export covers the authorized current-vault audit trail.

## Consequences

Owners can scan common activity without decoding JSON or UUIDs, while forensic evidence remains one interaction away. Deleted or otherwise unresolved resources may still display an identifier unless an authorized event metadata title is available.

## Guardrails

- The UI resolves names only from current-vault data and metadata already returned to the authorized caller.
- The technical drawer is read-only and never mutates or rewrites an audit event.
- Pagination changes DOM volume only; it does not truncate CSV export or the underlying append-only log.
- Locked Vault events never reveal raw protected-skill content, paths, or secrets.
