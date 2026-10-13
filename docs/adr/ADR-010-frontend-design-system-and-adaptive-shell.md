# ADR-010: Frontend Design System and Adaptive Application Shell

## Status

Accepted

## Context

The Vault Admin Web App accumulated hundreds of inline style declarations and screen-specific control treatments. The fixed-width sidebar and single-row global header do not adapt to compact laptop, tablet, or mobile viewports. This makes visual changes expensive, produces inconsistent interaction states, and causes primary workflows to become unreachable at narrow widths.

The product must retain strict Open and Locked Vault segregation, server-enforced authorization, Markdown fidelity, and graph performance while its interface becomes more responsive and accessible.

## Decision

The web application will use a lightweight repository-owned design system built on CSS custom properties and accessible React primitives.

The system will provide:

- Semantic button hierarchy: primary, secondary, quiet, and destructive.
- Shared control heights, spacing, typography, focus, elevation, layout, and motion tokens.
- Accessible primitives for buttons, icon buttons, badges, menus, dialogs, drawers, fields, empty states, and page headers.
- Responsive application modes for wide desktop, compact desktop/tablet, and mobile.
- Progressive migration away from inline styles by feature epic instead of a single high-risk rewrite.

The Blue Horizon brand palette and Plus Jakarta Sans typography remain authoritative. Orange remains reserved for protected Locked Vault state and warning semantics. Presentation changes never replace server-side authorization.

## Consequences

### Positive

- Future UI changes can be made consistently through shared tokens and primitives.
- Keyboard, focus, disabled, loading, and reduced-motion behaviors become reusable defaults.
- Responsive shell work can be implemented without duplicating interaction styles.
- Feature screens can migrate incrementally with smaller rollback surfaces.

### Negative

- Legacy and new component styles will coexist during the migration.
- Some visual duplication remains until all redesign epics are complete.
- Shared primitives add a small internal API that must remain documented and tested.

## Guardrails

- No shared component may infer authorization from visual state.
- Locked Vault data and actions remain governed by server-side policy.
- Dialogs and drawers must provide accessible names, Escape handling, and predictable focus behavior.
- New feature work must use shared primitives unless a documented exception is approved.
