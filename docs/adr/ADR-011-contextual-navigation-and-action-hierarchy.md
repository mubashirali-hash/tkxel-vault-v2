# ADR-011: Contextual Navigation and Action Hierarchy

## Status

Accepted

## Context

The original application displayed Notes navigation, vault administration, integrations, sharing, encryption messaging, and feature actions at the same time. Graph and Audit inherited the Notes sidebar even though it was unrelated to those tasks. Locked Vault controls were repeated in the header, sidebar, and catalog, increasing cognitive load without adding protection.

## Decision

Navigation and actions are scoped to the work currently visible:

- Notes navigation appears only in the Open Vault editor.
- Graph owns graph exploration controls; Activity & Audit owns its search and filters.
- Locked Vault status remains persistent in the vault selector, while protected-skill actions live in the catalog.
- Import, export, access management, and integrations live in one role-aware workspace actions menu.
- The editor exposes Publish as its primary action, Save Draft and AI Co-Pilot as immediate secondary actions, and places infrequent or destructive commands in a named overflow menu.
- Plain-language labels lead; protocol terms such as MCP remain visible within technical setup and status details.

## Consequences

The default workspace is quieter and each screen has more usable width. Users need one extra menu interaction for infrequent administration commands, but those commands now have a stable location. Responsive visibility remains a presentation concern only; authorization is still enforced by server-side policy.

## Guardrails

- Locked Vault Graph and export capabilities remain unavailable.
- Hiding a control never substitutes for an authorization check.
- Destructive actions remain clearly named and require their existing confirmation.
- Renamed actions preserve their original behavior and audit events.
