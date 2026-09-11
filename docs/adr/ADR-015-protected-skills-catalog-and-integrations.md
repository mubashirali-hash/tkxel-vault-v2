# ADR-015: Protected Skills Catalog and Integrations

## Status

Accepted

## Context

The Locked Vault repeated security explanations and status panels, used client-specific invocation wording, and included workstation-specific setup paths with an example database credential. Converting a note could also derive a public skill description directly from the note body, risking disclosure through catalog metadata.

## Decision

- The primary Locked Vault view is a single Protected skills catalog; the sidebar does not repeat skill cards.
- A concise protected-state banner leads with the user outcome, while zero-read implementation details remain expandable.
- Normal gateway, encryption, and skill counts form a compact health summary.
- Catalog actions use the client-neutral term Copy invocation. Client-specific syntax remains inside Integrations.
- Integrations cover Claude Desktop, Cursor, Codex/other IDEs, and remote Streamable HTTP using deployment placeholders rather than local usernames or plaintext credentials.
- Note conversion creates an explicit public catalog description and never derives that description from protected instructions. Existing descriptions that resemble instructions are replaced in the UI with a safe generic summary.

## Consequences

The Locked Vault is easier to scan and setup instructions are portable. Operators must replace deployment placeholders with values from their approved environment. Sensitive instructions remain confined to the protected execution field, not catalog metadata.

## Guardrails

- Locked Vault pages, graph data, raw markdown, directories, skill source, and export remain unavailable.
- Add and delete controls remain role-gated, with state changes continuing to create audit events.
- Clipboard writes happen only after a user selects a copy action and provide visible feedback.
- Integration examples contain no stored credential and authentication continues through corporate SSO claims.
