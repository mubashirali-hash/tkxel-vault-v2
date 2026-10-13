# ADR-012: Focused Authoring and Note Inspector

## Status

Accepted

## Context

The note editor gave metadata, backlinks, timeline, formatting, versioning, AI assistance, and destructive actions nearly equal visual weight. This reduced the space and attention available for writing, while fixed-position link suggestions and native browser confirmations created usability and accessibility problems.

## Decision

- The title, draft state, Save Draft, Publish, and AI Co-Pilot remain the primary editor controls.
- Category, aliases, tags, incoming links, outgoing links, local graph, and append-only timeline move into a note inspector available from the compact note summary.
- Infrequent version, protected-skill, and delete actions remain in the note action menu.
- The wiki-link picker follows the caret, exposes listbox semantics, and offers an application-dialog flow for creating an unresolved linked note.
- Common structured content is available from an Insert menu while Markdown shortcuts remain supported.
- Version comparison uses a line-oriented unified view and rollback requires an application dialog.
- Draft and published states remain explicit. Automatic background persistence is deferred until server save failures, conflicts, and audit-event coalescing have a defined contract; the editor instead shows unsaved, saved, and offline states without interrupting writing.

## Consequences

The editor has a calmer reading width and supporting detail remains one interaction away. Editors retain deliberate control over publishing and draft persistence. The application does not silently generate frequent save or audit events, but users must still select Save Draft before leaving a note.

## Guardrails

- Markdown serialization, YAML front matter, unknown custom fields, tags, aliases, and wiki-links retain their existing storage path.
- Timeline entries remain append-only and cannot be edited through the note body.
- Creating a missing linked note saves the source draft before navigation.
- Offline presentation never replaces server-side authorization or conflict validation.
- Locked Vault raw content and graph access remain unavailable.
